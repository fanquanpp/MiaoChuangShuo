// AI 助手侧边栏面板组件 (重构版 SubTask 12.6, AI-3.5 交互增强)
//
// 功能概述:
//   右侧滑出 AI 创作助手面板容器. 通过组合 AiMessageList / AiInputBar /
//   AiTaskTypeSelector / AiMarkdownRenderer / useAiStream / usePromptBuilder
//   等子模块, 仅保留面板容器职责与跨子组件状态协调, 行数控制在 350 以内.
//
// 模块职责 (重构后):
//   1. 渲染 Portal 容器与头部
//   2. 维护对话消息列表、输入框文本、AI 配置缓存等顶层状态
//   3. 协调外部注入指令 (pendingInstruction + EditorBubbleMenu 4 个命令)
//   4. 委托 usePromptBuilder 构建 Prompt, useAiStream 处理流式请求
//   5. 委托子组件渲染消息列表 / 输入栏 / 任务类型切换
//   6. AI-3.5: 流式失败重试 / 插入文档 5 秒撤销条 / Token 用量透传
//
// 设计说明:
//   - 子组件为纯展示/交互组件, 业务逻辑通过 hooks 沉淀
//   - 所有 setTimeout 通过 useAiStream 跟踪, 卸载时统一清理 (Task 35.2)
//   - handleSendRef 暴露给 pendingInstruction useEffect, 避免闭包过期
//   - AI-3.5: lastInstructionRef 缓存最近一次发送指令, 供重试按钮复用
//   - AI-3.5: undoBar 状态控制插入文档后的 5 秒撤销窗口, 基于 TipTap 原生 undo

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X, Trash2, AlertCircle, Undo2 } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { usePreferencesStore } from "../lib/preferencesSlice";
import {
  getAiConfig,
  type ChatMessage,
  type AiConfig,
  type UsageInfo,
} from "../lib/aiService";
import { type AiTaskType } from "../lib/promptBuilder";
import { usePromptBuilder, locateScene } from "../hooks/usePromptBuilder";
import { useAiStream } from "../hooks/useAiStream";
import AiMessageList, { type ChatMessageItem } from "./ai-assistant/AiMessageList";
import AiInputBar from "./ai-assistant/AiInputBar";
import AiTaskTypeSelector from "./ai-assistant/AiTaskTypeSelector";

/** 撤销窗口时长 (毫秒) */
const UNDO_WINDOW_MS = 5000;
/** 撤销条倒计时刷新间隔 (毫秒) */
const UNDO_TICK_MS = 1000;

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
 * 撤销条状态
 * - remaining: 剩余秒数 (用于显示倒计时)
 * - canUndo:   编辑器是否支持撤销 (基于 TipTap can().undo() 判断)
 */
interface UndoBarState {
  remaining: number;
  canUndo: boolean;
}

