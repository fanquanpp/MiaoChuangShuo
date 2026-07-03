// src/lib/dagreLayout.ts
//
// 剧情时间线编辑器自动布局算法模块
// 使用 dagre LR 方向计算节点位置, 主轴 Y 坐标固定, 分支上下分布。
//
// 优化要点(解决自动整理后节点互相遮挡问题):
//   1. 区分有连线节点与无连线节点, 分别进入 dagre 主图与孤立节点网格
//   2. 主轴节点(main)强制 Y 对齐, 分支(branch)按 dagre 计算上下分布
//   3. 孤立节点(无任何连线)按类型分组, 在主图下方网格化排列, 避免与主图重叠
//   4. 增大 nodesep/ranksep 间距, 防止节点边界互相侵入
//   5. 全量重排: 所有节点位置由算法统一计算, 不保留原始位置

import dagre from "@dagrejs/dagre";
import type { TimelineNode, TimelineNodeType, TimelineEdge } from "./stores/timelineTypes";

/** 主轴固定 Y 坐标(垂直居中) */
const MAIN_AXIS_Y = 300;
/** 节点尺寸常量(与 TimelineNode 组件渲染尺寸一致) */
const NODE_SIZES: Record<TimelineNodeType, { width: number; height: number }> = {
  main: { width: 256, height: 120 },
  branch: { width: 180, height: 90 },
  event: { width: 180, height: 90 },
  ending: { width: 180, height: 90 },
};
/** 孤立节点网格间距(水平/垂直) */
const ORPHAN_GRID_GAP_X = 40;
const ORPHAN_GRID_GAP_Y = 30;
/** 孤立节点区域起始 Y 坐标(位于主图下方, 避免遮挡) */
const ORPHAN_AREA_START_Y = 600;
/** 孤立节点网格每行最大列数 */
const ORPHAN_GRID_MAX_COLS = 6;

/**
 * 自动布局: 主轴水平排列, 分支上下分布, 孤立节点网格化排列
 * 输入: nodes 节点列表, edges 边列表
 * 输出: 布局后的节点列表(位置已更新, 全量重排)
 * 流程:
 *   1. 拆分节点为"有连线"与"孤立(无连线)"两组
 *   2. 有连线节点进入 dagre LR 布局, 主线 Y 固定
 *   3. 孤立节点按类型分组, 网格化排列在主图下方
 *   4. 合并结果返回
 */
export function autoLayout(nodes: TimelineNode[], edges: TimelineEdge[]): TimelineNode[] {
  // 步骤 1: 识别有连线节点与孤立节点
  const connectedNodeIds = new Set<string>();
  edges.forEach((edge) => {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
  });

  const connectedNodes: TimelineNode[] = [];
  const orphanNodes: TimelineNode[] = [];
  nodes.forEach((node) => {
    if (connectedNodeIds.has(node.id)) {
      connectedNodes.push(node);
    } else {
      orphanNodes.push(node);
    }
  });

  // 步骤 2: 有连线节点进入 dagre LR 布局
  const layoutedConnectedMap = layoutConnectedNodes(connectedNodes, edges);

  // 步骤 3: 孤立节点网格化排列
  const layoutedOrphanMap = layoutOrphanNodes(orphanNodes);

  // 步骤 4: 合并结果, 保持原 nodes 顺序
  return nodes.map((node) => {
    const connectedPos = layoutedConnectedMap.get(node.id);
    const orphanPos = layoutedOrphanMap.get(node.id);
    if (connectedPos) {
      return { ...node, position: connectedPos };
    }
    if (orphanPos) {
      return { ...node, position: orphanPos };
    }
    // 兜底: 保持原位置(理论上不会走到此处)
    return node;
  });
}

/**
 * 有连线节点的 dagre LR 布局
 * 输入: nodes 有连线节点列表, edges 边列表
 * 输出: Map<nodeId, position> 布局结果
 * 流程:
 *   1. 用 dagre 计算初始位置(LR 方向, 增大间距防遮挡)
 *   2. 主线节点 Y 坐标强制固定为 MAIN_AXIS_Y
 *   3. 分支节点按 dagre 计算结果上下分布
 */
function layoutConnectedNodes(
  nodes: TimelineNode[],
  edges: TimelineEdge[]
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return result;

  const g = new dagre.graphlib.Graph();
  // rankdir=LR: 左到右排列(主轴水平方向)
  // nodesep=100: 同层节点垂直间距(增大防止分支节点与主线重叠)
  // ranksep=140: 不同层节点水平间距(增大防止相邻节点边界侵入)
  g.setGraph({ rankdir: "LR", nodesep: 100, ranksep: 140 });
  g.setDefaultEdgeLabel(() => ({}));

  // 注册节点(按类型设置尺寸)
  nodes.forEach((node) => {
    const size = NODE_SIZES[node.data.nodeType];
    g.setNode(node.id, { width: size.width, height: size.height });
  });

  // 注册边
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  // 执行布局计算
  dagre.layout(g);

  // 应用计算结果到节点(主线 Y 固定)
  nodes.forEach((node) => {
    const dagreNode = g.node(node.id);
    if (!dagreNode) return;
    let y = dagreNode.y;
    // 主线节点强制 Y 固定(主轴对齐)
    if (node.data.nodeType === "main") {
      y = MAIN_AXIS_Y;
    }
    // dagre 返回的 x/y 为节点中心点, 转换为左上角坐标(React Flow 使用左上角)
    const size = NODE_SIZES[node.data.nodeType];
    result.set(node.id, {
      x: dagreNode.x - size.width / 2,
      y: y - size.height / 2,
    });
  });

  return result;
}

/**
 * 孤立节点(无连线)网格化排列
 * 输入: nodes 孤立节点列表
 * 输出: Map<nodeId, position> 布局结果
 * 流程:
 *   1. 按 nodeType 分组(main/branch/event/ending)
 *   2. 每组按行排列, 每行最多 ORPHAN_GRID_MAX_COLS 个节点
 *   3. 不同组之间垂直留白, 避免类型混杂
 */
function layoutOrphanNodes(
  nodes: TimelineNode[]
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return result;

  // 按类型分组(保持类型顺序: main → branch → event → ending)
  const typeOrder: TimelineNodeType[] = ["main", "branch", "event", "ending"];
  const groupedNodes = new Map<TimelineNodeType, TimelineNode[]>();
  typeOrder.forEach((type) => groupedNodes.set(type, []));
  nodes.forEach((node) => {
    const group = groupedNodes.get(node.data.nodeType);
    if (group) group.push(node);
  });

  let currentY = ORPHAN_AREA_START_Y;
  const startX = 80;

  // 逐组网格化排列
  typeOrder.forEach((type) => {
    const group = groupedNodes.get(type);
    if (!group || group.length === 0) return;

    const size = NODE_SIZES[type];
    const colWidth = size.width + ORPHAN_GRID_GAP_X;
    const rowHeight = size.height + ORPHAN_GRID_GAP_Y;

    group.forEach((node, index) => {
      const col = index % ORPHAN_GRID_MAX_COLS;
      const row = Math.floor(index / ORPHAN_GRID_MAX_COLS);
      result.set(node.id, {
        x: startX + col * colWidth,
        y: currentY + row * rowHeight,
      });
    });

    // 计算该组占用行数, 推进 currentY 到下一组起始位置
    const rows = Math.ceil(group.length / ORPHAN_GRID_MAX_COLS);
    currentY += rows * rowHeight + ORPHAN_GRID_GAP_Y * 2;
  });

  return result;
}
