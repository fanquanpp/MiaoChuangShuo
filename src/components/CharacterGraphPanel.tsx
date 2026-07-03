// src/components/CharacterGraphPanel.tsx
//
// 人物关系图编辑器画布容器组件
// 集成 ReactFlow 画布, 加载/渲染节点与边, 注册 nodeTypes/edgeTypes,
// 处理 onNodesChange/onEdgesChange/onConnect 回调,
// 集成快捷键(Ctrl+S/L/Z/Y), 集成自动保存监听, 隔离 Tauri 拖拽冲突。
//
// 架构复用: 与 TimelinePanel.tsx 保持一致的实现模式, 移除折叠/分卷相关逻辑,
// 右键菜单与空状态内联实现, 避免文件膨胀。
//
// 【Skill 偏差报备】
// 偏差原因: 与 TimelinePanel.tsx 同源, @xyflow/react v12 无默认导出, 需命名导入。
// 偏差调整: 改用 `import { ReactFlow, ... }` 命名导入形式。
// 验证依据: 与 TimelinePanel.tsx 同源方案, tsc --noEmit 通过。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  ConnectionMode,
  Position,
  getBezierPath,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  type Node,
  type Edge,
  type ReactFlowInstance,
  type ConnectionLineComponent,
} from "@xyflow/react";
import {
  Trash2,
  Save,
  Loader2,
  Check,
} from "lucide-react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";

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
import CharacterGraphContextMenu, {
  type ContextMenuState,
  type ContextMenuActions,
} from "./CharacterGraphContextMenu";

/**
 * 自定义连接线组件(拖拽过程中的临时连线)
 * 输入: ConnectionLineComponentProps (fromX/fromY/fromPosition 起点坐标与 Handle 位置, toX/toY 鼠标当前位置)
 * 输出: SVG 路径(贝塞尔曲线 + 起点圆点)
 * 流程:
 *   1. 读取起点 Handle 位置(fromPosition)
 *   2. 根据鼠标当前位置(toX/toY)相对起点(fromX/fromY)的方位, 动态推导终点控制点方向
 *   3. 调用 getBezierPath 计算路径
 *   4. 渲染虚线路径 + 起点圆点(视觉锚点)
 *
 * 复用 TimelinePanel 的 toPosition 动态推导逻辑, 保证拖拽预览曲线方向与最终落点 Handle 方向一致。
 */
const CharacterConnectionLine: ConnectionLineComponent = ({
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
}) => {
  // 动态推导终点控制点方向: 基于鼠标位置(toX/toY)相对起点(fromX/fromY)的方位
  const toPosition =
    fromPosition === Position.Left || fromPosition === Position.Right
      ? toX < fromX
        ? Position.Left
        : Position.Right
      : toY < fromY
        ? Position.Top
        : Position.Bottom;

  const [edgePath] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  });

  return (
    <g>
      <path
        d={edgePath}
        fill="none"
        stroke="#6EA8FE"
        strokeWidth={2}
        strokeDasharray="5,5"
        opacity={0.7}
      />
      <circle cx={fromX} cy={fromY} r={3} fill="#6EA8FE" opacity={0.9} />
    </g>
  );
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

/** 右键菜单状态(null 表示菜单关闭) - 复用 CharacterGraphContextMenu 组件的类型 */
// ContextMenuState 已从 CharacterGraphContextMenu 导入, 此处仅保留注释说明

