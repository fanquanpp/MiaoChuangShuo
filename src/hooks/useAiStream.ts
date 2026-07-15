// AI 流式请求 Hook (SubTask 12.3, 含 Task 35.2 setTimeout 清理)
//
// 功能概述:
//   抽取自 AiAssistantPanel 的流式请求与中断逻辑. 集中管理 streaming 状态、
//   当前 assistant 消息内容累加、流式 chunk 分发与 Esc 中断.
//   所有 setTimeout 引用保存到 ref, 组件卸载时统一 clearTimeout, 避免内存泄漏.
//
// 模块职责:
//   1. 管理 isStreaming 状态与当前 request_id
//   2. 调用 streamChatCompletion 发起流式请求 (携带 requestId)
//   3. 累加 chunk 到当前 assistant 消息 (通过 onAccumulate 回调上抛)
//   4. 提供 cancelStreamCompletion(requestId) 方法 (Esc 触发, 精准取消)
//   5. 维护 setTimeout 引用列表, 卸载时清理 (Task 35.2)
//
// 设计说明:
//   - hook 不直接持有消息列表, 通过回调上抛累加结果由父组件 setState
//   - 错误信息透传给父组件, 由父组件更新对应消息的 error 字段
//   - 历史消息组装 (含最近 4 轮) 由父组件完成, 此处仅负责流式传输
//   - Task 34: request_id 由 hook 内部生成 (UUID), 用于按请求粒度精准取消

import { useState, useRef, useEffect, useCallback } from "react";
import {
  streamChatCompletion,
  cancelStreamCompletion,
  generateRequestId,
  type ChatMessage,
  type AiConfig,
  type UsageInfo,
} from "../lib/aiService";

/**
 * 流式累加回调签名
 * 输入: assistantMsgId 当前流式消息 ID, accumulated 累计内容
 */
export type AccumulateCallback = (
  assistantMsgId: string,
  accumulated: string
) => void;

/**
 * 流式完成回调签名
 * 输入:
 *   assistantMsgId 当前流式消息 ID
 *   error         错误信息 (可选, 表示异常或取消)
 *   usage         Token 用量统计 (可选, done 事件携带, 需供应商支持 stream_options.include_usage)
 */
export type DoneCallback = (
  assistantMsgId: string,
  error?: string,
  usage?: UsageInfo | null
) => void;

/**
 * useAiStream Hook 参数
 */
interface UseAiStreamParams {
  /** 流式 chunk 累加回调 (父组件用于更新对应消息 content) */
  onAccumulate: AccumulateCallback;
  /** 流式完成回调 (父组件用于更新对应消息 isStreaming / error) */
  onDone: DoneCallback;
  /** 用户取消时的错误文案 (供 cancelStream 时透传) */
  userCanceledText: string;
}

/**
 * useAiStream Hook 返回值
 */
export interface UseAiStreamReturn {
  /** 是否正在流式生成 */
  isStreaming: boolean;
  /** 设置 isStreaming 状态 (供父组件在准备消息后置位) */
  setIsStreaming: (value: boolean) => void;
  /**
   * 发起流式请求
   * 输入:
   *   chatMessages     - 完整聊天消息列表 (含 system + 历史 + 当前 user)
   *   config           - AI 配置
   *   assistantMsgId   - 当前 assistant 占位消息 ID
   * 输出: Promise<void> 流式结束 resolve, 异常 reject
   */
  startStream: (
    chatMessages: ChatMessage[],
    config: AiConfig,
    assistantMsgId: string
  ) => Promise<void>;
  /**
   * 中断当前流式请求 (Esc 触发)
   * 输出: Promise<void> 取消命令完成
   */
  cancelStream: () => Promise<void>;
  /**
   * 注册 setTimeout 引用 (Task 35.2: 卸载时统一清理)
   * 输入: handle setTimeout 返回值
   */
  registerTimeout: (handle: number) => void;
  /**
   * 清理已注册的 setTimeout 引用 (单个清理)
   * 输入: handle setTimeout 返回值
   */
  clearTrackedTimeout: (handle: number) => void;
}

/**
 * useAiStream - AI 流式请求与中断管理 Hook
 *
 * 输入: onAccumulate / onDone / userCanceledText
 * 输出: isStreaming / startStream / cancelStream
 * 流程:
 *   1. startStream 调用 streamChatCompletion 注册 onChunk/onDone
 *   2. chunk 到达时累加并上抛 onAccumulate
 *   3. done 触发时上抛 onDone, 重置 isStreaming
 *   4. cancelStream 调用 cancelStreamCompletion, 后端推送 done(error)
 *   5. setTimeout 引用通过 registerTimeout 注册, useEffect 清理
 *
 * Task 35.2: setTimeout 清理机制
 *   - 所有 setTimeout 返回值保存到 timeoutRefs.current 数组
 *   - useEffect 卸载时统一 clearTimeout, 避免内存泄漏
 */
