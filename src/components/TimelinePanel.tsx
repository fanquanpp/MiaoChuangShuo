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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { TimelineNodeType, TimelineNode as StoryTimelineNode } from "../lib/stores/timelineTypes";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";

import TimelineNode from "./TimelineNode";
import TimelineEdge from "./TimelineEdge";
import TimelineEmpty from "./TimelineEmpty";
import TimelineContextMenu from "./TimelineContextMenu";
import TimelineDrawer from "./TimelineDrawer";

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
  const selectedNodeId = useTimelineStore((s) => s.selectedNodeId);
  const undo = useTimelineStore((s) => s.undo);
  const redo = useTimelineStore((s) => s.redo);
  const saveNow = useTimelineStore((s) => s.saveNow);
  const debouncedSave = useTimelineStore((s) => s.debouncedSave);

  const { showToast } = useToast();
  const { t } = useI18n();

  // 右键菜单状态(null 表示菜单关闭)
  // 包含菜单位置与触发节点信息(画布空白时 nodeId/nodeType 均为 null)
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string | null;
    nodeType: TimelineNodeType | null;
  } | null>(null);

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

  /**
   * 创建新节点并可选地连线到父节点
   * 输入: type 节点类型, position 画布坐标, parentId 父节点 ID(可选)
   * 输出: void
   * 流程:
   *   1. 构造 TimelineNode(含默认值)
   *   2. 添加到 store.nodes
   *   3. 若 parentId 存在, 创建对应类型的边
   */
  const handleCreateNode = useCallback(
    (type: TimelineNodeType, position: { x: number; y: number }, parentId?: string) => {
      const now = new Date().toISOString();
      const newNode: StoryTimelineNode = {
        id: `node_${crypto.randomUUID()}`,
        type: "storyNode",
        position,
        data: {
          title:
            type === "main"
              ? "新主线节点"
              : type === "branch"
                ? "新分支"
                : type === "event"
                  ? "新事件"
                  : "新结局",
          nodeType: type,
          summary: "",
          coreConflict: "",
          foreshadowing: "",
          status: "planned",
          order: 0,
          collapsed: false,
          childCount: 0,
          createdAt: now,
          updatedAt: now,
        },
      };

      useTimelineStore.setState((state) => ({ nodes: [...state.nodes, newNode] }));

      // 若有父节点, 创建连线
      if (parentId) {
        const newEdge = {
          id: `edge_${crypto.randomUUID()}`,
          source: parentId,
          target: newNode.id,
          type: "storyEdge" as const,
          data: { edgeKind: type },
        };
        useTimelineStore.setState((state) => ({ edges: [...state.edges, newEdge] }));
      }
    },
    []
  );

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

  /**
   * 节点右键菜单触发
   * 输入: event 鼠标事件, node React Flow 节点对象
   * 输出: void
   * 流程: 阻止默认菜单, 记录位置与节点类型, 打开自定义菜单
   */
  const handleNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node) => {
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        nodeId: node.id,
        nodeType: (node.data as { nodeType?: TimelineNodeType })?.nodeType ?? null,
      });
    },
    []
  );

  /**
   * 画布空白右键菜单触发
   * 输入: event 鼠标事件(ReactFlow 传入 native MouseEvent 或 React MouseEvent)
   * 输出: void
   * 流程: 阻止默认菜单, 记录位置, nodeType 置空表示画布空白
   */
  const handlePaneContextMenu = useCallback((event: MouseEvent | ReactMouseEvent) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      nodeId: null,
      nodeType: null,
    });
  }, []);

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
        onNodeDoubleClick={(_: ReactMouseEvent, node: Node) => selectNode(node.id)}
        onPaneClick={() => selectNode(null)}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
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

      {contextMenu && (
        <TimelineContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeType={contextMenu.nodeType}
          onCreateNode={(type, pos) => {
            handleCreateNode(type, pos, contextMenu.nodeId ?? undefined);
            setContextMenu(null);
          }}
          onEditDetail={() => {
            if (contextMenu.nodeId) selectNode(contextMenu.nodeId);
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {selectedNodeId && (
        <TimelineDrawer
          nodeId={selectedNodeId}
          onClose={() => selectNode(null)}
        />
      )}
    </div>
  );
}
