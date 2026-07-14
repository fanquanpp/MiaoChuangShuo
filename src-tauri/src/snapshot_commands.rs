// 版本快照系统命令模块
//
// 功能概述：
// 为小说项目提供文件级版本快照能力，每次保存自动生成历史版本，
// 作者可随时查看历史版本、对比差异、回滚到任意快照。
// 快照存储在项目内 .novelforge/snapshots/ 目录下，随项目一起移动/备份。
//
// 设计理念：
// "作者彻底忘记工具存在"——快照自动创建、自动清理、自动管理，
// 作者只在需要时打开历史面板查看或恢复，平时完全无感。
//
// 存储结构：
// .novelforge/snapshots/
//   <encoded_relative_path>/
//     meta.json           // 快照元数据索引（追加写入，列表便于读取）
//     <timestamp_1>.txt   // 快照内容
//     <timestamp_2>.txt
//     ...
//
// 路径编码规则：
// 相对路径 "正文/第一卷/001.txt" 编码为 "正文__第一卷__001.txt"
// 避免深层嵌套，便于管理与调试

use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use chrono::{Duration, Local};

use crate::commands::validate_path_in_project;

/// 单文件快照数量上限（含 manual/pre-restore，超过后优先淘汰 auto）
const MAX_SNAPSHOTS: usize = 50;

/// auto 类型快照最大保留天数（超过此天数的 auto 快照会被自动清理）
/// manual 与 pre-restore 快照不受时间维度约束，仅受数量上限保护
const MAX_AUTO_SNAPSHOT_AGE_DAYS: i64 = 30;

/// 单条快照元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotMeta {
    /// 快照时间戳（Unix 毫秒，用作文件名）
    pub timestamp: i64,
    /// 快照创建时间（ISO 8601 可读格式）
    pub created_at: String,
    /// 快照内容字数
    pub word_count: u64,
    /// 快照文件大小（字节）
    pub size: u64,
    /// 触发方式（auto=自动保存, manual=手动创建）
    pub trigger: String,
}

/// 快照列表项（前端展示用，不含内容）
#[derive(Debug, Clone, Serialize)]
pub struct SnapshotInfo {
    /// 快照元数据
    pub meta: SnapshotMeta,
    /// 快照文件绝对路径
    pub snapshot_path: String,
    /// 对应的源文件相对路径（项目内）
    pub source_relative_path: String,
}

/// 将相对路径编码为安全的目录名
/// 输入: relative_path 文件相对路径（如 "正文/第一卷/001.txt"）
/// 输出: 编码后的目录名（如 "正文__第一卷__001.txt"）
/// 流程: 将路径分隔符统一替换为双下划线
fn encode_relative_path(relative_path: &str) -> String {
    relative_path
        .replace('\\', "/")
        .replace('/', "__")
        // 替换 Windows 不允许的字符（理论上不应出现在合法路径中，保险起见）
        .replace('<', "_lt_")
        .replace('>', "_gt_")
        .replace(':', "_cl_")
        .replace('"', "_dq_")
        .replace('|', "_pi_")
        .replace('?', "_qm_")
        .replace('*', "_st_")
}

/// 获取快照存储根目录（.novelforge/snapshots/）
/// 输入: project_root 项目根目录
/// 输出: Result<PathBuf, String> 快照根目录路径
/// 流程: 拼接路径并确保目录存在
fn get_snapshots_root(project_root: &Path) -> Result<PathBuf, String> {
    let root = project_root.join(".novelforge").join("snapshots");
    if !root.exists() {
        fs::create_dir_all(&root).map_err(|e| format!("创建快照根目录失败: {}", e))?;
    }
    Ok(root)
}

/// 获取某文件的快照目录
/// 输入: project_root 项目根, relative_path 源文件相对路径
/// 输出: Result<PathBuf, String> 该文件的快照目录路径
/// 流程: 拼接快照根目录与编码后的相对路径，确保存在
fn get_file_snapshot_dir(
    project_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let root = get_snapshots_root(project_root)?;
    let encoded = encode_relative_path(relative_path);
    let dir = root.join(encoded);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("创建文件快照目录失败: {}", e))?;
    }
    Ok(dir)
}

