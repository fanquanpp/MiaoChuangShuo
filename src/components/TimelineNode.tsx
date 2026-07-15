// src/components/TimelineNode.tsx
//
// 时间线编辑器自定义节点组件
// 基于 React Flow NodeProps<TimelineNode>, 使用 useNodesData<TimelineNode> 按节点 ID 选择性订阅,
// 避免全量重渲染。渲染标题、类型标签、状态徽章、摘要预览、折叠角标、Handle 锚点。
//
// 类型策略说明(Task 2.6):
//   早期因 TimelineNodeData 声明为 interface, 缺乏隐式索引签名,
//   无法满足 @xyflow/react v12 的 Node<NodeData extends Record<string, unknown>> 约束,
//   被迫使用 `as unknown as TimelineNodeData` 双重断言。
//   现已将 TimelineNodeData 改为 type 别名(见 timelineTypes.ts),
//   TypeScript 会为 type 别名对象类型推导隐式索引签名, 满足 Record<string, unknown> 约束,
//   故可直接使用 NodeProps<TimelineNode> / useNodesData<TimelineNode> 泛型形式, 无需断言。

import { useState } from "react";
import { Handle, Position, useNodesData, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { NODE_TYPE_COLORS, NODE_STATUS_MAP, EDGE_TYPE_COLORS } from "../lib/stores/timelineTypes";
import type { TimelineNode, TimelineNodeData } from "../lib/stores/timelineTypes";
import { useI18n } from "../lib/i18n";

/**
 * 自定义节点组件(性能优化版)
 * 输入: NodeProps<TimelineNode> 业务节点泛型, data 直接为 TimelineNodeData
 * 输出: JSX 节点卡片
 * 流程:
 *   1. 通过 useNodesData<TimelineNode> 按 ID 订阅, 避免全量重渲染
 *   2. 直接读取 nodeData.data 作为 TimelineNodeData(无需断言)
 *   3. 读取节点类型对应的颜色配置
 *   4. 渲染卡片边框、背景、标题、状态徽章
 *   5. 渲染折叠角标(仅 main 节点且 collapsed=true)
 *   6. 渲染 Handle 锚点(左侧 target, 右侧 source)
 */
export default function TimelineNode({ id, selected }: NodeProps<TimelineNode>) {
  // 本地折叠状态 (视图级操作, 与 CharacterGraphNode 保持一致, 不持久化)
  // 折叠时仅显示标题行, 展开时显示类型标签/状态徽章/摘要 (向下展开为长卡片)
  const [collapsed, setCollapsed] = useState(false);
  // 获取 i18n 翻译函数(用于将 NODE_STATUS_MAP 中 label 的 i18n key 转换为本地化文案)
  const { t } = useI18n();

  // 仅订阅当前节点的 data 字段变化(避免其他节点变化触发重渲染)
  // 带泛型<TimelineNode>时返回 { id, type, data: TimelineNodeData } | null, 类型安全
  const nodeData = useNodesData<TimelineNode>(id);
  if (!nodeData) return null;

  // nodeData.data 已是 TimelineNodeData 类型, 无需双重断言
  const data: TimelineNodeData = nodeData.data;
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
