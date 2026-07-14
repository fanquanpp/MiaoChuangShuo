// src/components/graph/GraphPanelShell.tsx
//
// 图谱画布容器通用包装组件
// 抽取 TimelinePanel 与 CharacterGraphPanel 共享的画布容器逻辑, 包括:
//   1. ReactFlow 画布渲染与配置(Background / MiniMap / connectionLine)
//   2. 顶部工具栏(保存状态指示器 / 手动保存按钮 / 清空按钮)
//   3. 拖拽性能优化(zundo pause/resume + pre-drag 快照手动入栈)
//   4. 快捷键监听(Ctrl+S 保存 / Ctrl+L 自动布局 / Ctrl+Z 撤销 / Ctrl+Y 重做 / Escape 取消)
//   5. 自动保存订阅(nodes/edges 变化触发 debouncedSave)
//   6. 保存状态闪烁态(saving 由 true 转 false 后短暂显示"已保存"标记)
//   7. 右键菜单触发与状态管理(节点右键 / 画布空白右键)
//   8. 重置视图(fitView 居中并自适应缩放)
//
// 业务方通过 props 注入:
//   - 节点/边数据与回调(来自 store)
//   - 节点/边类型注册(nodeTypes / edgeTypes / defaultEdgeOptions)
//   - 自定义连接线组件(connectionLineComponent)
//   - 自动布局实现(onAutoLayout, 业务方决定使用何种 dagre 配置)
//   - 右键菜单渲染函数(renderContextMenu)
//   - 抽屉与空状态渲染函数(renderDrawers / renderEmpty)
//   - i18n 文案 key 命名空间
//   - store 引用(用于拖拽快照与 subscribe)
//
// 设计要点:
//   - 通过 StoreAdapter 接口抽象 store, 避免直接依赖业务 store 类型
//   - 拖拽快照类型 TSnapshot 由业务方提供, 适配不同节点/边类型
//   - contextMenu 状态类型 TContextMenu 由业务方提供, 保留各自的菜单字段差异
//
// 【Skill 偏差报备】
// 原 Skill 计划使用 HOC(withGraphPanel)模式, 通过组件包装注入通用逻辑。
// 偏差原因: HOC 模式下 props 类型推导复杂, 业务方需重复声明 store 类型,
//   且 TimelinePanel/CharacterGraphPanel 的差异点(节点类型/右键菜单/抽屉)
//   通过 render props 表达更直观, 类型推导更友好。
// 偏差调整: 改用包装组件(Wrapper Component)模式, 通过 props 接收所有依赖。
// 验证依据: 与原 TimelinePanel/CharacterGraphPanel 行为一致, tsc --noEmit 通过。

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  type NodeChange,
  type EdgeChange,
  type ReactFlowInstance,
  type ConnectionLineComponent,
} from "@xyflow/react";
import { Trash2, Save, Loader2, Check } from "lucide-react";
import "@xyflow/react/dist/style.css";

import type { ProjectInfo } from "../../lib/api/projectApi";
import { useToast } from "../../lib/toast";
import { useI18n } from "../../lib/i18n";

/**
 * Store 适配器接口
 * 业务方将 store 的部分能力包装为该接口, 供 GraphPanelShell 调用,
 * 避免直接依赖业务 store 的具体类型。
 *
 * @template TNode 业务节点类型
 * @template TEdge 业务边类型
 * @template TSnapshot 拖拽前快照类型(通常为 { nodes: TNode[]; edges: TEdge[] })
 */
export interface StoreAdapter<TNode, TEdge, TSnapshot> {
  /** 获取当前 state(仅取 nodes/edges 用于拖拽快照) */
  getState: () => { nodes: TNode[]; edges: TEdge[] };
  /**
   * 订阅 state 变化(用于自动保存监听)
   * 输入: 监听器函数, 接收当前 state 与前一个 state
   * 输出: 取消订阅函数
   */
  subscribe: (
    listener: (
      state: { nodes: TNode[]; edges: TEdge[] },
      prevState: { nodes: TNode[]; edges: TEdge[] }
    ) => void
  ) => () => void;
  /** zundo temporal store 引用(用于拖拽期间暂停/恢复历史追踪与手动入栈) */
  temporal: {
    /** 获取 temporal state(含 pause/resume/pastStates) */
    getState: () => {
      /** 暂停 zundo 历史追踪 */
      pause: () => void;
      /** 恢复 zundo 历史追踪 */
      resume: () => void;
      /** 历史栈(过去状态) */
      pastStates: TSnapshot[];
      /** 历史栈(未来状态, 用于 redo) */
      futureStates: TSnapshot[];
    };
    /** 设置 temporal state(用于手动入栈 pre-drag 快照) */
    setState: (partial: {
      pastStates?: TSnapshot[];
      futureStates?: TSnapshot[];
    }) => void;
  };
}

