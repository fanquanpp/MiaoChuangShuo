// 编辑器工具栏组件（纯文本/WYSIWYG 模式）
//
// 功能概述：
// 提供 TipTap 编辑器的精简格式化工具栏，仅包含加粗、斜体基础富文本按钮。
// 移除 Markdown 相关按钮（标题/列表/引用）。
// 保留诗歌/歌词排版、撤销/重做、保存状态指示。
// 采用 FANDEX 直角按钮 + 毛玻璃风格。
//
// 模块职责：
// 1. ToolbarButton: 通用工具栏按钮
// 2. Divider: 分隔符
// 3. EditorToolbar: 完整的工具栏组件

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
}: EditorToolbarProps) {
  const { t } = useI18n();

  const dispatchEditorEvent = (key: string, ctrlKey: boolean, shiftKey: boolean) => {
    const event = new KeyboardEvent("keydown", {
      key,
      ctrlKey,
      shiftKey,
      bubbles: true,
    });
    document.querySelector(".ProseMirror")?.dispatchEvent(event);
  };

  // 快速加引号：用「」包裹选中文本，无选中则在引号间放置光标
  const handleQuickQuote = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, "\n");
    if (selectedText) {
      editor.chain().focus()
        .deleteSelection()
        .insertContent(`「${selectedText}」`)
        .run();
    } else {
      editor.chain().focus()
        .insertContent("「」")
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
              onClick={() => dispatchEditorEvent("P", true, true)}
              active={false}
              title={t("editor.poetryFormat")}
            >
              <Pilcrow className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => dispatchEditorEvent("L", true, true)}
              active={false}
              title={t("editor.lyricsFormat")}
            >
              <Music className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              active={editor?.isActive("blockquote") || false}
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
          </div>
        </>
      )}

      {/* 右侧状态区 */}
      <div className="ml-auto flex items-center gap-3 text-xs text-nf-text-tertiary">
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
