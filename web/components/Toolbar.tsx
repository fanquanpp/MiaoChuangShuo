// 编辑器工具栏组件
//
// 功能概述:
// 为 TipTap 编辑器提供基础富文本格式工具栏, 包含:
//   - 撤销/重做
//   - 标题层级 (H1/H2/H3)
//   - 粗体/斜体/下划线/删除线
//   - 无序列表/有序列表
//   - 引用块/代码块
//   - 水平分割线
//
// 模块职责:
// 1. 根据 editor 实例状态渲染工具按钮的激活态
// 2. 点击按钮触发对应 TipTap 命令
// 3. 保持工具栏按钮的统一视觉风格 (FANDEX 直角几何)
//
// 设计要点:
//   - 按钮 onMouseDown preventDefault 防止编辑器失焦 (保护 IME 输入)
//   - tabIndex=-1 防止 Tab 键跳到工具栏

import type { Editor } from "@tiptap/core";
import {
  Undo,
  Redo,
  Heading1,
  Heading2,
  Heading3,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code,
  Minus,
  Pilcrow,
} from "lucide-react";

// 工具栏组件属性
interface ToolbarProps {
  // TipTap 编辑器实例
  editor: Editor | null;
}

// 工具栏按钮属性
interface ToolbarButtonProps {
  // 点击回调
  onClick: () => void;
  // 是否激活
  active: boolean;
  // 是否禁用
  disabled: boolean;
  // 鼠标悬停提示
  title: string;
  // 子元素 (图标)
  children: React.ReactNode;
}

/**
 * 工具栏按钮 (统一风格)
 * 输入: onClick / active / disabled / title / children
 * 输出: JSX.Element
 * 流程:
 *   1. onMouseDown preventDefault 防止编辑器失焦
 *   2. 渲染按钮, 激活态使用 .active 类
 */
function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: ToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={`toolbar-btn${active ? " active" : ""}`}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      disabled={disabled}
      title={title}
      tabIndex={-1}
      aria-label={title}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

/**
 * 工具栏分隔符
 * 输入: 无
 * 输出: JSX.Element 分隔线
 */
function Divider(): JSX.Element {
  return <span className="toolbar-divider" aria-hidden="true" />;
}

/**
 * 编辑器工具栏
 * 输入: editor TipTap 编辑器实例 (可能为 null)
 * 输出: JSX.Element
 * 流程: 根据 editor 状态渲染工具按钮组
 */
export default function Toolbar({ editor }: ToolbarProps): JSX.Element {
  // editor 未就绪时禁用所有按钮
  const disabled = !editor;

  /**
   * 安全执行编辑器命令
   * 输入: fn 命令执行函数
   * 输出: 无
   * 流程: editor 存在时执行命令, 否则忽略
   */
  const run = (fn: (ed: Editor) => void): void => {
    if (editor) {
      fn(editor);
    }
  };

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="编辑器工具栏">
      {/* 撤销/重做 */}
      <ToolbarButton
        title="撤销 (Ctrl+Z)"
        active={false}
        disabled={disabled || !editor?.can().undo()}
        onClick={() => run((ed) => ed.chain().focus().undo().run())}
      >
        <Undo size={16} />
      </ToolbarButton>
      <ToolbarButton
        title="重做 (Ctrl+Y)"
        active={false}
        disabled={disabled || !editor?.can().redo()}
        onClick={() => run((ed) => ed.chain().focus().redo().run())}
      >
        <Redo size={16} />
      </ToolbarButton>

      <Divider />

      {/* 标题层级 */}
      <ToolbarButton
        title="正文"
        active={editor?.isActive("paragraph") ?? false}
        disabled={disabled}
        onClick={() => run((ed) => ed.chain().focus().setParagraph().run())}
      >
        <Pilcrow size={16} />
      </ToolbarButton>
      <ToolbarButton
        title="标题 1"
        active={editor?.isActive("heading", { level: 1 }) ?? false}
        disabled={disabled}
        onClick={() => run((ed) => ed.chain().focus().toggleHeading({ level: 1 }).run())}
      >
        <Heading1 size={16} />
      </ToolbarButton>
      <ToolbarButton
        title="标题 2"
        active={editor?.isActive("heading", { level: 2 }) ?? false}
        disabled={disabled}
        onClick={() => run((ed) => ed.chain().focus().toggleHeading({ level: 2 }).run())}
      >
        <Heading2 size={16} />
      </ToolbarButton>
      <ToolbarButton
        title="标题 3"
        active={editor?.isActive("heading", { level: 3 }) ?? false}
        disabled={disabled}
        onClick={() => run((ed) => ed.chain().focus().toggleHeading({ level: 3 }).run())}
      >
        <Heading3 size={16} />
      </ToolbarButton>

      <Divider />

      {/* 内联格式 */}
      <ToolbarButton
        title="粗体 (Ctrl+B)"
        active={editor?.isActive("bold") ?? false}
        disabled={disabled}
        onClick={() => run((ed) => ed.chain().focus().toggleBold().run())}
      >
        <Bold size={16} />
      </ToolbarButton>
      <ToolbarButton
        title="斜体 (Ctrl+I)"
        active={editor?.isActive("italic") ?? false}
        disabled={disabled}
        onClick={() => run((ed) => ed.chain().focus().toggleItalic().run())}
      >
        <Italic size={16} />
      </ToolbarButton>
      <ToolbarButton
        title="下划线 (Ctrl+U)"
        active={editor?.isActive("underline") ?? false}
        disabled={disabled}
        onClick={() => run((ed) => ed.chain().focus().toggleUnderline().run())}
      >
        <Underline size={16} />
      </ToolbarButton>
      <ToolbarButton
        title="删除线"
        active={editor?.isActive("strike") ?? false}
        disabled={disabled}
        onClick={() => run((ed) => ed.chain().focus().toggleStrike().run())}
      >
        <Strikethrough size={16} />
      </ToolbarButton>
      <ToolbarButton
        title="行内代码"
        active={editor?.isActive("code") ?? false}
        disabled={disabled}
        onClick={() => run((ed) => ed.chain().focus().toggleCode().run())}
      >
        <Code size={16} />
      </ToolbarButton>

      <Divider />

      {/* 列表 */}
      <ToolbarButton
        title="无序列表"
        active={editor?.isActive("bulletList") ?? false}
        disabled={disabled}
        onClick={() => run((ed) => ed.chain().focus().toggleBulletList().run())}
      >
        <List size={16} />
      </ToolbarButton>
      <ToolbarButton
        title="有序列表"
        active={editor?.isActive("orderedList") ?? false}
        disabled={disabled}
        onClick={() => run((ed) => ed.chain().focus().toggleOrderedList().run())}
      >
        <ListOrdered size={16} />
      </ToolbarButton>

      <Divider />

      {/* 块级元素 */}
      <ToolbarButton
        title="引用块"
        active={editor?.isActive("blockquote") ?? false}
        disabled={disabled}
        onClick={() => run((ed) => ed.chain().focus().toggleBlockquote().run())}
      >
        <Quote size={16} />
      </ToolbarButton>
      <ToolbarButton
        title="代码块"
        active={editor?.isActive("codeBlock") ?? false}
        disabled={disabled}
        onClick={() => run((ed) => ed.chain().focus().toggleCodeBlock().run())}
      >
        <Code size={16} />
      </ToolbarButton>
      <ToolbarButton
        title="水平分割线"
        active={false}
        disabled={disabled}
        onClick={() => run((ed) => ed.chain().focus().setHorizontalRule().run())}
      >
        <Minus size={16} />
      </ToolbarButton>
    </div>
  );
}
