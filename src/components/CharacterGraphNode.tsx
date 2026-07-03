// src/components/CharacterGraphNode.tsx
//
// 人物关系图编辑器自定义节点组件
// 基于 React Flow NodeProps, 使用 useNodesData 选择性订阅按节点 ID 订阅,
// 避免全量重渲染。渲染角色姓名、身份标签、标签数组、简介预览、Handle 锚点。
//
// 【Skill 偏差报备】
// 原 Skill/计划要求使用 NodeProps<CharacterGraphNode> 和 useNodesData<CharacterGraphNode> 泛型形式,
// 因 @xyflow/react v12.11.1 的 NodeProps 泛型约束要求 Node.data: Record<string, unknown>,
// 而 CharacterGraphNodeData 接口未声明 index signature(项目禁用 unknown 规则),
// 触发 TS2344 错误。经 tsc 验证,改用 NodeProps 不带泛型参数(默认 Node 类型),
// 内部通过 `as unknown as CharacterGraphNodeData` 双重断言恢复业务字段类型安全。
// 偏差依据: 与 TimelineNode.tsx 同源方案, tsc --noEmit 通过。

import { Handle, Position, useNodesData, type NodeProps } from "@xyflow/react";
import type { CharacterGraphNodeData } from "../lib/stores/characterGraphTypes";
import { DEFAULT_NODE_ACCENT } from "../lib/stores/characterGraphTypes";

/**
 * 自定义节点组件(性能优化版)
 * 输入: NodeProps (默认 Node 类型, 因泛型约束冲突无法使用 NodeProps<CharacterGraphNode>)
 * 输出: JSX 角色节点卡片
 * 流程:
 *   1. 通过 useNodesData 按 ID 订阅, 避免全量重渲染
 *   2. 双重断言将 Record<string, unknown> 还原为 CharacterGraphNodeData
 *   3. 读取节点强调色(默认主色蓝)
 *   4. 渲染卡片边框、背景、姓名、身份标签、标签数组、简介预览
 *   5. 渲染 Handle 锚点(左侧 target, 右侧 source)
 *
 * 关键: 因 NodeProps/useNodesData 泛型约束与项目禁用 unknown 规则冲突,
 *       此处使用默认 Node 类型, 通过双重断言恢复业务字段类型
 *       (Node.data: Record<string, unknown> -> CharacterGraphNodeData)
 */
export default function CharacterGraphNode({ id, selected }: NodeProps) {
  // 仅订阅当前节点的 data 字段变化(避免其他节点变化触发重渲染)
  // 不带泛型时返回 Node | undefined, data 为 Record<string, unknown>
  const nodeData = useNodesData(id);
  if (!nodeData) return null;

  // 双重断言: 将 Record<string, unknown> 还原为 CharacterGraphNodeData(类型安全由数据源保证)
  const data = nodeData.data as unknown as CharacterGraphNodeData;
  // 强调色: 优先使用节点自定义颜色, 缺省时回退到主色蓝
  const accent = data.accentColor || DEFAULT_NODE_ACCENT;

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
        width: 200,
        // 磨砂玻璃 65% 透明度(与 TimelineNode 保持一致视觉风格)
        backgroundColor: "rgba(22, 24, 33, 0.65)",
        // 多层阴影提升质感: 外阴影(深度) + 内顶部高光(立体感)
        // 选中态追加强调色外发光环, 强化焦点反馈
        boxShadow: selected
          ? `0 10px 28px rgba(0,0,0,0.45), 0 0 0 1px ${accent}aa, 0 0 0 4px ${accent}22, inset 0 1px 0 rgba(255,255,255,0.05)`
          : `0 4px 12px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.03)`,
      }}
    >
      {/* 输入锚点 - 左侧(accent 强调色, 与右侧输出端口视觉区分, 明确"流入"语义)
       * id="left-target": Handle 唯一标识, 供 React Flow 精确追踪连线参与的具体 Handle,
       * 配合 characterGraphStore.addEdge 记录的 sourceHandle/targetHandle, 实现同向端点连接的精确渲染 */}
      <Handle
        type="target"
        position={Position.Left}
        id="left-target"
        className="!w-3.5 !h-3.5 !border-2 !border-nf-bg hover:!w-4 hover:!h-4 transition-all duration-fast"
        style={{ left: -7, backgroundColor: accent }}
      />

      {/* 右下角微型装饰:呼应其他节点卡片的同心圆+几何元素,极低透明度不影响内容 */}
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
          {/* 姓名行: 角色姓名 + 关联文件标识(如有) */}
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div
              className="text-sm font-bold font-display truncate flex-1 leading-tight"
              style={{ color: accent }}
              title={data.name}
            >
              {data.name || "未命名角色"}
            </div>
          </div>

          {/* 身份标签(几何直角, 强调色填充提升识别度) */}
          {data.identity && (
            <div className="mb-1.5">
              <span
                className="inline-block text-[10px] px-1.5 py-0.5 font-medium tracking-wide text-white"
                style={{ backgroundColor: accent }}
              >
                {data.identity}
              </span>
            </div>
          )}

          {/* 标签数组(限定 3 个, 多余显示 +N) */}
          {data.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {data.tags.slice(0, 3).map((tag, idx) => (
                <span
                  key={`${tag}-${idx}`}
                  className="text-[10px] px-1.5 py-0.5 border border-nf-border-light text-nf-text-tertiary"
                >
                  {tag}
                </span>
              ))}
              {data.tags.length > 3 && (
                <span className="text-[10px] px-1.5 py-0.5 text-nf-text-tertiary">
                  +{data.tags.length - 3}
                </span>
              )}
            </div>
          )}

          {/* 简介预览(line-clamp-2 限制 2 行, 优化行高) */}
          {data.brief && (
            <div className="text-xs text-nf-text-tertiary line-clamp-2 leading-relaxed">
              {data.brief}
            </div>
          )}
        </div>

        {/* 底部进度条装饰:呼应其他节点美术,悬停时显现 */}
        <div
          className="absolute bottom-0 left-0 right-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
          style={{ background: `linear-gradient(90deg, ${accent}, ${accent}55 70%, transparent)` }}
        />
      </div>

      {/* 输出锚点 - 右侧(accent 强调色, 与左侧输入端口视觉区分, 明确"流出"语义)
       * id="right-source": Handle 唯一标识, 与左侧 left-target 配对,
       * 供 React Flow 精确追踪连线参与的具体 Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="right-source"
        className="!w-3.5 !h-3.5 !border-2 !border-nf-bg hover:!w-4 hover:!h-4 transition-all duration-fast"
        style={{ right: -7, backgroundColor: accent }}
      />
    </div>
  );
}
