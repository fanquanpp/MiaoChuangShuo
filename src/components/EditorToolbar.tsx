// 编辑器工具栏容器组件（Office 级富文本模式）
//
// 功能概述：
// 作为容器组合 editor-toolbar 目录下的子组件，构建完整富文本工具栏。
// 子组件职责：ToolbarButton / Divider / HeadingDropdown / ColorPicker / TableMenu / SessionStats / FontSizeAdjuster。
// 容器仅负责 props 分发、引号快捷操作、诗歌/歌词切换，以及顶栏状态区与保存/导出按钮。
// 采用 FANDEX 直角按钮 + 毛玻璃风格，集成写作会话统计与专注模式快捷切换。

import type { Editor } from "@tiptap/core";
import {
  Undo,
  Redo,
  Save,
  Loader2,
  Download,
  Music,
  Pilcrow,
  Minus,
  Search,
  History,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Sparkles,
} from "lucide-react";
import { useI18n } from "../lib/i18n";
import { ToolbarButton } from "./editor-toolbar/ToolbarButton";
import { Divider } from "./editor-toolbar/Divider";
import { HeadingDropdown } from "./editor-toolbar/HeadingDropdown";
import { ColorPicker } from "./editor-toolbar/ColorPicker";
import { TableMenu } from "./editor-toolbar/TableMenu";
import { SessionStats } from "./editor-toolbar/SessionStats";
import { FontSizeAdjuster } from "./editor-toolbar/FontSizeAdjuster";

// 工具栏容器属性
interface EditorToolbarProps {
  editor: Editor | null;
  wordCount: number;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onExportTxt: () => void;
  focusMode?: boolean;
  // 写作会话统计
  sessionWords: number;
  sessionDuration: number;
  wpm: number;
  wordTarget: number;
  progress: number;
  sessionPaused: boolean;
  sessionStartedAt?: string;
  onToggleSessionPause: () => void;
  onSetSessionTarget: (target: number) => void;
  onResetSession?: () => void;
  // 版本快照历史
  showSnapshotHistory?: boolean;
  onToggleSnapshotHistory?: () => void;
  // 查找替换面板
  showFindReplace?: boolean;
  onToggleFindReplace?: () => void;
  // AI 助手面板 (AI-3.1)
  showAiPanel?: boolean;
  onToggleAiPanel?: () => void;
}

