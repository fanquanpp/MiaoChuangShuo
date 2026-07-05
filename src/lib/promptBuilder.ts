// AI 提示词构建器（PromptBuilder）
//
// 功能概述：
// 统一管理 AI 功能（续写、对话生成、一致性校验、剧情推演）的 Prompt 组装逻辑。
// 将用户偏好（EditorPreferences）、场景上下文（SceneContext）、角色上下文
//（CharacterContext）、项目上下文（ProjectContext）汇聚为发给 LLM 的完整 Prompt。
//
// 模块职责：
// 1. 根据用户偏好生成 System Prompt 约束（开关注入）
// 2. 提供不同 AI 场景的 Prompt 构建方法（续写/对话/校验/推演）
// 3. 结构化组织上下文信息，避免 Prompt 散乱
// 4. 为阶段 6 AI 集成提供统一入口，未来 LLM 调用直接消费此处生成的 Prompt
//
// AI-Ready 设计说明：
// - 当前为接口定义阶段（阶段 5 提前执行），不发起实际 LLM 调用
// - 前端 AI 面板可通过此 Builder 构造 Prompt，配合 Mock 响应进行 UI 开发
// - 阶段 6 接入实际 LLM 时，仅需替换 sendPrompt 的实现，Prompt 构造逻辑无需重构
// - 所有上下文结构（SceneContext 等）与后端 ai_context.rs 保持字段一致（camelCase）

import type { EditorPreferences } from "./preferencesSlice";

// ===== 上下文类型定义（与后端 ai_context.rs 结构对应） =====

/**
 * 角色简要信息（场景上下文中的出场角色）
 */
export interface CharacterBrief {
  id: string;
  name: string;
  aliases: string[];
  summary: string;
}

/**
 * 设定简要信息（场景上下文中的相关设定引用）
 */
export interface SettingBrief {
  id: string;
  name: string;
  category: string;
  summary: string;
}

/**
 * 伏笔简要信息（场景上下文中的活跃伏笔提醒）
 */
export interface ForeshadowingBrief {
  id: string;
  description: string;
  status: string;
  importance: string;
}

/**
 * 场景上下文（AI 续写的核心数据）
 * AI 价值：理解"第几幕/谁的视角/什么氛围"，生成符合上下文的内容
 *
 * AI-2 扩展字段:
 *   - currentSceneText: 当前场景正文文本（层1），让 AI 知道"已写了什么"，自然衔接续写
 *   - globalUnresolvedForeshadowings: 全局未回收伏笔（层3b），供 AI 全局视角参考
 */
export interface SceneContext {
  sceneId: string;
  sceneTitle: string;
  /** AI-Ready: 视角角色 ID（强类型化，关联设定库 UUID） */
  povCharacterId: string | null;
  povCharacterName: string | null;
  /** AI-Ready: 氛围（强类型化，直接影响 AI 生成文本的语气与节奏） */
  mood: string | null;
  chapter: string | null;
  precedingSummary: string;
  presentCharacters: CharacterBrief[];
  relatedSettings: SettingBrief[];
  activeForeshadowings: ForeshadowingBrief[];
  /** AI-2 层1: 当前场景正文文本（从 .pmd ProseMirror JSON 提取的纯文本） */
  currentSceneText: string;
  /** AI-2 层3b: 全局未回收伏笔（跨章节/跨场景的活跃伏笔） */
  globalUnresolvedForeshadowings: ForeshadowingBrief[];
}

/**
 * 角色出场记录（从 Tantivy 索引检索）
 */
export interface AppearanceRecord {
  filePath: string;
  fileName: string;
  excerpt: string;
  /** AI-Ready: 场景 ID，用于 AI 按场景分析角色出场脉络 */
  sceneId: string | null;
}

/**
 * 角色关系简要
 */
export interface RelationshipBrief {
  targetId: string;
  targetName: string;
  relationType: string;
  description: string;
}

