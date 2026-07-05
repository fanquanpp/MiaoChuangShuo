// AI 上下文提取模块
//
// 功能概述：
// 为 AI 功能（续写、推演、一致性校验）提供结构化上下文数据。
// 基于 Tantivy 索引、设定库数据、伏笔追踪、人物关系图，提取场景/角色/项目级上下文。
//
// 模块职责：
// 1. 提供 get_scene_context 命令（获取场景级上下文，用于 AI 续写，AI-2 已实现）
// 2. 提供 get_character_context 命令（获取角色级上下文，用于一致性校验）
// 3. 提供 get_project_context 命令（获取项目级上下文，用于大纲生成/剧情推演）
// 4. 为 AI Prompt Builder 提供结构化数据源
//
// 设计说明：
// - get_scene_context (AI-2) 已实现 4 层上下文组装:
//     层1: 当前场景元数据 + 场景正文文本 (current_scene_text)
//     层2: 当前场景出场角色 (present_characters, 从设定库匹配)
//     层3: 场景内伏笔 + 全局未回收伏笔 (active_foreshadowings + global_unresolved_foreshadowings)
//     层4: 前文摘要 (preceding_summary, 前 1-2 个场景的文本)
// - get_character_context / get_project_context 仍为 Mock, 待后续阶段实现
// - 所有上下文结构使用 #[serde(rename_all = "camelCase")] 匹配前端 camelCase JSON
// - AI-Ready: SceneContext 的 povCharacterId 和 mood 为强类型化字段
//             直接决定 AI Prompt 中 Context 的精准度

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

use crate::codex_commands::list_codex_entities;

/// 场景上下文（AI 续写的核心数据）
///
/// AI 价值：这是 AI 理解"剧情结构"的锚点。
/// AI 需要知道当前在"第几幕"、"谁的视角"、"什么氛围"，才能生成符合上下文的续写内容。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneContext {
    /// 场景 ID（关联 sceneBreak 节点 id）
    pub scene_id: String,
    /// 场景标题
    pub scene_title: String,
    /// AI-Ready: 视角角色 ID（强类型化，关联设定库 UUID）
    /// 直接决定 AI Prompt 中视角的精准度
    pub pov_character_id: Option<String>,
    /// 视角角色名称（从设定库解析）
    pub pov_character_name: Option<String>,
    /// AI-Ready: 氛围（强类型化，如"紧张"/"温馨"/"悲伤"）
    /// 直接影响 AI 生成文本的语气与节奏
    pub mood: Option<String>,
    /// 场景所在章节
    pub chapter: Option<String>,
    /// 前文摘要（最近 N 个 Chunk 的拼接，从 Tantivy 索引检索）
    pub preceding_summary: String,
    /// 场景内出场角色列表（从设定库提取）
    pub present_characters: Vec<CharacterBrief>,
    /// 相关设定引用（从设定库提取，如地点/物品/组织）
    pub related_settings: Vec<SettingBrief>,
    /// 活跃伏笔列表（从伏笔追踪提取，状态为"已埋设"或"待回收"）
    pub active_foreshadowings: Vec<ForeshadowingBrief>,
    /// AI-2 层1: 当前场景正文文本（从 .pmd ProseMirror JSON 提取的纯文本）
    /// AI 价值: 让 AI 知道"当前场景已写了什么", 自然衔接续写
    #[serde(default)]
    pub current_scene_text: String,
    /// AI-2 层3: 全局未回收伏笔（跨章节/跨场景的活跃伏笔，从 伏笔/ 目录读取）
    /// 与 active_foreshadowings 的区别: active_foreshadowings 仅含当前场景内出现的伏笔,
    /// global_unresolved_foreshadowings 包含整个项目中所有未回收的伏笔, 供 AI 全局视角参考
    #[serde(default)]
    pub global_unresolved_foreshadowings: Vec<ForeshadowingBrief>,
}

/// 角色简要信息（用于场景上下文中的出场角色列表）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterBrief {
    /// 角色 ID（设定库 UUID）
    pub id: String,
    /// 角色名称
    pub name: String,
    /// 角色别名列表（AI-Ready: 用于实体识别匹配）
    pub aliases: Vec<String>,
    /// 角色简介（一句话描述）
    pub summary: String,
}

