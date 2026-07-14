// AI Prompt 构建 Hook (SubTask 12.4)
//
// 功能概述:
//   抽取自 AiAssistantPanel 的 buildPromptByTask 逻辑, 集中管理 5 类 AI 任务
//   (续写/对话/校验/推演/大纲) 的 Prompt 组装. 实现 4 层上下文注入链路:
//     层 1: getCurrentSceneLocation - 定位当前光标所在场景
//     层 2: getSceneContext / getCharacterContext / getProjectContext - 拉取后端上下文
//     层 3: PromptBuilder.build*Prompt - 构建结构化 Prompt
//     层 4: 用户额外指令注入 - 追加到 system 末尾
//
// 模块职责:
//   1. 根据 taskType 路由到对应 Prompt 构建方法
//   2. 调用后端 API 获取上下文数据 (场景/角色/项目)
//   3. 调用 PromptBuilder 组装最终 Prompt
//   4. 在 system prompt 末尾追加用户额外指令
//   5. 校验失败时通过 toast 提示并返回 null
//
// 设计说明:
//   - 异步函数全部 try-catch 包裹, 错误信息透传给调用方
//   - 不直接调用 aiService 流式接口 (由 useAiStream 负责)
//   - 项目偏好 (EditorPreferences) 通过 PromptBuilder 注入 System Prompt

import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import {
  PromptBuilder,
  type SceneContext,
  type ProjectContext,
  type AiTaskType,
} from "../lib/promptBuilder";
import {
  getSceneContext,
  getCharacterContext,
  getProjectContext,
  type SceneContextRequest,
} from "../lib/api";
import { getCurrentSceneLocation } from "../lib/tiptap/sceneUtils";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import type { EditorPreferences } from "../lib/preferencesSlice";

/**
 * 构建完成的 Prompt 结构
 * - system: System Prompt (含用户额外指令追加)
 * - user:   User Prompt (任务指令 + 上下文数据)
 */
export interface BuiltPrompt {
  system: string;
  user: string;
}

/**
 * 场景位置最小信息 (仅含 sceneIndex, 供 Prompt 构建使用)
 */
export interface SceneLocationInfo {
  sceneIndex: number;
}

/**
 * usePromptBuilder Hook 返回值
 */
export interface UsePromptBuilderReturn {
  /**
   * 根据任务类型构建 Prompt
   * 输入:
   *   currentTask - 当前任务类型
   *   instruction - 用户额外指令 (追加到 system 末尾)
   *   sceneLoc    - 当前场景位置 (continuation / dialogue 需要)
   * 输出: Promise<BuiltPrompt | null> 构建结果, null 表示前置校验失败
   */
  buildPromptByTask: (
    currentTask: AiTaskType,
    instruction: string,
    sceneLoc: SceneLocationInfo | null
  ) => Promise<BuiltPrompt | null>;
}

/**
 * usePromptBuilder Hook 参数
 */
interface UsePromptBuilderParams {
  /** 编辑器偏好 (用于 PromptBuilder 注入 System Prompt 约束) */
  editorPrefs: EditorPreferences;
  /** 项目根路径 (绝对路径) */
  projectPath: string;
  /** 当前文件路径 (绝对路径, 用于计算 chapterId) */
  filePath: string | null;
  /** 当前绑定的角色 UUID (dialogue / consistencyCheck 任务使用) */
  activeCharacterId: string | null;
  /** 当前绑定的选中文本 (consistencyCheck 任务使用) */
  activeSelectedText: string | null;
}

/**
 * usePromptBuilder - AI Prompt 构建逻辑 Hook
 *
 * 输入: projectPath / filePath / editorPrefs / activeCharacterId / activeSelectedText
 * 输出: buildPromptByTask 方法
 * 流程:
 *   1. computeChapterId 计算相对项目根的章节路径
 *   2. 根据任务类型路由到不同的 Prompt 构建方法
 *   3. 拉取对应上下文 (SceneContext / CharacterContext / ProjectContext)
 *   4. 调用 PromptBuilder 构建结构化 Prompt
 *   5. 在 system 末尾追加用户额外指令
 */
