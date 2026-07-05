// TipTap 富文本编辑器组件（Office 级）
//
// 功能概述：
// 基于 TipTap 的小说创作编辑器，提供 Office 级富文本编辑体验。
// 支持标题层级、有序/无序列表、任务列表、表格、链接、高亮、文本对齐、
// 字体颜色、上下标、水平分割线、硬换行等完整富文本能力。
// 底层存储采用 HTML 格式（持久化富文本格式），向后兼容纯文本 .txt 文件。
// 支持自动保存、字数统计、TXT 导出（用于番茄/起点发布）、大纲视图、
// 聚焦模式、版本快照、查找替换、角色悬停卡片。
// 适配 FANDEX 暗黑主题。
//
// 模块职责：
// 1. 提供 TipTap 编辑器实例（Office 级富文本模式）
// 2. 自动加载与保存文件内容（HTML 存储向后兼容纯文本）
// 3. 实时统计字数
// 4. 根据项目类型加载特色扩展
// 5. 支持 TXT 导出、大纲视图、聚焦模式、查找替换

import { useEditor, EditorContent } from "@tiptap/react";
import type { Extensions } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import History from "@tiptap/extension-history";
import Underline from "@tiptap/extension-underline";
import Strike from "@tiptap/extension-strike";
import Code from "@tiptap/extension-code";
import CodeBlock from "@tiptap/extension-code-block";
import Blockquote from "@tiptap/extension-blockquote";
import Placeholder from "@tiptap/extension-placeholder";
// Office 级富文本扩展
import Heading from "@tiptap/extension-heading";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import ListItem from "@tiptap/extension-list-item";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Typography from "@tiptap/extension-typography";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import HardBreak from "@tiptap/extension-hard-break";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { readFile, writeFile, readProjectTree, createSnapshot } from "../lib/api";
import { useAppStore } from "../lib/store";
import { useSettingsStore } from "../lib/settingsStore";
import { usePreferencesStore } from "../lib/preferencesSlice";
import { CharacterMention } from "../lib/characterMention";
import { IndentParagraph } from "../lib/indentParagraph";
import { PoetryFormat } from "../lib/poetryFormat";
import { VSShortcuts } from "../lib/vscodeShortcuts";
import { AutoPair } from "../lib/autoPair";
import { LineHighlight } from "../lib/lineHighlight";
import { SmartTab } from "../lib/smartTab";
import { FontSizeShortcut } from "../lib/fontSizeShortcut";
import { EntityHighlight } from "../lib/entityHighlightPlugin";
import { getEntityHighlightClient } from "../lib/entityHighlightClient";
import { listCodexEntities } from "../lib/codexApi";
import { Foreshadowing } from "../lib/foreshadowing";
import { countWords } from "../lib/wordCounter";
import { addRecentFile } from "../lib/recentFiles";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import { useWritingSession } from "../hooks/useWritingSession";
import EditorToolbar from "./EditorToolbar";
import EditorBubbleMenu from "./EditorBubbleMenu";
import SnapshotHistory from "./SnapshotHistory";
import CharacterHoverCard from "./CharacterHoverCard";
import FindReplace from "./FindReplace";

interface NovelEditorProps {
  filePath: string | null;
  focusMode?: boolean;
}

/**
 * 检测内容是否为 HTML 格式（富文本存储）
 * 输入: content 文件内容字符串
 * 输出: boolean 是否为 HTML 格式
 * 流程:
 *   1. 去除首尾空白
 *   2. 检测是否以常见 HTML 块级标签开头
 *   3. 用于加载时智能识别 HTML（新格式）vs 纯文本（旧格式）
 */
function isHtmlContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("<")) return false;
  // 检测常见块级标签：p/h1-h6/ul/ol/div/blockquote/pre/table/section/article
  return /^<(p|h[1-6]|ul|ol|div|blockquote|pre|table|section|article|figure)\b/i.test(trimmed);
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
function isPmdContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return false;
  // ProseMirror JSON 文档的根节点 type 为 "doc"
  return /"type"\s*:\s*"doc"/.test(trimmed);
}

/**
 * 将文件路径转换为 .pmd 扩展名
 * 输入: filePath 原始文件路径
 * 输出: string .pmd 扩展名的文件路径
 * 流程:
 *   1. 已是 .pmd 则原样返回
 *   2. .txt/.html/.htm 替换为 .pmd
 *   3. 无扩展名则追加 .pmd
 */
