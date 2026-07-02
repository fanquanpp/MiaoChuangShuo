// src/lib/dagreLayout.ts
//
// 时间线编辑器自动布局算法模块
// 使用 dagre LR 方向计算节点位置, 主轴 Y 坐标固定, 分支上下分布。

import dagre from "@dagrejs/dagre";
import type { TimelineNode, TimelineEdge } from "./stores/timelineTypes";

/** 主轴固定 Y 坐标(垂直居中) */
const MAIN_AXIS_Y = 300;
/** 主轴节点水平间距(由 dagre ranksep 控制, 此处仅作注释说明) */

/**
 * 自动布局: 主轴水平排列, 分支上下分布
 * 输入: nodes 节点列表, edges 边列表
 * 输出: 布局后的节点列表(位置已更新)
 * 流程:
 *   1. 用 dagre 计算初始位置(LR 方向)
 *   2. 主线节点 Y 坐标强制固定为 MAIN_AXIS_Y
 *   3. 分支节点按 dagre 计算结果上下分布
 */
export function autoLayout(nodes: TimelineNode[], edges: TimelineEdge[]): TimelineNode[] {
  const g = new dagre.graphlib.Graph();
  // rankdir=LR: 左到右排列(主轴水平方向)
  // nodesep=80: 同层节点垂直间距
  // ranksep=100: 不同层节点水平间距
  g.setGraph({ rankdir: "LR", nodesep: 80, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));

  // 注册节点(按类型设置尺寸)
  nodes.forEach((node) => {
    const width = node.data.nodeType === "main" ? 256 : 180;
    const height = node.data.nodeType === "main" ? 120 : 90;
    g.setNode(node.id, { width, height });
  });

  // 注册边
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  // 执行布局计算
  dagre.layout(g);

  // 应用计算结果到节点(主线 Y 固定)
  return nodes.map((node) => {
    const dagreNode = g.node(node.id);
    if (!dagreNode) return node;

    let y = dagreNode.y;
    // 主线节点强制 Y 固定(主轴对齐)
    if (node.data.nodeType === "main") {
      y = MAIN_AXIS_Y;
    }

    return {
      ...node,
      position: { x: dagreNode.x, y },
    };
  });
}
