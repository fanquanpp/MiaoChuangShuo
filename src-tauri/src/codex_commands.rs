// 智能设定库（Codex）命令模块
//
// 功能概述：
// 提供 Codex 设定库的后端能力：扫描实体在正文中的出现位置，
// 为前端"出现追踪"面板提供数据支撑。
//
// 模块职责：
// 1. 扫描正文目录下所有 .txt/.html 文件
// 2. 查找实体名称（含别名）在文件中的出现
// 3. 统计出现次数、提取上下文预览
// 4. 返回结构化的出现位置列表
//
// 设计参考：Novelcrafter Codex 的 Mention Tracking 机制

use std::fs;
use std::path::{Path, PathBuf};
use serde::Serialize;

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
///   3. .txt/.html 文件读取内容并查找实体名称
///   4. 记录出现次数和上下文预览
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
            // 仅处理 .txt 和 .html 文件
            let is_text = path
                .extension()
                .map(|e| e == "txt" || e == "html")
                .unwrap_or(false);
            if !is_text {
                continue;
            }

            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let mut total_count: u32 = 0;
            let mut first_preview = String::new();

            for name in names {
                if name.is_empty() {
                    continue;
                }
                // 查找名称在文件中的位置
                if let Some(pos) = content.find(name) {
                    // 统计该名称在文件中的总出现次数
                    total_count += content.matches(name).count() as u32;

                    // 提取首次出现的上下文预览（前 20 字符 + 名称 + 后 40 字符）
                    if first_preview.is_empty() {
                        let start = pos.saturating_sub(20);
                        let end = (pos + name.len() + 40).min(content.len());
                        let raw_preview = &content[start..end];
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
