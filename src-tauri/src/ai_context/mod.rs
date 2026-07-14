// AI 上下文提取模块入口
//
// 功能概述：
// 为 AI 功能（续写、推演、一致性校验）提供结构化上下文数据。
// 基于 Tantivy 索引、设定库数据、人物关系图，提取场景/角色/项目级上下文。
//
// 模块职责：
// 1. 提供 get_scene_context 命令（获取场景级上下文，用于 AI 续写，AI-2 已实现）
// 2. 提供 get_character_context 命令（获取角色级上下文，用于一致性校验）
// 3. 提供 get_project_context 命令（获取项目级上下文，用于大纲生成/剧情推演）
// 4. 为 AI Prompt Builder 提供结构化数据源
//
// 模块拆分说明：
// - mod.rs: 模块入口，存放被多子模块共享的类型（CharacterBrief / SettingBrief）并 re-export 子模块公共符号
// - scene.rs: 场景级上下文（SceneContext / SceneContextRequest / get_scene_context）
// - character.rs: 角色级上下文（CharacterContext / AppearanceRecord / RelationshipBrief / get_character_context）
// - project.rs: 项目级上下文（ProjectContext / ChapterSummary / get_project_context）
//
// 对外接口保持与原 ai_context.rs 单文件版本一致：
// 调用方仍通过 `ai_context::get_scene_context` / `ai_context::SceneContext` 等路径访问。

use serde::{Deserialize, Serialize};

mod character;
mod project;
mod scene;

// 对外 re-export 子模块公共符号，保持与原单文件版本相同的对外路径
// 仅 re-export 原文件中的 pub 命令函数与 pub 结构体，辅助函数保持私有
// 注: 这些 re-export 构成 ai_context 模块的公共 API，部分类型在当前 crate 内
//     可能未被直接引用，但需保持 pub 可见性供 Tauri 命令返回值序列化与未来扩展使用
#[allow(unused_imports)]
pub use character::{
    get_character_context, AppearanceRecord, CharacterContext, RelationshipBrief,
};
#[allow(unused_imports)]
pub use project::{get_project_context, ChapterSummary, ProjectContext};
#[allow(unused_imports)]
pub use scene::{get_scene_context, SceneContext, SceneContextRequest};

// Tauri 命令宏生成的辅助符号 re-export
// 说明: #[tauri::command] 宏会在定义命令的子模块中生成 __cmd__ 与 __tauri_command_name_
//       辅助符号（均为 pub + #[doc(hidden)]）。lib.rs 的 generate_handler! 宏需要通过
//       `ai_context::__cmd__get_scene_context` 等路径访问它们，因此必须在此显式 re-export。
//       普通 `pub use scene::get_scene_context` 不会自动 re-export 这些辅助符号。
#[doc(hidden)]
pub use character::__cmd__get_character_context;
#[doc(hidden)]
pub use character::__tauri_command_name_get_character_context;
#[doc(hidden)]
pub use project::__cmd__get_project_context;
#[doc(hidden)]
pub use project::__tauri_command_name_get_project_context;
#[doc(hidden)]
pub use scene::__cmd__get_scene_context;
#[doc(hidden)]
pub use scene::__tauri_command_name_get_scene_context;

/// 角色简要信息（用于场景上下文中的出场角色列表与项目上下文中的主要角色列表）
///
/// 该类型被 scene.rs 与 project.rs 共同使用，因此定义在 mod.rs 作为共享类型
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

/// 设定简要信息（用于场景上下文中的相关设定引用与项目上下文中的关键设定列表）
///
/// 该类型被 scene.rs 与 project.rs 共同使用，因此定义在 mod.rs 作为共享类型
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