/**
 * 角色上下文（AI 角色一致性校验的核心数据）
 * AI 价值：避免"角色幻觉"（把 A 的性格安在 B 身上）
 */
export interface CharacterContext {
  characterId: string;
  name: string;
  aliases: string[];
  fullProfile: string;
  appearanceRecords: AppearanceRecord[];
  relationships: RelationshipBrief[];
}

/**
 * 章节摘要（项目上下文中的已完成章节信息）
 */
export interface ChapterSummary {
  chapterName: string;
  filePath: string;
  summary: string;
  wordCount: number;
}

/**
 * 项目全局上下文（AI 大纲生成、剧情推演的核心数据）
 * AI 价值：提供全局视角，避免生成与已有剧情矛盾的内容
 */
export interface ProjectContext {
  projectName: string;
  projectType: string;
  description: string;
  mainCharacters: CharacterBrief[];
  keySettings: SettingBrief[];
  chapterSummaries: ChapterSummary[];
  activeForeshadowings: ForeshadowingBrief[];
  totalWords: number;
  chapterCount: number;
}

// ===== Prompt 构建结果 =====

/**
 * 完整 Prompt 结构（System + User）
 * 设计说明：分离 System 与 User 便于未来支持多轮对话历史管理
 */
export interface BuiltPrompt {
  /** System Prompt：定义 AI 角色、约束、风格（来自用户偏好） */
  system: string;
  /** User Prompt：具体任务指令 + 上下文数据 */
  user: string;
  /** 元数据：用于日志追踪与调试 */
  metadata: {
    taskType: AiTaskType;
    contextSnapshot: {
      hasSceneContext: boolean;
      hasCharacterContext: boolean;
      hasProjectContext: boolean;
      presentCharacterCount: number;
      activeForeshadowingCount: number;
    };
  };
}

/**
 * AI 任务类型枚举
 */
export type AiTaskType =
  | "continuation" // 续写
  | "dialogue" // 对话生成
  | "consistencyCheck" // 角色一致性校验
  | "plotReview" // 剧情推演/审查
  | "outlineGeneration"; // 大纲生成

// ===== PromptBuilder 核心 =====

/**
 * AI 提示词构建器
 *
 * 使用方式：
 * ```ts
 * const builder = new PromptBuilder(editorPrefs);
 * const prompt = builder.buildContinuationPrompt(sceneCtx);
 * // 阶段 6: await llmClient.send(prompt.system, prompt.user);
 * ```
 *
 * 设计原则：
 *   - 用户偏好作为 System Prompt 的硬约束（如"必须使用智能引号"）
 *   - 上下文数据作为 User Prompt 的结构化输入
 *   - 任务指令明确化，避免 LLM 自由发挥超出范围
 *   - 所有 Prompt 使用中文（与项目主语言一致），LLM 输出也限定中文
 */
export class PromptBuilder {
  constructor(private prefs: EditorPreferences) {}

  /**
   * 构建 System Prompt（用户偏好注入）
   * 输出: string System Prompt 文本
   * 流程:
   *   1. 定义 AI 角色定位（小说创作助手）
   *   2. 注入用户偏好的硬约束（开关映射为约束条款）
   *   3. 注入文体风格约束（基于项目类型）
   */
  private buildSystemPrompt(): string {
    const constraints: string[] = [
      "你是一个专业的中文小说创作助手，帮助作者进行续写、对话生成、一致性校验与剧情推演。",
      "所有输出必须使用中文，保持文学性与可读性。",
      "严格遵守作者设定的世界观与角色设定，不得创造与已有设定矛盾的内容。",
      "保持与前文一致的叙事风格、人称视角与语气节奏。",
    ];

    // 用户偏好开关映射为约束条款
    if (this.prefs.enableSmartQuotes) {
      // 使用模板字面量避免中文智能引号与字符串边界引号冲突
      constraints.push(`对话与引用必须使用中文智能引号（\u201C\u201D\u2018\u2019），不得使用直引号。`);
    }
    if (this.prefs.enableAutoIndent) {
      constraints.push("段落首行需保留全角缩进（两个全角空格），符合中文排版规范。");
    }
    if (this.prefs.enablePoetryFormat) {
      constraints.push("涉及诗歌或歌词内容时，使用斜体与加大字间距的排版风格。");
    }
    if (this.prefs.enableForeshadowMark) {
      constraints.push(
        "注意前文埋设的伏笔，续写时考虑伏笔回收时机，不得遗忘或矛盾已有伏笔。"
      );
    }
    if (this.prefs.enableEntityHighlight) {
      constraints.push(
        "角色名、地点名、术语等实体名必须与设定库完全一致，不得使用变体或错别字。"
      );
    }
    if (this.prefs.enableCharacterMentionPicker) {
      constraints.push("新引入的角色若已存在于设定库，必须使用其标准名称。");
    }
    if (this.prefs.enableSceneBreakHelper) {
      constraints.push("场景转换时使用规范的场景分隔符（如 *** 或 ###）。");
    }

    return constraints.join("\n");
  }

