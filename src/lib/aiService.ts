// AI 服务封装层
//
// 功能概述：
// 封装与后端 ai_commands.rs / ai_config.rs 的 Tauri IPC 交互，提供统一的 AI 功能入口。
// 包括流式聊天补全（SSE 事件监听）、配置管理、连通性测试三类能力。
//
// 模块职责：
// 1. 封装 chat_completion_stream 命令，将 Tauri Event 转换为 Promise + 回调模式
// 2. 封装 cancel_chat_completion 命令（按 request_id 取消指定流式请求）
// 3. 封装 get_ai_config / set_ai_config / test_ai_connection 配置管理命令
// 4. 提供 TypeScript 类型定义（与后端 Rust 结构体字段对齐）
//
// 设计说明：
// - 前端永不直接接触明文 API Key，所有 LLM 调用通过后端代理
// - 流式补全采用"事件驱动"模型：调用方注册回调，Promise 在流结束时 resolve/reject
// - 事件监听在流结束（done/error）后自动清理，避免内存泄漏
// - AI-2 阶段采用 request_id 粒度取消机制，支持多请求并发精准取消

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
  /** Base64 编码的 API Key（前端读写使用，后端透明处理钥匙串存储） */
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
  /** 供应商标识（前端 providerRegistry.ts 中的 provider.id） */
  providerId: string;
  /** 是否使用系统钥匙串存储 API Key */
  useSecureStorage: boolean;
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
  /** Token 用量统计（可选，done 事件填充） */
  usage: UsageInfo | null;
}

/**
 * Token 用量统计信息（OpenAI 协议 usage 字段）
 * 与后端 ai_commands.rs UsageInfo 结构体字段对齐
 */
export interface UsageInfo {
  /** Prompt Token 数（输入） */
  promptTokens: number;
  /** Completion Token 数（输出） */
  completionTokens: number;
  /** 总 Token 数 */
  totalTokens: number;
}

/**
 * 连通性测试结果（增强版，返回延迟与模型响应）
 * 与后端 ai_config.rs ConnectionTestResult 结构体字段对齐
 */
export interface ConnectionTestResult {
  /** 是否连通成功 */
  success: boolean;
  /** 结果消息 */
  message: string;
  /** 请求耗时（毫秒） */
  latencyMs: number;
  /** 模型返回的文本内容（成功时填充） */
  modelResponse: string | null;
}

/**
 * 模型信息（OpenAI /v1/models 端点返回）
 * 与后端 ai_config.rs ModelInfo 结构体字段对齐
 */
export interface ModelInfo {
  /** 模型 ID（如 deepseek-chat） */
  id: string;
  /** 模型所属对象（通常是 model） */
  object: string;
  /** 模型创建时间戳（Unix 秒） */
  created: number | null;
  /** 模型拥有者（如 deepseek、openai） */
  ownedBy: string | null;
}

/**
 * 流式补全回调接口
 */
export interface StreamCallbacks {
  /** 增量内容回调（每个 chunk 触发一次） */
  onChunk: (content: string) => void;
  /** 流结束回调（可选，error 字段表示取消或异常结束，usage 包含 Token 统计） */
  onDone?: (error?: string, usage?: UsageInfo | null) => void;
}

/**
 * 生成请求唯一标识（UUID v4）
 *
 * 输出: string 36 字符 UUID 字符串
 * 说明: 优先使用 Web Crypto API 的 crypto.randomUUID()，
 *   若运行环境不支持则回退到基于 Date.now + Math.random 的伪 UUID
 */
export function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // 回退方案：拼接时间戳与随机数，保证基本唯一性
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * 流式聊天补全
 *
 * 输入:
 *   messages - 聊天消息列表（system + user + assistant 历史）
 *   config - AI 配置（含 Base64 编码的 API Key）
 *   callbacks - 回调（onChunk 必填，onDone 可选）
 *   requestId - 请求唯一标识（用于精准取消，由调用方生成）
 *   signal - 可选的 AbortSignal（Task 2.5：前端自主中断）
 * 输出: Promise<void> 流正常结束 resolve，错误 reject；signal abort 时 reject(AbortError 字符串)
 * 流程:
 *   1. 注册 ai:stream:chunk / ai:stream:done / ai:stream:error 三个事件监听
 *   2. 调用后端 chat_completion_stream 命令发起流式请求（携带 requestId）
 *   3. chunk 事件触发 onChunk 回调
 *   4. done 事件触发 onDone 回调并 resolve Promise
 *   5. error 事件 reject Promise
 *   6. 流结束后自动清理事件监听，避免内存泄漏
 *   7. 若 invoke 启动失败（如 API Key 为空），直接 reject
 *   8. 若 signal 已 abort 或在流过程中 abort，主动 cleanup 并 reject（AbortError）
 * 说明:
 *   - Task 2.5 偏差报备：原描述采用 fetch signal，但本项目使用 Tauri IPC + 事件驱动模型，
 *     无法直接复用 fetch signal；改为在 signal abort 时主动 unlisten 事件并 reject，
 *     实现等价的"前端自主中断"语义。
 */
