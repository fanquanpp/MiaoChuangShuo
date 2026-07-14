// AI 助手侧边栏面板组件 (重构版 SubTask 12.6)
//
// 功能概述:
//   右侧滑出 AI 创作助手面板容器. 通过组合 AiMessageList / AiInputBar /
//   AiTaskTypeSelector / AiMarkdownRenderer / useAiStream / usePromptBuilder
//   等子模块, 仅保留面板容器职责与跨子组件状态协调, 行数控制在 300 以内.
//
// 模块职责 (重构后):
//   1. 渲染 Portal 容器与头部
//   2. 维护对话消息列表、输入框文本、AI 配置缓存等顶层状态
//   3. 协调外部注入指令 (pendingInstruction + EditorBubbleMenu 4 个命令)
//   4. 委托 usePromptBuilder 构建 Prompt, useAiStream 处理流式请求
//   5. 委托子组件渲染消息列表 / 输入栏 / 任务类型切换
//
// 设计说明:
//   - 子组件为纯展示/交互组件, 业务逻辑通过 hooks 沉淀
//   - 所有 setTimeout 通过 useAiStream 跟踪, 卸载时统一清理 (Task 35.2)
//   - handleSendRef 暴露给 pendingInstruction useEffect, 避免闭包过期

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X, Trash2, AlertCircle } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { usePreferencesStore } from "../lib/preferencesSlice";
import { getAiConfig, type ChatMessage, type AiConfig } from "../lib/aiService";
import { type AiTaskType } from "../lib/promptBuilder";
import { usePromptBuilder, locateScene } from "../hooks/usePromptBuilder";
import { useAiStream } from "../hooks/useAiStream";
import AiMessageList, { type ChatMessageItem } from "./ai-assistant/AiMessageList";
import AiInputBar from "./ai-assistant/AiInputBar";
import AiTaskTypeSelector from "./ai-assistant/AiTaskTypeSelector";

/**
 * 面板属性 (与重构前兼容, 不破坏 NovelEditor 调用)
 */
interface AiAssistantPanelProps {
  open: boolean;
  onClose: () => void;
  editor: Editor | null;
  projectPath: string;
  filePath: string | null;
  pendingInstruction?: string | null;
  onPendingInstructionConsumed?: () => void;
  pendingCharacterId?: string | null;
  pendingSelectedText?: string | null;
  pendingTaskType?: AiTaskType | null;
  onPendingTaskConsumed?: () => void;
}

/**
 * AI 助手侧边栏面板 (重构版)
 * 输入: 见 AiAssistantPanelProps
 * 输出: JSX 右侧滑出面板 (Portal 渲染到 body)
 */
