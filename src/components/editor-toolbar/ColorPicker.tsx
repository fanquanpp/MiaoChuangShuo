// 颜色选择器组件
//
// 功能概述：
// 提供文字颜色与背景高亮颜色的预设色板及自定义颜色输入。
// 通过 Dropdown 容器实现点击外部 / Esc 关闭，调用 TipTap 的 setColor / toggleHighlight 命令。
//
// 模块职责：
// 仅负责颜色选择与编辑器命令调用，不持有编辑器实例的所有权（通过 props 接收）。

import type { Editor } from "@tiptap/core";
import { Palette, Highlighter, Type } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { Dropdown } from "./Dropdown";

// 颜色选择器属性
interface ColorPickerProps {
  /** TipTap 编辑器实例（可能为 null） */
  editor: Editor | null;
}

// 预设字体颜色（FANDEX 三色 + 中性色 + 语义色）
const TEXT_COLORS: string[] = [
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
const HIGHLIGHT_COLORS: string[] = [
  "#FFD93D", // 黄
  "#FF6B6B", // 红
  "#6BCB77", // 绿
  "#6EA8FE", // 蓝
  "#C77DFF", // 紫
  "#FFB347", // 橙
];

/**
 * 颜色选择器（字体颜色 + 高亮颜色）
 *
 * 输入参数:
 *   - editor: TipTap 编辑器实例，null 时组件不渲染
 * 返回值: JSX 颜色选择下拉菜单，editor 为 null 时返回 null
 * 核心流程:
 *   1. 渲染字体颜色预设色板与自定义颜色输入
 *   2. 点击预设色调用 editor.chain().setColor(color)
 *   3. 渲染高亮颜色预设色板与自定义颜色输入
 *   4. 点击预设高亮色调用 editor.chain().toggleHighlight({ color })
 *   5. 提供清除颜色 / 清除高亮按钮
 */
export function ColorPicker({ editor }: ColorPickerProps) {
  const { t } = useI18n();
  // 编辑器未就绪时不渲染
  if (!editor) return null;

  // 当前字体颜色（从 textStyle 扩展属性读取）
  const currentTextColor: string =
    editor.getAttributes("textStyle").color || "#FFFFFF";
  // 当前高亮颜色（从 highlight 扩展属性读取）
  const currentHighlightColor: string =
    editor.getAttributes("highlight").color || "transparent";

  return (
    <Dropdown
      trigger={
        <span className="flex items-center gap-1">
          <Palette className="w-4 h-4" />
          <span
            className="w-2.5 h-0.5 rounded-full"
            style={{ backgroundColor: currentTextColor }}
          />
        </span>
      }
      active={editor.isActive("textStyle") || editor.isActive("highlight")}
      title={t("editor.textColor")}
      panelWidth="w-56"
    >
      <div className="py-1">
        {/* 字体颜色区 */}
        <div className="px-3 py-1.5 text-[10px] text-nf-text-tertiary flex items-center gap-1">
          <Type className="w-3 h-3" />
          {t("editor.textColor")}
        </div>
        <div className="flex flex-wrap gap-1 px-2 py-1">
          {TEXT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              tabIndex={-1}
              title={color}
              onClick={() => editor.chain().focus().setColor(color).run()}
              className="w-5 h-5 border border-nf-border-light/40 hover:border-fandex-primary transition-colors duration-fast"
              style={{ backgroundColor: color }}
            />
          ))}
          {/* 清除字体颜色 */}
          <button
            type="button"
            tabIndex={-1}
            title={t("editor.clearColor")}
            onClick={() => editor.chain().focus().unsetColor().run()}
            className="w-5 h-5 border border-nf-border-light/40 hover:border-fandex-tertiary transition-colors duration-fast flex items-center justify-center text-[10px] text-nf-text-tertiary bg-nf-bg-hover"
          >
            ×
          </button>
        </div>
        {/* 自定义字体颜色输入 */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <label className="text-[10px] text-nf-text-tertiary flex items-center gap-1">
            <input
              type="color"
              value={currentTextColor}
              onChange={(e) =>
                editor.chain().focus().setColor(e.target.value).run()
              }
              className="w-5 h-5 bg-transparent border border-nf-border-light/40 cursor-pointer"
            />
            {t("editor.customColorInput")}
          </label>
        </div>

        {/* 高亮颜色区 */}
        <div className="px-3 py-1.5 text-[10px] text-nf-text-tertiary flex items-center gap-1 border-t border-nf-border-light/40 mt-1">
          <Highlighter className="w-3 h-3" />
          {t("editor.highlightColor")}
        </div>
        <div className="flex flex-wrap gap-1 px-2 py-1">
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              tabIndex={-1}
              title={color}
              onClick={() =>
                editor.chain().focus().toggleHighlight({ color }).run()
              }
              className="w-5 h-5 border border-nf-border-light/40 hover:border-fandex-primary transition-colors duration-fast"
              style={{ backgroundColor: color }}
            />
          ))}
          {/* 清除高亮 */}
          <button
            type="button"
            tabIndex={-1}
            title={t("editor.clearHighlight")}
            onClick={() => editor.chain().focus().unsetHighlight().run()}
            className="w-5 h-5 border border-nf-border-light/40 hover:border-fandex-tertiary transition-colors duration-fast flex items-center justify-center text-[10px] text-nf-text-tertiary bg-nf-bg-hover"
          >
            ×
          </button>
        </div>
        {/* 自定义高亮颜色输入 */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <label className="text-[10px] text-nf-text-tertiary flex items-center gap-1">
            <input
              type="color"
              value={
                currentHighlightColor === "transparent"
                  ? "#FFD93D"
                  : currentHighlightColor
              }
              onChange={(e) =>
                editor
                  .chain()
                  .focus()
                  .toggleHighlight({ color: e.target.value })
                  .run()
              }
              className="w-5 h-5 bg-transparent border border-nf-border-light/40 cursor-pointer"
            />
            {t("editor.customColorInput")}
          </label>
        </div>
      </div>
    </Dropdown>
  );
}

export default ColorPicker;
