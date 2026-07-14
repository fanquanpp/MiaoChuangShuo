// 项目级 AI 上下文模块
//
// 功能概述：
// 提供项目全局上下文数据，用于 AI 大纲生成与剧情推演。聚合项目元数据、
// 主要角色、关键设定、章节摘要与字数统计，为 AI 提供全局视角。
//
// 模块职责：
// 1. 定义 ProjectContext / ChapterSummary 数据结构
// 2. 实现 get_project_context Tauri 命令（Sprint 6 真实数据组装）
// 3. 提供项目元数据读取、章节摘要收集、字数统计等辅助函数
//
// 设计说明：
// - get_project_context (Sprint 6) 已实现真实数据组装:
//     项目元数据 + 主要角色 + 关键设定 + 章节摘要 + 字数统计
// - 所有上下文结构使用 #[serde(rename_all = "camelCase")] 匹配前端 camelCase JSON

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

use crate::codex::list_codex_entities;
use crate::prosemirror_parser::extract_text_from_nodes;
use crate::word_count::count_words;

use super::{CharacterBrief, SettingBrief};

/// 项目全局上下文（AI 大纲生成、剧情推演的核心数据）
///
/// AI 价值：当用户请求"帮我生成后续大纲"或"推演剧情走向"时，
/// AI 需要全局视角的项目信息，包括主要角色、已完成章节。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContext {
    /// 项目名称
    pub project_name: String,
    /// 项目类型（novel/script/essay）
    pub project_type: String,
    /// 项目描述
    pub description: String,
    /// 主要角色列表（从设定库提取，按重要度排序）
    pub main_characters: Vec<CharacterBrief>,
    /// 主要设定列表（从设定库提取，如世界观/地点/组织）
    pub key_settings: Vec<SettingBrief>,
    /// 已完成章节摘要（从 Tantivy 索引检索，前 200 字）
    pub chapter_summaries: Vec<ChapterSummary>,
    /// 总字数
    pub total_words: u64,
    /// 章节数
    pub chapter_count: u64,
}

/// 章节摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterSummary {
    /// 章节名
    pub chapter_name: String,
    /// 文件路径
    pub file_path: String,
    /// 摘要文本（前 200 字）
    pub summary: String,
    /// 字数
    pub word_count: u64,
}

/// 获取项目全局上下文命令（Sprint 6 已实现真实数据组装）
///
/// 输入: project_path 项目根路径
/// 输出: Result<ProjectContext, String> 项目上下文
/// 流程:
///   1. 读取项目元数据（.novelforge/project.json: 名称/类型/描述）
///   2. 从设定库提取主要角色（entity_type == "character"，按 sort_order 排序，取前 10 个）
///   3. 从设定库提取关键设定（entity_type != "character"，取前 10 个）
///   4. 扫描正文目录生成章节摘要（每个 .pmd/.txt 文件提取前 200 字）
///   5. 统计总字数与章节数（支持 .pmd 与 .txt 文件）
///   6. 组装项目上下文返回
/// 容错策略:
///   - project.json 不存在或解析失败: project_name 使用目录名，project_type 默认 "novel"
///   - 设定库为空: main_characters 与 key_settings 返回空数组
///   - 正文目录不存在: chapter_summaries 返回空数组，total_words 与 chapter_count 为 0
#[tauri::command]
pub async fn get_project_context(project_path: String) -> Result<ProjectContext, String> {
    let project_root = Path::new(&project_path);

    // 步骤1: 读取项目元数据
    let (project_name, project_type, description) = read_project_meta_for_ai(project_root);

    // 步骤2: 从设定库提取主要角色与关键设定
    let entities = list_codex_entities(project_path.clone()).unwrap_or_default();
    let main_characters: Vec<CharacterBrief> = entities
        .iter()
        .filter(|e| e.meta.entity_type == "character")
        .take(10)
        .map(|e| CharacterBrief {
            id: e.meta.id.clone(),
            name: e.meta.name.clone(),
            aliases: e.meta.aliases.clone(),
            summary: if e.meta.summary.is_empty() {
                e.content.chars().take(100).collect::<String>()
            } else {
                e.meta.summary.clone()
            },
        })
        .collect();
    let key_settings: Vec<SettingBrief> = entities
        .iter()
        .filter(|e| e.meta.entity_type != "character")
        .take(10)
        .map(|e| SettingBrief {
            id: e.meta.id.clone(),
            name: e.meta.name.clone(),
            category: e.meta.entity_type.clone(),
            summary: if e.meta.summary.is_empty() {
                e.content.chars().take(100).collect::<String>()
            } else {
                e.meta.summary.clone()
            },
        })
        .collect();

    // 步骤3: 扫描正文目录生成章节摘要
    let chapter_summaries = collect_chapter_summaries(project_root);

    // 步骤4: 统计总字数与章节数
    let (total_words, chapter_count) = count_project_words_and_chapters(project_root);

    Ok(ProjectContext {
        project_name,
        project_type,
        description,
        main_characters,
        key_settings,
        chapter_summaries,
        total_words,
        chapter_count,
    })
}

