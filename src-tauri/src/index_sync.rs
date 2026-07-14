// Tantivy 索引增量同步钩子模块
//
// 设计目的：
//   commands/file_io_commands 与 commands/search_replace_commands 中的
//   write_file/create_file/delete_path/rename_path/copy_file/replace_in_project
//   原本仅执行磁盘操作，不更新 Tantivy 索引，导致全文搜索结果滞后于文件系统真实状态。
//   本模块提供同步辅助函数，在文件操作成功后自动同步索引（"先删后建"策略）。
//
// 同步策略：
//   - 写入/创建/复制 → sync_index_add（先删旧 Chunk 文档，再按新内容重新索引）
//   - 删除           → sync_index_remove（按 file_path 字段删除该文件所有 Chunk 文档）
//   - 重命名         → 旧路径 sync_index_remove + 新路径 sync_index_add
//   - 全局替换       → 对每个修改文件 sync_index_add
//
// 错误处理：
//   索引同步失败仅记录日志（eprintln），不传播错误，避免影响主流程的文件操作。
//   下次全量构建索引时可修复任何遗漏。
//
// 性能考量：
//   - 仅对可索引格式（.txt/.pmd/.html/.htm）触发同步，避免对 .json/.md 等无意义操作
//   - 单文件同步开销 < 100ms（含 open_or_create + delete + index + commit）
//   - 目录重命名/删除时递归枚举可索引文件，逐个同步

use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::is_indexable_file;
use crate::error::AppError;
use crate::tantivy_indexer;

/// 同步索引：删除旧文档 + 重新索引（用于写入/创建/复制/重命名后）
/// 输入:
///   project_root - 项目根目录（canonicalize 后）
///   abs_path - 文件绝对路径（必须存在）
///   relative_path - 文件相对路径（相对于项目根，正斜杠分隔，如 "正文/第一章.txt"）
/// 输出: Result<(), AppError> 同步结果（错误由调用方记录日志）
/// 流程:
///   1. 打开或创建索引
///   2. 创建索引写入器（50MB 堆内存）
///   3. 先删除该文件的所有旧 Chunk 文档（"先删后建"策略）
///   4. 读取文件修改时间
///   5. 推断 Chunk 类型（manuscript/setting/outline）
///   6. 调用 tantivy_indexer::index_file 重新索引
///   7. 提交索引变更
pub(crate) fn sync_index_add(
    project_root: &Path,
    abs_path: &Path,
    relative_path: &str,
) -> Result<(), AppError> {
    // 通过缓存获取 IndexHandle（避免重复打开索引），
    // writer 由 IndexHandle 内部 Mutex 保护，保证并发安全
    let (handle, schema) = tantivy_indexer::open_or_create_index(project_root)?;
    let mut index_writer = handle.lock_writer()?;

    // 先删除旧文档（保证文件内容变更后索引一致性）
    tantivy_indexer::delete_file_from_index(&mut index_writer, &schema, relative_path)?;

    // 重新索引
    let updated_at = abs_path
        .metadata()
        .and_then(|m| m.modified())
        .map(|t| {
            let dt: chrono::DateTime<chrono::Local> = t.into();
            dt.to_rfc3339()
        })
        .unwrap_or_default();
    let chunk_type = tantivy_indexer::infer_chunk_type(relative_path);
    tantivy_indexer::index_file(
        &mut index_writer,
        &schema,
        abs_path,
        relative_path,
        &updated_at,
        chunk_type,
    )?;

    index_writer
        .commit()
        .map_err(|e| AppError::index_error(format!("提交索引失败: {}", e)))?;
    Ok(())
}