/// 设定简要信息（用于场景上下文中的相关设定引用）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingBrief {
    /// 设定 ID
    pub id: String,
    /// 设定名称
    pub name: String,
    /// 设定类型（角色/地点/物品/组织/概念）
    pub category: String,
    /// 设定摘要
    pub summary: String,
}

/// 伏笔简要信息（用于场景上下文中的活跃伏笔提醒）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeshadowingBrief {
    /// 伏笔 ID
    pub id: String,
    /// 伏笔描述
    pub description: String,
    /// 状态（已埋设/已回收/待回收）
    pub status: String,
    /// 重要度（高/中/低）
    pub importance: String,
}

/// 角色上下文（AI 角色一致性校验的核心数据）
///
/// AI 价值：当 AI 生成角色对话或行为时，需要参考角色的完整设定与历史出场记录，
/// 避免"角色幻觉"（如把 A 的性格安在 B 身上）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterContext {
    /// 角色 ID（设定库 UUID）
    pub character_id: String,
    /// 角色名称
    pub name: String,
    /// 角色别名列表
    pub aliases: Vec<String>,
    /// 角色设定全文（从设定库读取）
    pub full_profile: String,
    /// 角色出场记录（从 Tantivy 索引检索，按时间倒序）
    pub appearance_records: Vec<AppearanceRecord>,
    /// 角色关系列表（从人物关系图读取）
    pub relationships: Vec<RelationshipBrief>,
}

/// 角色出场记录
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceRecord {
    /// 文件路径
    pub file_path: String,
    /// 文件名
    pub file_name: String,
    /// 出场文本片段（匹配的 Chunk 文本）
    pub excerpt: String,
    /// AI-Ready: 场景 ID（关联 sceneBreak 节点）
    /// 用于 AI 按场景分析角色出场脉络
    pub scene_id: Option<String>,
}

/// 角色关系简要
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipBrief {
    /// 目标角色 ID
    pub target_id: String,
    /// 目标角色名称
    pub target_name: String,
    /// 关系类型（朋友/敌人/师徒/恋人等）
    pub relation_type: String,
    /// 关系描述
    pub description: String,
}

/// 项目全局上下文（AI 大纲生成、剧情推演的核心数据）
///
/// AI 价值：当用户请求"帮我生成后续大纲"或"推演剧情走向"时，
/// AI 需要全局视角的项目信息，包括主要角色、已完成章节、活跃伏笔。
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
    /// 活跃伏笔列表（状态为"已埋设"或"待回收"）
    pub active_foreshadowings: Vec<ForeshadowingBrief>,
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

/// 场景上下文请求参数（AI-2 前端调用入口）
///
/// 字段说明:
///   - project_path: 项目根路径
///   - chapter_id: 章节标识（文件相对路径，如 "正文/第一章.pmd"，无扩展名时自动补 .pmd）
///   - scene_index: 场景索引（0-based，由前端 getCurrentSceneLocation 计算）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneContextRequest {
    pub project_path: String,
    pub chapter_id: String,
    pub scene_index: usize,
}

