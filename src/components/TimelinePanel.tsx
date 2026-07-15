// src/components/TimelinePanel.tsx
//
// 时间线编辑器画布容器组件
// 通过 GraphPanelShell 包装, 注入时间线专属的节点/边组件、右键菜单、抽屉、
// 自动布局实现与折叠过滤逻辑, 复用通用的画布渲染、工具栏、拖拽优化、快捷键、
// 自动保存订阅等基础设施。
//
// 业务专属职责:
//   1. 加载图谱(loadGraph, 仅在 currentProject 变化时调用)
//   2. 应用折叠可达性过滤(filterCollapsed, BFS 从未折叠 main 节点出发)
//   3. 注册 nodeTypes/edgeTypes(storyNode / storyEdge)
//   4. 实现时间线专属的 handleCreateNode(支持 type + parentId 连线)
//   5. 实现时间线专属的 handleAutoLayout(调用 dagreLayout.autoLayout)
//   6. 渲染 TimelineContextMenu 与 TimelineDrawer
//   7. 配置 i18n 命名空间(timeline.*)
//
// 【Skill 偏差报备】
// 原 Skill 计划使用 `import ReactFlow, { ... } from "@xyflow/react"` 默认导入形式。
// 偏差原因: @xyflow/react v12.11.1 的类型声明以命名导出形式暴露 ReactFlow 组件,
//   无默认导出, 默认导入形式导致 TS2786。
// 偏差调整: GraphPanelShell 已改用命名导入 `import { ReactFlow, ... }`,
//   本组件不再直接导入 ReactFlow, 由 GraphPanelShell 代理画布渲染。
// Task 2.6 更新: GraphPanelShell 已通过 TNode extends Node / TEdge extends Edge 泛型约束
//   直接传递 nodes/edges, 不再需要 `as unknown as Node[]` / `as unknown as Edge[]` 双重断言。
// 验证依据: tsc --noEmit 通过。

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type {
  NodeTypes,
  EdgeTypes,
  Node,
} from "@xyflow/react";

import { useAppStore } from "../lib/store";
import { useTimelineStore, filterCollapsed } from "../lib/stores/timelineStore";
import { autoLayout } from "../lib/dagreLayout";
import { findFileByPath } from "../lib/fileTreeUtils";
import { EDGE_TYPE_COLORS } from "../lib/stores/timelineTypes";
import type {
  TimelineNodeType,
  TimelineNode as StoryTimelineNode,
  TimelineEdge as StoryTimelineEdge,
} from "../lib/stores/timelineTypes";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";

import TimelineNodeComponent from "./TimelineNode";
import TimelineEdgeComponent from "./TimelineEdge";
import TimelineEmpty from "./TimelineEmpty";
import TimelineContextMenu from "./TimelineContextMenu";
import TimelineDrawer from "./TimelineDrawer";
import {
  GraphPanelShell,
  DefaultConnectionLine,
  type StoreAdapter,
  type GraphI18nNamespace,
} from "./graph/GraphPanelShell";

/**
 * 时间线面板专属的右键菜单状态
 * 包含菜单位置与触发节点信息(画布空白时 nodeId/nodeType 均为 null)
 */
interface TimelineContextMenuState {
  /** 屏幕坐标 X(clientX) */
  x: number;
  /** 屏幕坐标 Y(clientY) */
  y: number;
  /** 触发右键的节点 ID(null 表示画布空白处右键) */
  nodeId: string | null;
  /** 触发右键的节点类型(null 表示画布空白处右键) */
  nodeType: TimelineNodeType | null;
}

/**
 * 拖拽前快照类型(与 zundo pastStates 元素类型一致)
 * 含 nodes/edges 快照, onNodeDragStop 时推入 pastStates
 */
type TimelineSnapshot = {
  nodes: StoryTimelineNode[];
  edges: StoryTimelineEdge[];
};

/**
 * 时间线 i18n 文案命名空间
 * 将 timeline.* 系列 key 映射到 GraphPanelShell 通用工具栏渲染所需的字段
 */
