// AI 助手侧边栏面板组件 (AI-3.1 + AI-3.2)
//
// 功能概述:
//   提供右侧滑出的 AI 创作助手面板, 支持多轮对话与流式输出.
//   集成 4 层上下文组装 (AI-2 成果) 与 BYOK 流式管道 (AI-1 成果),
//   实现编辑器与 AI 的端到端打通.
//
// 模块职责:
//   1. 渲染侧边栏对话界面 (消息列表 + 输入框 + 操作按钮)
//   2. 接收 NovelEditor 传递的当前场景上下文 (SceneContext)
//   3. 调用 PromptBuilder 构建提示词, 通过 aiService 发起流式请求
//   4. 流式渲染 AI 回复, 支持"插入到文档"与"复制"操作
//   5. 维护对话历史, 支持清空与多轮上下文
//
// 设计说明:
//   - 采用 FANDEX 原生风格 (放弃 shadcn/ui, 避免与设计系统冲突)
//   - AI 回复使用纯文本 + 简易 markdown 转换 (不引入 react-markdown 依赖)
//   - 流式更新通过 React state 累加 chunk 实现, 避免重渲染整个消息列表
//   - 用户指令通过 system prompt 末尾追加, 不修改 buildContinuationPrompt 签名

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X, Send, Square, Copy, Check, ClipboardPaste, Trash2, AlertCircle, ChevronDown } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { usePreferencesStore } from "../lib/preferencesSlice";
import {
  streamChatCompletion,
  cancelStreamCompletion,
  getAiConfig,
  type ChatMessage,
  type AiConfig,
} from "../lib/aiService";
import {
  PromptBuilder,
  type SceneContext,
  type ProjectContext,
  type AiTaskType,
} from "../lib/promptBuilder";
import { getCurrentSceneLocation } from "../lib/tiptap/sceneUtils";
import {
  getSceneContext,
  getCharacterContext,
  getProjectContext,
  type SceneContextRequest,
} from "../lib/api";

// 对话消息角色
type MessageRole = "user" | "assistant";

// 对话消息结构
interface ChatMessageItem {
  // 消息唯一标识 (用于 React key)
  id: string;
  // 消息角色
  role: MessageRole;
  // 消息内容 (assistant 流式更新时动态累加)
  content: string;
  // 是否正在流式生成 (仅 assistant 消息)
  isStreaming?: boolean;
  // 生成错误信息 (仅失败时)
  error?: string;
  // 关联的场景上下文快照 (用户消息携带, 用于调试)
  sceneSnapshot?: {
    sceneIndex: number;
    sceneTitle: string;
  };
}

// 面板属性
interface AiAssistantPanelProps {
  // 是否打开
  open: boolean;
  // 关闭面板回调
  onClose: () => void;
  // TipTap 编辑器实例 (用于获取当前场景)
  editor: Editor | null;
  // 项目根路径 (绝对路径)
  projectPath: string;
  // 当前打开的文件路径 (绝对路径, 用于计算 chapterId)
  filePath: string | null;
  // 外部注入的待发送指令 (AI-3.4 右键菜单触发, 非空时自动填入并发送)
  pendingInstruction?: string | null;
  // 待发送指令已被消费回调 (通知父组件清空 pendingInstruction)
  onPendingInstructionConsumed?: () => void;
  // Sprint 6: 外部注入的角色 UUID (用于 dialogue / consistencyCheck 任务)
  // 由 CharacterHoverCard / 右键菜单触发, 与 pendingInstruction 同步设置
  pendingCharacterId?: string | null;
  // Sprint 6: 外部注入的选中文本 (用于 consistencyCheck 任务)
  // 由 EditorBubbleMenu 的 characterCheck 按钮触发
  pendingSelectedText?: string | null;
  // Sprint 6: 外部注入的任务类型 (默认 continuation)
  // 当外部触发特定任务时, 自动切换面板任务类型
  pendingTaskType?: AiTaskType | null;
  // Sprint 6: 外部任务已被消费回调 (通知父组件清空 pendingCharacterId/SelectedText/TaskType)
  onPendingTaskConsumed?: () => void;
}

