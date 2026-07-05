// .pmd 格式迁移工具模块
//
// 功能概述：
// 批量将项目中的旧版存储格式（.txt 纯文本 / .txt 含 HTML / .html）转换为
// .pmd（ProseMirror JSON）格式，支持批量进度回调、中断恢复、磁盘可写性检查。
//
// 模块职责：
// 1. 扫描项目中待迁移的文件（排除设定文件、备份文件、.novelforge 目录）
// 2. 将纯文本/HTML 内容转换为 ProseMirror JSON 文档（每行一个 paragraph）
// 3. 备份原文件为 .bak，写入 .pmd 新文件
// 4. 通过 Tauri 事件推送迁移进度（pmd-migration-progress）
// 5. 持久化迁移状态到 .novelforge/migration_state.json，支持断点续传
// 6. 迁移前检查目标目录可写性与空间估算
//
// 设计说明：
// - HTML 转换采用简化策略：先用 text_extractor 剥离标签提取纯文本，再按行生成
//   paragraph 节点。这会损失富文本格式（粗体/斜体/标题等），但保留全部文本内容。
//   原文件备份为 .bak，用户可手动恢复格式。
// - 设定文件（JSON front matter，首行 ---）不参与迁移，由 codex 模块独立管理。
// - 已是 .pmd 格式的文件自动跳过，避免重复迁移。
// - 迁移状态记录已处理文件列表，重启后跳过已完成项，实现断点续传。

use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::text_extractor::{detect_format, extract_plain_text, ContentFormat};

/// 待迁移文件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationTarget {
    /// 文件绝对路径
    pub file_path: String,
    /// 相对项目根的路径
    pub relative_path: String,
    /// 文件名
    pub file_name: String,
    /// 原始格式（PlainText / Html）
    pub original_format: String,
    /// 文件大小（字节）
    pub size: u64,
}

/// 迁移进度事件 payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationProgress {
    /// 当前已处理文件数
    pub processed: usize,
    /// 待迁移文件总数
    pub total: usize,
    /// 当前处理的文件相对路径
    pub current_file: String,
    /// 已完成百分比（0-100）
    pub percent: u8,
    /// 迁移阶段（scan / migrate / done / error）
    pub stage: String,
}

/// 单个文件迁移结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMigrationResult {
    /// 原文件相对路径
    pub relative_path: String,
    /// 是否成功
    pub success: bool,
    /// 失败原因（success=false 时有值）
    pub error: Option<String>,
    /// 是否跳过（已是 .pmd 或为设定文件）
    pub skipped: bool,
    /// 跳过原因
    pub skip_reason: Option<String>,
}

/// 迁移统计结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationStats {
    /// 待迁移文件总数
    pub total_targets: usize,
    /// 成功迁移数
    pub migrated: usize,
    /// 跳过数
    pub skipped: usize,
    /// 失败数
    pub failed: usize,
    /// 备份文件总数
    pub backups_created: usize,
    /// 各文件详情
    pub details: Vec<FileMigrationResult>,
    /// 是否为断点续传（true 表示从上次中断处继续）
    pub resumed: bool,
}

/// 迁移状态（持久化到 .novelforge/migration_state.json）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationState {
    /// 已完成迁移的文件相对路径列表
    pub completed: Vec<String>,
    /// 迁移开始时间（ISO 8601）
    pub started_at: String,
    /// 最后更新时间（ISO 8601）
    pub updated_at: String,
    /// 是否全部完成
    pub finished: bool,
}

/// 迁移状态文件名
const MIGRATION_STATE_FILE: &str = "migration_state.json";

/// 迁移进度事件名
const PROGRESS_EVENT: &str = "pmd-migration-progress";

/// 扫描项目中待迁移的文件
/// 输入:
///   project_path - 项目根路径
/// 输出: Result<Vec<MigrationTarget>, String> 待迁移文件列表
/// 流程:
///   1. 递归遍历项目目录
///   2. 收集 .txt / .html / .htm 文件
///   3. 排除 .bak 备份文件、.novelforge 目录、设定文件（JSON front matter）
///   4. 检测每个文件的原始格式
///   5. 已是 .pmd 格式的文件不纳入扫描（扩展名不是 .pmd）
fn scan_migration_targets(project_root: &Path) -> Result<Vec<MigrationTarget>, String> {
    let mut targets = Vec::new();
    collect_migration_targets(project_root, project_root, &mut targets)?;
    Ok(targets)
}