/// 读取快照索引文件
/// 输入: file_snapshot_dir 文件快照目录
/// 输出: Result<Vec<SnapshotMeta>, String> 快照元数据列表（按时间倒序）
/// 流程: 读取 meta.json，不存在则返回空列表
fn read_snapshot_index(file_snapshot_dir: &Path) -> Result<Vec<SnapshotMeta>, String> {
    let index_path = file_snapshot_dir.join("meta.json");
    if !index_path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&index_path)
        .map_err(|e| format!("读取快照索引失败: {}", e))?;
    let mut entries: Vec<SnapshotMeta> = serde_json::from_str(&content)
        .unwrap_or_default();
    // 按时间戳倒序
    entries.sort_by_key(|e| std::cmp::Reverse(e.timestamp));
    Ok(entries)
}

/// 写入快照索引文件（覆盖式）
/// 输入: file_snapshot_dir 文件快照目录, entries 快照列表
/// 输出: Result<(), String>
fn write_snapshot_index(
    file_snapshot_dir: &Path,
    entries: &[SnapshotMeta],
) -> Result<(), String> {
    let index_path = file_snapshot_dir.join("meta.json");
    let json = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("序列化快照索引失败: {}", e))?;
    fs::write(&index_path, json)
        .map_err(|e| format!("写入快照索引失败: {}", e))
}

/// 简单中文字数统计（委托至共享 word_count 模块）
/// 输入: text 文本内容
/// 输出: u64 字数
/// 说明: 原重复实现已迁移至 word_count::count_words, 此处保留包装函数避免大量调用点改动
fn count_words_simple(text: &str) -> u64 {
    crate::word_count::count_words(text)
}

/// 计算文件相对路径
/// 输入: file_path 文件绝对路径, project_root 项目根路径
/// 输出: Result<String, String> 相对路径字符串
fn get_relative_path(file_path: &Path, project_root: &Path) -> Result<String, String> {
    file_path
        .strip_prefix(project_root)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|_| {
            format!(
                "无法计算相对路径: {} 不在项目 {} 内",
                file_path.display(),
                project_root.display()
            )
        })
}

/// 创建文件快照命令
/// 输入:
///   file_path 源文件绝对路径
///   project_path 项目根路径
///   content 要快照的内容（前端传入，避免重复读取磁盘）
///   trigger 触发方式 "auto" | "manual"
/// 输出: Result<SnapshotMeta, String> 创建的快照元数据
/// 流程:
///   1. 校验路径在项目内
///   2. 计算快照存储目录
///   3. 生成时间戳与元数据
///   4. 写入快照内容文件
///   5. 更新索引
///   6. 清理超出上限的旧快照
#[tauri::command]
pub fn create_snapshot(
    file_path: String,
    project_path: String,
    content: String,
    trigger: String,
) -> Result<SnapshotMeta, String> {
    // 校验源文件路径在项目内（仅校验路径合法性，不要求文件存在）
    let validated = validate_path_in_project(&file_path, &project_path).map_err(|e| e.to_string())?;
    let project_root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;

    // 计算相对路径
    let relative_path = get_relative_path(&validated, &project_root)?;
    let snapshot_dir = get_file_snapshot_dir(&project_root, &relative_path)?;

    // 生成快照元数据
    let now = Local::now();
    let timestamp = now.timestamp_millis();
    let word_count = count_words_simple(&content);
    let size = content.len() as u64;
    let meta = SnapshotMeta {
        timestamp,
        created_at: now.to_rfc3339(),
        word_count,
        size,
        trigger: if trigger.is_empty() { "auto".to_string() } else { trigger },
    };

    // 写入快照内容文件（时间戳命名）
    let snapshot_file = snapshot_dir.join(format!("{}.txt", timestamp));
    fs::write(&snapshot_file, &content)
        .map_err(|e| format!("写入快照文件失败: {}", e))?;

    // 更新索引（追加）
    let mut entries = read_snapshot_index(&snapshot_dir)?;
    entries.insert(0, meta.clone());

    // P1-7: 执行统一快照清理（时间维度 + 数量维度，保护 manual/pre-restore）
    enforce_snapshot_limits(&snapshot_dir, &mut entries);

    write_snapshot_index(&snapshot_dir, &entries)?;
    Ok(meta)
}

