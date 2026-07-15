// 编辑器文件 IO Hook
//
// 功能概述：
// 抽取 NovelEditor 的文件加载（.pmd/HTML/纯文本三层兼容）与文件保存逻辑，
// 统一管理保存竞态、排队、快照、增量索引更新。
// 所有 setTimeout 引用均保存到 ref，组件卸载时通过 clearTimeout 清理，
// 满足 Task 35.1/35.3 的定时器清理要求。
//
// 模块职责：
// 1. 三层兼容读取：.pmd（ProseMirror JSON）> .html > .txt
// 2. .pmd 持久化：保存为 ProseMirror JSON 保留自定义节点结构
// 3. 竞态保护：savingRef + pendingSaveRef 防止并发保存
// 4. 冲突检测：比对磁盘内容与上次保存内容
// 5. 版本快照：保存成功后按 snapshotMinInterval 节流创建快照
// 6. 增量索引：防抖 INDEX_UPDATE_DEBOUNCE_MS 调用 updateFileIndex 同步 Tantivy 索引
// 7. 定时器清理：所有 setTimeout 引用保存到 ref，卸载时清理
//
// 设计原则：
// - 纯函数（isHtmlContent 等）放在文件顶部，可被外部 import 复用
// - 异步函数全部 try-catch 包裹，异常通过 showToast 反馈
// - editor 实例通过 props 传入，不自行创建

import { useEffect, useState, useCallback, useRef } from "react";
import type { MutableRefObject } from "react";
import type { Editor } from "@tiptap/react";
import { readFile, writeFile, createSnapshot, updateFileIndex, updateChapterWordCount, buildProjectIndex } from "../lib/api";
import type { ProjectInfo } from "../lib/api";
import { logger } from "../lib/logger";
import { useAppStore } from "../lib/store";
import { addRecentFile } from "../lib/recentFiles";
import { countWords } from "../lib/wordCounter";
import type { ToastType } from "../lib/toast";
import { checkOutlineChapterSync } from "./useOutlineChapterSync";

// ============================================================
// 常量定义 (Task 2.10.1: 抽取魔法数字为命名常量)
// ============================================================
/** 索引更新防抖间隔 (毫秒) - 避免高频保存触发 Tantivy 索引重建 */
const INDEX_UPDATE_DEBOUNCE_MS = 500;
/** 高亮目标行背景持续时长 (毫秒) - 搜索结果跳转后视觉反馈 */
const HIGHLIGHT_BG_MS = 1500;
/** 高亮目标行 transition 恢复延迟 (毫秒) - 背景复位后恢复原 transition */
const HIGHLIGHT_TRANSITION_MS = 300;
/** 排队保存重试延迟 (毫秒) - 保存期间触发的保存请求在结束后延迟重试 */
const PENDING_SAVE_DELAY_MS = 100;
/** 高亮过渡动画时长 (秒, CSS transition 字符串) - 控制背景色淡入淡出速度 */
const HIGHLIGHT_TRANSITION_CSS = "background-color 0.3s ease";

// ===== 类型定义 =====

/** 翻译函数类型（与 i18n 模块的 TFunction 对齐） */
type TranslateFn = (
  key: string,
  params?: Record<string, string | number>
) => string;

/** Toast 提示函数类型 */
type ShowToastFn = (
  type: ToastType,
  message: string,
  duration?: number
) => void;

/** useEditorFileIO 输入参数 */
export interface UseEditorFileIOParams {
  /** TipTap 编辑器实例 */
  editor: Editor | null;
  /** 当前文件路径 */
  filePath: string | null;
  /** 当前项目信息 */
  currentProject: ProjectInfo | null;
  /** 文件重载触发器（恢复快照后递增以强制重新加载） */
  reloadKey: number;
  /** 是否有未保存修改 */
  dirty: boolean;
  /** 设置 dirty 状态 */
  setDirty: (dirty: boolean) => void;
  /** 设置字数 */
  setWordCount: (count: number) => void;
  /** 设置加载错误信息 */
  setLoadError: (err: string) => void;
  /** 是否启用版本快照 */
  snapshotEnabled: boolean;
  /** 快照最小间隔（秒） */
  snapshotMinInterval: number;
  /** Toast 提示函数 */
  showToast: ShowToastFn;
  /** 翻译函数 */
  t: TranslateFn;
}