/// 获取场景上下文命令（AI-2 四层上下文组装）
///
/// 输入:
///   req - 场景上下文请求（项目路径 + 章节 ID + 场景索引）
/// 输出: Result<SceneContext, String> 场景上下文
/// 流程:
///   1. 读取 .pmd 文件（ProseMirror JSON），解析文档树
///   2. 层1: 定位当前场景（按 scene_index 划分），提取场景正文文本
///   3. 层2: 扫描当前场景中的 characterMentionNode 节点，从设定库匹配出场角色
///   4. 层3a: 提取当前场景中的 foreshadowing Mark（场景内伏笔）
///   5. 层3b: 扫描 伏笔/ 目录，加载全局未回收伏笔
///   6. 层4: 提取前 1-2 个场景的文本作为前文摘要（截取前 1000 字）
///   7. 组装 SceneContext 返回
///
/// 容错策略:
///   - .pmd 文件不存在或解析失败: 返回空字段 SceneContext（不阻塞 AI 调用）
///   - 设定库为空: present_characters 返回空数组
///   - 伏笔目录不存在: global_unresolved_foreshadowings 返回空数组
///   - 场景索引越界: 使用最后一场景或返回空正文
#[tauri::command]
pub async fn get_scene_context(
    req: SceneContextRequest,
) -> Result<SceneContext, String> {
    // 步骤1: 读取 .pmd 文件
    let pmd_path = resolve_chapter_path(&req.project_path, &req.chapter_id)?;
    let pmd_content = match fs::read_to_string(&pmd_path) {
        Ok(content) => content,
        Err(_e) => {
            // 文件读取失败: 返回空上下文（不阻塞，让前端显示空状态）
            return Ok(SceneContext {
                scene_id: format!("scene-{}", req.scene_index),
                scene_title: String::new(),
                pov_character_id: None,
                pov_character_name: None,
                mood: None,
                chapter: Some(pmd_path.to_string_lossy().to_string()),
                preceding_summary: String::new(),
                present_characters: vec![],
                related_settings: vec![],
                active_foreshadowings: vec![],
                current_scene_text: String::new(),
                global_unresolved_foreshadowings: vec![],
            });
        }
    };

    // 步骤2: 解析 ProseMirror JSON
    let doc_json: Value = serde_json::from_str(&pmd_content).map_err(|e| {
        format!("解析 .pmd JSON 失败: {} (文件: {})", e, pmd_path.display())
    })?;

    // 步骤3: 提取场景切片（按 sceneBreak / horizontalRule 划分）
    let scene_slices = split_doc_into_scenes(&doc_json);

    // 步骤4: 层1 - 当前场景正文文本
    let (current_scene_text, current_scene_nodes) = if req.scene_index < scene_slices.len() {
        let slice = &scene_slices[req.scene_index];
        (extract_text_from_nodes(&slice.nodes), slice.nodes.clone())
    } else if !scene_slices.is_empty() {
        // 索引越界: 回退到最后一场景
        let slice = scene_slices.last().unwrap();
        (extract_text_from_nodes(&slice.nodes), slice.nodes.clone())
    } else {
        (String::new(), vec![])
    };

    // 步骤5: 层4 - 前文摘要（前 1-2 个场景的文本，截取前 1000 字）
    let preceding_summary = build_preceding_summary(&scene_slices, req.scene_index);

    // 步骤6: 层2 - 提取当前场景中的角色 ID 并匹配设定库
    let character_ids = extract_character_ids_from_nodes(&current_scene_nodes);
    let present_characters = match_character_briefs(&req.project_path, &character_ids);

    // 步骤7: 层3a - 提取当前场景中的 foreshadowing Mark（场景内伏笔）
    let active_foreshadowings = extract_foreshadowings_from_nodes(&current_scene_nodes);

    // 步骤8: 层3b - 加载全局未回收伏笔（从 伏笔/ 目录）
    let global_unresolved_foreshadowings = load_global_unresolved_foreshadowings(&req.project_path);

    Ok(SceneContext {
        scene_id: format!("scene-{}", req.scene_index),
        scene_title: format!("场景 {}", req.scene_index + 1),
        pov_character_id: None, // TODO: 未来从 sceneBreak 节点 attrs 读取
        pov_character_name: None,
        mood: None, // TODO: 未来从 sceneBreak 节点 attrs 读取
        chapter: Some(pmd_path.to_string_lossy().to_string()),
        preceding_summary,
        present_characters,
        related_settings: vec![], // TODO: 阶段 6 从设定库匹配地点/物品
        active_foreshadowings,
        current_scene_text,
        global_unresolved_foreshadowings,
    })
}