/// 列出某文件的所有快照
/// 输入:
///   file_path 源文件绝对路径
///   project_path 项目根路径
/// 输出: Result<Vec<SnapshotInfo>, String> 快照列表（按时间倒序）
#[tauri::command]
pub fn list_snapshots(
    file_path: String,
    project_path: String,
) -> Result<Vec<SnapshotInfo>, String> {
    let validated = validate_path_in_project(&file_path, &project_path).map_err(|e| e.to_string())?;
    let project_root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;

    let relative_path = get_relative_path(&validated, &project_root)?;
    let snapshot_dir = get_file_snapshot_dir(&project_root, &relative_path)?;
    let entries = read_snapshot_index(&snapshot_dir)?;

    let snapshots = entries
        .iter()
        .map(|meta| {
            let snapshot_path = snapshot_dir
                .join(format!("{}.txt", meta.timestamp))
                .to_string_lossy()
                .to_string();
            SnapshotInfo {
                meta: meta.clone(),
                snapshot_path,
                source_relative_path: relative_path.clone(),
            }
        })
        .collect();

    Ok(snapshots)
}

/// 读取快照内容
/// 输入:
///   snapshot_path 快照文件绝对路径
///   project_path 项目根路径（用于沙箱校验）
/// 输出: Result<String, String> 快照内容
#[tauri::command]
pub fn read_snapshot(
    snapshot_path: String,
    project_path: String,
) -> Result<String, String> {
    // 快照路径必须在项目内（.novelforge/snapshots/ 下）
    let validated = validate_path_in_project(&snapshot_path, &project_path).map_err(|e| e.to_string())?;
    fs::read_to_string(&validated).map_err(|e| format!("读取快照失败: {}", e))
}

/// 恢复快照到源文件
/// 输入:
///   snapshot_path 快照文件绝对路径
///   file_path 源文件绝对路径
///   project_path 项目根路径
/// 输出: Result<(), String>
/// 流程:
///   1. 校验快照路径在项目内
///   2. 校验源文件路径在项目内
///   3. 读取快照内容
///   4. 在覆盖源文件前，先为当前内容创建一个快照（避免误恢复丢失）
///   5. 写入源文件
#[tauri::command]
pub fn restore_snapshot(
    snapshot_path: String,
    file_path: String,
    project_path: String,
) -> Result<(), String> {
    let snapshot_validated = validate_path_in_project(&snapshot_path, &project_path).map_err(|e| e.to_string())?;
    let file_validated = validate_path_in_project(&file_path, &project_path).map_err(|e| e.to_string())?;
    let project_root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;

    // 读取快照内容
    let snapshot_content = fs::read_to_string(&snapshot_validated)
        .map_err(|e| format!("读取快照内容失败: {}", e))?;

    // 恢复前为当前文件内容创建一个安全快照（如果源文件存在）
    if file_validated.exists() {
        if let Ok(current_content) = fs::read_to_string(&file_validated) {
            let _ = create_snapshot_inner(
                &file_validated,
                &project_root,
                &current_content,
                "pre-restore",
            );
        }
    }

    // 确保源文件父目录存在
    if let Some(parent) = file_validated.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
    }

    fs::write(&file_validated, &snapshot_content)
        .map_err(|e| format!("恢复快照失败: {}", e))
}

/// 删除单个快照
/// 输入:
///   snapshot_path 快照文件绝对路径
///   timestamp 快照时间戳（用于同步删除索引项）
///   file_path 源文件路径（用于定位索引）
///   project_path 项目根路径
/// 输出: Result<(), String>
#[tauri::command]
pub fn delete_snapshot(
    snapshot_path: String,
    timestamp: i64,
    file_path: String,
    project_path: String,
) -> Result<(), String> {
    let snapshot_validated = validate_path_in_project(&snapshot_path, &project_path).map_err(|e| e.to_string())?;
    let file_validated = validate_path_in_project(&file_path, &project_path).map_err(|e| e.to_string())?;
    let project_root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;

    // 删除快照文件
    if snapshot_validated.exists() {
        fs::remove_file(&snapshot_validated)
            .map_err(|e| format!("删除快照文件失败: {}", e))?;
    }

    // 更新索引：移除对应时间戳的条目
    let relative_path = get_relative_path(&file_validated, &project_root)?;
    let snapshot_dir = get_file_snapshot_dir(&project_root, &relative_path)?;
    let mut entries = read_snapshot_index(&snapshot_dir)?;
    entries.retain(|e| e.timestamp != timestamp);
    write_snapshot_index(&snapshot_dir, &entries)?;

    Ok(())
}