/**
 * i18n 文案命名空间
 * 业务方提供各自命名空间的 i18n key, GraphPanelShell 调用 t() 渲染工具栏与 toast。
 * 所有 key 必须在 zh/en dict 中预先注册, 否则显示 key 原文。
 */
export interface GraphI18nNamespace {
  /** "保存中" 文案 key(防抖期间显示) */
  saving: string;
  /** "保存" 按钮 title 与待命态文案 key */
  save: string;
  /** "自动保存" 待命态文案 key */
  autoSaved: string;
  /** "保存失败" toast 与指示器文案 key */
  saveFailed: string;
  /** "已保存" toast 与闪烁态文案 key */
  saved: string;
  /** "确认清空图谱" 确认弹窗文案 key */
  clearConfirm: string;
  /** "已清空" toast 文案 key */
  cleared: string;
  /** "清空图谱" 按钮 title 文案 key */
  clearTitle: string;
  /** "已应用自动布局" toast 文案 key */
  layoutApplied: string;
}

/**
 * GraphPanelShell 属性接口
 *
 * @template TNode 业务节点类型
 * @template TEdge 业务边类型
 * @template TContextMenu 右键菜单状态类型(null 表示菜单关闭)
 * @template TSnapshot 拖拽前快照类型
 */
export interface GraphPanelShellProps<
  TNode,
  TEdge,
  TContextMenu,
  TSnapshot
