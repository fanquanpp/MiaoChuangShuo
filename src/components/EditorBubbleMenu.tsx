// 编辑器 BubbleMenu 组件 - 选中文字时浮起的格式化工具栏
//
// 功能概述：
// 当用户在编辑器中选中文字时，自动在选区附近浮起一个紧凑的格式化工具栏。
// 参考 Notion / Typora / 番茄小说作家助手的选中浮起交互设计。
// 包含最常用的行内格式：加粗/斜体/下划线/删除线/行内代码/字体颜色/高亮/链接。
// 通过将行内格式移到 BubbleMenu，大幅减少主工具栏按钮数量，解决溢出问题。
//
// 模块职责：
// 1. 监听编辑器选区变化，选区非空时显示浮起工具栏
// 2. 提供行内格式化操作（加粗/斜体/下划线/删除线/代码）
// 3. 提供颜色操作（字体颜色/高亮颜色）
// 4. 提供链接插入操作
// 5. 所有按钮 tabIndex=-1，防止 Tab 焦点跳转

import type { Editor } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/react";
import { useState } from "react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code as CodeIcon,
  Link as LinkIcon,
  Palette,
  Highlighter,
} from "lucide-react";
import { useI18n } from "../lib/i18n";
import ConfirmDialog from "./ConfirmDialog";

// BubbleMenu 属性接口
interface EditorBubbleMenuProps {
  editor: Editor;
}

// 预设字体颜色（精简版，避免 BubbleMenu 过宽）
const TEXT_COLORS = [
  "#F09070", // FANDEX tertiary
  "#6EA8FE", // FANDEX primary
  "#55EFC4", // FANDEX secondary
  "#FFFFFF", // 白
  "#FF6B6B", // 红
  "#FFD93D", // 黄
  "#6BCB77", // 绿
  "#A0A0A0", // 灰
];

// 预设高亮颜色
const HIGHLIGHT_COLORS = [
  "#FFD93D", // 黄
  "#FF6B6B", // 红
  "#6BCB77", // 绿
  "#6EA8FE", // 蓝
  "#C77DFF", // 紫
  "#FFB347", // 橙
];

/**
 * 选中文字时浮起的格式化工具栏
 * 输入: editor TipTap 编辑器实例
 * 输出: BubbleMenu 组件，选区非空时自动显示
 * 流程:
 *   1. BubbleMenu 组件监听编辑器选区变化
 *   2. 选区非空时浮起工具栏，定位在选区上方
 *   3. 提供行内格式按钮，点击即应用格式
 *   4. 颜色按钮展开预设色板
 */
