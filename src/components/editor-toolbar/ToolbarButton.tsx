// 通用工具栏按钮组件
//
// 功能概述：
// 工具栏统一的直角几何按钮，承载图标或字符内容。
// 采用 FANDEX 色彩体系，悬停仅色彩变化（不使用 scale 放大），保持盒模型稳定。
// 兼容 IME 输入法：通过 tabIndex=-1 与 onMouseDown preventDefault 保护编辑器焦点。
//
// 模块职责：
// 仅负责按钮的视觉呈现与点击事件转发，不包含任何业务逻辑。

import type { ReactNode } from "react";

// 工具栏按钮属性
interface ToolbarButtonProps {
  /** 按钮内容（通常为 lucide-react 图标，也可为字符 span） */
  icon: ReactNode;
  /** 点击回调 */
  onClick: () => void;
  /** 是否处于激活态（高亮显示） */
  isActive: boolean;
  /** 鼠标悬浮提示文本 */
  title: string;
  /** 是否禁用，禁用时不可点击且半透明 */
  disabled?: boolean;
}

/**
 * 工具栏按钮 - 统一直角几何风格
 *
 * 输入参数:
 *   - icon: 按钮内展示的图标或字符节点
 *   - onClick: 点击事件回调
 *   - isActive: 是否激活态，决定色彩高亮
 *   - title: tooltip 提示文本
 *   - disabled: 是否禁用
 * 返回值: JSX 按钮元素
 * 核心流程:
 *   1. 渲染固定 32x32 直角按钮
 *   2. 激活态使用 FANDEX primary 高亮，否则使用三级文字色
 *   3. 悬停仅切换文字色，不放大，避免布局抖动
 *   4. onMouseDown preventDefault 阻止编辑器失焦，保护中文输入法组合输入
 *
 * 视觉规范 (v26.7.24 统一重构):
 *   - 尺寸: h-8 w-8 (32x32px) 固定容器 + w-4 h-4 图标
 *   - 色彩: 默认 text-nf-text-tertiary / 悬停 text-nf-text / 激活 text-fandex-primary + bg-fandex-primary/10
 *   - 过渡: transition-colors duration-fast (仅色彩, 无背景放大)
 *   - 装饰: border border-transparent (保持盒模型一致, 避免激活态布局抖动)
 */
export function ToolbarButton({
  icon,
  onClick,
  isActive,
  title,
  disabled = false,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      title={title}
      tabIndex={-1}
      disabled={disabled}
      className={`nf-tool-btn relative h-8 w-8 flex items-center justify-center ease-fandex border border-transparent transition-colors duration-fast disabled:opacity-30 disabled:cursor-not-allowed ${
        isActive
          ? "text-fandex-primary bg-fandex-primary/10"
          : "text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-card/40"
      }`}
    >
      <span className="flex items-center justify-center">{icon}</span>
    </button>
  );
}

export default ToolbarButton;
