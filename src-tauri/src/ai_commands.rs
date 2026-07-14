// AI 流式聊天命令模块
//
// 功能概述：
// 实现 OpenAI 兼容协议的流式聊天补全命令，通过 reqwest 发起 SSE（Server-Sent Events）
// 请求，将 LLM 增量输出通过 Tauri Event 实时推送到前端。
//
// 模块职责：
// 1. 提供 chat_completion_stream 命令（流式聊天补全，按 request_id 粒度管理取消）
// 2. 提供 cancel_chat_completion 命令（按 request_id 精准取消指定请求）
// 3. 解析 SSE 数据流，使用 chunk 边界缓冲区拼接不完整的事件
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
// 取消机制说明（AI-2 阶段升级）：
// - 取消标志由全局 AtomicBool 升级为 HashMap<String, Arc<AtomicBool>>
// - 每个流式请求通过 request_id 注册独立的取消令牌
// - cancel_chat_completion 按 request_id 精准取消，不影响其他并发请求
// - 令牌在流式结束（正常/异常/取消）时自动清理，避免内存泄漏

use crate::ai_config::{decode_api_key, AiConfig};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{command, AppHandle, Emitter};

/// 单个请求的取消令牌类型
/// 使用 Arc<AtomicBool> 实现轻量级跨线程取消信号
type CancelToken = Arc<AtomicBool>;

/// 获取全局取消令牌映射表的不可变引用
///
/// 使用 OnceLock 实现延迟初始化，避免静态变量初始化顺序问题。
/// 映射表以 request_id 为键，存储每个活跃流式请求的取消令牌。
/// 使用 std::sync::Mutex 而非 tokio::sync::Mutex，因为锁定时间极短
/// （仅 HashMap insert/remove/get），无需跨 await 持锁。
fn cancel_tokens() -> &'static Mutex<HashMap<String, CancelToken>> {
    static TOKENS: OnceLock<Mutex<HashMap<String, CancelToken>>> = OnceLock::new();
    TOKENS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 注册取消令牌
///
/// 输入: request_id 请求标识（由前端生成的 UUID）
/// 输出: CancelToken 供流式循环检测的令牌副本（Arc 克隆）
/// 流程:
///   1. 创建初始为 false 的 AtomicBool
///   2. 插入到全局映射表
///   3. 返回 Arc 副本供流式循环持有
fn register_cancel_token(request_id: &str) -> CancelToken {
    let token = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = cancel_tokens().lock() {
        map.insert(request_id.to_string(), token.clone());
    }
    token
}

/// 移除取消令牌（流式结束时调用，避免内存泄漏）
///
/// 输入: request_id 请求标识
/// 说明: 无论令牌是否存在都安全调用，移除后 Arc 引用计数归零自动释放
fn remove_cancel_token(request_id: &str) {
    if let Ok(mut map) = cancel_tokens().lock() {
        map.remove(request_id);
    }
}

/// 触发指定请求的取消信号
///
/// 输入: request_id 请求标识
/// 输出: bool 是否成功找到并触发取消
/// 说明: 未找到返回 false（如请求已结束或 request_id 错误），调用方应忽略此情况
fn trigger_cancel(request_id: &str) -> bool {
    if let Ok(map) = cancel_tokens().lock() {
        if let Some(token) = map.get(request_id) {
            token.store(true, Ordering::SeqCst);
            return true;
        }
    }
    false
}

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
///   request_id - 请求唯一标识（前端生成 UUID，用于精准取消）
/// 输出: Result<(), String> 成功返回空 Ok，失败返回错误信息
/// 流程:
///   1. 按 request_id 注册取消令牌到全局映射表
///   2. 解码 API Key 并校验非空
///   3. 构造请求 URL（{base_url}/chat/completions）
///   4. 构造请求体（含 stream: true）
///   5. 发起 POST 请求，获取响应流
///   6. 逐块读取响应，使用缓冲区拼接 chunk 边界不完整的 SSE 事件
///   7. 每次循环检测取消令牌，被取消时推送 done 并清理
///   8. 每个 delta.content 通过 ai:stream:chunk 事件推送
///   9. 收到 [DONE] 或流结束时推送 ai:stream:done 并清理令牌
///   10. HTTP 错误或解析异常推送 ai:stream:error 并清理令牌
#[command]
pub async fn chat_completion_stream(
    app: AppHandle,
    messages: Vec<ChatMessage>,
    config: AiConfig,
    request_id: String,
) -> Result<(), String> {
    // 按 request_id 注册取消令牌（支持多请求并发，互不影响）
    let cancel_token = register_cancel_token(&request_id);

    // 解码 API Key
    let api_key = decode_api_key(&config.api_key)
        .map_err(|e| format!("API Key 解码失败: {}", e))?;
    if api_key.is_empty() {
        remove_cancel_token(&request_id);
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
            // 清理取消令牌，避免映射表残留
            remove_cancel_token(&request_id);
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
        remove_cancel_token(&request_id);
        return Err(msg);
    }

    // 获取响应字节流
    let mut stream = response.bytes_stream();
    // SSE chunk 边界缓冲区：HTTP 流可能将一个 SSE 事件分割到多个 chunk
    // 使用 buffer 累积未解析完成的内容，仅在遇到换行符时处理完整行
    let mut buffer = String::new();

    // 逐块读取并解析 SSE
    while let Some(chunk_result) = stream.next().await {
        // 检查取消标志（按 request_id 粒度，不影响其他并发请求）
        if cancel_token.load(Ordering::SeqCst) {
            let _ = app.emit("ai:stream:done", StreamChunk {
                content: String::new(),
                done: true,
                error: Some("用户取消请求".to_string()),
            });
            remove_cancel_token(&request_id);
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
            // 清理取消令牌，避免映射表残留
            remove_cancel_token(&request_id);
            msg
        })?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // 按行解析 SSE 协议
        // 使用 drain 而非 to_string() 避免 O(n²) 内存分配
        // buffer 始终保留最后一段不含换行符的不完整数据，等下一个 chunk 拼接
        while let Some(pos) = buffer.find('\n') {
            // 提取一行内容（不含换行符），同时从缓冲区移除
            let line: String = buffer.drain(..pos).collect();
            // 移除换行符本身
            if !buffer.is_empty() {
                buffer.remove(0);
            }
            // 兼容 CRLF 行尾（部分 SSE 服务器使用 \r\n），并去除首尾空白
            let line = line.trim_end_matches('\r').trim();

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
                    remove_cancel_token(&request_id);
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
    // 清理取消令牌，避免内存泄漏
    remove_cancel_token(&request_id);

    Ok(())
}

/// 取消聊天补全命令
///
/// 输入: request_id 请求唯一标识（与 chat_completion_stream 调用时传入的值一致）
/// 输出: Result<(), String> 始终返回 Ok（未找到令牌视为请求已结束，幂等安全）
/// 流程:
///   1. 在全局映射表中查找 request_id 对应的取消令牌
///   2. 将令牌置为 true，通知流式循环退出
///   3. 流式循环检测到取消后推送 ai:stream:done（error="用户取消请求"）
///   4. 令牌清理由流式循环完成（避免重复清理）
/// 说明: 仅取消指定请求，不影响其他并发的流式请求
#[command]
pub async fn cancel_chat_completion(request_id: String) -> Result<(), String> {
    trigger_cancel(&request_id);
    Ok(())
}
