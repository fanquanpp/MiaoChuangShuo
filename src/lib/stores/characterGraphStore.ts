// src/lib/stores/characterGraphStore.ts
//
// 人物关系图编辑器 Service 层状态管理模块
// 基于 Zustand + zundo temporal 中间件, 提供 nodes/edges 状态管理 + 撤销重做能力。
// 防抖保存: 500ms 内多次操作合并为一次磁盘写入。
// 拖拽优化: onNodeDragStart 暂停 zundo, onNodeDragStop 恢复并手动入栈。
//
// 架构复用: 通过 createGraphStore 工厂生成基础 store(loadGraph/debouncedSave/saveNow/
// onNodesChange/onEdgesChange/addEdge/updateNodeData/selectNode/deleteNode/clearGraph/undo/redo),
// 业务扩展(selectedEdgeId/updateEdgeData/selectEdge/createNodeFromCodexCard)通过 extend 回调注入。

import type { Connection } from "@xyflow/react";
import type {
  CharacterGraph,
  CharacterGraphNode,
  CharacterGraphEdge,
  CharacterGraphNodeData,
} from "./characterGraphTypes";
import { DEFAULT_NODE_ACCENT } from "./characterGraphTypes";
import {
  readCharacterGraph,
  saveCharacterGraph,
  clearCharacterGraph,
  buildPersistedCharacterGraph,
} from "../characterGraphApi";
import { createGraphStore, type GraphStoreBaseState } from "./graphStoreFactory";
import type { GraphApi } from "../api/graphApiFactory";

/**
 * 人物关系图业务扩展 state
 * 在通用 GraphStoreBaseState 之上, 添加人物关系图专属字段与方法
 */
interface CharacterGraphExtra {
  /** 当前选中边 ID(用于连线抽屉联动, 点击中点关系标签触发) */
  selectedEdgeId: string | null;
  /** 更新边业务数据(关系类型/描述修改) */
  updateEdgeData: (
    edgeId: string,
    patch: Partial<{ relationType: string; description: string }>
  ) => void;
  /** 选中边(用于连线抽屉联动) */
  selectEdge: (id: string | null) => void;
  /**
   * 从设定库卡片创建图谱节点(Task 4.1.3)
   * 输入: codexId 设定库卡片 UUID, name 卡片名称, sourceFile 卡片来源文件路径,
   *       identity 身份(可选), tags 标签数组(可选), brief 简介(可选)
   * 输出: string 新创建的节点 ID(node_<uuid>)
   * 流程:
   *   1. 幂等检查: 若已有节点的 codexId 与传入相同, 直接返回该节点 ID, 不重复创建
   *   2. 构造 CharacterGraphNode(codexId/sourceFile 从入参注入, 其他业务字段填默认值或入参)
   *   3. 通过 setState 追加到 nodes 数组
   *   4. 返回新节点 ID 供调用方做后续跳转/选中
   * 设计说明:
   *   - 幂等机制避免同一卡片被重复添加到图谱, 维持数据一致性
   *   - 节点 position 默认 (0,0), 由 CharacterGraphPanel 的自动布局或用户拖拽调整
   *   - 此方法不触发 debouncedSave, 由 store 工厂的 onNodesChange 监听机制自动触发保存
   */
  createNodeFromCodexCard: (params: {
    codexId: string;
    name: string;
    sourceFile: string;
    identity?: string;
    tags?: string[];
    brief?: string;
  }) => string;
}

/**
 * 完整 store state 类型 = 基础 state + 业务扩展
 * 保留具名导出以兼容外部代码中对 store state 类型的引用
 */
export type CharacterGraphState = GraphStoreBaseState<
  CharacterGraphNode,
  CharacterGraphEdge,
  CharacterGraphNodeData
> & CharacterGraphExtra;

/**
 * Graph API 实例(委托给 characterGraphApi.ts 的具名函数)
 * 通过组合而非修改 characterGraphApi.ts, 保持向后兼容
 */
