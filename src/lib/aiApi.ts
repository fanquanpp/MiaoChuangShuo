// AI 辅助创作前端 API 封装（接口预留，不实装）
//
// 功能概述：
// 封装与后端 ai_commands.rs 的 Tauri invoke 调用，提供 AI 辅助功能的接口契约。
// 所有 API 在后端未实装时会抛出"未实装"错误，前端应捕获并提示用户。
//
// 模块职责：
// 1. 定义 AI 辅助请求/响应类型
// 2. 封装 6 个 AI 辅助命令的 invoke 调用
// 3. 提供 AI 配置查询/保存 API
// 4. 导出功能列表元数据供 UI 渲染

import { invoke } from "@tauri-apps/api/core";

// ===== 类型定义 =====

export interface ContinueWritingRequest {
  context: string;
  style_hint?: string;
  max_words?: number;
}

export interface ContinueWritingResponse {
  content: string;
  confidence: number;
}

export interface SummarizeRequest {
  content: string;
  max_words?: number;
}

export interface SummarizeResponse {
  summary: string;
}

export interface PolishRequest {
  content: string;
  style?: string;
}

export interface PolishResponse {
  polished: string;
  suggestions: string[];
}

export interface GenerateOutlineRequest {
  synopsis: string;
  chapter_count?: number;
  genre?: string;
}

export interface GenerateOutlineResponse {
  chapters: string[];
}

export interface CharacterSuggestRequest {
  background: string;
  existing_characters: string[];
  role_type?: string;
}

export interface CharacterSuggestResponse {
  suggestions: string[];
}

export interface CheckConsistencyRequest {
  project_path: string;
  file_path?: string;
}

export interface ConsistencyIssue {
  issue_type: string;
  description: string;
  file_path: string;
  severity: number;
}

export interface CheckConsistencyResponse {
  issues: ConsistencyIssue[];
}

export interface AiConfig {
  enabled: boolean;
  provider: string;
  endpoint: string;
  model: string;
}

// ===== 功能列表元数据 =====

export interface AiFeatureMeta {
  id: string;
  label: string;
  description: string;
  icon: string;
}

/**
 * AI 辅助功能列表
 * 用于 AiAssistantPanel 渲染功能卡片
 */
export const AI_FEATURES: AiFeatureMeta[] = [
  {
    id: "continue_writing",
    label: "智能续写",
    description: "基于当前正文上下文，AI 续写后续情节",
    icon: "PenLine",
  },
  {
    id: "summarize",
    label: "内容摘要",
    description: "生成长文的摘要，快速回顾章节要点",
    icon: "FileText",
  },
  {
    id: "polish",
    label: "文本润色",
    description: "优化文笔，支持文学化/口语化/精简风格",
    icon: "Sparkles",
  },
  {
    id: "generate_outline",
    label: "大纲生成",
    description: "根据故事简介生成章节大纲",
    icon: "ListTree",
  },
  {
    id: "character_suggest",
    label: "角色建议",
    description: "根据故事背景推荐合适的角色设定",
    icon: "Users",
  },
  {
    id: "check_consistency",
    label: "一致性检查",
    description: "检查时间线、角色设定、世界观的一致性",
    icon: "ShieldCheck",
  },
];

// ===== API 封装（均未实装，调用会抛出错误）=====

export async function aiContinueWriting(request: ContinueWritingRequest): Promise<ContinueWritingResponse> {
  return invoke<ContinueWritingResponse>("ai_continue_writing", { request });
}

export async function aiSummarize(request: SummarizeRequest): Promise<SummarizeResponse> {
  return invoke<SummarizeResponse>("ai_summarize", { request });
}

export async function aiPolish(request: PolishRequest): Promise<PolishResponse> {
  return invoke<PolishResponse>("ai_polish", { request });
}

export async function aiGenerateOutline(request: GenerateOutlineRequest): Promise<GenerateOutlineResponse> {
  return invoke<GenerateOutlineResponse>("ai_generate_outline", { request });
}

export async function aiCharacterSuggest(request: CharacterSuggestRequest): Promise<CharacterSuggestResponse> {
  return invoke<CharacterSuggestResponse>("ai_character_suggest", { request });
}

export async function aiCheckConsistency(request: CheckConsistencyRequest): Promise<CheckConsistencyResponse> {
  return invoke<CheckConsistencyResponse>("ai_check_consistency", { request });
}

export async function getAiConfig(): Promise<AiConfig> {
  return invoke<AiConfig>("get_ai_config");
}

export async function saveAiConfig(config: AiConfig): Promise<void> {
  return invoke<void>("save_ai_config", { config });
}