/** useEditorFileIO 返回值 */
export interface UseEditorFileIOResult {
  /** 是否正在保存 */
  saving: boolean;
  /** 保存函数（手动保存 / 自动保存 / Ctrl+S 共用） */
  handleSave: () => Promise<boolean>;
  /** 保存中状态 ref（供 autoSave hook 判断竞态） */
  savingRef: MutableRefObject<boolean>;
}

// ===== 纯函数（无副作用，可被外部复用） =====

/**
 * 检测内容是否为 HTML 格式（富文本存储）
 * 输入: content 文件内容字符串
 * 输出: boolean 是否为 HTML 格式
 * 流程:
 *   1. 去除首尾空白
 *   2. 检测是否以常见 HTML 块级标签开头
 *   3. 用于加载时智能识别 HTML（新格式）vs 纯文本（旧格式）
 */
export function isHtmlContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("<")) return false;
  // 检测常见块级标签：p/h1-h6/ul/ol/div/blockquote/pre/table/section/article
  return /^<(p|h[1-6]|ul|ol|div|blockquote|pre|table|section|article|figure)\b/i.test(
    trimmed
  );
}

/**
 * 检测内容是否为 ProseMirror JSON 文档（.pmd 格式）
 * 输入: content 文件内容
 * 输出: boolean 是否为 ProseMirror JSON
 * 流程:
 *   1. 去除首尾空白
 *   2. 检测是否以 { 开头并包含 "type":"doc"
 *   3. 用于加载时识别 .pmd 格式
 */
export function isPmdContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return false;
  // ProseMirror JSON 文档的根节点 type 为 "doc"
  return /"type"\s*:\s*"doc"/.test(trimmed);
}

/**
 * Codex 兼容目录名集合：设定库子系统管理的目录
 * 仅这些目录下的文件才允许转换为 .pmd 格式，其他目录（自定义分类等）保持原扩展名
 */
const CODEX_DIR_SET: Set<string> = new Set([
  "设定", "角色", "人物", "世界观", "术语", "名词", "素材", "资料",
]);

/**
 * 检测文件路径是否位于 Codex 兼容目录下
 * 输入: filePath 文件相对路径或绝对路径（含目录分隔符）
 * 输出: boolean 是否位于设定库目录
 * 流程: 按 / 与 \ 分割路径，检查是否存在 Codex 兼容目录段
 */
function isCodexPath(filePath: string): boolean {
  const segments = filePath.split(/[\\/]/);
  return segments.some((seg) => CODEX_DIR_SET.has(seg));
}

/**
 * 将文件路径转换为 .pmd 扩展名（仅限 Codex 目录下的文件）
 * 输入: filePath 原始文件路径
 * 输出: string .pmd 扩展名的文件路径（非 Codex 目录返回原路径）
 * 流程:
 *   1. 已是 .pmd 则原样返回
 *   2. 非 Codex 目录的文件保持原扩展名（自定义分类等不强制 .pmd）
 *   3. Codex 目录下：.txt/.html/.htm 替换为 .pmd，无扩展名则追加 .pmd
 * 边界限制：避免自定义分类文件被误转为 .pmd，导致 FileList 显示异常
 */
export function toPmdPath(filePath: string): string {
  if (filePath.toLowerCase().endsWith(".pmd")) return filePath;
  // 非 Codex 目录的文件不强制转换扩展名，保持原格式
  if (!isCodexPath(filePath)) return filePath;
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".txt") || lower.endsWith(".html") || lower.endsWith(".htm")) {
    return filePath.replace(/\.(txt|html|htm)$/i, ".pmd");
  }
  return filePath + ".pmd";
}

/**
 * 转义 HTML 特殊字符（防止 XSS 与解析错误）
 * 输入: s 原始字符串
 * 输出: 转义后的字符串
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 纯文本转 HTML 段落（向后兼容旧 .txt 文件加载）
 * 输入: text 纯文本内容（按 \n 分隔段落）
 * 输出: HTML 字符串（每行转为 <p> 段落）
 * 流程:
 *   1. 按换行符分割文本
 *   2. 非空行转 <p>已转义文本</p>，空行转 <p></p>
 *   3. 拼接为完整 HTML 字符串
 */
function plainTextToHtml(text: string): string {
  const lines = text.split(/\r?\n/);
  return lines
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : "<p></p>"))
    .join("");
}