const characterGraphApiInstance: GraphApi<
  CharacterGraph,
  CharacterGraphNode,
  CharacterGraphEdge
> = {
  readGraph: readCharacterGraph,
  saveGraph: saveCharacterGraph,
  clearGraph: clearCharacterGraph,
  buildPersistedGraph: buildPersistedCharacterGraph,
};

/**
 * 创建新边(由工厂在 addEdge 中调用)
 * 输入: connection React Flow Connection 对象
 * 输出: CharacterGraphEdge 业务边实例
 * 流程: 完整记录 Handle 标识, 默认关系类型为 "other", 用户可在抽屉中修改
 */
function createCharacterEdge(connection: Connection): CharacterGraphEdge {
  return {
    id: `edge_${crypto.randomUUID()}`,
    source: connection.source,
    target: connection.target,
    // 完整记录 Handle 标识, 支持同向端点连接
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    type: "characterEdge",
    data: { relationType: "other", description: "" },
  };
}

/**
 * 人物关系图 store(由 createGraphStore 工厂生成)
 * 通用方法由工厂实现, 业务扩展通过 extend 注入
 */
export const useCharacterGraphStore = createGraphStore<
  CharacterGraph,
  CharacterGraphNode,
  CharacterGraphEdge,
  CharacterGraphNodeData,
  CharacterGraphExtra
>({
  storeName: "CharacterGraphStore",
  api: characterGraphApiInstance,
  createEdge: createCharacterEdge,
  extend: (set, get) => ({
    selectedEdgeId: null,

    /**
     * 更新边业务数据(关系类型/描述修改)
     * 输入: edgeId 边 ID, patch 待合并的字段(relationType/description)
     * 输出: void
     * 流程: 合并 patch 到指定边
     */
    updateEdgeData: (edgeId, patch): void => {
      set((state) => ({
        edges: state.edges.map((e) =>
          e.id === edgeId
            ? {
                ...e,
                data: {
                  ...e.data,
                  ...(patch.relationType !== undefined
                    ? {
                        relationType: patch.relationType as CharacterGraphEdge["data"]["relationType"],
                      }
                    : {}),
                  ...(patch.description !== undefined ? { description: patch.description } : {}),
                },
              }
            : e
        ),
      }));
    },

    /**
     * 选中边(用于连线抽屉联动)
     * 输入: id 边 ID 或 null
     * 输出: void
     */
    selectEdge: (id): void => set({ selectedEdgeId: id }),

    /**
     * 从设定库卡片创建图谱节点(Task 4.1.3)
     * 输入: params { codexId, name, sourceFile, identity?, tags?, brief? }
     * 输出: string 新建或已存在的节点 ID
     * 流程:
     *   1. 幂等检查: 若已有节点 codexId 匹配, 直接返回该节点 ID
     *   2. 否则构造 CharacterGraphNode 并追加到 nodes 数组
     * 设计说明:
     *   - 节点 position 默认 (0,0), 由 CharacterGraphPanel 的自动布局或用户拖拽调整
     *   - 此方法不直接触发 debouncedSave, 由 store 工厂的 onNodesChange 监听机制自动触发保存
     */
    createNodeFromCodexCard: (params): string => {
      const { codexId, name, sourceFile, identity, tags, brief } = params;
      // 幂等检查: 同一 codexId 不重复创建
      const existing = get().nodes.find((n) => n.data.codexId === codexId);
      if (existing) {
        return existing.id;
      }
      const now = new Date().toISOString();
      const newNodeId = `node_${crypto.randomUUID()}`;
      const newNode: CharacterGraphNode = {
        id: newNodeId,
        type: "characterNode",
        position: { x: 0, y: 0 },
        data: {
          name,
          identity: identity ?? "",
          tags: tags ?? [],
          brief: brief ?? "",
          accentColor: DEFAULT_NODE_ACCENT,
          sourceFile,
          codexId,
          createdAt: now,
          updatedAt: now,
        },
      };
      set((state) => ({ nodes: [...state.nodes, newNode] }));
      return newNodeId;
    },
  }),
});
