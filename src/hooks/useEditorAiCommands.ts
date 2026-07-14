// 编辑器 AI 命令组装 Hook
//
// 功能概述：
// 抽取 NovelEditor 的 AI 命令组装与面板联动逻辑，包括：
// 1. BubbleMenu 右键命令：润色/扩写/缩写/角色一致性检查
// 2. 角色悬停卡片 AI 操作：总结状态/生成对白
// 3. AI 面板可见性管理
// 4. pending 指令与任务上下文管理（供 AiAssistantPanel 消费）
//
// 模块职责：
// - 组装预设指令模板并填入选中文本或角色名
// - 管理 pendingAiInstruction / pendingAiCharacterId / pendingAiSelectedText / pendingAiTaskType
// - 切换 AI 任务类型（continuation / dialogue / consistencyCheck）
// - 打开 AI 面板
//
// 设计原则：
// - 与 AiAssistantPanel 通过 pending* props + onPending*Consumed 回调联动
// - characterCheck 从选区遍历 characterMentionNode 提取首个 characterId
// - editor 实例通过 props 传入

import { useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";

// ===== 类型定义 =====

/** AI 任务类型（与 AiAssistantPanel 对齐） */
export type AiTaskType =
  | "continuation"
  | "dialogue"
  | "consistencyCheck"
  | "plotReview"
  | "outlineGeneration";

/** BubbleMenu AI 命令类型 */
export type AiCommandType = "polish" | "expand" | "condense" | "characterCheck";

/** 角色悬停卡片 AI 操作类型 */
export type CharacterAiActionType = "summarize-state" | "generate-dialogue";

/** useEditorAiCommands 输入参数 */
export interface UseEditorAiCommandsParams {
  /** TipTap 编辑器实例（用于 characterCheck 选区遍历） */
  editor: Editor | null;
}

/** useEditorAiCommands 返回值 */
export interface UseEditorAiCommandsResult {
  /** AI 面板是否可见 */
  showAiPanel: boolean;
  /** 切换 AI 面板可见性 */
  setShowAiPanel: React.Dispatch<React.SetStateAction<boolean>>;
  /** 待发送的 AI 指令（AiAssistantPanel 消费后清空） */
  pendingAiInstruction: string | null;
  /** 清空待发送指令（供 AiAssistantPanel onPendingInstructionConsumed） */
  setPendingAiInstruction: React.Dispatch<React.SetStateAction<string | null>>;
  /** 待发送的角色 UUID（dialogue/consistencyCheck 任务需要） */
  pendingAiCharacterId: string | null;
  /** 待发送的选中文本（consistencyCheck 任务需要） */
  pendingAiSelectedText: string | null;
  /** 待发送的任务类型 */
  pendingAiTaskType: AiTaskType | null;
  /** 清空任务上下文（供 AiAssistantPanel onPendingTaskConsumed） */
  clearPendingAiTask: () => void;
  /** BubbleMenu AI 命令处理 */
  handleAiCommand: (command: AiCommandType, selectedText: string) => void;
  /** 角色悬停卡片 AI 操作处理 */
  handleCharacterAiAction: (
    action: CharacterAiActionType,
    characterId: string | undefined,
    characterName: string
  ) => void;
}

// ===== Hook 实现 =====

/**
 * 编辑器 AI 命令组装 Hook
 * 输入: UseEditorAiCommandsParams（editor）
 * 输出: UseEditorAiCommandsResult（pending 状态 + handlers）
 * 核心流程:
 *   1. handleAiCommand：根据命令类型选择模板，填入选中文本
 *      - polish/expand/condense：continuation 任务
 *      - characterCheck：consistencyCheck 任务，遍历选区提取 characterId
 *   2. handleCharacterAiAction：根据操作类型选择模板，填入角色名与 UUID
 *      - summarize-state：continuation 任务
 *      - generate-dialogue：dialogue 任务，注入 characterId
 *   3. 设置 pending* 状态并打开 AI 面板
 *   4. AiAssistantPanel 消费 pending* 后通过 onPending*Consumed 清空
 */
export function useEditorAiCommands(
  params: UseEditorAiCommandsParams
): UseEditorAiCommandsResult {
  const { editor } = params;

  const [showAiPanel, setShowAiPanel] = useState(false);
  // AI 待发送指令（BubbleMenu 右键菜单 / 角色卡片 AI 操作触发）
  const [pendingAiInstruction, setPendingAiInstruction] = useState<string | null>(null);
  // AI 任务上下文：角色 UUID（dialogue / consistencyCheck 任务需要）
  const [pendingAiCharacterId, setPendingAiCharacterId] = useState<string | null>(null);
  // AI 任务上下文：选中文本（consistencyCheck 任务需要）
  const [pendingAiSelectedText, setPendingAiSelectedText] = useState<string | null>(null);
  // AI 任务类型（默认 continuation，外部触发特定任务时切换）
  const [pendingAiTaskType, setPendingAiTaskType] = useState<AiTaskType | null>(null);

  /**
   * 清空任务上下文（供 AiAssistantPanel onPendingTaskConsumed 回调）
   * 流程: 将 characterId / selectedText / taskType 全部置空
   */
  const clearPendingAiTask = useCallback(() => {
    setPendingAiCharacterId(null);
    setPendingAiSelectedText(null);
    setPendingAiTaskType(null);
  }, []);

  /**
   * AI 预设指令处理（BubbleMenu 右键菜单触发）
   * 输入:
   *   command - 预设指令类型（polish/expand/condense/characterCheck）
   *   selectedText - 选中文本
   * 输出: void（组装指令并打开 AI 助手面板）
   * 流程:
   *   1. 根据 command 类型选择预设指令模板
   *   2. 将选中文本填入模板生成完整 instruction
   *   3. characterCheck 命令切换为 consistencyCheck 任务类型，
   *      并从选区遍历 characterMentionNode 提取首个 characterId
   *   4. 设置 pendingAiInstruction 与任务上下文，打开 AI 面板
   *   5. AiAssistantPanel 消费 pendingInstruction 后自动发送
   */
  const handleAiCommand = useCallback(
    (command: AiCommandType, selectedText: string) => {
      const templates: Record<AiCommandType, string> = {
        polish: "请润色以下文本，保持原意，提升文学性与节奏感：\n\n",
        expand: "请基于以下文本进行扩写，增加细节描写、环境烘托与心理刻画：\n\n",
        condense: "请精简以下文本，保留核心信息与关键情节，删除冗余表述：\n\n",
        characterCheck:
          "请检查以下文本中角色的行为与对话是否符合设定库中的角色设定，逐条分析是否存在 OOC（Out Of Character）情况，并给出修正建议：\n\n",
      };
      const instruction = (templates[command] || "") + selectedText;
      setPendingAiInstruction(instruction);

      if (command === "characterCheck") {
        // characterCheck 切换为 consistencyCheck 任务，尝试从选区提取 characterId
        setPendingAiTaskType("consistencyCheck");
        setPendingAiSelectedText(selectedText);
        // 遍历选区内的 characterMentionNode，提取首个 characterId
        let extractedCharacterId: string | null = null;
        if (editor && !editor.isDestroyed) {
          const { state } = editor;
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node) => {
            if (extractedCharacterId) return false;
            if (node.type.name === "characterMentionNode") {
              const cid = node.attrs.characterId as string | undefined;
              if (cid) {
                extractedCharacterId = cid;
                return false;
              }
            }
            return true;
          });
        }
        setPendingAiCharacterId(extractedCharacterId);
      } else {
        // polish/expand/condense 保持 continuation 任务
        setPendingAiTaskType("continuation");
        setPendingAiSelectedText(null);
        setPendingAiCharacterId(null);
      }
      setShowAiPanel(true);
    },
    [editor]
  );

  /**
   * 角色悬停卡片 AI 操作处理
   * 输入:
   *   action - 操作类型（summarize-state / generate-dialogue）
   *   characterId - 角色实体 UUID（可能为 undefined）
   *   characterName - 角色显示名
   * 输出: void（组装指令并打开 AI 助手面板）
   * 流程:
   *   1. 根据 action 类型选择预设指令模板
   *   2. 将角色名填入模板，附加 characterId 供 AI 上下文检索
   *   3. generate-dialogue 切换为 dialogue 任务类型并设置 characterId
   *   4. 设置 pendingAiInstruction 与任务上下文，打开 AI 面板
   * 容错: characterId 为 undefined 时仅按名称匹配，不阻塞 AI 调用
   */
  const handleCharacterAiAction = useCallback(
    (
      action: CharacterAiActionType,
      characterId: string | undefined,
      characterName: string
    ) => {
      const templates: Record<CharacterAiActionType, string> = {
        "summarize-state":
          `请基于设定库中角色「${characterName}` +
          (characterId ? `（UUID: ${characterId}）` : "") +
          `」的档案，结合当前正文场景，总结该角色在故事中此刻的心理状态、动机与潜在行为倾向，输出一段 150-300 字的状态描摹供后续创作参考：\n\n`,
        "generate-dialogue":
          `请基于设定库中角色「${characterName}` +
          (characterId ? `（UUID: ${characterId}）` : "") +
          `」的档案与说话风格，结合当前正文场景，生成 3-5 句符合该角色性格的对白，保持语气与措辞一致：\n\n`,
      };
      const instruction = templates[action] || "";
      if (!instruction) return;
      setPendingAiInstruction(instruction);

      if (action === "generate-dialogue") {
        // generate-dialogue 切换为 dialogue 任务，注入 characterId
        setPendingAiTaskType("dialogue");
        setPendingAiCharacterId(characterId || null);
      } else {
        // summarize-state 保持 continuation 任务
        setPendingAiTaskType("continuation");
        setPendingAiCharacterId(null);
      }
      setPendingAiSelectedText(null);
      setShowAiPanel(true);
    },
    []
  );

  return {
    showAiPanel,
    setShowAiPanel,
    pendingAiInstruction,
    setPendingAiInstruction,
    pendingAiCharacterId,
    pendingAiSelectedText,
    pendingAiTaskType,
    clearPendingAiTask,
    handleAiCommand,
    handleCharacterAiAction,
  };
}