function toPmdPath(filePath: string): string {
  if (filePath.toLowerCase().endsWith(".pmd")) return filePath;
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

/**
 * 验证字符串是否为有效的角色名
 * 输入: name 待验证的字符串
 * 输出: boolean 是否有效
 * 流程:
 *   1. 非空且长度 <= 20
 *   2. 不包含冒号（:或：）—— 排除字段行如"姓名:张三"
 *   3. 不以常见标签词开头（角色/姓名/声线/外貌/性格/背景等）
 *   4. 不全是数字或纯符号
 */
function isValidCharacterName(name: string): boolean {
  if (!name || name.length === 0 || name.length > 20) return false;
  // 包含冒号的行视为字段而非角色名
  if (name.includes(":") || name.includes("：")) return false;
  // 以常见标签词开头的行视为字段标签
  const labelPrefixes = ["角色", "姓名", "声线", "外貌", "性格", "背景", "动机", "关系", "语言", "口头禅"];
  for (const prefix of labelPrefixes) {
    if (name.startsWith(prefix)) return false;
  }
  // 不允许纯数字或纯符号
  if (/^[\d\s\p{P}]+$/u.test(name)) return false;
  return true;
}

/**
 * TipTap 纯文本编辑器组件
 * 输入:
 *   filePath 当前打开的文件路径（null 时显示空状态）
 *   focusMode 是否启用聚焦模式（隐藏工具栏装饰）
 * 输出: JSX 编辑器界面（工具栏 + 编辑区 + 可选大纲视图）
 * 流程:
 *   1. 根据 projectType 判断文体（剧本/对话/散文）并构建扩展列表
 *   2. 扫描角色目录提取角色名（剧本/对话体用于 CharacterMention）
 *   3. 加载文件内容：纯文本直读，转 ProseMirror JSON 结构
 *   4. 自动保存：基于 dirty 状态与用户设置的间隔触发
 *   5. 冲突检测：保存前比对磁盘内容与上次保存内容
 *   6. 导出 TXT：Blob 下载，文件名沿用原文件名
 */
export default function NovelEditor({
  filePath,
  focusMode = false,
}: NovelEditorProps) {
  const currentProject = useAppStore((s) => s.currentProject);
  const { t } = useI18n();
  const [wordCount, setWordCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [characters, setCharacters] = useState<string[]>([]);
  const { showToast } = useToast();
  // 角色悬停卡片状态：鼠标悬停在正文中的角色名上时显示摘要卡片
  // characterId 字段（p5-26）：从实体高亮装饰的 data-entity-id 属性提取，供 AI 操作区使用
  const [hoverCard, setHoverCard] = useState<{
    open: boolean;
    x: number;
    y: number;
    name: string;
    characterId?: string;
  }>({
    open: false, x: 0, y: 0, name: "",
  });
  const hoverTimerRef = useRef<number | null>(null);
  // 当前已显示的角色名引用：用于避免同一角色名上移动时反复触发计时器造成卡片闪烁
  const hoverShownNameRef = useRef<string>("");

  const projectType = currentProject?.meta?.type || "standard";
  // 文体标识保留用于 UI 层条件渲染（如横幅提示文案差异）
  // 扩展注册不再依赖文体守卫，所有扩展全量注册，由全局开关控制行为
  const isScript = projectType === "script" || projectType === "screenplay";
  const isDialogue = projectType === "dialogue";
  // 兼容旧代码：日记体仍保留 isEssay 标识用于日期自动填充等场景
  const isEssay = projectType === "diary";
  const autoSaveInterval = useSettingsStore((s) => s.autoSaveInterval);
  const diaryAutoDate = useSettingsStore((s) => s.diaryAutoDate);
  const indentEnabled = useSettingsStore((s) => s.indentEnabled);
  const indentWidth = useSettingsStore((s) => s.indentWidth);
  const snapshotEnabled = useSettingsStore((s) => s.snapshotEnabled);
  const snapshotMinInterval = useSettingsStore((s) => s.snapshotMinInterval);

  // 编辑器功能开关（用户级偏好，跨项目共享）
  // 所有扩展全量注册，行为由开关控制，消除文体守卫导致的功能孤岛
  const editorPrefs = usePreferencesStore((s) => s.preferences);
  const [showSnapshotHistory, setShowSnapshotHistory] = useState(false);
  // 查找替换面板可见性（Ctrl+F / Ctrl+H 触发）
  const [showFindReplace, setShowFindReplace] = useState(false);
  // 查找替换初始模式：'find' 仅查找 / 'replace' 查找并替换
  const [findReplaceMode, setFindReplaceMode] = useState<"find" | "replace">("find");
  // 文件重载触发器：恢复快照后递增以强制重新加载文件内容
  const [reloadKey, setReloadKey] = useState(0);
  // 上次自动创建快照的时间戳（毫秒），用于控制最小间隔，避免高频保存产生重复快照
  const lastSnapshotTimeRef = useRef(0);

  // 写作会话追踪：记录本次会话字数、时长、WPM
  const session = useWritingSession(wordCount, filePath);

  // 从角色目录自动提取角色名（扫描每个 .txt 文件首行）
  // 文件格式约定：第一行为角色名（纯文本，不含冒号、不以分隔符开头）
  // 过滤规则：跳过模板文件（文件名包含"模板"/"名册"/"template"/"roster"）
  // 回退方案：读取 角色名册.txt（手动维护的花名册）
  // 目录兼容：同时扫描"角色"与"人物"目录，消除目录名硬编码导致的静默失败
  // 全文体扫描：所有文体均加载角色列表，由全局开关控制 Tab 补全行为
  useEffect(() => {
    let cancelled = false;
    if (!currentProject) {
      setCharacters([]);
      return;
    }

    const extractNames = async () => {
      try {
        // 优先方案：扫描角色目录，从每个 .txt 文件首行提取角色名
        // 兼容"角色"与"人物"两种目录名（codexApi 同样兼容这两种命名）
        const tree = await readProjectTree(currentProject.path);
        const charDir = tree.find(
          (n) => n.is_dir && (n.name === "角色" || n.name === "人物")
        );
        if (charDir?.children) {
          const charDirPath = `${currentProject.path}/${charDir.name}`;
          const names: string[] = [];
          for (const child of charDir.children) {
            if (child.is_dir || !child.name.endsWith(".txt")) continue;
            // 过滤模板文件和名册文件（这些不是单个角色的设定文件）
            const lowerName = child.name.toLowerCase();
            if (lowerName.includes("模板") || lowerName.includes("名册") ||
                lowerName.includes("template") || lowerName.includes("roster") ||
                lowerName.includes("readme")) {
              continue;
            }
            try {
              const filePath = `${charDirPath}/${child.name}`;
              const content = await readFile(filePath, currentProject.path);
              const firstLine = content
                .split(/\r?\n/)
                .map((l) => l.trim())
                .find((l) => l && !l.startsWith("#") && !l.startsWith("---") && !l.startsWith("==="));
              // 验证首行是否为有效角色名
              if (firstLine && isValidCharacterName(firstLine)) {
                names.push(firstLine);
              }
            } catch {
              // 单个文件读取失败，跳过
            }
          }
          if (!cancelled && names.length > 0) {
            setCharacters(names);
            return;
          }
        }
      } catch {
        // 目录扫描失败，回退到角色名册
      }

      // 回退方案：读取 角色名册.txt（兼容角色与人物两种目录）
      const rosterPaths = [
        `${currentProject.path}/角色/角色名册.txt`,
        `${currentProject.path}/人物/角色名册.txt`,
      ];
      try {
        // 依次尝试候选路径，读取第一个存在的名册文件
        let content: string | null = null;
        for (const p of rosterPaths) {
          try {
            content = await readFile(p, currentProject.path);
            break;
          } catch {
            // 当前路径不存在，尝试下一个
          }
        }
        if (content) {
          const names = content
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(
              (line) =>
                line &&
                !line.startsWith("#") &&
                !line.startsWith(">") &&
                !line.startsWith("-") &&
                !/^[-=]{3,}$/.test(line)
            )
            .filter(isValidCharacterName);
          if (!cancelled) setCharacters(names);
        } else {
          if (!cancelled) setCharacters([]);
        }
      } catch {
        if (!cancelled) setCharacters([]);
      }
    };

    extractNames();
    return () => { cancelled = true; };
  }, [currentProject]);

  // 构建 Aho-Corasick 实体高亮自动机
  // 依赖：阶段 1 设定库（listCodexEntities）提供结构化实体（含 UUID 与别名）
  // 行为：项目切换时重置 Worker 自动机，注入新项目的全部实体模式串
  // AI-Ready：自动机为 Web Worker 内的 Aho-Corasick 自动机，匹配触发 `entity:detected` 事件
  // 容错：设定库读取失败时清空自动机，避免跨项目实体污染
  useEffect(() => {
    let cancelled = false;
    if (!currentProject) {
      // 无项目上下文：清空自动机，避免上次项目残留匹配
      getEntityHighlightClient().reset();
      return;
    }
    const buildAutomaton = async () => {
      try {
        const entities = await listCodexEntities(currentProject.path);
        if (cancelled) return;
        // 将 StructuredCodexEntity 转为 Worker 接受的 EntityPattern
        // 实体名与别名均作为模式串注入（O(N+K) 一次扫描全部匹配）
        // 过滤空名与空别名的脏数据，避免 AC 自动机插入空串导致死循环
        const patterns = entities
          .map((e) => ({
            entityId: e.meta.id,
            entityName: e.meta.name,
            entityType: e.meta.entity_type,
            aliases: (e.meta.aliases ?? []).filter((a) => a.trim().length > 0),
          }))
          .filter((p) => p.entityId && p.entityName && p.entityName.trim().length > 0);
        // 先重置再构建：防止旧项目实体残留造成跨项目误高亮
        getEntityHighlightClient().reset();
        await getEntityHighlightClient().buildAutomaton(patterns);
      } catch {
        // 设定库读取失败：清空自动机，编辑器仍可用（仅无高亮）
        if (!cancelled) getEntityHighlightClient().reset();
      }
    };
    buildAutomaton();
    return () => { cancelled = true; };
  }, [currentProject]);

  // 构建 TipTap 扩展列表（Office 级富文本模式）
  // 包含完整富文本能力：标题层级、列表、表格、链接、高亮、对齐、颜色等
  const extensions: Extensions = useMemo(() => {
    const exts: Extensions = [
      // 基础节点
      Document,
      Paragraph,
      Text,
      // 基础行内格式（粗体/斜体/下划线/删除线/行内代码）
      Bold,
      Italic,
      Underline,
      Strike,
      Code,
      // 块级格式
      CodeBlock,
      Blockquote,
      // Office 级标题层级（h1-h4，对应章节/卷/节/小节）
      Heading.configure({ levels: [1, 2, 3, 4] }),
      // 列表：无序/有序/任务列表
      BulletList,
      OrderedList,
      ListItem,
      TaskList,
      TaskItem.configure({ nested: true }),
      // 表格功能已移除（Table/TableRow/TableCell/TableHeader 扩展不再注册）
      // 链接：不自动跳转（按 Ctrl/Cmd+Click 跳转），允许任意协议
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: "nf-link", rel: "noopener noreferrer" },
      }),
      // 高亮标记（黄底强调，类似 Office 荧光笔）
      Highlight.configure({ multicolor: true }),
      // 文本对齐（左/中/右/两端，作用于标题与段落）
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      // 字体颜色（依赖 TextStyle 承载 color 属性）
      TextStyle,
      Color,
      // 排版增强（自动转换 (c) (tm) -> © ™ 等，智能引号）
      Typography,
      // 水平分割线 <hr>
      HorizontalRule,
      // 硬换行（Shift+Enter）
      HardBreak,
      // 上下标（化学式/数学公式/注释引用）
      Subscript,
      Superscript,
      // 历史记录（撤销/重做）
      History,
      // 占位符
      Placeholder.configure({ placeholder: t("editor.placeholder") }),
      // VSCode 风格段落级快捷键（所有文体通用）
      VSShortcuts.configure({ enabled: true }),
      // VSCode 风格自动配对括号引号（所有文体通用）
      AutoPair.configure({ enabled: true }),
      // VSCode 风格当前段落高亮（所有文体通用）
      LineHighlight.configure({ enabled: true, className: "current-paragraph" }),
      // VSCode 风格智能选中缩进（Tab/Shift+Tab 批量缩进多段）
      SmartTab.configure({ enabled: true, indentChar: "\u3000" }),
      // 字号快捷键:Ctrl+= 放大 / Ctrl+- 缩小 / Ctrl+0 重置
      FontSizeShortcut.configure({ enabled: true }),
    ];

    // 首行缩进扩展：所有文体全量注册，由全局开关控制行为
    // 开关来源合并：settingsStore.indentEnabled（旧设置）与 preferences.enableAutoIndent（新开关）
    // 两者均为 true 时启用，兼容历史设置迁移
    const autoIndentEnabled = indentEnabled && editorPrefs.enableAutoIndent;
    exts.push(IndentParagraph.configure({ enabled: autoIndentEnabled, indentWidth }));

    // 角色名补全扩展：所有文体全量注册，由全局开关控制行为
    // 开关关闭时 onKeyDown 直接 return false，Tab 键交还默认缩进行为
    //
    // zundo 协调策略（遗漏 13 补充）：
    // ProseMirror 编辑器内容由 ProseMirror History 扩展管理撤销/重做，
    // zundo temporal 中间件仅管理全局状态（timelineStore/characterGraphStore）。
    // 两者作用域分离，characterMention 插入产生的文档变更由 ProseMirror History 处理。
    //
    // 当 onSelect 回调需要更新全局状态（如最近使用角色列表）时：
    //   1. 在回调内调用 useTimelineStore.temporal.getState().pause()
    //   2. 执行全局状态更新
    //   3. 立即调用 useTimelineStore.temporal.getState().resume()
    //   4. 这样 zundo 不会记录此次全局状态变更，避免与 ProseMirror History 不同步
    //
    // 当前 onSelect 为空函数，无需 zundo pause/resume。
    // 阶段 5 实时标记接入后，若 onSelect 触发全局状态更新，需按上述策略包裹。
    exts.push(
      CharacterMention.configure({
        characters,
        enabled: editorPrefs.enableCharacterMentionPicker,
        onSelect: () => {},
        labels: {
          pickerAriaLabel: t("editor.charRosterHint", { count: characters.length }),
          listboxAriaLabel: t("editor.charRosterHint", { count: characters.length }),
          customInputAriaLabel: t("characterMention.placeholder"),
          customInputPlaceholder: t("characterMention.placeholder"),
          hintText: "Tab ↵ | ↑↓ | Esc",
        },
      })
    );

    // 实体高亮扩展：所有文体全量注册，由全局开关控制行为
    // 依赖：Codex 设定库（阶段 1）提供 EntityPattern 数据源
    // 行为：Web Worker Aho-Corasick 自动机匹配实体名/别名，ProseMirror Decoration 渲染下划线
    // AI-Ready：匹配结果触发 `entity:detected` Tauri 事件，供 AI 模块监听场景上下文
    // 文件路径传空时仅高亮不触发事件（防止空路径污染 AI 数据流）
    exts.push(
      EntityHighlight.configure({
        enabled: editorPrefs.enableEntityHighlight,
        filePath: filePath || "",
      })
    );

    // 诗歌排版扩展：所有文体全量注册，由全局开关控制行为
    exts.push(PoetryFormat.configure({ enabled: editorPrefs.enablePoetryFormat }));

    // 伏笔标记扩展：所有文体全量注册，由全局开关控制行为
    // p5-27：底部波浪线 Decoration 由 CSS .nf-foreshadowing--{status} 提供
    // 快捷键 Alt+Shift-F 已避开 Alt+7（人物图）与 Alt+8（伏笔面板）
    // Mark 持久化 foreshadowingId + status，伏笔面板状态变更通过 updateForeshadowingStatus 同步
    // 开关关闭时 Mark 仍可被 parseHTML 解析（保证旧文件加载不丢失标记），仅 toggle 命令受开关控制
    if (editorPrefs.enableForeshadowMark) {
      exts.push(Foreshadowing.configure({ HTMLAttributes: {} }));
    }
    return exts;
  }, [characters, t, indentEnabled, indentWidth, editorPrefs, filePath, editorPrefs.enableEntityHighlight, editorPrefs.enableForeshadowMark]);

  // 创建编辑器实例（Office 级富文本模式）
  const editor = useEditor({
    extensions,
    content: "",
    editorProps: {
      attributes: {
        class:
          "fandex-editor-rich prose max-w-none focus:outline-none min-h-[60vh] px-8 py-6 leading-loose text-nf-text",
      },
    },
    onUpdate: () => {
      setDirty(true);
      useAppStore.getState().setEditorDirty(true);
      if (editor) {
        const wc = countWords(editor.getText());
        setWordCount(wc);
        useAppStore.getState().setActiveFileWordCount(wc);
      }
    },
  });

  // 加载文件内容（三层兼容读取：.pmd > .html > .txt）
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
    const loadPromise = pmdPath !== filePath
      ? readFile(pmdPath, projectPath).catch(() => readFile(filePath, projectPath))
      : readFile(filePath, projectPath);
    loadPromise
      .then((content) => {
        if (cancelled) return;
        // 日记模式：新建空文件时自动添加当天日期
        let finalContent = content;
        if (projectType === "diary" && diaryAutoDate && content.trim() === "") {
          const today = new Date();
          const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          finalContent = `${dateStr}\n\n`;
        }

        // 智能识别内容格式（三层兼容读取）：
        // - .pmd 格式（ProseMirror JSON）：JSON.parse 后 setContent(json)
        // - HTML 格式（旧富文本存储）：直接 setContent(html)
        // - 纯文本（旧 .txt 兼容）：按行转 HTML 段落再 setContent
        if (isPmdContent(finalContent)) {
          // .pmd 格式：解析 ProseMirror JSON 并直接注入编辑器
          try {
            const json = JSON.parse(finalContent);
            editor.commands.setContent(json);
          } catch {
            // JSON 解析失败，降级为纯文本处理
            const html = plainTextToHtml(finalContent);
            editor.commands.setContent(html);
          }
        } else if (isHtmlContent(finalContent)) {
          editor.commands.setContent(finalContent);
        } else {
          const html = plainTextToHtml(finalContent);
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
        setTimeout(() => {
          if (!cancelled && editor && !editor.isDestroyed) {
            // 搜索结果跳转定位：检查 store 中的待定位行号
            // 通过 getState 读取避免将 pendingScrollLine 加入 useEffect 依赖项
            const pendingLine = useAppStore.getState().pendingScrollLine;
            if (pendingLine !== null && pendingLine > 0) {
              // 查询第 N 个块级元素（p/h/li/blockquote/pre）模拟行定位
              // line_number 基于纯文本行，HTML 存储后按块级元素近似映射
              const blockEls = editor.view.dom.querySelectorAll(
                "p, h1, h2, h3, h4, li, blockquote, pre, tr"
              );
              const targetEl = blockEls[pendingLine - 1] as HTMLElement | undefined;
              if (targetEl) {
                targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
                // 高亮目标行 1.5 秒，提供视觉反馈（内联样式避免自定义 CSS）
                const originalBg = targetEl.style.backgroundColor;
                const originalTransition = targetEl.style.transition;
                targetEl.style.transition = "background-color 0.3s ease";
                targetEl.style.backgroundColor = "rgba(240, 144, 112, 0.2)";
                setTimeout(() => {
                  targetEl.style.backgroundColor = originalBg;
                  setTimeout(() => {
                    targetEl.style.transition = originalTransition;
                  }, 300);
                }, 1500);
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
    return () => { cancelled = true; };
  }, [filePath, editor, currentProject, t, projectType, diaryAutoDate, reloadKey]);

  // 保存文件（.pmd 持久化，ProseMirror JSON 格式；含竞态保护）
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const lastSavedContentRef = useRef("");
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
        const currentContent = pmdPath !== filePath
          ? await readFile(pmdPath, projectPath).catch(() => readFile(filePath, projectPath))
          : await readFile(filePath, projectPath);
        if (
          lastSavedContentRef.current &&
          currentContent !== lastSavedContentRef.current
        ) {
          showToast(
            "warning",
            t("editor.conflictDetected")
          );
          // 不阻塞保存，但提示用户存在冲突
        }
      } catch {
        // 文件可能不存在，跳过冲突检测
      }

      // 保存为 .pmd 格式（ProseMirror JSON），持久化完整文档结构
      // .pmd 格式相比 .html 优势：
      //   1. 保留 sceneBreak/characterMentionNode/foreshadowing 等自定义节点
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
      return true;
    } catch (e) {
      showToast("error", t("editor.saveFailed", { error: String(e) }));
      // 保存失败保留 dirty 状态以便重试
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
      // 处理排队的保存请求
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        setTimeout(() => handleSave(), 100);
      }
    }
  }, [editor, filePath, dirty, showToast, t, currentProject, snapshotEnabled, snapshotMinInterval]);

  // 导出 TXT
  const handleExportTxt = useCallback(async () => {
    if (!editor) return;
    try {
      const text = editor.getText();
      let txtName = t("editor.defaultExportName");
      if (filePath) {
        const baseName = filePath.split(/[\\/]/).pop() || "export";
        txtName = baseName.replace(/\.txt$/i, "") + ".txt";
      }
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = txtName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("success", t("editor.exported", { name: txtName }));
    } catch (e) {
      showToast("error", t("editor.exportFailed", { error: String(e) }));
    }
  }, [editor, filePath, showToast, t]);

  // 全局快捷键：Ctrl+S 保存 / Ctrl+Q 加引号 / Ctrl+F 查找 / Ctrl+H 替换 / Esc 关闭面板
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S 保存
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      // Ctrl+Q 快速加引号""
      if ((e.ctrlKey || e.metaKey) && (e.key === "q" || e.key === "Q")) {
        e.preventDefault();
        if (!editor) return;
        const { from, to } = editor.state.selection;
        const selectedText = editor.state.doc.textBetween(from, to, "\n");
        if (selectedText) {
          editor.chain().focus()
            .deleteSelection()
            .insertContent(`\u201c${selectedText}\u201d`)
            .run();
        } else {
          editor.chain().focus()
            .insertContent("\u201c\u201d")
            .setTextSelection(from + 1)
            .run();
        }
      }
      // Ctrl+F 打开查找面板
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setFindReplaceMode("find");
        setShowFindReplace(true);
      }
      // Ctrl+H 打开替换面板
      if ((e.ctrlKey || e.metaKey) && e.key === "h") {
        e.preventDefault();
        setFindReplaceMode("replace");
        setShowFindReplace(true);
      }
      // Esc 关闭查找替换面板
      if (e.key === "Escape" && showFindReplace) {
        setShowFindReplace(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, editor, showFindReplace]);

  // 自动保存: 使用用户设置的间隔（0=禁用）
  useEffect(() => {
    if (!filePath || !dirty || autoSaveInterval === 0) return;
    const timer = setTimeout(() => {
      if (!savingRef.current) {
        handleSave();
      }
    }, autoSaveInterval * 1000);
    return () => clearTimeout(timer);
  }, [filePath, dirty, handleSave, autoSaveInterval]);

  // 注册/注销编辑器保存回调
  useEffect(() => {
    if (handleSave) {
      useAppStore.getState().registerEditorSave(handleSave);
    }
    return () => {
      useAppStore.getState().registerEditorSave(null);
    };
  }, [handleSave]);

  // 卸载时销毁编辑器
  const editorRef = useRef(editor);
  editorRef.current = editor;
  useEffect(() => {
    return () => {
      editorRef.current?.destroy();
    };
  }, []);

  // 焦点常驻：关闭浮层（查找替换/快照历史）后自动恢复编辑器焦点
  // 避免写作被打断后需鼠标点击才能继续输入
  useEffect(() => {
    if (showFindReplace || showSnapshotHistory) return;
    if (!editor || editor.isDestroyed) return;
    // 延迟一帧让浮层卸载完成
    const id = window.setTimeout(() => {
      if (!editor.isDestroyed) {
        editor.commands.focus();
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [showFindReplace, showSnapshotHistory, editor]);

  // 焦点常驻：Tauri 窗口重新获焦时恢复编辑器焦点
  // 场景：用户切到其他应用查阅资料后切回，应能立即继续写作
  useEffect(() => {
    const handleWindowFocus = () => {
      if (!editor || editor.isDestroyed) return;
      // 仅在所有浮层关闭时才抢焦点，避免打断用户在弹窗中的输入
      if (showFindReplace || showSnapshotHistory) return;
      // 检查当前活动元素是否已在编辑器内，避免重复 focus 打断 IME
      const active = document.activeElement;
      if (active && editor.view.dom.contains(active)) return;
      editor.commands.focus();
    };
    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, [editor, showFindReplace, showSnapshotHistory]);

  // 焦点常驻：编辑器挂载后立即获焦
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const id = window.setTimeout(() => {
      if (!editor.isDestroyed) {
        editor.commands.focus();
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [editor]);

  // 角色悬停卡片：所有文体全量启用（p5-26 移除文体限制）
  // 依赖：p5-25 实体高亮装饰提供 data-entity-id 属性（characterId 用于 AI 操作区）
  // 交互逻辑：
  //   1. 首次悬停在某角色名上：延迟 500ms 后显示（避免误触）
  //   2. 在同一角色名内移动：仅更新卡片坐标，不重置计时器（避免闪烁）
  //   3. 从一个角色名切换到另一个：立即切换（已激活悬停态，无需再次延迟）
  //   4. 移动到非角色名文本：立即隐藏卡片
  //   5. 离开编辑器区域：立即隐藏卡片
  //  AI-Ready：优先从 data-entity-id 提取 characterId（UUID），无装饰时回退为 undefined
  useEffect(() => {
    if (!editor || characters.length === 0) {
      setHoverCard((prev) => (prev.open ? { ...prev, open: false } : prev));
      hoverShownNameRef.current = "";
      return;
    }
    const editorDom = editor.view.dom;
    // requestAnimationFrame 节流：浏览器自动调度至最佳渲染时机（约 16ms/帧），
    // 避免高频 mousemove 阻塞主线程，同时比固定 60ms 节流更流畅。
    // rAFPending 标记确保同一帧内仅执行一次检测
    let rAFPending = false;
    let lastMouseEvent: MouseEvent | null = null;

    const performHoverCheck = () => {
      rAFPending = false;
      const e = lastMouseEvent;
      if (!e) return;

      // 通过坐标获取光标位置的文本节点与偏移（Chromium 支持 caretRangeFromPoint）
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (!range) return;
      const node = range.startContainer;
      if (!node || node.nodeType !== Node.TEXT_NODE) {
        // 非文本节点（如段落边界、空白区域）：清除计时器并隐藏
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }
        setHoverCard((prev) => (prev.open ? { ...prev, open: false } : prev));
        hoverShownNameRef.current = "";
        return;
      }
      const text = node.textContent || "";
      const offset = range.startOffset;
      // 检查光标偏移是否落在某个角色名范围内
      let matchedName: string | null = null;
      for (const name of characters) {
        if (!name) continue;
        let idx = text.indexOf(name);
        while (idx !== -1) {
          if (offset >= idx && offset <= idx + name.length) {
            matchedName = name;
            break;
          }
          idx = text.indexOf(name, idx + name.length);
        }
        if (matchedName) break;
      }

      // AI-Ready：从实体高亮装饰提取 characterId（UUID）
      // 优先查询最近的 .nf-entity-character 祖先元素的 data-entity-id 属性
      // 无装饰时返回 undefined（旧版未启用实体高亮的兼容路径）
      const extractCharacterId = (): string | undefined => {
        const target = e.target as HTMLElement | null;
        if (!target) return undefined;
        const entitySpan = target.closest('[data-entity-type="character"]') as HTMLElement | null;
        if (!entitySpan) return undefined;
        const id = entitySpan.getAttribute("data-entity-id");
        return id || undefined;
      };

      if (matchedName) {
        const name = matchedName;
        if (hoverShownNameRef.current === name) {
          // 同一角色名已显示：仅更新坐标，不触碰计时器
          setHoverCard((prev) =>
            prev.open ? { ...prev, x: e.clientX, y: e.clientY } : prev
          );
        } else if (hoverShownNameRef.current !== "") {
          // 从一个角色名切换到另一个：立即切换（已激活悬停态）
          if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
          }
          hoverShownNameRef.current = name;
          setHoverCard({ open: true, x: e.clientX, y: e.clientY, name, characterId: extractCharacterId() });
        } else {
          // 首次悬停：延迟 500ms 显示，避免快速划过时误触
          if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
          }
          hoverTimerRef.current = window.setTimeout(() => {
            hoverShownNameRef.current = name;
            setHoverCard({ open: true, x: e.clientX, y: e.clientY, name, characterId: extractCharacterId() });
          }, 500);
        }
      } else {
        // 非角色名文本：清除计时器并隐藏
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }
        setHoverCard((prev) => (prev.open ? { ...prev, open: false } : prev));
        hoverShownNameRef.current = "";
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      lastMouseEvent = e;
      if (!rAFPending) {
        rAFPending = true;
        requestAnimationFrame(performHoverCheck);
      }
    };

    const handleMouseLeave = () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      setHoverCard((prev) => (prev.open ? { ...prev, open: false } : prev));
      hoverShownNameRef.current = "";
    };

    editorDom.addEventListener("mousemove", handleMouseMove);
    editorDom.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      editorDom.removeEventListener("mousemove", handleMouseMove);
      editorDom.removeEventListener("mouseleave", handleMouseLeave);
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    };
  }, [editor, characters]);

  if (!filePath) {
    return (
      <div className="flex-1 flex items-center justify-center bg-nf-bg">
        <div className="text-center space-y-3" role="status">
          <p className="text-sm text-nf-text-tertiary">
            {t("editor.selectFile")}
          </p>
          <p className="text-xs text-nf-text-tertiary/60">
            {t("editor.commandPaletteHint").split("Ctrl+K").length === 2 ? (
              <>
                {t("editor.commandPaletteHint").split("Ctrl+K")[0]}
                <kbd className="px-1 py-0.5 bg-nf-bg-hover border border-nf-border-light text-[10px] font-mono text-nf-text-secondary">Ctrl+K</kbd>
                {t("editor.commandPaletteHint").split("Ctrl+K")[1]}
              </>
            ) : t("editor.commandPaletteHint")}
          </p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-nf-bg" role="alert">
        <div className="text-center text-red-400 text-sm">{loadError}</div>
      </div>
    );
  }

  return (
    <div
      className={`flex-1 flex flex-col bg-nf-bg overflow-hidden ${focusMode ? "fandex-focus-mode" : ""}`}
      role="region"
      aria-label={`${t("editor.editor")} - ${filePath ? filePath.split(/[\\/]/).pop() : ""}`}
    >
      <EditorToolbar
        editor={editor}
        wordCount={wordCount}
        dirty={dirty}
        saving={saving}
        onSave={handleSave}
        onExportTxt={handleExportTxt}
        focusMode={focusMode}
        sessionWords={session.sessionWords}
        sessionDuration={session.sessionDuration}
        wpm={session.wpm}
        wordTarget={session.wordTarget}
        progress={session.progress}
        sessionPaused={session.paused}
        sessionStartedAt={session.startedAt}
        onToggleSessionPause={session.togglePause}
        onSetSessionTarget={session.updateWordTarget}
        onResetSession={session.resetSession}
        showSnapshotHistory={showSnapshotHistory}
        onToggleSnapshotHistory={() => setShowSnapshotHistory((prev) => !prev)}
        showFindReplace={showFindReplace}
        onToggleFindReplace={() => setShowFindReplace((prev) => !prev)}
      />

      {isScript && characters.length > 0 && (
        <div className="fandex-admonition fandex-admonition-note px-4 py-1.5 border-b border-nf-border-light text-xs text-nf-text-tertiary flex items-center gap-2">
          <span className="text-fandex-primary font-medium">{t("editor.scriptMode")}</span>
          <span>·</span>
          <span>
            {t("editor.charRosterHint", { count: characters.length })}
          </span>
        </div>
      )}

      {isEssay && (
        <div className="fandex-admonition fandex-admonition-tip px-4 py-1.5 border-b border-nf-border-light text-xs text-nf-text-tertiary flex items-center gap-2">
          <span className="text-fandex-secondary font-medium">{t("editor.essayMode")}</span>
          <span>·</span>
          <span>{t("editor.essayHint")}</span>
        </div>
      )}

      {isDialogue && characters.length > 0 && (
        <div className="fandex-admonition fandex-admonition-note px-4 py-1.5 border-b border-nf-border-light text-xs text-nf-text-tertiary flex items-center gap-2">
          <span className="text-fandex-primary font-medium">{t("editor.dialogueMode")}</span>
          <span>·</span>
          <span>
            {t("editor.dialogueAutoFillHint")}
          </span>
          <span>·</span>
          <span>
            {t("editor.charRosterHint", { count: characters.length })}
          </span>
        </div>
      )}

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto relative">
          <EditorContent editor={editor} />
          {/* 选中文字时浮起的格式化工具栏：行内格式移到此处的 BubbleMenu，减少主工具栏按钮数量 */}
          {editor && <EditorBubbleMenu editor={editor} />}
          {/* 查找替换面板：浮于编辑区顶部，Ctrl+F / Ctrl+H 触发 */}
          {showFindReplace && editor && (
            <FindReplace
              editor={editor}
              mode={findReplaceMode}
              onClose={() => setShowFindReplace(false)}
              onModeChange={setFindReplaceMode}
            />
          )}
        </div>
        {showSnapshotHistory && filePath && currentProject?.path && (
          <SnapshotHistory
            filePath={filePath}
            projectPath={currentProject.path}
            currentContent={editor ? JSON.stringify(editor.getJSON()) : ""}
            onClose={() => setShowSnapshotHistory(false)}
            onRestored={() => setReloadKey((n) => n + 1)}
          />
        )}
      </div>

      {/* 角色悬停卡片：鼠标悬停在正文角色名上时浮动显示角色摘要 */}
      <CharacterHoverCard
        open={hoverCard.open}
        x={hoverCard.x}
        y={hoverCard.y}
        characterName={hoverCard.name}
        projectPath={currentProject?.path || ""}
        characterId={hoverCard.characterId}
      />
    </div>
  );
}
