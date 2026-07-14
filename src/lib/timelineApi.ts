// src/lib/timelineApi.ts
//
// 时间线编辑器 Service 层 API 封装模块
// 通过 createGraphApi 工厂生成 read/save/clear/buildPersisted 通用方法,
// 再以业务具名函数透出, 保持向后兼容。
// 所有 UI 层调用必经此模块, 禁止直接 invoke。

import type { TimelineGraph, TimelineNode, TimelineEdge } from "./stores/timelineTypes";
import { createGraphApi } from "./api/graphApiFactory";

/**
 * 时间线 API 实例(由工厂生成)
 * 通过泛型绑定 TimelineGraph/TimelineNode/TimelineEdge 三类业务类型,
 * 注入时间线专属的后端命令名与错误文案。
 */
const timelineApi = createGraphApi<TimelineGraph, TimelineNode, TimelineEdge>({
  readCommand: "read_timeline",
  saveCommand: "save_timeline",
  clearCommand: "clear_timeline",
  logPrefix: "[Timeline]",
  domainLabel: "剧情图谱",
  schemaVersion: 1,
});

/**
 * 读取项目剧情图谱
 * 输入: projectRoot 项目根路径(同时作为 projectId)
 * 输出: Promise<TimelineGraph> 图谱数据(不存在时返回空图谱)
 * 流程: 委托工厂 readGraph 方法, 调用 Tauri read_timeline 命令
 */
export async function readTimeline(projectRoot: string): Promise<TimelineGraph> {
  return timelineApi.readGraph(projectRoot);
}

/**
 * 保存剧情图谱(自动生成 txt 摘要)
 * 输入: projectRoot 项目根路径, graph 图谱数据
 * 输出: Promise<void>
 * 流程: 委托工厂 saveGraph 方法, 调用 Tauri save_timeline 命令(含数据校验与原子写入)
 * 错误诊断: 工厂内部捕获完整错误对象并输出结构化日志, 便于排查后端反序列化/IO/权限问题
 */
export async function saveTimeline(projectRoot: string, graph: TimelineGraph): Promise<void> {
  return timelineApi.saveGraph(projectRoot, graph);
}

/**
 * 清空剧情图谱(含目录删除)
 * 输入: projectRoot 项目根路径
 * 输出: Promise<void>
 * 流程: 委托工厂 clearGraph 方法, 调用 Tauri clear_timeline 命令(前端需二次确认)
 */
export async function clearTimeline(projectRoot: string): Promise<void> {
  return timelineApi.clearGraph(projectRoot);
}

/**
 * 从 React Flow nodes/edges 数组构造 TimelineGraph 持久化结构
 * 输入: nodes React Flow 节点, edges React Flow 边,
 *       projectRoot 项目根路径(作为 projectId), projectName 项目名
 * 输出: TimelineGraph 持久化数据
 * 流程: 委托工厂 buildPersistedGraph 方法, 提取节点位置与业务数据, 组装为后端可序列化结构
 */
export function buildPersistedGraph(
  nodes: TimelineNode[],
  edges: TimelineEdge[],
  projectRoot: string,
  projectName: string
): TimelineGraph {
  return timelineApi.buildPersistedGraph(nodes, edges, projectRoot, projectName);
}
