// 项目写作统计命令模块
//
// 功能概述：
// 提供项目写作统计信息的 Tauri 命令，包含正文字数、设定字数、大纲字数、
// 章节字数列表、总文件数、项目创建天数等指标。
//
// 持久化策略(Task 1.4 升级)：
//   - 统计快照持久化到 <project>/.novelforge/writing_stats.json
//   - 章节保存时由前端调用 update_chapter_word_count 命令增量更新
//   - get_writing_stats 优先读取持久化数据,检测章节文件 mtime 变化时增量扫描更新
//   - 消除每次全目录扫描的开销
//
// 模块职责：
// 1. 定义 WritingStatsSnapshot 持久化结构体(chapterId -> 字数映射)
// 2. 实现 load_writing_stats / save_writing_stats 原子读写
// 3. get_writing_stats 命令优先读取持久化数据,失效时增量扫描
// 4. update_chapter_word_count 命令增量更新单章字数(章节保存时调用)
// 5. 保留原有全量扫描能力作为兜底
//
// 错误处理：
// 所有 Tauri 命令返回 Result<T, AppError>，向前端传递结构化错误信息。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::commands::{is_indexable_file, read_project_meta, validate_project_path};
use crate::error::AppError;
use crate::text_extractor;

// ===== 持久化快照结构(Task 1.4.1) =====

/// 写作统计持久化快照
///
/// 存储位置: <project>/.novelforge/writing_stats.json
/// 用途: 消除每次 get_writing_stats 的全目录扫描,章节保存时增量更新
///
/// 字段说明:
/// - chapter_words: 章节相对路径 -> 字数(以相对路径作为 chapterId,兼容无 UUID 的旧文件)
/// - chapter_mtimes: 章节相对路径 -> 文件 mtime 毫秒时间戳(用于检测文件是否变化)
/// - total_words: 总字数(正文+设定+大纲,缓存避免重复计算)
/// - manuscript_words / setting_words / outline_words: 各分类字数缓存
/// - last_updated: 最后更新时间(ISO 8601)
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WritingStatsSnapshot {
    /// 章节相对路径 -> 字数映射(正文目录下的章节文件)
    pub chapter_words: HashMap<String, u64>,
    /// 章节相对路径 -> 文件 mtime 毫秒时间戳(用于检测文件是否变化,触发增量扫描)
    #[serde(default)]
    pub chapter_mtimes: HashMap<String, u64>,
    /// 正文字数(所有章节字数之和,缓存避免重复计算)
    #[serde(default)]
    pub manuscript_words: u64,
    /// 设定文件字数(角色/世界观/名词/时间线等)
    #[serde(default)]
    pub setting_words: u64,
    /// 大纲字数
    #[serde(default)]
    pub outline_words: u64,
    /// 最后更新时间(ISO 8601 格式)
    pub last_updated: String,
}

impl Default for WritingStatsSnapshot {
    fn default() -> Self {
        Self {
            chapter_words: HashMap::new(),
            chapter_mtimes: HashMap::new(),
            manuscript_words: 0,
            setting_words: 0,
            outline_words: 0,
            last_updated: chrono::Local::now().to_rfc3339(),
        }
    }
}

/// 写作统计信息结构(对外返回给前端)
///
/// 与 WritingStatsSnapshot 分离:
/// - Snapshot 用于持久化,仅包含可缓存字段
/// - WritingStats 用于返回前端,包含实时计算的派生字段(总文件数/创建天数/章节列表)
#[derive(Debug, Clone, serde::Serialize)]
pub struct WritingStats {
    /// 总字数
    pub total_words: u64,
    /// 总章节数
    pub total_chapters: u64,
    /// 总文件数(含设定文件)
    pub total_files: u64,
    /// 正文字数
    pub manuscript_words: u64,
    /// 设定文件字数(角色/世界观/名词等)
    pub setting_words: u64,
    /// 大纲字数
    pub outline_words: u64,
    /// 各章节字数列表(文件名, 字数)
    pub chapter_words: Vec<ChapterWordCount>,
    /// 项目创建天数
    pub days_since_creation: u64,
}

/// 章节字数统计项
#[derive(Debug, Clone, serde::Serialize)]
pub struct ChapterWordCount {
    /// 文件名
    pub file_name: String,
    /// 相对路径
    pub relative_path: String,
    /// 字数
    pub word_count: u64,
}

// ===== 持久化读写(Task 1.4.2) =====

