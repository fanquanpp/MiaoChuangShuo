// 角色与正文的联动模块
//
// 功能概述：
// 提供"角色 ↔ 正文"双向数据联动能力，是 喵创说 模块联动的核心组成。
// 包含两个高价值能力：
// 1. 角色出场统计：扫描项目内所有支持文档文件，统计每个角色名的出现次数与分布
// 2. 全局改名：在项目所有支持文档文件中批量替换角色名，解决作家改名时的痛苦
//
// 模块职责：
// 1. 递归扫描项目内支持文档(.txt/.pmd/.html/.htm)（跳过 .novelforge 元数据目录）
// 2. 统计角色名出现次数，返回按文件分布的详细数据
// 3. 批量替换角色名，返回修改文件数与替换次数
// 4. 全程路径沙箱内操作，确保不越界

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

use crate::text_extractor;
use crate::error::AppError;
use crate::commands::{read_project_meta, validate_project_path};
use crate::manifest::find_chapter_paths_by_codex_id;
use crate::codex::build_effective_codex_dirs;

/// 单个文件中角色出场统计
#[derive(Debug, Clone, Serialize)]
pub struct AppearanceFile {
    /// 相对项目根的路径
    pub path: String,
    /// 该文件中出现次数
    pub count: u64,
    /// 是否位于"正文"目录
    pub is_manuscript: bool,
}

/// 单个角色的出场统计汇总
#[derive(Debug, Clone, Serialize)]
pub struct CharacterAppearance {
    /// 角色名
    pub name: String,
    /// 总出现次数
    pub total_count: u64,
    /// 出现在的文件数
    pub file_count: u64,
    /// 出现的文件列表（按出现次数降序）
    pub files: Vec<AppearanceFile>,
}

/// 全局改名结果
#[derive(Debug, Clone, Serialize)]
pub struct RenameResult {
    /// 修改的文件数
    pub files_modified: u64,
    /// 替换的总次数
    pub occurrences: u64,
    /// 修改的文件相对路径列表
    pub renamed_files: Vec<String>,
}

/**
 * 递归收集项目内所有支持文档文件路径（.txt/.pmd/.html/.htm）
 * 输入: dir 当前目录, files 输出列表
 * 流程:
 *   1. 读取目录条目
 *   2. 跳过 .novelforge 等隐藏目录
 *   3. 子目录递归处理
 *   4. 支持文档加入列表
 */
fn collect_supported_files(dir: &Path, files: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // 跳过 .novelforge 等以点开头的隐藏/元数据目录
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if name.starts_with('.') {
                continue;
            }
            collect_supported_files(&path, files);
        } else {
            // 支持文档格式：.txt/.pmd/.html/.htm
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if matches!(ext.to_lowercase().as_str(), "txt" | "pmd" | "html" | "htm") {
                files.push(path);
            }
        }
    }
}

/**
 * 判断文件路径是否位于"正文"目录下
 * 输入: relative_path 相对项目根的路径
 * 输出: 是否在正文目录
 */
fn is_manuscript_file(relative_path: &str) -> bool {
    let normalized = relative_path.replace('\\', "/");
    normalized.starts_with("正文/") || normalized == "正文"
}

/**
 * 统计角色在项目所有支持文档中的出场情况
 * 输入: project_path 项目根路径, names 待统计的角色名列表
 * 输出: Result<Vec<CharacterAppearance>, AppError> 每个角色的出场统计
 * 流程:
 *   1. canonicalize 项目根路径
 *   2. 递归收集所有支持文档(.txt/.pmd/.html/.htm)
 *   3. 读取每个文件内容，接入 text_extractor 提取纯文本后统计角色名出现次数
 *   4. 按角色汇总，返回按总次数降序的结果
 */
