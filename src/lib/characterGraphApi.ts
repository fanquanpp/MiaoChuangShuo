// src/lib/characterGraphApi.ts
//
// 人物关系图编辑器 Service 层 API 封装模块
// 通过 createGraphApi 工厂生成 read/save/clear/buildPersisted 通用方法,
// 再以业务具名函数透出, 保持向后兼容。
// 所有 UI 层调用必经此模块, 禁止直接 invoke。

import type {
  CharacterGraph,
  CharacterGraphNode,
  CharacterGraphEdge,
} from "./stores/characterGraphTypes";
import { createGraphApi } from "./api/graphApiFactory";

/**
 * 人物关系图 API 实例(由工厂生成)
 * 通过泛型绑定 CharacterGraph/CharacterGraphNode/CharacterGraphEdge 三类业务类型,
 * 注入人物关系图专属的后端命令名与错误文案。
 */
const characterGraphApi = createGraphApi<
  CharacterGraph,
  CharacterGraphNode,
  CharacterGraphEdge
>({
  readCommand: "read_character_graph",
  saveCommand: "save_character_graph",
  clearCommand: "clear_character_graph",
  logPrefix: "[CharacterGraph]",
  domainLabel: "人物关系图",
  schemaVersion: 1,
});

/**
 * 读取项目人物关系图谱
 * 输入: projectRoot 项目根路径(同时作为 projectId)
 * 输出: Promise<CharacterGraph> 图谱数据(不存在时返回空图谱)
 * 流程: 委托工厂 readGraph 方法, 调用 Tauri read_character_graph 命令
 */
export async function readCharacterGraph(projectRoot: string): Promise<CharacterGraph> {
  return characterGraphApi.readGraph(projectRoot);
}

/**
 * 保存人物关系图谱(自动生成 txt 摘要)
 * 输入: projectRoot 项目根路径, graph 图谱数据
 * 输出: Promise<void>
 * 流程: 委托工厂 saveGraph 方法, 调用 Tauri save_character_graph 命令(含数据校验与原子写入)
 * 错误诊断: 工厂内部捕获完整错误对象并输出结构化日志, 便于排查后端反序列化/IO/权限问题
 */
export async function saveCharacterGraph(
  projectRoot: string,
  graph: CharacterGraph
): Promise<void> {
  return characterGraphApi.saveGraph(projectRoot, graph);
}

/**
 * 清空人物关系图谱(含目录删除)
 * 输入: projectRoot 项目根路径
 * 输出: Promise<void>
 * 流程: 委托工厂 clearGraph 方法, 调用 Tauri clear_character_graph 命令(前端需二次确认)
 */
export async function clearCharacterGraph(projectRoot: string): Promise<void> {
  return characterGraphApi.clearGraph(projectRoot);
}

/**
 * 从 React Flow nodes/edges 数组构造 CharacterGraph 持久化结构
 * 输入: nodes React Flow 节点, edges React Flow 边,
 *       projectRoot 项目根路径(作为 projectId), projectName 项目名
 * 输出: CharacterGraph 持久化数据
 * 流程: 委托工厂 buildPersistedGraph 方法, 提取节点位置与业务数据, 组装为后端可序列化结构
 */
export function buildPersistedCharacterGraph(
  nodes: CharacterGraphNode[],
  edges: CharacterGraphEdge[],
  projectRoot: string,
  projectName: string
): CharacterGraph {
  return characterGraphApi.buildPersistedGraph(nodes, edges, projectRoot, projectName);
}
