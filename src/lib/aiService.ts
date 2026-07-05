// AI 服务封装层
//
// 功能概述：
// 封装与后端 ai_commands.rs / ai_config.rs 的 Tauri IPC 交互，提供统一的 AI 功能入口。
// 包括流式聊天补全（SSE 事件监听）、配置管理、连通性测试三类能力。
//
// 模块职责：
// 1. 封装 chat_completion_stream 命令，将 Tauri Event 转换为 Promise + 回调模式
// 2. 封装 cancel_chat_completion 命令（取消进行中的流式请求）
// 3. 封装 get_ai_config / set_ai_config / test_ai_connection 配置管理命令
// 4. 提供 TypeScript 类型定义（与后端 Rust 结构体字段对齐）
//
// 设计说明：
// - 前端永不直接接触明文 API Key，所有 LLM 调用通过后端代理
// - 流式补全采用"事件驱动"模型：调用方注册回调，Promise 在流结束时 resolve/reject
// - 事件监听在流结束（done/error）后自动清理，避免内存泄漏
// - AI-1 阶段假设同时只有一个活跃请求（后端使用全局 AtomicBool 取消）

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * 聊天消息结构（OpenAI 协议）
 * 与后端 ai_commands.rs ChatMessage 结构体字段对齐
 */
export interface ChatMessage {
  /** 消息角色：system=系统提示 / user=用户输入 / assistant=AI 回复 */
  role: "system" | "user" | "assistant";
  /** 消息内容 */
  content: string;
}

/**
 * AI 配置接口（BYOK 模式）
 * 与后端 ai_config.rs AiConfig 结构体字段对齐
 */
export interface AiConfig {
  /** Base64 编码的 API Key */
  apiKey: string;
  /** LLM API 基础地址（OpenAI 兼容协议） */
  baseUrl: string;
  /** 模型名称 */
  modelName: string;
  /** AI 功能总开关 */
  enabled: boolean;
  /** 采样温度（0.0-2.0） */
  temperature: number;
  /** 单次生成最大 Token 数 */
  maxTokens: number;
}

/**
 * 流式推送载荷（与后端 StreamChunk 结构体字段对齐）
 */
interface StreamChunk {
  /** 增量文本内容 */
  content: string;
  /** 是否流结束 */
  done: boolean;
  /** 错误信息（可选） */
  error: string | null;
}

/**
 * 流式补全回调接口
 */
export interface StreamCallbacks {
  /** 增量内容回调（每个 chunk 触发一次） */
  onChunk: (content: string) => void;
  /** 流结束回调（可选，error 字段表示取消或异常结束） */
  onDone?: (error?: string) => void;
}

/**
 * 流式聊天补全
 *
 * 输入:
 *   messages - 聊天消息列表（system + user + assistant 历史）
 *   config - AI 配置（含 Base64 编码的 API Key）
 *   callbacks - 回调（onChunk 必填，onDone 可选）
 * 输出: Promise<void> 流正常结束 resolve，错误 reject
 * 流程:
 *   1. 注册 ai:stream:chunk / ai:stream:done / ai:stream:error 三个事件监听
 *   2. 调用后端 chat_completion_stream 命令发起流式请求
 *   3. chunk 事件触发 onChunk 回调
 *   4. done 事件触发 onDone 回调并 resolve Promise
 *   5. error 事件 reject Promise
 *   6. 流结束后自动清理事件监听，避免内存泄漏
 *   7. 若 invoke 启动失败（如 API Key 为空），直接 reject
 */
export async function streamChatCompletion(
  messages: ChatMessage[],
  config: AiConfig,
  callbacks: StreamCallbacks
): Promise<void> {
  let resolvePromise!: () => void;
  let rejectPromise!: (err: string) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  let unlistenChunk: UnlistenFn | null = null;
  let unlistenDone: UnlistenFn | null = null;
  let unlistenError: UnlistenFn | null = null;
  let settled = false;

  /** 清理所有事件监听 */
  const cleanup = (): void => {
    unlistenChunk?.();
    unlistenDone?.();
    unlistenError?.();
  };

  // 注册 chunk 事件监听（增量内容推送）
  unlistenChunk = await listen<StreamChunk>("ai:stream:chunk", (event) => {
    if (!settled && event.payload.content) {
      callbacks.onChunk(event.payload.content);
    }
  });

  // 注册 done 事件监听（流结束，含正常结束与用户取消）
  unlistenDone = await listen<StreamChunk>("ai:stream:done", (event) => {
    if (settled) return;
    settled = true;
    cleanup();
    callbacks.onDone?.(event.payload.error ?? undefined);
    resolvePromise();
  });

  // 注册 error 事件监听（LLM API 错误或解析异常）
  unlistenError = await listen<StreamChunk>("ai:stream:error", (event) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectPromise(event.payload.error ?? "未知错误");
  });

  // 异步调用后端命令（不 await，通过事件驱动完成）
  // 若启动失败（如 API Key 为空、网络错误），直接 reject
  invoke("chat_completion_stream", { messages, config }).catch((err) => {
    if (!settled) {
      settled = true;
      cleanup();
      rejectPromise(String(err));
    }
  });

  return promise;
}

/**
 * 取消进行中的流式请求
 *
 * 输入: 无
 * 输出: Promise<void> 取消命令完成
 * 流程:
 *   1. 调用后端 cancel_chat_completion 命令
 *   2. 后端将全局取消标志置为 true
 *   3. 流式循环检测到标志后退出，推送 done 事件（error="用户取消请求"）
 */
export async function cancelStreamCompletion(): Promise<void> {
  await invoke("cancel_chat_completion");
}

/**
 * 读取 AI 配置
 *
 * 输入: 无
 * 输出: Promise<AiConfig> AI 配置（文件不存在时返回默认值）
 */
export async function getAiConfig(): Promise<AiConfig> {
  return invoke<AiConfig>("get_ai_config");
}

/**
 * 保存 AI 配置
 *
 * 输入: config AI 配置（apiKey 字段需为 Base64 编码）
 * 输出: Promise<void> 保存完成
 */
export async function setAiConfig(config: AiConfig): Promise<void> {
  await invoke("set_ai_config", { config });
}

/**
 * 测试 AI 连通性
 *
 * 输入: config AI 配置
 * 输出: Promise<string> 成功返回提示信息，失败抛出错误
 */
export async function testAiConnection(config: AiConfig): Promise<string> {
  return invoke<string>("test_ai_connection", { config });
}