export default function EditorBubbleMenu({ editor }: EditorBubbleMenuProps) {
  const { t } = useI18n();
  // 链接输入对话框状态
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  /**
   * 打开链接输入对话框
   * 输入: 无
   * 输出: 无（仅切换对话框状态）
   */
  const handleInsertLink = () => {
    setLinkDialogOpen(true);
  };

  /**
   * 确认链接输入:应用链接到编辑器选区
   * 输入: url 用户输入的链接地址
   * 输出: 无（直接修改编辑器内容）
   */
  const handleLinkConfirm = (url?: string) => {
    if (url && url.trim()) {
      editor.chain().focus().setLink({ href: url.trim() }).run();
    }
    setLinkDialogOpen(false);
  };

  return (
    <>
    <BubbleMenu
      editor={editor}
      tippyOptions={{
        duration: 150,
        placement: "top",
        // 防止 BubbleMenu 超出视口边界
        appendTo: "parent",
      }}
    >
      <div
        className="nf-glass-panel flex items-center gap-0.5 bg-nf-bg-card border border-nf-border-light shadow-lg px-1.5 py-1"
        // 防止点击 BubbleMenu 按钮时编辑器失焦
        onMouseDown={(e) => e.preventDefault()}
      >
        {/* 行内格式组：加粗/斜体/下划线/删除线/代码 */}
        <BubbleButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title={t("editor.bold")}
        >
          <Bold className="w-3.5 h-3.5" />
        </BubbleButton>
        <BubbleButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title={t("editor.italic")}
        >
          <Italic className="w-3.5 h-3.5" />
        </BubbleButton>
        <BubbleButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          title={t("editor.underline")}
        >
          <UnderlineIcon className="w-3.5 h-3.5" />
        </BubbleButton>
        <BubbleButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
          title={t("editor.strikethrough")}
        >
          <Strikethrough className="w-3.5 h-3.5" />
        </BubbleButton>
        <BubbleButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive("code")}
          title={t("editor.inlineCode")}
        >
          <CodeIcon className="w-3.5 h-3.5" />
        </BubbleButton>

        {/* 分隔线 */}
        <div className="w-px h-4 bg-nf-border-light/60 mx-0.5" />

        {/* 字体颜色：悬浮展开预设色板 */}
        <div className="relative group">
          <button
            type="button"
            tabIndex={-1}
            title={t("editor.textColor")}
            className="flex items-center gap-0.5 px-1.5 py-1 text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover transition-colors duration-fast"
          >
            <Palette className="w-3.5 h-3.5" />
            <span
              className="w-2.5 h-0.5 rounded-full"
              style={{ backgroundColor: editor.getAttributes("textStyle").color || "#FFFFFF" }}
            />
          </button>
          {/* 悬浮色板 */}
          <div className="nf-glass-panel absolute top-full left-0 mt-1 hidden group-hover:flex flex-wrap gap-1 bg-nf-bg-card border border-nf-border-light shadow-lg p-1.5 z-50 w-[120px]">
            {TEXT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                tabIndex={-1}
                title={color}
                onClick={() => editor.chain().focus().setColor(color).run()}
                className="w-4 h-4 border border-nf-border-light/40 hover:scale-110 transition-transform duration-fast"
                style={{ backgroundColor: color }}
              />
            ))}
            {/* 清除颜色 */}
            <button
              type="button"
              tabIndex={-1}
              title={t("editor.clearColor")}
              onClick={() => editor.chain().focus().unsetColor().run()}
              className="w-4 h-4 border border-nf-border-light/40 hover:scale-110 transition-transform duration-fast flex items-center justify-center text-[8px] text-nf-text-tertiary bg-nf-bg-hover"
            >
              ×
            </button>
          </div>
        </div>

        {/* 高亮颜色：悬浮展开预设色板 */}
        <div className="relative group">
          <button
            type="button"
            tabIndex={-1}
            title={t("editor.highlight")}
            className="flex items-center gap-0.5 px-1.5 py-1 text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover transition-colors duration-fast"
          >
            <Highlighter className="w-3.5 h-3.5" />
            <span
              className="w-2.5 h-0.5 rounded-full"
              style={{ backgroundColor: editor.getAttributes("highlight").color || "transparent" }}
            />
          </button>
          {/* 悬浮色板 */}
          <div className="nf-glass-panel absolute top-full left-0 mt-1 hidden group-hover:flex flex-wrap gap-1 bg-nf-bg-card border border-nf-border-light shadow-lg p-1.5 z-50 w-[120px]">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                tabIndex={-1}
                title={color}
                onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
                className="w-4 h-4 border border-nf-border-light/40 hover:scale-110 transition-transform duration-fast"
                style={{ backgroundColor: color }}
              />
            ))}
            {/* 清除高亮 */}
            <button
              type="button"
              tabIndex={-1}
              title={t("editor.clearHighlight")}
              onClick={() => editor.chain().focus().unsetHighlight().run()}
              className="w-4 h-4 border border-nf-border-light/40 hover:scale-110 transition-transform duration-fast flex items-center justify-center text-[8px] text-nf-text-tertiary bg-nf-bg-hover"
            >
              ×
            </button>
          </div>
        </div>

        {/* 分隔线 */}
        <div className="w-px h-4 bg-nf-border-light/60 mx-0.5" />

        {/* 链接 */}
        <BubbleButton
          onClick={handleInsertLink}
          active={editor.isActive("link")}
          title={t("editor.link")}
        >
          <LinkIcon className="w-3.5 h-3.5" />
        </BubbleButton>
      </div>
    </BubbleMenu>

    {/* 链接输入对话框:替代原生 window.prompt,统一视觉风格 */}
    <ConfirmDialog
      open={linkDialogOpen}
      title={t("editor.link")}
      message={t("editor.linkUrlPrompt")}
      type="prompt"
      placeholder="https://"
      defaultValue="https://"
      confirmLabel={t("app.confirm")}
      onConfirm={handleLinkConfirm}
      onCancel={() => setLinkDialogOpen(false)}
    />
    </>
  );
}

// BubbleMenu 按钮属性接口
interface BubbleButtonProps {
  onClick: () => void;
  active: boolean;
  title: string;
  children: React.ReactNode;
}

/**
 * BubbleMenu 内部按钮 - 紧凑型格式化按钮
 * 关键设计：tabIndex={-1} 防止 Tab 键焦点跳转，保证写作时焦点常驻编辑器
 */
function BubbleButton({ onClick, active, title, children }: BubbleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={-1}
      title={title}
      className={`flex items-center justify-center w-6 h-6 transition-colors duration-fast ${
        active
          ? "bg-fandex-primary/15 text-fandex-primary"
          : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
      }`}
    >
      {children}
    </button>
  );
}