export function usePromptBuilder({
  editorPrefs,
  projectPath,
  filePath,
  activeCharacterId,
  activeSelectedText,
}: UsePromptBuilderParams): UsePromptBuilderReturn {
  const { t } = useI18n();
  const { showToast } = useToast();

  /**
   * 计算章节 ID (相对项目根的路径)
   * 输入: 无
   * 输出: string | null 章节相对路径 (如 "正文/第一章.pmd")
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
    const relative = normalizedFile
      .slice(normalizedProject.length)
      .replace(/^\/+/, "");
    return relative || null;
  }, [filePath, projectPath]);

  /**
   * 根据任务类型构建 Prompt
   * 路由表:
   *   - continuation:      getSceneContext + buildContinuationPrompt
   *   - dialogue:           getCharacterContext + getSceneContext + buildDialoguePrompt
   *   - consistencyCheck:   getCharacterContext + buildConsistencyCheckPrompt
   *   - plotReview:         getProjectContext + buildPlotReviewPrompt
   *   - outlineGeneration:  getProjectContext + buildOutlineGenerationPrompt
   * 容错: 各类前置校验失败时弹出 toast 并返回 null
   */
  const buildPromptByTask = useCallback(
    async (
      currentTask: AiTaskType,
      instruction: string,
      sceneLoc: SceneLocationInfo | null
    ): Promise<BuiltPrompt | null> => {
      try {
        const builder = new PromptBuilder(editorPrefs);

        // ── continuation: 续写任务, 需要场景上下文 ──
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
            // 用户额外指令注入到 system 末尾
            return {
              system: `${built.system}\n\n用户额外指令: ${instruction}`,
              user: built.user,
            };
          } catch (err) {
            showToast(
              "error",
              `${t("ai.panel.generationFailed")}: ${String(err)}`
            );
            return null;
          }
        }

        // ── dialogue: 对话生成, 需要角色上下文 + 场景上下文 ──
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
            showToast(
              "error",
              `${t("ai.panel.characterContextLoadFailed")}: ${String(err)}`
            );
            return null;
          }
        }

        // ── consistencyCheck: 一致性校验, 需要角色上下文 + 选中文本 ──
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
            const characterCtx = await getCharacterContext(
              projectPath,
              activeCharacterId
            );
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
            showToast(
              "error",
              `${t("ai.panel.characterContextLoadFailed")}: ${String(err)}`
            );
            return null;
          }
        }

        // ── plotReview: 剧情推演, 需要项目上下文 ──
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
            showToast(
              "error",
              `${t("ai.panel.projectContextLoadFailed")}: ${String(err)}`
            );
            return null;
          }
        }

        // ── outlineGeneration: 大纲生成, 需要项目上下文 ──
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
            showToast(
              "error",
              `${t("ai.panel.projectContextLoadFailed")}: ${String(err)}`
            );
            return null;
          }
        }

        return null;
      } catch (err) {
        // 顶层异常兜底 (理论上不应到达, 仅为防御性编程)
        showToast("error", `${t("ai.panel.generationFailed")}: ${String(err)}`);
        return null;
      }
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

  return { buildPromptByTask };
}

/**
 * 暴露 getCurrentSceneLocation 引用, 便于上层组件统一从 hook 获取场景定位能力
 * 输入: editor TipTap Editor 实例
 * 输出: SceneLocationInfo | null 当前场景位置
 */
export function locateScene(editor: Editor | null): SceneLocationInfo | null {
  if (!editor || editor.isDestroyed) return null;
  const loc = getCurrentSceneLocation(editor);
  if (!loc) return null;
  return { sceneIndex: loc.sceneIndex };
}
