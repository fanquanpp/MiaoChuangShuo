// 喵创说 AI 上下文 API
//
// 模块职责：
// 为 AI 功能（续写、推演、一致性校验）提供结构化上下文数据。
// 包含场景上下文、角色上下文、项目全局上下文三类数据组装接口。
//
// 设计说明：
// - 所有结构使用 camelCase 字段名（后端使用 #[serde(rename_all = "camelCase")]）
// - AI-Ready: SceneContext 的 povCharacterId 和 mood 为强类型化字段
// - 接口提前定义，确保 AI 功能上线时前端无需重构
//
// 依赖：
// - @tauri-apps/api/core 的 invoke 调用 Rust 后端

import { invoke } from "@tauri-apps/api/core";

// 角色简要信息（用于场景上下文中的出场角色列表）
export interface CharacterBrief {
  // 角色 ID（设定库 UUID）
  id: string;
  // 角色名称
  name: string;
  // 角色别名列表（AI-Ready: 用于实体识别匹配）
  aliases: string[];
  // 角色简介（一句话描述）
  summary: string;
}

// 设定简要信息（用于场景上下文中的相关设定引用）
export interface SettingBrief {
  // 设定 ID
  id: string;
  // 设定名称
  name: string;
  // 设定类型（角色/地点/物品/组织/概念）
  category: string;
  // 设定摘要
  summary: string;
}

// 场景上下文（AI 续写的核心数据）
// AI 价值：这是 AI 理解"剧情结构"的锚点
export interface SceneContext {
  // 场景 ID（关联 sceneBreak 节点 id）
  sceneId: string;
  // 场景标题
  sceneTitle: string;
  // AI-Ready: 视角角色 ID（强类型化，关联设定库 UUID）
  povCharacterId: string | null;
  // 视角角色名称（从设定库解析）
  povCharacterName: string | null;
  // AI-Ready: 氛围（强类型化，如"紧张"/"温馨"/"悲伤"）
  mood: string | null;
  // 场景所在章节
  chapter: string | null;
  // 前文摘要（最近 N 个 Chunk 的拼接，从 Tantivy 索引检索）
  precedingSummary: string;
  // 场景内出场角色列表（从设定库提取）
  presentCharacters: CharacterBrief[];
  // 相关设定引用（从设定库提取，如地点/物品/组织）
  relatedSettings: SettingBrief[];
  // AI-2 层1: 当前场景正文文本（从 .pmd ProseMirror JSON 提取的纯文本）
  currentSceneText: string;
}

// 角色出场记录
export interface AppearanceRecord {
  // 文件路径
  filePath: string;
  // 文件名
  fileName: string;
  // 出场文本片段（匹配的 Chunk 文本）
  excerpt: string;
  // AI-Ready: 场景 ID（关联 sceneBreak 节点）
  sceneId: string | null;
}

// 角色关系简要
export interface RelationshipBrief {
  // 目标角色 ID
  targetId: string;
  // 目标角色名称
  targetName: string;
  // 关系类型（朋友/敌人/师徒/恋人等）
  relationType: string;
  // 关系描述
  description: string;
}

// 角色上下文（AI 角色一致性校验的核心数据）
// AI 价值：避免"角色幻觉"（如把 A 的性格安在 B 身上）
export interface CharacterContext {
  // 角色 ID（设定库 UUID）
  characterId: string;
  // 角色名称
  name: string;
  // 角色别名列表
  aliases: string[];
  // 角色设定全文（从设定库读取）
  fullProfile: string;
  // 角色出场记录（从 Tantivy 索引检索，按时间倒序）
  appearanceRecords: AppearanceRecord[];
  // 角色关系列表（从人物关系图读取）
  relationships: RelationshipBrief[];
}

// 章节摘要
export interface ChapterSummary {
  // 章节名
  chapterName: string;
  // 文件路径
  filePath: string;
  // 摘要文本（前 200 字）
  summary: string;
  // 字数
  wordCount: number;
}

// 项目全局上下文（AI 大纲生成、剧情推演的核心数据）
// AI 价值：提供全局视角的项目信息
export interface ProjectContext {
  // 项目名称
  projectName: string;
  // 项目类型（novel/script/essay）
  projectType: string;
  // 项目描述
  description: string;
  // 主要角色列表（从设定库提取，按重要度排序）
  mainCharacters: CharacterBrief[];
  // 主要设定列表（从设定库提取，如世界观/地点/组织）
  keySettings: SettingBrief[];
  // 已完成章节摘要（从 Tantivy 索引检索，前 200 字）
  chapterSummaries: ChapterSummary[];
  // 总字数
  totalWords: number;
  // 章节数
  chapterCount: number;
}

// 场景上下文请求参数（AI-2 前端调用入口）
// 字段说明:
//   - projectPath: 项目根路径
//   - chapterId: 章节标识（文件相对路径，如 "正文/第一章.pmd"）
//   - sceneIndex: 场景索引（0-based，由 getCurrentSceneLocation 计算）
export interface SceneContextRequest {
  projectPath: string;
  chapterId: string;
  sceneIndex: number;
}

// 获取场景上下文（AI-2 四层上下文组装）
// 输入: req 场景上下文请求（项目路径 + 章节 ID + 场景索引）
// 输出: Promise<SceneContext> 场景上下文（含 4 层数据）
// 用途: AI 续写时提供当前场景正文/出场角色/前文摘要
// 实现状态: AI-2 已实现后端 4 层组装（读取 .pmd + 设定库）
export async function getSceneContext(
  req: SceneContextRequest
): Promise<SceneContext> {
  return invoke<SceneContext>("get_scene_context", { req });
}

// 获取角色上下文
// 输入: projectPath 项目根路径, characterId 角色 ID
// 输出: Promise<CharacterContext> 角色上下文
// 用途: AI 角色一致性校验，提供角色设定全文与出场记录
// 当前状态: 后端返回 Mock 空数据，前端可 Mock 数据进行开发
export async function getCharacterContext(
  projectPath: string,
  characterId: string
): Promise<CharacterContext> {
  return invoke<CharacterContext>("get_character_context", { projectPath, characterId });
}

// 获取项目全局上下文
// 输入: projectPath 项目根路径
// 输出: Promise<ProjectContext> 项目上下文
// 用途: AI 大纲生成、剧情推演，提供全局视角的项目信息
// 当前状态: 后端返回 Mock 空数据，前端可 Mock 数据进行开发
export async function getProjectContext(
  projectPath: string
): Promise<ProjectContext> {
  return invoke<ProjectContext>("get_project_context", { projectPath });
}
