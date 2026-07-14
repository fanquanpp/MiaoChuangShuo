// 智能设定库（Codex）- 扫描子模块
//
// 功能概述：
// 提供实体出现位置追踪与失效提及检测能力。
//
// 模块职责：
// 1. 扫描正文目录下所有 .txt/.html/.pmd 文件追踪实体出现
// 2. 统计出现次数、提取上下文预览
// 3. 批量扫描多个实体的出现位置
// 4. 检测正文中引用指定卡片的 characterMentionNode 数量（删除卡片前失效检测）
//
// 设计说明：
//   - 实体出现扫描基于 text_extractor 统一层提取纯文本，避免 HTML 标签污染匹配
//   - 失效提及检测仅扫描 .pmd 文件（characterMentionNode 仅存在于 ProseMirror JSON 格式中）

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::text_extractor;
use super::parser::strip_pmd_front_matter;

/// 实体出现位置（单文件维度）
#[derive(Debug, Clone, Serialize)]
pub struct EntityMention {
    /// 文件相对路径（相对于正文目录）
    pub file_path: String,
    /// 文件名（含扩展名）
    pub file_name: String,
    /// 在该文件中的出现总次数
    pub count: u32,
    /// 首次出现的上下文预览（前后各约 20 字符）
    pub preview: String,
}

/// 扫描实体在正文中的出现
/// 输入:
///   project_path - 项目根目录绝对路径
///   entity_name - 实体名称（主名称）
///   aliases - 别名列表（可空）
/// 输出: Result<Vec<EntityMention>, String> 出现位置列表（按出现次数降序）
/// 流程:
///   1. 拼接正文目录路径
///   2. 递归遍历所有 .txt/.html 文件
///   3. 对每个文件查找实体名称及别名的出现
///   4. 统计次数并提取首次出现的上下文预览
///   5. 按出现次数降序排序返回
#[tauri::command]
pub fn scan_entity_mentions(
    project_path: String,
    entity_name: String,
    aliases: Option<Vec<String>>,
) -> Result<Vec<EntityMention>, String> {
    let root = PathBuf::from(&project_path);
    let manuscript_dir = root.join("正文");
    if !manuscript_dir.exists() {
        return Ok(vec![]);
    }

    // 合并主名称与别名为搜索关键词列表
    let mut names = vec![entity_name];
    if let Some(alias_list) = aliases {
        names.extend(alias_list);
    }
    // 过滤空字符串
    names.retain(|s| !s.is_empty());

    if names.is_empty() {
        return Ok(vec![]);
    }

    let mut mentions = Vec::new();
    scan_dir_for_mentions(&manuscript_dir, &names, &root, &mut mentions)?;

    // 按出现次数降序排序
    mentions.sort_by_key(|b| std::cmp::Reverse(b.count));
    Ok(mentions)
}

/// 递归扫描目录下文件中的实体出现
/// 输入:
///   dir - 当前扫描目录
///   names - 实体名称及别名列表
///   project_root - 项目根目录（用于计算相对路径，含"正文/"前缀）
///   mentions - 出现位置结果列表（可变引用，累加结果）
/// 输出: Result<(), String> 扫描成功或错误
/// 流程:
///   1. 遍历目录条目
///   2. 子目录递归扫描
///   3. 支持文档(.txt/.pmd/.html/.htm)读取内容并提取纯文本后查找实体名称
///   4. 记录出现次数和上下文预览（预览为纯文本，无 HTML 标签污染）
fn scan_dir_for_mentions(
    dir: &Path,
    names: &[String],
    project_root: &Path,
    mentions: &mut Vec<EntityMention>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // 递归扫描子目录
            scan_dir_for_mentions(&path, names, project_root, mentions)?;
        } else {
            // 支持文档格式：.txt/.pmd/.html/.htm
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let is_supported = matches!(ext.to_lowercase().as_str(), "txt" | "pmd" | "html" | "htm");
            if !is_supported {
                continue;
            }

            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            // 接入 text_extractor 统一层：提取纯文本，避免 HTML 标签/JSON 结构污染匹配
            let file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let format = text_extractor::detect_format(&file_name, &content);
            let plain = text_extractor::extract_plain_text(&content, format);

            let mut total_count: u32 = 0;
            let mut first_preview = String::new();

            for name in names {
                if name.is_empty() {
                    continue;
                }
                // 在纯文本中查找名称位置（避免匹配到 HTML 标签内部）
                if let Some(pos) = plain.find(name) {
                    // 统计该名称在纯文本中的总出现次数
                    total_count += plain.matches(name).count() as u32;

                    // 提取首次出现的上下文预览（前 20 字符 + 名称 + 后 40 字符，纯文本无标签污染）
                    if first_preview.is_empty() {
                        let start = pos.saturating_sub(20);
                        let end = (pos + name.len() + 40).min(plain.len());
                        let raw_preview = &plain[start..end];
                        // 去除换行符，保留可读预览
                        first_preview = format!("...{}...", raw_preview.replace('\n', " ").replace('\r', ""));
                    }
                }
            }

            if total_count > 0 {
                // 计算相对于项目根的路径（含"正文/"前缀），便于前端直接用于文件跳转
                let rel_path = path
                    .strip_prefix(project_root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();
                let file_name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();

                mentions.push(EntityMention {
                    file_path: rel_path,
                    file_name,
                    count: total_count,
                    preview: first_preview,
                });
            }
        }
    }

    Ok(())
}

