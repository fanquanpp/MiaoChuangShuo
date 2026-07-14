// 全文搜索与索引管理 Tauri 命令模块
//
// 功能概述：
// 基于 tantivy_indexer 模块提供的索引能力，封装为 Tauri 命令。
// 提供全文搜索、异步索引构建、增量更新、统计查询等功能。
// 支持异步索引构建，通过 Tauri Event 推送进度。
//
// 模块职责：
// 1. 提供 search_project 命令（基于 Tantivy 全文搜索）
// 2. 提供 build_project_index 命令（异步构建索引，推送进度事件）
// 3. 提供 get_project_index_stats 命令（查询索引统计）
// 4. 提供 update_file_index 命令（单文件增量索引）
// 5. 提供 remove_file_index 命令（删除单文件索引）
// 6. 处理 Windows mmap 锁与 HVCI 限制
//
// 设计说明：
// - 所有索引操作通过 tokio::task::spawn_blocking 执行，避免阻塞异步运行时
// - 索引构建进度通过 Tauri Event "index-progress" 推送到前端
// - 不使用 Command::output()（Windows HVCI 限制），直接调用 Tantivy API
// - mmap 锁处理：索引写入器在 commit 后自动释放，读取器使用 OnCommit 重载策略
// - 增量更新采用"先删后建"策略，保证文件索引的一致性

use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::AppError;
use crate::tantivy_indexer::{
    self, IndexProgress, IndexStats, SearchResult,
};

/// 索引构建进度事件名（前端监听此事件获取进度更新）
const INDEX_PROGRESS_EVENT: &str = "index-progress";

/// 搜索请求参数
#[derive(Debug, Clone, Deserialize)]
pub struct SearchRequest {
    /// 项目根路径（绝对路径）
    pub project_path: String,
    /// 搜索关键词
    pub query: String,
    /// 返回结果上限（默认 50）
    #[serde(default)]
    pub limit: Option<usize>,
}

/// 搜索响应（包含匹配的 Chunk 信息）
#[derive(Debug, Clone, Serialize)]
pub struct SearchResponse {
    /// 查询关键词
    pub query: String,
    /// 匹配结果总数
    pub total: usize,
    /// 匹配结果列表
    pub results: Vec<SearchResult>,
    /// 索引统计信息（便于前端判断是否需要重建索引）
    pub index_stats: Option<IndexStats>,
}

/// 全文搜索项目内容
///
/// 基于 Tantivy 索引执行全文搜索，支持中文分词（jieba）。
/// 当索引不存在时自动创建空索引并返回空结果。
///
/// 输入:
///   request - 搜索请求参数（项目路径、关键词、结果上限）
/// 输出: Result<SearchResponse, AppError> 搜索响应
/// 流程:
///   1. 校验项目路径
///   2. 调用 tantivy_indexer::search 执行查询（内部使用 IndexHandle 缓存）
///   3. 封装响应并返回
#[tauri::command]
pub async fn search_project(request: SearchRequest) -> Result<SearchResponse, AppError> {
    if request.query.trim().is_empty() {
        return Ok(SearchResponse {
            query: request.query,
            total: 0,
            results: vec![],
            index_stats: None,
        });
    }

    let project_root = PathBuf::from(&request.project_path);
    let limit = request.limit.unwrap_or(50);

    // 执行查询（Tantivy 查询是阻塞操作，使用 spawn_blocking 避免阻塞异步运行时）
    let query = request.query.clone();

    let results = tokio::task::spawn_blocking(move || {
        tantivy_indexer::search(&project_root, &query, limit)
    })
    .await
    .map_err(|e| AppError::index_error(format!("搜索任务执行失败: {}", e)))??;

    let total = results.len();

    Ok(SearchResponse {
        query: request.query,
        total,
        results,
        index_stats: None,
    })
}

/// 异步构建项目全文索引（全量重建）
///
/// 扫描项目内所有可索引文件（.txt/.html/.pmd），构建 Tantivy 全文索引。
/// 通过 Tauri Event "index-progress" 推送构建进度到前端。
/// 适用于首次构建索引或索引损坏后重建。
///
/// 输入:
///   app - Tauri AppHandle（用于推送进度事件）
///   project_path - 项目根路径
/// 输出: Result<IndexStats, AppError> 索引统计信息
/// 流程:
///   1. 校验项目路径
///   2. 使用 spawn_blocking 执行阻塞的索引构建（内部使用 IndexHandle 缓存）
///   3. 构建过程中通过 app.emit 推送进度事件
///   4. 返回索引统计信息
/// HVCI 注意: 不使用 Command::output()，直接调用 Tantivy API
#[tauri::command]
pub async fn build_project_index(
    app: AppHandle,
    project_path: String,
) -> Result<IndexStats, AppError> {
    let project_root = PathBuf::from(project_path);

    // 克隆 AppHandle 用于在 spawn_blocking 闭包中推送进度
    let app_for_progress = app.clone();

    // 使用 spawn_blocking 执行阻塞的索引构建
    let stats = tokio::task::spawn_blocking(move || {
        tantivy_indexer::build_full_index(&project_root, |progress: IndexProgress| {
            // 通过 Tauri Event 推送进度到前端
            // emit 失败时不中断索引构建（前端可能未监听）
            let _ = app_for_progress.emit(INDEX_PROGRESS_EVENT, &progress);
        })
    })
    .await
    .map_err(|e| AppError::index_error(format!("索引构建任务失败: {}", e)))??;

    // 推送完成事件
    let _ = app.emit(
        INDEX_PROGRESS_EVENT,
        &IndexProgress {
            processed: 0,
            total: 0,
            current_file: String::new(),
            percent: 100,
            stage: "done".to_string(),
        },
    );

    Ok(stats)
}