/// 清空某文件的所有快照
/// 输入:
///   file_path 源文件绝对路径
///   project_path 项目根路径
/// 输出: Result<u64, String> 删除的快照数量
#[tauri::command]
pub fn clear_snapshots(
    file_path: String,
    project_path: String,
) -> Result<u64, String> {
    let file_validated = validate_path_in_project(&file_path, &project_path).map_err(|e| e.to_string())?;
    let project_root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;

    let relative_path = get_relative_path(&file_validated, &project_root)?;
    let snapshot_dir = get_file_snapshot_dir(&project_root, &relative_path)?;
    let entries = read_snapshot_index(&snapshot_dir)?;
    let count = entries.len() as u64;

    // 清空索引文件
    write_snapshot_index(&snapshot_dir, &[])?;

    // 删除所有快照内容文件
    if let Ok(items) = fs::read_dir(&snapshot_dir) {
        for item in items.flatten() {
            let path = item.path();
            if path.is_file() && path.extension().map(|e| e == "txt").unwrap_or(false) {
                let _ = fs::remove_file(&path);
            }
        }
    }

    Ok(count)
}

/// 获取快照存储统计信息
/// 输入: project_path 项目根路径
/// 输出: Result<SnapshotStats, String> 统计信息
#[derive(Debug, Clone, Serialize)]
pub struct SnapshotStats {
    /// 快照文件总数
    pub total_snapshots: u64,
    /// 快照占用总字节数
    pub total_size: u64,
    /// 拥有快照的文件数
    pub files_with_snapshots: u64,
}

/// 获取项目快照统计
/// 输入: project_path 项目根路径
/// 输出: Result<SnapshotStats, String>
#[tauri::command]
pub fn get_snapshot_stats(project_path: String) -> Result<SnapshotStats, String> {
    let project_root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;
    let snapshots_root = project_root.join(".novelforge").join("snapshots");

    if !snapshots_root.exists() {
        return Ok(SnapshotStats {
            total_snapshots: 0,
            total_size: 0,
            files_with_snapshots: 0,
        });
    }

    let mut total_snapshots: u64 = 0;
    let mut total_size: u64 = 0;
    let mut files_with_snapshots: u64 = 0;

    // 遍历快照根目录下的每个文件快照目录
    if let Ok(entries) = fs::read_dir(&snapshots_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            // 读取该文件的索引
            if let Ok(index) = read_snapshot_index(&path) {
                if !index.is_empty() {
                    files_with_snapshots += 1;
                    total_snapshots += index.len() as u64;
                    total_size += index.iter().map(|m| m.size).sum::<u64>();
                }
            }
        }
    }

    Ok(SnapshotStats {
        total_snapshots,
        total_size,
        files_with_snapshots,
    })
}

/// 内部函数：创建快照（不经过 Tauri 命令层，供其他 Rust 模块调用）
/// 输入:
///   file_path 文件绝对路径
///   project_root 项目根路径（已 canonicalize）
///   content 快照内容
///   trigger 触发方式
/// 输出: Result<SnapshotMeta, String>
fn create_snapshot_inner(
    file_path: &Path,
    project_root: &Path,
    content: &str,
    trigger: &str,
) -> Result<SnapshotMeta, String> {
    let relative_path = get_relative_path(file_path, project_root)?;
    let snapshot_dir = get_file_snapshot_dir(project_root, &relative_path)?;

    let now = Local::now();
    let timestamp = now.timestamp_millis();
    let word_count = count_words_simple(content);
    let size = content.len() as u64;
    let meta = SnapshotMeta {
        timestamp,
        created_at: now.to_rfc3339(),
        word_count,
        size,
        trigger: trigger.to_string(),
    };

    let snapshot_file = snapshot_dir.join(format!("{}.txt", timestamp));
    fs::write(&snapshot_file, content)
        .map_err(|e| format!("写入快照文件失败: {}", e))?;

    let mut entries = read_snapshot_index(&snapshot_dir)?;
    entries.insert(0, meta.clone());

    // P1-7: 执行统一快照清理（时间维度 + 数量维度，保护 manual/pre-restore）
    enforce_snapshot_limits(&snapshot_dir, &mut entries);

    write_snapshot_index(&snapshot_dir, &entries)?;
    Ok(meta)
}

