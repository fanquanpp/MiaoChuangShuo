// AI 辅助创作中心后端命令模块（接口预留，不实装）
//
// 功能概述：
// 为 AI 辅助创作功能预留后端命令骨架，所有命令返回"未实装"错误。
// 后续接入实际 AI 服务时，只需替换命令实现，前端无需改动。
//
// 模块职责：
// 1. 定义 AI 辅助命令的空骨架
// 2. 统一返回"未实装"错误，便于前端识别
// 3. 文档化未来 AI 功能的输入输出契约
//
// 设计原则：
// - 接口先行：命令签名与未来实装保持一致
// - 错误明确：返回清晰的"未实装"提示
// - 零副作用：不调用任何外部 API，不存储任何数据

use serde::{Deserialize, Serialize};

/// AI 辅助功能未实装错误信息
const NOT_IMPLEMENTED: &str = "AI 辅助功能尚未实装，敬请期待后续版本";

/// AI 续写请求参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinueWritingRequest {
    /// 当前正文上下文
    pub context: String,
    /// 续写风格提示（可选）
    pub style_hint: Option<String>,
    /// 续写最大字数
    pub max_words: Option<u32>,
}

/// AI 续写响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinueWritingResponse {
    /// 续写内容
    pub content: String,
    /// 置信度（0-1）
    pub confidence: f32,
}

/// AI 续写命令（接口预留）
/// 输入: request 续写请求参数
/// 输出: Result<ContinueWritingResponse, String> 未实装错误
#[tauri::command]
pub fn ai_continue_writing(_request: ContinueWritingRequest) -> Result<ContinueWritingResponse, String> {
    Err(NOT_IMPLEMENTED.to_string())
}

/// AI 摘要请求参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummarizeRequest {
    /// 待摘要的正文
    pub content: String,
    /// 摘要最大字数
    pub max_words: Option<u32>,
}

/// AI 摘要响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummarizeResponse {
    /// 摘要内容
    pub summary: String,
}

/// AI 摘要命令（接口预留）
#[tauri::command]
pub fn ai_summarize(_request: SummarizeRequest) -> Result<SummarizeResponse, String> {
    Err(NOT_IMPLEMENTED.to_string())
}

/// AI 润色请求参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolishRequest {
    /// 待润色的正文
    pub content: String,
    /// 润色风格（如"文学化"/"口语化"/"精简"）
    pub style: Option<String>,
}

/// AI 润色响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolishResponse {
    /// 润色后的内容
    pub polished: String,
    /// 修改建议说明
    pub suggestions: Vec<String>,
}

/// AI 润色命令（接口预留）
#[tauri::command]
pub fn ai_polish(_request: PolishRequest) -> Result<PolishResponse, String> {
    Err(NOT_IMPLEMENTED.to_string())
}

/// AI 生成大纲请求参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateOutlineRequest {
    /// 故事简介
    pub synopsis: String,
    /// 目标章节数
    pub chapter_count: Option<u32>,
    /// 文体类型
    pub genre: Option<String>,
}

/// AI 生成大纲响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateOutlineResponse {
    /// 章节大纲列表
    pub chapters: Vec<String>,
}

/// AI 生成大纲命令（接口预留）
#[tauri::command]
pub fn ai_generate_outline(_request: GenerateOutlineRequest) -> Result<GenerateOutlineResponse, String> {
    Err(NOT_IMPLEMENTED.to_string())
}

/// AI 角色建议请求参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterSuggestRequest {
    /// 故事背景
    pub background: String,
    /// 已有角色列表
    pub existing_characters: Vec<String>,
    /// 需要的角色类型（如"反派"/"导师"/"配角"）
    pub role_type: Option<String>,
}

/// AI 角色建议响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterSuggestResponse {
    /// 角色建议列表
    pub suggestions: Vec<String>,
}

/// AI 角色建议命令（接口预留）
#[tauri::command]
pub fn ai_character_suggest(_request: CharacterSuggestRequest) -> Result<CharacterSuggestResponse, String> {
    Err(NOT_IMPLEMENTED.to_string())
}

/// AI 一致性检查请求参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckConsistencyRequest {
    /// 项目路径
    pub project_path: String,
    /// 待检查的文件路径（可选，为空则检查全项目）
    pub file_path: Option<String>,
}

/// AI 一致性问题
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsistencyIssue {
    /// 问题类型（如"时间线冲突"/"角色矛盾"/"设定不一致"）
    pub issue_type: String,
    /// 问题描述
    pub description: String,
    /// 相关文件路径
    pub file_path: String,
    /// 严重程度（1-5）
    pub severity: u32,
}

/// AI 一致性检查响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckConsistencyResponse {
    /// 发现的问题列表
    pub issues: Vec<ConsistencyIssue>,
}

/// AI 一致性检查命令（接口预留）
#[tauri::command]
pub fn ai_check_consistency(_request: CheckConsistencyRequest) -> Result<CheckConsistencyResponse, String> {
    Err(NOT_IMPLEMENTED.to_string())
}

/// AI 配置查询（接口预留）
/// 输出: Result<AiConfig, String> 当前 AI 配置（未实装时返回默认空配置）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    /// 是否启用 AI 辅助
    pub enabled: bool,
    /// AI 服务提供商（如"openai"/"anthropic"/"local"）
    pub provider: String,
    /// API 端点
    pub endpoint: String,
    /// 模型名称
    pub model: String,
}

/// AI 配置查询命令（接口预留）
/// 返回默认空配置，表示功能尚未实装
#[tauri::command]
pub fn get_ai_config() -> Result<AiConfig, String> {
    Ok(AiConfig {
        enabled: false,
        provider: String::new(),
        endpoint: String::new(),
        model: String::new(),
    })
}

/// AI 配置保存命令（接口预留）
/// 输入: config AI 配置
/// 输出: Result<(), String> 未实装错误
#[tauri::command]
pub fn save_ai_config(_config: AiConfig) -> Result<(), String> {
    Err(NOT_IMPLEMENTED.to_string())
}