/// 获取 writing_stats.json 持久化文件路径
///
/// 输入: project_root 项目根目录
/// 输出: PathBuf 持久化文件路径
/// 流程: 拼接 <project>/.novelforge/writing_stats.json
fn get_writing_stats_path(project_root: &Path) -> PathBuf {
    project_root.join(".novelforge").join("writing_stats.json")
}

/// 加载持久化的写作统计快照
///
/// 输入: project_path 项目根目录路径
/// 输出: Result<WritingStatsSnapshot, AppError> 快照数据
/// 流程:
///   1. 拼接 writing_stats.json 路径
///   2. 文件不存在时返回默认空快照
///   3. 读取并反序列化 JSON
///   4. 反序列化失败时返回默认空快照(容错,避免历史脏数据阻塞)
pub fn load_writing_stats(project_path: &Path) -> Result<WritingStatsSnapshot, AppError> {
    let path = get_writing_stats_path(project_path);
    if !path.exists() {
        return Ok(WritingStatsSnapshot::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| AppError::io_error(e, "读取 writing_stats.json 失败"))?;
    // 反序列化失败容错: 返回默认空快照,避免历史脏数据阻塞统计
    let snapshot: WritingStatsSnapshot = serde_json::from_str(&content)
        .unwrap_or_else(|_| WritingStatsSnapshot::default());
    Ok(snapshot)
}

/// 保存写作统计快照(原子写入)
///
/// 输入:
///   project_path - 项目根目录路径
///   snapshot - 快照数据(函数内会更新 last_updated)
/// 输出: Result<(), AppError> 保存结果
/// 流程:
///   1. 更新 last_updated 为当前时间
///   2. 拼接文件路径,确保父目录存在
///   3. 序列化为 pretty JSON
///   4. 原子写入:先写 .json.tmp,再 rename 替换
pub fn save_writing_stats(
    project_path: &Path,
    snapshot: &mut WritingStatsSnapshot,
) -> Result<(), AppError> {
    snapshot.last_updated = chrono::Local::now().to_rfc3339();

    let path = get_writing_stats_path(project_path);
    // 确保父目录存在(兼容首次创建项目的场景)
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AppError::io_error(e, "创建 writing_stats.json 父目录失败"))?;
    }

    let json = serde_json::to_string_pretty(snapshot)
        .map_err(|e| AppError::serialize_error(e, "序列化 writing_stats.json 失败"))?;

    // 原子写入:先写临时文件,再 rename 替换,防止写入中途崩溃导致 JSON 损坏
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &json)
        .map_err(|e| AppError::io_error(e, "写入 writing_stats.json 临时文件失败"))?;
    fs::rename(&tmp_path, &path).map_err(|e| {
        // rename 失败时清理临时文件,避免残留
        let _ = fs::remove_file(&tmp_path);
        AppError::io_error(e, "替换 writing_stats.json 失败")
    })?;
    Ok(())
}

// ===== 文件 mtime 检测 =====

/// 获取文件 mtime 的毫秒时间戳
///
/// 输入: path 文件路径
/// 输出: Option<u64> 毫秒时间戳,获取失败返回 None
/// 流程: 调用 std::fs::metadata 获取 modified 时间,转换为毫秒
fn get_file_mtime_millis(path: &Path) -> Option<u64> {
    let metadata = fs::metadata(path).ok()?;
    let modified: SystemTime = metadata.modified().ok()?;
    let duration = modified.duration_since(SystemTime::UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as u64)
}

/// 计算相对项目根的相对路径(正斜杠格式)
///
/// 输入:
///   project_root - 项目根目录
///   abs_path - 文件绝对路径
/// 输出: String 相对路径字符串(正斜杠格式)
fn relative_to_project_forward_slash(project_root: &Path, abs_path: &Path) -> String {
    abs_path
        .strip_prefix(project_root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| abs_path.to_string_lossy().replace('\\', "/"))
}

// ===== Task 1.8: ProjectMeta 目录配置加载 =====

/// 项目目录扫描配置(Task 1.8)
///
/// 从 ProjectMeta 提取的目录扫描配置,解耦 ProjectMeta 与扫描逻辑
/// ProjectMeta 读取失败或字段缺失时,各字段取默认值,保证旧项目兼容
struct ProjectDirConfig {
    /// 设定库扫描目录列表(空时由调用方回退到 CODEX_DIRS 默认值)
    codex_dirs: Vec<String>,
    /// 大纲目录名(默认 "大纲")
    outline_dir: String,
    /// 正文目录名(默认 "正文")
    manuscript_dir: String,
}

