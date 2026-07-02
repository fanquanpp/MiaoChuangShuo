// src/components/TimelinePanel.tsx
//
// 时间线编辑器画布容器组件
// 集成 ReactFlow 画布, 加载/渲染节点与边, 注册 nodeTypes/edgeTypes,
// 处理 onNodesChange/onEdgesChange/onConnect 回调,
// 集成快捷键(Ctrl+S/L/Z/Y), 集成自动保存监听, 隔离 Tauri 拖拽冲突。
//
// 【Skill 偏差报备】
// 原 Skill 计划使用 `import ReactFlow, { ... } from "@xyflow/react"` 默认导入形式。
// 偏差原因: @xyflow/react v12.11.1 的类型声明(index.d.ts)以命名导出形式
//   `export { default as ReactFlow }` 暴露 ReactFlow 组件, 无默认导出,
//   默认导入形式导致 TS2786 "cannot be used as a JSX component"。
// 偏差调整: 改用命名导入 `import { ReactFlow, ... }`。
// 同源偏差: 与 timelineStore.ts 一致, 传递给 ReactFlow 的 nodes/edges 属性
//   需 `as unknown as Node[]` / `as unknown as Edge[]` 双重断言, 因 TimelineNodeData
//   缺少 `Record<string, unknown>` 索引签名(项目禁用 unknown 规则)。
// 验证依据: tsc --noEmit 通过。

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useAppStore } from "../lib/store";
import { useTimelineStore } from "../lib/stores/timelineStore";
import { autoLayout } from "../lib/dagreLayout";
import { EDGE_TYPE_COLORS } from "../lib/stores/timelineTypes";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";

import TimelineNode from "./TimelineNode";
import TimelineEdge from "./TimelineEdge";
import TimelineEmpty from "./TimelineEmpty";

/**
 * 时间线画布容器组件
 * 输入: 无(通过 useAppStore 获取当前项目, useTimelineStore 获取节点数据)
 * 输出: JSX 画布界面(含 ReactFlow + 工具栏 + 空状态)
 * 流程:
 *   1. 加载时调用 loadGraph 从后端读取图谱
 *   2. 渲染 ReactFlow 画布(节点/边/背景/MiniMap/Controls)
 *   3. 注册 onNodesChange/onEdgesChange/onConnect 回调
 *   4. 注册快捷键监听(Ctrl+S/L/Z/Y, Escape)
 *   5. 隔离 Tauri 拖拽冲突(data-tauri-drag-region="false")
 *   6. 监听 nodes/edges 变化自动触发防抖保存
 */