/**
 * 简易 markdown 转纯文本/JSX 渲染
 * 输入: text markdown 文本 (支持粗体/列表/代码块)
 * 输出: JSX 渲染结果
 * 流程:
 *   1. 按代码块 (```) 分割文本
 *   2. 代码块外的文本按行处理: 粗体 (**text**) / 列表项 (- text)
 *   3. 代码块使用 <pre> 渲染
 * 说明: 不引入 react-markdown 依赖, 仅处理常用语法
 */
function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  // 按代码块分割
  const codeBlockRegex = /```([\s\S]*?)```/g;
  const parts: Array<{ type: "code" | "text"; content: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "code", content: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex) });
  }

  return parts.map((part, idx) => {
    if (part.type === "code") {
      return (
        <pre
          key={idx}
          className="my-2 p-3 bg-nf-bg border border-nf-border-light text-xs text-nf-text-secondary overflow-x-auto font-mono whitespace-pre-wrap"
        >
          {part.content}
        </pre>
      );
    }
    // 文本部分按行渲染
    const lines = part.content.split("\n");
    return (
      <div key={idx} className="whitespace-pre-wrap break-words">
        {lines.map((line, lineIdx) => {
          // 粗体渲染 **text**
          const boldRegex = /\*\*([^*]+)\*\*/g;
          const segments: Array<{ text: string; bold: boolean }> = [];
          let bMatch: RegExpExecArray | null;
          let bLast = 0;
          while ((bMatch = boldRegex.exec(line)) !== null) {
            if (bMatch.index > bLast) {
              segments.push({ text: line.slice(bLast, bMatch.index), bold: false });
            }
            segments.push({ text: bMatch[1], bold: true });
            bLast = bMatch.index + bMatch[0].length;
          }
          if (bLast < line.length) {
            segments.push({ text: line.slice(bLast), bold: false });
          }

          // 列表项检测
          const isListItem = /^\s*[-*]\s+/.test(line);
          const isOrderedItem = /^\s*\d+\.\s+/.test(line);

          return (
            <div key={lineIdx} className="leading-relaxed">
              {isListItem && <span className="text-fandex-primary mr-1">•</span>}
              {isOrderedItem && (
                <span className="text-fandex-secondary mr-1 tabular-nums">
                  {line.match(/^\s*(\d+)\./)?.[1]}.
                </span>
              )}
              {segments.map((seg, segIdx) =>
                seg.bold ? (
                  <strong key={segIdx} className="font-semibold text-nf-text">
                    {seg.text}
                  </strong>
                ) : (
                  <span key={segIdx}>{seg.text}</span>
                )
              )}
              {line === "" && <br />}
            </div>
          );
        })}
      </div>
    );
  });
}