/// 解析章节文件路径
/// 输入: project_path 项目根路径, chapter_id 章节标识（文件相对路径）
/// 输出: Result<PathBuf, String> .pmd 文件完整路径
/// 流程:
///   1. 若 chapter_id 不含扩展名，自动补 .pmd
///   2. 若 chapter_id 以 .pmd 结尾，直接使用
///   3. 若 chapter_id 以 .txt/.html 结尾，替换为 .pmd
///   4. 拼接 project_path + chapter_id 返回完整路径
fn resolve_chapter_path(project_path: &str, chapter_id: &str) -> Result<PathBuf, String> {
    let project = Path::new(project_path);
    // 规范化 chapter_id: 无扩展名时补 .pmd
    let normalized = if chapter_id.ends_with(".pmd") {
        chapter_id.to_string()
    } else if chapter_id.ends_with(".txt") || chapter_id.ends_with(".html") {
        // 旧格式文件: 替换扩展名为 .pmd
        let stem = chapter_id.trim_end_matches(".txt").trim_end_matches(".html");
        format!("{}.pmd", stem)
    } else {
        format!("{}.pmd", chapter_id)
    };
    Ok(project.join(&normalized))
}

/// 场景切片（一组顶层节点，由场景分隔节点划分）
#[derive(Debug, Clone)]
struct SceneSlice {
    /// 场景内的顶层节点列表（不含分隔节点本身）
    nodes: Vec<Value>,
}

/// 将 ProseMirror JSON 文档按场景分隔节点切分
/// 输入: doc_json ProseMirror JSON 文档（顶层 type=="doc"）
/// 输出: Vec<SceneSlice> 场景切片列表
/// 流程:
///   1. 读取 doc.content 数组（顶层节点列表）
///   2. 遍历节点，遇到 sceneBreak / horizontalRule 时开启新场景
///   3. 第一个分隔节点之前的内容视为"前导场景"（场景 0）
///   4. 无分隔节点时，整个文档视为单一场景
fn split_doc_into_scenes(doc_json: &Value) -> Vec<SceneSlice> {
    let mut slices: Vec<SceneSlice> = vec![SceneSlice { nodes: vec![] }];
    let content = doc_json.get("content").and_then(|c| c.as_array());
    if let Some(nodes) = content {
        for node in nodes {
            let node_type = node.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if node_type == "sceneBreak" || node_type == "horizontalRule" {
                // 遇到分隔节点: 开启新场景
                slices.push(SceneSlice { nodes: vec![] });
            } else {
                // 普通节点: 追加到当前场景
                slices.last_mut().unwrap().nodes.push(node.clone());
            }
        }
    }
    // 若第一场景为空且有多场景，移除空的前导场景
    if slices.len() > 1 && slices[0].nodes.is_empty() {
        slices.remove(0);
    }
    slices
}

/// 从节点列表递归提取纯文本
/// 输入: nodes ProseMirror 节点 JSON 数组
/// 输出: String 拼接后的纯文本
/// 流程: 递归遍历 content 数组，按节点类型提取文本与块分隔符
fn extract_text_from_nodes(nodes: &[Value]) -> String {
    let mut text = String::new();
    for node in nodes {
        collect_text_from_node(node, &mut text);
    }
    text.trim().to_string()
}

/// 递归从单个节点收集文本
/// 输入: node ProseMirror 节点 JSON, out 输出文本缓冲区
/// 流程: 按节点类型分派处理
fn collect_text_from_node(node: &Value, out: &mut String) {
    let node_type = node.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match node_type {
        "text" => {
            if let Some(t) = node.get("text").and_then(|t| t.as_str()) {
                out.push_str(t);
            }
        }
        "sceneBreak" | "horizontalRule" => {
            out.push_str("\n* * *\n");
        }
        "characterMentionNode" => {
            // 角色提及节点: 优先使用 attrs.name
            if let Some(name) = node
                .get("attrs")
                .and_then(|a| a.get("name"))
                .and_then(|n| n.as_str())
            {
                out.push_str(name);
            }
        }
        "hardBreak" => {
            out.push('\n');
        }
        "paragraph" | "heading" | "blockquote" | "codeBlock" => {
            if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
                for child in content {
                    collect_text_from_node(child, out);
                }
            }
            out.push('\n');
        }
        "bulletList" | "orderedList" | "taskList" | "listItem" | "taskItem" => {
            if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
                for child in content {
                    collect_text_from_node(child, out);
                }
            }
            out.push('\n');
        }
        _ => {
            // 其他节点: 递归处理 content 数组
            if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
                for child in content {
                    collect_text_from_node(child, out);
                }
            }
        }
    }
}

