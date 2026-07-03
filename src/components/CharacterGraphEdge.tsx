// src/components/CharacterGraphEdge.tsx
//
// 人物关系图编辑器自定义连线组件
// 基于 React Flow EdgeProps, 使用 getBezierPath 计算贝塞尔曲线路径。
// 颜色按关系类型区分(师徒蓝/敌对红/亲属绿/朋友黄/恋人粉/上下级紫/同门橙/其他灰),
// 中点显示关系类型标签, 选中态加粗。

import { type EdgeProps, getBezierPath, EdgeLabelRenderer } from "@xyflow/react";
import { RELATION_TYPE_COLORS, RELATION_TYPE_LABELS } from "../lib/stores/characterGraphTypes";
import type { CharacterGraphEdge, RelationType } from "../lib/stores/characterGraphTypes";
import { useCharacterGraphStore } from "../lib/stores/characterGraphStore";

/**
 * 自定义连线组件
 * 输入: EdgeProps<CharacterGraphEdge> React Flow 边属性(引用统一类型)
 * 输出: SVG 路径(统一平滑曲线 + 颜色区分) + 中点关系标签
 * 流程:
 *   1. 读取关系类型对应颜色与中文标签
 *   2. 调用 getBezierPath 计算贝塞尔路径与中点坐标
 *   3. 渲染路径(无动画, 符合"统一曲线+颜色区分"决策)
 *   4. 通过 EdgeLabelRenderer 在中点渲染关系标签(可点击编辑)
 *
 * 关键: 泛型引用统一 CharacterGraphEdge 类型, 避免与后端结构脱节
 */
export default function CharacterGraphEdgeComponent(props: EdgeProps<CharacterGraphEdge>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
  } = props;

  // 获取 selectEdge 方法(用于中点关系标签点击触发连线抽屉编辑)
  const selectEdge = useCharacterGraphStore((s) => s.selectEdge);

  // 关系类型默认 other(data 可能未初始化时回退)
  const relationType: RelationType = data?.relationType ?? "other";
  const color = RELATION_TYPE_COLORS[relationType];
  const label = RELATION_TYPE_LABELS[relationType];

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <path
        id={id}
        d={edgePath}
        stroke={color}
        strokeWidth={selected ? 3 : 2}
        fill="none"
        opacity={selected ? 1 : 0.75}
        style={{ transition: "stroke-width 0.15s ease, opacity 0.15s ease" }}
      />
      {/* 中点关系标签: 通过 EdgeLabelRenderer 渲染为 HTML 元素, 可点击触发编辑 */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          <span
            onClick={(e) => {
              // 点击关系标签触发连线抽屉编辑(关系类型与描述)
              e.stopPropagation();
              selectEdge(id);
            }}
            className="inline-block px-1.5 py-0.5 text-[10px] font-medium text-white border border-nf-bg shadow-sm cursor-pointer hover:opacity-80 transition-opacity"
            style={{ backgroundColor: color }}
            title={data?.description || label}
          >
            {label}
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
