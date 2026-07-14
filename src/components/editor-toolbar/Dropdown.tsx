// 通用下拉菜单容器组件
//
// 功能概述：
// 工具栏下拉菜单的通用容器，封装"点击触发器切换面板"与"点击外部/Esc 关闭面板"行为。
// 供 HeadingDropdown、ColorPicker、TableMenu 等需要下拉面板的子组件复用，避免重复实现关闭逻辑。
//
// 模块职责：
// 1. 管理下拉面板的 open/close 状态
// 2. 监听 document mousedown 与 keydown(Esc)，点击外部或按 Esc 时关闭面板
// 3. 渲染触发按钮与下拉面板容器，不关心面板内部具体内容

import { useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

// 下拉菜单通用属性
interface DropdownProps {
  /** 触发按钮内容 */
  trigger: ReactNode;
  /** 下拉面板内容 */
  children: ReactNode;
  /** 面板宽度（Tailwind 宽度类，如 "w-56"） */
  panelWidth?: string;
  /** 是否激活态（触发按钮高亮） */
  active?: boolean;
  /** 标题（tooltip） */
  title?: string;
}

/**
 * 通用下拉菜单组件（点击外部 / Esc 自动关闭）
 *
 * 输入参数:
 *   - trigger: 触发按钮展示内容
 *   - children: 面板展开后的内容
 *   - panelWidth: 面板宽度类名，默认 w-56
 *   - active: 触发按钮是否激活态
 *   - title: 触发按钮 tooltip
 * 返回值: JSX 下拉菜单元素
 * 核心流程:
 *   1. 点击 trigger 切换 open 状态
 *   2. open 时渲染面板，监听 document mousedown 与 keydown
 *   3. 点击面板外部时关闭；按 Escape 时关闭
 *   4. 卸载或关闭时移除事件监听，避免内存泄漏
 */
export function Dropdown({
  trigger,
  children,
  panelWidth = "w-56",
  active = false,
  title,
}: DropdownProps) {
  // 面板开关状态
  const [open, setOpen] = useState(false);
  // 容器引用，用于判断点击是否在面板外部
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // 点击外部关闭面板
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    // 按 Esc 关闭面板
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        onMouseDown={(e) => e.preventDefault()}
        title={title}
        tabIndex={-1}
        className={`nf-tool-btn relative h-8 px-2 transition-colors duration-fast ease-fandex border border-transparent flex items-center gap-1 ${
          active || open
            ? "text-fandex-primary bg-fandex-primary/10"
            : "text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-card/40"
        }`}
      >
        {trigger}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <div
          className={`absolute top-full left-0 mt-1 ${panelWidth} nf-glass-panel bg-nf-bg-card border border-nf-border-light shadow-lg z-50 max-h-96 overflow-y-auto`}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.preventDefault()}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export default Dropdown;