/// 加载项目目录扫描配置(Task 1.8)
///
/// 输入: project_root 项目根目录
/// 输出: ProjectDirConfig 目录配置(ProjectMeta 读取失败时取默认值)
/// 流程:
///   1. 调用 read_project_meta 读取 ProjectMeta
///   2. 读取失败时返回全默认配置(不影响统计功能)
///   3. 成功时提取 codex_dirs / outline_dir / manuscript_dir 字段
///      (这些字段在 ProjectMeta 中已有 #[serde(default)],无需重复默认值处理)
fn load_project_dir_config(project_root: &Path) -> ProjectDirConfig {
    match read_project_meta(project_root) {
        Ok(meta) => ProjectDirConfig {
            codex_dirs: meta.codex_dirs,
            outline_dir: meta.outline_dir,
            manuscript_dir: meta.manuscript_dir,
        },
        Err(_) => {
            // 旧项目或元数据损坏: 回退到默认目录名,保证统计功能可用
            ProjectDirConfig {
                codex_dirs: Vec::new(),
                outline_dir: "大纲".to_string(),
                manuscript_dir: "正文".to_string(),
            }
        }
    }
}

// ===== 增量扫描实现 =====

/// 收集正文章节文件列表(相对路径 -> 绝对路径)
///
/// 输入:
///   manuscript_dir - 正文目录路径
///   project_root - 项目根目录
/// 输出: Vec<(String 相对路径, PathBuf 绝对路径)> 章节文件列表
/// 流程: 递归遍历正文目录,收集所有支持文档文件
fn collect_chapter_files(
    manuscript_dir: &Path,
    project_root: &Path,
) -> Vec<(String, PathBuf)> {
    let mut files = Vec::new();
    collect_chapter_files_recursive(manuscript_dir, project_root, &mut files);
    files
}

/// 递归收集章节文件(内部辅助)
fn collect_chapter_files_recursive(
    dir: &Path,
    project_root: &Path,
    files: &mut Vec<(String, PathBuf)>,
) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_chapter_files_recursive(&path, project_root, files);
            } else if is_indexable_file(&path) {
                let rel = relative_to_project_forward_slash(project_root, &path);
                files.push((rel, path));
            }
        }
    }
}

/// 增量扫描章节文件,更新快照
///
/// 输入:
///   project_root - 项目根目录
///   snapshot - 可变快照引用(函数内会更新 chapter_words / chapter_mtimes / manuscript_words)
///   manuscript_dir_name - 正文目录名(Task 1.8,从 ProjectMeta 读取,默认 "正文")
/// 输出: Vec<ChapterWordCount> 章节字数列表(用于返回前端)
/// 流程:
///   1. 拼接正文目录路径(使用传入的目录名,而非硬编码 "正文")
///   2. 收集正文章节文件列表
///   3. 对每个文件检测 mtime:
///      - mtime 未变化且快照中有缓存: 直接复用缓存的字数
///      - mtime 变化或快照无缓存: 重新读取文件计算字数
///   4. 清理快照中已不存在的章节记录(章节被删除)
///   5. 重新计算 manuscript_words(所有章节字数之和)
///   6. 返回章节字数列表
fn incremental_scan_chapters(
    project_root: &Path,
    snapshot: &mut WritingStatsSnapshot,
    manuscript_dir_name: &str,
) -> Vec<ChapterWordCount> {
    let manuscript_dir = project_root.join(manuscript_dir_name);
    if !manuscript_dir.exists() {
        // 正文目录不存在,清空章节缓存
        snapshot.chapter_words.clear();
        snapshot.chapter_mtimes.clear();
        snapshot.manuscript_words = 0;
        return Vec::new();
    }

    let current_files = collect_chapter_files(&manuscript_dir, project_root);

    // 收集当前所有章节相对路径,用于后续清理已删除章节
    let mut current_rels: std::collections::HashSet<String> = std::collections::HashSet::new();

    let mut chapter_words_list: Vec<ChapterWordCount> = Vec::new();
    let mut manuscript_total: u64 = 0;

    for (rel_path, abs_path) in &current_files {
        current_rels.insert(rel_path.clone());

        let current_mtime = get_file_mtime_millis(abs_path);
        let cached_mtime = snapshot.chapter_mtimes.get(rel_path).copied();
        let need_rescan = current_mtime.is_none()
            || cached_mtime.is_none()
            || current_mtime != cached_mtime;

        let file_name = abs_path
            .file_stem()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let word_count = if need_rescan {
            // 文件变化或无缓存: 重新读取计算
            let words = compute_file_word_count(abs_path);
            // 更新缓存
            snapshot.chapter_words.insert(rel_path.clone(), words);
            if let Some(mtime) = current_mtime {
                snapshot.chapter_mtimes.insert(rel_path.clone(), mtime);
            }
            words
        } else {
            // mtime 未变化且有缓存: 直接复用
            *snapshot.chapter_words.get(rel_path).unwrap_or(&0)
        };

        manuscript_total += word_count;
        chapter_words_list.push(ChapterWordCount {
            file_name,
            relative_path: rel_path.clone(),
            word_count,
        });
    }

    // 清理已删除章节的缓存(快照中有但当前文件列表中没有的)
    snapshot.chapter_words.retain(|k, _| current_rels.contains(k));
    snapshot.chapter_mtimes.retain(|k, _| current_rels.contains(k));

    // 更新正文字数总和
    snapshot.manuscript_words = manuscript_total;

    chapter_words_list
}

