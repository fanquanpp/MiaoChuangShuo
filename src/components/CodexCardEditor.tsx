// 设定卡片编辑器组件
//
// 功能概述：
// 提供设定卡片的富文本编辑能力，包含元数据表单与 TipTap 正文编辑器。
// 加载 .pmd 文件内容（ProseMirror JSON），保存时调用 useCodexStore.persistCardUpdate。
// 集成于 CodexPanel 右侧详情区，通过「查看/编辑」模式切换调用。
//
// 模块职责：
// 1. 渲染元数据表单：name / aliases / summary / tags
// 2. 渲染 TipTap 编辑器：加载 ProseMirror JSON，支持基础富文本格式
// 3. 保存时调用 persistCardUpdate 持久化到 .pmd 文件并同步 Store
// 4. 取消时丢弃更改并回调 onCancel
//
// 设计说明：
// - 扩展子集精简，不含 NovelEditor 专属扩展（IndentParagraph / EntityHighlight 等）
// - 注册 CharacterMentionNode 以兼容可能存在的提及节点（防止解析失败）
// - 元数据表单字段与 CodexMeta 结构对应

import { useEffect, useState, useCallback, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Extensions } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import Strike from "@tiptap/extension-strike";
import Code from "@tiptap/extension-code";
import CodeBlock from "@tiptap/extension-code-block";
import Blockquote from "@tiptap/extension-blockquote";
import Heading from "@tiptap/extension-heading";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import ListItem from "@tiptap/extension-list-item";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Save,
  X,
  Loader2,
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  Strikethrough,
  Code as CodeIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link2,
  Highlighter,
} from "lucide-react";
import { useCodexStore } from "../lib/stores/useCodexStore";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import { CharacterMentionNode } from "../lib/characterMention";
import type { CodexCard, CodexEntityType } from "../lib/codexApi";
import { CODEX_TYPE_LABELS } from "../lib/codexApi";

interface CodexCardEditorProps {
  /** 待编辑的卡片对象 */
  card: CodexCard;
  /** 项目根路径（用于持久化） */
  projectPath: string;
  /** 取消编辑回调 */
  onCancel: () => void;
  /** 保存成功回调 */
  onSaved?: () => void;
}

/**
 * 设定卡片编辑器组件
 * 输入:
 *   card 待编辑卡片
 *   projectPath 项目根路径
 *   onCancel 取消回调
 *   onSaved 保存成功回调
 * 输出: JSX 元数据表单 + TipTap 编辑器 + 操作按钮
 * 流程:
 *   1. 挂载时加载卡片 content 到 TipTap 编辑器
 *   2. 用户编辑元数据表单与正文
 *   3. 保存时调用 persistCardUpdate 持久化
 *   4. 取消时丢弃更改
 */
