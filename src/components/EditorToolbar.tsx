// 编辑器工具栏组件（纯文本/WYSIWYG 模式）
//
// 功能概述：
// 提供 TipTap 编辑器的精简格式化工具栏，仅包含加粗、斜体基础富文本按钮。
// 移除 Markdown 相关按钮（标题/列表/引用）。
// 保留诗歌/歌词排版、撤销/重做、保存状态指示。
// 采用 FANDEX 直角按钮 + 毛玻璃风格。
// 集成写作会话统计（本次字数、时长、WPM、目标进度）与专注模式快捷切换。
//
// 模块职责：
// 1. ToolbarButton: 通用工具栏按钮
// 2. Divider: 分隔符
// 3. SessionStats: 写作会话统计小组件
// 4. EditorToolbar: 完整的工具栏组件

import type { Editor } from "@tiptap/core";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code as CodeIcon,
  Quote,
  Undo,
  Redo,
  Save,
  Loader2,
  Download,
  Music,
  Pilcrow,
  ListTree,
  Square,
  Eye,
  Pause,
  Play,
  Target,
  History,
} from "lucide-react";
import { useI18n } from "../lib/i18n";

// 工具栏按钮属性
interface ToolbarButtonProps {
  onClick: () => void;
  active: boolean;
  title: string;
  children: React.ReactNode;
}

// 工具栏按钮 - FANDEX 直角风格（增强版）
export function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`relative p-1.5 transition-all duration-base ease-fandex border group ${
        active
          ? "bg-fandex-primary/10 text-fandex-primary border-fandex-primary/40"
          : "text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-hover border-transparent hover:border-nf-border-light"
      }`}
    >
      <span className="transition-transform duration-fast group-hover:scale-110 group-active:scale-95 block">
        {children}
      </span>
      {/* 激活态底部指示线 */}
      {active && (
        <span className="absolute bottom-0 left-1/4 right-1/4 h-[2px] bg-fandex-primary" />
      )}
    </button>
  );
}

// 分隔符
export function Divider() {
  return <div className="w-px h-4 bg-nf-border-light/60 mx-1.5" />;
}

// 会话统计属性
interface SessionStatsProps {
  /** 本次会话净增字数 */
  sessionWords: number;
  /** 会话时长（秒） */
  sessionDuration: number;
  /** 每分钟字数 */
  wpm: number;
  /** 字数目标（0=未设定） */
  wordTarget: number;
  /** 目标完成进度（0-1） */
  progress: number;
  /** 是否暂停 */
  paused: boolean;
  /** 暂停/恢复回调 */
  onTogglePause: () => void;
}

/**
 * 格式化时长为 mm:ss 或 hh:mm:ss
 * 输入: seconds 秒数
 * 输出: 格式化字符串
 */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

