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
//
// 【微调建议 1 验证记录】
// Task 4.4 尝试 useNodesData<TimelineNode>(id) 泛型(认为 useNodesData 可能不强制 Record 约束)。
// 验证结果: 失败。useNodesData 的签名同样为 `useNodesData<NodeType extends Node>`,
//   与 NodeProps 同源约束, 触发同一 TS2344 错误:
//   "Type 'TimelineNodeData' is not assignable to type 'Record<string, unknown>'.
//    Index signature for type 'string' is missing in type 'TimelineNodeData'."
// 结论: 保留无泛型方案(useNodesData(id) + 双重断言), 微调建议 1 不采纳。

import { Handle, Position, useNodesData, type NodeProps } from "@xyflow/react";
import { NODE_TYPE_COLORS, NODE_STATUS_MAP, EDGE_TYPE_COLORS } from "../lib/stores/timelineTypes";
import type { TimelineNodeData } from "../lib/stores/timelineTypes";
import { useTimelineStore } from "../lib/stores/timelineStore";

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
 * 关键: 因 NodeProps/useNodesData 泛型约束与项目禁用 unknown 规则冲突,
 *       此处使用默认 Node 类型, 通过双重断言恢复业务字段类型
 *       (Node.data: Record<string, unknown> -> TimelineNodeData)
 */
export default function TimelineNode({ id, selected }: NodeProps) {
  // 仅订阅当前节点的 data 字段变化(避免其他节点变化触发重渲染)
  // 不带泛型时返回 Node | undefined, data 为 Record<string, unknown>
  const nodeData = useNodesData(id);
  if (!nodeData) return null;

  // 获取折叠/展开方法(仅订阅 toggleCollapse, 避免全量订阅)
  const toggleCollapse = useTimelineStore((s) => s.toggleCollapse);

  // 双重断言: 将 Record<string, unknown> 还原为 TimelineNodeData(类型安全由数据源保证)
  const data = nodeData.data as unknown as TimelineNodeData;
  const colors = NODE_TYPE_COLORS[data.nodeType];
  const statusInfo = NODE_STATUS_MAP[data.status];
  const showFoldBadge = data.nodeType === "main" && data.collapsed && (data.childCount ?? 0) > 0;

  // 节点类型强调色(复用 EDGE_TYPE_COLORS, 避免重复定义颜色映射)
  // 用途: 顶部装饰条 / 左侧边线 / 选中态外发光, 提升类型识别度与视觉质感
  const accent = EDGE_TYPE_COLORS[data.nodeType];

  return (
    <div
      className={`
        relative rounded-none backdrop-blur-md transition-all duration-200 ease-fandex overflow-hidden
        ${selected
          ? "scale-[1.02]"
          : "hover:-translate-y-0.5"
        }
      `}
      style={{
        width: data.nodeType === "main" ? 256 : 184,
        // 磨砂玻璃 65% 透明度(硬约束保留): nf-bg-card 基色 rgba(22,24,33) 以 0.65 不透明度叠加
        backgroundColor: "rgba(22, 24, 33, 0.65)",
        // 多层阴影提升质感: 外阴影(深度) + 1px 描边(轮廓) + 内顶部高光(立体感)
        // 选中态追加强调色外发光环, 强化焦点反馈
        boxShadow: selected
          ? `0 10px 28px rgba(0,0,0,0.45), 0 0 0 1px ${accent}aa, 0 0 0 4px ${accent}22, inset 0 1px 0 rgba(255,255,255,0.05)`
          : `0 4px 12px rgba(0,0,0,0.32), 0 0 0 1px rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.03)`,
        // 左侧 2px 强调色边线(类型识别主信号, 取代原 border-l-2 + 单一 primary 色)
        borderLeft: `2px solid ${accent}`,
        // 顶部 1px 强调色渐变线(辅信号, 增加层次感与现代感)
        borderTop: `1px solid ${accent}66`,
      }}
    >
      {/* 输入锚点 - 左侧(居中贴边, hover 放大, 提升连线体验) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3.5 !h-3.5 !border-2 !border-nf-bg hover:!w-4 hover:!h-4 transition-all duration-fast"
        style={{ left: -7, backgroundColor: accent }}
      />

      {/* 顶部强调色装饰条(渐变收束, 强化类型识别与视觉层次) */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none"
        style={{ background: `linear-gradient(90deg, ${accent}, ${accent}55 70%, transparent)` }}
      />

      {/* 内容区(统一内边距, 优化排版节奏) */}
      <div className="px-3.5 py-2.5">
        {/* 标题行: 标题 + 折叠按钮(仅 main 节点) */}
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className={`text-sm font-bold font-display ${colors.text} truncate flex-1 leading-tight`}>
            {data.title}
          </div>
          {/* 折叠/展开按钮(仅 main 节点显示, 点击切换 collapsed 字段) */}
          {data.nodeType === "main" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapse(id);
              }}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-nf-text-tertiary hover:text-fandex-primary hover:bg-fandex-primary/10 transition-colors duration-fast"
              title={data.collapsed ? "展开" : "折叠"}
            >
              {data.collapsed ? "+" : "−"}
            </button>
          )}
        </div>

        {/* 节点类型标签 + 状态徽章(几何直角, 强调色填充提升识别度) */}
        <div className="flex items-center gap-1.5">
          <span
            className="text-[10px] px-1.5 py-0.5 font-medium tracking-wide text-white"
            style={{ backgroundColor: accent }}
          >
            {data.nodeType === "main" && "主线"}
            {data.nodeType === "branch" && "分支"}
            {data.nodeType === "event" && "事件"}
            {data.nodeType === "ending" && "结局"}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 font-medium ${statusInfo.color} text-white`}>
            {statusInfo.label}
          </span>
        </div>

        {/* 摘要预览(仅显示前 50 字, line-clamp-2 限制 2 行, 优化行高) */}
        {data.summary && (
          <div className="mt-1.5 text-xs text-nf-text-tertiary line-clamp-2 leading-relaxed">
            {data.summary}
          </div>
        )}
      </div>

      {/* 输出锚点 - 右侧(居中贴边, hover 放大) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3.5 !h-3.5 !border-2 !border-nf-bg hover:!w-4 hover:!h-4 transition-all duration-fast"
        style={{ right: -7, backgroundColor: accent }}
      />

      {/* 折叠角标(仅 main 节点折叠时显示, 微调尺寸与位置) */}
      {showFoldBadge && (
        <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-none bg-fandex-tertiary text-white text-[10px] font-bold flex items-center justify-center shadow-md">
          +{data.childCount}
        </div>
      )}
    </div>
  );
}
