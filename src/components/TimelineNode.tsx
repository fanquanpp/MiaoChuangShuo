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

import { useState } from "react";
import { Handle, Position, useNodesData, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { NODE_TYPE_COLORS, NODE_STATUS_MAP, EDGE_TYPE_COLORS } from "../lib/stores/timelineTypes";
import type { TimelineNodeData } from "../lib/stores/timelineTypes";
import { useI18n } from "../lib/i18n";

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
  // 本地折叠状态 (视图级操作, 与 CharacterGraphNode 保持一致, 不持久化)
  // 折叠时仅显示标题行, 展开时显示类型标签/状态徽章/摘要 (向下展开为长卡片)
  const [collapsed, setCollapsed] = useState(false);
  // 获取 i18n 翻译函数(用于将 NODE_STATUS_MAP 中 label 的 i18n key 转换为本地化文案)
  const { t } = useI18n();

  // 仅订阅当前节点的 data 字段变化(避免其他节点变化触发重渲染)
  // 不带泛型时返回 Node | undefined, data 为 Record<string, unknown>
  const nodeData = useNodesData(id);
  if (!nodeData) return null;

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
        nf-hover-float group relative rounded-none backdrop-blur-md
        transition-all duration-200 ease-fandex overflow-visible border
        ${selected
          ? "scale-[1.02] border-fandex-primary/70"
          : "border-nf-border-light/60 hover:border-fandex-primary/40"
        }
      `}
      style={{
        width: data.nodeType === "main" ? 256 : 184,
        // 磨砂玻璃 65% 透明度(硬约束保留): nf-bg-card 基色 rgba(22,24,33) 以 0.65 不透明度叠加
        backgroundColor: "rgba(22, 24, 33, 0.65)",
        // 多层阴影提升质感: 外阴影(深度) + 内顶部高光(立体感)
        // 选中态追加强调色外发光环, 强化焦点反馈
        boxShadow: selected
          ? `0 10px 28px rgba(0,0,0,0.45), 0 0 0 1px ${accent}aa, 0 0 0 4px ${accent}22, inset 0 1px 0 rgba(255,255,255,0.05)`
          : `0 4px 12px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.03)`,
      }}
    >
      {/* 输入锚点 - 左侧(绿色 fandex-secondary, 与右侧输出端口视觉区分, 明确"流入"语义)
       * id="left-target": Handle 唯一标识, 供 React Flow 精确追踪连线参与的具体 Handle,
       * 配合 timelineStore.addEdge 记录的 sourceHandle/targetHandle, 实现同向端点连接的精确渲染 */}
      <Handle
        type="target"
        position={Position.Left}
        id="left-target"
        className="!w-3.5 !h-3.5 !border-2 !border-nf-bg hover:!w-4 hover:!h-4 transition-all duration-fast"
        style={{ left: -7, backgroundColor: "var(--fandex-secondary)" }}
      />

      {/* 右下角微型装饰:呼应项目卡片的同心圆+几何元素,极低透明度不影响内容 */}
      <svg
        className="absolute -bottom-3 -right-3 w-20 h-20 opacity-[0.08] pointer-events-none group-hover:opacity-[0.15] transition-opacity duration-500"
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <circle cx="80" cy="80" r="28" stroke="currentColor" strokeWidth="0.6" className="text-fandex-primary" opacity="0.5" />
        <circle cx="80" cy="80" r="20" stroke="currentColor" strokeWidth="0.6" className="text-fandex-secondary" opacity="0.6" />
        <circle cx="80" cy="80" r="12" stroke="currentColor" strokeWidth="0.6" className="text-fandex-tertiary" opacity="0.7" />
      </svg>

      {/* 内层裁剪容器: overflow-hidden 限制高光反光效果在卡片边界内, 避免溢出污染画布 */}
      <div className="nf-card-sheen nf-card-dots relative overflow-hidden">
        {/* 内容区(统一内边距, 优化排版节奏, z 层级高于装饰) */}
        <div className="px-3.5 py-2.5 relative z-[1]">
          {/* 标题行: 标题 + 折叠/展开按钮 (所有节点均显示, 与 CharacterGraphNode 对齐) */}
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div className={`text-sm font-bold font-display ${colors.text} truncate flex-1 leading-tight`}>
              {data.title}
            </div>
            {/* 折叠/展开按钮: 点击切换本地 collapsed 状态
                使用 ChevronDown/Up 图标 (与 CharacterGraphNode 一致)
                阻止冒泡避免触发 React Flow 节点拖拽 */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((v) => !v);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="text-nf-text-tertiary hover:text-fandex-primary transition-colors duration-fast flex-shrink-0 mt-0.5"
              title={collapsed ? "展开" : "折叠"}
              aria-label={collapsed ? "展开节点" : "折叠节点"}
            >
              {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* 折叠态: 隐藏类型标签/状态徽章/摘要, 仅保留标题行 (向下展开为长卡片) */}
          {!collapsed && (
            <>
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
                  {t(statusInfo.label)}
                </span>
              </div>

              {/* 摘要预览(仅显示前 50 字, line-clamp-2 限制 2 行, 优化行高) */}
              {data.summary && (
                <div className="mt-1.5 text-xs text-nf-text-tertiary line-clamp-2 leading-relaxed">
                  {data.summary}
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部进度条装饰:呼应项目卡片美术,悬停时显现 */}
        <div
          className="absolute bottom-0 left-0 right-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
          style={{ background: `linear-gradient(90deg, ${accent}, ${accent}55 70%, transparent)` }}
        />
      </div>

      {/* 输出锚点 - 右侧(accent 强调色, 与左侧绿色输入端口视觉区分, 明确"流出"语义)
       * id="right-source": Handle 唯一标识, 与左侧 left-target 配对,
       * 供 React Flow 精确追踪连线参与的具体 Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="right-source"
        className="!w-3.5 !h-3.5 !border-2 !border-nf-bg hover:!w-4 hover:!h-4 transition-all duration-fast"
        style={{ right: -7, backgroundColor: accent }}
      />

      {/* 折叠角标(仅 main 节点折叠时显示, 微调尺寸与位置; 置于外层避免被 overflow-hidden 裁剪) */}
      {showFoldBadge && (
        <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-none bg-fandex-tertiary text-white text-[10px] font-bold flex items-center justify-center shadow-md">
          +{data.childCount}
        </div>
      )}
    </div>
  );
}
