// src/lib/characterGraphApi.ts
//
// 人物关系图编辑器 Service 层 API 封装模块
// 封装 Tauri invoke 调用, 统一错误处理,
// 提供 readCharacterGraph/saveCharacterGraph/clearCharacterGraph 三个方法。
// 所有 UI 层调用必经此模块, 禁止直接 invoke。

import { invoke } from "@tauri-apps/api/core";
import type {
  CharacterGraph,
  CharacterGraphNode,
  CharacterGraphEdge,
} from "./stores/characterGraphTypes";

/**
 * 读取项目人物关系图谱
 * 输入: projectRoot 项目根路径(同时作为 projectId)
 * 输出: Promise<CharacterGraph> 图谱数据(不存在时返回空图谱)
 * 流程: 调用 Tauri read_character_graph 命令, 统一错误处理
 */
export async function readCharacterGraph(projectRoot: string): Promise<CharacterGraph> {
  try {
    return await invoke<CharacterGraph>("read_character_graph", { projectRoot });
  } catch (err) {
    throw new Error(`读取人物关系图失败: ${String(err)}`);
  }
}

/**
 * 保存人物关系图谱(自动生成 txt 摘要)
 * 输入: projectRoot 项目根路径, graph 图谱数据
 * 输出: Promise<void>
 * 流程: 调用 Tauri save_character_graph 命令(含数据校验与原子写入)
 * 错误诊断: 捕获完整错误对象并输出结构化日志, 便于排查后端反序列化/IO/权限问题
 */
export async function saveCharacterGraph(
  projectRoot: string,
  graph: CharacterGraph
): Promise<void> {
  try {
    await invoke("save_character_graph", { projectRoot, graph });
  } catch (err) {
    // 结构化错误日志: 输出命令名/项目路径/图谱字段键/完整错误对象
    // 便于快速定位是 "command not found" 还是 "missing field xxx" 还是 IO 错误
    console.error("[CharacterGraph] 保存失败详情:", {
      command: "save_character_graph",
      projectRoot,
      graphKeys: Object.keys(graph),
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      error: err,
      errorType: typeof err,
      errorString: String(err),
    });
    throw new Error(`保存人物关系图失败: ${String(err)}`);
  }
}

/**
 * 清空人物关系图谱(含目录删除)
 * 输入: projectRoot 项目根路径
 * 输出: Promise<void>
 * 流程: 调用 Tauri clear_character_graph 命令(前端需二次确认)
 */
export async function clearCharacterGraph(projectRoot: string): Promise<void> {
  try {
    await invoke("clear_character_graph", { projectRoot });
  } catch (err) {
    throw new Error(`清空人物关系图失败: ${String(err)}`);
  }
}

/**
 * 从 React Flow nodes/edges 数组构造 CharacterGraph 持久化结构
 * 输入: nodes React Flow 节点, edges React Flow 边,
 *       projectRoot 项目根路径(作为 projectId), projectName 项目名
 * 输出: CharacterGraph 持久化数据
 * 流程: 提取节点位置与业务数据, 组装为后端可序列化结构
 */
export function buildPersistedCharacterGraph(
  nodes: CharacterGraphNode[],
  edges: CharacterGraphEdge[],
  projectRoot: string,
  projectName: string
): CharacterGraph {
  return {
    schemaVersion: 1,
    projectId: projectRoot,
    projectName,
    updatedAt: new Date().toISOString(),
    nodes,
    edges,
  };
}
