// src/components/TimelineContextMenu.tsx
//
// 时间线编辑器右键菜单组件
// 根据右键位置(画布空白 vs main 节点 vs branch 节点)显示不同菜单项。
// 菜单项点击后调用对应回调, 创建节点或触发抽屉编辑。

import { useI18n } from "../lib/i18n";
import type { TimelineNodeType } from "../lib/stores/timelineTypes";

/**
 * 右键菜单项定义
 */
interface ContextMenuItem {
  key: string;
  labelKey: string;
  action: () => void;
}

/**
 * 右键菜单属性
 */
interface TimelineContextMenuProps {
  /** 菜单位置 X(画布坐标) */
  x: number;
  /** 菜单位置 Y(画布坐标) */
  y: number;
  /** 触发右键的节点类型(null 表示画布空白) */
  nodeType: TimelineNodeType | null;
  /** 创建新节点回调 */
  onCreateNode: (type: TimelineNodeType, position: { x: number; y: number }) => void;
  /** 编辑详情回调(仅节点右键) */
  onEditDetail?: () => void;
  /** 删除节点回调(仅节点右键) */
  onDeleteNode?: () => void;
  /** 关闭菜单回调 */
  onClose: () => void;
}

/**
 * 右键菜单组件
 * 输入: TimelineContextMenuProps
 * 输出: JSX 菜单浮层
 * 流程:
 *   1. 根据 nodeType 决定菜单项
 *   2. 渲染固定位置(style left/top)的菜单
 *   3. 点击菜单项触发对应回调并关闭
 */
export default function TimelineContextMenu({
  x,
  y,
  nodeType,
  onCreateNode,
  onEditDetail,
  onDeleteNode,
  onClose,
}: TimelineContextMenuProps) {
  const { t } = useI18n();

  // 根据右键位置构建菜单项
  const items: ContextMenuItem[] = [];

  if (nodeType === null) {
    // 画布空白: 创建四类节点(无连线)
    items.push({ key: "addMain", labelKey: "timeline.ctx.addMain", action: () => onCreateNode("main", { x, y }) });
    items.push({ key: "addBranch", labelKey: "timeline.ctx.addBranch", action: () => onCreateNode("branch", { x, y }) });
    items.push({ key: "addEvent", labelKey: "timeline.ctx.addEvent", action: () => onCreateNode("event", { x, y }) });
    items.push({ key: "addEnding", labelKey: "timeline.ctx.addEnding", action: () => onCreateNode("ending", { x, y }) });
  } else if (nodeType === "main") {
    // main 节点右键: 创建后继/上下分支/事件
    items.push({ key: "addMainSuccessor", labelKey: "timeline.ctx.addMainSuccessor", action: () => onCreateNode("main", { x: x + 320, y }) });
    items.push({ key: "addBranchUp", labelKey: "timeline.ctx.addBranchUp", action: () => onCreateNode("branch", { x, y: y - 150 }) });
    items.push({ key: "addBranchDown", labelKey: "timeline.ctx.addBranchDown", action: () => onCreateNode("branch", { x, y: y + 150 }) });
    items.push({ key: "addEventChild", labelKey: "timeline.ctx.addEventChild", action: () => onCreateNode("event", { x: x + 100, y: y - 100 }) });
    if (onEditDetail) items.push({ key: "editDetail", labelKey: "timeline.ctx.editDetail", action: onEditDetail });
    if (onDeleteNode) items.push({ key: "deleteNode", labelKey: "timeline.ctx.deleteNode", action: onDeleteNode });
  } else if (nodeType === "branch") {
    // branch 节点右键: 创建分支后继
    items.push({ key: "addBranchSuccessor", labelKey: "timeline.ctx.addBranch", action: () => onCreateNode("branch", { x: x + 280, y }) });
    if (onEditDetail) items.push({ key: "editDetail", labelKey: "timeline.ctx.editDetail", action: onEditDetail });
    if (onDeleteNode) items.push({ key: "deleteNode", labelKey: "timeline.ctx.deleteNode", action: onDeleteNode });
  } else {
    // event/ending 节点右键: 编辑详情/删除
    if (onEditDetail) items.push({ key: "editDetail", labelKey: "timeline.ctx.editDetail", action: onEditDetail });
    if (onDeleteNode) items.push({ key: "deleteNode", labelKey: "timeline.ctx.deleteNode", action: onDeleteNode });
  }

  return (
    <div
      className="fixed z-50 min-w-[160px] py-1 bg-nf-bg-sidebar border border-nf-border-light rounded-md shadow-xl"
      style={{ left: x, top: y }}
      onClick={onClose}
    >
      {items.map((item) => (
        <button
          key={item.key}
          onClick={item.action}
          className="w-full text-left px-3 py-1.5 text-sm text-nf-text-secondary hover:bg-nf-bg-hover hover:text-nf-text transition-colors duration-fast"
        >
          {t(item.labelKey)}
        </button>
      ))}
    </div>
  );
}