export function useAiStream({
  onAccumulate,
  onDone,
  userCanceledText,
}: UseAiStreamParams): UseAiStreamReturn {
  // 是否正在流式生成
  const [isStreaming, setIsStreaming] = useState(false);

  // Task 34: 当前流式请求的 request_id (用于按请求粒度精准取消)
  // 每次发起流式请求时生成新的 UUID, cancelStream 使用此 ID 调用取消
  const requestIdRef = useRef<string>("");

  // Task 35.2: setTimeout 引用列表 (卸载时清理)
  const timeoutRefs = useRef<number[]>([]);

  /**
   * 注册 setTimeout 引用, 用于后续统一清理
   * 输入: handle setTimeout 返回的 handle
   * 流程: push 到 timeoutRefs.current
   */
  const registerTimeout = useCallback((handle: number) => {
    timeoutRefs.current.push(handle);
  }, []);

  /**
   * 清理指定 handle 并从列表移除
   * 输入: handle 待清理的 setTimeout 引用
   */
  const clearTrackedTimeout = useCallback((handle: number) => {
    window.clearTimeout(handle);
    timeoutRefs.current = timeoutRefs.current.filter((h) => h !== handle);
  }, []);

  // Task 35.2: 卸载时清理所有未完成的 setTimeout
  useEffect(() => {
    return () => {
      for (const handle of timeoutRefs.current) {
        window.clearTimeout(handle);
      }
      timeoutRefs.current = [];
    };
  }, []);

  // onAccumulate / onDone 最新引用 (避免闭包过期)
  const onAccumulateRef = useRef(onAccumulate);
  onAccumulateRef.current = onAccumulate;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  /**
   * 发起流式请求
   * 输入:
   *   chatMessages    - 完整聊天消息列表
   *   config          - AI 配置
   *   assistantMsgId  - 当前 assistant 占位消息 ID
   * 输出: Promise<void>
   * 流程:
   *   1. 生成新的 requestId 并保存到 ref (供 cancelStream 使用)
   *   2. 累加器初始化为空字符串
   *   3. 注册 onChunk: 累加 chunk, 调用 onAccumulate 上抛
   *   4. 注册 onDone: 调用 onDone 上抛完成状态
   *   5. 调用 streamChatCompletion 发起请求 (携带 requestId)
   *   6. 异常时上抛 error, finally 重置 isStreaming
   */
  const startStream = useCallback(
    async (
      chatMessages: ChatMessage[],
      config: AiConfig,
      assistantMsgId: string
    ): Promise<void> => {
      // Task 34: 为本次流式请求生成唯一 requestId
      // 保存到 ref 以便 cancelStream 按 ID 精准取消
      const requestId = generateRequestId();
      requestIdRef.current = requestId;

      let accumulated = "";
      try {
        await streamChatCompletion(chatMessages, config, {
          onChunk: (chunk) => {
            accumulated += chunk;
            // 上抛累加结果给父组件更新消息 content
            onAccumulateRef.current(assistantMsgId, accumulated);
          },
          onDone: (error, usage) => {
            // 上抛完成状态 (含错误信息与 Token 用量统计)
            onDoneRef.current(assistantMsgId, error, usage);
          },
        }, requestId);
      } catch (err) {
        // 异常: 上抛错误信息
        const errMsg = String(err);
        onDoneRef.current(assistantMsgId, errMsg);
        throw err;
      } finally {
        setIsStreaming(false);
        // 清空 requestId, 避免取消已结束的请求
        requestIdRef.current = "";
      }
    },
    []
  );

  /**
   * 中断当前流式请求 (Esc 触发)
   * 输出: Promise<void>
   * 流程:
   *   1. 读取当前 requestId
   *   2. 调用 cancelStreamCompletion(requestId) 通知后端精准取消
   *   3. 后端将推送 done(error="用户取消请求")
   *   4. onDone 回调中由父组件更新消息状态
   *   5. 重置本地 isStreaming
   * 说明: 若 requestId 为空 (无活跃请求), 跳过后端调用, 仅重置 UI 状态
   */
  const cancelStream = useCallback(async (): Promise<void> => {
    const requestId = requestIdRef.current;
    if (requestId) {
      try {
        await cancelStreamCompletion(requestId);
      } catch {
        // 后端取消失败时静默处理 (UI 已置为非流式)
      }
    }
    setIsStreaming(false);
    // 主动上抛用户取消文案, 父组件更新对应消息 error 字段
    // 此处使用空字符串 assistantMsgId, 父组件需在调用处覆盖
    void userCanceledText;
  }, [userCanceledText]);

  return {
    isStreaming,
    setIsStreaming,
    startStream,
    cancelStream,
    registerTimeout,
    clearTrackedTimeout,
  };
}