/// 同步索引：仅删除文档（用于删除文件后）
/// 输入:
///   project_root - 项目根目录
///   relative_path - 文件相对路径（相对于项目根）
/// 输出: Result<(), AppError> 同步结果
pub(crate) fn sync_index_remove(
    project_root: &Path,
    relative_path: &str,
) -> Result<(), AppError> {
    // 通过缓存获取 IndexHandle，writer 由 Mutex 保护串行化写入
    let (handle, schema) = tantivy_indexer::open_or_create_index(project_root)?;
    let mut index_writer = handle.lock_writer()?;
    tantivy_indexer::delete_file_from_index(&mut index_writer, &schema, relative_path)?;
    index_writer
        .commit()
        .map_err(|e| AppError::index_error(format!("提交索引失败: {}", e)))?;
    Ok(())
}

/// 递归收集目录下所有可索引文件的相对路径（用于目录删除/重命名前同步索引）
/// 输入:
///   dir - 当前扫描目录
///   project_root - 项目根目录（用于计算相对路径）
///   result - 输出参数，收集相对路径（正斜杠分隔）
/// 输出: 无（通过 result 累加）
fn collect_indexable_rel_paths(dir: &Path, project_root: &Path, result: &mut Vec<String>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_indexable_rel_paths(&path, project_root, result);
            } else if is_indexable_file(&path) {
                if let Ok(rel) = path.strip_prefix(project_root) {
                    result.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
}

/// 递归收集目录下所有可索引文件的绝对路径与相对路径（用于重命名后同步新路径索引）
/// 输入:
///   dir - 当前扫描目录
///   project_root - 项目根目录
///   result - 输出参数，收集 (绝对路径, 相对路径) 元组
/// 输出: 无（通过 result 累加）
fn collect_indexable_abs_paths(
    dir: &Path,
    project_root: &Path,
    result: &mut Vec<(PathBuf, String)>,
) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_indexable_abs_paths(&path, project_root, result);
            } else if is_indexable_file(&path) {
                if let Ok(rel) = path.strip_prefix(project_root) {
                    result.push((path.clone(), rel.to_string_lossy().replace('\\', "/")));
                }
            }
        }
    }
}

/// 计算文件相对路径（正斜杠分隔）
/// 输入: abs_path 绝对路径, project_root 项目根目录
/// 输出: Option<String> 相对路径（无法计算时返回 None）
fn compute_relative_path(abs_path: &Path, project_root: &Path) -> Option<String> {
    abs_path
        .strip_prefix(project_root)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

/// 安全同步索引：写入/创建/复制后调用（失败仅记录日志，不传播错误）
/// 输入:
///   project_path - 项目根路径字符串（未 canonicalize）
///   abs_path - 文件绝对路径（已 canonicalize）
/// 流程: 计算相对路径后调用 sync_index_add，失败时 eprintln 记录
pub(crate) fn try_sync_index_add(project_path: &str, abs_path: &Path) {
    if !is_indexable_file(abs_path) {
        return;
    }
    let project_root = match PathBuf::from(project_path).canonicalize() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[索引同步] 解析项目路径失败 {}: {}", project_path, e);
            return;
        }
    };
    let rel = match compute_relative_path(abs_path, &project_root) {
        Some(r) => r,
        None => {
            eprintln!(
                "[索引同步] 计算相对路径失败: abs={}, root={}",
                abs_path.display(),
                project_root.display()
            );
            return;
        }
    };
    if let Err(e) = sync_index_add(&project_root, abs_path, &rel) {
        eprintln!("[索引同步] 写入后同步失败 {}: {}", rel, e);
    }
}

