// src/lib/stores/graphStoreFactory.ts
//
// Graph Store 工厂模块
// 抽取 characterGraphStore 与 timelineStore 的通用 Zustand + zundo 状态管理逻辑,
// 消除两份近乎一致的 loadGraph / debouncedSave / saveNow / onNodesChange / onEdgesChange /
// addEdge / updateNodeData / deleteNode / clearGraph / undo / redo 实现。
//
// 模块职责:
//   1. 定义 createGraphStore 工厂函数, 泛型化业务图谱类型
//   2. 在工厂内实现通用 store 逻辑, 由调用方注入 API 与 createEdge
//   3. 通过 extend 回调支持业务专属字段与方法(如 selectedEdgeId / toggleCollapse)
//   4. saveTimer 移入 store state, 避免模块级单例风险(每个 store 实例独立 timer)
//
// 设计要点:
//   - TNode / TEdge 同时约束为 @xyflow/react 的 Node/Edge 子类型与 GraphNodeLike/GraphEdgeLike,
//     既满足 applyNodeChanges/applyEdgeChanges 的泛型约束, 又保留业务 data 类型链接
//   - zundo partialize 仅追踪 nodes/edges, saveTimer/loading/saving 等瞬态字段不入历史
//   - undo/redo 通过延迟绑定 temporalStore 引用调用, 避免循环依赖
//   - 返回类型不显式声明, 让 TypeScript 自动推断以保留 zundo 的 .temporal 属性

import { create } from "zustand";
import type { StoreApi } from "zustand";
import { temporal } from "zundo";
import { applyNodeChanges, applyEdgeChanges } from "@xyflow/react";
import type { NodeChange, EdgeChange, Connection, Node, Edge } from "@xyflow/react";
import type { GraphApi, PersistedGraphFields } from "../api/graphApiFactory";

// ============================================================
// 常量定义
// ============================================================

/** 防抖保存间隔(毫秒), 500ms 内多次操作合并为一次磁盘写入 */
const SAVE_DEBOUNCE_MS = 500;

/** zundo 历史记录上限(步数), 超过后丢弃最旧的历史快照 */
const HISTORY_LIMIT = 100;

/**
 * Graph store 节点最小约束
 * 业务节点类型必须满足此约束才能参与通用 store 逻辑
 *
 * @template TData 节点 data 类型, 必须包含 updatedAt 字段(updateNodeData 会更新)
 */
export interface GraphNodeLike<TData = { updatedAt: string }> {
  /** 节点唯一标识 */
  id: string;
  /** 节点业务数据, 至少含 updatedAt 字段 */
  data: TData;
}

/**
 * Graph store 边最小约束
 * 业务边类型必须满足此约束才能参与通用 store 逻辑
 */
export interface GraphEdgeLike {
  /** 边唯一标识 */
  id: string;
  /** 起点 ID */
  source: string;
  /** 终点 ID */
  target: string;
  /** 起点 Handle 标识(可选) */
  sourceHandle?: string | null;
  /** 终点 Handle 标识(可选) */
  targetHandle?: string | null;
}

/**
 * Graph store 基础 state 接口
 * 包含通用字段与方法, 业务扩展字段由 TExtra 注入
 *
 * @template TNode 业务节点类型
 * @template TEdge 业务边类型
 * @template TNodeData 节点 data 类型(用于 updateNodeData 的 patch 参数)
 */
export interface GraphStoreBaseState<TNode, TEdge, TNodeData> {
  /** 节点列表(与 React Flow nodes 同步) */
  nodes: TNode[];
  /** 边列表 */
  edges: TEdge[];
  /** 当前选中节点 ID(用于抽屉联动) */
  selectedNodeId: string | null;
  /** 是否正在加载 */
  loading: boolean;
  /** 是否正在保存(防抖期间为 true) */
  saving: boolean;
  /** 保存错误信息 */
  error: string | null;
  /**
   * 防抖定时器引用(每实例独立)
   * 修复模块级单例风险: 多个 store 实例共享 timer 会相互覆盖
   */
  saveTimer: ReturnType<typeof setTimeout> | null;