  /**
   * 构建续写 Prompt（AI-2 升级：4 层上下文注入）
   * 输入: sceneCtx 场景上下文（含 4 层数据：场景正文/出场角色/伏笔/前文摘要）
   * 输出: BuiltPrompt 完整提示词
   * 流程:
   *   1. System Prompt 定义角色与约束
   *   2. User Prompt 注入 4 层上下文:
   *      层1: 当前场景元数据 + 场景正文文本（让 AI 自然衔接）
   *      层2: 出场角色设定（避免角色幻觉）
   *      层3: 场景内伏笔 + 全局未回收伏笔（提醒 AI 回收时机）
   *      层4: 前文摘要（保持剧情连贯）
   *   3. 明确续写任务指令（字数、风格、避免重复）
   *
   * Token 控制:
   *   - currentSceneText 超 2000 字时截取最后 2000 字（保留近文上下文）
   *   - precedingSummary 超 1000 字时截取最后 1000 字
   *   - presentCharacters 最多取 5 个（避免 Token 爆炸）
   *   - globalUnresolvedForeshadowings 最多取 5 个
   */
  buildContinuationPrompt(sceneCtx: SceneContext): BuiltPrompt {
    const system = this.buildSystemPrompt();

    const lines: string[] = [
      `场景：${sceneCtx.sceneTitle}`,
      sceneCtx.chapter ? `章节：${sceneCtx.chapter}` : "",
      sceneCtx.povCharacterName ? `视角：${sceneCtx.povCharacterName}（${sceneCtx.povCharacterId ?? ""}）` : "",
      sceneCtx.mood ? `氛围：${sceneCtx.mood}` : "",
      "",
    ].filter(Boolean);

    // 层4: 前文摘要（截取最后 1000 字，保留近期剧情）
    if (sceneCtx.precedingSummary) {
      lines.push("前文摘要：");
      const prevText = sceneCtx.precedingSummary.length > 1000
        ? sceneCtx.precedingSummary.slice(-1000) + "..."
        : sceneCtx.precedingSummary;
      lines.push(prevText);
      lines.push("");
    }

    // 层2: 出场角色设定（最多 5 个，避免 Token 爆炸）
    if (sceneCtx.presentCharacters.length > 0) {
      lines.push("当前出场角色：");
      const charsToInclude = sceneCtx.presentCharacters.slice(0, 5);
      for (const c of charsToInclude) {
        lines.push(`- ${c.name}（${c.id}）：${c.summary}`);
      }
      lines.push("");
    }

    // 相关设定（地点/物品/组织）
    if (sceneCtx.relatedSettings.length > 0) {
      lines.push("相关设定：");
      for (const s of sceneCtx.relatedSettings) {
        lines.push(`- ${s.name}（${s.category}）：${s.summary}`);
      }
      lines.push("");
    }

    // 层3a: 场景内伏笔（当前场景已埋设的伏笔）
    if (sceneCtx.activeForeshadowings.length > 0) {
      lines.push("场景内活跃伏笔（需考虑回收时机）：");
      for (const f of sceneCtx.activeForeshadowings) {
        lines.push(`- [${f.importance}] ${f.description}（状态：${f.status}）`);
      }
      lines.push("");
    }

    // 层3b: 全局未回收伏笔（最多 5 个，提醒 AI 全局伏笔状态）
    if (sceneCtx.globalUnresolvedForeshadowings.length > 0) {
      lines.push("全局未回收伏笔（供全局参考，非必须在此场景回收）：");
      const globalToInclude = sceneCtx.globalUnresolvedForeshadowings.slice(0, 5);
      for (const f of globalToInclude) {
        lines.push(`- [${f.importance}] ${f.description}（状态：${f.status}）`);
      }
      lines.push("");
    }

    // 层1: 当前场景正文文本（截取最后 2000 字，让 AI 自然衔接）
    if (sceneCtx.currentSceneText) {
      lines.push("当前场景正文（请基于此自然衔接续写）：");
      lines.push("```");
      const sceneText = sceneCtx.currentSceneText.length > 2000
        ? "..." + sceneCtx.currentSceneText.slice(-2000)
        : sceneCtx.currentSceneText;
      lines.push(sceneText);
      lines.push("```");
      lines.push("");
    }

    lines.push("任务：请基于上述场景上下文续写正文，保持风格一致，约 500-800 字。");
    lines.push("要求：不得重复前文内容，推进剧情发展，可适时埋设或回收伏笔。");

    return {
      system,
      user: lines.join("\n"),
      metadata: {
        taskType: "continuation",
        contextSnapshot: {
          hasSceneContext: true,
          hasCharacterContext: false,
          hasProjectContext: false,
          presentCharacterCount: sceneCtx.presentCharacters.length,
          activeForeshadowingCount:
            sceneCtx.activeForeshadowings.length +
            sceneCtx.globalUnresolvedForeshadowings.length,
        },
      },
    };
  }

