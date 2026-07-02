// src/components/TimelineEdge.tsx
//
// 时间线编辑器自定义连线组件
// 基于 React Flow EdgeProps, 使用 getBezierPath 计算贝塞尔曲线路径。
// 颜色按边类型区分(main 蓝/branch 绿/event 橙/ending 灰), 选中态加粗。

import { type EdgeProps, getBezierPath } from "@xyflow/react";
import { EDGE_TYPE_COLORS } from "../lib/stores/timelineTypes";
import type { TimelineEdge } from "../lib/stores/timelineTypes";

/**
 * 自定义连线组件
 * 输入: EdgeProps<TimelineEdge> React Flow 边属性(引用统一类型)
 * 输出: SVG 路径(统一平滑曲线 + 颜色区分)
 * 流程:
 *   1. 读取边类型对应颜色
 *   2. 调用 getBezierPath 计算贝塞尔路径
 *   3. 渲染路径(无动画, 符合"统一曲线+颜色区分"决策)
 *
 * 关键: 泛型引用统一 TimelineEdge 类型, 避免与后端结构脱节
 */
export default function TimelineEdgeComponent(props: EdgeProps<TimelineEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } = props;

  // 边类型默认 main(data 可能未初始化时回退)
  const edgeKind = data?.edgeKind ?? "main";
  const color = EDGE_TYPE_COLORS[edgeKind];

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <path
      id={id}
      d={edgePath}
      stroke={color}
      strokeWidth={selected ? 3 : 2}
      fill="none"
      opacity={selected ? 1 : 0.7}
      style={{ transition: "stroke-width 0.15s ease, opacity 0.15s ease" }}
    />
  );
}
