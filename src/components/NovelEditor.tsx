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
import { createPortal } from "react-dom";
import { readFile, writeFile, createSnapshot, updateFileIndex } from "../lib/api";
import { useAppStore } from "../lib/store";
import { useCodexStore } from "../lib/stores/useCodexStore";
import { useSettingsStore } from "../lib/settingsStore";
import { usePreferencesStore } from "../lib/preferencesSlice";
import { CharacterMention, CharacterMentionNode } from "../lib/characterMention";
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
import { isScriptType, isEssayType } from "../lib/projectType";
import { useWritingSession } from "../hooks/useWritingSession";
import EditorToolbar from "./EditorToolbar";
import EditorBubbleMenu from "./EditorBubbleMenu";
import SnapshotHistory from "./SnapshotHistory";
import CharacterHoverCard from "./CharacterHoverCard";
import FindReplace from "./FindReplace";
import AiAssistantPanel from "./AiAssistantPanel";
import { BookOpen, Edit3, Copy } from "lucide-react";

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
function toPmdPath(filePath: string): string {
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
  // 角色名列表：从 useCodexStore 的 cards 派生（SSOT），过滤 cardType === 'character'
  // 替代旧版 extractNames（扫描 .txt 首行的三轨制之一），统一数据源避免不一致
  const codexCards = useCodexStore((s) => s.cards);
  const codexLoaded = useCodexStore((s) => s.loaded);
  const loadAllCodex = useCodexStore((s) => s.loadAll);
  const characters = useMemo<string[]>(() => {
    const names: string[] = [];
    for (const card of codexCards.values()) {
      if (card.cardType === "character" && card.name) {
        names.push(card.name);
      }
    }
    return names;
  }, [codexCards]);
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
  // Sprint 3 任务 3.5：characterMention 右键菜单状态
  // 在正文中的角色提及节点上右键时弹出浮动菜单（查看设定/编辑设定/复制名称）
  // characterId 为 null 表示旧版无 UUID 的提及节点（仅可复制名称）
  const [mentionContextMenu, setMentionContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    characterId: string | null;
    characterName: string;
  }>({ open: false, x: 0, y: 0, characterId: null, characterName: "" });

  const projectType = currentProject?.meta?.type || "standard";
  // 文体标识保留用于 UI 层条件渲染（如横幅提示文案差异）
  // 扩展注册不再依赖文体守卫，所有扩展全量注册，由全局开关控制行为
  // 通过统一兼容层判定文体族，消除分散的类型字符串比较
  const isScript = isScriptType(projectType);
  const isDialogue = projectType === "dialogue";
  // 兼容旧代码：日记体仍保留 isEssay 标识用于日期自动填充等场景
  const isEssay = isEssayType(projectType);
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
  // AI 助手面板可见性（Ctrl+Shift+A 或工具栏按钮触发）
  const [showAiPanel, setShowAiPanel] = useState(false);
  // AI 待发送指令 (AI-3.4 右键菜单触发: 存储预设指令, 由 AiAssistantPanel 消费后清空)
  const [pendingAiInstruction, setPendingAiInstruction] = useState<string | null>(null);
  // Sprint 6: AI 任务上下文 (与 pendingAiInstruction 同步设置, 由 AiAssistantPanel 消费后清空)
  // pendingAiCharacterId - 角色 UUID (dialogue / consistencyCheck 任务需要)
  // pendingAiSelectedText - 选中文本 (consistencyCheck 任务需要)
  // pendingAiTaskType - 任务类型 (默认 continuation, 外部触发特定任务时切换)
  const [pendingAiCharacterId, setPendingAiCharacterId] = useState<string | null>(null);
  const [pendingAiSelectedText, setPendingAiSelectedText] = useState<string | null>(null);
  const [pendingAiTaskType, setPendingAiTaskType] = useState<
    "continuation" | "dialogue" | "consistencyCheck" | "plotReview" | "outlineGeneration" | null
  >(null);
  // 查找替换初始模式：'find' 仅查找 / 'replace' 查找并替换
  const [findReplaceMode, setFindReplaceMode] = useState<"find" | "replace">("find");
  // 文件重载触发器：恢复快照后递增以强制重新加载文件内容
  const [reloadKey, setReloadKey] = useState(0);
  // 上次自动创建快照的时间戳（毫秒），用于控制最小间隔，避免高频保存产生重复快照
  const lastSnapshotTimeRef = useRef(0);

  // 写作会话追踪：记录本次会话字数、时长、WPM
  const session = useWritingSession(wordCount, filePath);

  // 项目切换时触发 useCodexStore.loadAll（若未加载），确保角色名数据源就绪
  // 角色名列表由 codexCards 派生（见上方 useMemo），此处仅负责数据加载触发
  // 避免与 CodexPanel 重复加载：loaded 标记防止重复调用
  useEffect(() => {
    if (!currentProject) return;
    if (codexLoaded) return;
    let cancelled = false;
    loadAllCodex(currentProject.path).catch((err) => {
      if (!cancelled) {
        showToast("error", t("editor.codexLoadFailed", { error: String(err) }));
      }
    });
    return () => { cancelled = true; };
  }, [currentProject, codexLoaded, loadAllCodex, showToast, t]);

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

    // 角色提及 inline Node（Sprint 1 任务 1.5）
    // 注册 CharacterMentionNode 后，编辑器才能插入 characterMentionNode 节点
    // 节点存储 characterId（UUID）+ name，与设定库 CodexMeta.id 关联
    // 设定库重命名时通过 updateCharacterMentionName 命令批量更新正文中的节点
    // HTMLAttributes 添加 nf-character-mention 类名供样式与事件委托使用
    exts.push(
      CharacterMentionNode.configure({
        HTMLAttributes: { class: "nf-character-mention" },
        editable: false,
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

  // Sprint 2 任务 2.4：订阅 useCodexStore.renameQueue，设定库改名时联动更新正文中的 characterMentionNode
  // 当 CodexCardEditor 保存改名后，renameQueue 推入条目，此 effect 遍历调用 updateCharacterMentionName
  // 同步正文内所有提及节点的 name 属性，处理完成后清空队列并标记为脏内容触发自动保存
  const renameQueue = useCodexStore((s) => s.renameQueue);
  const consumeRenameQueue = useCodexStore((s) => s.consumeRenameQueue);
  useEffect(() => {
    // 编辑器未就绪、已销毁或队列为空时跳过
    if (!editor || editor.isDestroyed || renameQueue.length === 0) return;
    // 遍历队列，对每个改名条目调用 updateCharacterMentionName 同步正文提及节点
    for (const entry of renameQueue) {
      editor.commands.updateCharacterMentionName(entry.cardId, entry.newName);
    }
    // 处理完成后清空队列，避免重复处理
    consumeRenameQueue();
    // 标记为脏内容，触发自动保存以持久化改名后的正文
    setDirty(true);
    useAppStore.getState().setEditorDirty(true);
  }, [renameQueue, editor, consumeRenameQueue]);

  // Sprint 3 任务 3.3：characterMentionNode 双击跳转到 CodexPanel 对应卡片
  // 交互设计：
  //   - 单击：选中节点（ProseMirror 默认行为，atom 节点单击即选中）
  //   - 双击：提取 characterId，切换到设定库分类并设置 pendingSelectCardId
  //   - CodexPanel 订阅 pendingSelectCardId 后自动选中对应卡片并清空信号量
  // 容错：characterId 为空时（旧版无 UUID 的提及节点）仅提示用户，不跳转
  const setPendingSelectCardId = useCodexStore((s) => s.setPendingSelectCardId);
  useEffect(() => {
    if (!editor) return;
    const editorDom = editor.view.dom;
    /**
     * 双击事件处理：检测是否落在 characterMentionNode 上
     * 输入: e 鼠标双击事件
     * 流程:
     *   1. 通过 closest 查找最近的 .nf-character-mention 祖先元素
     *   2. 提取 data-character-id 属性
     *   3. 切换到 codex 分类并设置 pendingSelectCardId
     */
    const handleDoubleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const mentionEl = target.closest<HTMLElement>(".nf-character-mention");
      if (!mentionEl) return;
      const characterId = mentionEl.getAttribute("data-character-id");
      if (!characterId) {
        // 旧版无 UUID 的提及节点：提示用户该节点未关联设定库
        showToast("warning", t("characterMention.noLinkedEntity"));
        return;
      }
      // 切换到设定库分类并设置待选中卡片 ID
      useAppStore.getState().setActiveCategory("codex");
      setPendingSelectCardId(characterId);
    };
    editorDom.addEventListener("dblclick", handleDoubleClick);
    return () => {
      editorDom.removeEventListener("dblclick", handleDoubleClick);
    };
  }, [editor, setPendingSelectCardId, showToast, t]);

  // Sprint 3 任务 3.5：characterMentionNode 右键菜单
  // 交互设计：
  //   - 在 .nf-character-mention 元素上右键时阻止浏览器默认菜单，弹出应用菜单
  //   - 菜单选项：查看设定 / 编辑设定 / 复制名称
  //   - 查看与编辑跳转：切换到设定库分类 + 设置 pendingSelectCardId（编辑额外设置 pendingEditMode）
  //   - 复制名称：写入剪贴板并提示
  //   - 旧版无 UUID 节点：仅可复制名称，查看/编辑按钮禁用并提示
  const setPendingEditMode = useCodexStore((s) => s.setPendingEditMode);
  useEffect(() => {
    if (!editor) return;
    const editorDom = editor.view.dom;
    /**
     * 上下文菜单事件处理：检测是否落在 characterMentionNode 上
     * 输入: e 鼠标右键事件
     * 流程:
     *   1. 通过 closest 查找最近的 .nf-character-mention 祖先元素
     *   2. 阻止浏览器默认菜单并弹出应用菜单
     *   3. 提取 characterId（可能为 null）与角色名文本
     */
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const mentionEl = target.closest<HTMLElement>(".nf-character-mention");
      if (!mentionEl) return;
      e.preventDefault();
      const characterId = mentionEl.getAttribute("data-character-id");
      const characterName = mentionEl.textContent || "";
      setMentionContextMenu({
        open: true,
        x: e.clientX,
        y: e.clientY,
        characterId: characterId || null,
        characterName,
      });
    };
    editorDom.addEventListener("contextmenu", handleContextMenu);
    return () => {
      editorDom.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [editor]);

  // 右键菜单关闭逻辑：点击外部 / Esc 键 / 滚动 / 窗口失焦时关闭
  useEffect(() => {
    if (!mentionContextMenu.open) return;
    const closeMenu = () =>
      setMentionContextMenu((prev) => (prev.open ? { ...prev, open: false } : prev));
    // 延迟绑定 click 事件，避免触发右键的同一交互周期立即关闭菜单
    const clickTimer = window.setTimeout(() => {
      window.addEventListener("click", closeMenu);
    }, 0);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    const handleContext = (e: MouseEvent) => {
      // 在菜单外右键：关闭当前菜单，让浏览器默认菜单生效
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".nf-mention-context-menu")) {
        closeMenu();
      } else {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("contextmenu", handleContext, true);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.clearTimeout(clickTimer);
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("contextmenu", handleContext, true);
      window.removeEventListener("blur", closeMenu);
    };
  }, [mentionContextMenu.open]);

  /**
   * 右键菜单动作：查看设定
   * 输入: characterId 角色 UUID
   * 流程: 切换到设定库分类 + 设置 pendingSelectCardId（CodexPanel 订阅后选中卡片）
   * 容错: characterId 为空时提示未关联实体
   */
  const handleMentionViewInCodex = useCallback(
    (characterId: string | null) => {
      if (!characterId) {
        showToast("warning", t("characterMention.noLinkedEntity"));
        return;
      }
      useAppStore.getState().setActiveCategory("codex");
      setPendingSelectCardId(characterId);
      setMentionContextMenu((prev) => ({ ...prev, open: false }));
    },
    [setPendingSelectCardId, showToast, t]
  );

  /**
   * 右键菜单动作：编辑设定
   * 输入: characterId 角色 UUID
   * 流程: 查看流程 + 设置 pendingEditMode=true（CodexPanel 订阅后自动进入编辑模式）
   */
  const handleMentionEditInCodex = useCallback(
    (characterId: string | null) => {
      if (!characterId) {
        showToast("warning", t("characterMention.noLinkedEntity"));
        return;
      }
      useAppStore.getState().setActiveCategory("codex");
      setPendingSelectCardId(characterId);
      setPendingEditMode(true);
      setMentionContextMenu((prev) => ({ ...prev, open: false }));
    },
    [setPendingSelectCardId, setPendingEditMode, showToast, t]
  );

  /**
   * 右键菜单动作：复制角色名到剪贴板
   * 输入: characterName 角色名文本
   * 流程: 写入剪贴板 + 提示成功/失败
   */
  const handleMentionCopyName = useCallback(
    async (characterName: string) => {
      try {
        await navigator.clipboard.writeText(characterName);
        showToast("success", t("characterMention.nameCopied"));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast("error", t("characterMention.copyFailed", { error: msg }));
      }
      setMentionContextMenu((prev) => ({ ...prev, open: false }));
    },
    [showToast, t]
  );

  // 保存文件（.pmd 持久化，ProseMirror JSON 格式；含竞态保护）
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const lastSavedContentRef = useRef("");
  // Sprint 4 任务 4.3：增量索引更新防抖定时器引用
  // 设计依据：自动保存间隔可能很短，防抖 500ms 避免频繁索引更新
  const indexUpdateTimerRef = useRef<number | null>(null);
  /**
   * 调度增量索引更新（防抖 500ms，静默执行）
   * 输入:
   *   projectPath 项目根路径（绝对路径）
   *   absFilePath 文件绝对路径（.txt 或 .pmd）
   * 流程:
   *   1. 清除已有定时器，重置防抖计时
   *   2. 500ms 后计算相对路径（去除项目根前缀，兼容 / 与 \ 分隔符）
   *   3. 转换为 .pmd 相对路径（与持久化格式一致，text_extractor 支持 .pmd 提取）
   *   4. 调用 updateFileIndex 增量更新索引，失败仅 console.error 不干扰用户
   */
  const scheduleIndexUpdate = useCallback(
    (projectPath: string, absFilePath: string) => {
      if (indexUpdateTimerRef.current !== null) {
        window.clearTimeout(indexUpdateTimerRef.current);
      }
      indexUpdateTimerRef.current = window.setTimeout(() => {
        indexUpdateTimerRef.current = null;
        // 计算相对路径（兼容 / 与 \ 分隔符）
        const prefix = projectPath.endsWith("/") || projectPath.endsWith("\\")
          ? projectPath
          : projectPath + "/";
        const relPath = absFilePath.startsWith(prefix)
          ? absFilePath.slice(prefix.length)
          : absFilePath;
        // 索引 .pmd 版本（与持久化格式一致）
        const pmdRelPath = toPmdPath(relPath);
        updateFileIndex(projectPath, pmdRelPath).catch((err) => {
          console.error("增量更新索引失败:", err);
        });
      }, 500);
    },
    []
  );
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
      // Sprint 4 任务 4.3：保存成功后增量更新 Tantivy 索引（防抖静默执行）
      // 设计依据：索引与正文同步，保证全局搜索与 AI RAG 检索结果时效性
      if (currentProject?.path && filePath) {
        scheduleIndexUpdate(currentProject.path, filePath);
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

  /**
   * AI 预设指令处理 (AI-3.4 右键菜单触发 / Sprint 6 任务类型联动)
   * 输入: command 预设指令类型, selectedText 选中文本
   * 输出: void (组装指令并打开 AI 助手面板)
   * 流程:
   *   1. 根据 command 类型选择预设指令模板
   *   2. 将选中文本填入模板生成完整 instruction
   *   3. Sprint 6: characterCheck 命令切换为 consistencyCheck 任务类型,
   *      并从选区遍历 characterMentionNode 提取 characterId
   *   4. 设置 pendingAiInstruction 与任务上下文, 打开 AI 面板
   *   5. AiAssistantPanel 消费 pendingInstruction 后自动发送
   */
  const handleAiCommand = useCallback(
    (command: "polish" | "expand" | "condense" | "characterCheck", selectedText: string) => {
      const templates: Record<string, string> = {
        polish: "请润色以下文本，保持原意，提升文学性与节奏感：\n\n",
        expand: "请基于以下文本进行扩写，增加细节描写、环境烘托与心理刻画：\n\n",
        condense: "请精简以下文本，保留核心信息与关键情节，删除冗余表述：\n\n",
        characterCheck:
          "请检查以下文本中角色的行为与对话是否符合设定库中的角色设定，逐条分析是否存在 OOC（Out Of Character）情况，并给出修正建议：\n\n",
      };
      const instruction = (templates[command] || "") + selectedText;
      setPendingAiInstruction(instruction);

      // Sprint 6: characterCheck 切换为 consistencyCheck 任务, 尝试从选区提取 characterId
      if (command === "characterCheck") {
        setPendingAiTaskType("consistencyCheck");
        setPendingAiSelectedText(selectedText);
        // 遍历选区内的 characterMentionNode, 提取首个 characterId
        let extractedCharacterId: string | null = null;
        if (editor && !editor.isDestroyed) {
          const { state } = editor;
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node) => {
            if (extractedCharacterId) return false;
            if (node.type.name === "characterMentionNode") {
              const cid = node.attrs.characterId as string | undefined;
              if (cid) {
                extractedCharacterId = cid;
                return false;
              }
            }
            return true;
          });
        }
        setPendingAiCharacterId(extractedCharacterId);
      } else {
        // polish/expand/condense 保持 continuation 任务
        setPendingAiTaskType("continuation");
        setPendingAiSelectedText(null);
        setPendingAiCharacterId(null);
      }
      setShowAiPanel(true);
    },
    [editor]
  );

  /**
   * 角色悬停卡片 AI 操作处理（Sprint 3 任务 3.2 / Sprint 6 任务类型联动）
   * 输入:
   *   action - 操作类型（"summarize-state" | "generate-dialogue"）
   *   characterId - 角色实体 UUID（可能为 undefined）
   *   characterName - 角色显示名
   * 输出: void（组装指令并打开 AI 助手面板）
   * 流程:
   *   1. 根据 action 类型选择预设指令模板
   *   2. 将角色名填入模板，附加 characterId 供 AI 上下文检索
   *   3. Sprint 6: generate-dialogue 切换为 dialogue 任务类型并设置 characterId
   *   4. 设置 pendingAiInstruction 与任务上下文, 打开 AI 面板
   *   5. AiAssistantPanel 消费 pendingInstruction 后自动发送
   * 容错: characterId 为 undefined 时仅按名称匹配，不阻塞 AI 调用
   */
  const handleCharacterAiAction = useCallback(
    (action: string, characterId: string | undefined, characterName: string) => {
      const templates: Record<string, string> = {
        "summarize-state":
          `请基于设定库中角色「${characterName}` +
          (characterId ? `（UUID: ${characterId}）` : "") +
          `」的档案，结合当前正文场景，总结该角色在故事中此刻的心理状态、动机与潜在行为倾向，输出一段 150-300 字的状态描摹供后续创作参考：\n\n`,
        "generate-dialogue":
          `请基于设定库中角色「${characterName}` +
          (characterId ? `（UUID: ${characterId}）` : "") +
          `」的档案与说话风格，结合当前正文场景，生成 3-5 句符合该角色性格的对白，保持语气与措辞一致：\n\n`,
      };
      const instruction = templates[action] || "";
      if (!instruction) return;
      setPendingAiInstruction(instruction);

      // Sprint 6: generate-dialogue 切换为 dialogue 任务, 注入 characterId
      if (action === "generate-dialogue") {
        setPendingAiTaskType("dialogue");
        setPendingAiCharacterId(characterId || null);
      } else {
        // summarize-state 保持 continuation 任务
        setPendingAiTaskType("continuation");
        setPendingAiCharacterId(null);
      }
      setPendingAiSelectedText(null);
      setShowAiPanel(true);
    },
    []
  );

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
      // Ctrl+Shift+A 打开 AI 助手面板 (AI-3.1)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        setShowAiPanel((prev) => !prev);
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
        showAiPanel={showAiPanel}
        onToggleAiPanel={() => setShowAiPanel((prev) => !prev)}
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
          {editor && <EditorBubbleMenu editor={editor} onAiCommand={handleAiCommand} />}
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
        onAiAction={handleCharacterAiAction}
      />

      {/* Sprint 3 任务 3.5：characterMention 右键菜单（Portal 至 body 避免 overflow 裁切） */}
      {mentionContextMenu.open &&
        createPortal(
          <div
            role="menu"
            className="nf-mention-context-menu fixed z-[300] min-w-[140px] py-1 bg-nf-bg-secondary border border-nf-border-light shadow-lg rounded-md text-xs"
            style={{
              left: Math.min(mentionContextMenu.x, window.innerWidth - 160),
              top: Math.min(mentionContextMenu.y, window.innerHeight - 120),
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              type="button"
              role="menuitem"
              disabled={!mentionContextMenu.characterId}
              onClick={() =>
                handleMentionViewInCodex(mentionContextMenu.characterId)
              }
              className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-nf-text-primary hover:bg-nf-bg-hover disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5 text-fandex-primary" />
              {t("characterMention.viewInCodex")}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!mentionContextMenu.characterId}
              onClick={() =>
                handleMentionEditInCodex(mentionContextMenu.characterId)
              }
              className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-nf-text-primary hover:bg-nf-bg-hover disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5 text-fandex-secondary" />
              {t("characterMention.editInCodex")}
            </button>
            <div className="my-1 border-t border-nf-border-light" />
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                handleMentionCopyName(mentionContextMenu.characterName)
              }
              className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-nf-text-primary hover:bg-nf-bg-hover transition-colors"
            >
              <Copy className="w-3.5 h-3.5 text-fandex-tertiary" />
              {t("characterMention.copyName")}
            </button>
          </div>,
          document.body
        )}

      {/* AI 助手侧边栏面板 (AI-3.1): 工具栏按钮或 Ctrl+Shift+A 触发 */}
      <AiAssistantPanel
        open={showAiPanel}
        onClose={() => setShowAiPanel(false)}
        editor={editor}
        projectPath={currentProject?.path || ""}
        filePath={filePath}
        pendingInstruction={pendingAiInstruction}
        onPendingInstructionConsumed={() => setPendingAiInstruction(null)}
        pendingCharacterId={pendingAiCharacterId}
        pendingSelectedText={pendingAiSelectedText}
        pendingTaskType={pendingAiTaskType}
        onPendingTaskConsumed={() => {
          setPendingAiCharacterId(null);
          setPendingAiSelectedText(null);
          setPendingAiTaskType(null);
        }}
      />
    </div>
  );
}
