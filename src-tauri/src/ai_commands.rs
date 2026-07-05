// AI 流式聊天命令模块
//
// 功能概述：
// 实现 OpenAI 兼容协议的流式聊天补全命令，通过 reqwest 发起 SSE（Server-Sent Events）
// 请求，将 LLM 增量输出通过 Tauri Event 实时推送到前端。
//
// 模块职责：
// 1. 提供 chat_completion_stream 命令（流式聊天补全）
// 2. 提供 cancel_chat_completion 命令（取消进行中的请求）
// 3. 解析 SSE 数据流，提取增量内容
// 4. 通过 Tauri Event 推送 chunk/done/error 三类事件
//
// 协议说明：
// - 采用 OpenAI Chat Completion API 兼容协议
// - 请求端点: {base_url}/chat/completions
// - 请求头: Authorization: Bearer {api_key}
// - 请求体: { model, messages, temperature, max_tokens, stream: true }
// - 响应格式: SSE 流，每行 "data: {json}"，末尾 "data: [DONE]"
//
// 事件说明：
// - ai:stream:chunk  增量内容推送（payload: StreamChunk）
// - ai:stream:done   流结束（payload: StreamChunk，done=true）
// - ai:stream:error  错误推送（payload: StreamChunk，error 字段填充）
//
// 限制说明：
// - AI-1 阶段采用全局 AtomicBool 实现取消，假设同时只有一个活跃请求
// - 后续阶段可升级为 HashMap<String, Arc<AtomicBool>> 按 request_id 管理多请求

use crate::ai_config::{decode_api_key, AiConfig};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{command, AppHandle, Emitter};

/// 全局取消标志（AI-1 阶段单请求模型）
/// 当 cancel_chat_completion 被调用时置为 true，流式循环检测后退出
static CANCEL_FLAG: AtomicBool = AtomicBool::new(false);

/// 聊天消息结构体（OpenAI 协议）
///
/// 字段说明：
/// - role: 消息角色（system/user/assistant）
/// - content: 消息内容
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    /// 消息角色（system/user/assistant）
    pub role: String,
    /// 消息内容
    pub content: String,
}

/// 流式推送载荷（统一三类事件的数据结构）
///
/// 字段说明：
/// - content: 增量文本内容（仅 ai:stream:chunk 事件填充）
/// - done: 是否流结束（chunk 事件为 false，done/error 事件为 true）
/// - error: 错误信息（仅 ai:stream:error 事件填充）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamChunk {
    /// 增量文本内容
    pub content: String,
    /// 是否流结束
    pub done: bool,
    /// 错误信息（可选）
    pub error: Option<String>,
}

/// 流式聊天补全命令
///
/// 输入:
///   app - Tauri 应用句柄（用于 emit 事件）
///   messages - 聊天消息列表（system + user + assistant 历史）
///   config - AI 配置（含 Base64 编码的 API Key）
/// 输出: Result<(), String> 成功返回空 Ok，失败返回错误信息
/// 流程:
///   1. 重置取消标志
///   2. 解码 API Key 并校验非空
///   3. 构造请求 URL（{base_url}/chat/completions）
///   4. 构造请求体（含 stream: true）
///   5. 发起 POST 请求，获取响应流
///   6. 逐块读取响应，按行解析 SSE
///   7. 每个 delta.content 通过 ai:stream:chunk 事件推送
///   8. 收到 [DONE] 或流结束时推送 ai:stream:done
///   9. HTTP 错误或解析异常推送 ai:stream:error
#[command]
pub async fn chat_completion_stream(
    app: AppHandle,
    messages: Vec<ChatMessage>,
    config: AiConfig,
) -> Result<(), String> {
    // 重置取消标志，允许新请求开始
    CANCEL_FLAG.store(false, Ordering::SeqCst);

    // 解码 API Key
    let api_key = decode_api_key(&config.api_key)
        .map_err(|e| format!("API Key 解码失败: {}", e))?;
    if api_key.is_empty() {
        return Err("API Key 为空，请先在设置中配置 API Key".to_string());
    }

    // 构造请求 URL（移除尾部斜杠避免重复）
    let url = format!(
        "{}/chat/completions",
        config.base_url.trim_end_matches('/')
    );

    // 构造请求体（OpenAI 兼容协议）
    let body = serde_json::json!({
        "model": config.model_name,
        "messages": messages.iter().map(|m| {
            serde_json::json!({"role": m.role, "content": m.content})
        }).collect::<Vec<_>>(),
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
        "stream": true
    });

    // 创建 HTTP 客户端并发起请求
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .json(&body)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| {
            let msg = format!("请求 LLM API 失败: {}", e);
            let _ = app.emit("ai:stream:error", StreamChunk {
                content: String::new(),
                done: true,
                error: Some(msg.clone()),
            });
            msg
        })?;

    // 检查 HTTP 状态码
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        let msg = format!("LLM API 返回错误 (HTTP {}): {}", status, error_text);
        let _ = app.emit("ai:stream:error", StreamChunk {
            content: String::new(),
            done: true,
            error: Some(msg.clone()),
        });
        return Err(msg);
    }

    // 获取响应字节流
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    // 逐块读取并解析 SSE
    while let Some(chunk_result) = stream.next().await {
        // 检查取消标志
        if CANCEL_FLAG.load(Ordering::SeqCst) {
            let _ = app.emit("ai:stream:done", StreamChunk {
                content: String::new(),
                done: true,
                error: Some("用户取消请求".to_string()),
            });
            return Ok(());
        }

        // 读取字节块并追加到缓冲区
        let chunk = chunk_result.map_err(|e| {
            let msg = format!("读取响应流失败: {}", e);
            let _ = app.emit("ai:stream:error", StreamChunk {
                content: String::new(),
                done: true,
                error: Some(msg.clone()),
            });
            msg
        })?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // 按行解析 SSE 协议
        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer = buffer[pos + 1..].to_string();

            // 跳过空行（SSE 协议中事件分隔符）
            if line.is_empty() {
                continue;
            }

            // 处理 data: 前缀的行
            if let Some(data) = line.strip_prefix("data: ") {
                // 检测流结束标记
                if data == "[DONE]" {
                    let _ = app.emit("ai:stream:done", StreamChunk {
                        content: String::new(),
                        done: true,
                        error: None,
                    });
                    return Ok(());
                }

                // 解析 JSON 并提取增量内容
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(delta) = json["choices"][0]["delta"]["content"].as_str() {
                        // 推送增量内容到前端
                        let _ = app.emit("ai:stream:chunk", StreamChunk {
                            content: delta.to_string(),
                            done: false,
                            error: None,
                        });
                    }
                    // 注意：部分 chunk 可能只有 role 字段（首个 chunk），无 content，跳过即可
                }
            }
            // 忽略非 data: 前缀的行（如注释、event: 等）
        }
    }

    // 流自然结束但未收到 [DONE] 标记（部分 LLM 实现可能不发 [DONE]）
    let _ = app.emit("ai:stream:done", StreamChunk {
        content: String::new(),
        done: true,
        error: None,
    });

    Ok(())
}

/// 取消聊天补全命令
///
/// 输入: 无
/// 输出: Result<(), String> 始终返回 Ok
/// 流程:
///   1. 将全局取消标志置为 true
///   2. chat_completion_stream 的循环检测到标志后退出
///   3. 推送 ai:stream:done 事件（error 字段填充"用户取消请求"）
#[command]
pub async fn cancel_chat_completion() -> Result<(), String> {
    CANCEL_FLAG.store(true, Ordering::SeqCst);
    Ok(())
}