/// 递归收集待迁移文件
/// 输入:
///   current - 当前遍历路径
///   root - 项目根路径
///   targets - 累积的待迁移文件列表
/// 流程:
///   1. 跳过隐藏目录与 .novelforge 目录
///   2. 对 .txt/.html/.htm 文件检测格式
///   3. 排除 .bak 文件与设定文件（含 front matter）
fn collect_migration_targets(
    current: &Path,
    root: &Path,
    targets: &mut Vec<MigrationTarget>,
) -> Result<(), String> {
    let entries = fs::read_dir(current).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // 跳过隐藏文件与目录
        if name.starts_with('.') {
            continue;
        }
        // 跳过 .novelforge 内部目录（快照、索引等）
        if path.is_dir() {
            collect_migration_targets(&path, root, targets)?;
            continue;
        }

        let lower = name.to_lowercase();
        // 仅处理 .txt / .html / .htm 文件
        if !(lower.ends_with(".txt") || lower.ends_with(".html") || lower.ends_with(".htm")) {
            continue;
        }
        // 排除备份文件
        if lower.ends_with(".bak") {
            continue;
        }

        // 读取文件内容检测格式
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue, // 无法读取的文件跳过
        };

        let format = detect_format(&name, &content);
        // 设定文件（JSON front matter）不参与迁移，由 codex 模块管理
        if format == ContentFormat::JsonFrontMatter {
            continue;
        }
        // 已是 ProseMirror JSON 的 .txt 文件（旧版手动存储）仍需迁移为 .pmd
        // 但已是 .pmd 扩展名的文件不会进入此扫描（扩展名过滤已排除）

        let relative_path = path
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();

        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);

        targets.push(MigrationTarget {
            file_path: path.to_string_lossy().to_string(),
            relative_path,
            file_name: name,
            original_format: format!("{:?}", format),
            size,
        });
    }
    Ok(())
}

/// 将纯文本转换为 ProseMirror JSON 文档
/// 输入: text 纯文本内容
/// 输出: String ProseMirror JSON 字符串
/// 流程:
///   1. 按换行符分割文本
///   2. 非空行转为含 text 节点的 paragraph
///   3. 空行转为空 paragraph
///   4. 包装为 doc 根节点
fn convert_text_to_pmd_json(text: &str) -> String {
    let mut content = Vec::new();
    // 按 \n 分割并去除行尾 \r，兼容 Windows CRLF 与 Unix LF 换行
    for line in text.split('\n').map(|l| l.trim_end_matches('\r')) {
        if line.is_empty() {
            content.push(serde_json::json!({
                "type": "paragraph"
            }));
        } else {
            content.push(serde_json::json!({
                "type": "paragraph",
                "content": [
                    { "type": "text", "text": line }
                ]
            }));
        }
    }
    // 空文档至少保留一个空段落，避免 ProseMirror 解析失败
    if content.is_empty() {
        content.push(serde_json::json!({ "type": "paragraph" }));
    }

    let doc = serde_json::json!({
        "type": "doc",
        "content": content
    });
    serde_json::to_string(&doc).unwrap_or_else(|_| "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}".to_string())
}

/// 将任意格式内容转换为 .pmd（ProseMirror JSON）
/// 输入:
///   content - 原始文件内容
///   format - 内容格式
/// 输出: String ProseMirror JSON 字符串
/// 流程:
///   1. PmdJson 直接返回（已是目标格式）
///   2. Html/PlainText 先提取纯文本，再按行生成 paragraph
fn convert_to_pmd(content: &str, format: ContentFormat) -> String {
    match format {
        ContentFormat::PmdJson => {
            // 已是 ProseMirror JSON，验证后直接返回
            match serde_json::from_str::<serde_json::Value>(content) {
                Ok(v) => serde_json::to_string(&v).unwrap_or_else(|_| content.to_string()),
                Err(_) => {
                    // JSON 解析失败，降级为纯文本转换
                    convert_text_to_pmd_json(content)
                }
            }
        }
        ContentFormat::Html | ContentFormat::PlainText => {
            let plain = extract_plain_text(content, format);
            convert_text_to_pmd_json(&plain)
        }
        ContentFormat::JsonFrontMatter => {
            // 设定文件不应进入此函数，防御性处理
            let plain = extract_plain_text(content, format);
            convert_text_to_pmd_json(&plain)
        }
    }
}