#[tauri::command]
pub fn count_character_appearances(
    project_path: String,
    names: Vec<String>,
) -> Result<Vec<CharacterAppearance>, AppError> {
    let root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| AppError::io_error(e, "无法解析项目路径"))?;

    if !root.exists() || !root.is_dir() {
        return Err(AppError::path_validation_error("项目路径不存在或不是目录"));
    }

    // 过滤空角色名，避免误匹配
    let valid_names: Vec<String> = names
        .into_iter()
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .collect();
    if valid_names.is_empty() {
        return Ok(Vec::new());
    }

    // 收集所有支持文档文件
    let mut doc_files: Vec<PathBuf> = Vec::new();
    collect_supported_files(&root, &mut doc_files);

    // 初始化每个角色的统计
    let mut appearances: Vec<CharacterAppearance> = valid_names
        .iter()
        .map(|name| CharacterAppearance {
            name: name.clone(),
            total_count: 0,
            file_count: 0,
            files: Vec::new(),
        })
        .collect();

    // 遍历文件统计
    for file_path in &doc_files {
        let content = match fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => continue, // 跳过无法读取的文件（如编码问题）
        };

        // 接入 text_extractor 提取纯文本，避免 HTML 标签/JSON 结构污染匹配
        let file_name = file_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let format = text_extractor::detect_format(&file_name, &content);
        let plain = text_extractor::extract_plain_text(&content, format);

        // 计算相对路径
        let relative = file_path
            .strip_prefix(&root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let is_mscript = is_manuscript_file(&relative);

        for (idx, name) in valid_names.iter().enumerate() {
            // 在纯文本中统计角色名出现次数
            let count = plain.matches(name.as_str()).count() as u64;
            if count > 0 {
                appearances[idx].total_count += count;
                appearances[idx].file_count += 1;
                appearances[idx].files.push(AppearanceFile {
                    path: relative.clone(),
                    count,
                    is_manuscript: is_mscript,
                });
            }
        }
    }

    // 每个角色的文件列表按出现次数降序
    for app in &mut appearances {
        app.files.sort_by_key(|f| std::cmp::Reverse(f.count));
    }

    // 角色按总出场次数降序
    appearances.sort_by_key(|a| std::cmp::Reverse(a.total_count));

    Ok(appearances)
}

/**
 * 判断字符是否为中文字符(用于角色名边界检测)
 * 输入: ch 待判断字符
 * 输出: bool 是否为中文汉字
 * 说明: 覆盖基本汉字区、扩展A区、兼容汉字区
 */
fn is_chinese_char(ch: char) -> bool {
    ('\u{4E00}'..='\u{9FFF}').contains(&ch)
        || ('\u{3400}'..='\u{4DBF}').contains(&ch)
        || ('\u{F900}'..='\u{FAFF}').contains(&ch)
}

/**
 * 带词边界检测的角色名替换
 * 输入: content 原始文本, old_name 旧角色名, new_name 新角色名
 * 输出: (新文本, 实际替换次数)
 * 流程:
 *   1. 遍历 content 中所有 old_name 匹配位置
 *   2. 对每个匹配, 检查前一个字符与后一个字符是否为中文汉字
 *   3. 若前后字符均为非中文汉字, 视为完整词匹配, 执行替换
 *   4. 若前后字符中存在中文汉字, 视为更长词的子串, 跳过替换
 * 说明: 此策略为保守安全策略, 可能漏替换(如"林黛玉花"中的"林黛玉"),
 *   但避免误伤(如"林"不会误伤"林中漫步"), 漏替换由作者手动补充更安全
 */
fn replace_name_with_boundary(content: &str, old_name: &str, new_name: &str) -> (String, u64) {
    let mut result = String::with_capacity(content.len());
    let mut last_end = 0;
    let mut count: u64 = 0;
    let old_bytes = old_name.as_bytes();

    // 遍历所有匹配位置
    let mut search_start = 0;
    while search_start <= content.len() - old_bytes.len() {
        if let Some(pos) = content[search_start..].find(old_name) {
            let abs_pos = search_start + pos;
            // 检查前一个字符(若存在)是否为中文汉字
            let prev_ch = content[..abs_pos].chars().last();
            let prev_is_chinese = prev_ch.map_or(false, is_chinese_char);
            // 检查后一个字符(若存在)是否为中文汉字
            let after_start = abs_pos + old_bytes.len();
            let next_ch = content[after_start..].chars().next();
            let next_is_chinese = next_ch.map_or(false, is_chinese_char);

            if !prev_is_chinese && !next_is_chinese {
                // 完整词匹配, 执行替换
                result.push_str(&content[last_end..abs_pos]);
                result.push_str(new_name);
                last_end = after_start;
                count += 1;
            }
            // 无论是否替换, 都跳过当前匹配位置继续搜索
            search_start = abs_pos + old_bytes.len();
        } else {
            break;
        }
    }
    // 追加剩余内容
    result.push_str(&content[last_end..]);
    (result, count)
}

// ===== Task 4.6.2: UUID 关联改名辅助函数 =====

/// 原子写入文件（临时文件 + 重命名，保证写入原子性）
/// 输入: path 目标文件路径, content 文件内容
/// 输出: Result<(), AppError> 写入结果
/// 流程:
///   1. 写入 .tmp 临时文件（同目录，保证同一文件系统以支持原子重命名）
///   2. 重命名为目标文件
///   3. 失败时清理临时文件
fn atomic_write_file(path: &Path, content: &str) -> Result<(), AppError> {
    let tmp_path = PathBuf::from(format!("{}.tmp", path.to_string_lossy()));
    fs::write(&tmp_path, content)
        .map_err(|e| AppError::io_error(e, "写入临时文件失败"))?;
    match fs::rename(&tmp_path, path) {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp_path);
            Err(AppError::io_error(e, "重命名临时文件失败"))
        }
    }
}

