// 喵创说 全文索引 API
//
// 模块职责：
// 基于 Tantivy 全文索引引擎，提供项目级索引构建、统计、增量更新、删除与进度监听。
// 索引存储于 .novelforge/index/ 目录，与项目元数据隔离。
// 支持中文分词（jieba）、异步索引构建、增量更新。
//
// 依赖：
// - @tauri-apps/api/core 的 invoke 调用 Rust 后端
// - @tauri-apps/api/event 的 listen 订阅索引构建进度事件

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// 索引构建进度事件 payload（与后端 IndexProgress 对应）
export interface IndexProgress {
  // 已处理文件数
  processed: number;
  // 总文件数
  total: number;
  // 当前处理文件名
  current_file: string;
  // 进度百分比（0-100）
  percent: number;
  // 阶段：scan / index / commit / done / error
  stage: string;
}

// 索引统计信息（与后端 IndexStats 对应）
export interface IndexStats {
  // 索引文档总数（Chunk 粒度）
  doc_count: number;
  // 已索引文件数
  file_count: number;
  // 索引大小（字节）
  index_size: number;
  // 最后构建时间（ISO 8601）
  last_built_at: string;
}

// 索引构建进度事件名（与后端 INDEX_PROGRESS_EVENT 常量一致）
const INDEX_PROGRESS_EVENT = "index-progress";

// 异步构建项目全文索引（全量重建）
// 输入: projectPath 项目根路径
// 输出: Promise<IndexStats> 索引统计信息
// 流程: 调用 Rust 后端 build_project_index 命令，后端推送 index-progress 事件
// 注意: 调用前应通过 onIndexProgress 注册进度回调，事件可能在本函数返回前触发
export async function buildProjectIndex(projectPath: string): Promise<IndexStats> {
  return invoke<IndexStats>("build_project_index", { projectPath });
}

// 获取项目索引统计信息
// 输入: projectPath 项目根路径
// 输出: Promise<IndexStats> 索引统计
// 用途: 判断索引是否存在、是否需要重建
export async function getProjectIndexStats(projectPath: string): Promise<IndexStats> {
  return invoke<IndexStats>("get_project_index_stats", { projectPath });
}

// 增量更新单文件索引
// 输入: projectPath 项目根路径, relativePath 文件相对路径
// 输出: Promise<number> 写入的 Chunk 数量
// 流程: 调用 Rust 后端 update_file_index 命令，采用"先删后建"策略
// 用途: 文件保存后自动更新索引，避免全量重建
export async function updateFileIndex(
  projectPath: string,
  relativePath: string
): Promise<number> {
  return invoke<number>("update_file_index", { projectPath, relativePath });
}

// 删除单文件索引
// 输入: projectPath 项目根路径, relativePath 文件相对路径
// 输出: Promise<void>
// 用途: 文件删除后清理索引文档
export async function removeFileIndex(
  projectPath: string,
  relativePath: string
): Promise<void> {
  return invoke<void>("remove_file_index", { projectPath, relativePath });
}

// 注册索引构建进度事件监听器
// 输入: callback 进度回调函数
// 输出: Promise<UnlistenFn> 取消监听函数（组件卸载时调用以避免内存泄漏）
// 流程: 调用 Tauri event API 的 listen 函数订阅 index-progress 事件
// 用途: 在索引构建对话框中实时显示进度条与当前处理文件名
export async function onIndexProgress(
  callback: (progress: IndexProgress) => void
): Promise<UnlistenFn> {
  return listen<IndexProgress>(INDEX_PROGRESS_EVENT, (event) => {
    callback(event.payload);
  });
}