/// 从节点列表中提取角色 ID（characterMentionNode 的 attrs.characterId）
/// 输入: nodes ProseMirror 节点 JSON 数组
/// 输出: Vec<String> 角色 ID 列表（去重）
fn extract_character_ids_from_nodes(nodes: &[Value]) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for node in nodes {
        collect_character_ids(node, &mut ids, &mut seen);
    }
    ids
}

/// 递归收集角色 ID
fn collect_character_ids(
    node: &Value,
    ids: &mut Vec<String>,
    seen: &mut std::collections::HashSet<String>,
) {
    let node_type = node.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if node_type == "characterMentionNode" {
        if let Some(id) = node
            .get("attrs")
            .and_then(|a| a.get("characterId"))
            .and_then(|c| c.as_str())
        {
            if !id.is_empty() && seen.insert(id.to_string()) {
                ids.push(id.to_string());
            }
        }
    }
    // 递归处理 content 数组
    if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
        for child in content {
            collect_character_ids(child, ids, seen);
        }
    }
}

/// 从设定库匹配角色简要信息
/// 输入: project_path 项目根路径, character_ids 角色 ID 列表
/// 输出: Vec<CharacterBrief> 匹配的角色简要信息列表
/// 流程:
///   1. 调用 list_codex_entities 获取全部设定实体
///   2. 过滤 entity_type == "character" 的实体
///   3. 按 character_ids 匹配 id 字段
///   4. 转换为 CharacterBrief 返回
fn match_character_briefs(
    project_path: &str,
    character_ids: &[String],
) -> Vec<CharacterBrief> {
    if character_ids.is_empty() {
        return vec![];
    }
    let entities = match list_codex_entities(project_path.to_string()) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let id_set: std::collections::HashSet<&str> =
        character_ids.iter().map(|s| s.as_str()).collect();
    entities
        .into_iter()
        .filter(|e| e.meta.entity_type == "character" && id_set.contains(e.meta.id.as_str()))
        .map(|e| CharacterBrief {
            id: e.meta.id,
            name: e.meta.name,
            aliases: e.meta.aliases,
            summary: e.content.chars().take(100).collect::<String>(),
        })
        .collect()
}

/// 从节点列表中提取 foreshadowing Mark（场景内伏笔）
/// 输入: nodes ProseMirror 节点 JSON 数组
/// 输出: Vec<ForeshadowingBrief> 伏笔简要列表
/// 流程:
///   1. 递归遍历所有 text 节点的 marks 数组
///   2. 过滤 type == "foreshadowing" 的 mark
///   3. 提取 attrs.foreshadowingId / attrs.status 作为伏笔标识
///   4. 去重后返回（描述使用 mark 所在的文本片段）
fn extract_foreshadowings_from_nodes(nodes: &[Value]) -> Vec<ForeshadowingBrief> {
    let mut result: Vec<ForeshadowingBrief> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for node in nodes {
        collect_foreshadowings(node, &mut result, &mut seen);
    }
    result
}

/// 递归收集 foreshadowing Mark
fn collect_foreshadowings(
    node: &Value,
    result: &mut Vec<ForeshadowingBrief>,
    seen: &mut std::collections::HashSet<String>,
) {
    let node_type = node.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if node_type == "text" {
        if let Some(marks) = node.get("marks").and_then(|m| m.as_array()) {
            for mark in marks {
                let mark_type = mark.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if mark_type == "foreshadowing" {
                    let attrs = mark.get("attrs");
                    let id = attrs
                        .and_then(|a| a.get("foreshadowingId"))
                        .and_then(|f| f.as_str())
                        .unwrap_or("")
                        .to_string();
                    if !id.is_empty() && seen.insert(id.clone()) {
                        let status = attrs
                            .and_then(|a| a.get("status"))
                            .and_then(|s| s.as_str())
                            .unwrap_or("pending")
                            .to_string();
                        let text = node.get("text").and_then(|t| t.as_str()).unwrap_or("");
                        result.push(ForeshadowingBrief {
                            id: id.clone(),
                            description: text.to_string(),
                            status,
                            importance: "中".to_string(), // Mark 不携带重要度，默认中
                        });
                    }
                }
            }
        }
    }
    // 递归处理 content 数组
    if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
        for child in content {
            collect_foreshadowings(child, result, seen);
        }
    }
}

