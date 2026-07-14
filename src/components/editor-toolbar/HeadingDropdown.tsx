// 标题层级下拉菜单组件
//
// 功能概述：
// 提供段落层级切换下拉菜单，支持正文与 H1-H6 六级标题。
// 通过 Dropdown 容器实现点击外部 / Esc 关闭，调用 TipTap toggleHeading 命令切换层级。
//
// 模块职责：
// 仅负责标题层级的状态检测与切换，不持有编辑器实例的所有权（通过 props 接收）。

import type { Editor } from "@tiptap/core";
import {
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading as HeadingIcon,
  Pilcrow,
} from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { Dropdown } from "./Dropdown";

// 标题下拉属性
interface HeadingDropdownProps {
  /** TipTap 编辑器实例（可能为 null） */
  editor: Editor | null;
}

// TipTap Heading 扩展的合法层级类型
type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * 标题层级下拉菜单（正文 / H1-H6）
 *
 * 输入参数:
 *   - editor: TipTap 编辑器实例，null 时组件不渲染
 * 返回值: JSX 下拉菜单，editor 为 null 时返回 null
 * 核心流程:
 *   1. 检测当前光标处激活的标题层级，作为触发按钮显示文本
 *   2. 列出正文与 H1-H6 选项，标注当前激活项
 *   3. 点击正文调用 setParagraph 清除标题
 *   4. 点击 H1-H6 调用 toggleHeading({ level }) 切换层级
 */
export function HeadingDropdown({ editor }: HeadingDropdownProps) {
  const { t } = useI18n();
  // 编辑器未就绪时不渲染，避免空指针
  if (!editor) return null;

  // 检测当前激活的标题层级，返回触发按钮展示文本
  const getCurrentLevel = (): string => {
    if (editor.isActive("heading", { level: 1 })) return "H1";
    if (editor.isActive("heading", { level: 2 })) return "H2";
    if (editor.isActive("heading", { level: 3 })) return "H3";
    if (editor.isActive("heading", { level: 4 })) return "H4";
    if (editor.isActive("heading", { level: 5 })) return "H5";
    if (editor.isActive("heading", { level: 6 })) return "H6";
    return t("editor.paragraph");
  };

  const currentLabel = getCurrentLevel();
  // 是否处于任意标题层级（决定触发按钮高亮）
  const isActive = editor.isActive("heading");

  // 选项列表：null 表示正文，其余为标题层级
  // H1-H4 使用专用图标并赋予 FANDEX 三色；H5/H6 复用通用 Heading 图标
  const options: Array<{
    level: HeadingLevel | null;
    label: string;
    icon: React.ReactNode;
    className: string;
  }> = [
    { level: null, label: t("editor.paragraph"), icon: <Pilcrow className="w-4 h-4" />, className: "text-nf-text" },
    { level: 1, label: t("editor.heading1"), icon: <Heading1 className="w-4 h-4" />, className: "text-fandex-primary" },
    { level: 2, label: t("editor.heading2"), icon: <Heading2 className="w-4 h-4" />, className: "text-fandex-secondary" },
    { level: 3, label: t("editor.heading3"), icon: <Heading3 className="w-4 h-4" />, className: "text-fandex-tertiary" },
    { level: 4, label: t("editor.heading4"), icon: <Heading4 className="w-4 h-4" />, className: "text-nf-text-secondary" },
    { level: 5, label: t("editor.heading5"), icon: <HeadingIcon className="w-4 h-4" />, className: "text-nf-text-secondary" },
    { level: 6, label: t("editor.heading6"), icon: <HeadingIcon className="w-4 h-4" />, className: "text-nf-text-tertiary" },
  ];

  return (
    <Dropdown
      trigger={<span className="text-xs font-medium min-w-[40px] text-left">{currentLabel}</span>}
      active={isActive}
      title={t("editor.headingLevel")}
      panelWidth="w-44"
    >
      <div className="py-1">
        {options.map((opt) => {
          // 判断当前选项是否激活：正文选项要求非 heading 态，标题选项要求对应 level
          const isActiveOpt =
            opt.level === null
              ? !editor.isActive("heading")
              : editor.isActive("heading", { level: opt.level });
          return (
            <button
              key={opt.label}
              onClick={() => {
                if (opt.level === null) {
                  editor.chain().focus().setParagraph().run();
                } else {
                  editor.chain().focus().toggleHeading({ level: opt.level }).run();
                }
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition duration-fast ${
                isActiveOpt
                  ? "bg-fandex-primary/10 text-fandex-primary"
                  : "text-nf-text hover:bg-nf-bg-hover"
              }`}
            >
              <span className={opt.className}>{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    </Dropdown>
  );
}

export default HeadingDropdown;