  /** 从后端加载图谱 */
  loadGraph: (projectRoot: string) => Promise<void>;
  /** 防抖保存(500ms 内多次操作合并为一次保存) */
  debouncedSave: (projectRoot: string, projectName: string) => void;
  /** 立即保存(Ctrl+S 触发) */
  saveNow: (projectRoot: string, projectName: string) => Promise<void>;
  /** 应用 React Flow 节点变更(onNodesChange 回调直接传入) */
  onNodesChange: (changes: NodeChange[]) => void;
  /** 应用 React Flow 边变更 */
  onEdgesChange: (changes: EdgeChange[]) => void;
  /** 创建新连线(onConnect 回调, 含自环/重复校验) */
  addEdge: (connection: Connection) => void;
  /** 更新节点业务数据(抽屉编辑提交, 自动刷新 updatedAt) */
  updateNodeData: (nodeId: string, patch: Partial<TNodeData>) => void;
  /** 选中节点 */
  selectNode: (id: string | null) => void;
  /** 删除节点(级联删除关联边) */
  deleteNode: (nodeId: string) => void;
  /** 清空图谱(删除所有节点与边) */
  clearGraph: () => void;
  /** 撤销(取消待保存 -> undo -> 由订阅触发新的防抖保存) */
  undo: () => void;
  /** 重做 */
  redo: () => void;
}

/** Zustand set 函数签名(与 zustand 5.x 原生类型对齐) */
type SetStateFn<T> = (
  partial: T | Partial<T> | ((state: T) => T | Partial<T>),
  replace?: boolean
) => void;

/** Zustand get 函数签名 */
type GetStateFn<T> = () => T;

/**
 * 工厂选项接口
 * 调用方通过 options 注入业务类型相关的实现差异
 *
 * @template TGraph 业务图谱类型
 * @template TNode 业务节点类型
 * @template TEdge 业务边类型
 * @template TNodeData 节点 data 类型
 * @template TExtra 业务扩展 state 类型(含额外字段与方法)
 */
export interface CreateGraphStoreOptions<
  TGraph extends PersistedGraphFields<TNode, TEdge>,
  TNode extends Node & GraphNodeLike<TNodeData>,
  TEdge extends Edge & GraphEdgeLike,
  TNodeData extends { updatedAt: string },
  TExtra extends object = object
> {
  /** store 名称(调试与日志用, 当前未输出但保留扩展位) */
  storeName: string;
  /** Graph API 实例, 提供 read/save/clear/buildPersisted 四个方法 */
  api: GraphApi<TGraph, TNode, TEdge>;
  /**
   * 创建新边(由业务方提供, 处理业务专属 type/data 字段)
   * 输入: React Flow Connection 对象
   * 输出: 业务边实例(已含 id/source/target/handle 等通用字段与业务 data)
   * 注意: 调用方无需校验自环与重复, 工厂内部已处理
   */
  createEdge: (connection: Connection) => TEdge;
  /**
   * 业务扩展初始化器(可选)
   * 调用方在此添加额外的 state 字段(如 selectedEdgeId)与方法
   * (如 selectEdge / updateEdgeData / toggleCollapse)
   * 返回值会与 base state 合并, set/get 为完整 store 的 set/get
   */
  extend?: (
    set: SetStateFn<GraphStoreBaseState<TNode, TEdge, TNodeData> & TExtra>,
    get: GetStateFn<GraphStoreBaseState<TNode, TEdge, TNodeData> & TExtra>
  ) => TExtra;
}