const TIMELINE_I18N_NAMESPACE: GraphI18nNamespace = {
  saving: "timeline.saving",
  save: "timeline.save",
  autoSaved: "timeline.autoSaved",
  saveFailed: "timeline.toast.saveFailed",
  saved: "timeline.toast.saved",
  clearConfirm: "timeline.toast.clearConfirm",
  cleared: "timeline.toast.cleared",
  clearTitle: "timeline.clearGraphTitle",
  layoutApplied: "timeline.toast.layoutApplied",
};

/**
 * Store 适配器
 * 将 useTimelineStore 包装为 GraphPanelShell 所需的 StoreAdapter 接口,
 * 仅暴露 getState/subscribe/temporal 三个能力, 隔离业务 store 类型。
 */
const timelineStoreAdapter: StoreAdapter<
  StoryTimelineNode,
  StoryTimelineEdge,
  TimelineSnapshot
> = {
  getState: () => {
    const state = useTimelineStore.getState();
    return { nodes: state.nodes, edges: state.edges };
  },
  subscribe: (listener) =>
    useTimelineStore.subscribe((state, prevState) => {
      listener(
        { nodes: state.nodes, edges: state.edges },
        { nodes: prevState.nodes, edges: prevState.edges }
      );
    }),
  temporal: {
    getState: () => {
      const ts = useTimelineStore.temporal.getState();
      return {
        pause: ts.pause,
        resume: ts.resume,
        pastStates: ts.pastStates as TimelineSnapshot[],
        futureStates: ts.futureStates as TimelineSnapshot[],
      };
    },
    setState: (partial) => {
      useTimelineStore.temporal.setState({
        ...(partial.pastStates !== undefined
          ? { pastStates: partial.pastStates }
          : {}),
        ...(partial.futureStates !== undefined
          ? { futureStates: partial.futureStates }
          : {}),
      } as never);
    },
  },
};

/**
 * 时间线画布容器组件
 * 输入: 无(通过 useAppStore 获取当前项目, useTimelineStore 获取节点数据)
 * 输出: JSX 画布界面(通过 GraphPanelShell 包装, 注入业务专属内容)
 * 流程:
 *   1. 加载时调用 loadGraph 从后端读取图谱
 *   2. 应用 filterCollapsed 折叠可达性过滤
 *   3. 注册 nodeTypes/edgeTypes(storyNode / storyEdge)
 *   4. 通过 GraphPanelShell 渲染画布与工具栏
 *   5. 注入 TimelineContextMenu 与 TimelineDrawer
 */
