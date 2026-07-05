// AI 上下文提取模块
//
// 功能概述：
// 为 AI 功能（续写、推演、一致性校验）提供结构化上下文数据。
// 基于 Tantivy 索引、设定库数据、伏笔追踪、人物关系图，提取场景/角色/项目级上下文。
//
// 模块职责：
// 1. 提供 get_scene_context 命令（获取场景级上下文，用于 AI 续写）
// 2. 提供 get_character_context 命令（获取角色级上下文，用于一致性校验）
// 3. 提供 get_project_context 命令（获取项目级上下文，用于大纲生成/剧情推演）
// 4. 为 AI Prompt Builder 提供结构化数据源
//
// 设计说明：
// - 当前为接口定义阶段（AI-Ready 战略提前执行），后端逻辑返回 Mock 空数据
// - 前端可通过 TypeScript 接口 Mock 数据进行开发，确保 AI 功能上线时无需重构
// - 后续阶段 6 实现 RAG 检索与上下文组装
// - 所有上下文结构使用 #[serde(rename_all = "camelCase")] 匹配前端 camelCase JSON
// - AI-Ready: SceneContext 的 povCharacterId 和 mood 为强类型化字段
//             直接决定 AI Prompt 中 Context 的精准度

use serde::{Deserialize, Serialize};

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

/// 获取场景上下文命令
///
/// 输入:
///   project_path - 项目根路径
///   scene_id - 场景 ID（关联 sceneBreak 节点）
/// 输出: Result<SceneContext, String> 场景上下文
/// 流程:
///   1. 从 Tantivy 索引按 scene_id 检索相关 Chunk
///   2. 从设定库提取场景内出场角色信息
///   3. 从伏笔追踪提取活跃伏笔
///   4. 组装场景上下文返回
/// 当前状态: 接口定义阶段（AI-Ready 战略提前执行），返回 Mock 空数据
/// 后续实现: 阶段 6 完成 RAG 检索与上下文组装
#[tauri::command]
pub async fn get_scene_context(
    project_path: String,
    scene_id: String,
) -> Result<SceneContext, String> {
    // 接口定义阶段：返回 Mock 空数据
    // 前端可通过 TypeScript 接口 Mock 数据进行开发
    // 后续阶段 6 实现：Tantivy 索引检索 + 设定库提取 + 伏笔追踪
    let _ = project_path; // 暂未使用，保留参数以匹配接口定义
    Ok(SceneContext {
        scene_id,
        scene_title: String::new(),
        pov_character_id: None,
        pov_character_name: None,
        mood: None,
        chapter: None,
        preceding_summary: String::new(),
        present_characters: vec![],
        related_settings: vec![],
        active_foreshadowings: vec![],
    })
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
