// src/lib/stores/characterGraphStore.ts
//
// 人物关系图编辑器 Service 层状态管理模块
// 基于 Zustand + zundo temporal 中间件, 提供 nodes/edges 状态管理 + 撤销重做能力。
// 防抖保存: 500ms 内多次操作合并为一次磁盘写入。
// 拖拽优化: onNodeDragStart 暂停 zundo, onNodeDragStop 恢复并手动入栈。
//
// 架构复用: 与 timelineStore.ts 保持一致的实现模式, 仅业务字段替换为角色/关系领域。

import { create } from "zustand";
import { temporal } from "zundo";
import { applyNodeChanges, applyEdgeChanges } from "@xyflow/react";
import type { NodeChange, EdgeChange, Connection, Node, Edge } from "@xyflow/react";
import type {
  CharacterGraphNode,
  CharacterGraphEdge,
  CharacterGraphNodeData,
} from "./characterGraphTypes";
import {
  readCharacterGraph,
  saveCharacterGraph,
  buildPersistedCharacterGraph,
} from "../characterGraphApi";

/*
 * 【Skill 偏差报备】
 * 原 Skill 任务要求使用 `as CharacterGraphNode[]` 单层断言处理 applyNodeChanges 返回值。
 * 偏差原因: tsc 验证报 TS2352, @xyflow/react v12 的 applyNodeChanges 泛型约束为
 *   `NodeType extends Node`, 而 Node 强制 `data: Record<string, unknown>`。
 *   项目 characterGraphTypes.ts 为遵守禁用 unknown 规则, 用 Omit 重建 CharacterGraphNode,
 *   导致 CharacterGraphNodeData 无索引签名, 与 Node 双向不兼容, 单层 as 断言不充分。
 * 偏差调整: 改用 `as unknown as` 双重断言(TypeScript 编译器官方建议方案),
 *   仅用于 xyflow 变更应用函数的入参与返回值类型转换, 不影响运行时逻辑。
 * 验证依据: 与 timelineStore.ts 同源方案, tsc --noEmit 通过。
 */

/**
 * 人物关系图编辑器状态接口
 * 通过 zundo temporal 中间件包装, 获得撤销/重做能力
 */
interface CharacterGraphState {
  /** 节点列表(与 React Flow nodes 同步) */
  nodes: CharacterGraphNode[];
  /** 边列表 */
  edges: CharacterGraphEdge[];
  /** 当前选中节点 ID(用于抽屉联动) */
  selectedNodeId: string | null;
  /** 当前选中边 ID(用于连线抽屉联动, 点击中点关系标签触发) */
  selectedEdgeId: string | null;
  /** 是否正在加载 */
  loading: boolean;
  /** 是否正在保存(防抖期间为 true) */
  saving: boolean;
  /** 保存错误信息 */
  error: string | null;

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
  /** 更新节点业务数据(抽屉编辑提交) */
  updateNodeData: (nodeId: string, patch: Partial<CharacterGraphNodeData>) => void;
  /** 更新边业务数据(关系类型/描述修改) */
  updateEdgeData: (edgeId: string, patch: Partial<{ relationType: string; description: string }>) => void;
  /** 选中节点 */
  selectNode: (id: string | null) => void;
  /** 选中边(用于连线抽屉联动) */
  selectEdge: (id: string | null) => void;
  /** 删除节点(级联删除关联边) */
  deleteNode: (nodeId: string) => void;
  /** 清空图谱(删除所有节点与边) */
  clearGraph: () => void;
  /** 撤销(取消待保存 → undo → 触发新的防抖保存) */
  undo: () => void;
  /** 重做 */
  redo: () => void;
}

/** 防抖定时器引用(模块级单例) */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 500;