  /**
   * 构建对话生成 Prompt
   * 输入:
   *   characterCtx - 角色上下文（含完整设定与出场记录）
   *   sceneCtx - 场景上下文（含氛围与在场角色）
   * 输出: BuiltPrompt 完整提示词
   * 流程:
   *   1. System Prompt 定义角色与约束
   *   2. User Prompt 注入角色设定、关系、场景氛围
   *   3. 明确对话生成任务（保持角色声线、符合关系动态）
   */
  buildDialoguePrompt(
    characterCtx: CharacterContext,
    sceneCtx: SceneContext
  ): BuiltPrompt {
    const system = this.buildSystemPrompt();

    const lines: string[] = [
      `为角色「${characterCtx.name}」生成对话。`,
      "",
      "角色设定：",
      characterCtx.fullProfile || "（无详细设定）",
      "",
    ];

    if (characterCtx.aliases.length > 0) {
      lines.push(`别名：${characterCtx.aliases.join("、")}`);
      lines.push("");
    }

    if (characterCtx.relationships.length > 0) {
      lines.push("角色关系：");
      for (const r of characterCtx.relationships) {
        lines.push(`- 与「${r.targetName}」：${r.relationType}（${r.description}）`);
      }
      lines.push("");
    }

    if (characterCtx.appearanceRecords.length > 0) {
      lines.push("历史出场片段（最近 3 条）：");
      const recent = characterCtx.appearanceRecords.slice(0, 3);
      for (const a of recent) {
        lines.push(`- 《${a.fileName}》：${a.excerpt}`);
      }
      lines.push("");
    }

    lines.push(`当前场景：${sceneCtx.sceneTitle}`);
    if (sceneCtx.mood) lines.push(`氛围：${sceneCtx.mood}`);
    if (sceneCtx.presentCharacters.length > 1) {
      const others = sceneCtx.presentCharacters
        .filter((c) => c.id !== characterCtx.characterId)
        .map((c) => c.name);
      lines.push(`在场其他角色：${others.join("、")}`);
    }
    lines.push("");
    lines.push("任务：请生成 3-5 句该角色在此场景中的对话，保持角色声线与性格一致。");
    lines.push("要求：对话需符合角色关系动态，推进剧情或揭示角色内心。");

    return {
      system,
      user: lines.join("\n"),
      metadata: {
        taskType: "dialogue",
        contextSnapshot: {
          hasSceneContext: true,
          hasCharacterContext: true,
          hasProjectContext: false,
          presentCharacterCount: sceneCtx.presentCharacters.length,
          activeForeshadowingCount: 0,
        },
      },
    };
  }