/// 读取项目元数据（.novelforge/project.json）供 AI 上下文使用
///
/// 输入: project_root 项目根路径
/// 输出: (project_name, project_type, description) 三元组
/// 流程:
///   1. 拼接 .novelforge/project.json 路径
///   2. 文件存在时解析 JSON 提取字段
///   3. 文件不存在或解析失败时回退：project_name = 目录名，project_type = "novel"
fn read_project_meta_for_ai(project_root: &Path) -> (String, String, String) {
    let meta_path = project_root.join(".novelforge").join("project.json");
    if let Ok(content) = fs::read_to_string(&meta_path) {
        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&content) {
            let name = meta
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| {
                    project_root
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("未命名项目")
                        .to_string()
                });
            let project_type = meta
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("novel")
                .to_string();
            let description = meta
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            return (name, project_type, description);
        }
    }
    // 回退：使用目录名作为项目名
    let fallback_name = project_root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("未命名项目")
        .to_string();
    (fallback_name, "novel".to_string(), String::new())
}

/// 收集正文目录下所有章节的摘要（前 200 字）
///
/// 输入: project_root 项目根路径
/// 输出: Vec<ChapterSummary> 章节摘要列表（按文件名排序）
/// 流程:
///   1. 遍历 正文/ 目录下所有 .pmd 与 .txt 文件
///   2. 对每个文件提取纯文本（.pmd 需剥离 front matter 并解析 ProseMirror JSON）
///   3. 截取前 200 字作为摘要
///   4. 统计该文件字数
/// 容错: 正文目录不存在时返回空数组；单文件解析失败跳过
fn collect_chapter_summaries(project_root: &Path) -> Vec<ChapterSummary> {
    let manuscript_dir = project_root.join("正文");
    if !manuscript_dir.exists() {
        return vec![];
    }

    let mut summaries = Vec::new();
    let mut files: Vec<PathBuf> = Vec::new();
    collect_manuscript_files(&manuscript_dir, &mut files);
    // 按文件名排序，保证章节顺序稳定
    files.sort_by(|a, b| {
        a.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .cmp(b.file_name().and_then(|n| n.to_str()).unwrap_or(""))
    });

    for file_path in files {
        let content = match fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let plain_text = extract_plain_text_from_manuscript(&content, &file_path);
        if plain_text.is_empty() {
            continue;
        }

        let chapter_name = file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let rel_path = file_path
            .strip_prefix(project_root)
            .unwrap_or(&file_path)
            .to_string_lossy()
            .replace('\\', "/");
        // 摘要取前 200 字
        let summary: String = plain_text.chars().take(200).collect();
        let word_count = count_words(&plain_text);

        summaries.push(ChapterSummary {
            chapter_name,
            file_path: rel_path,
            summary,
            word_count,
        });
    }

    summaries
}

/// 递归收集正文目录下所有 .pmd 与 .txt 文件
///
/// 输入:
///   dir - 当前扫描目录
///   result - 累加的文件路径列表
/// 流程: 递归遍历目录，收集 .pmd 与 .txt 文件
fn collect_manuscript_files(dir: &Path, result: &mut Vec<PathBuf>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_manuscript_files(&path, result);
            } else {
                let is_target = path
                    .extension()
                    .map(|e| e == "pmd" || e == "txt")
                    .unwrap_or(false);
                if is_target {
                    result.push(path);
                }
            }
        }
    }
}

/// 从正文中提取纯文本（支持 .pmd 与 .txt 格式）
///
/// 输入:
///   content - 文件完整内容
///   file_path - 文件路径（用于判断格式）
/// 输出: String 纯文本
/// 流程:
///   1. .pmd 文件：剥离 front matter 后解析 ProseMirror JSON，调用 extract_text_from_nodes
///   2. .txt 文件：直接返回内容
///   3. 解析失败时返回空字符串
fn extract_plain_text_from_manuscript(content: &str, file_path: &Path) -> String {
    let extension = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if extension == "pmd" {
        // 剥离 front matter
        let lines: Vec<&str> = content.lines().collect();
        let json_str = if lines.len() >= 3 && lines[0].trim() == "---" {
            if let Some(end) = lines[1..]
                .iter()
                .position(|l| l.trim() == "---")
                .map(|i| i + 1)
            {
                lines[end + 1..].join("\n").trim_start().to_string()
            } else {
                content.to_string()
            }
        } else {
            content.to_string()
        };
        // 解析 ProseMirror JSON 并提取文本
        match serde_json::from_str::<Value>(&json_str) {
            Ok(doc) => extract_text_from_nodes(
                doc.get("content")
                    .and_then(|c| c.as_array())
                    .map(|v| v.as_slice())
                    .unwrap_or(&[]),
            ),
            Err(_) => String::new(),
        }
    } else {
        content.to_string()
    }
}

/// 统计项目总字数与章节数（支持 .pmd 与 .txt 文件）
///
/// 输入: project_root 项目根路径
/// 输出: (total_words, chapter_count) 总字数与章节数
/// 流程:
///   1. 遍历 正文/ 目录下所有 .pmd 与 .txt 文件
///   2. 对每个文件提取纯文本并统计字数
///   3. 累加总字数与文件数
fn count_project_words_and_chapters(project_root: &Path) -> (u64, u64) {
    let manuscript_dir = project_root.join("正文");
    if !manuscript_dir.exists() {
        return (0, 0);
    }

    let mut files: Vec<PathBuf> = Vec::new();
    collect_manuscript_files(&manuscript_dir, &mut files);

    let mut total_words: u64 = 0;
    let mut chapter_count: u64 = 0;
    for file_path in &files {
        if let Ok(content) = fs::read_to_string(file_path) {
            let plain_text = extract_plain_text_from_manuscript(&content, file_path);
            total_words += count_words(&plain_text);
            chapter_count += 1;
        }
    }

    (total_words, chapter_count)
}
