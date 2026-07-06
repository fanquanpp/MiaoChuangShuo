// src/components/CharacterGraphNode.tsx
//
// 人物关系图编辑器自定义节点组件
// 基于 React Flow NodeProps, 通过 Zustand store 按 ID 订阅节点数据,
// 渲染角色姓名、身份标签、标签数组、简介预览、Handle 锚点。
//
// 【实现说明】
// 原实现使用 useNodesData(id) 从 React Flow 内部 store 读取节点数据,
// 但在受控模式下, store 中 nodes 变化后 useNodesData 可能无法及时感知 data 字段的更新,
// 导致抽屉编辑姓名后节点卡片仍显示旧值。改用 Zustand 直接订阅确保数据同步。
// NodeProps 仍使用默认 Node 类型(因 @xyflow/react v12 泛型约束与禁用 unknown 规则冲突),
// 但 id 与 selected 字段由 React Flow 正确注入。

import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { CharacterGraphNodeData } from "../lib/stores/characterGraphTypes";
import { DEFAULT_NODE_ACCENT } from "../lib/stores/characterGraphTypes";
import { useCharacterGraphStore } from "../lib/stores/characterGraphStore";

/**
 * 自定义节点组件
 * 输入: NodeProps (默认 Node 类型, id 与 selected 由 React Flow 注入)
 * 输出: JSX 角色节点卡片
 * 流程:
 *   1. 通过 Zustand store 按 ID 订阅节点数据, 确保 data 变化时及时重渲染
 *   2. 读取节点强调色(默认主色蓝)
 *   3. 渲染卡片边框、背景、姓名、身份标签、标签数组、简介预览
 *   4. 渲染 Handle 锚点(左侧 target, 右侧 source)
 */
export default function CharacterGraphNode({ id, selected }: NodeProps) {
  // 折叠状态: 本地 useState 维护(临时视图操作, 不持久化)
  // 折叠时仅显示角色名称与身份标识, 展开时显示全部字段(标签+简介)
  const [collapsed, setCollapsed] = useState(false);

  // 直接从 Zustand store 按 ID 订阅节点数据
  // 修复记录: 原实现使用 useNodesData(id) 从 React Flow 内部 store 读取,
  //   但在受控模式下, store 中 nodes 变化后 useNodesData 可能无法及时感知 data 字段的更新,
  //   导致抽屉编辑姓名后节点卡片仍显示旧值。改用 Zustand 直接订阅确保数据同步。
  // 性能: useCharacterGraphStore 选择器仅当目标节点引用变化时触发重渲染, 其他节点变化不影响本组件。
  const node = useCharacterGraphStore((s) => s.nodes.find((n) => n.id === id));
  if (!node) return null;

  const data: CharacterGraphNodeData = node.data;
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
        // 宽度固定 200px, 折叠时通过隐藏内容区实现"向下展开"效果 (非左右收窄)
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
          {/* 姓名行: 角色姓名 + 折叠/展开切换按钮 */}
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div
              className="text-sm font-bold font-display truncate flex-1 leading-tight"
              style={{ color: accent }}
              title={data.name}
            >
              {data.name || "未命名角色"}
            </div>
            {/* 折叠/展开切换按钮: 点击切换 collapsed 状态
                阻止 mousedown 冒泡避免触发 React Flow 的节点拖拽 */}
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

          {/* 身份标签(几何直角, 强调色填充提升识别度) - 折叠/展开均显示 */}
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

          {/* 折叠态: 隐藏标签数组与简介预览, 仅保留姓名+身份标识 */}
          {!collapsed && (
            <>
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
            </>
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
