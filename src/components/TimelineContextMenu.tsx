// src/components/TimelineContextMenu.tsx
//
// 时间线编辑器右键菜单组件
// 根据右键位置(画布空白 vs main 节点 vs branch 节点)显示不同菜单项。
// 菜单项点击后调用对应回调, 创建节点或触发抽屉编辑。
//
// 美术风格与 CharacterGraphContextMenu 统一:
//   - 容器: bg-nf-bg-card + shadow-lg + min-w-[160px]
//   - 菜单项: flex 布局 + lucide-react 图标 + 品牌色 hover
//   - 危险操作: fandex-tertiary 区分
//   - 分组分隔线 + role="menu"/"menuitem" 可访问性
//   - 屏幕边界检测, 防止菜单溢出

import { useEffect, useRef, useState } from "react";
import {
  Milestone,
  GitBranch,
  CircleDot,
  Flag,
  ArrowRight,
  CornerLeftUp,
  CornerLeftDown,
  Plus,
  Edit3,
  Trash2,
  LayoutGrid,
  Maximize2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "../lib/i18n";
import type { TimelineNodeType } from "../lib/stores/timelineTypes";

/**
 * 右键菜单项定义
 * icon: 菜单项前置图标(lucide-react 组件)
 * danger: 是否为危险操作(删除), 用于品牌三级色区分
 */
interface ContextMenuItem {
  key: string;
  labelKey: string;
  action: () => void;
  icon: LucideIcon;
  danger?: boolean;
}

/**
 * 右键菜单属性
 */
interface TimelineContextMenuProps {
  /** 菜单位置 X(屏幕坐标) */
  x: number;
  /** 菜单位置 Y(屏幕坐标) */
  y: number;
  /** 触发右键的节点类型(null 表示画布空白) */
  nodeType: TimelineNodeType | null;
  /** 创建新节点回调(参数为屏幕坐标, 由父组件 screenToFlowPosition 转换) */
  onCreateNode: (type: TimelineNodeType, position: { x: number; y: number }) => void;
  /** 编辑详情回调(仅节点右键) */
  onEditDetail?: () => void;
  /** 删除节点回调(仅节点右键) */
  onDeleteNode?: () => void;
  /** 自动布局回调(dagre 整理所有节点) */
  onAutoLayout?: () => void;
  /** 重置视图回调(居中并自适应缩放) */
  onResetView?: () => void;
  /** 关闭菜单回调 */
  onClose: () => void;
}

/**
 * 右键菜单组件
 * 输入: TimelineContextMenuProps
 * 输出: JSX 菜单浮层(含边界检测 + Esc/外部点击关闭)
 * 流程:
 *   1. 根据 nodeType 决定菜单项集合(创建类 + 编辑/删除类)
 *   2. 边界检测调整位置, 防止溢出屏幕右侧/底部
 *   3. 监听 Esc 键与外部 mousedown/contextmenu 关闭菜单
 *   4. 菜单项点击后触发 action 并关闭
 */
export default function TimelineContextMenu({
  x,
  y,
  nodeType,
  onCreateNode,
  onEditDetail,
  onDeleteNode,
  onAutoLayout,
  onResetView,
  onClose,
}: TimelineContextMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  // 调整后的位置(防止溢出屏幕)
  const [adjustedPos, setAdjustedPos] = useState({ x, y });

  // 边界检测: 根据菜单实际尺寸调整位置, 防止溢出右侧与底部
  useEffect(() => {
    const menu = menuRef.current;
    // 统一全项目右键菜单宽度预估 180px
    const MENU_WIDTH = 180;
    const MENU_HEIGHT = 240;
    const rect = menu?.getBoundingClientRect();
    const width = rect?.width ?? MENU_WIDTH;
    const height = rect?.height ?? MENU_HEIGHT;

    let posX = x;
    let posY = y;
    // 右溢出: 向左偏移
    if (posX + width > window.innerWidth - 8) {
      posX = Math.max(8, window.innerWidth - width - 8);
    }
    // 下溢出: 向上偏移
    if (posY + height > window.innerHeight - 8) {
      posY = Math.max(8, window.innerHeight - height - 8);
    }
    setAdjustedPos({ x: posX, y: posY });
  }, [x, y]);

  // Esc 键关闭菜单(capture 阶段拦截, 优先于其他 Escape 处理器)
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [onClose]);

  // 点击菜单外部关闭(使用 mousedown 避免与节点右键事件冲突)
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const menu = menuRef.current;
      if (menu && !menu.contains(e.target as Node)) {
        onClose();
      }
    };
    // 延迟绑定, 避免当前右键事件触发立即关闭
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("contextmenu", handleOutsideClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("contextmenu", handleOutsideClick);
    };
  }, [onClose]);

  // 根据右键位置构建创建类菜单项
  const createItems: ContextMenuItem[] = [];
  if (nodeType === null) {
    // 画布空白: 创建四类节点(无连线)
    createItems.push({ key: "addMain", labelKey: "timeline.ctx.addMain", action: () => onCreateNode("main", { x, y }), icon: Milestone });
    createItems.push({ key: "addBranch", labelKey: "timeline.ctx.addBranch", action: () => onCreateNode("branch", { x, y }), icon: GitBranch });
    createItems.push({ key: "addEvent", labelKey: "timeline.ctx.addEvent", action: () => onCreateNode("event", { x, y }), icon: CircleDot });
    createItems.push({ key: "addEnding", labelKey: "timeline.ctx.addEnding", action: () => onCreateNode("ending", { x, y }), icon: Flag });
  } else if (nodeType === "main") {
    // main 节点右键: 创建后继/上下分支/事件
    createItems.push({ key: "addMainSuccessor", labelKey: "timeline.ctx.addMainSuccessor", action: () => onCreateNode("main", { x: x + 320, y }), icon: ArrowRight });
    createItems.push({ key: "addBranchUp", labelKey: "timeline.ctx.addBranchUp", action: () => onCreateNode("branch", { x, y: y - 150 }), icon: CornerLeftUp });
    createItems.push({ key: "addBranchDown", labelKey: "timeline.ctx.addBranchDown", action: () => onCreateNode("branch", { x, y: y + 150 }), icon: CornerLeftDown });
    createItems.push({ key: "addEventChild", labelKey: "timeline.ctx.addEventChild", action: () => onCreateNode("event", { x: x + 100, y: y - 100 }), icon: Plus });
  } else if (nodeType === "branch") {
    // branch 节点右键: 创建分支后继
    createItems.push({ key: "addBranchSuccessor", labelKey: "timeline.ctx.addBranch", action: () => onCreateNode("branch", { x: x + 280, y }), icon: ArrowRight });
  }

  // 编辑/删除类菜单项(仅节点右键时存在)
  const nodeItems: ContextMenuItem[] = [];
  if (nodeType !== null) {
    if (onEditDetail) nodeItems.push({ key: "editDetail", labelKey: "timeline.ctx.editDetail", action: onEditDetail, icon: Edit3 });
    if (onDeleteNode) nodeItems.push({ key: "deleteNode", labelKey: "timeline.ctx.deleteNode", action: onDeleteNode, icon: Trash2, danger: true });
  }

  // 画布操作类菜单项(自动布局 + 重置视图, 画布空白与节点右键均可用)
  const canvasItems: ContextMenuItem[] = [];
  if (onAutoLayout) canvasItems.push({ key: "autoLayout", labelKey: "timeline.ctx.autoLayout", action: onAutoLayout, icon: LayoutGrid });
  if (onResetView) canvasItems.push({ key: "resetView", labelKey: "timeline.ctx.resetView", action: onResetView, icon: Maximize2 });

  // 菜单按钮通用样式(与 CharacterGraphContextMenu 一致)
  const buttonClass = (danger = false) =>
    `w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors duration-fast ${
      danger
        ? "text-nf-text-secondary hover:text-fandex-tertiary hover:bg-fandex-tertiary/5"
        : "text-nf-text-secondary hover:text-fandex-primary hover:bg-fandex-primary/5"
    }`;

  // 是否需要分隔线(创建组与节点操作组都存在时)
  const needSeparatorBetweenCreateAndNode = createItems.length > 0 && nodeItems.length > 0;
  // 是否需要画布操作前的分隔线(前面有任意菜单项时)
  const needSeparatorBeforeCanvas = (createItems.length > 0 || nodeItems.length > 0) && canvasItems.length > 0;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] bg-nf-bg-card border border-nf-border-light shadow-lg py-1"
      style={{ left: adjustedPos.x, top: adjustedPos.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      role="menu"
    >
      {/* 创建类菜单项 */}
      {createItems.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            onClick={() => {
              item.action();
              onClose();
            }}
            className={buttonClass(!!item.danger)}
            role="menuitem"
          >
            <Icon className="w-3.5 h-3.5" />
            {t(item.labelKey)}
          </button>
        );
      })}

      {/* 分组分隔线 */}
      {needSeparatorBetweenCreateAndNode && <div className="my-1 border-t border-nf-border-light" />}

      {/* 编辑/删除类菜单项 */}
      {nodeItems.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            onClick={() => {
              item.action();
              onClose();
            }}
            className={buttonClass(!!item.danger)}
            role="menuitem"
          >
            <Icon className="w-3.5 h-3.5" />
            {t(item.labelKey)}
          </button>
        );
      })}

      {/* 画布操作前的分隔线 */}
      {needSeparatorBeforeCanvas && <div className="my-1 border-t border-nf-border-light" />}

      {/* 画布操作类菜单项(自动布局 + 重置视图) */}
      {canvasItems.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            onClick={() => {
              item.action();
              onClose();
            }}
            className={buttonClass(!!item.danger)}
            role="menuitem"
          >
            <Icon className="w-3.5 h-3.5" />
            {t(item.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