/// 批量扫描多个实体在正文中的出现
/// 输入:
///   project_path - 项目根目录
///   entities - 实体列表，每项包含 name 和 aliases
/// 输出: Result<Vec<(String, u32, Vec<EntityMention>)>, String>
///   每个实体对应 (实体名, 总出现次数, 出现位置列表)
/// 流程: 对每个实体调用 scan_entity_mentions 并汇总
#[tauri::command]
pub fn batch_scan_entities(
    project_path: String,
    entities: Vec<(String, Vec<String>)>,
) -> Result<Vec<(String, u32, Vec<EntityMention>)>, String> {
    let root = PathBuf::from(&project_path);
    let manuscript_dir = root.join("正文");
    if !manuscript_dir.exists() {
        return Ok(vec![]);
    }

    let mut results = Vec::new();
    for (name, aliases) in entities {
        let mentions = scan_entity_mentions(
            project_path.clone(),
            name.clone(),
            Some(aliases),
        )?;
        let total: u32 = mentions.iter().map(|m| m.count).sum();
        results.push((name, total, mentions));
    }

    // 按总出现次数降序排序
    results.sort_by_key(|b| std::cmp::Reverse(b.1));
    Ok(results)
}

// ===== Sprint 2 任务 2.5：删除失效检测 =====

/// 失效提及位置（单文件维度）
/// 用于删除卡片前检测正文中引用该卡片的 characterMentionNode 数量
#[derive(Debug, Clone, Serialize)]
pub struct InvalidMention {
    /// 文件相对路径（相对于项目根，含"正文/"前缀）
    pub file_path: String,
    /// 文件名（含扩展名）
    pub file_name: String,
    /// 该文件中引用该卡片的 characterMentionNode 数量
    pub count: u32,
}

/// 扫描正文中引用指定卡片的 characterMentionNode 数量
/// 输入:
///   project_path - 项目根目录绝对路径
///   card_id - 待检测的卡片 UUID（characterMentionNode.attrs.characterId）
/// 输出: Result<Vec<InvalidMention>, String> 引用该卡片的文件列表（按数量降序）
/// 流程:
///   1. 遍历正文目录下所有 .pmd 文件
///   2. 剥离 front matter 后解析 ProseMirror JSON
///   3. 递归查找 type == "characterMentionNode" 且 attrs.characterId == card_id 的节点
///   4. 按文件汇总数量返回
/// 设计说明:
///   - 仅扫描 .pmd 文件（characterMentionNode 仅存在于 ProseMirror JSON 格式中）
///   - .txt/.html 旧文件不含 characterMentionNode，跳过
///   - 删除卡片前调用，返回值用于前端弹出失效提示
#[tauri::command]
pub fn scan_invalid_mentions(
    project_path: String,
    card_id: String,
) -> Result<Vec<InvalidMention>, String> {
    let root = PathBuf::from(&project_path);
    let manuscript_dir = root.join("正文");
    if !manuscript_dir.exists() {
        return Ok(vec![]);
    }

    let mut results = Vec::new();
    scan_dir_for_invalid_mentions(&manuscript_dir, &card_id, &root, &mut results)?;

    // 按数量降序排序
    results.sort_by_key(|b| std::cmp::Reverse(b.count));
    Ok(results)
}

/// 递归扫描目录下 .pmd 文件中的失效提及
/// 输入:
///   dir - 当前扫描目录
///   card_id - 待检测的卡片 UUID
///   project_root - 项目根目录（用于计算相对路径）
///   results - 结果列表（可变引用，累加结果）
/// 输出: Result<(), String> 扫描成功或错误
fn scan_dir_for_invalid_mentions(
    dir: &Path,
    card_id: &str,
    project_root: &Path,
    results: &mut Vec<InvalidMention>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // 递归扫描子目录
            scan_dir_for_invalid_mentions(&path, card_id, project_root, results)?;
        } else {
            // 仅处理 .pmd 文件（characterMentionNode 仅存在于 ProseMirror JSON 格式中）
            let is_pmd = path
                .extension()
                .map(|e| e == "pmd")
                .unwrap_or(false);
            if !is_pmd {
                continue;
            }

            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            // 剥离 .pmd front matter 后解析 ProseMirror JSON
            let json_str = strip_pmd_front_matter(&content);
            let doc = match serde_json::from_str::<serde_json::Value>(&json_str) {
                Ok(v) => v,
                Err(_) => continue,
            };

            // 递归查找 characterMentionNode 节点并统计匹配数量
            let count = count_character_mentions(&doc, card_id);
            if count > 0 {
                let rel_path = path
                    .strip_prefix(project_root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();
                let file_name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                results.push(InvalidMention {
                    file_path: rel_path,
                    file_name,
                    count,
                });
            }
        }
    }

    Ok(())
}

/// 递归统计 ProseMirror JSON 文档中引用指定 characterId 的 characterMentionNode 数量
/// 输入:
///   node - ProseMirror JSON 节点（serde_json::Value）
///   card_id - 待匹配的卡片 UUID
/// 输出: u32 匹配的节点数量
/// 流程:
///   1. 检查当前节点 type 是否为 "characterMentionNode"
///   2. 若是，检查 attrs.characterId 是否等于 card_id，匹配则计数 +1
///   3. 递归检查 content 数组中的子节点
fn count_character_mentions(node: &serde_json::Value, card_id: &str) -> u32 {
    let mut count = 0;

    // 检查当前节点是否为 characterMentionNode
    if let Some(node_type) = node.get("type").and_then(|v| v.as_str()) {
        if node_type == "characterMentionNode" {
            // 检查 attrs.characterId 是否匹配
            if let Some(attrs) = node.get("attrs") {
                if let Some(id) = attrs.get("characterId").and_then(|v| v.as_str()) {
                    if id == card_id {
                        count += 1;
                    }
                }
            }
        }
    }

    // 递归检查子节点（content 数组）
    if let Some(content) = node.get("content").and_then(|v| v.as_array()) {
        for child in content {
            count += count_character_mentions(child, card_id);
        }
    }

    count
}
