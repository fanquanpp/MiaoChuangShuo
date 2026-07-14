// AI 消息列表展示组件 (SubTask 12.1)
//
// 功能概述:
//   抽取自 AiAssistantPanel 的消息列表渲染逻辑, 负责将多轮对话历史与流式
//   累加内容以气泡形式呈现. 支持用户消息与 AI 消息的差异化样式, 自动滚动
//   到底部以聚焦最新内容.
//
// 模块职责:
//   1. 渲染用户消息气泡 (右对齐, fandex 主色)
//   2. 渲染 AI 消息气泡 (左对齐, 中性色, 含 Markdown 渲染)
//   3. 显示流式生成中的脉冲光标
//   4. 显示错误信息与消息操作按钮 (插入/复制)
//   5. 自动滚动到最新消息
//
// 设计说明:
//   - 消息组件为纯展示组件, 通过 props 接收数据与回调
//   - 流式累加由上游 useAiStream hook 处理, 此处仅根据 content 渲染
//   - 空消息列表展示占位提示

import { useEffect, useRef } from "react";
import {
  Sparkles,
  AlertCircle,
  Copy,
  Check,
  ClipboardPaste,
} from "lucide-react";
import { useI18n } from "../../lib/i18n";
import AiMarkdownRenderer from "./AiMarkdownRenderer";

/**
 * 对话消息角色
 */
export type MessageRole = "user" | "assistant";

/**
 * 对话消息结构
 * - id:           React key 唯一标识
 * - role:         消息角色
 * - content:      消息内容 (assistant 流式更新时动态累加)
 * - isStreaming:   是否正在流式生成 (仅 assistant)
 * - error:        生成错误信息 (仅失败时)
 * - sceneSnapshot: 关联场景上下文快照 (用户消息携带)
 */
export interface ChatMessageItem {
  id: string;
  role: MessageRole;
  content: string;
  isStreaming?: boolean;
  error?: string;
  sceneSnapshot?: {
    sceneIndex: number;
    sceneTitle: string;
  };
}

/**
 * AiMessageList 组件属性
 */
interface AiMessageListProps {
  /** 对话消息列表 */
  messages: ChatMessageItem[];
  /** 已复制消息 ID (用于复制按钮反馈) */
  copiedId: string | null;
  /** 插入 AI 回复到文档回调 */
  onInsertToDoc: (content: string) => void;
  /** 复制消息内容回调 */
  onCopy: (msgId: string, content: string) => void;
}

/**
 * AiMessageList 消息列表组件
 * 输入:
 *   messages      - 对话消息数组
 *   copiedId      - 已复制消息 ID
 *   onInsertToDoc - 插入到文档回调
 *   onCopy        - 复制回调
 * 输出: JSX 消息列表区域
 * 流程:
 *   1. 空列表时渲染占位提示
 *   2. 非空时遍历消息, 渲染用户/AI 气泡
 *   3. AI 消息支持 Markdown 渲染与流式脉冲光标
 *   4. 非流式 AI 消息渲染操作按钮 (插入/复制)
 *   5. 自动滚动到最新消息
 */
export default function AiMessageList({
  messages,
  copiedId,
  onInsertToDoc,
  onCopy,
}: AiMessageListProps) {
  const { t } = useI18n();
  // 滚动锚点 ref (用于自动滚动到底部)
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 消息变化时自动滚动到最新
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
  }, [messages]);

  // 空列表渲染占位提示
  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-col items-center justify-center h-full text-center py-12">
          <Sparkles className="w-8 h-8 text-nf-text-tertiary mb-3" />
          <p className="text-sm text-nf-text-secondary mb-1">
            {t("ai.panel.emptyHint")}
          </p>
          <p className="text-xs text-nf-text-tertiary">
            {t("ai.panel.emptyHintDesc")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex flex-col ${
            msg.role === "user" ? "items-end" : "items-start"
          }`}
        >
          {msg.role === "user" ? (
            // 用户消息气泡
            <div className="max-w-[85%] bg-fandex-primary/15 border border-fandex-primary/30 px-3 py-2 text-sm text-nf-text">
              {msg.content}
              {msg.sceneSnapshot && (
                <div className="mt-1.5 text-[10px] text-nf-text-tertiary border-t border-fandex-primary/20 pt-1">
                  {t("ai.panel.sceneContext")}: {msg.sceneSnapshot.sceneTitle}
                </div>
              )}
            </div>
          ) : (
            // AI 消息区
            <div className="max-w-[95%] w-full">
              <div className="bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text">
                {msg.content ? (
                  <AiMarkdownRenderer content={msg.content} />
                ) : msg.isStreaming ? (
                  <span className="text-nf-text-tertiary italic">
                    {t("ai.panel.thinking")}
                  </span>
                ) : (
                  <span className="text-nf-text-tertiary">
                    {t("ai.panel.noResponse")}
                  </span>
                )}
                {/* 流式脉冲光标 */}
                {msg.isStreaming && msg.content && (
                  <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-fandex-primary animate-pulse align-middle" />
                )}
              </div>
              {/* 错误信息 */}
              {msg.error && !msg.isStreaming && (
                <p className="mt-1 text-[10px] text-fandex-tertiary flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {msg.error}
                </p>
              )}
              {/* 操作按钮 (非流式且非错误状态) */}
              {!msg.isStreaming && msg.content && !msg.error && (
                <div className="flex items-center gap-1 mt-1.5">
                  <button
                    type="button"
                    onClick={() => onInsertToDoc(msg.content)}
                    title={t("ai.panel.insertToDoc")}
                    tabIndex={-1}
                    className="nf-tool-btn flex items-center gap-1 h-6 px-2 text-[11px] text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover border border-nf-border-light/50 transition-colors duration-fast"
                  >
                    <ClipboardPaste className="w-3 h-3" />
                    {t("ai.panel.insert")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onCopy(msg.id, msg.content)}
                    title={t("app.copy")}
                    tabIndex={-1}
                    className="nf-tool-btn flex items-center gap-1 h-6 px-2 text-[11px] text-nf-text-secondary hover:text-fandex-secondary hover:bg-nf-bg-hover border border-nf-border-light/50 transition-colors duration-fast"
                  >
                    {copiedId === msg.id ? (
                      <>
                        <Check className="w-3 h-3" />
                        {t("app.copied")}
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        {t("app.copy")}
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {/* 滚动锚点 */}
      <div ref={messagesEndRef} />
    </div>
  );
}
