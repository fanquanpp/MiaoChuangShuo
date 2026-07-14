// src/components/CharacterGraphPanel.tsx
//
// 人物关系图编辑器画布容器组件
// 通过 GraphPanelShell 包装, 注入人物关系图专属的节点/边组件、右键菜单、抽屉、
// 自动布局实现, 复用通用的画布渲染、工具栏、拖拽优化、快捷键、自动保存订阅等基础设施。
//
// 业务专属职责:
//   1. 加载图谱(loadGraph, 仅在 currentProject 变化时调用)
//   2. 注册 nodeTypes/edgeTypes(characterNode / characterEdge)
//   3. 实现人物关系图专属的 handleCreateNode(无 type 与 parentId, 创建默认角色节点)
//   4. 实现人物关系图专属的 handleAutoLayout(调用 autoCharacterLayout, dagre LR 简化版)
//   5. 渲染 CharacterGraphContextMenu 与 CharacterGraphDrawer / CharacterGraphEdgeDrawer
//   6. 配置 i18n 命名空间(characterGraph.*)
//   7. 注册边点击/双击回调(用于打开边抽屉, 编辑关系类型与描述)
//
// 【Skill 偏差报备】
// 偏差原因: 与 TimelinePanel.tsx 同源, @xyflow/react v12 无默认导出, 需命名导入。
// 偏差调整: GraphPanelShell 已采用命名导入, 本组件不再直接导入 ReactFlow。
// 验证依据: 与 TimelinePanel.tsx 同源方案, tsc --noEmit 通过。

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type {
  NodeTypes,
  EdgeTypes,
  Node,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";

import { useAppStore } from "../lib/store";
import { useCharacterGraphStore } from "../lib/stores/characterGraphStore";
import { DEFAULT_NODE_ACCENT } from "../lib/stores/characterGraphTypes";
import type {
  CharacterGraphNode,
  CharacterGraphEdge,
} from "../lib/stores/characterGraphTypes";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";

import CharacterGraphNodeComponent from "./CharacterGraphNode";
import CharacterGraphEdgeComponent from "./CharacterGraphEdge";
import CharacterGraphDrawer from "./CharacterGraphDrawer";
import CharacterGraphEdgeDrawer from "./CharacterGraphEdgeDrawer";
import CharacterGraphContextMenu, {
  type ContextMenuState,
  type ContextMenuActions,
} from "./CharacterGraphContextMenu";
import {
  GraphPanelShell,
  DefaultConnectionLine,
  type StoreAdapter,
  type GraphI18nNamespace,
} from "./graph/GraphPanelShell";

/**
 * 拖拽前快照类型(与 zundo pastStates 元素类型一致)
 * 含 nodes/edges 快照, onNodeDragStop 时推入 pastStates
 */
type CharacterGraphSnapshot = {
  nodes: CharacterGraphNode[];
  edges: CharacterGraphEdge[];
};

/**
 * 人物关系图 i18n 文案命名空间
 * 将 characterGraph.* 系列 key 映射到 GraphPanelShell 通用工具栏渲染所需的字段
 */
const CHARACTER_GRAPH_I18N_NAMESPACE: GraphI18nNamespace = {
  saving: "characterGraph.saving",
  save: "characterGraph.save",
  autoSaved: "characterGraph.autoSaved",
  saveFailed: "characterGraph.toast.saveFailed",
  saved: "characterGraph.toast.saved",
  clearConfirm: "characterGraph.toast.clearConfirm",
  cleared: "characterGraph.toast.cleared",
  clearTitle: "characterGraph.clear",
  layoutApplied: "characterGraph.toast.layoutApplied",
};

/**
 * Store 适配器
 * 将 useCharacterGraphStore 包装为 GraphPanelShell 所需的 StoreAdapter 接口,
 * 仅暴露 getState/subscribe/temporal 三个能力, 隔离业务 store 类型。
 */
const characterGraphStoreAdapter: StoreAdapter<
  CharacterGraphNode,
  CharacterGraphEdge,
  CharacterGraphSnapshot
> = {
  getState: () => {
    const state = useCharacterGraphStore.getState();
    return { nodes: state.nodes, edges: state.edges };
  },
  subscribe: (listener) =>
    useCharacterGraphStore.subscribe((state, prevState) => {
      listener(
        { nodes: state.nodes, edges: state.edges },
        { nodes: prevState.nodes, edges: prevState.edges }
      );
    }),
  temporal: {
    getState: () => {
      const ts = useCharacterGraphStore.temporal.getState();
      return {
        pause: ts.pause,
        resume: ts.resume,
        pastStates: ts.pastStates as CharacterGraphSnapshot[],
        futureStates: ts.futureStates as CharacterGraphSnapshot[],
      };
    },
    setState: (partial) => {
      useCharacterGraphStore.temporal.setState({
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
 * 人物关系图自动布局(简化版 dagre LR 方向)
 * 输入: nodes 节点列表, edges 边列表
 * 输出: 布局后的节点列表(位置已更新)
 * 流程: 用 dagre 计算初始位置(LR 方向), 无主轴对齐(人物关系图无主轴概念)
 */
function autoCharacterLayout(
  nodes: CharacterGraphNode[],
  edges: CharacterGraphEdge[]
): CharacterGraphNode[] {
  const g = new dagre.graphlib.Graph();
  // rankdir=LR: 左到右排列
  // nodesep=80: 同层节点垂直间距
  // ranksep=120: 不同层节点水平间距(略大于 Timeline, 角色卡片信息更丰富)
  g.setGraph({ rankdir: "LR", nodesep: 80, ranksep: 120 });
  g.setDefaultEdgeLabel(() => ({}));

  // 注册节点(统一尺寸, 与 CharacterGraphNode 组件 width 一致)
  nodes.forEach((node) => {
    g.setNode(node.id, { width: 200, height: 110 });
  });

  // 注册边
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  // 执行布局计算
  dagre.layout(g);

  // 应用计算结果到节点
  return nodes.map((node) => {
    const dagreNode = g.node(node.id);
    if (!dagreNode) return node;
    return {
      ...node,
      position: { x: dagreNode.x, y: dagreNode.y },
    };
  });
}

/**
 * 人物关系图画布容器组件
 * 输入: 无(通过 useAppStore 获取当前项目, useCharacterGraphStore 获取节点数据)
 * 输出: JSX 画布界面(通过 GraphPanelShell 包装, 注入业务专属内容)
 * 流程:
 *   1. 加载时调用 loadGraph 从后端读取图谱
 *   2. 注册 nodeTypes/edgeTypes(characterNode / characterEdge)
 *   3. 通过 GraphPanelShell 渲染画布与工具栏
 *   4. 注入 CharacterGraphContextMenu 与 CharacterGraphDrawer / EdgeDrawer
 */
export default function CharacterGraphPanel() {
  const currentProject = useAppStore((s) => s.currentProject);
  const activeCategory = useAppStore((s) => s.activeCategory);

  const nodes = useCharacterGraphStore((s) => s.nodes);
  const edges = useCharacterGraphStore((s) => s.edges);
  const loading = useCharacterGraphStore((s) => s.loading);
  const loadGraph = useCharacterGraphStore((s) => s.loadGraph);
  const onNodesChange = useCharacterGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useCharacterGraphStore((s) => s.onEdgesChange);
  const addEdge = useCharacterGraphStore((s) => s.addEdge);
  const selectNode = useCharacterGraphStore((s) => s.selectNode);
  const deleteNode = useCharacterGraphStore((s) => s.deleteNode);
  const clearGraph = useCharacterGraphStore((s) => s.clearGraph);
  const selectedNodeId = useCharacterGraphStore((s) => s.selectedNodeId);
  const selectedEdgeId = useCharacterGraphStore((s) => s.selectedEdgeId);
  const selectEdge = useCharacterGraphStore((s) => s.selectEdge);
  const undo = useCharacterGraphStore((s) => s.undo);
  const redo = useCharacterGraphStore((s) => s.redo);
  const saveNow = useCharacterGraphStore((s) => s.saveNow);
  const debouncedSave = useCharacterGraphStore((s) => s.debouncedSave);
  const saving = useCharacterGraphStore((s) => s.saving);
  const saveError = useCharacterGraphStore((s) => s.error);

  const { showToast } = useToast();
  const { t } = useI18n();

  // 右键菜单状态(null 表示菜单关闭)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // nodeTypes / edgeTypes 必须在组件外定义或 useMemo, 避免每次渲染重新创建导致 React Flow 警告
  const nodeTypes: NodeTypes = useMemo(
    () => ({ characterNode: CharacterGraphNodeComponent }),
    []
  );
  const edgeTypes: EdgeTypes = useMemo(
    () => ({ characterEdge: CharacterGraphEdgeComponent }),
    []
  );

  // 加载图谱(仅在 currentProject 变化时触发)
  useEffect(() => {
    if (currentProject) {
      loadGraph(currentProject.path);
    }
  }, [currentProject, loadGraph]);

  /**
   * Ctrl+L 整理布局(人物关系图专属: 调用 autoCharacterLayout)
   * 输入: 无
   * 输出: void
   * 流程: 读取当前 store 中的 nodes/edges, 调用 autoCharacterLayout 计算布局后更新 nodes
   */
  const handleAutoLayout = useCallback(() => {
    const { nodes: curNodes, edges: curEdges } = useCharacterGraphStore.getState();
    const layoutedNodes = autoCharacterLayout(curNodes, curEdges);
    useCharacterGraphStore.setState({ nodes: layoutedNodes });
    showToast("success", t("characterGraph.toast.layoutApplied"));
  }, [showToast, t]);

  /**
   * 创建新角色节点
   * 输入: flowPosition 画布坐标(已由 screenToFlowPosition 转换)
   * 输出: void
   * 流程:
   *   1. 构造 CharacterGraphNode(含默认值, 直接使用传入的画布坐标作为 position)
   *   2. 添加到 store.nodes
   *
   * 注: 坐标转换(screen → flow)由 GraphPanelShell 的 screenToFlowPosition 完成,
   *     此处接收的已是画布坐标, 不再需要二次转换。
   */
  const handleCreateNode = useCallback(
    (flowPosition: { x: number; y: number }) => {
      const now = new Date().toISOString();
      const newNode: CharacterGraphNode = {
        id: `node_${crypto.randomUUID()}`,
        type: "characterNode",
        position: flowPosition,
        data: {
          name: t("characterGraph.defaultNodeName"),
          identity: "",
          tags: [],
          brief: "",
          accentColor: DEFAULT_NODE_ACCENT,
          sourceFile: "",
          createdAt: now,
          updatedAt: now,
        },
      };
      useCharacterGraphStore.setState((state) => ({
        nodes: [...state.nodes, newNode],
      }));
    },
    [t]
  );

  /**
   * 从指定节点开始连线(选中该节点, 提示用户拖拽到目标节点)
   * 输入: nodeId 起始节点 ID
   * 输出: void
   * 流程: 选中起始节点, 后续用户手动拖拽 Handle 完成连线
   *       注: React Flow 的连线由 Handle 拖拽触发, 此处仅提供入口提示
   */
  const handleConnectFrom = useCallback(
    (nodeId: string) => {
      selectNode(nodeId);
      showToast("info", t("characterGraph.ctx.connectFrom"));
    },
    [selectNode, showToast, t]
  );

  /**
   * 节点右键菜单触发
   * 输入: event 鼠标事件, node React Flow 节点对象
   * 输出: void
   * 流程: 阻止默认菜单, 记录位置与节点 ID, 打开自定义菜单
   */
  const handleNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
    },
    []
  );

  /**
   * 画布空白右键菜单触发
   * 输入: event 鼠标事件
   * 输出: void
   * 流程: 阻止默认菜单, 记录位置, nodeId 置空表示画布空白
   */
  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | ReactMouseEvent) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY, nodeId: null });
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
   * 输出: CharacterGraphSnapshot(用于推入 zundo pastStates)
   */
  const createSnapshot = useCallback(
    (
      state: { nodes: CharacterGraphNode[]; edges: CharacterGraphEdge[] }
    ): CharacterGraphSnapshot => ({
      nodes: state.nodes,
      edges: state.edges,
    }),
    []
  );

  /**
   * MiniMap 节点颜色函数(人物关系图统一使用 DEFAULT_NODE_ACCENT 主色蓝)
   * 输入: node React Flow 节点(未使用, 保留参数以匹配 GraphPanelShell 接口)
   * 输出: HEX 颜色字符串
   */
  const minimapNodeColor = useCallback((_node: Node) => {
    return DEFAULT_NODE_ACCENT;
  }, []);

  /**
   * 右键菜单操作回调集合(传递给 CharacterGraphContextMenu 组件)
   * 使用 useMemo 避免每次渲染创建新对象导致子组件不必要重渲染
   *
   * 注: onCreateNode 接收屏幕坐标, 内部通过 screenToFlowPosition 转换,
   *     但因 screenToFlowPosition 由 GraphPanelShell 的 helpers 提供,
   *     此处 onCreateNode 在 renderContextMenu 中重新包装, 此 actions 仅作占位,
   *     实际调用时由 renderContextMenu 内的包装函数覆盖。
   */
  const contextMenuActions: ContextMenuActions = useMemo(() => ({
    onCreateNode: handleCreateNode,
    onEditNode: selectNode,
    onDeleteNode: (nodeId: string) => {
      if (confirm(t("characterGraph.toast.deleteConfirm"))) {
        deleteNode(nodeId);
        showToast("success", t("characterGraph.toast.deleted"));
      }
    },
    onAutoLayout: handleAutoLayout,
    onResetView: () => {
      /* 由 renderContextMenu 内的 helpers.handleResetView 覆盖 */
    },
    onConnectFrom: handleConnectFrom,
  }), [handleCreateNode, selectNode, deleteNode, showToast, t, handleAutoLayout, handleConnectFrom]);

  // 是否显示空状态
  const isEmpty = nodes.length === 0 && !loading;

  return (
    <GraphPanelShell
      className="character-graph-canvas-root"
      flowClassName="character-graph-flow"
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={addEdge}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={{ type: "characterEdge" }}
      connectionLineComponent={DefaultConnectionLine}
      minimapNodeColor={minimapNodeColor}
      onNodeSelect={selectNode}
      onPaneSelect={() => selectNode(null)}
      onEdgeSelect={selectEdge}
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
      storeAdapter={characterGraphStoreAdapter}
      createSnapshot={createSnapshot}
      i18nNamespace={CHARACTER_GRAPH_I18N_NAMESPACE}
      contextMenu={contextMenu}
      onNodeContextMenu={handleNodeContextMenu}
      onPaneContextMenu={handlePaneContextMenu}
      onCloseContextMenu={handleCloseContextMenu}
      isEmpty={isEmpty}
      renderContextMenu={({ handleResetView, screenToFlowPosition }) =>
        contextMenu ? (
          <CharacterGraphContextMenu
            state={contextMenu}
            actions={{
              ...contextMenuActions,
              // 覆盖 onCreateNode: 接收屏幕坐标, 转换为画布坐标后调用 handleCreateNode
              onCreateNode: (screenPosition) => {
                const flowPos = screenToFlowPosition(screenPosition);
                handleCreateNode(flowPos);
              },
              // 覆盖 onResetView: 使用 GraphPanelShell 的 fitView 实现
              onResetView: handleResetView,
            }}
            onClose={handleCloseContextMenu}
          />
        ) : null
      }
      renderEmpty={() => (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none z-10">
          <div className="text-nf-text-tertiary text-sm mb-2">
            {t("characterGraph.emptyHint")}
          </div>
          <div className="text-nf-text-tertiary text-xs opacity-70">
            {t("characterGraph.emptySubHint")}
          </div>
        </div>
      )}
      renderDrawers={() =>
        selectedNodeId || selectedEdgeId ? (
          <>
            {selectedNodeId && (
              <CharacterGraphDrawer
                nodeId={selectedNodeId}
                onClose={() => selectNode(null)}
              />
            )}
            {/* 连线详情抽屉(双击连线或点击关系标签触发, 编辑关系类型与描述) */}
            {selectedEdgeId && (
              <CharacterGraphEdgeDrawer
                edgeId={selectedEdgeId}
                onClose={() => selectEdge(null)}
              />
            )}
          </>
        ) : null
      }
    />
  );
}