export const useCharacterGraphStore = create<CharacterGraphState>()(
  temporal(
    (set, get) => ({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      selectedEdgeId: null,
      loading: false,
      saving: false,
      error: null,

      /**
       * 从后端加载图谱
       * 输入: projectRoot 项目根路径
       * 输出: Promise<void>
       * 流程: 调用 readCharacterGraph, 设置 nodes/edges
       */
      loadGraph: async (projectRoot) => {
        set({ loading: true, error: null });
        try {
          const graph = await readCharacterGraph(projectRoot);
          set({ nodes: graph.nodes, edges: graph.edges, loading: false });
        } catch (err) {
          set({ loading: false, error: String(err) });
        }
      },

      /**
       * 防抖保存(500ms 合并)
       * 输入: projectRoot 项目根路径, projectName 项目名
       * 输出: void
       * 流程: 取消上次定时器, 设置新定时器, 500ms 后执行 saveCharacterGraph
       */
      debouncedSave: (projectRoot, projectName) => {
        if (saveTimer) clearTimeout(saveTimer);
        set({ saving: true });
        saveTimer = setTimeout(async () => {
          try {
            const { nodes, edges } = get();
            const graph = buildPersistedCharacterGraph(nodes, edges, projectRoot, projectName);
            await saveCharacterGraph(projectRoot, graph);
            set({ saving: false, error: null });
          } catch (err) {
            set({ saving: false, error: String(err) });
          }
        }, SAVE_DEBOUNCE_MS);
      },

      /**
       * 立即保存(Ctrl+S 触发)
       * 输入: projectRoot 项目根路径, projectName 项目名
       * 输出: Promise<void>
       * 流程: 取消待执行防抖定时器, 立即调用 saveCharacterGraph
       */
      saveNow: async (projectRoot, projectName) => {
        if (saveTimer) clearTimeout(saveTimer);
        try {
          const { nodes, edges } = get();
          const graph = buildPersistedCharacterGraph(nodes, edges, projectRoot, projectName);
          await saveCharacterGraph(projectRoot, graph);
          set({ saving: false, error: null });
        } catch (err) {
          set({ saving: false, error: String(err) });
        }
      },

      /**
       * 应用 React Flow 节点变更
       * 输入: changes React Flow 节点变更数组
       * 输出: void
       * 流程: 调用 applyNodeChanges 应用变更到 nodes
       *       类型断言见文件顶部偏差报备(xyflow Node 约束冲突)
       */
      onNodesChange: (changes) => {
        set((state) => ({
          nodes: applyNodeChanges(
            changes,
            state.nodes as unknown as Node[]
          ) as unknown as CharacterGraphNode[],
        }));
      },

      /**
       * 应用 React Flow 边变更
       * 输入: changes React Flow 边变更数组
       * 输出: void
       * 流程: 调用 applyEdgeChanges 应用变更到 edges
       *       类型断言见文件顶部偏差报备(xyflow Edge 约束冲突)
       */
      onEdgesChange: (changes) => {
        set((state) => ({
          edges: applyEdgeChanges(
            changes,
            state.edges as unknown as Edge[]
          ) as unknown as CharacterGraphEdge[],
        }));
      },

      /**
       * 创建新连线(含自环/重复校验, 完整记录 Handle 标识)
       * 输入: connection React Flow Connection 对象(含 sourceHandle/targetHandle)
       * 输出: void
       * 流程:
       *   1. 拒绝自环(source === target)
       *   2. 拒绝重复连线(同 source/target 且同 sourceHandle/targetHandle)
       *   3. 创建新 CharacterGraphEdge, 完整记录 sourceHandle/targetHandle
       *      默认关系类型为 "other", 用户可在抽屉中修改
       */
      addEdge: (connection) => {
        // 拒绝自环
        if (connection.source === connection.target) return;
        // 拒绝重复连线(节点 + Handle 均相同才视为重复)
        const { edges } = get();
        const exists = edges.some(
          (e) =>
            e.source === connection.source &&
            e.target === connection.target &&
            (e.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
            (e.targetHandle ?? null) === (connection.targetHandle ?? null)
        );
        if (exists) return;

        const newEdge: CharacterGraphEdge = {
          id: `edge_${crypto.randomUUID()}`,
          source: connection.source,
          target: connection.target,
          // 完整记录 Handle 标识, 支持同向端点连接
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
          type: "characterEdge",
          data: { relationType: "other", description: "" },
        };
        set((state) => ({ edges: [...state.edges, newEdge] }));
      },

      /**
       * 更新节点业务数据(抽屉编辑提交)
       * 输入: nodeId 节点 ID, patch 待合并的字段
       * 输出: void
       * 流程: 合并 patch 到指定节点, 更新 updatedAt
       */
      updateNodeData: (nodeId, patch) => {
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, ...patch, updatedAt: new Date().toISOString() } }
              : n
          ),
        }));
      },

      /**
       * 更新边业务数据(关系类型/描述修改)
       * 输入: edgeId 边 ID, patch 待合并的字段(relationType/description)
       * 输出: void
       * 流程: 合并 patch 到指定边
       */
      updateEdgeData: (edgeId, patch) => {
        set((state) => ({
          edges: state.edges.map((e) =>
            e.id === edgeId
              ? {
                  ...e,
                  data: {
                    ...e.data,
                    ...(patch.relationType !== undefined
                      ? { relationType: patch.relationType as CharacterGraphEdge["data"]["relationType"] }
                      : {}),
                    ...(patch.description !== undefined ? { description: patch.description } : {}),
                  },
                }
              : e
          ),
        }));
      },

      /**
       * 选中节点
       * 输入: id 节点 ID 或 null
       * 输出: void
       */
      selectNode: (id) => set({ selectedNodeId: id }),

      /**
       * 选中边(用于连线抽屉联动)
       * 输入: id 边 ID 或 null
       * 输出: void
       */
      selectEdge: (id) => set({ selectedEdgeId: id }),

      /**
       * 删除节点(级联删除关联边)
       * 输入: nodeId 待删除节点 ID
       * 输出: void
       * 流程:
       *   1. 从 nodes 中移除该节点
       *   2. 从 edges 中移除所有 source 或 target 等于该 nodeId 的边
       */
      deleteNode: (nodeId) => {
        set((state) => ({
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
      clearGraph: () => {
        set({ nodes: [], edges: [] });
      },

      /**
       * 撤销操作
       * 输入: 无
       * 输出: void
       * 流程:
       *   1. 取消待执行的防抖保存(避免旧状态被写入磁盘)
       *   2. 调用 zundo temporal.undo()
       *   3. 由 subscribe 监听器触发新的防抖保存
       */
      undo: () => {
        if (saveTimer) clearTimeout(saveTimer);
        useCharacterGraphStore.temporal.getState().undo();
      },

      /**
       * 重做操作
       * 输入: 无
       * 输出: void
       * 流程: 同 undo, 调用 redo
       */
      redo: () => {
        if (saveTimer) clearTimeout(saveTimer);
        useCharacterGraphStore.temporal.getState().redo();
      },
    }),
    {
      // zundo 配置: 仅追踪 nodes 与 edges 变化(不追踪 loading/saving 等瞬态)
      partialize: (state) => ({ nodes: state.nodes, edges: state.edges }),
      // 历史记录上限 100 步
      limit: 100,
    }
  )
);