/// 生成 .pmd 文件路径（替换原扩展名）
/// 输入: original_path 原文件路径
/// 输出: PathBuf .pmd 文件路径
/// 流程:
///   1. .txt / .html / .htm 替换为 .pmd
///   2. 无扩展名则追加 .pmd
fn to_pmd_path(original_path: &Path) -> PathBuf {
    let path_str = original_path.to_string_lossy().to_lowercase();
    if path_str.ends_with(".txt") || path_str.ends_with(".html") || path_str.ends_with(".htm") {
        let new_str = original_path.to_string_lossy();
        let new_str = if path_str.ends_with(".txt") {
            new_str[..new_str.len() - 4].to_string()
        } else if path_str.ends_with(".html") {
            new_str[..new_str.len() - 5].to_string()
        } else {
            new_str[..new_str.len() - 4].to_string()
        };
        PathBuf::from(format!("{}.pmd", new_str))
    } else {
        let mut p = original_path.to_path_buf();
        p.set_extension("pmd");
        p
    }
}

/// 生成备份文件路径（原文件名 + .bak）
/// 输入: original_path 原文件路径
/// 输出: PathBuf 备份文件路径
fn to_backup_path(original_path: &Path) -> PathBuf {
    let mut p = original_path.to_path_buf();
    let new_name = format!(
        "{}.bak",
        p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
    );
    p.set_file_name(new_name);
    p
}

/// 获取迁移状态文件路径
/// 输入: project_root 项目根路径
/// 输出: PathBuf .novelforge/migration_state.json 路径
fn get_state_file_path(project_root: &Path) -> PathBuf {
    project_root.join(".novelforge").join(MIGRATION_STATE_FILE)
}

/// 加载迁移状态（断点续传）
/// 输入: project_root 项目根路径
/// 输出: Option<MigrationState> 已有状态（None 表示首次迁移）
/// 流程: 读取 .novelforge/migration_state.json 并解析
fn load_migration_state(project_root: &Path) -> Option<MigrationState> {
    let state_path = get_state_file_path(project_root);
    let content = fs::read_to_string(&state_path).ok()?;
    serde_json::from_str(&content).ok()
}

/// 保存迁移状态
/// 输入:
///   project_root - 项目根路径
///   state - 迁移状态
/// 输出: Result<(), String> 保存结果
/// 流程: 原子写入 .novelforge/migration_state.json
fn save_migration_state(project_root: &Path, state: &MigrationState) -> Result<(), String> {
    let state_path = get_state_file_path(project_root);
    // 确保 .novelforge 目录存在
    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 .novelforge 目录失败: {}", e))?;
    }
    let json = serde_json::to_string_pretty(state).map_err(|e| format!("序列化迁移状态失败: {}", e))?;
    // 原子写入：先写临时文件再重命名
    let tmp_path = PathBuf::from(format!("{}.tmp", state_path.to_string_lossy()));
    fs::write(&tmp_path, &json).map_err(|e| format!("写入迁移状态临时文件失败: {}", e))?;
    fs::rename(&tmp_path, &state_path).map_err(|e| format!("重命名迁移状态文件失败: {}", e))?;
    Ok(())
}

/// 检查磁盘可写性与空间估算
/// 输入:
///   project_root - 项目根路径
///   required_bytes - 预估所需空间（字节）
/// 输出: Result<(), String> 检查结果（失败返回错误信息）
/// 流程:
///   1. 确认 .novelforge 目录可创建
///   2. 写入测试文件验证可写性
///   3. 估算空间：仅作粗略判断，无法精确获取磁盘可用空间（标准库限制）
///   4. 测试文件大小与 required_bytes 对比，作为可写性佐证
fn check_disk_writable(project_root: &Path, required_bytes: u64) -> Result<(), String> {
    let novelforge_dir = project_root.join(".novelforge");
    fs::create_dir_all(&novelforge_dir).map_err(|e| format!("无法创建 .novelforge 目录: {}", e))?;

    // 写入测试文件验证可写性
    let test_file = novelforge_dir.join(".writable_test");
    let test_data = "0".repeat(1024); // 1KB 测试数据
    fs::write(&test_file, &test_data).map_err(|e| format!("磁盘不可写: {}", e))?;

    // 清理测试文件
    let _ = fs::remove_file(&test_file);

    // 空间估算：仅当日志输出，标准库无法精确获取磁盘可用空间
    // 实际写入失败时由后续文件写入操作捕获错误
    if required_bytes > 500 * 1024 * 1024 {
        // 超过 500MB 时输出警告（不阻断迁移，由实际写入失败处理）
        eprintln!(
            "[pmd_migration] 警告: 预估所需空间 {:.2}MB 较大，如遇磁盘满请清理后重试",
            required_bytes as f64 / 1024.0 / 1024.0
        );
    }
    Ok(())
}