// 写作会话统计小组件
// 显示本次会话字数、时长、WPM 与目标进度条
function SessionStats({
  sessionWords,
  sessionDuration,
  wpm,
  wordTarget,
  progress,
  paused,
  onTogglePause,
}: SessionStatsProps) {
  // 净增字数着色：正数绿色，负数红色，零灰色
  const wordsColor =
    sessionWords > 0
      ? "text-fandex-secondary"
      : sessionWords < 0
        ? "text-fandex-tertiary"
        : "text-nf-text-tertiary";

  return (
    <div className="flex items-center gap-2 text-xs">
      {/* 暂停/恢复按钮 */}
      <button
        onClick={onTogglePause}
        title={paused ? "恢复会话" : "暂停会话"}
        className={`p-1 transition-all duration-base ease-fandex border ${
          paused
            ? "bg-fandex-tertiary/10 text-fandex-tertiary border-fandex-tertiary/40"
            : "text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-hover border-transparent hover:border-nf-border-light"
        }`}
      >
        {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
      </button>
      {/* 会话字数 */}
      <span className={`tabular-nums font-medium ${wordsColor}`}>
        {sessionWords > 0 ? "+" : ""}{sessionWords}
      </span>
      {/* 会话时长 */}
      <span className="tabular-nums text-nf-text-tertiary">
        {formatDuration(sessionDuration)}
      </span>
      {/* WPM */}
      {wpm > 0 && (
        <span className="tabular-nums text-nf-text-tertiary">
          {wpm} <span className="text-nf-text-tertiary/60">wpm</span>
        </span>
      )}
      {/* 目标进度条 */}
      {wordTarget > 0 && (
        <div className="flex items-center gap-1.5" title={`目标 ${wordTarget} 字 / 已完成 ${Math.round(progress * 100)}%`}>
          <Target className="w-3 h-3 text-fandex-primary" />
          <div className="w-16 h-1.5 bg-nf-bg-hover border border-nf-border-light/40 overflow-hidden">
            <div
              className="h-full bg-fandex-primary transition-all duration-base ease-fandex"
              style={{ width: `${Math.min(100, progress * 100)}%` }}
            />
          </div>
          <span className="tabular-nums text-nf-text-tertiary text-[10px]">
            {Math.round(progress * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}

// 工具栏属性
interface EditorToolbarProps {
  editor: Editor | null;
  wordCount: number;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onExportTxt: () => void;
  focusMode?: boolean;
  showOutline?: boolean;
  onToggleOutline?: () => void;
  // 写作会话统计
  sessionWords: number;
  sessionDuration: number;
  wpm: number;
  wordTarget: number;
  progress: number;
  sessionPaused: boolean;
  onToggleSessionPause: () => void;
  // 专注模式快捷切换
  typewriterMode: boolean;
  focusDim: boolean;
  onToggleTypewriter: () => void;
  onToggleFocusDim: () => void;
  // 版本快照历史
  showSnapshotHistory?: boolean;
  onToggleSnapshotHistory?: () => void;
}

// 编辑器工具栏组件（纯文本模式 + 格式扩展）
export default function EditorToolbar({
  editor,
  wordCount,
  dirty,
  saving,
  onSave,
  onExportTxt,
  focusMode = false,
  showOutline = false,
  onToggleOutline,
  sessionWords,
  sessionDuration,
  wpm,
  wordTarget,
  progress,
  sessionPaused,
  onToggleSessionPause,
  typewriterMode,
  focusDim,
  onToggleTypewriter,
  onToggleFocusDim,
  showSnapshotHistory = false,
  onToggleSnapshotHistory,
}: EditorToolbarProps) {
  const { t } = useI18n();

  // 诗歌排版：切换居中样式
  const handlePoetryToggle = () => {
    if (!editor) return;
    editor.chain().focus().togglePoetry().run();
  };

  // 歌词排版：切换歌词样式
  const handleLyricsToggle = () => {
    if (!editor) return;
    editor.chain().focus().toggleLyrics().run();
  };

  // 检测当前段落是否为诗歌样式
  const isPoetryActive = (): boolean => {
    if (!editor) return false;
    const { $from } = editor.state.selection;
    const para = $from.parent;
    return para.attrs["data-poetry"] === "true";
  };

  // 检测当前段落是否为歌词样式
  const isLyricsActive = (): boolean => {
    if (!editor) return false;
    const { $from } = editor.state.selection;
    const para = $from.parent;
    return para.attrs["data-lyrics"] === "true";
  };

  // 快速加引号：用""包裹选中文本，无选中则在引号间放置光标
  const handleQuickQuote = () => {
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
  };

  // 引用格式：用「」包裹选中文本
  const handleBlockQuote = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, "\n");
    if (selectedText) {
      editor.chain().focus()
        .deleteSelection()
        .insertContent(`\u300c${selectedText}\u300d`)
        .run();
    } else {
      editor.chain().focus()
        .insertContent("\u300c\u300d")
        .setTextSelection(from + 1)
        .run();
    }
  };

  return (
    <div className="fandex-nav-blur flex items-center gap-1 px-4 py-2 border-b border-nf-border-light">
      {/* 聚焦模式下隐藏格式化按钮，仅保留状态和保存 */}
      {!focusMode && (
        <>
          {/* 基础格式组 */}
          <div className="flex items-center gap-0.5 bg-nf-bg-card/50 px-1 py-0.5 border border-nf-border-light/40">
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleBold().run()}
              active={editor?.isActive("bold") || false}
              title={t("editor.bold")}
            >
              <Bold className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              active={editor?.isActive("italic") || false}
              title={t("editor.italic")}
            >
              <Italic className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleUnderline().run()}
              active={editor?.isActive("underline") || false}
              title={t("editor.underline")}
            >
              <UnderlineIcon className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleStrike().run()}
              active={editor?.isActive("strike") || false}
              title={t("editor.strikethrough")}
            >
              <Strikethrough className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleCode().run()}
              active={editor?.isActive("code") || false}
              title={t("editor.inlineCode")}
            >
              <CodeIcon className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={handleQuickQuote}
              active={false}
              title={t("editor.quickQuote")}
            >
              <Quote className="w-4 h-4" />
            </ToolbarButton>
          </div>
          <Divider />
          {/* 排版格式组 */}
          <div className="flex items-center gap-0.5 bg-nf-bg-card/50 px-1 py-0.5 border border-nf-border-light/40">
            <ToolbarButton
              onClick={handlePoetryToggle}
              active={isPoetryActive()}
              title={t("editor.poetryFormat")}
            >
              <Pilcrow className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={handleLyricsToggle}
              active={isLyricsActive()}
              title={t("editor.lyricsFormat")}
            >
              <Music className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={handleBlockQuote}
              active={false}
              title={t("editor.blockquote")}
            >
              <Quote className="w-4 h-4 rotate-180" />
            </ToolbarButton>
          </div>
          <Divider />
          {/* 操作历史组 + 大纲切换 */}
          <div className="flex items-center gap-0.5 bg-nf-bg-card/50 px-1 py-0.5 border border-nf-border-light/40">
            <ToolbarButton
              onClick={() => editor?.chain().focus().undo().run()}
              active={false}
              title={t("editor.undo")}
            >
              <Undo className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().redo().run()}
              active={false}
              title={t("editor.redo")}
            >
              <Redo className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => onToggleOutline?.()}
              active={showOutline}
              title={t("outline.title")}
            >
              <ListTree className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => onToggleSnapshotHistory?.()}
              active={showSnapshotHistory}
              title={t("snapshot.toggleHistory")}
            >
              <History className="w-4 h-4" />
            </ToolbarButton>
          </div>
        </>
      )}

      {/* 右侧状态区 */}
      <div className="ml-auto flex items-center gap-3 text-xs text-nf-text-tertiary">
        {/* 写作会话统计 */}
        <SessionStats
          sessionWords={sessionWords}
          sessionDuration={sessionDuration}
          wpm={wpm}
          wordTarget={wordTarget}
          progress={progress}
          paused={sessionPaused}
          onTogglePause={onToggleSessionPause}
        />
        <Divider />
        {/* 专注模式快捷切换 */}
        {!focusMode && (
          <div className="flex items-center gap-0.5">
            <ToolbarButton
              onClick={onToggleTypewriter}
              active={typewriterMode}
              title={t("editor.typewriterMode") || "打字机模式"}
            >
              <Square className="w-3.5 h-3.5" />
            </ToolbarButton>
            <ToolbarButton
              onClick={onToggleFocusDim}
              active={focusDim}
              title={t("editor.focusDim") || "焦点暗化"}
            >
              <Eye className="w-3.5 h-3.5" />
            </ToolbarButton>
          </div>
        )}
        <span className="tabular-nums">{t("editor.wordCount", { count: wordCount })}</span>
        {/* 保存状态指示器 */}
        {dirty && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 bg-fandex-tertiary/10 text-fandex-tertiary border border-fandex-tertiary/20">
            <span className="w-1.5 h-1.5 bg-fandex-tertiary animate-pulse" />
            {t("editor.unsaved")}
          </span>
        )}
        {!focusMode && (
          <button
            onClick={onExportTxt}
            title={t("editor.exportTxt")}
            className="flex items-center gap-1 px-2 py-1 text-fandex-secondary border border-fandex-secondary/30 hover:bg-fandex-secondary/10 hover:border-fandex-secondary/50 transition-all duration-base ease-fandex"
          >
            <Download className="w-3.5 h-3.5" />
            TXT
          </button>
        )}
        <button
          onClick={onSave}
          disabled={!dirty || saving}
          className={`flex items-center gap-1 px-2.5 py-1 transition-all duration-base ease-fandex disabled:opacity-30 disabled:cursor-not-allowed ${
            dirty
              ? 'bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse shadow-sm hover:shadow-md'
              : 'bg-fandex-primary/40 text-nf-text-inverse/60'
          }`}
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {t("app.save")}
        </button>
      </div>
    </div>
  );
}