/**
 * 创建 Graph store 工厂函数
 * 消除 characterGraphStore 与 timelineStore 的重复通用逻辑。
 *
 * 输入参数:
 *   options 工厂选项, 包含 storeName / api / createEdge / extend(可选)
 * 返回值:
 *   Zustand store(已通过 temporal 中间件包装, 支持 .temporal.undo()/redo())
 *   返回类型不显式声明, 让 TypeScript 自动推断以保留 zundo 的 .temporal 属性
 * 核心流程:
 *   1. 解构 options 取得 api 与 createEdge;
 *   2. 声明 temporalStore 引用(用于 undo/redo, store 创建后绑定);
 *   3. 调用 create()(temporal(...)) 创建 store, 内部实现 13 个通用方法;
 *   4. 业务扩展通过 extend(set, get) 合并到 store initializer 返回值;
 *   5. zundo partialize 仅追踪 nodes/edges, saveTimer 等瞬态字段不入历史;
 *   6. store 创建后立即绑定 temporalStore, 使 undo/redo 可访问。
 *
 * @template TGraph 业务图谱类型, 必须满足 PersistedGraphFields 约束
 * @template TNode  业务节点类型, 必须同时满足 Node 与 GraphNodeLike 约束
 * @template TEdge  业务边类型, 必须同时满足 Edge 与 GraphEdgeLike 约束
 * @template TNodeData 节点 data 类型, 必须含 updatedAt 字段
 * @template TExtra 业务扩展 state 类型, 默认为空对象
 */
export function createGraphStore<
  TGraph extends PersistedGraphFields<TNode, TEdge>,
  TNode extends Node & GraphNodeLike<TNodeData>,
  TEdge extends Edge & GraphEdgeLike,
  TNodeData extends { updatedAt: string },
  TExtra extends object = object
