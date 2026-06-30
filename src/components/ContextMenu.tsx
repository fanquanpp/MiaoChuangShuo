// 通用右键上下文菜单组件
//
// 功能概述：
// 提供轻量级的右键菜单组件，支持图标、分隔线、禁用状态。
// 通过 onContextMenu 事件触发，点击外部或 Escape 自动关闭。
// 采用 FANDEX 暗色主题，与项目整体风格一致。
//
// 模块职责：
// 1. 渲染固定定位的菜单面板
// 2. 自动调整位置防止溢出屏幕
// 3. 点击外部/Escape 关闭
// 4. 支持菜单项图标、分隔线、禁用状态

import { useEffect, useRef, useCallback, useState } from "react";
import { type LucideIcon } from "lucide-react";

/** 菜单项类型 */
export interface ContextMenuItem {
  /** 唯一 ID */
  id: string;
  /** 显示标签 */
  label: string;
  /** 图标（可选） */
  icon?: LucideIcon;
  /** 点击回调 */
  action: () => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否为分隔线（为 true 时其他字段忽略） */
  separator?: boolean;
  /** 是否为危险操作（红色文字） */
  danger?: boolean;
}

interface ContextMenuProps {
  /** 是否显示 */
  open: boolean;
  /** 菜单 X 坐标（屏幕坐标） */
  x: number;
  /** 菜单 Y 坐标（屏幕坐标） */
  y: number;
  /** 菜单项列表 */
  items: ContextMenuItem[];
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 通用右键上下文菜单
 * 输入:
 *   - open: 显示状态
 *   - x, y: 屏幕坐标
 *   - items: 菜单项数组
 *   - onClose: 关闭回调
 * 输出: JSX 固定定位菜单（open=false 时返回 null）
 * 流程:
 *   1. 根据坐标渲染菜单
 *   2. 自动检测屏幕边界并调整位置
 *   3. 点击外部或 Escape 关闭
 */
export default function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState({ x, y });

  // 调整位置防止溢出屏幕
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    let adjustedX = x;
    let adjustedY = y;
    // 右溢出：向左偏移
    if (x + rect.width > window.innerWidth) {
      adjustedX = window.innerWidth - rect.width - 8;
    }
    // 下溢出：向上偏移
    if (y + rect.height > window.innerHeight) {
      adjustedY = window.innerHeight - rect.height - 8;
    }
    // 确保不超出左上边界
    adjustedX = Math.max(8, adjustedX);
    adjustedY = Math.max(8, adjustedY);
    setAdjustedPos({ x: adjustedX, y: adjustedY });
  }, [open, x, y]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // 延迟绑定，避免触发右键的同一事件立即关闭
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  // 执行菜单项动作
  const handleItemClick = useCallback(
    (item: ContextMenuItem) => {
      if (item.disabled || item.separator) return;
      onClose();
      // 延迟执行，确保菜单先关闭
      setTimeout(() => item.action(), 0);
    },
    [onClose]
  );

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[160px] py-1 bg-nf-bg-card border border-nf-border-light shadow-2xl"
      style={{ left: adjustedPos.x, top: adjustedPos.y }}
    >
      {items.map((item) => {
        if (item.separator) {
          return <div key={item.id} className="h-px my-1 bg-nf-border-light" />;
        }
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            onClick={() => handleItemClick(item)}
            disabled={item.disabled}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left transition-colors duration-fast ${
              item.disabled
                ? "text-nf-text-tertiary cursor-not-allowed"
                : item.danger
                  ? "text-red-400 hover:bg-red-500/10"
                  : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
            }`}
          >
            {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
            <span className="flex-1">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
