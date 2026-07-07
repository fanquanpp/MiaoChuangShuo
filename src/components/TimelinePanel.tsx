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
import { Trash2, Save, Loader2, Check } from "lucide-react";
import "@xyflow/react/dist/style.css";

import { useAppStore } from "../lib/store";
import { useTimelineStore, filterCollapsed } from "../lib/stores/timelineStore";
import { autoLayout } from "../lib/dagreLayout";
import { EDGE_TYPE_COLORS } from "../lib/stores/timelineTypes";
import type {
  TimelineNodeType,
  TimelineNode as StoryTimelineNode,
  TimelineEdge as StoryTimelineEdge,
} from "../lib/stores/timelineTypes";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";

import TimelineNode from "./TimelineNode";
import TimelineEdge from "./TimelineEdge";
import TimelineEmpty from "./TimelineEmpty";
import TimelineContextMenu from "./TimelineContextMenu";
import TimelineDrawer from "./TimelineDrawer";

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
 * 修复记录(Bug 2: 连线动画方向与实际结果不一致):
 *   原实现固定使用起点对称方向作为 toPosition(起点在左 → 终点在右),
 *   导致从 A.right 拖向 B.left 时, 拖拽过程中曲线视觉上从 A.right 连向 B.right(对称方向),
 *   与最终连线结果(A.right → B.left)不一致。
 *   现根据鼠标位置动态推导 toPosition: 鼠标在起点左侧时终点控制点在左, 右侧时在右,
 *   使拖拽预览曲线方向与最终落点 Handle 方向一致。
 */
