// src/lib/stores/timelineStore.ts
//
// 时间线编辑器 Service 层状态管理模块
// 基于 Zustand + zundo temporal 中间件, 提供 nodes/edges 状态管理 + 撤销重做能力。
// 防抖保存: 500ms 内多次操作合并为一次磁盘写入。
// 拖拽优化: onNodeDragStart 暂停 zundo, onNodeDragStop 恢复并手动入栈。
//
// 架构复用: 通过 createGraphStore 工厂生成基础 store(loadGraph/debouncedSave/saveNow/
// onNodesChange/onEdgesChange/addEdge/updateNodeData/selectNode/deleteNode/clearGraph/undo/redo),
// 业务扩展(toggleCollapse)通过 extend 回调注入。

import type { Connection } from "@xyflow/react";
import type {
  TimelineGraph,
  TimelineNode,
  TimelineEdge,
  TimelineNodeData,
} from "./timelineTypes";
import {
  readTimeline,
  saveTimeline,
  clearTimeline,
  buildPersistedGraph,
} from "../timelineApi";
import { createGraphStore, type GraphStoreBaseState } from "./graphStoreFactory";
import type { GraphApi } from "../api/graphApiFactory";

// filterCollapsed 已迁移至 src/lib/graphUtils.ts 作为无副作用纯函数
// 此处通过 re-export 保留入口, 保持调用方导入路径向后兼容
export { filterCollapsed } from "../graphUtils";

/**
 * 时间线业务扩展 state
 * 在通用 GraphStoreBaseState 之上, 添加时间线专属方法(折叠/展开 main 节点)
 */
interface TimelineExtra {
  /** 折叠/展开 main 节点(切换 collapsed 字段, 仅 main 节点有效) */
  toggleCollapse: (nodeId: string) => void;
}

/**
 * 完整 store state 类型 = 基础 state + 业务扩展
 * 保留具名导出以兼容外部代码中对 store state 类型的引用
 */
export type TimelineState = GraphStoreBaseState<
  TimelineNode,
  TimelineEdge,
  TimelineNodeData
> & TimelineExtra;

/**
 * Graph API 实例(委托给 timelineApi.ts 的具名函数)
 * 通过组合而非修改 timelineApi.ts, 保持向后兼容
 */
const timelineApiInstance: GraphApi<TimelineGraph, TimelineNode, TimelineEdge> = {
  readGraph: readTimeline,
  saveGraph: saveTimeline,
  clearGraph: clearTimeline,
  buildPersistedGraph: buildPersistedGraph,
};

/**
 * 创建新边(由工厂在 addEdge 中调用)
 * 输入: connection React Flow Connection 对象
 * 输出: TimelineEdge 业务边实例
 * 流程: 完整记录 Handle 标识, 默认边类型为 "main"(主线连接)
 *
 * 修复记录(Bug 1: 同向端点连接导致结果错误):
 *   原实现仅记录 connection.source 与 connection.target(节点 ID),
 *   未记录 connection.sourceHandle 与 connection.targetHandle(Handle 标识),
 *   导致 React Flow Loose 模式下自动翻转 source-source / target-target 连接,
 *   用户从 A.right 拖到 B.right 时, 实际结果变成 A.right -> B.left。
 *   现完整记录 Handle 标识, 让边精确反映用户拖拽的两个 Handle,
 *   配合 TimelineNode.tsx 中 Handle 的 id 属性, React Flow 可正确推导
 *   sourcePosition/targetPosition, 渲染用户实际绘制的连线。
 */
function createTimelineEdge(connection: Connection): TimelineEdge {
  return {
    id: `edge_${crypto.randomUUID()}`,
    source: connection.source,
    target: connection.target,
    // 完整记录 Handle 标识, 支持同向端点连接(如 right-source -> right-source)
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    type: "storyEdge",
    data: { edgeKind: "main" },
  };
}

/**
 * 时间线 store(由 createGraphStore 工厂生成)
 * 通用方法由工厂实现, 业务扩展(toggleCollapse)通过 extend 注入
 */
export const useTimelineStore = createGraphStore<
  TimelineGraph,
  TimelineNode,
  TimelineEdge,
  TimelineNodeData,
  TimelineExtra
>({
  storeName: "TimelineStore",
  api: timelineApiInstance,
  createEdge: createTimelineEdge,
  extend: (set) => ({
    /**
     * 折叠/展开 main 节点
     * 输入: nodeId 节点 ID
     * 输出: void
     * 流程: 切换 collapsed 字段(仅 main 节点有效), 其他类型节点忽略
     *       折叠状态变化由 zundo 追踪, 产生一次历史步骤
     */
    toggleCollapse: (nodeId): void => {
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === nodeId && n.data.nodeType === "main"
            ? { ...n, data: { ...n.data, collapsed: !n.data.collapsed } }
            : n
        ),
      }));
    },
  }),
});
