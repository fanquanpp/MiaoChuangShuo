// 场景级 AI 上下文模块
//
// 功能概述：
// 提供场景级上下文数据，用于 AI 续写功能。基于 ProseMirror 文档解析与设定库匹配，
// 组装三层上下文（当前场景正文 + 出场角色 + 前文摘要）。
//
// 模块职责：
// 1. 定义 SceneContext / SceneContextRequest 数据结构
// 2. 实现 get_scene_context Tauri 命令（AI-2 三层上下文组装）
// 3. 提供场景路径解析、角色匹配、前文摘要构建等辅助函数
//
// 设计说明：
// - get_scene_context (AI-2) 已实现 3 层上下文组装:
//     层1: 当前场景元数据 + 场景正文文本 (current_scene_text)
//     层2: 当前场景出场角色 (present_characters, 从设定库匹配)
//     层3: 前文摘要 (preceding_summary, 前 1-2 个场景的文本)
// - pov_character_id/mood/related_settings 为预留 TODO:
//     待 sceneBreak 节点 attrs 扩展与设定库语义匹配完善后填充
// - 所有上下文结构使用 #[serde(rename_all = "camelCase")] 匹配前端 camelCase JSON

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

use crate::codex::list_codex_entities;
use crate::prosemirror_parser::{
    extract_character_ids_from_nodes, extract_text_from_nodes, split_doc_into_scenes, SceneSlice,
};

use super::{CharacterBrief, SettingBrief};

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
    /// AI-2 层1: 当前场景正文文本（从 .pmd ProseMirror JSON 提取的纯文本）
    /// AI 价值: 让 AI 知道"当前场景已写了什么", 自然衔接续写
    #[serde(default)]
    pub current_scene_text: String,
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

/// 获取场景上下文命令（AI-2 三层上下文组装）
///
/// 输入:
///   req - 场景上下文请求（项目路径 + 章节 ID + 场景索引）
/// 输出: Result<SceneContext, String> 场景上下文
/// 流程:
///   1. 读取 .pmd 文件（ProseMirror JSON），解析文档树
///   2. 层1: 定位当前场景（按 scene_index 划分），提取场景正文文本
///   3. 层2: 扫描当前场景中的 characterMentionNode 节点，从设定库匹配出场角色
///   4. 层3: 提取前 1-2 个场景的文本作为前文摘要（截取前 1000 字）
///   5. 组装 SceneContext 返回
///
/// 容错策略:
///   - .pmd 文件不存在或解析失败: 返回空字段 SceneContext（不阻塞 AI 调用）
///   - 设定库为空: present_characters 返回空数组
///   - 场景索引越界: 使用最后一场景或返回空正文
#[tauri::command]
pub async fn get_scene_context(req: SceneContextRequest) -> Result<SceneContext, String> {
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
                current_scene_text: String::new(),
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
    } else if let Some(slice) = scene_slices.last() {
        // 索引越界: 回退到最后一场景
        // 防御性说明: 理论上 scene_slices 由 split_doc_into_scenes 返回时至少包含 1 个元素,
        // 此分支仅在 scene_index 越界时触发; 改用 if let 模式替代 unwrap,
        // 避免 scene_slices 为空时引发 panic, 同时保持原有回退到最后一场景的语义
        (extract_text_from_nodes(&slice.nodes), slice.nodes.clone())
    } else {
        // scene_slices 为空: 返回空文本与空节点列表
        (String::new(), vec![])
    };

    // 步骤5: 层3 - 前文摘要（前 1-2 个场景的文本，截取前 1000 字）
    let preceding_summary = build_preceding_summary(&scene_slices, req.scene_index);

    // 步骤6: 层2 - 提取当前场景中的角色 ID 并匹配设定库
    let character_ids = extract_character_ids_from_nodes(&current_scene_nodes);
    let present_characters = match_character_briefs(&req.project_path, &character_ids);

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
        current_scene_text,
    })
}

/// 解析章节文件路径
///
/// 输入:
///   project_path - 项目根路径
///   chapter_id - 章节标识（文件相对路径）
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
        let stem = chapter_id
            .trim_end_matches(".txt")
            .trim_end_matches(".html");
        format!("{}.pmd", stem)
    } else {
        format!("{}.pmd", chapter_id)
    };
    Ok(project.join(&normalized))
}

/// 从设定库匹配角色简要信息
///
/// 输入:
///   project_path - 项目根路径
///   character_ids - 角色 ID 列表
/// 输出: Vec<CharacterBrief> 匹配的角色简要信息列表
/// 流程:
///   1. 调用 list_codex_entities 获取全部设定实体
///   2. 过滤 entity_type == "character" 的实体
///   3. 按 character_ids 匹配 id 字段
///   4. 转换为 CharacterBrief 返回
/// 容错: 设定库读取失败或 ID 列表为空时返回空数组
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

/// 构建前文摘要
///
/// 输入:
///   scene_slices - 场景切片列表
///   current_index - 当前场景索引
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