/// 加载全局未回收伏笔（从 伏笔/ 目录扫描 .txt 文件）
/// 输入: project_path 项目根路径
/// 输出: Vec<ForeshadowingBrief> 全局未回收伏笔列表
/// 流程:
///   1. 扫描 伏笔/ 目录下的 .txt 文件（兼容"伏笔记录"/"系列伏笔"目录名）
///   2. 解析每个 .txt 文件，按表格行提取伏笔条目
///   3. 过滤状态为"已回收"/"已放弃"/"resolved"/"abandoned"的条目
///   4. 返回未回收伏笔列表
fn load_global_unresolved_foreshadowings(project_path: &str) -> Vec<ForeshadowingBrief> {
    let project = Path::new(project_path);
    // 兼容多种伏笔目录名
    let foreshadowing_dirs = ["伏笔", "伏笔记录", "系列伏笔"];
    let mut result: Vec<ForeshadowingBrief> = Vec::new();
    for dir_name in &foreshadowing_dirs {
        let dir = project.join(dir_name);
        if !dir.is_dir() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("txt") {
                    continue;
                }
                if let Ok(content) = fs::read_to_string(&path) {
                    let foreshadowings = parse_foreshadowing_file(&content);
                    for f in foreshadowings {
                        // 仅保留未回收的伏笔
                        let status = f.status.as_str();
                        if status != "已回收"
                            && status != "已放弃"
                            && status != "resolved"
                            && status != "abandoned"
                        {
                            result.push(f);
                        }
                    }
                }
            }
        }
    }
    result
}

/// 解析伏笔 .txt 文件内容
/// 输入: content 文件文本内容
/// 输出: Vec<ForeshadowingBrief> 伏笔条目列表
/// 流程:
///   1. 按行分割文本
///   2. 跳过表头（首行"伏笔名称"等）与分隔线（---）
///   3. 按竖线 | 分割每行，提取字段: 名称/状态/埋设/回收/重要度/备注
///   4. 组装 ForeshadowingBrief 返回
/// 容错: 非表格行（无 | 分隔）跳过
fn parse_foreshadowing_file(content: &str) -> Vec<ForeshadowingBrief> {
    let mut result = Vec::new();
    for (idx, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        // 跳过空行、表头、分隔线
        if trimmed.is_empty() || idx == 0 || trimmed.starts_with("---") {
            continue;
        }
        // 按竖线分割
        let fields: Vec<&str> = trimmed.split('|').map(|s| s.trim()).collect();
        if fields.len() < 2 {
            continue;
        }
        // 字段顺序: 名称 | 状态 | 埋设 | 回收 | 重要度 | 备注
        let name = fields.first().copied().unwrap_or("").to_string();
        let status = fields.get(1).copied().unwrap_or("").to_string();
        let importance = fields.get(4).copied().unwrap_or("中").to_string();
        let remark = fields.get(5).copied().unwrap_or("").to_string();
        if name.is_empty() {
            continue;
        }
        // 描述 = 名称 + 备注
        let description = if remark.is_empty() {
            name.clone()
        } else {
            format!("{} - {}", name, remark)
        };
        result.push(ForeshadowingBrief {
            id: name.clone(), // 伏笔文件无 UUID，使用名称作为 ID
            description,
            status,
            importance,
        });
    }
    result
}