> {
  /** 容器根 div className(用于业务区分 timeline/character 样式) */
  className: string;
  /** ReactFlow 组件 className */
  flowClassName: string;

  /** 节点列表(来自业务 store, 已经过滤/折叠后) */
  nodes: TNode[];
  /** 边列表 */
  edges: TEdge[];
  /** 应用 React Flow 节点变更 */
  onNodesChange: (changes: NodeChange[]) => void;
  /** 应用 React Flow 边变更 */
  onEdgesChange: (changes: EdgeChange[]) => void;
  /** 创建新连线(已含自环/重复校验, 由 store 处理) */
  onConnect: (connection: Connection) => void;

  /** React Flow 节点类型注册 */
  nodeTypes: NodeTypes;
  /** React Flow 边类型注册 */
  edgeTypes: EdgeTypes;
  /** 默认边选项(包含 type 字段) */
  defaultEdgeOptions: { type: string };
  /** 自定义连接线组件(拖拽过程中的临时连线) */
  connectionLineComponent: ConnectionLineComponent;

  /**
   * MiniMap 节点颜色函数
   * 输入: React Flow Node
   * 输出: 颜色字符串(HEX)
   */
  minimapNodeColor: (node: Node) => string;

  /** 节点点击回调(传入节点 ID, 业务方决定是否打开抽屉) */
  onNodeSelect: (nodeId: string) => void;
  /** 画布空白点击回调(业务方决定是否取消选中) */
  onPaneSelect: () => void;
  /** 边点击回调(可选, 人物关系图需要, 时间线不传) */
  onEdgeSelect?: (edgeId: string) => void;

  /** 当前项目(用于 saveNow / debouncedSave 调用) */
  currentProject: ProjectInfo | null;
  /** 当前激活的 category(用于快捷键监听过滤, 仅在该 category 激活时拦截) */
  activeCategory: string;
  /** 是否正在保存(防抖期间为 true) */
  saving: boolean;
  /** 保存错误信息(null 表示无错误) */
  saveError: string | null;

  /** 立即保存函数(Ctrl+S 触发) */
  saveNow: (projectRoot: string, projectName: string) => Promise<void> | void;
  /** 防抖保存函数(自动保存监听触发) */
  debouncedSave: (projectRoot: string, projectName: string) => void;
  /** 清空图谱函数(工具栏清空按钮触发) */
  clearGraph: () => void;
  /** 自动布局函数(业务方提供, 调用 dagre 计算并更新 nodes) */
  onAutoLayout: () => void;
  /** 撤销函数(调用 store.undo) */
  undo: () => void;
  /** 重做函数(调用 store.redo) */
  redo: () => void;

  /** Store 适配器(用于拖拽快照与 subscribe 自动保存) */
  storeAdapter: StoreAdapter<TNode, TEdge, TSnapshot>;
  /**
   * 创建拖拽前快照(由业务方提供, 决定快照字段)
   * 输入: store getState() 返回的 state
   * 输出: 快照对象(推入 pastStates)
   */
  createSnapshot: (state: { nodes: TNode[]; edges: TEdge[] }) => TSnapshot;

  /** i18n 文案命名空间 */
  i18nNamespace: GraphI18nNamespace;

  /** 右键菜单状态(null 表示菜单关闭) */
  contextMenu: TContextMenu | null;
  /** 节点右键菜单触发(由业务方决定如何构造菜单状态) */
  onNodeContextMenu: (event: ReactMouseEvent, node: Node) => void;
  /** 画布空白右键菜单触发 */
  onPaneContextMenu: (event: MouseEvent | ReactMouseEvent) => void;
  /** 关闭右键菜单 */
  onCloseContextMenu: () => void;
  /**
   * 渲染右键菜单(由业务方提供具体菜单组件)
   * 输入: helpers 含 handleResetView(重置视图) 与 screenToFlowPosition(坐标转换)
   * 输出: JSX 菜单浮层(contextMenu 为 null 时返回 null)
   */
  renderContextMenu: (helpers: {
    /** 重置视图(fitView 居中) */
    handleResetView: () => void;
    /**
     * 屏幕坐标转画布坐标(用于右键新建节点时定位)
     * 输入: screenPosition 屏幕坐标 { x, y }
     * 输出: 画布坐标 { x, y }(若 reactFlowInstance 未初始化则原样返回)
     */
    screenToFlowPosition: (screenPosition: { x: number; y: number }) => { x: number; y: number };
  }) => ReactNode;

  /** 渲染顶部工具栏右侧的额外按钮(可选, 业务方可注入业务专属按钮) */
  renderToolbarExtra?: () => ReactNode;

  /** 渲染抽屉(节点抽屉/边抽屉, 由业务方决定显示哪些) */
  renderDrawers?: () => ReactNode;

  /** 渲染空状态(节点列表为空时显示) */
  renderEmpty?: () => ReactNode;

  /** 是否为空状态(nodes.length === 0 && !loading) */
  isEmpty: boolean;
}

/**
 * 默认连接线组件
 * 提取自 TimelinePanel/CharacterGraphPanel 的 ConnectionLine 实现,
 * 根据鼠标位置动态推导终点控制点方向, 使拖拽预览曲线方向与最终落点 Handle 方向一致。
 *
 * 输入: ConnectionLineComponentProps
 *   - fromX/fromY/fromPosition 起点坐标与 Handle 位置
 *   - toX/toY 鼠标当前位置
 * 输出: SVG 路径(贝塞尔曲线 + 起点圆点)
 * 流程:
 *   1. 读取起点 Handle 位置(fromPosition)
 *   2. 根据鼠标当前位置(toX/toY)相对起点的方位, 动态推导终点控制点方向
 *   3. 调用 getBezierPath 计算路径
 *   4. 渲染虚线路径 + 起点圆点
 */
export const DefaultConnectionLine: ConnectionLineComponent = ({
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
}) => {
  // 动态推导终点控制点方向: 基于鼠标位置(toX/toY)相对起点(fromX/fromY)的方位
  // 当鼠标在起点左侧(toX < fromX)时, 终点控制点应在左侧(Position.Left),
  // 使贝塞尔曲线从起点向左延伸, 视觉上"指向"鼠标方向, 与最终落点 Handle 方向一致。
  const toPosition =
    fromPosition === Position.Left || fromPosition === Position.Right
      ? toX < fromX
        ? Position.Left
        : Position.Right
      : toY < fromY
        ? Position.Top
        : Position.Bottom;

  // 计算贝塞尔曲线路径
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
      {/* 虚线连接路径(主色蓝 + 半透明, 拖拽态视觉反馈) */}
      <path
        d={edgePath}
        fill="none"
        stroke="#6EA8FE"
        strokeWidth={2}
        strokeDasharray="5,5"
        opacity={0.7}
      />
      {/* 起点圆点(视觉锚点, 明确标识连线起始位置) */}
      <circle cx={fromX} cy={fromY} r={3} fill="#6EA8FE" opacity={0.9} />
    </g>
  );
};

