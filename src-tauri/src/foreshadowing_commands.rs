// 伏笔追踪模块
//
// 功能概述：
// 提供项目内伏笔（foreshadowing）的结构化扫描与状态追踪能力。
// 扫描"伏笔"目录下所有 .txt 文件，解析每个伏笔项的字段（名称、状态、埋设位置、
// 回收位置、重要度、备注），并按状态汇总统计，供前端面板可视化展示。
//
// 模块职责：
// 1. 递归扫描伏笔目录下所有 .txt 文件
// 2. 解析每个文件的字段（复用 extract_field 模式）
// 3. 按状态（未回收/已回收/已废弃）分类汇总
// 4. 返回结构化数据供前端渲染
//
// 文件格式约定：
// 每个伏笔项为一个 .txt 文件，首行为伏笔名称，后续行以"字段：值"或"【字段】\n值"格式
// 支持的字段：状态、埋设、回收、重要度、备注

use serde::Serialize;
use std::fs;
use std::path::PathBuf;

/// 单个伏笔项
#[derive(Debug, Clone, Serialize)]
pub struct ForeshadowingItem {
    /// 伏笔名称（文件首行）
    pub name: String,
    /// 文件相对路径
    pub file_path: String,
    /// 状态：未回收 / 已回收 / 已废弃
    pub status: String,
    /// 埋设位置描述
    pub plant_location: String,
    /// 回收位置描述
    pub payoff_location: String,
    /// 重要度：高 / 中 / 低
    pub importance: String,
    /// 备注
    pub notes: String,
}

/// 伏笔追踪汇总
#[derive(Debug, Clone, Serialize)]
pub struct ForeshadowingSummary {
    /// 伏笔总数
    pub total: u64,
    /// 未回收数
    pub pending: u64,
    /// 已回收数
    pub resolved: u64,
    /// 已废弃数
    pub abandoned: u64,
    /// 所有伏笔项列表（按重要度降序、未回收优先）
    pub items: Vec<ForeshadowingItem>,
}

/**
 * 从文件内容中提取指定字段的值
 * 输入: content 文件内容, field_names 可能的字段名列表（按优先级匹配）
 * 输出: 字段值（去除前缀后的纯文本）
 * 流程:
 *   1. 遍历每一行，查找以"字段："或"字段:"开头的行
 *   2. 支持"【字段】"后跟值的格式
 *   3. 返回第一个匹配的字段值
 */
fn extract_field(content: &str, field_names: &[&str]) -> String {
    // 第一轮：匹配 "字段：值" 或 "字段:值" 格式
    for line in content.lines() {
        let trimmed = line.trim();
        for field in field_names {
            let prefix_colon = format!("{}：", field);
            let prefix_colon_half = format!("{}:", field);
            if trimmed.starts_with(&prefix_colon) {
                return trimmed[prefix_colon.len()..].trim().to_string();
            }
            if trimmed.starts_with(&prefix_colon_half) {
                return trimmed[prefix_colon_half.len()..].trim().to_string();
            }
        }
    }
    // 第二轮：匹配 "【字段】" 后跟下一行值的格式
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
 * 提取伏笔名称（文件首行，跳过注释与分隔线）
 * 输入: content 文件内容
 * 输出: 伏笔名称
 */
fn extract_name(content: &str) -> String {
    content
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("---") && !l.starts_with("==="))
        .unwrap_or("")
        .to_string()
}

/**
 * 提取备注字段（支持多行值）
 * 输入: content 文件内容, field_names 可能的字段名列表
 * 输出: 备注内容（可能包含多行）
 * 流程:
 *   1. 查找"备注："或"备注:"起始行
 *   2. 收集该行冒号后的内容
 *   3. 继续收集后续非字段行作为备注的延续
 */
fn extract_multiline_field(content: &str, field_names: &[&str]) -> String {
    let lines: Vec<&str> = content.lines().collect();
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        for field in field_names {
            let prefix_colon = format!("{}：", field);
            let prefix_colon_half = format!("{}:", field);
            if trimmed.starts_with(&prefix_colon) || trimmed.starts_with(&prefix_colon_half) {
                let prefix_len = if trimmed.starts_with(&prefix_colon) {
                    prefix_colon.len()
                } else {
                    prefix_colon_half.len()
                };
                let first_val = trimmed[prefix_len..].trim().to_string();
                // 收集后续非字段行
                let mut parts: Vec<String> = Vec::new();
                if !first_val.is_empty() {
                    parts.push(first_val);
                }
                for next_raw in lines[i + 1..].iter() {
                    let next = next_raw.trim();
                    if next.is_empty() {
                        break;
                    }
                    // 遇到下一个字段行则停止
                    if next.contains('：') || next.contains(':') || next.starts_with('【') {
                        break;
                    }
                    parts.push(next.to_string());
                }
                return parts.join("\n");
            }
        }
    }
    String::new()
}