/// 构建前文摘要
/// 输入: scene_slices 场景切片列表, current_index 当前场景索引
/// 输出: String 前文摘要文本（前 1-2 个场景的纯文本，截取前 1000 字）
/// 流程:
///   1. 计算前一场景索引（current_index - 1）
///   2. 若存在前一场景，提取其纯文本
///   3. 若存在前两场景且前一场景文本不足 500 字，追加前两场景文本
///   4. 截取前 1000 字返回
fn build_preceding_summary(scene_slices: &[SceneSlice], current_index: usize) -> String {
    if current_index == 0 || scene_slices.is_empty() {
        return String::new();
    }
    let mut summary = String::new();
    // 前一场景
    if current_index >= 1 {
        let prev_idx = current_index - 1;
        if prev_idx < scene_slices.len() {
            let prev_text = extract_text_from_nodes(&scene_slices[prev_idx].nodes);
            summary.push_str(&prev_text);
        }
    }
    // 前两场景（若前一场景不足 500 字）
    if summary.chars().count() < 500 && current_index >= 2 {
        let prev_prev_idx = current_index - 2;
        if prev_prev_idx < scene_slices.len() {
            let prev_prev_text = extract_text_from_nodes(&scene_slices[prev_prev_idx].nodes);
            summary = format!("{}\n\n{}", prev_prev_text, summary);
        }
    }
    // 截取前 1000 字
    if summary.chars().count() > 1000 {
        summary = summary.chars().take(1000).collect::<String>() + "...";
    }
    summary.trim().to_string()
}

/// 获取角色上下文命令
///
/// 输入:
///   project_path - 项目根路径
///   character_id - 角色 ID（设定库 UUID）
/// 输出: Result<CharacterContext, String> 角色上下文
/// 流程:
///   1. 从设定库读取角色完整设定（full_profile）
///   2. 从 Tantivy 索引检索角色出场记录（按文件修改时间倒序）
///   3. 从人物关系图读取角色关系列表
///   4. 组装角色上下文返回
/// 当前状态: 接口定义阶段（AI-Ready 战略提前执行），返回 Mock 空数据
/// 后续实现: 阶段 6 完成设定库读取 + 索引检索 + 关系图读取
#[tauri::command]
pub async fn get_character_context(
    project_path: String,
    character_id: String,
) -> Result<CharacterContext, String> {
    // 接口定义阶段：返回 Mock 空数据
    // 前端可通过 TypeScript 接口 Mock 数据进行开发
    // 后续阶段 6 实现：设定库读取 + Tantivy 检索 + 关系图读取
    let _ = project_path; // 暂未使用，保留参数以匹配接口定义
    Ok(CharacterContext {
        character_id,
        name: String::new(),
        aliases: vec![],
        full_profile: String::new(),
        appearance_records: vec![],
        relationships: vec![],
    })
}

/// 获取项目全局上下文命令
///
/// 输入: project_path 项目根路径
/// 输出: Result<ProjectContext, String> 项目上下文
/// 流程:
///   1. 读取项目元数据（名称/类型/描述）
///   2. 从设定库提取主要角色与核心设定
///   3. 从 Tantivy 索引生成已完成章节的摘要
///   4. 从伏笔追踪提取活跃伏笔
///   5. 统计总字数与章节数
///   6. 组装项目上下文返回
/// 当前状态: 接口定义阶段（AI-Ready 战略提前执行），返回 Mock 空数据
/// 后续实现: 阶段 6 完成元数据读取 + 设定库提取 + 索引摘要 + 伏笔追踪
#[tauri::command]
pub async fn get_project_context(
    project_path: String,
) -> Result<ProjectContext, String> {
    // 接口定义阶段：返回 Mock 空数据
    // 前端可通过 TypeScript 接口 Mock 数据进行开发
    // 后续阶段 6 实现：元数据读取 + 设定库提取 + 索引摘要 + 伏笔追踪
    let _ = project_path; // 暂未使用，保留参数以匹配接口定义
    Ok(ProjectContext {
        project_name: String::new(),
        project_type: String::new(),
        description: String::new(),
        main_characters: vec![],
        key_settings: vec![],
        chapter_summaries: vec![],
        active_foreshadowings: vec![],
        total_words: 0,
        chapter_count: 0,
    })
}