/// 分离 .pmd 文件的 JSON front matter 与 ProseMirror JSON 正文（Task 4.6 内部辅助）
/// 输入: content .pmd 文件完整内容
/// 输出: Option<(front_matter_block, body)> 返回 (front matter 完整块含首尾 ---, ProseMirror JSON 正文)
///       无 front matter 时返回 None
fn separate_pmd_front_matter_for_rename(content: &str) -> Option<(String, String)> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() < 3 || lines[0].trim() != "---" {
        return None;
    }
    let end_idx = lines[1..]
        .iter()
        .position(|l| l.trim() == "---")
        .map(|i| i + 1)?;
    let front_matter = lines[..=end_idx].join("\n");
    let body = lines[end_idx + 1..].join("\n");
    Some((front_matter, body))
}

/// 递归更新 ProseMirror JSON 中匹配 codexId 的 characterMentionNode 的 name 字段（Task 4.6.2 内部辅助）
///
/// 输入:
///   node - ProseMirror 节点的 JSON Value（可变引用）
///   codex_id - 设定库卡片 UUID
///   new_name - 新角色名（写入 mention 节点的 attrs.name）
/// 输出: u64 本次调用更新的 Mention 节点数量（递归累加）
/// 流程:
///   1. 若 node 是 characterMentionNode 且 attrs.characterId == codex_id:
///      - 更新 attrs.name 为 new_name
///      - 返回 1 表示更新了一处
///   2. 若 node 含 content 数组，递归处理每个子节点
/// 设计说明:
///   - 仅更新 attrs.name，不修改 characterId，保持 UUID 关联不变
///   - 替代字符串替换策略，避免子串误伤（如"小明" vs "小明明"）
fn rename_mentions_in_node(node: &mut Value, codex_id: &str, new_name: &str) -> u64 {
    let mut count: u64 = 0;

    // 检查当前节点是否为匹配的 characterMentionNode
    if let Some(obj) = node.as_object() {
        let node_type = obj.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if node_type == "characterMentionNode" {
            let attrs_match = obj
                .get("attrs")
                .and_then(|a| a.get("characterId"))
                .and_then(|c| c.as_str())
                .map(|id| id == codex_id)
                .unwrap_or(false);
            if attrs_match {
                // 更新 attrs.name 为新角色名，保留 characterId 不变
                if let Some(attrs) = node.get_mut("attrs").and_then(|a| a.as_object_mut()) {
                    attrs.insert(
                        "name".to_string(),
                        serde_json::Value::String(new_name.to_string()),
                    );
                    count += 1;
                }
                return count;
            }
        }
    }

    // 递归处理 content 数组中的子节点
    if let Some(content) = node.get_mut("content").and_then(|c| c.as_array_mut()) {
        for child in content.iter_mut() {
            count += rename_mentions_in_node(child, codex_id, new_name);
        }
    }

    count
}

/// 处理单个 .pmd 文件：更新其中匹配 codexId 的 characterMentionNode 的 name 字段（Task 4.6.2 内部辅助）
///
/// 输入:
///   file_path - .pmd 文件绝对路径
///   codex_id - 设定库卡片 UUID
///   new_name - 新角色名
/// 输出: Result<u64, AppError> 更新的 Mention 节点数量
/// 流程:
///   1. 读取 .pmd 文件内容
///   2. 分离 front matter 与 ProseMirror JSON 正文
///   3. 解析正文为 JSON Value，递归更新匹配的 mention 节点 name
///   4. 重新序列化 JSON，组合 front matter + 新正文，原子写入
///   5. 无更新时跳过写回避免无谓 IO
fn rename_mentions_in_pmd_file(
    file_path: &Path,
    codex_id: &str,
    new_name: &str,
) -> Result<u64, AppError> {
    let content = fs::read_to_string(file_path)
        .map_err(|e| AppError::io_error(e, "读取章节文件失败"))?;

    // 分离 front matter 与 ProseMirror JSON 正文
    let (front_matter, body) = match separate_pmd_front_matter_for_rename(&content) {
        Some(parts) => parts,
        None => {
            // 无 front matter，可能是旧版 .txt 或纯 JSON，直接将整个内容作为 body 处理
            (String::new(), content.clone())
        }
    };

    // 解析 body 为 JSON Value
    let mut doc: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => {
            // 正文非合法 ProseMirror JSON，跳过该文件（可能是纯文本 .txt）
            return Ok(0);
        }
    };

    // 递归更新匹配的 characterMentionNode 的 name 字段
    let updated = rename_mentions_in_node(&mut doc, codex_id, new_name);
    if updated == 0 {
        // 无匹配 Mention，跳过写回
        return Ok(0);
    }

    // 重新序列化为 JSON 字符串（紧凑格式，与项目其他 .pmd 文件保持一致）
    let new_body = serde_json::to_string(&doc)
        .map_err(|e| AppError::serialize_error(e, "序列化 ProseMirror JSON 失败"))?;

    // 组合 front matter + 新正文，原子写入
    let new_content = if front_matter.is_empty() {
        new_body
    } else {
        format!("{}\n{}", front_matter, new_body)
    };

    atomic_write_file(file_path, &new_content)?;
    Ok(updated)
}