/// 计算单个文件的字数
///
/// 输入: file_path 文件路径
/// 输出: u64 字数
/// 流程:
///   1. 读取文件内容
///   2. 通过 text_extractor 提取纯文本(剥离 HTML/ProseMirror JSON 结构)
///   3. 调用 word_count::count_words 统计字数
fn compute_file_word_count(file_path: &Path) -> u64 {
    let content = match fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => return 0,
    };
    let file_name = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let format = text_extractor::detect_format(&file_name, &content);
    let plain = text_extractor::extract_plain_text(&content, format);
    crate::word_count::count_words(&plain)
}

// ===== 设定/大纲字数扫描(全量,仅初次或失效时计算) =====

/// 统计设定目录字数(Task 1.8: 使用 ProjectMeta.codex_dirs 配置)
///
/// 输入:
///   project_root - 项目根目录
///   codex_dirs - 设定库扫描目录列表(从 ProjectMeta 读取,空时回退到默认列表)
/// 输出: u64 设定字数总和
/// 流程: 遍历配置的 codex_dirs,统计字数
/// 说明: 设定字数不参与增量更新,每次调用时全量扫描(设定文件数量通常较少)
fn compute_setting_words(project_root: &Path, codex_dirs: &[String]) -> u64 {
    let mut total: u64 = 0;
    // Task 1.8: codex_dirs 为空时回退到默认列表(兼容旧项目)
    let default_dirs: Vec<String> = if codex_dirs.is_empty() {
        vec![
            "角色".to_string(),
            "世界观".to_string(),
            "名词".to_string(),
            "时间线".to_string(),
        ]
    } else {
        codex_dirs.iter().filter(|d| !d.is_empty()).cloned().collect()
    };
    for dir_name in &default_dirs {
        let dir = project_root.join(dir_name);
        if dir.exists() {
            count_dir_words(&dir, &mut total);
        }
    }
    total
}

/// 统计大纲目录字数(Task 1.8: 使用 ProjectMeta.outline_dir 配置)
///
/// 输入:
///   project_root - 项目根目录
///   outline_dir_name - 大纲目录名(从 ProjectMeta 读取,默认 "大纲")
/// 输出: u64 大纲字数总和
fn compute_outline_words(project_root: &Path, outline_dir_name: &str) -> u64 {
    let mut total: u64 = 0;
    let outline_dir = project_root.join(outline_dir_name);
    if outline_dir.exists() {
        count_dir_words(&outline_dir, &mut total);
    }
    total
}

// ===== Tauri 命令 =====