// 编辑器工具栏容器组件（组合子组件，不再持有子组件定义）
export default function EditorToolbar({
  editor, wordCount, dirty, saving, onSave, onExportTxt, focusMode = false,
  sessionWords, sessionDuration, wpm, wordTarget, progress,
  sessionPaused, sessionStartedAt, onToggleSessionPause, onSetSessionTarget, onResetSession,
  showSnapshotHistory = false, onToggleSnapshotHistory,
  showFindReplace = false, onToggleFindReplace,
  showAiPanel = false, onToggleAiPanel,
}: EditorToolbarProps) {
  const { t } = useI18n();

  // 包裹选中文本为成对引号：有选中则包裹，无选中则在引号间放置光标
  const wrapSelection = (left: string, right: string): void => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, "\n");
    if (selectedText) {
      editor.chain().focus().deleteSelection().insertContent(`${left}${selectedText}${right}`).run();
    } else {
      editor.chain().focus().insertContent(`${left}${right}`).setTextSelection(from + 1).run();
    }
  };

  // 诗歌排版：切换选中文本的诗歌样式（行内 Mark）
  const handlePoetryToggle = () => editor?.chain().focus().togglePoetry().run();
  // 歌词排版：切换选中文本的歌词样式（行内 Mark）
  const handleLyricsToggle = () => editor?.chain().focus().toggleLyrics().run();
  // 检测诗歌/歌词 Mark 是否激活
  const isPoetryActive = () => editor?.isActive("poetryMark") ?? false;
  const isLyricsActive = () => editor?.isActive("lyricsMark") ?? false;

  return (
    <div className="fandex-nav-blur flex flex-col border-b border-nf-border-light relative">
      {/* 顶部细渐变光带:增加视觉层次 */}
      <div className="absolute top-0 left-0 right-0 h-[1px] pointer-events-none" style={{
        background: 'linear-gradient(90deg, transparent, rgba(124, 158, 255, 0.25), rgba(78, 230, 176, 0.18), transparent)',
      }} />
      {/* 顶栏：会话统计 + 状态区 + 保存（固定一行，永不溢出） */}
      <div className="flex items-center gap-2 px-4 py-1.5 min-h-0">
        <SessionStats
          sessionWords={sessionWords} sessionDuration={sessionDuration} wpm={wpm}
          wordTarget={wordTarget} progress={progress} paused={sessionPaused}
          startedAt={sessionStartedAt} onTogglePause={onToggleSessionPause}
          onSetTarget={onSetSessionTarget} onResetSession={onResetSession}
        />
        <div className="ml-auto flex items-center gap-2 text-xs text-nf-text-tertiary flex-shrink-0">
          <span className="tabular-nums h-8 px-2 flex items-center bg-nf-bg-card/40 border border-nf-border-light/30 text-nf-text-secondary">
            {t("editor.wordCount", { count: wordCount })}
          </span>
          {dirty && (
            <span className="flex items-center gap-1 h-8 px-2 bg-fandex-tertiary/10 text-fandex-tertiary border border-fandex-tertiary/20">
              <span className="w-1.5 h-1.5 bg-fandex-tertiary animate-pulse" />
              {t("editor.unsaved")}
            </span>
          )}
          {!focusMode && (
            <button type="button" onClick={onExportTxt} onMouseDown={(e) => e.preventDefault()}
              title={t("editor.exportTxt")} tabIndex={-1}
              className="nf-tool-btn flex items-center gap-1 h-8 px-2 text-xs text-fandex-secondary border border-fandex-secondary/30 hover:bg-fandex-secondary/10 hover:border-fandex-secondary/50 transition-colors duration-fast ease-fandex">
              <Download className="w-4 h-4" />TXT
            </button>
          )}
          <button type="button" onClick={onSave} onMouseDown={(e) => e.preventDefault()}
            disabled={!dirty || saving} title={t("app.save")} tabIndex={-1}
            className={`nf-tool-btn flex items-center gap-1.5 h-8 px-3 text-xs ease-fandex transition-colors duration-fast disabled:opacity-30 disabled:cursor-not-allowed ${
              dirty ? 'bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse' : 'bg-fandex-primary/40 text-nf-text-inverse/60'
            }`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t("app.save")}
          </button>
        </div>
      </div>

      {/* 格式栏：分组容器 + flex-wrap 自动换行（无滚动条）
          行内格式已移至 EditorBubbleMenu，此处保留段落级操作 + 颜色/表格入口。 */}
      {!focusMode && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-1.5 border-t border-nf-border-light/50">
          {/* 标题段落组 */}
          <div className="flex items-center gap-0.5 h-8 px-1 bg-nf-bg-card/40 border border-nf-border-light/30">
            <HeadingDropdown editor={editor} />
            <ToolbarButton icon={<Minus className="w-4 h-4" />} onClick={() => editor?.chain().focus().setHorizontalRule().run()} isActive={false} title={t("editor.horizontalRuleHint")} />
            <ToolbarButton icon={<span className="text-[13px] leading-none font-serif text-fandex-primary">{"\u201c"}{"\u201d"}</span>} onClick={() => wrapSelection("\u201c", "\u201d")} isActive={false} title={t("editor.doubleQuote")} />
            <ToolbarButton icon={<span className="text-[13px] leading-none font-serif text-fandex-secondary">{"\u2018"}{"\u2019"}</span>} onClick={() => wrapSelection("\u2018", "\u2019")} isActive={false} title={t("editor.singleQuote")} />
            <ToolbarButton icon={<span className="text-[13px] leading-none font-serif text-fandex-tertiary">{"\u300c"}{"\u300d"}</span>} onClick={() => wrapSelection("\u300c", "\u300d")} isActive={false} title={t("editor.cornerQuote")} />
          </div>
          <Divider />
          {/* 对齐组 */}
          <div className="flex items-center gap-0.5 h-8 px-1 bg-nf-bg-card/40 border border-nf-border-light/30">
            <ToolbarButton icon={<AlignLeft className="w-4 h-4" />} onClick={() => editor?.chain().focus().setTextAlign("left").run()} isActive={editor?.isActive({ textAlign: "left" }) ?? false} title={t("editor.alignLeftHint")} />
            <ToolbarButton icon={<AlignCenter className="w-4 h-4" />} onClick={() => editor?.chain().focus().setTextAlign("center").run()} isActive={editor?.isActive({ textAlign: "center" }) ?? false} title={t("editor.alignCenterHint")} />
            <ToolbarButton icon={<AlignRight className="w-4 h-4" />} onClick={() => editor?.chain().focus().setTextAlign("right").run()} isActive={editor?.isActive({ textAlign: "right" }) ?? false} title={t("editor.alignRightHint")} />
            <ToolbarButton icon={<AlignJustify className="w-4 h-4" />} onClick={() => editor?.chain().focus().setTextAlign("justify").run()} isActive={editor?.isActive({ textAlign: "justify" }) ?? false} title={t("editor.alignJustifyHint")} />
          </div>
          <Divider />
          {/* 插入组：诗歌 / 歌词 / 颜色 / 表格 */}
          <div className="flex items-center gap-0.5 h-8 px-1 bg-nf-bg-card/40 border border-nf-border-light/30">
            <ToolbarButton icon={<Pilcrow className="w-4 h-4" />} onClick={handlePoetryToggle} isActive={isPoetryActive()} title={t("editor.poetryFormatHint")} />
            <ToolbarButton icon={<Music className="w-4 h-4" />} onClick={handleLyricsToggle} isActive={isLyricsActive()} title={t("editor.lyricsFormatHint")} />
            <ColorPicker editor={editor} />
            <TableMenu editor={editor} />
          </div>
          <Divider />
          {/* 操作历史组 + 快照 + 查找替换 */}
          <div className="flex items-center gap-0.5 h-8 px-1 bg-nf-bg-card/40 border border-nf-border-light/30">
            <ToolbarButton icon={<Undo className="w-4 h-4" />} onClick={() => editor?.chain().focus().undo().run()} isActive={false} title={t("editor.undoHint")} />
            <ToolbarButton icon={<Redo className="w-4 h-4" />} onClick={() => editor?.chain().focus().redo().run()} isActive={false} title={t("editor.redoHint")} />
            <ToolbarButton icon={<History className="w-4 h-4" />} onClick={() => onToggleSnapshotHistory?.()} isActive={showSnapshotHistory} title={t("snapshot.toggleHistoryHint")} />
            <ToolbarButton icon={<Search className="w-4 h-4" />} onClick={() => onToggleFindReplace?.()} isActive={showFindReplace} title={t("editor.findReplaceHint")} />
          </div>
          <Divider />
          {/* 字号调整组 */}
          <FontSizeAdjuster />
          <Divider />
          {/* AI 助手组 (AI-3.1): 悬停仅色彩变化, 激活态渐变 */}
          <button type="button" onClick={() => onToggleAiPanel?.()} onMouseDown={(e) => e.preventDefault()}
            title={t("ai.panel.toggleHint")} tabIndex={-1}
            className={`nf-tool-btn h-8 px-3 flex items-center gap-1.5 text-xs font-medium transition-colors duration-fast ease-fandex border ${
              showAiPanel
                ? "text-nf-text-inverse bg-gradient-to-r from-fandex-primary to-fandex-secondary border-fandex-primary"
                : "text-fandex-primary bg-fandex-primary/5 border-fandex-primary/30 hover:text-fandex-secondary hover:border-fandex-secondary/50"
            }`}>
            <Sparkles className="w-4 h-4" />
            {t("ai.panel.toolbarButton")}
          </button>
        </div>
      )}
    </div>
  );
}