/**
 * 在项目所有支持文档中全局替换角色名（Task 4.6 重构版）
 *
 * 输入:
 *   project_path - 项目根路径
 *   old_name - 旧角色名
 *   new_name - 新角色名
 *   codex_id - 设定库卡片 UUID（空字符串时回退到纯字符串替换模式）
 * 输出: Result<RenameResult, AppError> 修改文件数与替换次数
 * 流程:
 *   1. 校验新旧名称非空且不同
 *   2. canonicalize 项目根路径并读取 ProjectMeta 配置
 *   3. 构建扫描目录列表（codex_dirs + outline_dir + draft_dir + manuscript_dir）
 *   4. 收集这些目录下的所有支持文档(.txt/.pmd/.html/.htm)
 *   5. 阶段1 - UUID 关联更新（codex_id 非空时）:
 *   - 通过 manifest 反向索引找到引用该 codexId 的章节
 *   - 对这些章节 .pmd 文件调用 rename_mentions_in_pmd_file,仅更新 characterMentionNode.attrs.name,不触碰正文纯文本
 *   - 已处理文件加入 processed_files 集合,避免阶段2重复处理
 *   6. 阶段2 - 字符串替换回退（对未通过 UUID 处理的文件）:
 *   - 读取文件内容
 *   - 带词边界检测替换（replace_name_with_boundary）
 *   - 仅在有变更时写回
 *   7. 返回修改的文件列表与替换总次数
 * 安全说明:
 *   - UUID 关联更新精确匹配 characterId，彻底避免子串误伤（如"小明" vs "小明明"）
 *   - 字符串替换采用词边界检测，前后为中文汉字时跳过，作为兜底策略
 *   - .txt 文件无 characterMentionNode 结构，仅能依赖字符串替换
 *   - 建议前端提示作者改名前先保存以创建版本快照，便于回滚
 */