export async function streamChatCompletion(
  messages: ChatMessage[],
  config: AiConfig,
  callbacks: StreamCallbacks,
  requestId: string,
  signal?: AbortSignal
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
  let unlistenAbort: (() => void) | null = null;
  let settled = false;

  /** 清理所有事件监听与 abort 监听器 */
  const cleanup = (): void => {
    unlistenChunk?.();
    unlistenDone?.();
    unlistenError?.();
    if (unlistenAbort) {
      signal?.removeEventListener("abort", unlistenAbort);
      unlistenAbort = null;
    }
  };

  // 若进入时 signal 已 abort，立即 reject，避免注册无效监听
  if (signal?.aborted) {
    rejectPromise("AbortError");
    return promise;
  }

  // 注册 chunk 事件监听（增量内容推送）
  unlistenChunk = await listen<StreamChunk>("ai:stream:chunk", (event) => {
    if (!settled && event.payload.content) {
      callbacks.onChunk(event.payload.content);
    }
  });

  // 注册 done 事件监听（流结束，含正常结束与用户取消，附带 usage 统计）
  unlistenDone = await listen<StreamChunk>("ai:stream:done", (event) => {
    if (settled) return;
    settled = true;
    cleanup();
    callbacks.onDone?.(event.payload.error ?? undefined, event.payload.usage);
    resolvePromise();
  });

  // 注册 error 事件监听（LLM API 错误或解析异常）
  unlistenError = await listen<StreamChunk>("ai:stream:error", (event) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectPromise(event.payload.error ?? "未知错误");
  });

  // Task 2.5：注册 abort 监听，signal 触发时主动 cleanup 并 reject
  // 让前端能脱离后端 cancel_chat_completion 自主中断流式请求
  if (signal) {
    unlistenAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      // 通知调用方为用户主动取消，与 DOMException.name === "AbortError" 语义对齐
      rejectPromise("AbortError");
    };
    signal.addEventListener("abort", unlistenAbort);
  }

  // 异步调用后端命令（不 await，通过事件驱动完成）
  // 携带 requestId 供后端注册按请求粒度的取消令牌
  // 若启动失败（如 API Key 为空、网络错误），直接 reject
  invoke("chat_completion_stream", { messages, config, requestId }).catch((err) => {
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
 * 输入: requestId 请求唯一标识（与 streamChatCompletion 调用时传入的值一致）
 * 输出: Promise<void> 取消命令完成
 * 流程:
 *   1. 调用后端 cancel_chat_completion 命令，传入 requestId
 *   2. 后端在取消令牌映射表中查找对应 request_id
 *   3. 将对应令牌置为 true，流式循环检测后退出
 *   4. 推送 done 事件（error="用户取消请求"）
 * 说明: 仅取消指定请求，不影响其他并发请求；未找到 requestId 视为请求已结束，幂等安全
 */
export async function cancelStreamCompletion(requestId: string): Promise<void> {
  await invoke("cancel_chat_completion", { requestId });
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
 * 测试 AI 连通性（增强版，返回延迟与模型响应）
 *
 * 输入: config AI 配置
 * 输出: Promise<ConnectionTestResult> 测试结果（含 success/message/latencyMs/modelResponse）
 */
export async function testAiConnection(config: AiConfig): Promise<ConnectionTestResult> {
  return invoke<ConnectionTestResult>("test_ai_connection", { config });
}

/**
 * 拉取可用模型列表
 *
 * 输入: config AI 配置（含 API Key 与 Base URL）
 * 输出: Promise<ModelInfo[]> 模型列表（按 id 排序）
 * 说明: 调用 OpenAI 兼容 /v1/models 端点，部分供应商可能不支持
 */
export async function listModels(config: AiConfig): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("list_models", { config });
}