export default function TimelinePanel() {
  const currentProject = useAppStore((s) => s.currentProject);
  const activeCategory = useAppStore((s) => s.activeCategory);

  const nodes = useTimelineStore((s) => s.nodes);
  const edges = useTimelineStore((s) => s.edges);
  const loading = useTimelineStore((s) => s.loading);
  const loadGraph = useTimelineStore((s) => s.loadGraph);
  const onNodesChange = useTimelineStore((s) => s.onNodesChange);
  const onEdgesChange = useTimelineStore((s) => s.onEdgesChange);
  const addEdge = useTimelineStore((s) => s.addEdge);
  const selectNode = useTimelineStore((s) => s.selectNode);
  const undo = useTimelineStore((s) => s.undo);
  const redo = useTimelineStore((s) => s.redo);
  const saveNow = useTimelineStore((s) => s.saveNow);
  const debouncedSave = useTimelineStore((s) => s.debouncedSave);

  const { showToast } = useToast();
  const { t } = useI18n();

  // nodeTypes / edgeTypes 必须在组件外定义或 useMemo, 避免每次渲染重新创建导致 React Flow 警告
  const nodeTypes: NodeTypes = useMemo(() => ({ storyNode: TimelineNode }), []);
  const edgeTypes: EdgeTypes = useMemo(() => ({ storyEdge: TimelineEdge }), []);

  // 加载图谱
  useEffect(() => {
    if (currentProject) {
      loadGraph(currentProject.path);
    }
  }, [currentProject, loadGraph]);

  // 自动保存监听(任何 nodes/edges 变化均触发防抖保存, 含 undo/redo 触发的变化)
  // 使用 Zustand 默认 subscribe + 手动比较(不依赖 subscribeWithSelector 中间件)
  const projectRef = useRef(currentProject);
  projectRef.current = currentProject;

  useEffect(() => {
    const unsub = useTimelineStore.subscribe((state, prevState) => {
      if (state.nodes !== prevState.nodes || state.edges !== prevState.edges) {
        const proj = projectRef.current;
        if (proj) {
          debouncedSave(proj.path, proj.meta.name);
        }
      }
    });
    return unsub;
  }, [debouncedSave]);

  // Ctrl+L 整理布局
  const handleAutoLayout = useCallback(() => {
    const { nodes: curNodes, edges: curEdges } = useTimelineStore.getState();
    const layoutedNodes = autoLayout(curNodes, curEdges);
    useTimelineStore.setState({ nodes: layoutedNodes });
    showToast("success", t("timeline.toast.layoutApplied"));
  }, [showToast, t]);

  // 快捷键监听(仅在 activeCategory === "timeline" 时生效)
  useEffect(() => {
    if (activeCategory !== "timeline") return;

    const handler = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // 焦点元素判断: 输入框聚焦时不拦截 Ctrl+Z/Y/L(放行原生撤销/重做/定位)
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Ctrl+S 始终拦截(保存是全局行为)
      if (isMod && !e.shiftKey && key === "s") {
        e.preventDefault();
        e.stopPropagation();
        if (currentProject) {
          saveNow(currentProject.path, currentProject.meta.name);
        }
        return;
      }

      // 以下快捷键仅在非输入框聚焦时拦截
      if (isInputFocused) return;

      // Ctrl+L 整理布局
      if (isMod && !e.shiftKey && key === "l") {
        e.preventDefault();
        e.stopPropagation();
        handleAutoLayout();
        return;
      }

      // Ctrl+Z 撤销(无 Shift)
      if (isMod && !e.shiftKey && key === "z") {
        e.preventDefault();
        e.stopPropagation();
        undo();
        return;
      }

      // Ctrl+Shift+Z 或 Ctrl+Y 重做(显式括号组合, 避免运算符优先级缺陷)
      if (isMod && (
        (e.shiftKey && key === "z") ||
        (!e.shiftKey && key === "y")
      )) {
        e.preventDefault();
        e.stopPropagation();
        redo();
        return;
      }

      // Escape 关闭抽屉/取消选中
      if (e.key === "Escape") {
        selectNode(null);
        return;
      }
    };

    // 使用 capture 阶段拦截, 确保在编辑器/其他组件之前处理
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [activeCategory, currentProject, saveNow, undo, redo, selectNode, handleAutoLayout]);

  // onConnect: 创建新连线(已含自环/重复校验)
  const handleConnect = useCallback((connection: Connection) => {
    addEdge(connection);
  }, [addEdge]);

  // 是否显示空状态
  const isEmpty = nodes.length === 0 && !loading;

  return (
    <div
      className="h-full w-full relative"
      data-tauri-drag-region="false"
      onDragStart={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {isEmpty && <TimelineEmpty />}

      <ReactFlow
        nodes={nodes as unknown as Node[]}
        edges={edges as unknown as Edge[]}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onNodeClick={(_: ReactMouseEvent, node: Node) => selectNode(node.id)}
        onPaneClick={() => selectNode(null)}
        onlyRenderVisibleElements={true}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{ type: "storyEdge" }}
        className="bg-nf-bg"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <MiniMap
          nodeColor={(node) => {
            const nodeType = (node.data as { nodeType?: string } | undefined)?.nodeType ?? "main";
            return EDGE_TYPE_COLORS[nodeType as keyof typeof EDGE_TYPE_COLORS] ?? "#6EA8FE";
          }}
          maskColor="rgba(0,0,0,0.4)"
        />
        <Controls />
      </ReactFlow>
    </div>
  );
}