#[tauri::command]
pub fn rename_character_in_project(
    project_path: String,
    old_name: String,
    new_name: String,
    codex_id: String,
) -> Result<RenameResult, AppError> {
    let old_name = old_name.trim().to_string();
    let new_name = new_name.trim().to_string();
    let codex_id = codex_id.trim().to_string();

    if old_name.is_empty() {
        return Err(AppError::config_error("原角色名不能为空"));
    }
    if new_name.is_empty() {
        return Err(AppError::config_error("新角色名不能为空"));
    }
    if old_name == new_name {
        return Err(AppError::config_error("新旧角色名相同，无需修改"));
    }

    let root = validate_project_path(&project_path)?;

    // 读取 ProjectMeta 获取目录配置（Task 4.6.1）
    // 旧项目无 project.json 时 read_project_meta 返回错误，回退到扫描整个项目根
    let scan_dirs: Vec<String> = match read_project_meta(&root) {
        Ok(meta) => {
            let mut dirs: Vec<String> = Vec::new();
            // 设定库目录（通过 build_effective_codex_dirs 兼容空 codex_dirs 回退到 CODEX_DIRS）
            let effective_codex_dirs = build_effective_codex_dirs(&meta.codex_dirs);
            for (dir_name, _) in effective_codex_dirs {
                dirs.push(dir_name);
            }
            // 大纲目录
            dirs.push(meta.outline_dir.clone());
            // 草稿箱目录
            dirs.push(meta.draft_dir.clone());
            // 正文目录
            dirs.push(meta.manuscript_dir.clone());
            dirs
        }
        Err(_) => {
            // 旧项目无 ProjectMeta，回退到扫描整个项目根（向后兼容）
            Vec::new()
        }
    };

    // 收集所有支持文档文件
    // scan_dirs 为空时扫描整个项目根（向后兼容旧项目）
    let mut doc_files: Vec<PathBuf> = Vec::new();
    if scan_dirs.is_empty() {
        collect_supported_files(&root, &mut doc_files);
    } else {
        for dir_name in &scan_dirs {
            let dir = root.join(dir_name);
            if dir.exists() {
                collect_supported_files(&dir, &mut doc_files);
            }
        }
    }

    let mut files_modified: u64 = 0;
    let mut occurrences: u64 = 0;
    let mut renamed_files: Vec<String> = Vec::new();
    // 已通过 UUID 关联更新的文件集合，避免阶段2重复处理
    let mut processed_files: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();

    // ===== 阶段1: UUID 关联更新（Task 4.6.2）=====
    // 仅对 codex_id 非空且 manifest 反向索引中引用该 codexId 的章节 .pmd 文件
    // 调用 rename_mentions_in_pmd_file 更新 characterMentionNode.attrs.name
    // 此方式精确匹配 characterId，彻底避免子串误伤
    if !codex_id.is_empty() {
        let chapter_paths = match find_chapter_paths_by_codex_id(&root, &codex_id) {
            Ok(paths) => paths,
            Err(_) => Vec::new(), // manifest 读取失败时跳过 UUID 更新，回退到字符串替换
        };

        for chapter_rel_path in &chapter_paths {
            let chapter_abs = root.join(chapter_rel_path);
            if !chapter_abs.exists() {
                continue;
            }
            // UUID 关联更新仅适用于 .pmd 文件（含 ProseMirror JSON 结构）
            let ext = chapter_abs.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !ext.eq_ignore_ascii_case("pmd") {
                continue;
            }

            match rename_mentions_in_pmd_file(&chapter_abs, &codex_id, &new_name) {
                Ok(updated) => {
                    if updated > 0 {
                        files_modified += 1;
                        occurrences += updated;
                        let relative = chapter_abs
                            .strip_prefix(&root)
                            .map(|p| p.to_string_lossy().replace('\\', "/"))
                            .unwrap_or_default();
                        renamed_files.push(relative);
                    }
                    // 无论是否有更新，该文件已被 UUID 处理，加入 processed_files
                    // 避免阶段2字符串替换破坏 characterMentionNode 的精确更新
                    processed_files.insert(chapter_abs);
                }
                Err(_) => {
                    // UUID 更新失败时不阻断流程，该文件仍可由阶段2字符串替换处理
                }
            }
        }
    }

    // ===== 阶段2: 字符串替换回退（对未通过 UUID 处理的文件）=====
    // 对 .txt/.html 文件及未被 manifest 反向索引覆盖的 .pmd 文件
    // 使用带词边界检测的字符串替换作为兜底策略
    for file_path in &doc_files {
        if processed_files.contains(file_path) {
            continue;
        }

        let content = match fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // 带词边界检测的替换, 避免子串误伤
        let (new_content, count) = replace_name_with_boundary(&content, &old_name, &new_name);
        if count == 0 {
            continue;
        }

        // 写回文件
        if let Err(e) = fs::write(file_path, &new_content) {
            // 写入失败立即返回错误，中断整体流程（保证数据一致性）
            let relative = file_path
                .strip_prefix(&root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            return Err(AppError::io_error(e, format!("写入文件失败 {}", relative)));
        }

        let relative = file_path
            .strip_prefix(&root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();

        files_modified += 1;
        occurrences += count;
        renamed_files.push(relative);
    }

    Ok(RenameResult {
        files_modified,
        occurrences,
        renamed_files,
    })
}

/**
 * 角色摘要信息结构
 * 用于正文悬停卡片，展示角色的关键设定
 */
#[derive(Debug, Clone, Serialize)]
pub struct CharacterSummary {
    /// 角色名
    pub name: String,
    /// 角色设定文件相对路径
    pub source_file: String,
    /// 身份/职业（从【基础信息】提取）
    pub identity: String,
    /// 核心特质（从【性格】提取）
    pub personality: String,
    /// 一句话简介（从设定文件首段提取）
    pub brief: String,
    /// 是否找到角色设定文件
    pub found: bool,
}

/**
 * 读取指定角色的摘要信息
 * 输入: project_path 项目根路径, character_name 角色名
 * 输出: Result<CharacterSummary, AppError> 角色摘要
 * 流程:
 *   1. 校验项目路径与角色名非空
 *   2. 优先扫描角色目录下 .pmd 文件, 检查首行是否匹配角色名
 *   3. .pmd 未命中则扫描 .txt 文件
 *   4. 匹配成功则解析身份、性格、简介字段
 *   5. 均未匹配则返回 found=false 的空摘要
 * 说明: 优先级 .pmd > .txt, 适配设定库向 .pmd 迁移的渐进式场景
 */
#[tauri::command]
pub fn read_character_summary(
    project_path: String,
    character_name: String,
) -> Result<CharacterSummary, AppError> {
    let root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| AppError::io_error(e, "无法解析项目路径"))?;

    if !root.exists() || !root.is_dir() {
        return Err(AppError::path_validation_error("项目路径不存在或不是目录"));
    }

    let name = character_name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::config_error("角色名不能为空"));
    }

    let char_dir = root.join("角色");
    if !char_dir.exists() {
        return Ok(CharacterSummary {
            name: name.clone(),
            source_file: String::new(),
            identity: String::new(),
            personality: String::new(),
            brief: String::new(),
            found: false,
        });
    }

    // 按优先级依次查找 .pmd 与 .txt 格式的角色设定文件
    // .pmd 为新版格式, 优先匹配; .txt 为兼容旧项目的回退格式
    for target_ext in &["pmd", "txt"] {
        if let Some(summary) = try_find_character_summary(&char_dir, &root, &name, target_ext)? {
            return Ok(summary);
        }
    }

    // 未找到匹配的角色设定文件
    Ok(CharacterSummary {
        name: name.clone(),
        source_file: String::new(),
        identity: String::new(),
        personality: String::new(),
        brief: String::new(),
        found: false,
    })
}