/**
 * 图谱画布容器通用包装组件
 *
 * 输入: GraphPanelShellProps(见接口定义)
 * 输出: JSX 画布容器(含工具栏 + ReactFlow + 右键菜单 + 抽屉)
 * 流程:
 *   1. 渲染顶部工具栏(保存状态指示器 + 手动保存 + 清空 + 业务额外按钮)
 *   2. 渲染空状态(若 isEmpty)
 *   3. 渲染 ReactFlow 画布(Background + MiniMap)
 *   4. 注册 onNodesChange/onEdgesChange/onConnect/onNodeDragStart/onNodeDragStop 等回调
 *   5. 注册快捷键监听(Ctrl+S/L/Z/Y, Escape)
 *   6. 注册自动保存订阅(nodes/edges 变化触发 debouncedSave)
 *   7. 渲染右键菜单(通过 renderContextMenu)
 *   8. 渲染抽屉(通过 renderDrawers)
 *
 * @template TNode 业务节点类型
 * @template TEdge 业务边类型
 * @template TContextMenu 右键菜单状态类型
 * @template TSnapshot 拖拽前快照类型
 */
export function GraphPanelShell<
  TNode,
  TEdge,
  TContextMenu,
  TSnapshot
>(props: GraphPanelShellProps<TNode, TEdge, TContextMenu, TSnapshot>) {
  const {
    className,
    flowClassName,
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    nodeTypes,
    edgeTypes,
    defaultEdgeOptions,
    connectionLineComponent,
    minimapNodeColor,
    onNodeSelect,
    onPaneSelect,
    onEdgeSelect,
    currentProject,
    activeCategory,
    saving,
    saveError,
    saveNow,
    debouncedSave,
    clearGraph,
    onAutoLayout,
    undo,
    redo,
    storeAdapter,
    createSnapshot,
    i18nNamespace,
    contextMenu,
    onNodeContextMenu,
    onPaneContextMenu,
    onCloseContextMenu,
    renderContextMenu,
    renderToolbarExtra,
    renderDrawers,
    renderEmpty,
    isEmpty,
  } = props;

  const { showToast } = useToast();
  const { t } = useI18n();

  // saved 闪烁态: 保存完成(saving: true → false)后短暂显示"已保存"标记, 1.2s 后自动消失
  const [savedFlash, setSavedFlash] = useState(false);
  const prevSavingRef = useRef(false);
  useEffect(() => {
    // 检测 saving 从 true → false 的下降沿, 触发 savedFlash
    if (prevSavingRef.current && !saving && !saveError) {
      setSavedFlash(true);
      const timer = setTimeout(() => setSavedFlash(false), 1200);
      return () => clearTimeout(timer);
    }
    prevSavingRef.current = saving;
  }, [saving, saveError]);

  // ReactFlow 实例引用(用于 screenToFlowPosition 坐标转换与 fitView 重置视图)
  // 用途:
  //   1. 右键新建节点时将屏幕坐标转为画布坐标, 确保节点在右键处创建而非默认左上角
  //   2. 重置视图时调用 fitView 将所有节点居中显示并适配缩放比例
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

  // 拖拽前状态快照引用(含 nodes/edges 快照)
  // 用途: onNodeDragStop 时手动推入 zundo pastStates, 实现"整段拖拽仅 1 条历史记录"
  // 为何需要在 dragStart 捕获: zundo 的 pastStates 仅记录 setState 前的快照,
  //   pause() 后中间帧不入栈, resume() 后也无法自动补录 pre-drag 状态,
  //   故需在拖拽开始前显式保存, 拖拽结束时手动写入 pastStates。
  const preDragSnapshotRef = useRef<TSnapshot | null>(null);

  // 项目引用(自动保存订阅中读取最新项目, 避免订阅闭包捕获旧值)
  const projectRef = useRef(currentProject);
  projectRef.current = currentProject;

  // 自动保存监听: 任何 nodes/edges 变化均触发防抖保存(含 undo/redo 触发的变化)
  // 使用 Zustand 默认 subscribe + 手动比较(不依赖 subscribeWithSelector 中间件)
  useEffect(() => {
    const unsub = storeAdapter.subscribe((state, prevState) => {
      if (state.nodes !== prevState.nodes || state.edges !== prevState.edges) {
        const proj = projectRef.current;
        if (proj) {
          debouncedSave(proj.path, proj.meta.name);
        }
      }
    });
    return unsub;
  }, [storeAdapter, debouncedSave]);

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
   * 屏幕坐标转画布坐标(用于右键新建节点时定位)
   * 输入: screenPosition 屏幕坐标 { x, y }(通常为 contextmenu 事件的 clientX/clientY)
   * 输出: 画布坐标 { x, y }(若 reactFlowInstance 未初始化则原样返回屏幕坐标)
   * 流程: 调用 ReactFlowInstance.screenToFlowPosition 完成坐标转换,
   *       支持画布平移/缩放后精准定位, 避免新建节点出现在左上角而非右键位置。
   */
  const screenToFlowPosition = useCallback(
    (screenPosition: { x: number; y: number }): { x: number; y: number } => {
      return (
        reactFlowInstance.current?.screenToFlowPosition(screenPosition) ??
        screenPosition
      );
    },
    []
  );

  /**
   * 手动保存按钮回调(立即触发 saveNow)
   * 输入: 无
   * 输出: void
   * 流程: 调用 saveNow 并显示"已保存" toast
   */
  const handleManualSave = useCallback(() => {
    if (currentProject) {
      saveNow(currentProject.path, currentProject.meta.name);
      showToast("success", t(i18nNamespace.saved));
    }
  }, [currentProject, saveNow, showToast, t, i18nNamespace.saved]);

  /**
   * 清空图谱按钮回调(确认后调用 clearGraph)
   * 输入: 无
   * 输出: void
   * 流程: 弹出确认对话框, 用户确认后调用 clearGraph 并显示"已清空" toast
   *       注: 仅清空内存状态(zundo 自动追踪, 支持 Ctrl+Z 撤销),
   *       不立即删除后端文件, 由 debouncedSave 将空状态写入持久化文件。
   */
  const handleClearGraph = useCallback(() => {
    if (confirm(t(i18nNamespace.clearConfirm))) {
      clearGraph();
      showToast("success", t(i18nNamespace.cleared));
    }
  }, [clearGraph, showToast, t, i18nNamespace.clearConfirm, i18nNamespace.cleared]);

  // 快捷键监听(由父组件控制 activeCategory, 仅在该 category 激活时本面板挂载,
  // 故此处无需重复判等, 直接注册监听即可, useEffect 依赖 activeCategory 保证切换时重建)
  useEffect(() => {
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
        onAutoLayout();
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
      // 注意: && 优先级高于 ||, 必须用括号明确分组, 否则会被解析为
      //       (isMod && shift+z) || (!shift && y), 在非 Ctrl 按键下按 Y 也会触发
      if (
        isMod &&
        ((e.shiftKey && key === "z") || (!e.shiftKey && key === "y"))
      ) {
        e.preventDefault();
        e.stopPropagation();
        redo();
        return;
      }

      // Escape 关闭右键菜单 / 取消选中
      if (e.key === "Escape") {
        onPaneSelect();
        onCloseContextMenu();
        return;
      }
    };

    // 使用 capture 阶段拦截, 确保在编辑器/其他组件之前处理
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    activeCategory,
    currentProject,
    saveNow,
    undo,
    redo,
    onAutoLayout,
    onPaneSelect,
    onCloseContextMenu,
  ]);

  /**
   * 拖拽开始: 暂停 zundo 历史追踪并捕获 pre-drag 状态快照
   * 输入: 无
   * 输出: void
   * 流程:
   *   1. 通过 storeAdapter.getState() 捕获 pre-drag 状态(仅 nodes/edges)
   *   2. 调用 temporal.pause() 暂停 zundo 追踪, 后续 set() 不入栈
   *
   * 设计目的: 拖拽过程产生 60+ 次 position 更新, 仅入栈 1 条历史记录,
   *           避免撤销栈被同一拖拽操作淹没。
   */
  const handleNodeDragStart = useCallback(() => {
    const state = storeAdapter.getState();
    preDragSnapshotRef.current = createSnapshot(state);
    storeAdapter.temporal.getState().pause();
  }, [storeAdapter, createSnapshot]);

  /**
   * 拖拽结束: 恢复 zundo 追踪并手动将 pre-drag 快照推入 pastStates
   * 输入: 无
   * 输出: void
   * 流程:
   *   1. 调用 temporal.resume() 恢复 zundo 追踪
   *   2. 若 pre-drag 快照存在, 复制 pastStates, 遵守 limit=100 上限
   *   3. 追加快照到 pastStates, 清空 futureStates(新历史分支不可重做)
   *   4. 重置快照引用, 触发防抖保存
   *
   * 【Skill 偏差报备】
   * 原 Skill/计划要求调用 `useTimelineStore.temporal.getState().set()` 手动入栈。
   * 偏差原因: 经查 zundo v2.3.0 的 TemporalState 接口仅有 pause/resume/undo/redo/
   *   clear/setOnSave 方法, 不存在 set() 方法(见 node_modules/zundo/dist/index.d.ts)。
   * 偏差调整: 改用"捕获快照 + 手动推入 pastStates"方案实现等价效果,
   *   通过 temporal.setState() 直接追加到 pastStates, 并清空 futureStates。
   * 验证依据: tsc --noEmit 通过, undo/redo 行为与 zundo 语义一致。
   */
  const handleNodeDragStop = useCallback(() => {
    // 恢复 zundo 追踪
    storeAdapter.temporal.getState().resume();

    // 手动将 pre-drag 快照推入 pastStates, 形成一步历史记录
    // (pause 期间 60+ 次位置更新均未入栈, 此处仅入栈 1 条)
    const snapshot = preDragSnapshotRef.current;
    if (snapshot) {
      const temporalState = storeAdapter.temporal.getState();
      // 复制当前 pastStates, 遵守 limit=100 上限(与 timelineStore/characterGraphStore 配置一致)
      const LIMIT = 100;
      const pastStates = temporalState.pastStates.slice();
      if (pastStates.length >= LIMIT) {
        pastStates.shift();
      }
      pastStates.push(snapshot);
      // 写入 temporal store: 追加快照 + 清空 futureStates(新分支不可重做)
      storeAdapter.temporal.setState({
        pastStates,
        futureStates: [],
      });
      // 重置快照引用, 避免下次拖拽误用
      preDragSnapshotRef.current = null;
    }

    // 触发防抖保存
    if (currentProject) {
      debouncedSave(currentProject.path, currentProject.meta.name);
    }
  }, [storeAdapter, currentProject, debouncedSave]);

  /**
   * 节点点击回调(委托给业务方 onNodeSelect)
   * 输入: _ 鼠标事件(忽略), node React Flow 节点对象
   * 输出: void
   */
  const handleNodeClick = useCallback(
    (_: ReactMouseEvent, node: Node) => {
      onNodeSelect(node.id);
    },
    [onNodeSelect]
  );

  /**
   * 节点双击回调(同 onNodeClick, 业务方可用于打开抽屉)
   */
  const handleNodeDoubleClick = useCallback(
    (_: ReactMouseEvent, node: Node) => {
      onNodeSelect(node.id);
    },
    [onNodeSelect]
  );

  /**
   * 边点击回调(可选, 仅人物关系图使用)
   * 输入: _ 鼠标事件(忽略), edge React Flow 边对象
   * 输出: void
   */
  const handleEdgeClick = useCallback(
    (_: ReactMouseEvent, edge: Edge) => {
      onEdgeSelect?.(edge.id);
    },
    [onEdgeSelect]
  );

  /** 边双击回调(同 onEdgeClick, 业务方可用于打开边抽屉) */
  const handleEdgeDoubleClick = useCallback(
    (_: ReactMouseEvent, edge: Edge) => {
      onEdgeSelect?.(edge.id);
    },
    [onEdgeSelect]
  );

  /** ReactFlow 初始化回调(保存实例引用以供后续 fitView/screenToFlowPosition 使用) */
  const handleInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowInstance.current = instance;
  }, []);

  /**
   * onConnect 回调(委托给业务方 onConnect, store 内部已含自环/重复校验)
   * 输入: connection React Flow Connection 对象
   * 输出: void
   */
  const handleConnect = useCallback(
    (connection: Connection) => {
      onConnect(connection);
    },
    [onConnect]
  );

  // 工具栏按钮通用样式(与原 TimelinePanel/CharacterGraphPanel 保持一致)
  const toolButtonClass = useMemo(
    () =>
      "nf-tool-btn h-7 px-2 text-xs flex items-center justify-center gap-1.5 bg-nf-bg-sidebar border border-nf-border-light rounded-none text-nf-text-secondary",
    []
  );

  return (
    <div
      className={`h-full w-full relative ${className}`}
      data-tauri-drag-region="false"
      onDragStart={(e) => e.stopPropagation()}
    >
      {/* 空状态渲染(由业务方提供具体内容) */}
      {isEmpty && renderEmpty?.()}

      {/* 顶部右侧工具栏: 保存状态指示器 + 手动保存 + 清空 + 业务额外按钮 */}
      {/* 设计目的: 让用户明确感知"自动保存"功能存在且正常工作, 同时提供手动保存入口 */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        {/* 保存状态指示器: 四态显示(saving / savedFlash / saveError / idle 待命) */}
        <div
          className="flex items-center gap-1.5 h-7 px-2.5 text-xs bg-nf-bg-sidebar border border-nf-border-light text-nf-text-secondary"
          title={
            saveError
              ? t(i18nNamespace.saveFailed)
              : saving
                ? t(i18nNamespace.saving)
                : savedFlash
                  ? t(i18nNamespace.saved)
                  : t(i18nNamespace.save)
          }
        >
          {saveError ? (
            // 保存失败: 红色圆点 + 错误文字
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              <span className="text-red-400">{t(i18nNamespace.saveFailed)}</span>
            </>
          ) : saving ? (
            // 保存中: 蓝色旋转图标 + 保存中文字
            <>
              <Loader2 className="w-3 h-3 animate-spin text-fandex-primary" />
              <span className="text-fandex-primary">{t(i18nNamespace.saving)}</span>
            </>
          ) : savedFlash ? (
            // 保存完成(闪烁态): 绿色对勾 + 已保存文字, 1.2s 后消失
            <>
              <Check className="w-3 h-3 text-fandex-secondary" />
              <span className="text-fandex-secondary">{t(i18nNamespace.saved)}</span>
            </>
          ) : (
            // 待命态: 灰色圆点 + 自动保存文字, 表明自动保存功能已激活
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
              <span className="text-zinc-500">{t(i18nNamespace.autoSaved)}</span>
            </>
          )}
        </div>

        {/* 手动保存按钮: 立即触发 saveNow(Ctrl+S 的等效入口) */}
        <button
          onClick={handleManualSave}
          className={`${toolButtonClass} hover:text-fandex-primary hover:border-fandex-primary`}
          title={t(i18nNamespace.save)}
        >
          <Save className="w-3.5 h-3.5" />
        </button>

        {/* 清空图谱按钮(危险操作, hover 显示三级色) */}
        <button
          onClick={handleClearGraph}
          className={`${toolButtonClass} hover:text-fandex-tertiary hover:border-fandex-tertiary`}
          title={t(i18nNamespace.clearTitle)}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        {/* 业务方注入的额外工具栏按钮 */}
        {renderToolbarExtra?.()}
      </div>

      <ReactFlow
        nodes={nodes as unknown as Node[]}
        edges={edges as unknown as Edge[]}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onInit={handleInit}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={onPaneSelect}
        onEdgeClick={onEdgeSelect ? handleEdgeClick : undefined}
        onEdgeDoubleClick={onEdgeSelect ? handleEdgeDoubleClick : undefined}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onlyRenderVisibleElements={true}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={defaultEdgeOptions}
        connectionMode={ConnectionMode.Loose}
        connectionLineComponent={connectionLineComponent}
        className={flowClassName}
      >
        <Background
          variant={BackgroundVariant.Lines}
          gap={16}
          size={1}
          color="rgba(255,255,255,0.05)"
        />
        <MiniMap
          nodeColor={minimapNodeColor}
          maskColor="rgba(0,0,0,0.4)"
          className="!bg-nf-bg-sidebar"
        />
      </ReactFlow>

      {/* 右键菜单(由业务方提供具体菜单组件) */}
      {contextMenu &&
        renderContextMenu({ handleResetView, screenToFlowPosition })}

      {/* 抽屉(由业务方提供具体抽屉组件) */}
      {renderDrawers?.()}
    </div>
  );
}