/// 获取项目索引统计信息
///
/// 查询现有索引的文档数、文件数、索引大小、最后构建时间。
/// 不触发索引重建，仅读取索引元数据。
///
/// 输入: project_path 项目根路径
/// 输出: Result<IndexStats, AppError> 索引统计
/// 流程:
///   1. 校验项目路径
///   2. 调用 tantivy_indexer::get_index_stats 读取统计（内部使用 IndexHandle 缓存）
///   3. 返回统计信息（索引不存在时返回空统计）
#[tauri::command]
pub async fn get_project_index_stats(project_path: String) -> Result<IndexStats, AppError> {
    let project_root = PathBuf::from(project_path);

    tokio::task::spawn_blocking(move || {
        tantivy_indexer::get_index_stats(&project_root)
    })
    .await
    .map_err(|e| AppError::index_error(format!("获取索引统计任务失败: {}", e)))?
}

/// 增量更新单文件索引
///
/// 当文件内容变更或新增文件时，更新该文件在索引中的文档。
/// 采用"先删后建"策略：先删除该文件的所有旧 Chunk 文档，再重新索引。
///
/// 输入:
///   project_path - 项目根路径
///   relative_path - 文件相对路径（相对于项目根，如 "正文/第一章.txt"）
/// 输出: Result<u32, AppError> 写入的 Chunk 数量
/// 流程:
///   1. 校验项目路径与文件路径
///   2. 从缓存获取 IndexHandle，锁定 writer
///   3. 删除该文件的旧索引文档
///   4. 如果文件存在，重新索引（按 Chunk 切分写入）
///   5. 提交索引变更
/// 设计依据:
///   - 增量更新避免全量重建的开销
///   - "先删后建"保证文件内容变更后索引一致性
///   - 文件删除时仅执行删除步骤（步骤 4 跳过）
///   - 使用 IndexHandle 缓存避免重复创建 IndexWriter（Tantivy 限制每索引一个 writer）
#[tauri::command]
pub async fn update_file_index(
    project_path: String,
    relative_path: String,
) -> Result<u32, AppError> {
    let project_root = PathBuf::from(&project_path);
    let abs_path = project_root.join(&relative_path);

    tokio::task::spawn_blocking(move || -> Result<u32, AppError> {
        // 从缓存获取 IndexHandle（避免重复创建 IndexWriter）
        let (handle, schema) = tantivy_indexer::open_or_create_index(&project_root)?;
        // 锁定 writer（Mutex 保证写入串行化，避免并发 panic）
        let mut index_writer = handle.lock_writer()?;

        // 先删除该文件的所有旧 Chunk 文档
        tantivy_indexer::delete_file_from_index(&mut index_writer, &schema, &relative_path)?;

        // 如果文件存在，重新索引
        let chunk_count = if abs_path.exists() {
            // 获取文件修改时间
            let updated_at = abs_path
                .metadata()
                .and_then(|m| m.modified())
                .map(|t| {
                    let dt: chrono::DateTime<chrono::Local> = t.into();
                    dt.to_rfc3339()
                })
                .unwrap_or_default();

            // 推断 Chunk 类型（AI-Ready: manuscript/setting/outline）
            let chunk_type = tantivy_indexer::infer_chunk_type(&relative_path);

            tantivy_indexer::index_file(
                &mut index_writer,
                &schema,
                &abs_path,
                &relative_path,
                &updated_at,
                chunk_type,
            )?
        } else {
            // 文件已删除，仅清理索引文档
            0
        };

        // 提交索引变更
        index_writer
            .commit()
            .map_err(|e| AppError::index_error(format!("提交索引失败: {}", e)))?;

        Ok(chunk_count)
    })
    .await
    .map_err(|e| AppError::index_error(format!("索引更新任务失败: {}", e)))?
}

/// 删除单文件索引
///
/// 从索引中删除指定文件的所有 Chunk 文档。
/// 适用于文件被删除或重命名时的索引清理。
///
/// 输入:
///   project_path - 项目根路径
///   relative_path - 文件相对路径
/// 输出: Result<(), AppError> 删除结果
/// 流程:
///   1. 校验项目路径
///   2. 从缓存获取 IndexHandle，锁定 writer
///   3. 按 file_path 字段删除所有匹配文档
///   4. 提交索引变更
/// 设计依据:
///   - 使用 IndexHandle 缓存避免重复创建 IndexWriter（Tantivy 限制每索引一个 writer）
#[tauri::command]
pub async fn remove_file_index(
    project_path: String,
    relative_path: String,
) -> Result<(), AppError> {
    let project_root = PathBuf::from(&project_path);

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        // 从缓存获取 IndexHandle（避免重复创建 IndexWriter）
        let (handle, schema) = tantivy_indexer::open_or_create_index(&project_root)?;
        // 锁定 writer（Mutex 保证写入串行化，避免并发 panic）
        let mut index_writer = handle.lock_writer()?;

        tantivy_indexer::delete_file_from_index(&mut index_writer, &schema, &relative_path)?;

        index_writer
            .commit()
            .map_err(|e| AppError::index_error(format!("提交索引失败: {}", e)))?;

        Ok(())
    })
    .await
    .map_err(|e| AppError::index_error(format!("索引删除任务失败: {}", e)))?
}