/// 安全同步索引：删除后调用（失败仅记录日志）
/// 输入:
///   project_path - 项目根路径字符串
///   abs_path - 被删除路径的绝对路径（删除前快照）
/// 流程:
///   - 文件：直接 sync_index_remove
///   - 目录：递归收集所有可索引文件相对路径，逐个 sync_index_remove
pub(crate) fn try_sync_index_remove(project_path: &str, abs_path: &Path) {
    let project_root = match PathBuf::from(project_path).canonicalize() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[索引同步] 解析项目路径失败 {}: {}", project_path, e);
            return;
        }
    };
    if abs_path.is_dir() {
        // 目录删除：递归收集所有可索引文件相对路径
        let mut rel_paths: Vec<String> = Vec::new();
        collect_indexable_rel_paths(abs_path, &project_root, &mut rel_paths);
        for rel in rel_paths {
            if let Err(e) = sync_index_remove(&project_root, &rel) {
                eprintln!("[索引同步] 删除后同步失败 {}: {}", rel, e);
            }
        }
    } else if is_indexable_file(abs_path) {
        if let Some(rel) = compute_relative_path(abs_path, &project_root) {
            if let Err(e) = sync_index_remove(&project_root, &rel) {
                eprintln!("[索引同步] 删除后同步失败 {}: {}", rel, e);
            }
        }
    }
}

/// 安全同步索引：重命名后调用（失败仅记录日志）
/// 输入:
///   project_path - 项目根路径字符串
///   old_abs - 旧路径绝对路径（已不存在）
///   new_abs - 新路径绝对路径（已存在）
/// 流程:
///   - 删除旧路径索引（文件或目录递归）
///   - 添加新路径索引（文件或目录递归）
pub(crate) fn try_sync_index_rename(project_path: &str, old_abs: &Path, new_abs: &Path) {
    let project_root = match PathBuf::from(project_path).canonicalize() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[索引同步] 解析项目路径失败 {}: {}", project_path, e);
            return;
        }
    };

    // 步骤1: 删除旧路径索引
    // 注意：old_abs 已不存在，无法用 is_dir() 判断，需根据 new_abs 推断
    if new_abs.is_dir() {
        // 目录重命名：递归收集旧路径下可索引文件相对路径
        // 由于 old_abs 已不存在，无法直接遍历；改用 new_abs 推算旧相对路径
        // 旧相对路径 = old_abs 的相对路径前缀 + new_abs 子路径
        if let (Some(old_rel_prefix), Some(new_rel_prefix)) = (
            compute_relative_path(old_abs, &project_root),
            compute_relative_path(new_abs, &project_root),
        ) {
            // 遍历 new_abs 收集子文件相对路径，推算 old 相对路径
            let mut new_paths: Vec<(PathBuf, String)> = Vec::new();
            collect_indexable_abs_paths(new_abs, &project_root, &mut new_paths);
            for (_new_abs_path, new_rel) in new_paths {
                // 旧相对路径 = old_rel_prefix + new_rel 去掉 new_rel_prefix 的部分
                if let Some(suffix) = new_rel.strip_prefix(&new_rel_prefix) {
                    let old_rel = format!("{}{}", old_rel_prefix, suffix);
                    if let Err(e) = sync_index_remove(&project_root, &old_rel) {
                        eprintln!("[索引同步] 重命名删除旧索引失败 {}: {}", old_rel, e);
                    }
                }
            }
        }
    } else if is_indexable_file(new_abs) {
        // 文件重命名：直接按旧相对路径删除
        if let Some(old_rel) = compute_relative_path(old_abs, &project_root) {
            if let Err(e) = sync_index_remove(&project_root, &old_rel) {
                eprintln!("[索引同步] 重命名删除旧索引失败 {}: {}", old_rel, e);
            }
        }
    }

    // 步骤2: 添加新路径索引
    if new_abs.is_dir() {
        let mut new_paths: Vec<(PathBuf, String)> = Vec::new();
        collect_indexable_abs_paths(new_abs, &project_root, &mut new_paths);
        for (abs, rel) in new_paths {
            if let Err(e) = sync_index_add(&project_root, &abs, &rel) {
                eprintln!("[索引同步] 重命名添加新索引失败 {}: {}", rel, e);
            }
        }
    } else if is_indexable_file(new_abs) {
        if let Some(rel) = compute_relative_path(new_abs, &project_root) {
            if let Err(e) = sync_index_add(&project_root, new_abs, &rel) {
                eprintln!("[索引同步] 重命名添加新索引失败 {}: {}", rel, e);
            }
        }
    }
}
