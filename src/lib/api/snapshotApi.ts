// 喵创说 版本快照 API
//
// 模块职责：
// 封装文件版本快照的创建、列举、读取、恢复、删除、清空与统计。
// 快照存储于项目 .novelforge/snapshots/ 目录，用于误操作回滚。
//
// 依赖：
// - @tauri-apps/api/core 的 invoke 调用 Rust 后端
// - ./_internal 的 validatePathInProject 做路径前缀校验

import { invoke } from "@tauri-apps/api/core";
import { validatePathInProject } from "./_internal";

// 快照元数据接口
export interface SnapshotMeta {
  // 快照时间戳（Unix 毫秒）
  timestamp: number;
  // 创建时间 ISO 8601
  created_at: string;
  // 字数
  word_count: number;
  // 文件大小（字节）
  size: number;
  // 触发方式（auto/manual/pre-restore）
  trigger: string;
}

// 快照列表项接口
export interface SnapshotInfo {
  // 快照元数据
  meta: SnapshotMeta;
  // 快照文件绝对路径
  snapshot_path: string;
  // 源文件相对路径
  source_relative_path: string;
}

// 快照统计接口
export interface SnapshotStats {
  // 快照总数
  total_snapshots: number;
  // 总字节数
  total_size: number;
  // 拥有快照的文件数
  files_with_snapshots: number;
}

// 创建文件快照
// 输入: filePath 源文件路径, projectPath 项目路径, content 内容, trigger 触发方式
// 输出: Promise<SnapshotMeta> 创建的快照元数据
// 流程: 调用 Rust 后端 create_snapshot 命令
export async function createSnapshot(
  filePath: string,
  projectPath: string,
  content: string,
  trigger: string
): Promise<SnapshotMeta> {
  validatePathInProject(filePath, projectPath);
  return invoke<SnapshotMeta>("create_snapshot", {
    filePath,
    projectPath,
    content,
    trigger,
  });
}

// 列出文件的所有快照
// 输入: filePath 源文件路径, projectPath 项目路径
// 输出: Promise<SnapshotInfo[]> 快照列表（按时间倒序）
export async function listSnapshots(
  filePath: string,
  projectPath: string
): Promise<SnapshotInfo[]> {
  validatePathInProject(filePath, projectPath);
  return invoke<SnapshotInfo[]>("list_snapshots", { filePath, projectPath });
}

// 读取快照内容
// 输入: snapshotPath 快照路径, projectPath 项目路径
// 输出: Promise<string> 快照内容
export async function readSnapshot(
  snapshotPath: string,
  projectPath: string
): Promise<string> {
  validatePathInProject(snapshotPath, projectPath);
  return invoke<string>("read_snapshot", { snapshotPath, projectPath });
}

// 恢复快照到源文件
// 输入: snapshotPath 快照路径, filePath 源文件路径, projectPath 项目路径
// 输出: Promise<void>
// 注意: 恢复前会自动为当前内容创建一个 "pre-restore" 快照，避免误操作丢失
export async function restoreSnapshot(
  snapshotPath: string,
  filePath: string,
  projectPath: string
): Promise<void> {
  validatePathInProject(snapshotPath, projectPath);
  validatePathInProject(filePath, projectPath);
  return invoke<void>("restore_snapshot", {
    snapshotPath,
    filePath,
    projectPath,
  });
}

// 删除单个快照
// 输入: snapshotPath 快照路径, timestamp 时间戳, filePath 源文件路径, projectPath 项目路径
// 输出: Promise<void>
export async function deleteSnapshot(
  snapshotPath: string,
  timestamp: number,
  filePath: string,
  projectPath: string
): Promise<void> {
  validatePathInProject(snapshotPath, projectPath);
  validatePathInProject(filePath, projectPath);
  return invoke<void>("delete_snapshot", {
    snapshotPath,
    timestamp,
    filePath,
    projectPath,
  });
}

// 清空文件的所有快照
// 输入: filePath 源文件路径, projectPath 项目路径
// 输出: Promise<number> 删除的快照数量
export async function clearSnapshots(
  filePath: string,
  projectPath: string
): Promise<number> {
  validatePathInProject(filePath, projectPath);
  return invoke<number>("clear_snapshots", { filePath, projectPath });
}

// 获取项目快照统计
// 输入: projectPath 项目路径
// 输出: Promise<SnapshotStats>
export async function getSnapshotStats(
  projectPath: string
): Promise<SnapshotStats> {
  return invoke<SnapshotStats>("get_snapshot_stats", { projectPath });
}