/// 原子写入文件（临时文件 + 重命名）
/// 输入:
///   path - 目标文件路径
///   content - 文件内容
/// 输出: Result<(), String> 写入结果
/// 流程:
///   1. 写入 .tmp 临时文件
///   2. 重命名为目标文件（原子操作）
///   3. 失败时清理临时文件
fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    // 临时文件与目标文件同目录，确保重命名操作在同一文件系统（原子性保证）
    let tmp_path = PathBuf::from(format!("{}.tmp", path.to_string_lossy()));
    fs::write(&tmp_path, content).map_err(|e| format!("写入临时文件失败: {}", e))?;
    match fs::rename(&tmp_path, path) {
        Ok(_) => Ok(()),
        Err(e) => {
            // 重命名失败，清理临时文件
            let _ = fs::remove_file(&tmp_path);
            Err(format!("重命名文件失败: {}", e))
        }
    }
}

/// 备份原文件
/// 输入: original_path 原文件路径
/// 输出: Result<PathBuf, String> 备份文件路径
/// 流程:
///   1. 生成备份路径（原文件名 + .bak）
///   2. 若备份已存在则跳过（避免覆盖已有备份）
///   3. 复制原文件到备份路径
fn backup_original_file(original_path: &Path) -> Result<PathBuf, String> {
    let backup_path = to_backup_path(original_path);
    // 备份已存在则跳过（支持重复迁移不覆盖原始备份）
    if backup_path.exists() {
        return Ok(backup_path);
    }
    fs::copy(original_path, &backup_path).map_err(|e| format!("备份文件失败: {}", e))?;
    Ok(backup_path)
}

/// 迁移单个文件
/// 输入:
///   target - 待迁移文件信息
///   project_root - 项目根路径
/// 输出: FileMigrationResult 迁移结果
/// 流程:
///   1. 读取原文件内容
///   2. 检测格式
///   3. 转换为 ProseMirror JSON
///   4. 备份原文件
///   5. 原子写入 .pmd 文件
///   6. 删除原文件（保留 .bak 备份）
fn migrate_single_file(target: &MigrationTarget, project_root: &Path) -> FileMigrationResult {
    let original_path = Path::new(&target.file_path);
    let pmd_path = to_pmd_path(original_path);

    // 已存在 .pmd 文件视为已迁移（跳过）
    if pmd_path.exists() {
        return FileMigrationResult {
            relative_path: target.relative_path.clone(),
            success: true,
            error: None,
            skipped: true,
            skip_reason: Some(".pmd 文件已存在".to_string()),
        };
    }

    // 读取原文件内容
    let content = match fs::read_to_string(original_path) {
        Ok(c) => c,
        Err(e) => {
            return FileMigrationResult {
                relative_path: target.relative_path.clone(),
                success: false,
                error: Some(format!("读取文件失败: {}", e)),
                skipped: false,
                skip_reason: None,
            };
        }
    };

    let format = detect_format(&target.file_name, &content);
    // 设定文件不迁移
    if format == ContentFormat::JsonFrontMatter {
        return FileMigrationResult {
            relative_path: target.relative_path.clone(),
            success: true,
            error: None,
            skipped: true,
            skip_reason: Some("设定文件（JSON front matter）不参与迁移".to_string()),
        };
    }

    // 转换为 ProseMirror JSON
    let pmd_json = convert_to_pmd(&content, format);

    // 备份原文件
    let _backup_path = match backup_original_file(original_path) {
        Ok(p) => p,
        Err(e) => {
            return FileMigrationResult {
                relative_path: target.relative_path.clone(),
                success: false,
                error: Some(format!("备份失败: {}", e)),
                skipped: false,
                skip_reason: None,
            };
        }
    };

    // 原子写入 .pmd 文件
    if let Err(e) = atomic_write(&pmd_path, &pmd_json) {
        return FileMigrationResult {
            relative_path: target.relative_path.clone(),
            success: false,
            error: Some(e),
            skipped: false,
            skip_reason: None,
        };
    }

    // 删除原文件（备份已保留为 .bak）
    // 注意：不删除原文件，保留作为冗余备份，由用户手动清理
    // 这样设计的原因：迁移工具首次发布，保留原文件作为安全网

    let _ = project_root; // 保留参数用于未来扩展（如清理原文件选项）

    FileMigrationResult {
        relative_path: target.relative_path.clone(),
        success: true,
        error: None,
        skipped: false,
        skip_reason: None,
    }
}