/// 获取项目写作统计信息(Task 1.4.3: 优先读取持久化数据)
///
/// 输入: project_path 项目路径
/// 输出: Result<WritingStats, AppError> 统计信息
/// 流程:
///   1. 校验项目路径
///   2. 加载持久化快照 writing_stats.json
///   3. 增量扫描正文章节(检测 mtime 变化,仅扫描有变化的章节)
///   4. 全量扫描设定/大纲字数(数量少,无需增量)
///   5. 统计总文件数
///   6. 计算项目创建天数
///   7. 保存更新后的快照(原子写入)
///   8. 返回完整统计信息
#[tauri::command]
pub fn get_writing_stats(project_path: String) -> Result<WritingStats, AppError> {
    let root = validate_project_path(&project_path)?;

    // Task 1.8: 加载项目目录扫描配置(从 ProjectMeta 读取,失败时取默认值)
    let dir_config = load_project_dir_config(&root);

    // 加载持久化快照(文件不存在返回默认空快照)
    let mut snapshot = load_writing_stats(&root)?;

    // 增量扫描章节(仅扫描 mtime 变化的章节,更新 snapshot.chapter_words / manuscript_words)
    // Task 1.8: 使用 ProjectMeta.manuscript_dir 配置的正文目录名
    let mut chapter_words = incremental_scan_chapters(&root, &mut snapshot, &dir_config.manuscript_dir);
    // 按字数降序排序(前端展示用)
    chapter_words.sort_by_key(|c| std::cmp::Reverse(c.word_count));

    // 全量扫描设定/大纲字数(数量少,无需增量)
    // Task 1.8: 使用 ProjectMeta.codex_dirs / outline_dir 配置的目录名
    snapshot.setting_words = compute_setting_words(&root, &dir_config.codex_dirs);
    snapshot.outline_words = compute_outline_words(&root, &dir_config.outline_dir);

    // 统计总文件数
    let mut total_files: u64 = 0;
    count_files_recursive(&root, &mut total_files);

    // 计算创建天数
    let meta_path = root.join(".novelforge").join("project.json");
    let days_since_creation = if let Ok(content) = fs::read_to_string(&meta_path) {
        if let Ok(meta) = serde_json::from_str::<crate::project_template::ProjectMeta>(&content) {
            if let Ok(created) = chrono::DateTime::parse_from_rfc3339(&meta.created_at) {
                let now = chrono::Local::now();
                (now.signed_duration_since(created).num_days().max(0)) as u64
            } else {
                0
            }
        } else {
            0
        }
    } else {
        0
    };

    // 保存更新后的快照(原子写入)
    if let Err(e) = save_writing_stats(&root, &mut snapshot) {
        // 保存失败不阻塞返回,仅记录日志
        eprintln!("[writing_stats] 保存快照失败(不阻塞返回): {}", e);
    }

    Ok(WritingStats {
        total_words: snapshot.manuscript_words + snapshot.setting_words + snapshot.outline_words,
        total_chapters: chapter_words.len() as u64,
        total_files,
        manuscript_words: snapshot.manuscript_words,
        setting_words: snapshot.setting_words,
        outline_words: snapshot.outline_words,
        chapter_words,
        days_since_creation,
    })
}

/// 增量更新单章字数(Task 1.4.4)
///
/// 章节保存时由前端调用,增量更新 WritingStats 快照
///
/// 输入:
///   project_path - 项目根目录路径
///   chapter_id - 章节标识(相对路径,如 "正文/第一章.pmd")
///   word_count - 章节字数
/// 输出: Result<(), AppError> 更新结果
/// 流程:
///   1. 校验项目路径
///   2. 加载持久化快照
///   3. 计算旧字数与新字数的差值
///   4. 更新 chapter_words 中的章节字数
///   5. 同步更新 manuscript_words(累加差值)
///   6. 更新 chapter_mtimes(获取文件 mtime,若文件存在)
///   7. 原子写入保存快照
#[tauri::command]
pub fn update_chapter_word_count(
    project_path: String,
    chapter_id: String,
    word_count: u64,
) -> Result<(), AppError> {
    let root = validate_project_path(&project_path)?;

    let mut snapshot = load_writing_stats(&root)?;

    // 计算差值(用于累加更新 manuscript_words)
    let old_count = snapshot.chapter_words.get(&chapter_id).copied().unwrap_or(0);
    let diff = word_count as i64 - old_count as i64;
    // 累加差值到正文字数总和(i64 转换避免下溢)
    let new_manuscript = (snapshot.manuscript_words as i64 + diff).max(0) as u64;
    snapshot.manuscript_words = new_manuscript;

    // 更新章节字数
    snapshot.chapter_words.insert(chapter_id.clone(), word_count);

    // 同步更新 mtime(若文件存在)
    let abs_path = root.join(&chapter_id);
    if let Some(mtime) = get_file_mtime_millis(&abs_path) {
        snapshot.chapter_mtimes.insert(chapter_id, mtime);
    }

    save_writing_stats(&root, &mut snapshot)
}

// ===== 内部工具函数 =====

/// 递归统计目录下文件字数
/// 输入: dir 目录路径, total 累计字数
/// 输出: 无
/// 流程: 遍历目录,对支持文档统计字数(接入 text_extractor 统一层)
fn count_dir_words(dir: &Path, total: &mut u64) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                count_dir_words(&path, total);
            } else if is_indexable_file(&path) {
                *total += compute_file_word_count(&path);
            }
        }
    }
}

/// 递归统计目录下文件数
/// 输入: dir 目录路径, total 累计文件数
/// 输出: 无
/// 流程: 遍历目录,统计支持文档数量(.txt/.pmd/.html/.htm)
fn count_files_recursive(dir: &Path, total: &mut u64) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            if path.is_dir() {
                count_files_recursive(&path, total);
            } else if is_indexable_file(&path) {
                *total += 1;
            }
        }
    }
}