/**
 * AI 助手侧边栏面板
 * 输入:
 *   open - 面板是否打开
 *   onClose - 关闭面板回调
 *   editor - TipTap 编辑器实例
 *   projectPath - 项目根路径
 *   filePath - 当前文件绝对路径
 * 输出: JSX 右侧滑出面板
 * 流程:
 *   1. 用户输入指令, 按发送或回车触发 handleSend
 *   2. 调用 getCurrentSceneLocation 获取光标所在场景
 *   3. 调用 getSceneContext 获取后端 4 层上下文 (SceneContext)
 *   4. 调用 PromptBuilder.buildContinuationPrompt 构建提示词
 *   5. 在 system prompt 末尾追加用户指令
 *   6. 调用 streamChatCompletion 发起流式请求
 *   7. 流式累加 chunk 到当前 assistant 消息
 *   8. 用户可"插入到文档"或"复制"AI 回复
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

  // 对话消息列表
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  // 输入框文本
  const [input, setInput] = useState("");
  // 是否正在流式生成
  const [isStreaming, setIsStreaming] = useState(false);
  // 错误提示 (如未配置 API Key)
  const [panelError, setPanelError] = useState<string | null>(null);
  // 已复制消息 ID (用于复制按钮反馈)
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // AI 配置缓存 (避免每次发送都重新读取)
  const aiConfigRef = useRef<AiConfig | null>(null);
  // 消息列表底部滚动容器 ref (自动滚动到最新消息)
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // 输入框 ref (打开面板时自动聚焦)
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sprint 6: 当前 AI 任务类型 (默认续写)
  const [taskType, setTaskType] = useState<AiTaskType>("continuation");
  // Sprint 6: 当前绑定的角色 UUID (dialogue / consistencyCheck 任务使用)
  // 由外部 pendingCharacterId 注入, 或手动切换任务类型时清空
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  // Sprint 6: 当前绑定的选中文本 (consistencyCheck 任务使用)
  const [activeSelectedText, setActiveSelectedText] = useState<string | null>(null);
  // Sprint 6: 任务类型下拉展开状态
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  // 任务类型下拉菜单 ref (用于点击外部关闭)
  const taskMenuRef = useRef<HTMLDivElement>(null);

  // 自动滚动到最新消息
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  // 打开面板时加载 AI 配置并聚焦输入框
  useEffect(() => {
    if (!open) return;
    // 加载 AI 配置
    getAiConfig()
      .then((config) => {
        aiConfigRef.current = config;
        if (!config.enabled) {
          setPanelError(t("ai.panel.notEnabled"));
        } else if (!config.apiKey) {
          setPanelError(t("ai.panel.noApiKey"));
        } else {
          setPanelError(null);
        }
      })
      .catch((err) => {
        setPanelError(`${t("ai.panel.configLoadFailed")}: ${String(err)}`);
      });
    // 延迟聚焦输入框
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => window.clearTimeout(timer);
  }, [open, t]);

  // Esc 键关闭面板
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        // 任务菜单展开时优先关闭菜单
        if (taskMenuOpen) {
          setTaskMenuOpen(false);
          return;
        }
        // 流式生成中 Esc 中断请求
        if (isStreaming) {
          cancelStreamCompletion().catch(() => {});
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isStreaming, onClose, taskMenuOpen]);

  // Sprint 6: 任务菜单外部点击关闭
  useEffect(() => {
    if (!taskMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (taskMenuRef.current && !taskMenuRef.current.contains(e.target as Node)) {
        setTaskMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [taskMenuOpen]);

  // 外部注入指令自动发送 (AI-3.4 右键菜单触发 / Sprint 6 任务触发)
  // 当 pendingInstruction 变化且非空时:
  //   1. 同步外部注入的任务类型 / 角色ID / 选中文本到本地状态
  //   2. 填入输入框并触发 handleSend
  useEffect(() => {
    if (!open || !pendingInstruction) return;
    // Sprint 6: 同步外部任务上下文
    if (pendingTaskType) {
      setTaskType(pendingTaskType);
    }
    if (pendingCharacterId !== undefined) {
      setActiveCharacterId(pendingCharacterId);
    }
    if (pendingSelectedText !== undefined) {
      setActiveSelectedText(pendingSelectedText);
    }
    setInput(pendingInstruction);
    onPendingInstructionConsumed?.();
    onPendingTaskConsumed?.();
    // 延迟调用 handleSend 以确保 input 与任务状态已更新
    // 使用 ref 避免 handleSend 闭包过期
    const timer = window.setTimeout(() => {
      handleSendRef.current?.(pendingInstruction);
    }, 50);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingInstruction, pendingTaskType, pendingCharacterId, pendingSelectedText]);

  /**
   * 计算章节 ID (相对项目根的路径)
   * 输入: 无
   * 输出: string 章节相对路径 (如 "正文/第一章.pmd")
   * 流程:
   *   1. 校验 filePath 与 projectPath 有效性
   *   2. 截取 filePath 中 projectPath 之后的部分作为 chapterId
   *   3. 统一路径分隔符为正斜杠
   */
  const computeChapterId = useCallback((): string | null => {
    if (!filePath || !projectPath) return null;
    const normalizedFile = filePath.replace(/\\/g, "/");
    const normalizedProject = projectPath.replace(/\\/g, "/");
    if (!normalizedFile.startsWith(normalizedProject)) return null;
    // 截取相对路径并去除前导斜杠
    const relative = normalizedFile.slice(normalizedProject.length).replace(/^\/+/, "");
    return relative || null;
  }, [filePath, projectPath]);

  /**
   * Sprint 6: 根据任务类型构建 Prompt
   * 输入:
   *   currentTask - 当前任务类型
   *   instruction - 用户指令
   *   sceneLoc - 当前场景位置 (continuation / dialogue 需要)
   * 输出: Promise<BuiltPrompt | null> 构建完成的 Prompt, null 表示前置校验失败
   * 流程:
   *   1. continuation: getSceneContext + buildContinuationPrompt
   *   2. dialogue: getCharacterContext + getSceneContext + buildDialoguePrompt
   *   3. consistencyCheck: getCharacterContext + activeSelectedText + buildConsistencyCheckPrompt
   *   4. plotReview: getProjectContext + buildPlotReviewPrompt
   *   5. outlineGeneration: getProjectContext + buildOutlineGenerationPrompt
   * 容错: 各类前置校验失败时弹出 toast 并返回 null
   */
  const buildPromptByTask = useCallback(
    async (
      currentTask: AiTaskType,
      instruction: string,
      sceneLoc: { sceneIndex: number } | null
    ): Promise<{ system: string; user: string } | null> => {
      const builder = new PromptBuilder(editorPrefs);

      // continuation: 续写任务, 需要场景上下文
      if (currentTask === "continuation") {
        if (!sceneLoc) {
          showToast("error", t("ai.panel.noSceneFound"));
          return null;
        }
        const chapterId = computeChapterId();
        if (!chapterId) {
          showToast("error", t("ai.panel.invalidChapter"));
          return null;
        }
        try {
          const req: SceneContextRequest = {
            projectPath,
            chapterId,
            sceneIndex: sceneLoc.sceneIndex,
          };
          const sceneContext: SceneContext = await getSceneContext(req);
          const built = builder.buildContinuationPrompt(sceneContext);
          return {
            system: `${built.system}\n\n用户额外指令: ${instruction}`,
            user: built.user,
          };
        } catch (err) {
          showToast("error", `${t("ai.panel.generationFailed")}: ${String(err)}`);
          return null;
        }
      }

      // dialogue: 对话生成, 需要角色上下文 + 场景上下文
      if (currentTask === "dialogue") {
        if (!activeCharacterId) {
          showToast("error", t("ai.panel.noCharacterSelected"));
          return null;
        }
        if (!sceneLoc) {
          showToast("error", t("ai.panel.noSceneFound"));
          return null;
        }
        const chapterId = computeChapterId();
        if (!chapterId) {
          showToast("error", t("ai.panel.invalidChapter"));
          return null;
        }
        try {
          const [characterCtx, sceneCtx] = await Promise.all([
            getCharacterContext(projectPath, activeCharacterId),
            getSceneContext({
              projectPath,
              chapterId,
              sceneIndex: sceneLoc.sceneIndex,
            }),
          ]);
          showToast("success", t("ai.panel.characterContextLoaded"));
          const built = builder.buildDialoguePrompt(characterCtx, sceneCtx);
          return {
            system: `${built.system}\n\n用户额外指令: ${instruction}`,
            user: built.user,
          };
        } catch (err) {
          showToast("error", `${t("ai.panel.characterContextLoadFailed")}: ${String(err)}`);
          return null;
        }
      }

      // consistencyCheck: 一致性校验, 需要角色上下文 + 选中文本
      if (currentTask === "consistencyCheck") {
        if (!activeCharacterId) {
          showToast("error", t("ai.panel.noCharacterSelected"));
          return null;
        }
        if (!activeSelectedText || !activeSelectedText.trim()) {
          showToast("error", t("ai.panel.noSelectedText"));
          return null;
        }
        try {
          const characterCtx = await getCharacterContext(projectPath, activeCharacterId);
          showToast("success", t("ai.panel.characterContextLoaded"));
          const built = builder.buildConsistencyCheckPrompt(
            characterCtx,
            activeSelectedText
          );
          return {
            system: `${built.system}\n\n用户额外指令: ${instruction}`,
            user: built.user,
          };
        } catch (err) {
          showToast("error", `${t("ai.panel.characterContextLoadFailed")}: ${String(err)}`);
          return null;
        }
      }

      // plotReview: 剧情推演, 需要项目上下文
      if (currentTask === "plotReview") {
        try {
          const projectCtx: ProjectContext = await getProjectContext(projectPath);
          showToast("success", t("ai.panel.projectContextLoaded"));
          const built = builder.buildPlotReviewPrompt(projectCtx);
          return {
            system: `${built.system}\n\n用户额外指令: ${instruction}`,
            user: built.user,
          };
        } catch (err) {
          showToast("error", `${t("ai.panel.projectContextLoadFailed")}: ${String(err)}`);
          return null;
        }
      }

      // outlineGeneration: 大纲生成, 需要项目上下文
      if (currentTask === "outlineGeneration") {
        try {
          const projectCtx: ProjectContext = await getProjectContext(projectPath);
          showToast("success", t("ai.panel.projectContextLoaded"));
          const built = builder.buildOutlineGenerationPrompt(projectCtx);
          return {
            system: `${built.system}\n\n用户额外指令: ${instruction}`,
            user: built.user,
          };
        } catch (err) {
          showToast("error", `${t("ai.panel.projectContextLoadFailed")}: ${String(err)}`);
          return null;
        }
      }

      return null;
    },
    [
      editorPrefs,
      activeCharacterId,
      activeSelectedText,
      projectPath,
      computeChapterId,
      t,
      showToast,
    ]
  );

  /**
   * 发送用户指令
   * 输入: overrideInstruction 外部注入指令 (AI-3.4 右键菜单触发, 不传则读取 input 状态)
   * 输出: Promise<void>
   * 流程:
   *   1. 校验输入与配置
   *   2. 续写/对话类任务需要编辑器与场景位置; 校验/推演/大纲类不需要
   *   3. 根据 taskType 调用 buildPromptByTask 构建提示词
   *   4. 调用 streamChatCompletion 流式生成
   *   5. 累加 chunk 到 assistant 消息
   *   6. 完成或失败时更新消息状态
   */
  const handleSend = useCallback(async (overrideInstruction?: string) => {
    const instruction = (overrideInstruction ?? input).trim();
    if (!instruction || isStreaming) return;

    // 校验 AI 配置
    const config = aiConfigRef.current;
    if (!config || !config.enabled) {
      setPanelError(t("ai.panel.notEnabled"));
      return;
    }
    if (!config.apiKey) {
      setPanelError(t("ai.panel.noApiKey"));
      return;
    }

    // 续写/对话类任务需要编辑器与场景位置; 校验/推演/大纲类不需要
    const needsScene = taskType === "continuation" || taskType === "dialogue";
    let sceneLoc: { sceneIndex: number } | null = null;
    if (needsScene) {
      if (!editor || editor.isDestroyed) {
        showToast("error", t("ai.panel.editorNotReady"));
        return;
      }
      sceneLoc = getCurrentSceneLocation(editor);
      if (!sceneLoc) {
        showToast("error", t("ai.panel.noSceneFound"));
        return;
      }
    }

    // 创建用户消息
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
      // Sprint 6: 根据任务类型构建 Prompt
      const builtPrompt = await buildPromptByTask(taskType, instruction, sceneLoc);
      if (!builtPrompt) {
        // 前置校验失败, 移除占位消息
        setMessages((prev) =>
          prev.filter((m) => m.id !== userMsgId && m.id !== assistantMsgId)
        );
        setIsStreaming(false);
        return;
      }

      // 组装聊天消息 (含历史消息, 保持多轮对话上下文)
      const chatMessages: ChatMessage[] = [
        { role: "system", content: builtPrompt.system },
      ];
      // 追加历史对话 (最多保留最近 4 轮, 避免 Token 爆炸)
      const recentHistory = messages.slice(-8);
      for (const msg of recentHistory) {
        if (msg.content && !msg.isStreaming) {
          chatMessages.push({ role: msg.role, content: msg.content });
        }
      }
      // 追加当前 user prompt
      chatMessages.push({ role: "user", content: builtPrompt.user });

      // 流式累加 chunk
      let accumulated = "";
      await streamChatCompletion(chatMessages, config, {
        onChunk: (chunk) => {
          accumulated += chunk;
          // 更新 assistant 消息内容
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, content: accumulated } : m
            )
          );
        },
        onDone: (error) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    isStreaming: false,
                    error: error || undefined,
                  }
                : m
            )
          );
          if (error) {
            showToast("warning", `${t("ai.panel.streamInterrupted")}: ${error}`);
          }
        },
      });
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
    } finally {
      setIsStreaming(false);
    }
  }, [
    input,
    isStreaming,
    editor,
    projectPath,
    messages,
    editorPrefs,
    computeChapterId,
    t,
    showToast,
    taskType,
    buildPromptByTask,
  ]);

  // handleSend 的 ref 引用 (供 pendingInstruction useEffect 调用, 避免闭包过期)
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  /**
   * 中断流式生成
   */
  const handleCancel = useCallback(() => {
    cancelStreamCompletion().catch(() => {});
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((m) =>
        m.isStreaming ? { ...m, isStreaming: false, error: t("ai.panel.userCanceled") } : m
      )
    );
  }, [t]);

  /**
   * 清空对话历史
   */
  const handleClear = useCallback(() => {
    if (isStreaming) return;
    setMessages([]);
    setPanelError(null);
  }, [isStreaming]);

  /**
   * 复制消息内容到剪贴板
   */
  const handleCopy = useCallback(
    async (msgId: string, content: string) => {
      try {
        await navigator.clipboard.writeText(content);
        setCopiedId(msgId);
        window.setTimeout(() => setCopiedId(null), 1500);
      } catch {
        showToast("error", t("ai.panel.copyFailed"));
      }
    },
    [t, showToast]
  );

  /**
   * 插入 AI 回复到编辑器当前光标位置
   * 输入: content 要插入的文本
   * 流程:
   *   1. 校验编辑器有效
   *   2. 调用 editor.chain().focus().insertContent() 插入内容
   *   3. 按 \n 分割为多个段落, 每段插入为 <p> 节点
   */
  const handleInsertToDoc = useCallback(
    (content: string) => {
      if (!editor || editor.isDestroyed) {
        showToast("error", t("ai.panel.editorNotReady"));
        return;
      }
      try {
        // 按段落分割, 转为 TipTap 段落节点
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

  if (!open) return null;

  // 使用 Portal 渲染到 body, 避免父元素层叠上下文 (relative z-10) 限制导致面板被右侧 FileList 遮挡
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

        {/* Sprint 6: 任务类型切换栏 */}
        <div className="px-4 py-2 border-b border-nf-border-light bg-nf-bg-hover/30">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-nf-text-tertiary">
                {t("ai.panel.taskType")}:
              </span>
              <div className="relative" ref={taskMenuRef}>
                <button
                  type="button"
                  onClick={() => setTaskMenuOpen((v) => !v)}
                  disabled={isStreaming}
                  tabIndex={-1}
                  className="flex items-center gap-1 h-6 px-2 text-[11px] text-nf-text-secondary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/40 bg-nf-bg transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="font-medium">
                    {t(`ai.panel.task.${taskType}`)}
                  </span>
                  <ChevronDown
                    className={`w-3 h-3 transition-transform duration-fast ${
                      taskMenuOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {taskMenuOpen && (
                  <div className="absolute top-full left-0 mt-1 z-[102] min-w-[140px] bg-nf-bg-card border border-nf-border-light shadow-xl py-1">
                    {(
                      [
                        "continuation",
                        "dialogue",
                        "consistencyCheck",
                        "plotReview",
                        "outlineGeneration",
                      ] as AiTaskType[]
                    ).map((tt) => (
                      <button
                        key={tt}
                        type="button"
                        onClick={() => {
                          setTaskType(tt);
                          // 切换任务类型时清空外部注入的上下文, 避免误用
                          if (tt !== "dialogue" && tt !== "consistencyCheck") {
                            setActiveCharacterId(null);
                          }
                          if (tt !== "consistencyCheck") {
                            setActiveSelectedText(null);
                          }
                          setTaskMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors duration-fast ${
                          tt === taskType
                            ? "text-fandex-primary bg-fandex-primary/10"
                            : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
                        }`}
                      >
                        {t(`ai.panel.task.${tt}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <span className="text-[10px] text-nf-text-tertiary italic">
              {t("ai.panel.taskHint")}
            </span>
          </div>
        </div>

        {/* 错误提示区 */}
        {panelError && (
          <div className="px-4 py-2 bg-fandex-tertiary/10 border-b border-fandex-tertiary/30 flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-fandex-tertiary mt-0.5 flex-shrink-0" />
            <p className="text-xs text-fandex-tertiary leading-relaxed">{panelError}</p>
          </div>
        )}

        {/* 消息列表区 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <Sparkles className="w-8 h-8 text-nf-text-tertiary mb-3" />
              <p className="text-sm text-nf-text-secondary mb-1">
                {t("ai.panel.emptyHint")}
              </p>
              <p className="text-xs text-nf-text-tertiary">
                {t("ai.panel.emptyHintDesc")}
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
              >
                {/* 用户消息气泡 */}
                {msg.role === "user" ? (
                  <div className="max-w-[85%] bg-fandex-primary/15 border border-fandex-primary/30 px-3 py-2 text-sm text-nf-text">
                    {msg.content}
                    {msg.sceneSnapshot && (
                      <div className="mt-1.5 text-[10px] text-nf-text-tertiary border-t border-fandex-primary/20 pt-1">
                        {t("ai.panel.sceneContext")}: {msg.sceneSnapshot.sceneTitle}
                      </div>
                    )}
                  </div>
                ) : (
                  /* 助手消息区 */
                  <div className="max-w-[95%] w-full">
                    <div className="bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text">
                      {msg.content ? (
                        renderMarkdown(msg.content)
                      ) : msg.isStreaming ? (
                        <span className="text-nf-text-tertiary italic">
                          {t("ai.panel.thinking")}
                        </span>
                      ) : (
                        <span className="text-nf-text-tertiary">
                          {t("ai.panel.noResponse")}
                        </span>
                      )}
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
                    {/* 操作按钮 (非流式状态) */}
                    {!msg.isStreaming && msg.content && !msg.error && (
                      <div className="flex items-center gap-1 mt-1.5">
                        <button
                          type="button"
                          onClick={() => handleInsertToDoc(msg.content)}
                          title={t("ai.panel.insertToDoc")}
                          tabIndex={-1}
                          className="nf-tool-btn flex items-center gap-1 h-6 px-2 text-[11px] text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover border border-nf-border-light/50 transition-colors duration-fast"
                        >
                          <ClipboardPaste className="w-3 h-3" />
                          {t("ai.panel.insert")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopy(msg.id, msg.content)}
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
            ))
          )}
          {/* 滚动锚点 */}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区 */}
        <footer className="border-t border-nf-border-light px-4 py-3 space-y-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter 发送, Shift+Enter 换行
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={t("ai.panel.inputPlaceholder")}
            disabled={isStreaming}
            rows={3}
            className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder:text-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition-colors duration-fast resize-none disabled:opacity-60"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-nf-text-tertiary">
              {t("ai.panel.inputHint")}
            </span>
            <div className="flex items-center gap-2">
              {isStreaming ? (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="flex items-center gap-1 h-7 px-3 text-xs text-fandex-tertiary border border-fandex-tertiary/40 hover:bg-fandex-tertiary/10 transition-colors duration-fast"
                >
                  <Square className="w-3 h-3" />
                  {t("ai.panel.stop")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  className="flex items-center gap-1 h-7 px-3 text-xs text-nf-text-inverse bg-fandex-primary hover:bg-fandex-primary-hover transition-colors duration-fast disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send className="w-3 h-3" />
                  {t("ai.panel.send")}
                </button>
              )}
            </div>
          </div>
        </footer>
      </aside>
    </>,
    document.body
  );
}