  /**
   * 构建角色一致性校验 Prompt
   * 输入:
   *   characterCtx - 角色上下文
   *   textToCheck - 待校验的文本片段
   * 输出: BuiltPrompt 完整提示词
   * 流程:
   *   1. System Prompt 定义校验任务约束
   *   2. User Prompt 注入角色设定与待校验文本
   *   3. 明确校验任务（找出与设定矛盾之处）
   */
  buildConsistencyCheckPrompt(
    characterCtx: CharacterContext,
    textToCheck: string
  ): BuiltPrompt {
    const system = this.buildSystemPrompt();

    const lines: string[] = [
      `校验文本中「${characterCtx.name}」的角色一致性。`,
      "",
      "角色设定：",
      characterCtx.fullProfile || "（无详细设定）",
      "",
      "角色关系：",
    ];

    if (characterCtx.relationships.length > 0) {
      for (const r of characterCtx.relationships) {
        lines.push(`- 与「${r.targetName}」：${r.relationType}`);
      }
    } else {
      lines.push("（无关系记录）");
    }
    lines.push("");

    lines.push("待校验文本：");
    lines.push("```");
    lines.push(textToCheck);
    lines.push("```");
    lines.push("");
    lines.push("任务：检查上述文本中该角色的言行是否符合设定，找出矛盾之处。");
    lines.push("输出格式：");
    lines.push("- 若无矛盾，回复「一致性通过」");
    lines.push("- 若有矛盾，逐条列出：[矛盾点] 设定依据 -> 文本中的偏差");

    return {
      system,
      user: lines.join("\n"),
      metadata: {
        taskType: "consistencyCheck",
        contextSnapshot: {
          hasSceneContext: false,
          hasCharacterContext: true,
          hasProjectContext: false,
          presentCharacterCount: 0,
          activeForeshadowingCount: 0,
        },
      },
    };
  }