const TimelineConnectionLine: ConnectionLineComponent = ({
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
}) => {
  // 动态推导终点控制点方向: 基于鼠标位置(toX/toY)相对起点(fromX/fromY)的方位
  // 当鼠标在起点左侧(toX < fromX)时, 终点控制点应在左侧(Position.Left),
  // 使贝塞尔曲线从起点向左延伸, 视觉上"指向"鼠标方向, 与最终落点 Handle 方向一致。
  // 上下方向同理(本画布节点仅左右 Handle, 但保留上下推导以备扩展)。
  const toPosition =
    fromPosition === Position.Left || fromPosition === Position.Right
      ? toX < fromX
        ? Position.Left
        : Position.Right
      : toY < fromY
        ? Position.Top
        : Position.Bottom;

  // 计算贝塞尔曲线路径(起点方向用 fromPosition, 终点方向用动态推导的 toPosition)
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
  // 保存状态订阅: saving 防抖期间为 true, error 保存失败时携带错误信息
  // 用途: 工具栏右侧渲染保存指示器, 让用户明确感知"自动保存"功能存在且正常工作
  const saving = useTimelineStore((s) => s.saving);
  const saveError = useTimelineStore((s) => s.error);
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

  // ReactFlow 实例引用(用于 screenToFlowPosition 坐标转换)
  // 用途: 右键新建节点时将屏幕坐标转为画布坐标, 确保节点在右键处创建而非默认左上角
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

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

  // 拖拽前状态快照引用(含 nodes/edges 快照)
  // 用途: onNodeDragStop 时手动推入 zundo pastStates, 实现"整段拖拽仅 1 条历史记录"
  // 为何需要在 dragStart 捕获: zundo 的 pastStates 仅记录 setState 前的快照,
  //   pause() 后中间帧不入栈, resume() 后也无法自动补录 pre-drag 状态,
  //   故需在拖拽开始前显式保存, 拖拽结束时手动写入 pastStates。
  const preDragSnapshotRef = useRef<{
    nodes: StoryTimelineNode[];
    edges: StoryTimelineEdge[];
  } | null>(null);

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
   * 重置视图(居中并自适应缩放)
   * 输入: 无
   * 输出: void
   * 流程: 调用 ReactFlowInstance.fitView 将所有节点居中显示并适配缩放比例
   */
  const handleResetView = useCallback(() => {
    reactFlowInstance.current?.fitView({ padding: 0.2, duration: 300 });
  }, []);

  /**
   * 创建新节点并可选地连线到父节点
   * 输入: type 节点类型, screenPosition 屏幕坐标(右键位置), parentId 父节点 ID(可选)
   * 输出: void
   * 流程:
   *   1. 通过 screenToFlowPosition 将屏幕坐标转为画布坐标(支持画布平移/缩放后精准定位)
   *   2. 构造 TimelineNode(含默认值)
   *   3. 添加到 store.nodes
   *   4. 若 parentId 存在, 创建对应类型的边
   *
   * 修复记录: 原实现直接使用屏幕坐标作为节点 position, 导致画布平移/缩放后
   *           新建节点始终出现在左上角而非右键位置。现通过 reactFlowInstance
   *           的 screenToFlowPosition 方法完成正确的坐标转换。
   */
  const handleCreateNode = useCallback(
    (type: TimelineNodeType, screenPosition: { x: number; y: number }, parentId?: string) => {
      // 坐标转换: 屏幕坐标 → 画布坐标(支持画布平移/缩放)
      const position = reactFlowInstance.current?.screenToFlowPosition(screenPosition) ?? screenPosition;
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

  /**
   * 拖拽性能优化(zundo pause/resume)
   * 原理:
   *   1. onNodeDragStart: 暂停 zundo 历史追踪, 同时捕获 pre-drag 状态快照
   *   2. onNodeDrag: 正常应用位置变更到 store(由 onNodesChange 处理, 保证 UI 流畅)
   *   3. onNodeDragStop: 恢复 zundo 追踪 → 手动将 pre-drag 快照推入 pastStates
   * 效果: 拖拽过程产生 60+ 次 position 更新, 但仅入栈 1 条历史记录
   *
   * 关键: 受控模式下必须正常更新 store, 否则节点会弹回原位
   *
   * 【Skill 偏差报备】
   * 原 Skill/计划要求调用 `useTimelineStore.temporal.getState().set()` 手动入栈。
   * 偏差原因: 经查 zundo v2.3.0 的 TemporalState 接口仅有 pause/resume/undo/redo/
   *   clear/setOnSave 方法, 不存在 set() 方法(见 node_modules/zundo/dist/index.d.ts)。
   * 偏差调整: 改用"捕获快照 + 手动推入 pastStates"方案实现等价效果:
   *   - dragStart 时通过 useTimelineStore.getState() 捕获 pre-drag 状态
   *   - dragStop 时通过 useTimelineStore.temporal.setState() 直接追加到 pastStates,
   *     并清空 futureStates(新历史分支), 同时遵守 limit=100 上限。
   * 验证依据: tsc --noEmit 通过, undo/redo 行为与 zundo 语义一致。
   */
  const handleNodeDragStart = useCallback(() => {
    // 捕获 pre-drag 状态快照(仅保留 partialize 关心的字段: nodes/edges)
    const state = useTimelineStore.getState();
    preDragSnapshotRef.current = {
      nodes: state.nodes,
      edges: state.edges,
    };
    // 暂停 zundo 追踪: 后续的 set() 调用不会产生历史记录
    useTimelineStore.temporal.getState().pause();
  }, []);

  const handleNodeDragStop = useCallback(() => {
    // 恢复 zundo 追踪
    useTimelineStore.temporal.getState().resume();

    // 手动将 pre-drag 快照推入 pastStates, 形成一步历史记录
    // (pause 期间 60+ 次位置更新均未入栈, 此处仅入栈 1 条)
    const snapshot = preDragSnapshotRef.current;
    if (snapshot) {
      const temporalState = useTimelineStore.temporal.getState();
      // 复制当前 pastStates, 遵守 limit=100 上限(与 timelineStore.ts 配置一致)
      const LIMIT = 100;
      const pastStates = temporalState.pastStates.slice();
      if (pastStates.length >= LIMIT) {
        pastStates.shift();
      }
      pastStates.push(snapshot);
      // 写入 temporal store: 追加快照 + 清空 futureStates(新分支不可重做)
      useTimelineStore.temporal.setState({
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
  }, [currentProject, debouncedSave]);

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
      className="h-full w-full relative timeline-canvas-root"
      data-tauri-drag-region="false"
      onDragStart={(e) => e.stopPropagation()}
    >
      {isEmpty && <TimelineEmpty />}

      {/* 顶部右侧工具栏: 保存状态指示器 + 手动保存 + 清空 */}
      {/* 设计目的: 让用户明确感知"自动保存"功能存在且正常工作, 同时提供手动保存入口 */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        {/* 保存状态指示器: 三态显示(saving 保存中 / savedFlash 已保存 / saveError 保存失败 / idle 待命) */}
        <div
          className="flex items-center gap-1.5 h-7 px-2.5 text-xs bg-nf-bg-sidebar border border-nf-border-light text-nf-text-secondary"
          title={
            saveError
              ? t("timeline.toast.saveFailed")
              : saving
                ? t("timeline.saving")
                : savedFlash
                  ? t("timeline.toast.saved")
                  : t("timeline.save")
          }
        >
          {saveError ? (
            // 保存失败: 红色感叹号图标 + 错误文字
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              <span className="text-red-400">{t("timeline.toast.saveFailed")}</span>
            </>
          ) : saving ? (
            // 保存中: 蓝色旋转图标 + 保存中文字
            <>
              <Loader2 className="w-3 h-3 animate-spin text-fandex-primary" />
              <span className="text-fandex-primary">{t("timeline.saving")}</span>
            </>
          ) : savedFlash ? (
            // 保存完成(闪烁态): 绿色对勾 + 已保存文字, 1.2s 后消失
            <>
              <Check className="w-3 h-3 text-fandex-secondary" />
              <span className="text-fandex-secondary">{t("timeline.toast.saved")}</span>
            </>
          ) : (
            // 待命态: 灰色圆点 + 自动保存文字, 表明自动保存功能已激活
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
              <span className="text-zinc-500">{t("timeline.autoSaved")}</span>
            </>
          )}
        </div>

        {/* 手动保存按钮: 立即触发 saveNow(Ctrl+S 的等效入口) */}
        <button
          onClick={() => {
            if (currentProject) {
              saveNow(currentProject.path, currentProject.meta.name);
              showToast("success", t("timeline.toast.saved"));
            }
          }}
          className="nf-tool-btn h-7 px-2 text-xs flex items-center justify-center gap-1.5 bg-nf-bg-sidebar border border-nf-border-light rounded-none text-nf-text-secondary hover:text-fandex-primary hover:border-fandex-primary"
          title={t("timeline.save")}
        >
          <Save className="w-3.5 h-3.5" />
        </button>

        {/* 清空图谱按钮 */}
        <button
          onClick={() => {
            if (confirm(t("timeline.toast.clearConfirm"))) {
              // 仅清空内存状态(zundo 自动追踪, 支持 Ctrl+Z 撤销)
              // 不再立即调用 clearTimeline 删除后端文件,
              // 由 debouncedSave 将空状态写入 timeline.json(等价效果且支持撤销恢复)
              clearGraph();
              showToast("success", t("timeline.toast.cleared"));
            }
          }}
          className="nf-tool-btn h-7 px-2 text-xs flex items-center justify-center gap-1.5 bg-nf-bg-sidebar border border-nf-border-light rounded-none text-nf-text-secondary hover:text-fandex-tertiary hover:border-fandex-tertiary"
          title="清空图谱"
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
        defaultEdgeOptions={{ type: "storyEdge" }}
        connectionMode={ConnectionMode.Loose}
        connectionLineComponent={TimelineConnectionLine}
        className="timeline-flow"
      >
        <Background
          variant={BackgroundVariant.Lines}
          gap={16}
          size={1}
          color="rgba(255,255,255,0.05)"
        />
        <MiniMap
          nodeColor={(node) => {
            const nodeType = (node.data as { nodeType?: string } | undefined)?.nodeType ?? "main";
            return EDGE_TYPE_COLORS[nodeType as keyof typeof EDGE_TYPE_COLORS] ?? "#6EA8FE";
          }}
          maskColor="rgba(0,0,0,0.4)"
          className="!bg-nf-bg-sidebar"
        />
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