export default function AiAssistantPanel({
  open,
  onClose,
  editor,
  projectPath,
  filePath,
  pendingInstruction,
  onPendingInstructionConsumed,
  pendingCharacterId,
  pendingSelectedText,
  pendingTaskType,
  onPendingTaskConsumed,
}: AiAssistantPanelProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const editorPrefs = usePreferencesStore((s) => s.preferences);

  // ── 顶层状态 ──
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [input, setInput] = useState("");
  const [panelError, setPanelError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Sprint 6: 任务类型 / 角色绑定 / 选中文本
  const [taskType, setTaskType] = useState<AiTaskType>("continuation");
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [activeSelectedText, setActiveSelectedText] = useState<string | null>(null);

  // ── refs ──
  const aiConfigRef = useRef<AiConfig | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Prompt 构建 hook ──
  const { buildPromptByTask } = usePromptBuilder({
    editorPrefs,
    projectPath,
    filePath,
    activeCharacterId,
    activeSelectedText,
  });

  // ── 流式请求 hook ──
  const {
    isStreaming,
    setIsStreaming,
    startStream,
    cancelStream,
    registerTimeout,
    clearTrackedTimeout,
  } = useAiStream({
    onAccumulate: useCallback((msgId: string, accumulated: string) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, content: accumulated } : m))
      );
    }, []),
    onDone: useCallback(
      (msgId: string, error?: string) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? { ...m, isStreaming: false, error: error || undefined }
              : m
          )
        );
        if (error) {
          showToast("warning", `${t("ai.panel.streamInterrupted")}: ${error}`);
        }
      },
      [t, showToast]
    ),
    userCanceledText: t("ai.panel.userCanceled"),
  });

  /**
   * 中断流式生成 (Esc 触发)
   * 流程: 调用 hook cancelStream -> 将流式中消息置为已取消
   */
  const handleCancel = useCallback(async () => {
    await cancelStream();
    setMessages((prev) =>
      prev.map((m) =>
        m.isStreaming
          ? { ...m, isStreaming: false, error: t("ai.panel.userCanceled") }
          : m
      )
    );
  }, [cancelStream, t]);

  // ── 打开面板时加载 AI 配置并聚焦输入框 ──
  useEffect(() => {
    if (!open) return;
    try {
      void getAiConfig()
        .then((config) => {
          aiConfigRef.current = config;
          setPanelError(
            !config.enabled
              ? t("ai.panel.notEnabled")
              : !config.apiKey
              ? t("ai.panel.noApiKey")
              : null
          );
        })
        .catch((err) => {
          setPanelError(`${t("ai.panel.configLoadFailed")}: ${String(err)}`);
        });
    } catch (err) {
      setPanelError(`${t("ai.panel.configLoadFailed")}: ${String(err)}`);
    }
    // 延迟聚焦输入框 (Task 35.2: 跟踪 setTimeout)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 100);
    registerTimeout(timer);
    return () => clearTrackedTimeout(timer);
  }, [open, t, registerTimeout, clearTrackedTimeout]);

  // ── Esc 键中断或关闭面板 ──
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isStreaming) {
        void handleCancel();
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isStreaming, onClose, handleCancel]);

  /**
   * 发送用户指令
   * 输入: overrideInstruction 外部注入指令 (不传则读取 input)
   * 流程:
   *   1. 校验输入与 AI 配置
   *   2. continuation/dialogue 任务需要场景位置
   *   3. 调用 buildPromptByTask 构建 Prompt
   *   4. 组装 chatMessages (含最近 4 轮历史)
   *   5. 调用 startStream 流式生成
   */
  const handleSend = useCallback(
    async (overrideInstruction?: string) => {
      const instruction = (overrideInstruction ?? input).trim();
      if (!instruction || isStreaming) return;

      const config = aiConfigRef.current;
      if (!config || !config.enabled) {
        setPanelError(t("ai.panel.notEnabled"));
        return;
      }
      if (!config.apiKey) {
        setPanelError(t("ai.panel.noApiKey"));
        return;
      }

      // 续写/对话类任务需要场景位置; 校验/推演/大纲类不需要
      const needsScene = taskType === "continuation" || taskType === "dialogue";
      let sceneLoc = null;
      if (needsScene) {
        if (!editor || editor.isDestroyed) {
          showToast("error", t("ai.panel.editorNotReady"));
          return;
        }
        sceneLoc = locateScene(editor);
        if (!sceneLoc) {
          showToast("error", t("ai.panel.noSceneFound"));
          return;
        }
      }

      // 创建占位消息
      const userMsgId = `user-${Date.now()}`;
      const assistantMsgId = `assistant-${Date.now()}`;
      const userMessage: ChatMessageItem = {
        id: userMsgId,
        role: "user",
        content: instruction,
        sceneSnapshot: sceneLoc
          ? {
              sceneIndex: sceneLoc.sceneIndex,
              sceneTitle: `场景 ${sceneLoc.sceneIndex + 1}`,
            }
          : undefined,
      };
      const assistantPlaceholder: ChatMessageItem = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
      setInput("");
      setIsStreaming(true);
      setPanelError(null);

      try {
        const builtPrompt = await buildPromptByTask(taskType, instruction, sceneLoc);
        if (!builtPrompt) {
          // 前置校验失败, 移除占位消息
          setMessages((prev) =>
            prev.filter((m) => m.id !== userMsgId && m.id !== assistantMsgId)
          );
          setIsStreaming(false);
          return;
        }

        // 组装聊天消息 (含历史, 最近 4 轮避免 Token 爆炸)
        const chatMessages: ChatMessage[] = [
          { role: "system", content: builtPrompt.system },
        ];
        const recentHistory = messages.slice(-8);
        for (const msg of recentHistory) {
          if (msg.content && !msg.isStreaming) {
            chatMessages.push({ role: msg.role, content: msg.content });
          }
        }
        chatMessages.push({ role: "user", content: builtPrompt.user });

        // 发起流式请求
        await startStream(chatMessages, config, assistantMsgId);
      } catch (err) {
        const errMsg = String(err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  isStreaming: false,
                  error: errMsg,
                  content: errMsg.startsWith("Error:")
                    ? errMsg
                    : `${t("ai.panel.generationFailed")}: ${errMsg}`,
                }
              : m
          )
        );
        showToast("error", `${t("ai.panel.generationFailed")}: ${errMsg}`);
        setIsStreaming(false);
      }
    },
    [
      input,
      isStreaming,
      editor,
      messages,
      t,
      showToast,
      taskType,
      buildPromptByTask,
      setIsStreaming,
      startStream,
    ]
  );

  // handleSend ref 引用 (供 pendingInstruction useEffect 调用, 避免闭包过期)
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  // ── 外部注入指令自动发送 (AI-3.4 / Sprint 6 任务触发) ──
  useEffect(() => {
    if (!open || !pendingInstruction) return;
    // 同步外部任务上下文到本地状态
    if (pendingTaskType) setTaskType(pendingTaskType);
    if (pendingCharacterId !== undefined) setActiveCharacterId(pendingCharacterId);
    if (pendingSelectedText !== undefined) setActiveSelectedText(pendingSelectedText);
    setInput(pendingInstruction);
    onPendingInstructionConsumed?.();
    onPendingTaskConsumed?.();
    // 延迟调用 handleSend 确保 input 与任务状态已更新 (Task 35.2: 跟踪 setTimeout)
    const timer = window.setTimeout(() => {
      handleSendRef.current?.(pendingInstruction);
    }, 50);
    registerTimeout(timer);
    return () => clearTrackedTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    pendingInstruction,
    pendingTaskType,
    pendingCharacterId,
    pendingSelectedText,
    registerTimeout,
    clearTrackedTimeout,
  ]);

  /** 清空对话历史 */
  const handleClear = useCallback(() => {
    if (isStreaming) return;
    setMessages([]);
    setPanelError(null);
  }, [isStreaming]);

  /** 复制消息内容到剪贴板 (Task 35.2: setTimeout 跟踪, 卸载时统一清理) */
  const handleCopy = useCallback(
    async (msgId: string, content: string) => {
      try {
        await navigator.clipboard.writeText(content);
        setCopiedId(msgId);
        const timer = window.setTimeout(() => setCopiedId(null), 1500);
        registerTimeout(timer);
      } catch {
        showToast("error", t("ai.panel.copyFailed"));
      }
    },
    [showToast, registerTimeout]
  );

  /**
   * 插入 AI 回复到编辑器当前光标位置
   * 流程: 按 \n 分割为多个段落, 每段插入为 <p> 节点
   */
  const handleInsertToDoc = useCallback(
    (content: string) => {
      if (!editor || editor.isDestroyed) {
        showToast("error", t("ai.panel.editorNotReady"));
        return;
      }
      try {
        const paragraphs = content.split(/\n+/).filter((p) => p.trim());
        if (paragraphs.length === 0) {
          showToast("warning", t("ai.panel.noContentToInsert"));
          return;
        }
        const contentNodes = paragraphs.map((text) => ({
          type: "paragraph",
          content: [{ type: "text", text }],
        }));
        editor.chain().focus().insertContent(contentNodes).run();
        showToast("success", t("ai.panel.inserted"));
      } catch (err) {
        showToast("error", `${t("ai.panel.insertFailed")}: ${String(err)}`);
      }
    },
    [editor, t, showToast]
  );

  /**
   * 任务类型切换回调: 同步本地任务类型并清理关联上下文
   * 流程: 非对话/校验任务时清空角色 ID; 非校验任务时清空选中文本
   */
  const handleTaskTypeChange = useCallback((tt: AiTaskType) => {
    setTaskType(tt);
    if (tt !== "dialogue" && tt !== "consistencyCheck") {
      setActiveCharacterId(null);
    }
    if (tt !== "consistencyCheck") {
      setActiveSelectedText(null);
    }
  }, []);

  if (!open) return null;

  // 使用 Portal 渲染到 body, 避免父元素层叠上下文限制
  return createPortal(
    <>
      {/* 遮罩层 (点击关闭) */}
      <div
        className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* 侧边栏面板 (右侧滑出) */}
      <aside
        className="fixed top-0 right-0 z-[101] h-full w-full max-w-[440px] bg-nf-bg-card border-l border-nf-border-light shadow-2xl flex flex-col"
        role="dialog"
        aria-label={t("ai.panel.title")}
      >
        {/* 头部 */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-nf-border-light">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-fandex-primary" />
            <h2 className="text-sm font-semibold font-display text-nf-text">
              {t("ai.panel.title")}
            </h2>
            <span className="text-[10px] text-nf-text-tertiary px-1.5 py-0.5 bg-nf-bg-hover border border-nf-border-light">
              BYOK
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleClear}
              disabled={isStreaming || messages.length === 0}
              title={t("ai.panel.clearHistory")}
              tabIndex={-1}
              className="nf-tool-btn h-7 w-7 flex items-center justify-center text-nf-text-tertiary hover:text-fandex-tertiary hover:bg-nf-bg-hover transition-colors duration-fast disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              title={t("app.close")}
              tabIndex={-1}
              className="nf-tool-btn h-7 w-7 flex items-center justify-center text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-hover transition-colors duration-fast"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* 任务类型切换栏 (委托 AiTaskTypeSelector) */}
        <AiTaskTypeSelector
          taskType={taskType}
          onTaskTypeChange={handleTaskTypeChange}
          isStreaming={isStreaming}
        />

        {/* 错误提示区 */}
        {panelError && (
          <div className="px-4 py-2 bg-fandex-tertiary/10 border-b border-fandex-tertiary/30 flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-fandex-tertiary mt-0.5 flex-shrink-0" />
            <p className="text-xs text-fandex-tertiary leading-relaxed">{panelError}</p>
          </div>
        )}

        {/* 消息列表区 (委托 AiMessageList) */}
        <AiMessageList
          messages={messages}
          copiedId={copiedId}
          onInsertToDoc={handleInsertToDoc}
          onCopy={handleCopy}
        />

        {/* 输入区 (委托 AiInputBar) */}
        <AiInputBar
          value={input}
          onChange={setInput}
          onSend={() => void handleSend()}
          onCancel={() => void handleCancel()}
          isStreaming={isStreaming}
          inputRef={inputRef}
        />
      </aside>
    </>,
    document.body
  );
}