export default function TimelinePanel() {
  const currentProject = useAppStore((s) => s.currentProject);
  const activeCategory = useAppStore((s) => s.activeCategory);
  const projectTree = useAppStore((s) => s.projectTree);
  const navigateToFile = useAppStore((s) => s.navigateToFile);

  const allNodes = useTimelineStore((s) => s.nodes);
  const allEdges = useTimelineStore((s) => s.edges);

  // 应用折叠可达性过滤: BFS 从未折叠 main 节点出发, 隐藏折叠分支的子树
  const { visibleNodes: nodes, visibleEdges: edges } = useMemo(
    () => filterCollapsed(allNodes, allEdges),
    [allNodes, allEdges]
  );

  const loading = useTimelineStore((s) => s.loading);
  const loadGraph = useTimelineStore((s) => s.loadGraph);
  const onNodesChange = useTimelineStore((s) => s.onNodesChange);
  const onEdgesChange = useTimelineStore((s) => s.onEdgesChange);
  const addEdge = useTimelineStore((s) => s.addEdge);
  const selectNode = useTimelineStore((s) => s.selectNode);
  const deleteNode = useTimelineStore((s) => s.deleteNode);
  const clearGraph = useTimelineStore((s) => s.clearGraph);
  const selectedNodeId = useTimelineStore((s) => s.selectedNodeId);
  const undo = useTimelineStore((s) => s.undo);
  const redo = useTimelineStore((s) => s.redo);
  const saveNow = useTimelineStore((s) => s.saveNow);
  const debouncedSave = useTimelineStore((s) => s.debouncedSave);
  const saving = useTimelineStore((s) => s.saving);
  const saveError = useTimelineStore((s) => s.error);

  const { showToast } = useToast();
  const { t } = useI18n();

  // 右键菜单状态(null 表示菜单关闭)
  const [contextMenu, setContextMenu] = useState<TimelineContextMenuState | null>(null);

  // nodeTypes / edgeTypes 必须在组件外定义或 useMemo, 避免每次渲染重新创建导致 React Flow 警告
  const nodeTypes: NodeTypes = useMemo(() => ({ storyNode: TimelineNodeComponent }), []);
  const edgeTypes: EdgeTypes = useMemo(() => ({ storyEdge: TimelineEdgeComponent }), []);

  // 加载图谱(仅在 currentProject 变化时触发)
  useEffect(() => {
    if (currentProject) {
      loadGraph(currentProject.path);
    }
  }, [currentProject, loadGraph]);

  /**
   * Ctrl+L 整理布局(时间线专属: 调用 dagreLayout.autoLayout)
   * 输入: 无
   * 输出: void
   * 流程: 读取当前 store 中的 nodes/edges, 调用 autoLayout 计算布局后更新 nodes
   */
  const handleAutoLayout = useCallback(() => {
    const { nodes: curNodes, edges: curEdges } = useTimelineStore.getState();
    const layoutedNodes = autoLayout(curNodes, curEdges);
    useTimelineStore.setState({ nodes: layoutedNodes });
    showToast("success", t("timeline.toast.layoutApplied"));
  }, [showToast, t]);

  /**
   * Task 4.2.3: 跳转到关联章节
   * 输入: sourceFile 章节相对路径(来自 manifest 实体的 sourceFile 字段)
   * 输出: void
   * 流程:
   *   1. 通过 findFileByPath 在项目目录树中查找对应 FileNode
   *   2. 找到后调用 navigateToFile(fileNode, "manuscript") 切换到正文分类并打开文件
   *   3. 未找到时显示错误 toast(可能章节文件已被删除或移动)
   */
  const handleJumpToChapter = useCallback((sourceFile: string) => {
    const fileNode = findFileByPath(projectTree, sourceFile);
    if (!fileNode) {
      showToast("error", t("timeline.linkChapter.jumpFailed"));
      return;
    }
    navigateToFile(fileNode, "manuscript");
  }, [projectTree, navigateToFile, showToast, t]);

  /**
   * 创建新节点并可选地连线到父节点
   * 输入: type 节点类型, flowPosition 画布坐标(已由 screenToFlowPosition 转换),
   *       parentId 父节点 ID(可选, 用于右键节点时连线到新节点)
   * 输出: void
   * 流程:
   *   1. 构造 TimelineNode(含默认值, 直接使用传入的画布坐标作为 position)
   *   2. 添加到 store.nodes
   *   3. 若 parentId 存在, 创建对应类型的边
   *
   * 注: 坐标转换(screen → flow)由 GraphPanelShell 的 screenToFlowPosition 完成,
   *     此处接收的已是画布坐标, 不再需要二次转换。
   */
  const handleCreateNode = useCallback(
    (
      type: TimelineNodeType,
      flowPosition: { x: number; y: number },
      parentId?: string
    ) => {
      const now = new Date().toISOString();
      const newNode: StoryTimelineNode = {
        id: `node_${crypto.randomUUID()}`,
        type: "storyNode",
        position: flowPosition,
        data: {
          title:
            type === "main"
              ? t("timeline.defaultTitleMain")
              : type === "branch"
                ? t("timeline.defaultTitleBranch")
                : type === "event"
                  ? t("timeline.defaultTitleEvent")
                  : t("timeline.defaultTitleEnding"),
          nodeType: type,
          summary: "",
          coreConflict: "",
          status: "planned",
          order: 0,
          collapsed: false,
          childCount: 0,
          createdAt: now,
          updatedAt: now,
          chapterId: null,
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
    [t]
  );

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
   * 输入: event 鼠标事件
   * 输出: void
   * 流程: 阻止默认菜单, 记录位置, nodeType 置空表示画布空白
   */
  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | ReactMouseEvent) => {
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        nodeId: null,
        nodeType: null,
      });
    },
    []
  );

  /** 关闭右键菜单 */
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  /**
   * 创建拖拽前快照
   * 输入: store state(含 nodes/edges)
   * 输出: TimelineSnapshot(用于推入 zundo pastStates)
   */
  const createSnapshot = useCallback(
    (state: { nodes: StoryTimelineNode[]; edges: StoryTimelineEdge[] }): TimelineSnapshot => ({
      nodes: state.nodes,
      edges: state.edges,
    }),
    []
  );

  /**
   * MiniMap 节点颜色函数
   * 输入: node React Flow 节点
   * 输出: HEX 颜色字符串(根据 nodeType 从 EDGE_TYPE_COLORS 取色)
   */
  const minimapNodeColor = useCallback((node: Node) => {
    const nodeType =
      (node.data as { nodeType?: string } | undefined)?.nodeType ?? "main";
    return EDGE_TYPE_COLORS[nodeType as keyof typeof EDGE_TYPE_COLORS] ?? "#6EA8FE";
  }, []);

  // 是否显示空状态
  const isEmpty = nodes.length === 0 && !loading;

  return (
    <GraphPanelShell
      className="timeline-canvas-root"
      flowClassName="timeline-flow"
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={addEdge}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={{ type: "storyEdge" }}
      connectionLineComponent={DefaultConnectionLine}
      minimapNodeColor={minimapNodeColor}
      onNodeSelect={selectNode}
      onPaneSelect={() => selectNode(null)}
      currentProject={currentProject}
      activeCategory={activeCategory}
      saving={saving}
      saveError={saveError}
      saveNow={saveNow}
      debouncedSave={debouncedSave}
      clearGraph={clearGraph}
      onAutoLayout={handleAutoLayout}
      undo={undo}
      redo={redo}
      storeAdapter={timelineStoreAdapter}
      createSnapshot={createSnapshot}
      i18nNamespace={TIMELINE_I18N_NAMESPACE}
      contextMenu={contextMenu}
      onNodeContextMenu={handleNodeContextMenu}
      onPaneContextMenu={handlePaneContextMenu}
      onCloseContextMenu={handleCloseContextMenu}
      isEmpty={isEmpty}
      renderContextMenu={({ handleResetView, screenToFlowPosition }) =>
        contextMenu ? (
          <TimelineContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            nodeType={contextMenu.nodeType}
            onCreateNode={(type, pos) => {
              // 通过 GraphPanelShell 的 reactFlowInstance 将屏幕坐标转为画布坐标,
              // 确保节点在右键处创建而非默认左上角(支持画布平移/缩放后精准定位)
              const flowPos = screenToFlowPosition(pos);
              handleCreateNode(type, flowPos, contextMenu.nodeId ?? undefined);
              setContextMenu(null);
            }}
            onEditDetail={() => {
              if (contextMenu.nodeId) selectNode(contextMenu.nodeId);
              setContextMenu(null);
            }}
            onDeleteNode={() => {
              if (
                contextMenu.nodeId &&
                confirm(t("timeline.toast.deleteConfirm"))
              ) {
                deleteNode(contextMenu.nodeId);
                showToast("success", t("timeline.toast.deleted"));
              }
              setContextMenu(null);
            }}
            onAutoLayout={() => {
              handleAutoLayout();
              setContextMenu(null);
            }}
            onResetView={() => {
              handleResetView();
              setContextMenu(null);
            }}
            onClose={handleCloseContextMenu}
          />
        ) : null
      }
      renderEmpty={() => <TimelineEmpty />}
      renderDrawers={() =>
        selectedNodeId ? (
          <TimelineDrawer
            nodeId={selectedNodeId}
            onClose={() => selectNode(null)}
            onJumpToChapter={handleJumpToChapter}
          />
        ) : null
      }
    />
  );
}