export default function CodexCardEditor({
  card,
  projectPath,
  onCancel,
  onSaved,
}: CodexCardEditorProps) {
  const { showToast } = useToast();
  const { t } = useI18n();
  const persistCardUpdate = useCodexStore((s) => s.persistCardUpdate);

  // 元数据表单状态
  const [name, setName] = useState(card.name);
  const [aliasesText, setAliasesText] = useState(card.aliases.join(", "));
  const [summary, setSummary] = useState(card.summary);
  const [tagsText, setTagsText] = useState(card.tags.join(", "));
  const [saving, setSaving] = useState(false);

  // TipTap 扩展配置（精简子集 + CharacterMentionNode 兼容）
  const extensions: Extensions = useMemo(() => {
    return [
      Document,
      Paragraph,
      Text,
      Bold,
      Italic,
      Underline,
      Strike,
      Code,
      CodeBlock,
      Blockquote,
      Heading.configure({ levels: [1, 2, 3] }),
      BulletList,
      OrderedList,
      ListItem,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: "nf-link", rel: "noopener noreferrer" },
      }),
      Highlight.configure({ multicolor: true }),
      History,
      Placeholder.configure({ placeholder: t("codex.editorPlaceholder") }),
      // 注册 CharacterMentionNode 以兼容可能存在的提及节点（防止解析失败）
      CharacterMentionNode.configure({
        HTMLAttributes: { class: "nf-character-mention" },
        editable: false,
      }),
    ];
  }, [t]);

  // 创建编辑器实例
  const editor = useEditor({
    extensions,
    content: "",
    editorProps: {
      attributes: {
        class: "codex-editor-content prose prose-invert max-w-none focus:outline-none px-6 py-4 min-h-[300px]",
      },
    },
  });

  // 加载卡片正文到编辑器（card.content 为 ProseMirror JSON 字符串）
  useEffect(() => {
    if (!editor || !card.content) return;
    try {
      const docJson = JSON.parse(card.content);
      editor.commands.setContent(docJson);
    } catch {
      // content 非合法 JSON，降级为纯文本插入
      editor.commands.setContent(`<p>${card.content}</p>`);
    }
  }, [editor, card.content]);

  // 工具栏按钮：切换格式
  const toggleBold = useCallback(() => editor?.chain().focus().toggleBold().run(), [editor]);
  const toggleItalic = useCallback(() => editor?.chain().focus().toggleItalic().run(), [editor]);
  const toggleUnderline = useCallback(() => editor?.chain().focus().toggleUnderline().run(), [editor]);
  const toggleStrike = useCallback(() => editor?.chain().focus().toggleStrike().run(), [editor]);
  const toggleCode = useCallback(() => editor?.chain().focus().toggleCode().run(), [editor]);
  const toggleHeading = useCallback(
    (level: 1 | 2 | 3) => editor?.chain().focus().toggleHeading({ level }).run(),
    [editor]
  );
  const toggleBulletList = useCallback(() => editor?.chain().focus().toggleBulletList().run(), [editor]);
  const toggleOrderedList = useCallback(() => editor?.chain().focus().toggleOrderedList().run(), [editor]);
  const toggleBlockquote = useCallback(() => editor?.chain().focus().toggleBlockquote().run(), [editor]);
  const toggleHighlight = useCallback(() => editor?.chain().focus().toggleHighlight().run(), [editor]);
  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("链接 URL", previousUrl);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }, [editor]);

  // 保存卡片：调用 persistCardUpdate 持久化元数据与正文
  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showToast("warning", t("codex.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      // 解析别名与标签（按逗号分隔）
      const aliases = aliasesText
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const tags = tagsText
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      // 获取编辑器 ProseMirror JSON 并序列化为字符串
      const content = editor ? JSON.stringify(editor.getJSON()) : "";
      // 调用 persistCardUpdate 持久化（含后端调用 + 内存更新 + 改名联动）
      await persistCardUpdate(
        card.id,
        {
          name: trimmedName,
          aliases,
          summary: summary.trim(),
          tags,
        },
        projectPath,
        content
      );
      showToast("success", t("codex.saveSuccess", { name: trimmedName }));
      onSaved?.();
    } catch (e) {
      showToast("error", t("codex.saveFailed", { error: String(e) }));
    } finally {
      setSaving(false);
    }
  }, [name, aliasesText, tagsText, summary, editor, card.id, persistCardUpdate, projectPath, showToast, t, onSaved]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 头部：标题 + 操作按钮 */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-nf-border-light flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[10px] px-1.5 py-0.5 bg-fandex-primary/10 text-fandex-primary font-medium">
            {CODEX_TYPE_LABELS[card.cardType as CodexEntityType]}
          </span>
          <span className="text-xs text-nf-text-tertiary">{t("codex.editing")}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="nf-tool-btn h-8 px-4 text-sm flex items-center gap-1.5 border border-nf-border-light text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
          >
            <X className="w-3.5 h-3.5" />
            {t("codex.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="nf-tool-btn h-8 px-4 text-sm flex items-center gap-1.5 bg-fandex-primary hover:bg-fandex-primary-hover font-medium text-nf-text-inverse transition duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? t("app.saving") : t("codex.save")}
          </button>
        </div>
      </div>

      {/* 元数据表单 */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-nf-border-light space-y-3">
        {/* 名称 */}
        <div>
          <label className="block text-xs text-nf-text-tertiary mb-1.5">
            {t("codex.entityName")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
          />
        </div>
        {/* 别名 */}
        <div>
          <label className="block text-xs text-nf-text-tertiary mb-1.5">
            {t("codex.aliasesLabel")}
          </label>
          <input
            type="text"
            value={aliasesText}
            onChange={(e) => setAliasesText(e.target.value)}
            placeholder={t("codex.aliasesPlaceholder")}
            className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
          />
        </div>
        {/* 简介 */}
        <div>
          <label className="block text-xs text-nf-text-tertiary mb-1.5">
            {t("codex.summaryLabel")}
          </label>
          <input
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={t("codex.summaryPlaceholder")}
            className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
          />
        </div>
        {/* 标签 */}
        <div>
          <label className="block text-xs text-nf-text-tertiary mb-1.5">
            {t("codex.tagsLabel")}
          </label>
          <input
            type="text"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder={t("codex.tagsPlaceholder")}
            className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
          />
        </div>
      </div>

      {/* 富文本工具栏 */}
      <div className="flex-shrink-0 px-6 py-2 border-b border-nf-border-light flex items-center gap-1 flex-wrap">
        <button onClick={toggleBold} title={t("editor.bold")} className="nf-tool-btn p-1.5 text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover transition duration-fast">
          <BoldIcon className="w-3.5 h-3.5" />
        </button>
        <button onClick={toggleItalic} title={t("editor.italic")} className="nf-tool-btn p-1.5 text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover transition duration-fast">
          <ItalicIcon className="w-3.5 h-3.5" />
        </button>
        <button onClick={toggleUnderline} title={t("editor.underline")} className="nf-tool-btn p-1.5 text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover transition duration-fast">
          <UnderlineIcon className="w-3.5 h-3.5" />
        </button>
        <button onClick={toggleStrike} title={t("editor.strike")} className="nf-tool-btn p-1.5 text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover transition duration-fast">
          <Strikethrough className="w-3.5 h-3.5" />
        </button>
        <button onClick={toggleCode} title={t("editor.code")} className="nf-tool-btn p-1.5 text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover transition duration-fast">
          <CodeIcon className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-nf-border-light mx-1" />
        <button onClick={() => toggleHeading(1)} title="H1" className="nf-tool-btn p-1.5 text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover transition duration-fast">
          <Heading1 className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => toggleHeading(2)} title="H2" className="nf-tool-btn p-1.5 text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover transition duration-fast">
          <Heading2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => toggleHeading(3)} title="H3" className="nf-tool-btn p-1.5 text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover transition duration-fast">
          <Heading3 className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-nf-border-light mx-1" />
        <button onClick={toggleBulletList} title={t("editor.bulletList")} className="nf-tool-btn p-1.5 text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover transition duration-fast">
          <List className="w-3.5 h-3.5" />
        </button>
        <button onClick={toggleOrderedList} title={t("editor.orderedList")} className="nf-tool-btn p-1.5 text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover transition duration-fast">
          <ListOrdered className="w-3.5 h-3.5" />
        </button>
        <button onClick={toggleBlockquote} title={t("editor.blockquote")} className="nf-tool-btn p-1.5 text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover transition duration-fast">
          <Quote className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-nf-border-light mx-1" />
        <button onClick={setLink} title={t("editor.link")} className="nf-tool-btn p-1.5 text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover transition duration-fast">
          <Link2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={toggleHighlight} title={t("editor.highlight")} className="nf-tool-btn p-1.5 text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover transition duration-fast">
          <Highlighter className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* TipTap 编辑器内容区 */}
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