>(options: CreateGraphStoreOptions<TGraph, TNode, TEdge, TNodeData, TExtra>) {
  const { api, createEdge, extend } = options;

  /**
   * temporal store 引用, 延迟绑定以避免循环依赖
   * 初始化为 undefined, store 创建后立即赋值
   * 类型仅使用 { undo, redo } 子集, 避免引入 zundo 内部类型
   */
  let temporalStore: StoreApi<{ undo: () => void; redo: () => void }> | undefined;

  /** 完整 state 类型 = 基础 state + 业务扩展 */
  type FullState = GraphStoreBaseState<TNode, TEdge, TNodeData> & TExtra;

  /**
   * 创建 store
   * temporal 中间件包装, 提供 undo/redo 能力
   * 返回类型由 TypeScript 自动推断, 保留 zundo 的 .temporal 属性
   */
  const useStore = create<FullState>()(
    temporal(
      (set, get) => {
        // 类型偏差说明:
        // zustand 推断的 set 类型签名为
        //   (partial: FullState | Partial<FullState> | ((state: FullState) => FullState | Partial<FullState>), replace?: boolean) => void
        // 当 TExtra 为泛型(extends object)时, TypeScript 无法保证字面对象
        // (如 { loading: true })能赋值给 Partial<FullState = GraphStoreBaseState & TExtra>,
        // 因为 TExtra 的具体字段在工厂内不可知。
        // 解决方案: 在 baseState 内部使用的 set 重新绑定为 SetStateFn<GraphStoreBaseState>,
        // 仅允许更新 base 字段; extend 回调中的 set 保持为 SetStateFn<FullState>,
        // 业务扩展方法可更新 base 字段与业务扩展字段。
        // 运行时 set 始终是 zustand 的原始 set, 会合并到完整 FullState, 类型限制仅为编译期约束。
        const setBase = set as SetStateFn<GraphStoreBaseState<TNode, TEdge, TNodeData>>;
        const getBase = get as GetStateFn<GraphStoreBaseState<TNode, TEdge, TNodeData>>;

        /** 基础 state(通用字段与方法) */
        const baseState: GraphStoreBaseState<TNode, TEdge, TNodeData> = {
          nodes: [],
          edges: [],
          selectedNodeId: null,
          loading: false,
          saving: false,
          error: null,
          saveTimer: null,

          /**
           * 从后端加载图谱
           * 输入: projectRoot 项目根路径
           * 输出: Promise<void>
           * 流程: 调用 api.readGraph, 设置 nodes/edges, 失败时记录 error
           */
          loadGraph: async (projectRoot): Promise<void> => {
            setBase({ loading: true, error: null });
            try {
              const graph = await api.readGraph(projectRoot);
              setBase({ nodes: graph.nodes, edges: graph.edges, loading: false });
            } catch (err) {
              setBase({ loading: false, error: String(err) });
            }
          },

          /**
           * 防抖保存(500ms 合并)
           * 输入: projectRoot 项目根路径, projectName 项目名
           * 输出: void
           * 流程:
           *   1. 取消上次定时器(若存在)
           *   2. 设置 saving=true, 启动新定时器
           *   3. 500ms 后调用 api.saveGraph, 成功后清理 timer
           *   4. saveTimer 移入 state, 每实例独立, 避免模块级单例风险
           */
          debouncedSave: (projectRoot, projectName): void => {
            const { saveTimer } = getBase();
            if (saveTimer) clearTimeout(saveTimer);
            setBase({ saving: true });
            const newTimer = setTimeout(async () => {
              try {
                const { nodes, edges } = getBase();
                const graph = api.buildPersistedGraph(nodes, edges, projectRoot, projectName);
                await api.saveGraph(projectRoot, graph);
                setBase({ saving: false, error: null, saveTimer: null });
              } catch (err) {
                setBase({ saving: false, error: String(err), saveTimer: null });
              }
            }, SAVE_DEBOUNCE_MS);
            setBase({ saveTimer: newTimer });
          },

          /**
           * 立即保存(Ctrl+S 触发)
           * 输入: projectRoot 项目根路径, projectName 项目名
           * 输出: Promise<void>
           * 流程: 取消待执行防抖定时器, 立即调用 api.saveGraph
           */
          saveNow: async (projectRoot, projectName): Promise<void> => {
            const { saveTimer } = getBase();
            if (saveTimer) clearTimeout(saveTimer);
            try {
              const { nodes, edges } = getBase();
              const graph = api.buildPersistedGraph(nodes, edges, projectRoot, projectName);
              await api.saveGraph(projectRoot, graph);
              setBase({ saving: false, error: null, saveTimer: null });
            } catch (err) {
              setBase({ saving: false, error: String(err), saveTimer: null });
            }
          },

          /**
           * 应用 React Flow 节点变更
           * 输入: changes React Flow 节点变更数组(由 React Flow 回调传入, 类型为 NodeChange[])
           * 输出: void
           * 流程: 调用 applyNodeChanges<TNode> 应用变更到 nodes
           *
           * 类型说明: changes 参数类型为 NodeChange[](React Flow 回调签名约束),
           *   applyNodeChanges<TNode> 期望 NodeChange<TNode>[]。
           *   因 NodeChange<TNode>[] 可赋值给 NodeChange[](协变), 使用单重 as 断言转换,
           *   不再需要 `as unknown as` 双重断言(Task 2.6)。
           *   运行期 changes 仅引用 state.nodes 中已有的 TNode 实例, 类型安全由数据源保证。
           */
          onNodesChange: (changes): void => {
            setBase((state) => ({
              nodes: applyNodeChanges<TNode>(changes as NodeChange<TNode>[], state.nodes),
            }));
          },

          /**
           * 应用 React Flow 边变更
           * 输入: changes React Flow 边变更数组(由 React Flow 回调传入, 类型为 EdgeChange[])
           * 输出: void
           * 流程: 调用 applyEdgeChanges<TEdge> 应用变更到 edges
           *
           * 类型说明: changes 参数类型为 EdgeChange[](React Flow 回调签名约束),
           *   applyEdgeChanges<TEdge> 期望 EdgeChange<TEdge>[]。
           *   因 EdgeChange<TEdge>[] 可赋值给 EdgeChange[](协变), 使用单重 as 断言转换,
           *   不再需要 `as unknown as` 双重断言(Task 2.6)。
           *   运行期 changes 仅引用 state.edges 中已有的 TEdge 实例, 类型安全由数据源保证。
           */
          onEdgesChange: (changes): void => {
            setBase((state) => ({
              edges: applyEdgeChanges<TEdge>(changes as EdgeChange<TEdge>[], state.edges),
            }));
          },

          /**
           * 创建新连线(含自环/重复校验)
           * 输入: connection React Flow Connection 对象(含 sourceHandle/targetHandle)
           * 输出: void
           * 流程:
           *   1. 拒绝自环(source === target)
           *   2. 拒绝重复连线(同 source/target 且同 sourceHandle/targetHandle)
           *   3. 调用业务方提供的 createEdge 创建新边
           *   4. 追加到 edges 数组
           */
          addEdge: (connection): void => {
            // 拒绝自环
            if (connection.source === connection.target) return;
            // 拒绝重复连线(节点 + Handle 均相同才视为重复)
            const { edges } = getBase();
            const exists = edges.some(
              (e) =>
                e.source === connection.source &&
                e.target === connection.target &&
                (e.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
                (e.targetHandle ?? null) === (connection.targetHandle ?? null)
            );
            if (exists) return;
            // 调用业务方创建新边(含业务专属 type/data 字段)
            const newEdge = createEdge(connection);
            setBase((state) => ({ edges: [...state.edges, newEdge] }));
          },

          /**
           * 更新节点业务数据(抽屉编辑提交)
           * 输入: nodeId 节点 ID, patch 待合并的字段
           * 输出: void
           * 流程: 合并 patch 到指定节点 data, 自动刷新 updatedAt
           */
          updateNodeData: (nodeId, patch): void => {
            setBase((state) => ({
              nodes: state.nodes.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, ...patch, updatedAt: new Date().toISOString() } }
                  : n
              ),
            }));
          },

          /**
           * 选中节点
           * 输入: id 节点 ID 或 null
           * 输出: void
           */
          selectNode: (id): void => setBase({ selectedNodeId: id }),

          /**
           * 删除节点(级联删除关联边)
           * 输入: nodeId 待删除节点 ID
           * 输出: void
           * 流程:
           *   1. 从 nodes 中移除该节点
           *   2. 从 edges 中移除所有 source 或 target 等于该 nodeId 的边
           */
          deleteNode: (nodeId): void => {
            setBase((state) => ({
              nodes: state.nodes.filter((n) => n.id !== nodeId),
              edges: state.edges.filter(
                (e) => e.source !== nodeId && e.target !== nodeId
              ),
            }));
          },

          /**
           * 清空图谱(删除所有节点与边)
           * 输入: 无
           * 输出: void
           * 流程: 清空 nodes 与 edges 数组
           */
          clearGraph: (): void => {
            setBase({ nodes: [], edges: [] });
          },

          /**
           * 撤销操作
           * 输入: 无
           * 输出: void
           * 流程:
           *   1. 取消待执行的防抖保存(避免旧状态被写入磁盘)
           *   2. 通过 temporalStore 引用调用 zundo undo()
           *   3. 由 subscribe 监听器触发新的防抖保存
           */
          undo: (): void => {
            const { saveTimer } = getBase();
            if (saveTimer) clearTimeout(saveTimer);
            temporalStore?.getState().undo();
          },

          /**
           * 重做操作
           * 输入: 无
           * 输出: void
           * 流程: 同 undo, 调用 redo
           */
          redo: (): void => {
            const { saveTimer } = getBase();
            if (saveTimer) clearTimeout(saveTimer);
            temporalStore?.getState().redo();
          },
        };

        /** 业务扩展 state(由调用方通过 extend 回调提供) */
        const extraState = extend
          ? extend(
              set as SetStateFn<FullState>,
              get as GetStateFn<FullState>
            )
          : ({} as TExtra);

        /** 合并基础 state 与业务扩展, 返回完整 store state */
        return {
          ...baseState,
          ...extraState,
        };
      },
      {
        // zundo 配置: 仅追踪 nodes 与 edges 变化(不追踪 loading/saving/saveTimer 等瞬态)
        partialize: (state) => ({ nodes: state.nodes, edges: state.edges }),
        // 历史记录上限(步数)
        limit: HISTORY_LIMIT,
      }
    )
  );

  // 绑定 temporal 引用(必须在 store 创建后)
  // 使 undo/redo 可通过 temporalStore 访问, 避免在 store 内部循环引用 useStore
  temporalStore = useStore.temporal;

  return useStore;
}