/**
 * 人物关系图画布容器组件
 * 输入: 无(通过 useAppStore 获取当前项目, useCharacterGraphStore 获取节点数据)
 * 输出: JSX 画布界面(含 ReactFlow + 工具栏 + 空状态 + 右键菜单 + 抽屉)
 * 流程:
 *   1. 加载时调用 loadGraph 从后端读取图谱
 *   2. 渲染 ReactFlow 画布(节点/边/背景/MiniMap)
 *   3. 注册 onNodesChange/onEdgesChange/onConnect 回调
 *   4. 注册快捷键监听(Ctrl+S/L/Z/Y, Escape)
 *   5. 隔离 Tauri 拖拽冲突(data-tauri-drag-region="false")
 *   6. 监听 nodes/edges 变化自动触发防抖保存
 *   7. 集成独立 CharacterGraphContextMenu 组件处理右键菜单
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
  const undo = useCharacterGraphStore((s) => s.undo);
  const redo = useCharacterGraphStore((s) => s.redo);
  const saveNow = useCharacterGraphStore((s) => s.saveNow);
  const debouncedSave = useCharacterGraphStore((s) => s.debouncedSave);
  // 保存状态订阅: saving 防抖期间为 true, error 保存失败时携带错误信息
  const saving = useCharacterGraphStore((s) => s.saving);
  const saveError = useCharacterGraphStore((s) => s.error);
  // saved 闪烁态: 保存完成(saving: true → false)后短暂显示"已保存"标记
  const [savedFlash, setSavedFlash] = useState(false);
  const prevSavingRef = useRef(false);
  useEffect(() => {
    if (prevSavingRef.current && !saving && !saveError) {
      setSavedFlash(true);
      const timer = setTimeout(() => setSavedFlash(false), 1200);
      return () => clearTimeout(timer);
    }
    prevSavingRef.current = saving;
  }, [saving, saveError]);

  const { showToast } = useToast();
  const { t } = useI18n();

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // ReactFlow 实例引用(用于 screenToFlowPosition 坐标转换)
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

  // nodeTypes / edgeTypes 必须在组件外定义或 useMemo, 避免每次渲染重新创建导致 React Flow 警告
  const nodeTypes: NodeTypes = useMemo(() => ({ characterNode: CharacterGraphNodeComponent }), []);
  const edgeTypes: EdgeTypes = useMemo(() => ({ characterEdge: CharacterGraphEdgeComponent }), []);

  // 加载图谱
  useEffect(() => {
    if (currentProject) {
      loadGraph(currentProject.path);
    }
  }, [currentProject, loadGraph]);

  // 自动保存监听(任何 nodes/edges 变化均触发防抖保存, 含 undo/redo 触发的变化)
  const projectRef = useRef(currentProject);
  projectRef.current = currentProject;

  // 拖拽前状态快照引用(含 nodes/edges 快照)
  // 用途: onNodeDragStop 时手动推入 zundo pastStates, 实现"整段拖拽仅 1 条历史记录"
  const preDragSnapshotRef = useRef<{
    nodes: CharacterGraphNode[];
    edges: CharacterGraphEdge[];
  } | null>(null);

  useEffect(() => {
    const unsub = useCharacterGraphStore.subscribe((state, prevState) => {
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
    const { nodes: curNodes, edges: curEdges } = useCharacterGraphStore.getState();
    const layoutedNodes = autoCharacterLayout(curNodes, curEdges);
    useCharacterGraphStore.setState({ nodes: layoutedNodes });
    showToast("success", t("characterGraph.toast.layoutApplied"));
  }, [showToast, t]);

  /**
   * 创建新角色节点
   * 输入: screenPosition 屏幕坐标(右键位置)
   * 输出: void
   * 流程:
   *   1. 通过 screenToFlowPosition 将屏幕坐标转为画布坐标
   *   2. 构造 CharacterGraphNode(含默认值)
   *   3. 添加到 store.nodes
   */
  const handleCreateNode = useCallback((screenPosition: { x: number; y: number }) => {
    const position = reactFlowInstance.current?.screenToFlowPosition(screenPosition) ?? screenPosition;
    const now = new Date().toISOString();
    const newNode: CharacterGraphNode = {
      id: `node_${crypto.randomUUID()}`,
      type: "characterNode",
      position,
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
    useCharacterGraphStore.setState((state) => ({ nodes: [...state.nodes, newNode] }));
  }, [t]);

  /**
   * 重置视图(居中并自适应缩放)
   * 输入: 无
   * 输出: void
   * 流程: 调用 ReactFlowInstance.fitView 将所有节点居中显示并适配缩放比例
   */
  const handleResetView = useCallback(() => {
    reactFlowInstance.current?.fitView({ padding: 0.2, duration: 300 });
  }, []);

  /**
   * 从指定节点开始连线(选中该节点, 提示用户拖拽到目标节点)
   * 输入: nodeId 起始节点 ID
   * 输出: void
   * 流程: 选中起始节点, 后续用户手动拖拽 Handle 完成连线
   *       注: React Flow 的连线由 Handle 拖拽触发, 此处仅提供入口提示
   */
  const handleConnectFrom = useCallback((nodeId: string) => {
    selectNode(nodeId);
    showToast("info", t("characterGraph.ctx.connectFrom"));
  }, [selectNode, showToast, t]);

  /**
   * 右键菜单操作回调集合(传递给 CharacterGraphContextMenu 组件)
   * 使用 useMemo 避免每次渲染创建新对象导致子组件不必要重渲染
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
    onResetView: handleResetView,
    onConnectFrom: handleConnectFrom,
  }), [handleCreateNode, selectNode, deleteNode, showToast, t, handleAutoLayout, handleResetView, handleConnectFrom]);

  // 快捷键监听(仅在 activeCategory === "characterGraph" 时生效)
  useEffect(() => {
    if (activeCategory !== "characterGraph") return;

    const handler = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Ctrl+S 始终拦截
      if (isMod && !e.shiftKey && key === "s") {
        e.preventDefault();
        e.stopPropagation();
        if (currentProject) {
          saveNow(currentProject.path, currentProject.meta.name);
        }
        return;
      }

      if (isInputFocused) return;

      // Ctrl+L 整理布局
      if (isMod && !e.shiftKey && key === "l") {
        e.preventDefault();
        e.stopPropagation();
        handleAutoLayout();
        return;
      }

      // Ctrl+Z 撤销
      if (isMod && !e.shiftKey && key === "z") {
        e.preventDefault();
        e.stopPropagation();
        undo();
        return;
      }

      // Ctrl+Shift+Z 或 Ctrl+Y 重做
      if (isMod && ((e.shiftKey && key === "z") || (!e.shiftKey && key === "y"))) {
        e.preventDefault();
        e.stopPropagation();
        redo();
        return;
      }

      // Escape 关闭抽屉
      if (e.key === "Escape") {
        selectNode(null);
        setContextMenu(null);
        return;
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [activeCategory, currentProject, saveNow, undo, redo, selectNode, handleAutoLayout]);

  /**
   * 拖拽性能优化(zundo pause/resume)
   * 与 TimelinePanel 同源方案: dragStart 暂停 zundo + 捕获快照, dragStop 恢复 + 手动入栈
   */
  const handleNodeDragStart = useCallback(() => {
    const state = useCharacterGraphStore.getState();
    preDragSnapshotRef.current = {
      nodes: state.nodes,
      edges: state.edges,
    };
    useCharacterGraphStore.temporal.getState().pause();
  }, []);

  const handleNodeDragStop = useCallback(() => {
    useCharacterGraphStore.temporal.getState().resume();

    const snapshot = preDragSnapshotRef.current;
    if (snapshot) {
      const temporalState = useCharacterGraphStore.temporal.getState();
      const LIMIT = 100;
      const pastStates = temporalState.pastStates.slice();
      if (pastStates.length >= LIMIT) {
        pastStates.shift();
      }
      pastStates.push(snapshot);
      useCharacterGraphStore.temporal.setState({
        pastStates,
        futureStates: [],
      });
      preDragSnapshotRef.current = null;
    }

    if (currentProject) {
      debouncedSave(currentProject.path, currentProject.meta.name);
    }
  }, [currentProject, debouncedSave]);

  // onConnect: 创建新连线(已含自环/重复校验)
  const handleConnect = useCallback((connection: Connection) => {
    addEdge(connection);
  }, [addEdge]);

  /**
   * 节点右键菜单触发
   * 输入: event 鼠标事件, node React Flow 节点对象
   * 输出: void
   * 流程: 阻止默认菜单, 记录位置与节点 ID, 打开自定义菜单
   */
  const handleNodeContextMenu = useCallback((event: ReactMouseEvent, node: Node) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }, []);

  /**
   * 画布空白右键菜单触发
   * 输入: event 鼠标事件
   * 输出: void
   * 流程: 阻止默认菜单, 记录位置, nodeId 置空表示画布空白
   */
  const handlePaneContextMenu = useCallback((event: MouseEvent | ReactMouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: null });
  }, []);

  // 点击其他区域关闭右键菜单的逻辑已迁移至 CharacterGraphContextMenu 组件内部,
  // 此处仅保留 Escape 关闭逻辑(与快捷键监听中的 Escape 处理合并)
  useEffect(() => {
    if (!contextMenu) return;
    // 右键菜单打开期间, 额外监听 contextmenu 事件以支持右键切换菜单位置
    const handleClose = () => setContextMenu(null);
    document.addEventListener("contextmenu", handleClose);
    return () => {
      document.removeEventListener("contextmenu", handleClose);
    };
  }, [contextMenu]);

  // 是否显示空状态
  const isEmpty = nodes.length === 0 && !loading;

  return (
    <div
      className="h-full w-full relative character-graph-canvas-root"
      data-tauri-drag-region="false"
      onDragStart={(e) => e.stopPropagation()}
    >
      {isEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none z-10">
          <div className="text-nf-text-tertiary text-sm mb-2">
            {t("characterGraph.emptyHint")}
          </div>
          <div className="text-nf-text-tertiary text-xs opacity-70">
            {t("characterGraph.emptySubHint")}
          </div>
        </div>
      )}

      {/* 顶部右侧工具栏: 保存状态指示器 + 手动保存 + 清空 */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        {/* 保存状态指示器 */}
        <div
          className="flex items-center gap-1.5 h-7 px-2.5 text-xs bg-nf-bg-sidebar border border-nf-border-light text-nf-text-secondary"
          title={
            saveError
              ? t("characterGraph.toast.saveFailed")
              : saving
                ? t("characterGraph.saving")
                : savedFlash
                  ? t("characterGraph.toast.saved")
                  : t("characterGraph.save")
          }
        >
          {saveError ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              <span className="text-red-400">{t("characterGraph.toast.saveFailed")}</span>
            </>
          ) : saving ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-fandex-primary" />
              <span className="text-fandex-primary">{t("characterGraph.saving")}</span>
            </>
          ) : savedFlash ? (
            <>
              <Check className="w-3 h-3 text-fandex-secondary" />
              <span className="text-fandex-secondary">{t("characterGraph.toast.saved")}</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
              <span className="text-zinc-500">{t("characterGraph.autoSaved")}</span>
            </>
          )}
        </div>

        {/* 手动保存按钮 */}
        <button
          onClick={() => {
            if (currentProject) {
              saveNow(currentProject.path, currentProject.meta.name);
              showToast("success", t("characterGraph.toast.saved"));
            }
          }}
          className="nf-tool-btn h-7 px-2 text-xs flex items-center justify-center gap-1.5 bg-nf-bg-sidebar border border-nf-border-light rounded-none text-nf-text-secondary hover:text-fandex-primary hover:border-fandex-primary"
          title={t("characterGraph.save")}
        >
          <Save className="w-3.5 h-3.5" />
        </button>

        {/* 清空图谱按钮 */}
        <button
          onClick={() => {
            if (confirm(t("characterGraph.toast.clearConfirm"))) {
              clearGraph();
              showToast("success", t("characterGraph.toast.cleared"));
            }
          }}
          className="nf-tool-btn h-7 px-2 text-xs flex items-center justify-center gap-1.5 bg-nf-bg-sidebar border border-nf-border-light rounded-none text-nf-text-secondary hover:text-fandex-tertiary hover:border-fandex-tertiary"
          title={t("characterGraph.clear")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <ReactFlow
        nodes={nodes as unknown as Node[]}
        edges={edges as unknown as Edge[]}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onInit={(instance) => {
          reactFlowInstance.current = instance;
        }}
        onNodeClick={(_: ReactMouseEvent, node: Node) => selectNode(node.id)}
        onNodeDoubleClick={(_: ReactMouseEvent, node: Node) => selectNode(node.id)}
        onPaneClick={() => selectNode(null)}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onlyRenderVisibleElements={true}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{ type: "characterEdge" }}
        connectionMode={ConnectionMode.Loose}
        connectionLineComponent={CharacterConnectionLine}
        className="character-graph-flow"
      >
        <Background
          variant={BackgroundVariant.Lines}
          gap={16}
          size={1}
          color="rgba(255,255,255,0.05)"
        />
        <MiniMap
          nodeColor={() => DEFAULT_NODE_ACCENT}
          maskColor="rgba(0,0,0,0.4)"
          className="!bg-nf-bg-sidebar"
        />
      </ReactFlow>

      {/* 右键菜单(独立组件, 含边界检测/Esc关闭/点击外部关闭) */}
      <CharacterGraphContextMenu
        state={contextMenu}
        actions={contextMenuActions}
        onClose={() => setContextMenu(null)}
      />

      {selectedNodeId && (
        <CharacterGraphDrawer
          nodeId={selectedNodeId}
          onClose={() => selectNode(null)}
        />
      )}
    </div>
  );
}
