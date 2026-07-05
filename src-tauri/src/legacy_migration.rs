// 旧版项目目录结构迁移模块
//
// 功能概述：
// 将旧版 8 种目录结构（角色/世界观/术语/剧情图谱/正文/大纲/素材/.novelforge）
// 迁移至新版 6 种统一目录（正文/设定/大纲/伏笔/草稿箱/.novelforge）。
// 迁移前自动创建备份，失败时自动回滚。
//
// 模块职责：
// 1. 提供 migrate_legacy_project 命令（执行目录迁移）
// 2. 迁移前创建 .novelforge/migration_backup_{timestamp}/ 备份
// 3. 按 映射规则移动文件（角色/世界观/术语 → 设定/，素材 → 草稿箱/）
// 4. 通过 migration:progress 事件推送进度
// 5. 失败时从备份回滚，保证数据安全
//
// 迁移映射：
//   角色/     → 设定/角色/
//   世界观/   → 设定/世界观/
//   术语/     → 设定/术语/
//   素材/     → 草稿箱/素材/
//   剧情图谱/ → 保留不动（自定义目录）
//   正文/大纲/.novelforge → 保留不动（新旧版共享）
//
// 设计说明：
// - 使用 fs::copy + fs::remove_file 而非 fs::rename，避免跨卷问题
// - 备份目录位于 .novelforge/ 内，确保同卷操作
// - 回滚时遍历备份目录，恢复文件至原位置
// - HVCI 兼容：全程使用 std::fs 同步 I/O，不使用 Command::output()

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::project_template::{is_legacy_project, universal_directories};

/// 进度事件名（前端通过 listen("migration:progress") 订阅）
const PROGRESS_EVENT: &str = "migration:progress";

/// 迁移进度事件载荷
///
/// 字段命名：
///   - Rust 端使用 snake_case
///   - serde 通过 rename_all = "camelCase" 转为 camelCase
///   - 与前端 TypeScript 接口 MigrationProgress 字段一致
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationProgress {
    /// 已处理文件数
    pub done: usize,
    /// 总文件数
    pub total: usize,
    /// 当前处理文件名
    pub current_file: String,
}

/// 迁移结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    /// 迁移的文件数
    pub migrated_count: usize,
    /// 备份目录路径
    pub backup_path: String,
    /// 是否发生回滚（true 表示迁移失败已回滚）
    pub rollback: bool,
}

/// 迁移映射项：旧版目录 → 新版目标目录
struct MigrationMapping {
    /// 旧版目录名（相对于项目根）
    legacy_dir: &'static str,
    /// 新版目标目录名（相对于项目根）
    new_dir: &'static str,
}

/// 旧版 → 新版目录映射表
///
/// 说明：
///   - 角色/世界观/术语 合并至 设定/ 子目录（保留原目录名作为子目录）
///   - 素材 移至 草稿箱/ 子目录
///   - 剧情图谱 保留不动（不在映射表中）
///   - 正文/大纲/.novelforge 新旧版共享，无需迁移
const MIGRATION_MAPPINGS: &[MigrationMapping] = &[
    MigrationMapping { legacy_dir: "角色", new_dir: "设定/角色" },
    MigrationMapping { legacy_dir: "世界观", new_dir: "设定/世界观" },
    MigrationMapping { legacy_dir: "术语", new_dir: "设定/术语" },
    MigrationMapping { legacy_dir: "素材", new_dir: "草稿箱/素材" },
];