/// 执行快照清理（时间维度 + 数量维度）
/// 输入:
///   snapshot_dir 快照目录路径
///   entries 快照索引列表（可变引用，按时间倒序，最新在前）
/// 输出: 无（直接修改 entries 并删除对应文件）
/// 流程:
///   1. 时间维度: 删除超过 MAX_AUTO_SNAPSHOT_AGE_DAYS 天的 auto 快照
///      manual 与 pre-restore 快照不受时间维度约束（用户手动创建的版本必须保留）
///   2. 数量维度: 超过 MAX_SNAPSHOTS 时优先淘汰 auto 快照
///      仅当 auto 快照全部淘汰后仍超限，才淘汰 manual/pre-restore（按 FIFO）
///   3. 同步删除对应的快照文件（忽略错误：文件可能已被手动删除）
/// 设计依据:
///   - auto 快照是高频自动保存，历史价值低，可按时间清理
///   - manual 快照是用户主动创建的里程碑版本，必须长期保留
///   - pre-restore 快照是恢复前的安全备份，必须保留以支持再次回滚
fn enforce_snapshot_limits(snapshot_dir: &Path, entries: &mut Vec<SnapshotMeta>) {
    if entries.is_empty() {
        return;
    }

    let now = Local::now();
    let max_age = Duration::days(MAX_AUTO_SNAPSHOT_AGE_DAYS);

    // 步骤1: 时间维度清理 - 删除超期的 auto 快照
    let mut expired_timestamps: Vec<i64> = Vec::new();
    entries.retain(|meta| {
        if meta.trigger == "auto" {
            // 解析快照创建时间
            let should_remove = if let Ok(created) = chrono::DateTime::parse_from_rfc3339(&meta.created_at) {
                let age = now.signed_duration_since(created.with_timezone(&Local));
                age > max_age
            } else {
                // 时间解析失败：回退为按时间戳判断
                let age_ms = now.timestamp_millis() - meta.timestamp;
                age_ms > max_age.num_milliseconds()
            };
            if should_remove {
                expired_timestamps.push(meta.timestamp);
                return false; // 从索引中移除
            }
        }
        true // 保留
    });

    // 删除超期快照的文件
    for ts in &expired_timestamps {
        let old_file = snapshot_dir.join(format!("{}.txt", ts));
        let _ = fs::remove_file(&old_file);
    }

    // 步骤2: 数量维度清理 - 超限时优先淘汰 auto
    if entries.len() > MAX_SNAPSHOTS {
        // 按 trigger 分组：auto 快照优先淘汰
        // 稳定排序：auto 在后（被优先截断），manual/pre-restore 在前（优先保留）
        // 注意: entries 按时间倒序（最新在前），需在保持时间顺序的前提下优先淘汰 auto
        // 策略: 从最旧的开始淘汰（entries 末尾），优先淘汰 auto 类型
        while entries.len() > MAX_SNAPSHOTS {
            // 从末尾向前查找第一个 auto 快照（最旧的 auto）
            // 若无 auto 快照可淘汰，则按 FIFO 淘汰最旧的（末尾元素）
            let remove_idx = entries
                .iter()
                .rposition(|m| m.trigger == "auto")
                .or_else(|| {
                    if entries.is_empty() {
                        None
                    } else {
                        Some(entries.len() - 1)
                    }
                });
            if let Some(idx) = remove_idx {
                let removed = entries.remove(idx);
                let old_file = snapshot_dir.join(format!("{}.txt", removed.timestamp));
                let _ = fs::remove_file(&old_file);
            } else {
                break;
            }
        }
    }
}