  /**
   * 构建剧情推演/审查 Prompt
   * 输入: projectCtx 项目全局上下文
   * 输出: BuiltPrompt 完整提示词
   * 流程:
   *   1. System Prompt 定义推演任务约束
   *   2. User Prompt 注入项目全局信息（角色/设定/章节摘要/伏笔）
   *   3. 明确推演任务（识别剧情漏洞、建议后续走向）
   */
  buildPlotReviewPrompt(projectCtx: ProjectContext): BuiltPrompt {
    const system = this.buildSystemPrompt();

    const lines: string[] = [
      `审查项目「${projectCtx.projectName}」的剧情结构。`,
      "",
      `项目类型：${projectCtx.projectType}`,
      `总字数：${projectCtx.totalWords}`,
      `章节数：${projectCtx.chapterCount}`,
      "",
      "项目描述：",
      projectCtx.description || "（无描述）",
      "",
    ];

    if (projectCtx.mainCharacters.length > 0) {
      lines.push("主要角色：");
      for (const c of projectCtx.mainCharacters) {
        lines.push(`- ${c.name}：${c.summary}`);
      }
      lines.push("");
    }

    if (projectCtx.keySettings.length > 0) {
      lines.push("关键设定：");
      for (const s of projectCtx.keySettings) {
        lines.push(`- ${s.name}（${s.category}）：${s.summary}`);
      }
      lines.push("");
    }

    if (projectCtx.chapterSummaries.length > 0) {
      lines.push("已完成章节摘要：");
      for (const ch of projectCtx.chapterSummaries) {
        lines.push(`- 《${ch.chapterName}》（${ch.wordCount}字）：${ch.summary}`);
      }
      lines.push("");
    }

    if (projectCtx.activeForeshadowings.length > 0) {
      lines.push("活跃伏笔（检查是否长期未回收）：");
      for (const f of projectCtx.activeForeshadowings) {
        lines.push(`- [${f.importance}] ${f.description}（状态：${f.status}）`);
      }
      lines.push("");
    }

    lines.push("任务：审查剧情结构，识别以下问题：");
    lines.push("1. 长期未回收的伏笔（可能被遗忘）");
    lines.push("2. 角色出场断层（重要角色长期缺席）");
    lines.push("3. 剧情逻辑漏洞（前后矛盾）");
    lines.push("4. 节奏问题（拖沓或仓促）");
    lines.push("输出格式：按问题类型分组，每条附建议解决方案。");

    return {
      system,
      user: lines.join("\n"),
      metadata: {
        taskType: "plotReview",
        contextSnapshot: {
          hasSceneContext: false,
          hasCharacterContext: false,
          hasProjectContext: true,
          presentCharacterCount: projectCtx.mainCharacters.length,
          activeForeshadowingCount: projectCtx.activeForeshadowings.length,
        },
      },
    };
  }

  /**
   * 构建大纲生成 Prompt
   * 输入: projectCtx 项目全局上下文
   * 输出: BuiltPrompt 完整提示词
   * 流程:
   *   1. System Prompt 定义大纲生成约束
   *   2. User Prompt 注入项目信息与已完成的章节
   *   3. 明确大纲生成任务（后续 5-10 章走向）
   */
  buildOutlineGenerationPrompt(projectCtx: ProjectContext): BuiltPrompt {
    const system = this.buildSystemPrompt();

    const lines: string[] = [
      `为项目「${projectCtx.projectName}」生成后续大纲。`,
      "",
      `项目类型：${projectCtx.projectType}`,
      `已完成章节：${projectCtx.chapterCount}`,
      `总字数：${projectCtx.totalWords}`,
      "",
    ];

    if (projectCtx.chapterSummaries.length > 0) {
      lines.push("已完成章节摘要（用于推断后续走向）：");
      const recent = projectCtx.chapterSummaries.slice(-5);
      for (const ch of recent) {
        lines.push(`- 《${ch.chapterName}》：${ch.summary}`);
      }
      lines.push("");
    }

    if (projectCtx.activeForeshadowings.length > 0) {
      lines.push("待回收伏笔（后续大纲需安排回收）：");
      for (const f of projectCtx.activeForeshadowings) {
        lines.push(`- [${f.importance}] ${f.description}`);
      }
      lines.push("");
    }

    if (projectCtx.mainCharacters.length > 0) {
      lines.push("主要角色（确保后续大纲覆盖所有重要角色）：");
      for (const c of projectCtx.mainCharacters) {
        lines.push(`- ${c.name}：${c.summary}`);
      }
      lines.push("");
    }

    lines.push("任务：生成后续 5-10 章的大纲，每章包含：");
    lines.push("- 章节标题");
    lines.push("- 主要事件（1-2 句）");
    lines.push("- 出场角色");
    lines.push("- 伏笔回收/埋设计划（如有）");
    lines.push("要求：剧情推进合理，符合已有设定，逐步回收活跃伏笔。");

    return {
      system,
      user: lines.join("\n"),
      metadata: {
        taskType: "outlineGeneration",
        contextSnapshot: {
          hasSceneContext: false,
          hasCharacterContext: false,
          hasProjectContext: true,
          presentCharacterCount: projectCtx.mainCharacters.length,
          activeForeshadowingCount: projectCtx.activeForeshadowings.length,
        },
      },
    };
  }
}
