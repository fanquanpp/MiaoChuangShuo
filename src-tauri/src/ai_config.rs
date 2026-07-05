// AI 配置持久化模块
//
// 功能概述：
// 管理 BYOK（Bring Your Own Key）模式的 AI 配置，包括 API Key、Base URL、模型名称等。
// 配置持久化到用户目录（%APPDATA%\MiaoChuangShuo\ai_config.json），API Key 采用 Base64 编码存储。
//
// 模块职责：
// 1. 定义 AiConfig 结构体（与前端 TypeScript 接口字段对齐）
// 2. 提供 get_ai_config 命令（读取配置）
// 3. 提供 set_ai_config 命令（原子写入配置）
// 4. 提供 test_ai_connection 命令（测试 LLM API 连通性）
// 5. 提供 API Key 的 Base64 编码/解码工具函数
//
// 安全说明：
// - API Key 采用 Base64 编码存储，防止偶然窥探，非真正加密
// - 配置文件位于用户私有目录，依赖文件系统权限隔离
// - 后续可升级至 Windows DPAPI 进行真正的数据保护
// - 前端永不直接接触明文 API Key，所有 LLM 调用通过后端代理

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::command;

/// AI 配置结构体（BYOK 模式）
///
/// 字段说明：
/// - apiKey: Base64 编码的 API Key（前端传入明文，后端编码后存储）
/// - baseUrl: LLM API 基础地址（兼容 OpenAI 协议，如 https://api.openai.com/v1）
/// - modelName: 模型名称（如 gpt-4o-mini、deepseek-chat、qwen-plus）
/// - enabled: AI 功能总开关
/// - temperature: 采样温度（0.0-2.0，值越大随机性越强）
/// - maxTokens: 单次生成最大 Token 数
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    /// Base64 编码的 API Key
    pub api_key: String,
    /// LLM API 基础地址（OpenAI 兼容协议）
    pub base_url: String,
    /// 模型名称
    pub model_name: String,
    /// AI 功能总开关
    pub enabled: bool,
    /// 采样温度（0.0-2.0）
    pub temperature: f64,
    /// 单次生成最大 Token 数
    pub max_tokens: u32,
}

impl Default for AiConfig {
    /// 默认配置：OpenAI 官方端点，空 API Key，功能关闭
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: "https://api.openai.com/v1".to_string(),
            model_name: "gpt-4o-mini".to_string(),
            enabled: false,
            temperature: 0.7,
            max_tokens: 2000,
        }
    }
}

/// 获取 AI 配置文件路径
///
/// 路径规则：
///   Windows: %APPDATA%\MiaoChuangShuo\ai_config.json
///   macOS:   ~/Library/Application Support/MiaoChuangShuo/ai_config.json
///   Linux:   ~/.config/MiaoChuangShuo/ai_config.json
///
/// 输入: 无
/// 输出: Result<PathBuf, String> 配置文件路径
/// 流程:
///   1. 通过 dirs::config_dir() 获取用户配置根目录
///   2. 拼接 MiaoChuangShuo 子目录
///   3. 若目录不存在则创建
///   4. 返回 ai_config.json 完整路径
fn get_config_path() -> Result<PathBuf, String> {
    let config_dir = dirs::config_dir()
        .ok_or_else(|| "无法获取用户配置目录".to_string())?;
    let app_dir = config_dir.join("MiaoChuangShuo");
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir)
            .map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    Ok(app_dir.join("ai_config.json"))
}

/// 读取 AI 配置命令
///
/// 输入: 无
/// 输出: Result<AiConfig, String> AI 配置（文件不存在时返回默认值）
/// 流程:
///   1. 获取配置文件路径
///   2. 文件不存在则返回默认配置（首次使用）
///   3. 读取并反序列化 JSON
///   4. 返回配置
#[command]
pub async fn get_ai_config() -> Result<AiConfig, String> {
    let path = get_config_path()?;
    if !path.exists() {
        return Ok(AiConfig::default());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取 AI 配置失败: {}", e))?;
    let config: AiConfig = serde_json::from_str(&content)
        .map_err(|e| format!("解析 AI 配置失败: {}", e))?;
    Ok(config)
}

/// 保存 AI 配置命令
///
/// 输入: config AI 配置（前端传入明文 API Key，此处不编码，由前端编码后传入）
/// 输出: Result<(), String> 成功返回空 Ok
/// 流程:
///   1. 获取配置文件路径
///   2. 序列化为 JSON（pretty 格式便于调试）
///   3. 原子写入：先写 .tmp 临时文件，再 rename 替换原文件
///   4. 失败时清理临时文件
#[command]
pub async fn set_ai_config(config: AiConfig) -> Result<(), String> {
    let path = get_config_path()?;
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("序列化 AI 配置失败: {}", e))?;

    // 原子写入策略：临时文件 + rename，防止崩溃导致配置文件损坏
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &content)
        .map_err(|e| format!("写入 AI 配置失败: {}", e))?;
    fs::rename(&tmp_path, &path).map_err(|e| {
        // 重命名失败时清理临时文件，避免残留
        let _ = fs::remove_file(&tmp_path);
        format!("重命名 AI 配置文件失败: {}", e)
    })?;
    Ok(())
}

/// 测试 AI 连通性命令
///
/// 输入: config AI 配置（含 API Key）
/// 输出: Result<String, String> 成功返回提示信息，失败返回错误详情
/// 流程:
///   1. 解码 API Key
///   2. 校验 API Key 非空
///   3. 构造测试请求（发送简短消息，max_tokens=20）
///   4. 发送请求并检查 HTTP 状态
///   5. 返回连通性结果
#[command]
pub async fn test_ai_connection(config: AiConfig) -> Result<String, String> {
    let api_key = decode_api_key(&config.api_key)
        .map_err(|e| format!("API Key 解码失败: {}", e))?;
    if api_key.is_empty() {
        return Err("API Key 为空，请先配置 API Key".to_string());
    }

    let url = format!(
        "{}/chat/completions",
        config.base_url.trim_end_matches('/')
    );

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": config.model_name,
        "messages": [{"role": "user", "content": "测试连通性，请回复：已连接"}],
        "max_tokens": 20,
        "temperature": 0.1
    });

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, error_text));
    }

    Ok("连接成功".to_string())
}

/// 解码 API Key（Base64 -> 明文）
///
/// 输入: encoded Base64 编码的字符串
/// 输出: Result<String, String> 解码后的明文 API Key
/// 流程:
///   1. 空字符串直接返回空
///   2. Base64 解码为字节
///   3. 转为 UTF-8 字符串
pub fn decode_api_key(encoded: &str) -> Result<String, String> {
    if encoded.is_empty() {
        return Ok(String::new());
    }
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;
    String::from_utf8(bytes).map_err(|e| format!("UTF-8 解码失败: {}", e))
}

/// 编码 API Key（明文 -> Base64）
///
/// 输入: plain 明文 API Key
/// 输出: String Base64 编码字符串
/// 流程: 将明文字节进行 Base64 标准编码
pub fn encode_api_key(plain: &str) -> String {
    general_purpose::STANDARD.encode(plain.as_bytes())
}