/// 批量迁移项目文件为 .pmd 格式
/// 输入:
///   app - Tauri 应用句柄（用于推送进度事件）
///   project_path - 项目根路径
/// 输出: Result<MigrationStats, String> 迁移统计
/// 流程:
///   1. 校验项目路径
///   2. 扫描待迁移文件
///   3. 磁盘可写性检查
///   4. 加载迁移状态（断点续传）
///   5. 逐个迁移文件，跳过已完成项
///   6. 每个文件处理后推送进度事件
///   7. 更新迁移状态
///   8. 返回统计结果
#[tauri::command]
pub fn migrate_project_to_pmd(
    app: AppHandle,
    project_path: String,
) -> Result<MigrationStats, String> {
    // 校验项目路径
    let project_root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;
    if !project_root.is_dir() {
        return Err("项目路径不是目录".to_string());
    }

    // 推送扫描阶段进度
    let _ = app.emit(
        PROGRESS_EVENT,
        MigrationProgress {
            processed: 0,
            total: 0,
            current_file: String::new(),
            percent: 0,
            stage: "scan".to_string(),
        },
    );

    // 扫描待迁移文件
    let targets = scan_migration_targets(&project_root)?;
    let total = targets.len();
    if total == 0 {
        let _ = app.emit(
            PROGRESS_EVENT,
            MigrationProgress {
                processed: 0,
                total: 0,
                current_file: String::new(),
                percent: 100,
                stage: "done".to_string(),
            },
        );
        return Ok(MigrationStats {
            total_targets: 0,
            migrated: 0,
            skipped: 0,
            failed: 0,
            backups_created: 0,
            details: vec![],
            resumed: false,
        });
    }

    // 估算所需空间（原文件总大小 * 2：备份 + 新文件）
    let total_size: u64 = targets.iter().map(|t| t.size).sum();
    let required_bytes = total_size * 2;
    check_disk_writable(&project_root, required_bytes)?;

    // 加载迁移状态（断点续传）
    let existing_state = load_migration_state(&project_root);
    let resumed = existing_state.is_some();
    let mut completed_set: std::collections::HashSet<String> = match &existing_state {
        Some(state) => state.completed.iter().cloned().collect(),
        None => std::collections::HashSet::new(),
    };

    let now = chrono::Local::now().to_rfc3339();
    let mut state = existing_state.unwrap_or(MigrationState {
        completed: vec![],
        started_at: now.clone(),
        updated_at: now,
        finished: false,
    });

    // 逐个迁移文件
    let mut details = Vec::with_capacity(total);
    let mut migrated = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;
    let mut backups_created = 0usize;

    for (idx, target) in targets.iter().enumerate() {
        // 断点续传：跳过已完成项
        if completed_set.contains(&target.relative_path) {
            skipped += 1;
            details.push(FileMigrationResult {
                relative_path: target.relative_path.clone(),
                success: true,
                error: None,
                skipped: true,
                skip_reason: Some("断点续传跳过".to_string()),
            });
            continue;
        }

        // 推送迁移中进度
        let percent = ((idx as f64 / total as f64) * 100.0) as u8;
        let _ = app.emit(
            PROGRESS_EVENT,
            MigrationProgress {
                processed: idx,
                total,
                current_file: target.relative_path.clone(),
                percent,
                stage: "migrate".to_string(),
            },
        );

        // 执行迁移
        let result = migrate_single_file(target, &project_root);
        if result.success {
            if result.skipped {
                skipped += 1;
            } else {
                migrated += 1;
                backups_created += 1;
                // 记录到已完成集合
                completed_set.insert(target.relative_path.clone());
                state.completed.push(target.relative_path.clone());
            }
        } else {
            failed += 1;
        }
        details.push(result);

        // 每处理 10 个文件保存一次状态（断点续传）
        if (idx + 1) % 10 == 0 {
            state.updated_at = chrono::Local::now().to_rfc3339();
            let _ = save_migration_state(&project_root, &state);
        }
    }

    // 标记迁移完成
    state.finished = true;
    state.updated_at = chrono::Local::now().to_rfc3339();
    let _ = save_migration_state(&project_root, &state);

    // 推送完成进度
    let _ = app.emit(
        PROGRESS_EVENT,
        MigrationProgress {
            processed: total,
            total,
            current_file: String::new(),
            percent: 100,
            stage: "done".to_string(),
        },
    );

    Ok(MigrationStats {
        total_targets: total,
        migrated,
        skipped,
        failed,
        backups_created,
        details,
        resumed,
    })
}