/// 旧版项目目录迁移命令
///
/// 输入:
///   app - Tauri 应用句柄（用于推送进度事件）
///   project_path - 项目根目录路径
/// 输出: Result<MigrationResult, String> 迁移结果或错误
/// 流程:
///   1. 校验项目路径与旧版目录结构
///   2. 创建备份目录（.novelforge/migration_backup_{timestamp}/）
///   3. 创建新版缺失目录（设定/伏笔/草稿箱）
///   4. 统计待迁移文件总数
///   5. 逐文件复制到新目录，推送进度事件
///   6. 复制成功后删除原文件
///   7. 删除空的旧版目录
///   8. 返回迁移结果
/// 失败处理:
///   任一步骤失败时触发回滚：
///   - 遍历备份目录，将文件恢复至原位置
///   - 删除已创建的新版文件
///   - 返回 rollback: true
#[tauri::command]
pub async fn migrate_legacy_project(
    app: AppHandle,
    project_path: String,
) -> Result<MigrationResult, String> {
    // 1. 校验项目路径
    let project_root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;
    if !project_root.is_dir() {
        return Err("项目路径不是目录".to_string());
    }

    // 2. 校验是否为旧版项目（非旧版项目无需迁移）
    if !is_legacy_project(&project_root) {
        return Ok(MigrationResult {
            migrated_count: 0,
            backup_path: String::new(),
            rollback: false,
        });
    }

    // 3. 创建备份目录（.novelforge/migration_backup_{timestamp}/）
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let backup_dir = project_root
        .join(".novelforge")
        .join(format!("migration_backup_{}", timestamp));
    fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("创建备份目录失败: {}", e))?;

    // 4. 创建新版缺失目录（universal_directories 包含 正文/设定/大纲/伏笔/草稿箱/.novelforge）
    for dir in universal_directories() {
        let dir_path = project_root.join(dir);
        if !dir_path.exists() {
            fs::create_dir_all(&dir_path)
                .map_err(|e| format!("创建新版目录失败 {}: {}", dir, e))?;
        }
    }

    // 5. 统计待迁移文件总数（用于进度计算）
    let migration_targets = collect_migration_targets(&project_root);
    let total = migration_targets.len();
    if total == 0 {
        // 无待迁移文件，删除备份目录后返回
        let _ = fs::remove_dir_all(&backup_dir);
        return Ok(MigrationResult {
            migrated_count: 0,
            backup_path: String::new(),
            rollback: false,
        });
    }

    // 推送初始进度
    let _ = app.emit(
        PROGRESS_EVENT,
        MigrationProgress {
            done: 0,
            total,
            current_file: String::new(),
        },
    );

    // 6. 执行迁移（带回滚）
    let mut migrated_count: usize = 0;
    let mut done: usize = 0;
    for (src_path, dest_path, relative_to_backup) in &migration_targets {
        // 推送当前文件进度
        let current_file_name = src_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let _ = app.emit(
            PROGRESS_EVENT,
            MigrationProgress {
                done,
                total,
                current_file: current_file_name.clone(),
            },
        );

        // 备份原文件（复制到备份目录，保留相对路径结构）
        let backup_path = backup_dir.join(relative_to_backup);
        if let Some(parent) = backup_path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| format!("创建备份父目录失败: {}", e))?;
            }
        }
        if let Err(e) = fs::copy(src_path, &backup_path) {
            // 备份失败：触发回滚
            let _ = rollback(&backup_dir, &project_root);
            let _ = app.emit(
                PROGRESS_EVENT,
                MigrationProgress {
                    done,
                    total,
                    current_file: String::new(),
                },
            );
            return Err(format!(
                "备份文件失败: {} (已回滚，备份目录: {})",
                e,
                backup_dir.to_string_lossy()
            ));
        }

        // 创建目标父目录
        if let Some(parent) = dest_path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| {
                    let _ = rollback(&backup_dir, &project_root);
                    format!("创建目标父目录失败: {} (已回滚)", e)
                })?;
            }
        }

        // 复制文件到新位置
        if let Err(e) = fs::copy(src_path, dest_path) {
            let _ = rollback(&backup_dir, &project_root);
            return Err(format!("复制文件失败: {} (已回滚)", e));
        }

        // 删除原文件
        if let Err(e) = fs::remove_file(src_path) {
            // 原文件删除失败：回滚（删除已复制到新位置的文件，恢复原文件）
            let _ = fs::remove_file(dest_path);
            let _ = rollback(&backup_dir, &project_root);
            return Err(format!("删除原文件失败: {} (已回滚)", e));
        }

        migrated_count += 1;
        done += 1;
    }

    // 7. 删除空的旧版目录（角色/世界观/术语/素材）
    for mapping in MIGRATION_MAPPINGS {
        let legacy_dir_path = project_root.join(mapping.legacy_dir);
        if legacy_dir_path.exists() {
            // 仅当目录为空时删除（避免删除非空目录导致数据丢失）
            if let Ok(entries) = fs::read_dir(&legacy_dir_path) {
                let is_empty = entries.count() == 0;
                if is_empty {
                    let _ = fs::remove_dir(&legacy_dir_path);
                }
            }
        }
    }

    // 推送完成进度
    let _ = app.emit(
        PROGRESS_EVENT,
        MigrationProgress {
            done: total,
            total,
            current_file: String::new(),
        },
    );

    Ok(MigrationResult {
        migrated_count,
        backup_path: backup_dir.to_string_lossy().to_string(),
        rollback: false,
    })
}

/// 收集所有待迁移的文件目标
///
/// 输入: project_root 项目根目录
/// 输出: Vec<(源路径, 目标路径, 相对备份路径)> 迁移目标列表
/// 流程:
///   1. 遍历 MIGRATION_MAPPINGS 中的旧版目录
///   2. 递归收集每个旧版目录下的所有文件
///   3. 计算每个文件的目标路径（旧版目录名/子路径 → 新版目录/旧版目录名/子路径）
///   4. 计算备份相对路径（旧版目录名/子路径）
fn collect_migration_targets(
    project_root: &Path,
) -> Vec<(PathBuf, PathBuf, String)> {
    let mut targets = Vec::new();

    for mapping in MIGRATION_MAPPINGS {
        let legacy_dir_path = project_root.join(mapping.legacy_dir);
        if !legacy_dir_path.exists() {
            continue;
        }

        // 递归收集旧版目录下的所有文件
        collect_files_recursive(
            &legacy_dir_path,
            &legacy_dir_path,
            project_root,
            mapping,
            &mut targets,
        );
    }

    targets
}

