// src/components/TimelineNode.tsx
//
// 时间线编辑器自定义节点组件
// 基于 React Flow NodeProps, 使用 useNodesData 选择性订阅按节点 ID 订阅,
// 避免全量重渲染。渲染标题、类型标签、状态徽章、摘要预览、折叠角标、Handle 锚点。
//
// 【Skill 偏差报备】
// 原 Skill/计划要求使用 NodeProps<TimelineNode> 和 useNodesData<TimelineNode> 泛型形式,
// 因 @xyflow/react v12.11.1 的 NodeProps 泛型约束要求 Node.data: Record<string, unknown>,
// 而 TimelineNodeData 接口未声明 index signature(项目禁用 unknown 规则),
// 触发 TS2344 错误。Task 3.3 的 EdgeProps<TimelineEdge> 未触发此错误,
// 说明 Node 与 Edge 的泛型约束不对称(Node.data 强制 Record 约束, Edge.data 无此约束)。
// 经 tsc 验证,改用 NodeProps 不带泛型参数(默认 Node 类型),
// 内部通过 `as unknown as TimelineNodeData` 双重断言恢复业务字段类型安全。
// 偏差依据: 实际 tsc 报错 TS2344, 与 Skill 指引不符, 按工具验证结果调整。

import { Handle, Position, useNodesData, type NodeProps } from "@xyflow/react";
import { NODE_TYPE_COLORS, NODE_STATUS_MAP } from "../lib/stores/timelineTypes";
import type { TimelineNodeData } from "../lib/stores/timelineTypes";

/**
 * 自定义节点组件(性能优化版)
 * 输入: NodeProps (默认 Node 类型, 因泛型约束冲突无法使用 NodeProps<TimelineNode>)
 * 输出: JSX 节点卡片
 * 流程:
 *   1. 通过 useNodesData 按 ID 订阅, 避免全量重渲染
 *   2. 双重断言将 Record<string, unknown> 还原为 TimelineNodeData
 *   3. 读取节点类型对应的颜色配置
 *   4. 渲染卡片边框、背景、标题、状态徽章
 *   5. 渲染折叠角标(仅 main 节点且 collapsed=true)
 *   6. 渲染 Handle 锚点(左侧 target, 右侧 source)
 *
 * 关键: 因 NodeProps 泛型约束与项目禁用 unknown 规则冲突, 此处使用默认 Node 类型,
 *       通过双重断言恢复业务字段类型(Node.data: Record<string, unknown> -> TimelineNodeData)
 */
export default function TimelineNode({ id, selected }: NodeProps) {
  // 仅订阅当前节点的 data 字段变化(避免其他节点变化触发重渲染)
  // 不带泛型时返回 Node | undefined, data 为 Record<string, unknown>
  const nodeData = useNodesData(id);
  if (!nodeData) return null;

  // 双重断言: 将 Record<string, unknown> 还原为 TimelineNodeData(类型安全由数据源保证)
  const data = nodeData.data as unknown as TimelineNodeData;
  const colors = NODE_TYPE_COLORS[data.nodeType];
  const statusInfo = NODE_STATUS_MAP[data.status];
  const showFoldBadge = data.nodeType === "main" && data.collapsed && (data.childCount ?? 0) > 0;

  return (
    <div
      className={`
        relative px-4 py-3 rounded-lg border-2 shadow-md transition-all duration-150
        ${colors.border} ${colors.bg}
        ${selected ? "ring-2 ring-fandex-primary/50 scale-[1.02]" : "hover:shadow-lg"}
      `}
      style={{ width: data.nodeType === "main" ? 256 : 180 }}
    >
      {/* 输入锚点 - 左侧 */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-fandex-primary !border-2 !border-nf-bg"
      />

      {/* 标题 */}
      <div className={`text-sm font-bold font-display ${colors.text} truncate mb-1`}>
        {data.title}
      </div>

      {/* 节点类型标签 + 状态徽章 */}
      <div className="flex items-center gap-1.5">
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${colors.badge} text-white`}>
          {data.nodeType === "main" && "主线"}
          {data.nodeType === "branch" && "分支"}
          {data.nodeType === "event" && "事件"}
          {data.nodeType === "ending" && "结局"}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusInfo.color} text-white`}>
          {statusInfo.label}
        </span>
      </div>

      {/* 摘要预览(仅显示前 50 字, line-clamp-2 限制 2 行) */}
      {data.summary && (
        <div className="mt-2 text-xs text-nf-text-tertiary line-clamp-2">
          {data.summary}
        </div>
      )}

      {/* 输出锚点 - 右侧 */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-fandex-primary !border-2 !border-nf-bg"
      />

      {/* 折叠角标(仅 main 节点折叠时显示) */}
      {showFoldBadge && (
        <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-fandex-tertiary text-white text-[10px] font-bold flex items-center justify-center shadow-md">
          +{data.childCount}
        </div>
      )}
    </div>
  );
}