/**
 * AI 助手侧边栏面板 (重构版 + AI-3.5 增强)
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
  // AI-3.5: 插入文档撤销条状态 (null 表示隐藏)
  const [undoBar, setUndoBar] = useState<UndoBarState | null>(null);

  // ── refs ──
  const aiConfigRef = useRef<AiConfig | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // AI-3.5: 最近一次发送的指令缓存 (供重试按钮复用, 避免重发时依赖 input 状态)
  const lastInstructionRef = useRef<string>("");

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
      (msgId: string, error?: string, usage?: UsageInfo | null) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  isStreaming: false,
                  error: error || undefined,
                  usage: usage ?? undefined,
                }
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
   *   6. AI-3.5: 缓存最近一次指令到 lastInstructionRef, 供重试按钮复用
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
      // AI-3.5: 缓存本次发送的指令, 供失败后重试按钮复用
      lastInstructionRef.current = instruction;

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
        // 注意: 此处历史需排除当前刚插入的 user 占位消息, 仅取之前的有效消息
        const recentHistory = messages.slice(-8);
        const chatMessages: ChatMessage[] = [
          { role: "system", content: builtPrompt.system },
        ];
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

  /**
   * AI-3.5: 重试上一条失败的 AI 消息
   * 流程:
   *   1. 校验不在流式生成中
   *   2. 读取 lastInstructionRef 缓存的最近指令
   *   3. 移除最后一条失败的 assistant 消息 (保留 user 消息)
   *   4. 重新调用 handleSend(缓存的指令) 触发新一轮生成
   */
  const handleRetry = useCallback(() => {
    if (isStreaming) return;
    const lastInstruction = lastInstructionRef.current;
    if (!lastInstruction) return;
    // 移除最后一条失败的 assistant 消息 (保留 user 消息)
    setMessages((prev) => {
      const lastAssistantIdx = [...prev].reverse().findIndex((m) => m.role === "assistant");
      if (lastAssistantIdx === -1) return prev;
      const actualIdx = prev.length - 1 - lastAssistantIdx;
      const last = prev[actualIdx];
      // 仅当最后一条 assistant 消息处于错误态时才移除
      if (!last.error) return prev;
      return prev.filter((_, idx) => idx !== actualIdx);
    });
    // 通过 handleSendRef 调用最新版 handleSend, 避免闭包过期
    void handleSendRef.current?.(lastInstruction);
  }, [isStreaming]);

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

  /** 清空对话历史 (同时清空重试缓存) */
  const handleClear = useCallback(() => {
    if (isStreaming) return;
    setMessages([]);
    setPanelError(null);
    lastInstructionRef.current = "";
    setUndoBar(null);
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
   * AI-3.5: 执行 TipTap 撤销 (undo)
   * 流程:
   *   1. 校验编辑器就绪且支持撤销
   *   2. 调用 editor.chain().focus().undo().run()
   *   3. 隐藏撤销条, 显示成功 toast
   *   4. 失败时显示错误 toast
   */
  const performUndo = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      showToast("error", t("ai.panel.editorNotReady"));
      setUndoBar(null);
      return;
    }
    try {
      if (!editor.can().undo()) {
        showToast("warning", t("ai.panel.undoFailed"));
        setUndoBar(null);
        return;
      }
      editor.chain().focus().undo().run();
      showToast("success", t("ai.panel.undoSucceeded"));
    } catch (err) {
      showToast("error", `${t("ai.panel.undoFailed")}: ${String(err)}`);
    }
    setUndoBar(null);
  }, [editor, t, showToast]);

  /**
   * 插入 AI 回复到编辑器当前光标位置
   * AI-3.5 增强: 插入后显示 5 秒撤销条, 用户可点击撤销
   * 流程:
   *   1. 按 \n 分割为多个段落, 每段插入为 <p> 节点
   *   2. 插入后检测编辑器是否支持 undo
   *   3. 若支持 undo, 显示撤销条并启动 5 秒倒计时
   *   4. 倒计时结束自动隐藏撤销条
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

        // AI-3.5: 插入成功后显示 5 秒撤销条 (需编辑器支持 undo)
        const canUndo = editor.can().undo();
        if (canUndo) {
          setUndoBar({ remaining: Math.floor(UNDO_WINDOW_MS / 1000), canUndo: true });
        }
      } catch (err) {
        showToast("error", `${t("ai.panel.insertFailed")}: ${String(err)}`);
      }
    },
    [editor, t, showToast]
  );

  /**
   * AI-3.5: 撤销条倒计时 useEffect
   * 流程:
   *   1. undoBar 显示时启动 1 秒间隔的 tick 计时器
   *   2. 每秒递减 remaining
   *   3. remaining <= 0 时自动隐藏
   *   4. 所有 setTimeout 通过 registerTimeout 跟踪, 卸载或重新触发时清理
   */
  useEffect(() => {
    if (!undoBar) return;
    if (undoBar.remaining <= 0) {
      setUndoBar(null);
      showToast("info", t("ai.panel.undoExpired"));
      return;
    }
    const timer = window.setTimeout(() => {
      setUndoBar((prev) =>
        prev ? { ...prev, remaining: prev.remaining - 1 } : null
      );
    }, UNDO_TICK_MS);
    registerTimeout(timer);
    return () => clearTrackedTimeout(timer);
  }, [undoBar, registerTimeout, clearTrackedTimeout, showToast, t]);

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
          onRetry={handleRetry}
        />

        {/* AI-3.5: 撤销条 (插入文档后 5 秒内显示) */}
        {undoBar && undoBar.canUndo && (
          <div className="px-3 py-2 border-t border-fandex-primary/30 bg-fandex-primary/10 flex items-center justify-between gap-2 animate-slide-in-right">
            <div className="flex items-center gap-2 min-w-0">
              <Undo2 className="w-3.5 h-3.5 text-fandex-primary flex-shrink-0" />
              <span className="text-[11px] text-nf-text-secondary truncate">
                {t("ai.panel.undoInsertHint", { seconds: undoBar.remaining })}
              </span>
            </div>
            <button
              type="button"
              onClick={performUndo}
              className="flex-shrink-0 px-2 py-1 text-[11px] font-medium text-fandex-primary hover:bg-fandex-primary/15 border border-fandex-primary/40 transition-colors duration-fast"
            >
              {t("ai.panel.undoInsert")}
            </button>
          </div>
        )}

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