// ===== Hook 实现 =====

/**
 * 编辑器文件 IO Hook
 * 输入: UseEditorFileIOParams（editor/filePath/currentProject 等）
 * 输出: UseEditorFileIOResult（saving/handleSave/savingRef）
 * 核心流程:
 *   1. 文件加载 effect：监听 filePath/editor/reloadKey 变化，三层兼容读取
 *   2. handleSave：竞态保护 + 冲突检测 + .pmd 持久化 + 快照 + 索引更新
 *   3. scheduleIndexUpdate：防抖 500ms 调用 updateFileIndex
 *   4. 注册/注销全局 editorSave 回调（供 App 层 Ctrl+S 调用）
 *   5. 卸载时清理所有 setTimeout 引用
 * 定时器清理（Task 35.1/35.3）:
 *   - loadScrollTimerRef: 加载后焦点/滚动定位（原 line 557）
 *   - highlightBgTimerRef: 高亮目标行背景（原 line 576）
 *   - highlightTransitionTimerRef: 恢复 transition（原 line 578）
 *   - pendingSaveTimerRef: 排队保存（原 line 909）
 *   - indexUpdateTimerRef: 索引更新防抖（原 line 813）
 */
export function useEditorFileIO(params: UseEditorFileIOParams): UseEditorFileIOResult {
  const {
    editor,
    filePath,
    currentProject,
    reloadKey,
    dirty,
    setDirty,
    setWordCount,
    setLoadError,
    snapshotEnabled,
    snapshotMinInterval,
    showToast,
    t,
  } = params;

  const [saving, setSaving] = useState(false);

  // 保存竞态 ref：true 表示正在保存中，阻止并发保存
  const savingRef = useRef(false);
  // 排队保存标记：保存期间触发的保存请求被排队，保存完成后重试
  const pendingSaveRef = useRef(false);
  // 上次保存内容（JSON 字符串）：用于冲突检测
  const lastSavedContentRef = useRef("");
  // 上次自动创建快照的时间戳（毫秒），节流避免高频快照
  const lastSnapshotTimeRef = useRef(0);

  // ===== 定时器 ref（Task 35.1/35.3：所有 setTimeout 引用必须保存） =====
  // 加载后焦点/滚动定位定时器（原 NovelEditor.tsx line 557）
  const loadScrollTimerRef = useRef<number | null>(null);
  // 高亮目标行背景恢复定时器（原 NovelEditor.tsx line 576）
  const highlightBgTimerRef = useRef<number | null>(null);
  // 高亮目标行 transition 恢复定时器（原 NovelEditor.tsx line 578）
  const highlightTransitionTimerRef = useRef<number | null>(null);
  // 排队保存定时器（原 NovelEditor.tsx line 909）
  const pendingSaveTimerRef = useRef<number | null>(null);
  // 增量索引更新防抖定时器（原 NovelEditor.tsx line 813）
  const indexUpdateTimerRef = useRef<number | null>(null);

  /**
   * 清理指定定时器引用
   * 输入: timerRef 定时器 ref
   * 流程: 若 ref.current 非空则 clearTimeout 并置 null
   */
  const clearTimerRef = (timerRef: MutableRefObject<number | null>) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  /**
   * 调度增量索引更新（防抖 INDEX_UPDATE_DEBOUNCE_MS，静默执行）
   * 输入:
   *   projectPath 项目根路径（绝对路径）
   *   absFilePath 文件绝对路径（.txt 或 .pmd）
   * 流程:
   *   1. 清除已有定时器，重置防抖计时
   *   2. 防抖窗口结束后计算相对路径（去除项目根前缀，兼容 / 与 \ 分隔符）
   *   3. 转换为 .pmd 相对路径（与持久化格式一致，text_extractor 支持 .pmd 提取）
   *   4. 调用 updateFileIndex 增量更新索引
   *   5. Task 5.5.1: 增量更新失败时记录 warning 并回退到全量构建 buildProjectIndex
   *      回退策略保证索引最终一致性，避免增量失败导致索引与正文长期脱节
   *   6. 全量构建仍失败则 logger.error，不干扰用户写作流程
   */
  const scheduleIndexUpdate = useCallback(
    (projectPath: string, absFilePath: string) => {
      // 清除已有定时器，重置防抖计时
      clearTimerRef(indexUpdateTimerRef);
      indexUpdateTimerRef.current = window.setTimeout(() => {
        indexUpdateTimerRef.current = null;
        // 计算相对路径（兼容 / 与 \ 分隔符）
        const prefix =
          projectPath.endsWith("/") || projectPath.endsWith("\\")
            ? projectPath
            : projectPath + "/";
        const relPath = absFilePath.startsWith(prefix)
          ? absFilePath.slice(prefix.length)
          : absFilePath;
        // 索引 .pmd 版本（与持久化格式一致）
        const pmdRelPath = toPmdPath(relPath);
        // Task 5.5.1: 增量更新索引，失败时回退到全量构建
        updateFileIndex(projectPath, pmdRelPath).catch((err) => {
          // 增量更新失败，记录 warning 并回退到全量构建
          logger.warn(
            "增量更新索引失败，回退到全量构建:",
            err instanceof Error ? err : String(err)
          );
          buildProjectIndex(projectPath).catch((buildErr) => {
            // 全量构建也失败，记录 error，不干扰用户写作
            logger.error(
              "全量构建索引失败:",
              buildErr instanceof Error ? buildErr : String(buildErr)
            );
          });
        });
      }, INDEX_UPDATE_DEBOUNCE_MS);
    },
    []
  );

  // ===== 文件加载 effect（三层兼容读取） =====
  useEffect(() => {
    let cancelled = false;
    if (!editor || !filePath) {
      editor?.commands.clearContent();
      setWordCount(0);
      setDirty(false);
      return;
    }

    setLoadError("");
    const projectPath = currentProject?.path || "";
    const pmdPath = toPmdPath(filePath);
    // 三层兼容读取：优先 .pmd 版本，不存在则降级读取原文件
    const loadPromise =
      pmdPath !== filePath
        ? readFile(pmdPath, projectPath).catch(() =>
            readFile(filePath, projectPath)
          )
        : readFile(filePath, projectPath);
    loadPromise
      .then((content) => {
        if (cancelled) return;
        // 智能识别内容格式（三层兼容读取）：
        // - .pmd 格式（ProseMirror JSON）：JSON.parse 后 setContent(json)
        // - HTML 格式（旧富文本存储）：直接 setContent(html)
        // - 纯文本（旧 .txt 兼容）：按行转 HTML 段落再 setContent
        if (isPmdContent(content)) {
          // .pmd 格式：解析 ProseMirror JSON 并直接注入编辑器
          try {
            const json = JSON.parse(content);
            editor.commands.setContent(json);
          } catch {
            // JSON 解析失败，降级为纯文本处理
            const html = plainTextToHtml(content);
            editor.commands.setContent(html);
          }
        } else if (isHtmlContent(content)) {
          editor.commands.setContent(content);
        } else {
          const html = plainTextToHtml(content);
          editor.commands.setContent(html);
        }
        if (cancelled) return;
        setDirty(false);
        // 记录上次保存内容（用于冲突检测，使用 JSON 字符串）
        lastSavedContentRef.current = JSON.stringify(editor.getJSON());
        setWordCount(countWords(editor.getText()));
        // 记录最近文件
        const relativePath = filePath.replace(
          (currentProject?.path || "") + "/",
          ""
        );
        const fileName = relativePath.split(/[\\/]/).pop() || relativePath;
        addRecentFile({
          name: fileName,
          relative_path: relativePath,
          project_name: currentProject?.meta?.name || "",
          project_path: currentProject?.path || "",
        });
        // 焦点常驻：加载完成后立即聚焦编辑器，让用户可立即开始写作
        // 使用 setTimeout 确保 DOM 已渲染完成
        // Task 35.3：保存 timer 引用到 ref，卸载时清理
        clearTimerRef(loadScrollTimerRef);
        loadScrollTimerRef.current = window.setTimeout(() => {
          if (!cancelled && editor && !editor.isDestroyed) {
            // 搜索结果跳转定位：检查 store 中的待定位行号
            // 通过 getState 读取避免将 pendingScrollLine 加入 useEffect 依赖项
            const pendingLine = useAppStore.getState().pendingScrollLine;
            if (pendingLine !== null && pendingLine > 0) {
              // 查询第 N 个块级元素（p/h/li/blockquote/pre）模拟行定位
              const blockEls = editor.view.dom.querySelectorAll(
                "p, h1, h2, h3, h4, li, blockquote, pre, tr"
              );
              const targetEl = blockEls[pendingLine - 1] as HTMLElement | undefined;
              if (targetEl) {
                targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
                // 高亮目标行 HIGHLIGHT_BG_MS 毫秒，提供视觉反馈（内联样式避免自定义 CSS）
                const originalBg = targetEl.style.backgroundColor;
                const originalTransition = targetEl.style.transition;
                targetEl.style.transition = HIGHLIGHT_TRANSITION_CSS;
                targetEl.style.backgroundColor = "rgba(240, 144, 112, 0.2)";
                // Task 35.3：保存嵌套 timer 引用到 ref
                clearTimerRef(highlightBgTimerRef);
                highlightBgTimerRef.current = window.setTimeout(() => {
                  targetEl.style.backgroundColor = originalBg;
                  clearTimerRef(highlightTransitionTimerRef);
                  highlightTransitionTimerRef.current = window.setTimeout(() => {
                    targetEl.style.transition = originalTransition;
                  }, HIGHLIGHT_TRANSITION_MS);
                }, HIGHLIGHT_BG_MS);
              }
              // 消费后清空，避免下次加载重复定位
              useAppStore.getState().setPendingScrollLine(null);
              editor.commands.focus();
              return;
            }
            editor.commands.focus("end");
          }
        }, 0);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(t("editor.loadFailed", { error: String(e) }));
      });
    return () => {
      cancelled = true;
      // 清理加载相关定时器（Task 35.3）
      clearTimerRef(loadScrollTimerRef);
      clearTimerRef(highlightBgTimerRef);
      clearTimerRef(highlightTransitionTimerRef);
    };
  }, [filePath, editor, currentProject, t, reloadKey, setDirty, setWordCount, setLoadError]);

  // ===== 文件保存逻辑 =====
  /**
   * 保存文件（.pmd 持久化，ProseMirror JSON 格式；含竞态保护）
   * 输入: 无（通过闭包访问 editor/filePath/dirty/currentProject）
   * 输出: Promise<boolean> 保存成功返回 true，否则 false
   * 核心流程:
   *   1. 竞态保护：正在保存时标记 pending 并返回，不阻塞调用方
   *   2. 冲突检测：读取磁盘内容与 lastSavedContentRef 比对
   *   3. 持久化：editor.getJSON() 序列化为 .pmd 文件
   *   4. 版本快照：按 snapshotMinInterval 节流创建快照
   *   5. 增量索引：防抖调度 updateFileIndex
   *   6. 排队重试：若保存期间有新请求，延迟 PENDING_SAVE_DELAY_MS 重试
   * 定时器清理（Task 35.1）:
   *   - pendingSaveTimerRef 保存排队重试 timer 引用，卸载时清理
   */
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!editor || !filePath || !dirty) return false;
    // 竞态保护：如果正在保存，标记待保存但不阻塞
    if (savingRef.current) {
      pendingSaveRef.current = true;
      return false;
    }
    savingRef.current = true;
    pendingSaveRef.current = false;
    setSaving(true);
    try {
      const projectPath = currentProject?.path || "";
      const pmdPath = toPmdPath(filePath);
      // 冲突检测：读取当前磁盘内容与上次保存内容比较
      // 优先读取 .pmd 版本，不存在则读原文件
      try {
        const currentContent =
          pmdPath !== filePath
            ? await readFile(pmdPath, projectPath).catch(() =>
                readFile(filePath, projectPath)
              )
            : await readFile(filePath, projectPath);
        if (
          lastSavedContentRef.current &&
          currentContent !== lastSavedContentRef.current
        ) {
          showToast("warning", t("editor.conflictDetected"));
          // 不阻塞保存，但提示用户存在冲突
        }
      } catch {
        // 文件可能不存在，跳过冲突检测
      }

      // 保存为 .pmd 格式（ProseMirror JSON），持久化完整文档结构
      // .pmd 格式相比 .html 优势：
      //   1. 保留 sceneBreak/characterMentionNode 等自定义节点
      //   2. 便于 Tantivy 索引与 AI 上下文提取
      //   3. 避免 HTML 序列化/反序列化的信息丢失
      const json = editor.getJSON();
      const jsonStr = JSON.stringify(json);
      await writeFile(pmdPath, jsonStr, projectPath);
      lastSavedContentRef.current = jsonStr;
      setDirty(false);
      useAppStore.getState().setEditorDirty(false);
      showToast("success", t("editor.saved"));
      useAppStore.getState().refreshProjectTree();

      // 版本快照：保存成功后自动创建快照（作者完全无感）
      // 受 snapshotEnabled 开关控制，并按 snapshotMinInterval 节流避免高频重复
      if (snapshotEnabled && currentProject?.path) {
        const now = Date.now();
        const elapsed = now - lastSnapshotTimeRef.current;
        if (elapsed >= snapshotMinInterval * 1000) {
          lastSnapshotTimeRef.current = now;
          // 异步创建快照，不阻塞保存流程，失败静默处理（不打扰作者）
          // 保存 .pmd JSON 字符串作为快照内容（保留自定义节点结构）
          createSnapshot(filePath, currentProject.path, jsonStr, "auto").catch(() => {
            // 快照创建失败不影响保存成功状态，仅回退时间戳以便下次重试
            lastSnapshotTimeRef.current = 0;
          });
        }
      }
      // 增量更新 Tantivy 索引（防抖静默执行）
      // 设计依据：索引与正文同步，保证全局搜索与 AI RAG 检索结果时效性
      if (currentProject?.path && filePath) {
        scheduleIndexUpdate(currentProject.path, filePath);
      }

      // Task 4.5.3: 章节保存时增量更新 WritingStats(字数 SSOT)
      // 计算相对路径并转换为 .pmd 格式(与持久化格式一致),作为 chapter_id 传给后端
      // 保存成功后派发自定义事件,通知项目卡片实时刷新字数显示
      if (currentProject?.path && filePath && editor) {
        const projectPath = currentProject.path;
        const prefix =
          projectPath.endsWith("/") || projectPath.endsWith("\\")
            ? projectPath
            : projectPath + "/";
        const relPath = filePath.startsWith(prefix)
          ? filePath.slice(prefix.length)
          : filePath;
        const pmdRelPath = toPmdPath(relPath);
        const wc = countWords(editor.getText());
        updateChapterWordCount(projectPath, pmdRelPath, wc).catch((err) => {
          logger.error("增量更新 WritingStats 失败:", err instanceof Error ? err : String(err));
        });
        // Task 4.5.4: 派发字数更新事件,项目卡片监听后实时刷新
        window.dispatchEvent(
          new CustomEvent("nf:writing-stats-updated", {
            detail: { projectPath },
          })
        );
      }

      // Task 4.8.2: 大纲文件保存后检测 chapterId 关联状态,提示用户可同步章节标题
      // 火并忘记模式:检测失败静默处理,不阻塞 handleSave 返回
      if (currentProject?.path && pmdPath) {
        checkOutlineChapterSync(
          pmdPath,
          currentProject.path,
          showToast,
          t,
        ).catch(() => {
          // 静默处理,不影响保存流程
        });
      }
      return true;
    } catch (e) {
      showToast("error", t("editor.saveFailed", { error: String(e) }));
      // 保存失败保留 dirty 状态以便重试
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
      // 处理排队的保存请求
      // Task 35.1：保存 timer 引用到 ref，卸载时清理
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        clearTimerRef(pendingSaveTimerRef);
        pendingSaveTimerRef.current = window.setTimeout(() => {
          pendingSaveTimerRef.current = null;
          handleSave();
        }, PENDING_SAVE_DELAY_MS);
      }
    }
  }, [
    editor,
    filePath,
    dirty,
    showToast,
    t,
    currentProject,
    snapshotEnabled,
    snapshotMinInterval,
    setDirty,
    scheduleIndexUpdate,
  ]);

  // ===== 注册/注销全局保存回调 =====
  // 供 App 层 Ctrl+S / 退出前保存等场景调用
  useEffect(() => {
    useAppStore.getState().registerEditorSave(handleSave);
    return () => {
      useAppStore.getState().registerEditorSave(null);
    };
  }, [handleSave]);

  // ===== 卸载时清理所有定时器（Task 35.1/35.3） =====
  useEffect(() => {
    return () => {
      clearTimerRef(loadScrollTimerRef);
      clearTimerRef(highlightBgTimerRef);
      clearTimerRef(highlightTransitionTimerRef);
      clearTimerRef(pendingSaveTimerRef);
      clearTimerRef(indexUpdateTimerRef);
    };
  }, []);

  return { saving, handleSave, savingRef };
}