/// 读取迁移状态
/// 输入: project_path 项目根路径
/// 输出: Result<Option<MigrationState>, String> 迁移状态（None 表示无状态文件）
/// 流程: 读取 .novelforge/migration_state.json
#[tauri::command]
pub fn get_migration_state(project_path: String) -> Result<Option<MigrationState>, String> {
    let project_root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;
    Ok(load_migration_state(&project_root))
}

/// 清除迁移状态
/// 输入: project_path 项目根路径
/// 输出: Result<(), String> 清除结果
/// 流程: 删除 .novelforge/migration_state.json
/// 用途: 用户确认迁移成功后手动清除状态，或重新迁移时重置断点
#[tauri::command]
pub fn clear_migration_state(project_path: String) -> Result<(), String> {
    let project_root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;
    let state_path = get_state_file_path(&project_root);
    if state_path.exists() {
        fs::remove_file(&state_path).map_err(|e| format!("删除迁移状态文件失败: {}", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_text_to_pmd_json_basic() {
        let text = "第一行\n第二行\n\n第四行";
        let json = convert_text_to_pmd_json(text);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "doc");
        let content = parsed["content"].as_array().unwrap();
        // 4 行（含空行）应生成 4 个 paragraph
        assert_eq!(content.len(), 4);
        assert_eq!(content[0]["type"], "paragraph");
        assert_eq!(content[0]["content"][0]["text"], "第一行");
        // 空行应为空 paragraph（无 content 字段）
        assert_eq!(content[2]["type"], "paragraph");
        assert!(content[2].get("content").is_none() || content[2]["content"].as_array().unwrap().is_empty());
    }

    #[test]
    fn test_convert_text_to_pmd_json_empty() {
        let json = convert_text_to_pmd_json("");
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "doc");
        // 空文档至少保留一个空段落
        assert_eq!(parsed["content"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_to_pmd_path_txt() {
        let path = Path::new("/project/正文/第一章.txt");
        let pmd = to_pmd_path(path);
        assert_eq!(pmd.to_string_lossy(), "/project/正文/第一章.pmd");
    }

    #[test]
    fn test_to_pmd_path_html() {
        let path = Path::new("/project/正文/第一章.html");
        let pmd = to_pmd_path(path);
        assert_eq!(pmd.to_string_lossy(), "/project/正文/第一章.pmd");
    }

    #[test]
    fn test_to_pmd_path_htm() {
        let path = Path::new("/project/正文/第一章.htm");
        let pmd = to_pmd_path(path);
        assert_eq!(pmd.to_string_lossy(), "/project/正文/第一章.pmd");
    }

    #[test]
    fn test_to_backup_path() {
        let path = Path::new("/project/正文/第一章.txt");
        let bak = to_backup_path(path);
        assert_eq!(bak.to_string_lossy(), "/project/正文/第一章.txt.bak");
    }

    #[test]
    fn test_convert_html_to_pmd() {
        let html = "<p>Hello</p><p>World</p>";
        let json = convert_to_pmd(html, ContentFormat::Html);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "doc");
        let content = parsed["content"].as_array().unwrap();
        // HTML 提取纯文本后应包含 Hello 和 World
        let full_text: String = content
            .iter()
            .filter_map(|p| p.get("content"))
            .filter_map(|c| c.as_array())
            .flatten()
            .filter_map(|n| n.get("text"))
            .filter_map(|t| t.as_str())
            .collect::<Vec<_>>()
            .join("");
        assert!(full_text.contains("Hello"));
        assert!(full_text.contains("World"));
    }

    #[test]
    fn test_convert_pmd_json_passthrough() {
        let pmd = r#"{"type":"doc","content":[{"type":"paragraph"}]}"#;
        let result = convert_to_pmd(pmd, ContentFormat::PmdJson);
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["type"], "doc");
    }
}
