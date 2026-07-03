// src/lib/timelineApi.ts
//
// 时间线编辑器 Service 层 API 封装模块
// 封装 Tauri invoke 调用, 统一错误处理, 提供 readTimeline/saveTimeline/clearTimeline 三个方法。
// 所有 UI 层调用必经此模块, 禁止直接 invoke。

import { invoke } from "@tauri-apps/api/core";
import type { TimelineGraph, TimelineNode, TimelineEdge } from "./stores/timelineTypes";

/**
 * 读取项目剧情图谱
 * 输入: projectRoot 项目根路径(同时作为 projectId)
 * 输出: Promise<TimelineGraph> 图谱数据(不存在时返回空图谱)
 * 流程: 调用 Tauri read_timeline 命令, 统一错误处理
 */
export async function readTimeline(projectRoot: string): Promise<TimelineGraph> {
  try {
    return await invoke<TimelineGraph>("read_timeline", { projectRoot });
  } catch (err) {
    throw new Error(`读取剧情图谱失败: ${String(err)}`);
  }
}

/**
 * 保存剧情图谱(自动生成 txt 摘要)
 * 输入: projectRoot 项目根路径, graph 图谱数据
 * 输出: Promise<void>
 * 流程: 调用 Tauri save_timeline 命令(含数据校验与原子写入)
 * 错误诊断: 捕获完整错误对象并输出结构化日志, 便于排查后端反序列化/IO/权限问题
 */
export async function saveTimeline(projectRoot: string, graph: TimelineGraph): Promise<void> {
  try {
    await invoke("save_timeline", { projectRoot, graph });
  } catch (err) {
    // 结构化错误日志: 输出命令名/项目路径/图谱字段键/完整错误对象
    // 便于快速定位是 "command not found" 还是 "missing field xxx" 还是 IO 错误
    console.error("[Timeline] 保存失败详情:", {
      command: "save_timeline",
      projectRoot,
      graphKeys: Object.keys(graph),
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      error: err,
      errorType: typeof err,
      errorString: String(err),
    });
    throw new Error(`保存剧情图谱失败: ${String(err)}`);
  }
}

/**
 * 清空剧情图谱(含目录删除)
 * 输入: projectRoot 项目根路径
 * 输出: Promise<void>
 * 流程: 调用 Tauri clear_timeline 命令(前端需二次确认)
 */
export async function clearTimeline(projectRoot: string): Promise<void> {
  try {
    await invoke("clear_timeline", { projectRoot });
  } catch (err) {
    throw new Error(`清空剧情图谱失败: ${String(err)}`);
  }
}

/**
 * 从 React Flow nodes/edges 数组构造 TimelineGraph 持久化结构
 * 输入: nodes React Flow 节点, edges React Flow 边,
 *       projectRoot 项目根路径(作为 projectId), projectName 项目名
 * 输出: TimelineGraph 持久化数据
 * 流程: 提取节点位置与业务数据, 组装为后端可序列化结构
 */
export function buildPersistedGraph(
  nodes: TimelineNode[],
  edges: TimelineEdge[],
  projectRoot: string,
  projectName: string
): TimelineGraph {
  return {
    schemaVersion: 1,
    projectId: projectRoot,
    projectName,
    updatedAt: new Date().toISOString(),
    nodes,
    edges,
  };
}