/**
 * 将重要度文本映射为排序权重（越高越重要）
 * 输入: importance 重要度文本
 * 输出: 排序权重数值
 */
fn importance_weight(importance: &str) -> u8 {
    match importance.trim() {
        "高" => 3,
        "中" => 2,
        "低" => 1,
        _ => 0,
    }
}

/**
 * 将状态文本映射为排序权重（未回收优先展示）
 * 输入: status 状态文本
 * 输出: 排序权重数值
 */
fn status_weight(status: &str) -> u8 {
    match status.trim() {
        "未回收" => 3,
        "已回收" => 2,
        "已废弃" => 1,
        _ => 0,
    }
}

/**
 * 扫描项目伏笔目录，返回所有伏笔项的结构化数据
 * 输入: project_path 项目根路径
 * 输出: Result<ForeshadowingSummary, String> 伏笔追踪汇总
 * 流程:
 *   1. canonicalize 项目根路径
 *   2. 检查伏笔目录是否存在
 *   3. 遍历伏笔目录下所有 .txt 文件（跳过模板/说明文件）
 *   4. 解析每个文件的字段
 *   5. 按状态与重要度排序
 *   6. 汇总统计返回
 */
#[tauri::command]
pub fn scan_foreshadowing(
    project_path: String,
) -> Result<ForeshadowingSummary, String> {
    let root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;

    if !root.exists() || !root.is_dir() {
        return Err("项目路径不存在或不是目录".to_string());
    }

    // 兼容多目录名：模板生成的"伏笔记录"，或用户自建的"伏笔"/"系列伏笔"
    let fore_dir = ["伏笔记录", "伏笔", "系列伏笔"]
        .iter()
        .map(|name| root.join(name))
        .find(|d| d.exists())
        .unwrap_or_else(|| root.join("伏笔记录"));
    if !fore_dir.exists() {
        // 伏笔目录不存在，返回空汇总（非错误状态）
        return Ok(ForeshadowingSummary {
            total: 0,
            pending: 0,
            resolved: 0,
            abandoned: 0,
            items: Vec::new(),
        });
    }

    let mut items: Vec<ForeshadowingItem> = Vec::new();

    // 遍历伏笔目录下的 .txt 文件
    let entries = match fs::read_dir(&fore_dir) {
        Ok(e) => e,
        Err(e) => return Err(format!("读取伏笔目录失败: {}", e)),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() || path.extension().map(|e| e != "txt").unwrap_or(true) {
            continue;
        }
        // 跳过模板/说明文件
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let lower = file_name.to_lowercase();
        if lower.contains("模板") || lower.contains("template") || lower.contains("readme") {
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let name = extract_name(&content);
        if name.is_empty() {
            continue;
        }

        let relative = path
            .strip_prefix(&root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();

        let status = extract_field(&content, &["状态", "status"]);
        let plant_location = extract_field(&content, &["埋设", "埋设位置", "plant"]);
        let payoff_location = extract_field(&content, &["回收", "回收位置", "payoff"]);
        let importance = extract_field(&content, &["重要度", "优先级", "importance"]);
        let notes = extract_multiline_field(&content, &["备注", "说明", "notes"]);

        items.push(ForeshadowingItem {
            name,
            file_path: relative,
            status,
            plant_location,
            payoff_location,
            importance,
            notes,
        });
    }

    // 按状态权重降序（未回收优先）、重要度降序排序
    items.sort_by(|a, b| {
        let sw = status_weight(&b.status).cmp(&status_weight(&a.status));
        if sw != std::cmp::Ordering::Equal {
            return sw;
        }
        importance_weight(&b.importance).cmp(&importance_weight(&a.importance))
    });

    // 统计
    let pending = items.iter().filter(|i| i.status.trim() == "未回收").count() as u64;
    let resolved = items.iter().filter(|i| i.status.trim() == "已回收").count() as u64;
    let abandoned = items.iter().filter(|i| i.status.trim() == "已废弃").count() as u64;
    let total = items.len() as u64;

    Ok(ForeshadowingSummary {
        total,
        pending,
        resolved,
        abandoned,
        items,
    })
}