/// 递归收集目录下的所有文件
///
/// 输入:
///   current - 当前遍历目录
///   legacy_root - 旧版目录根（用于计算相对路径）
///   project_root - 项目根目录
///   mapping - 迁移映射项
///   targets - 迁移目标列表（输出参数）
/// 流程:
///   1. 遍历当前目录
///   2. 子目录：递归
///   3. 文件：计算目标路径与备份相对路径，加入 targets
fn collect_files_recursive(
    current: &Path,
    legacy_root: &Path,
    project_root: &Path,
    mapping: &MigrationMapping,
    targets: &mut Vec<(PathBuf, PathBuf, String)>,
) {
    let entries = match fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files_recursive(&path, legacy_root, project_root, mapping, targets);
        } else if path.is_file() {
            // 计算相对于旧版目录根的子路径（如 "主角设定.txt" 或 "子目录/xxx.txt"）
            let relative_to_legacy = match path.strip_prefix(legacy_root) {
                Ok(r) => r.to_string_lossy().to_string(),
                Err(_) => continue,
            };

            // 目标路径：新版目录/旧版目录名/子路径
            // 例如：角色/主角设定.txt → 设定/角色/主角设定.txt
            let dest_path = project_root
                .join(mapping.new_dir)
                .join(&relative_to_legacy);

            // 备份相对路径：旧版目录名/子路径
            // 例如：角色/主角设定.txt
            let relative_to_backup = format!("{}/{}", mapping.legacy_dir, relative_to_legacy);

            targets.push((path, dest_path, relative_to_backup));
        }
    }
}

/// 回滚迁移（从备份恢复）
///
/// 输入:
///   backup_dir - 备份目录路径
///   project_root - 项目根目录
/// 输出: Result<(), String> 回滚结果
/// 流程:
///   1. 遍历备份目录下所有文件
///   2. 根据备份相对路径计算原位置
///   3. 将备份文件复制回原位置
///   4. 删除新位置已迁移的文件
///   5. 回滚失败时静默处理（备份仍在，可手动恢复）
fn rollback(backup_dir: &Path, project_root: &Path) -> Result<(), String> {
    let backup_entries = fs::read_dir(backup_dir)
        .map_err(|e| format!("读取备份目录失败: {}", e))?;

    for entry in backup_entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // 递归恢复子目录
            restore_directory(&path, backup_dir, project_root)?;
        }
    }

    Ok(())
}

/// 递归恢复目录下的文件到原位置
///
/// 输入:
///   current - 当前遍历的备份子目录
///   backup_dir - 备份根目录
///   project_root - 项目根目录
/// 输出: Result<(), String>
/// 流程:
///   1. 遍历当前目录
///   2. 子目录：递归
///   3. 文件：计算原位置（project_root/相对备份路径），复制回去
fn restore_directory(
    current: &Path,
    backup_dir: &Path,
    project_root: &Path,
) -> Result<(), String> {
    let entries = match fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            restore_directory(&path, backup_dir, project_root)?;
        } else if path.is_file() {
            // 计算相对备份根的路径（如 "角色/主角设定.txt"）
            let relative = match path.strip_prefix(backup_dir) {
                Ok(r) => r.to_string_lossy().to_string(),
                Err(_) => continue,
            };

            // 原位置：project_root/相对备份路径
            let original_path = project_root.join(&relative);

            // 确保原位置父目录存在
            if let Some(parent) = original_path.parent() {
                if !parent.exists() {
                    let _ = fs::create_dir_all(parent);
                }
            }

            // 复制备份文件回原位置（覆盖已删除的文件）
            let _ = fs::copy(&path, &original_path);

            // 删除新位置已迁移的文件（如果存在）
            // 通过映射表查找新位置
            for mapping in MIGRATION_MAPPINGS {
                if relative.starts_with(mapping.legacy_dir) {
                    // strip_prefix 返回 Option<&str>，需 unwrap_or 兜底
                    let sub_path = relative
                        .strip_prefix(mapping.legacy_dir)
                        .unwrap_or("")
                        .trim_start_matches('/');
                    let new_path = project_root
                        .join(mapping.new_dir)
                        .join(sub_path);
                    if new_path.exists() {
                        let _ = fs::remove_file(&new_path);
                    }
                    break;
                }
            }
        }
    }

    Ok(())
}