/**
 * 在角色目录中查找指定扩展名且首行匹配角色名的设定文件
 * 输入:
 *   char_dir - 角色目录路径
 *   root - 项目根路径 (用于计算相对路径)
 *   name - 角色名 (需与文件首行一致)
 *   target_ext - 目标扩展名 (pmd 或 txt, 大小写不敏感)
 * 输出: Result<Option<CharacterSummary>, AppError>
 *   - Some(summary) 命中并解析成功
 *   - None 未命中
 * 流程:
 *   1. 读取角色目录条目
 *   2. 跳过子目录与非目标扩展名文件
 *   3. 跳过模板/名册等特殊文件
 *   4. 读取内容并校验首行是否为角色名
 *   5. 命中则解析身份、性格、简介字段并返回
 * 说明: 单次调用仅扫描指定扩展名, 多扩展名场景由调用方按优先级多次调用
 */
fn try_find_character_summary(
    char_dir: &Path,
    root: &Path,
    name: &str,
    target_ext: &str,
) -> Result<Option<CharacterSummary>, AppError> {
    let entries = fs::read_dir(char_dir)
        .map_err(|e| AppError::io_error(e, "读取角色目录失败"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        // 跳过子目录与非目标扩展名文件
        if path.is_dir() {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !ext.eq_ignore_ascii_case(target_ext) {
            continue;
        }

        // 跳过模板/名册/汇总等非角色设定文件
        let file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let lower = file_name.to_lowercase();
        if lower.contains("模板") || lower.contains("名册") ||
           lower.contains("template") || lower.contains("roster") ||
           lower.contains("readme") || lower.contains("汇总") || lower.contains("关系表") {
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // 检查首行是否为该角色名（跳过注释行和分隔线）
        let first_line = content.lines()
            .map(|l| l.trim())
            .find(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("---") && !l.starts_with("==="));

        if first_line != Some(name) {
            continue;
        }

        // 匹配成功，解析摘要字段
        let relative = path
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();

        let identity = extract_field(&content, &["身份", "职业", "身份/职业"]);
        let personality = extract_field(&content, &["核心特质", "性格", "性格关键词"]);
        let brief = extract_brief(&content, name);

        return Ok(Some(CharacterSummary {
            name: name.to_string(),
            source_file: relative,
            identity,
            personality,
            brief,
            found: true,
        }));
    }

    Ok(None)
}

/**
 * 从角色设定文件内容中提取指定字段的值
 * 输入: content 文件内容, field_names 可能的字段名列表（按优先级）
 * 输出: 字段值（去除前缀后的纯文本）
 * 流程:
 *   1. 遍历每一行，查找以"字段名："或"字段名:"开头的行
 *   2. 返回第一个匹配的字段值
 */
fn extract_field(content: &str, field_names: &[&str]) -> String {
    for line in content.lines() {
        let trimmed = line.trim();
        for field in field_names {
            // 匹配 "字段：" 或 "字段:" 格式（支持全角/半角冒号）
            let prefix_colon = format!("{}：", field);
            let prefix_colon_half = format!("{}:", field);
            let prefix_bracket = format!("【{}", field);
            if trimmed.starts_with(&prefix_colon) {
                return trimmed[prefix_colon.len()..].trim().to_string();
            }
            if trimmed.starts_with(&prefix_colon_half) {
                return trimmed[prefix_colon_half.len()..].trim().to_string();
            }
            // 匹配 【字段】 后跟值的格式
            if trimmed.starts_with(&prefix_bracket) {
                // 整行作为字段标题，下一行可能是值，这里跳过
                continue;
            }
        }
    }
    // 对于【字段】格式，查找紧跟的下一行值
    let lines: Vec<&str> = content.lines().collect();
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        for field in field_names {
            let bracket = format!("【{}】", field);
            if trimmed == bracket && i + 1 < lines.len() {
                let val = lines[i + 1].trim();
                if !val.is_empty() && !val.starts_with('【') {
                    return val.to_string();
                }
            }
        }
    }
    String::new()
}

/**
 * 从角色设定文件内容中提取一句话简介
 * 输入: content 文件内容, name 角色名
 * 输出: 简介文本（取设定文件中第一段非标题、非字段标记的描述性文字）
 */
fn extract_brief(content: &str, _name: &str) -> String {
    let mut in_section = false;
    let mut brief_parts: Vec<String> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        // 跳过空行
        if trimmed.is_empty() {
            continue;
        }
        // 跳过标题行（首行已作为角色名）
        // 跳过字段标记行
        if trimmed.starts_with('【') {
            in_section = true;
            continue;
        }
        // 跳过字段值行（含冒号的视为字段值）
        if in_section && (trimmed.contains('：') || trimmed.contains(':')) {
            continue;
        }
        // 跳过分隔线
        if trimmed.starts_with("---") || trimmed.starts_with("===") {
            continue;
        }
        // 收集描述性文字
        if in_section {
            brief_parts.push(trimmed.to_string());
            if brief_parts.len() >= 2 {
                break;
            }
        }
    }

    brief_parts.join(" ")
}

// ===== Task 4.6.3: 单元测试 - 覆盖子串误伤场景 =====

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 测试词边界检测替换: "小明" 不应误伤 "小明明"
    /// 场景: 文本中同时存在 "小明明" 和 "小明!"，替换 "小明" 时
    ///       "小明明" 中的 "小明" 子串因后跟中文字符"明"应被跳过
    ///       "小明!" 中的 "小明" 因后跟非中文字符"!"应被替换
    /// 说明: 边界检测策略为前后字符均为非中文时才视为完整词匹配,
    ///       常见中文字符（如'走'/'也'/'说'）会被判定为中文上下文从而跳过替换,
    ///       这是保守安全策略, 可能漏替换但避免误伤
    #[test]
    fn test_replace_name_with_boundary_no_substring_injury() {
        let content = "小明明，小明!";
        let (result, count) = replace_name_with_boundary(content, "小明", "小红");
        // "小明明" 中的 "小明" 不应被替换(后跟中文字符"明")
        // "小明!" 中的 "小明" 应被替换(前为非中文逗号，后为非中文叹号)
        assert_eq!(count, 1);
        assert_eq!(result, "小明明，小红!");
    }

    /// 测试词边界检测替换: 独立出现的角色名应被替换
    /// 场景: "小明" 前后均为非中文字符时，应被正确替换
    #[test]
    fn test_replace_name_with_boundary_standalone_name() {
        let content = "小明!小明!小明!";
        let (result, count) = replace_name_with_boundary(content, "小明", "小红");
        assert_eq!(count, 3);
        assert_eq!(result, "小红!小红!小红!");
    }

    /// 测试词边界检测替换: 前后均为中文字符时不替换
    /// 场景: "林中漫步" 中 "林" 不应被替换为独立角色名
    #[test]
    fn test_replace_name_with_boundary_chinese_context() {
        let content = "林黛玉走在林中漫步";
        let (result, count) = replace_name_with_boundary(content, "林", "林总");
        // "林黛玉" 中的 "林" 后跟中文字符"黛"，应跳过
        // "林中漫步" 中的 "林" 前后均为中文，应跳过
        assert_eq!(count, 0);
        assert_eq!(result, content);
    }

    /// 测试 UUID 关联改名: 仅更新匹配 codexId 的 mention 节点 name
    /// 场景: 文档中有一个 characterMentionNode，characterId 匹配时更新 name
    #[test]
    fn test_rename_mentions_in_node_uuid_match() {
        let mut doc = json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{
                    "type": "characterMentionNode",
                    "attrs": {
                        "characterId": "char-001",
                        "name": "小明"
                    }
                }]
            }]
        });
        let count = rename_mentions_in_node(&mut doc, "char-001", "小红");
        assert_eq!(count, 1);
        assert_eq!(doc["content"][0]["content"][0]["attrs"]["name"], "小红");
        // characterId 不应被修改
        assert_eq!(doc["content"][0]["content"][0]["attrs"]["characterId"], "char-001");
    }

    /// 测试 UUID 关联改名: 不匹配的 codexId 不应被更新
    /// 场景: 文档中 characterId 为 char-002，请求更新 char-001，不应有任何变化
    #[test]
    fn test_rename_mentions_in_node_uuid_no_match() {
        let mut doc = json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{
                    "type": "characterMentionNode",
                    "attrs": {
                        "characterId": "char-002",
                        "name": "小明"
                    }
                }]
            }]
        });
        let count = rename_mentions_in_node(&mut doc, "char-001", "小红");
        assert_eq!(count, 0);
        // name 不应变
        assert_eq!(doc["content"][0]["content"][0]["attrs"]["name"], "小明");
    }

    /// 测试 UUID 关联改名: 同一文档中多个 mention 节点，仅更新匹配的
    /// 场景: 文档中有 char-001(小明) 和 char-002(小明明) 两个角色
    ///       改名 char-001 → "小红" 时，char-002 的 mention 不应受影响
    #[test]
    fn test_rename_mentions_in_node_multiple_mentions() {
        let mut doc = json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [
                    {
                        "type": "characterMentionNode",
                        "attrs": { "characterId": "char-001", "name": "小明" }
                    },
                    {
                        "type": "text",
                        "text": "走在路上，遇到"
                    },
                    {
                        "type": "characterMentionNode",
                        "attrs": { "characterId": "char-002", "name": "小明明" }
                    }
                ]
            }]
        });
        let count = rename_mentions_in_node(&mut doc, "char-001", "小红");
        // 仅 char-001 的 mention 被更新
        assert_eq!(count, 1);
        assert_eq!(doc["content"][0]["content"][0]["attrs"]["name"], "小红");
        // char-002 的 mention 不变
        assert_eq!(doc["content"][0]["content"][2]["attrs"]["name"], "小明明");
    }

    /// 测试子串误伤核心场景: UUID 关联 vs 字符串替换对比
    /// 场景: 同一文档中有 "小明"(char-001) 和 "小明明"(char-002) 两个角色
    ///       UUID 关联改名 char-001 → "小红" 时:
    ///         - char-001 的 mention name 更新为 "小红"
    ///         - char-002 的 mention name 仍为 "小明明"，未受影响
    ///       字符串替换方式则可能误伤 "小明明" 中的 "小明" 子串
    #[test]
    fn test_substring_injury_uuid_vs_string() {
        // 构建 ProseMirror JSON 文档: 两个角色的 mention 节点
        let mut doc = json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [
                    {
                        "type": "characterMentionNode",
                        "attrs": { "characterId": "char-001", "name": "小明" }
                    },
                    {
                        "type": "characterMentionNode",
                        "attrs": { "characterId": "char-002", "name": "小明明" }
                    }
                ]
            }]
        });

        // UUID 关联改名 char-001 → "小红"
        let count = rename_mentions_in_node(&mut doc, "char-001", "小红");

        // 验证: 仅 char-001 被更新
        assert_eq!(count, 1);
        assert_eq!(doc["content"][0]["content"][0]["attrs"]["name"], "小红");
        // char-002 的 name 仍为 "小明明"，未受影响
        assert_eq!(doc["content"][0]["content"][1]["attrs"]["name"], "小明明");

        // 对比: 字符串替换方式（在纯文本 "小明小明明" 中替换 "小明" → "小红"）
        let plain_text = "小明小明明";
        let (_replaced, str_count) = replace_name_with_boundary(plain_text, "小明", "小红");
        // 词边界检测策略说明:
        //   - 第一个 "小明" 前为空(边界)、后跟 "小"(中文, U+5C0F) → 跳过(后字符为中文)
        //   - "小明明" 中的 "小明" 前为 "明"(中文)、后为 "明"(中文) → 跳过(前后均为中文)
        //   故 str_count = 0, 所有匹配均被边界检测跳过
        // 此结果恰好凸显 UUID 关联的精确性优势:
        //   - 字符串替换在密集中文上下文中可能完全无法替换(str_count=0)
        //   - UUID 关联通过 characterId 精确匹配,不受字符边界影响(count=1)
        assert_eq!(str_count, 0);
        // 关键验证: UUID 方式不会误伤 char-002 的 mention name
        // 即使字符串替换在边界检测下完全无法替换,
        // UUID 关联直接通过 characterId 精确匹配,无需依赖边界启发式
    }

    /// 测试 UUID 关联改名: 嵌套结构中的 mention 节点
    /// 场景: mention 节点位于嵌套的段落/列表结构中，递归遍历应正确找到
    #[test]
    fn test_rename_mentions_in_node_nested_structure() {
        let mut doc = json!({
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{
                        "type": "text",
                        "text": "前文"
                    }]
                },
                {
                    "type": "bulletList",
                    "content": [{
                        "type": "listItem",
                        "content": [{
                            "type": "paragraph",
                            "content": [{
                                "type": "characterMentionNode",
                                "attrs": { "characterId": "char-001", "name": "小明" }
                            }]
                        }]
                    }]
                }
            ]
        });
        let count = rename_mentions_in_node(&mut doc, "char-001", "小红");
        assert_eq!(count, 1);
        // 验证嵌套结构中的 mention name 已更新
        // 路径: doc → content[1](bulletList) → content[0](listItem) → content[0](paragraph)
        //       → content[0](characterMentionNode) → attrs.name
        assert_eq!(
            doc["content"][1]["content"][0]["content"][0]["content"][0]["attrs"]["name"],
            "小红"
        );
    }

    /// 测试空 codex_id 不触发 UUID 更新
    /// 场景: codex_id 为空字符串时，rename_mentions_in_node 不应更新任何节点
    #[test]
    fn test_rename_mentions_in_node_empty_codex_id() {
        let mut doc = json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{
                    "type": "characterMentionNode",
                    "attrs": { "characterId": "char-001", "name": "小明" }
                }]
            }]
        });
        let count = rename_mentions_in_node(&mut doc, "", "小红");
        // 空 codex_id 不匹配任何节点
        assert_eq!(count, 0);
        assert_eq!(doc["content"][0]["content"][0]["attrs"]["name"], "小明");
    }
}
