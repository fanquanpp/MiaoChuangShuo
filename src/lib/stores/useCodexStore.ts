// 智能设定库（Codex）全局状态管理
//
// 功能概述：
// 使用 Zustand 管理设定库卡片的全局状态，作为前端唯一数据源（SSOT）。
// 项目打开时一次性加载所有 Codex 卡片到内存，提供 O(1) 查找与派生查询。
// 供 CodexPanel / NovelEditor / CharacterHoverCard / AI 上下文等模块共享。
//
// 模块职责：
// 1. 维护 cards Map（id -> CodexCard），O(1) 查找
// 2. 提供派生查询：按类型筛选 / 按名称查找 / 关键词搜索
// 3. 提供 CRUD 操作：loadAll / addCard / updateCard / deleteCard
// 4. 维护 loaded 状态标记，避免重复加载
//
// 设计说明：
// - 命名遵循 useAppStore 模式（use + Store 后缀）
// - updateCard 修改 name 时，Sprint 2 将触发 updateCharacterMentionName 命令联动正文
// - deleteCard 触发失效检测（Sprint 2 实现），当前仅清理内存
// - Map 结构便于 O(1) 查找，避免数组遍历

import { create } from "zustand";
import {
  listCodexEntities,
  toCodexCard,
  updateCodexEntity,
  type CodexCard,
  type CodexEntityType,
  type CodexMetaPatch,
} from "../codexApi";

/**
 * 改名联动队列条目
 * 当卡片 name 变更时推入此队列，NovelEditor 订阅后调用 updateCharacterMentionName 同步正文
 */
export interface RenameEntry {
  /** 卡片 UUID（characterMentionNode 的 characterId） */
  cardId: string;
  /** 新名称（同步到 characterMentionNode 的 name 属性） */
  newName: string;
  /** 推入时间戳（用于去重与过期清理） */
  timestamp: number;
}

/**
 * Codex Store 状态接口
 * 包含数据字段、派生查询方法与 CRUD 操作方法
 */
interface CodexState {
  // === 数据字段 ===
  /** 卡片映射表（id -> CodexCard），O(1) 查找 */
  cards: Map<string, CodexCard>;
  /** 是否已加载（项目打开后首次加载完成置 true，项目切换时重置） */
  loaded: boolean;
  /** 加载错误信息（加载失败时填充，用于 UI 提示） */
  error: string | null;
  /**
   * 改名联动队列（Sprint 2 任务 2.4）
   * 当卡片 name 变更时推入此队列，NovelEditor 订阅后批量调用 updateCharacterMentionName
   * 处理完成后通过 consumeRenameQueue 清空
   */
  renameQueue: RenameEntry[];
  /**
   * 待选中卡片 ID（Sprint 3 任务 3.3 跨组件跳转）
   * NovelEditor 双击 characterMentionNode 时设置，CodexPanel 订阅后选中对应卡片并清空
   * 设计说明: 一次性信号量，CodexPanel 消费后立即清空避免重复触发
   */
  pendingSelectCardId: string | null;
  /**
   * 待进入编辑模式标记（Sprint 3 任务 3.5 右键菜单触发）
   * 与 pendingSelectCardId 配合：选中卡片后若此标记为 true，则自动进入编辑模式
   * 设计说明: 一次性信号量，CodexPanel 消费后立即清空
   */
  pendingEditMode: boolean;

  // === 派生查询方法 ===
  /**
   * 按类型获取卡片列表
   * 输入: type 实体类型（character/worldview/glossary/material）
   * 输出: CodexCard[] 该类型下所有卡片（按 sortOrder 升序，同序按名称排序）
   */
  getByType: (type: CodexEntityType) => CodexCard[];

  /**
   * 按名称查找卡片（精确匹配，区分大小写）
   * 输入: name 卡片名称
   * 输出: CodexCard | undefined 找到的卡片，未找到返回 undefined
   * 设计说明: 优先匹配主名称，未命中再遍历别名
   */
  getByName: (name: string) => CodexCard | undefined;

  /**
   * 按 ID 查找卡片
   * 输入: id 卡片 UUID
   * 输出: CodexCard | undefined 找到的卡片
   */
  getById: (id: string) => CodexCard | undefined;

  /**
   * 关键词搜索卡片（模糊匹配名称与别名）
   * 输入: query 搜索关键词（不区分大小写）
   * 输出: CodexCard[] 匹配的卡片列表（按类型分组后按名称排序）
   */
  search: (query: string) => CodexCard[];

  // === CRUD 操作方法 ===
  /**
   * 加载项目下所有 Codex 卡片
   * 输入: projectPath 项目根路径
   * 输出: Promise<void>
   * 流程:
   *   1. 调用 listCodexEntities 获取后端结构化实体列表
   *   2. 通过 toCodexCard 转换为前端扁平结构
   *   3. 构建 Map 并更新 state
   *   4. 标记 loaded = true
   * 容错: 加载失败时设置 error 字段，loaded 仍标记为 true 避免重复尝试
   */
  loadAll: (projectPath: string) => Promise<void>;

  /**
   * 添加新卡片到 Store
   * 输入: card 待添加的卡片对象
   * 流程: 在 Map 中新增条目（若 ID 已存在则覆盖）
   */
  addCard: (card: CodexCard) => void;

  /**
   * 更新卡片内存状态（仅内存，不持久化）
   * 输入:
   *   id 待更新卡片 ID
   *   patch 待更新的字段（部分 CodexCard 字段）
   * 流程:
   *   1. 查找原卡片，不存在则忽略
   *   2. 合并 patch 字段，更新 updatedAt 时间戳
   *   3. 写回 Map
   *   4. 若 name 变更，推入 renameQueue 触发正文联动
   * 注: 此方法不调用后端，用于本地状态同步。持久化请使用 persistCardUpdate
   */
  updateCard: (id: string, patch: Partial<Omit<CodexCard, "id">>) => void;

  /**
   * 持久化更新卡片（调用后端 + 更新内存 + 触发联动）
   * 输入:
   *   id 待更新卡片 ID
   *   patch 待更新的元数据补丁
   *   projectPath 项目根路径
   *   content 正文内容（ProseMirror JSON 字符串，空字符串表示不更新正文）
   * 输出: Promise<void>
   * 流程:
   *   1. 调用后端 update_codex_entity 持久化到 .pmd 文件
   *   2. 根据后端返回的 meta 更新内存中的 CodexCard
   *   3. 若 name 变更，推入 renameQueue 触发正文联动
   *   4. 若 name 变更，同步更新 sourceFile（后端已重命名文件）
   * 容错: 后端调用失败时抛出异常，调用方处理
   */
  persistCardUpdate: (
    id: string,
    patch: CodexMetaPatch,
    projectPath: string,
    content?: string
  ) => Promise<void>;

  /**
   * 消费改名队列（NovelEditor 处理完成后调用）
   * 流程: 清空 renameQueue
   */
  consumeRenameQueue: () => void;

  /**
   * 设置待选中卡片 ID（Sprint 3 任务 3.3）
   * 输入: id 卡片 UUID（null 表示清除）
   * 流程: 写入 pendingSelectCardId，CodexPanel 订阅后消费
   */
  setPendingSelectCardId: (id: string | null) => void;

  /**
   * 设置待进入编辑模式标记（Sprint 3 任务 3.5）
   * 输入: mode 是否进入编辑模式
   * 流程: 写入 pendingEditMode，CodexPanel 消费后清空
   */
  setPendingEditMode: (mode: boolean) => void;

  /**
   * 删除卡片
   * 输入: id 待删除卡片 ID
   * 流程: 从 Map 中移除条目
   * 注: 失效检测（标记正文中相关 Mention 为失效）在 Sprint 2 实现
   */
  deleteCard: (id: string) => void;

  /**
   * 重置 Store（项目切换时调用）
   * 流程: 清空 cards Map，重置 loaded 与 error 状态
   */
  reset: () => void;
}

/**
 * 卡片默认排序比较函数
 * 输入: a / b 两张卡片
 * 输出: number 排序结果
 * 流程:
 *   1. 先按 sortOrder 升序（数字越小越靠前）
 *   2. 同序时按名称 localeCompare 排序（中文优先）
 */
function compareCards(a: CodexCard, b: CodexCard): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name, "zh-CN");
}

/**
 * 创建 Codex 全局 Store
 * 使用 Zustand create 模式，与 useAppStore 命名保持一致
 */
export const useCodexStore = create<CodexState>()((set, get) => ({
  // === 初始数据 ===
  cards: new Map<string, CodexCard>(),
  loaded: false,
  error: null,
  renameQueue: [],
  pendingSelectCardId: null,
  pendingEditMode: false,

  // === 派生查询 ===
  getByType: (type) => {
    const cards = get().cards;
    const result: CodexCard[] = [];
    for (const card of cards.values()) {
      if (card.cardType === type) result.push(card);
    }
    result.sort(compareCards);
    return result;
  },

  getByName: (name) => {
    const cards = get().cards;
    // 优先匹配主名称
    for (const card of cards.values()) {
      if (card.name === name) return card;
    }
    // 主名称未命中，再遍历别名
    for (const card of cards.values()) {
      if (card.aliases.includes(name)) return card;
    }
    return undefined;
  },

  getById: (id) => {
    return get().cards.get(id);
  },

  search: (query) => {
    const cards = get().cards;
    const q = query.trim().toLowerCase();
    if (!q) {
      // 空查询返回全部卡片（按类型 + 名称排序）
      const all: CodexCard[] = Array.from(cards.values());
      all.sort(compareCards);
      return all;
    }
    const result: CodexCard[] = [];
    for (const card of cards.values()) {
      // 匹配主名称（不区分大小写）
      if (card.name.toLowerCase().includes(q)) {
        result.push(card);
        continue;
      }
      // 匹配别名
      if (card.aliases.some((a) => a.toLowerCase().includes(q))) {
        result.push(card);
        continue;
      }
      // 匹配标签
      if (card.tags.some((tag) => tag.toLowerCase().includes(q))) {
        result.push(card);
        continue;
      }
      // 匹配简介
      if (card.summary.toLowerCase().includes(q)) {
        result.push(card);
      }
    }
    result.sort(compareCards);
    return result;
  },

  // === CRUD 操作 ===
  loadAll: async (projectPath) => {
    try {
      const entities = await listCodexEntities(projectPath);
      const newCards = new Map<string, CodexCard>();
      for (const entity of entities) {
        const card = toCodexCard(entity);
        newCards.set(card.id, card);
      }
      set({ cards: newCards, loaded: true, error: null });
    } catch (e) {
      // 加载失败：标记 loaded 避免无限重试，记录错误供 UI 提示
      set({ cards: new Map(), loaded: true, error: String(e) });
    }
  },

  addCard: (card) => {
    set((state) => {
      const newCards = new Map(state.cards);
      newCards.set(card.id, card);
      return { cards: newCards };
    });
  },

  updateCard: (id, patch) => {
    set((state) => {
      const existing = state.cards.get(id);
      if (!existing) return state;
      const updated: CodexCard = {
        ...existing,
        ...patch,
        // 更新时间戳（ISO 8601）
        updatedAt: new Date().toISOString(),
      };
      const newCards = new Map(state.cards);
      newCards.set(id, updated);

      // 若 name 变更，推入 renameQueue 触发正文联动（Sprint 2 任务 2.4）
      let newRenameQueue = state.renameQueue;
      if (patch.name !== undefined && patch.name !== existing.name) {
        newRenameQueue = [
          ...state.renameQueue,
          {
            cardId: id,
            newName: patch.name,
            timestamp: Date.now(),
          },
        ];
      }

      return { cards: newCards, renameQueue: newRenameQueue };
    });
  },

  persistCardUpdate: async (id, patch, projectPath, content = "") => {
    const existing = get().cards.get(id);
    if (!existing) {
      throw new Error(`卡片不存在: ${id}`);
    }
    // 调用后端持久化
    const updatedMeta = await updateCodexEntity(
      projectPath,
      existing.sourceFile,
      patch,
      content
    );

    // 根据后端返回的 meta 更新内存中的 CodexCard
    // name 变更时同步更新 sourceFile（后端已重命名文件）
    const nameChanged = patch.name !== undefined && patch.name !== existing.name;
    const newSourceFile = nameChanged
      ? computeNewSourceFile(existing.sourceFile, updatedMeta.name)
      : existing.sourceFile;

    // 合并后端返回的 meta 到 CodexCard
    const updatedCard: CodexCard = {
      ...existing,
      name: updatedMeta.name,
      aliases: updatedMeta.aliases,
      cardType: (
        ["character", "worldview", "glossary", "material"].includes(updatedMeta.entity_type)
          ? updatedMeta.entity_type
          : "material"
      ) as CodexEntityType,
      summary: updatedMeta.summary ?? "",
      tags: updatedMeta.tags ?? [],
      avatar: updatedMeta.avatar ?? null,
      sortOrder: updatedMeta.sort_order ?? 0,
      updatedAt: updatedMeta.updated_at || updatedMeta.created,
      sourceFile: newSourceFile,
      // 若 content 非空，更新正文
      content: content || existing.content,
    };

    set((state) => {
      const newCards = new Map(state.cards);
      newCards.set(id, updatedCard);

      // 若 name 变更，推入 renameQueue 触发正文联动
      let newRenameQueue = state.renameQueue;
      if (nameChanged) {
        newRenameQueue = [
          ...state.renameQueue,
          {
            cardId: id,
            newName: updatedMeta.name,
            timestamp: Date.now(),
          },
        ];
      }

      return { cards: newCards, renameQueue: newRenameQueue };
    });
  },

  consumeRenameQueue: () => {
    set({ renameQueue: [] });
  },

  setPendingSelectCardId: (id) => {
    set({ pendingSelectCardId: id });
  },

  setPendingEditMode: (mode) => {
    set({ pendingEditMode: mode });
  },

  deleteCard: (id) => {
    set((state) => {
      if (!state.cards.has(id)) return state;
      const newCards = new Map(state.cards);
      newCards.delete(id);
      return { cards: newCards };
    });
  },

  reset: () => {
    set({ cards: new Map(), loaded: false, error: null, renameQueue: [], pendingSelectCardId: null, pendingEditMode: false });
  },
}));

/**
 * 根据原 sourceFile 和新 name 推算新的 sourceFile
 * 输入:
 *   originalSourceFile 原 sourceFile（如 "角色/亚瑟.pmd"）
 *   newName 新名称（如 "兰斯洛特"）
 * 输出: string 新 sourceFile（如 "角色/兰斯洛特.pmd"）
 * 流程:
 *   1. 提取目录前缀（最后一个 / 之前的部分）
 *   2. 拼接新 name + .pmd 扩展名
 * 设计说明: 与后端 update_codex_entity 的重命名逻辑一致
 */
function computeNewSourceFile(originalSourceFile: string, newName: string): string {
  const lastSlash = originalSourceFile.lastIndexOf("/");
  const dirPrefix = lastSlash >= 0 ? originalSourceFile.substring(0, lastSlash + 1) : "";
  return `${dirPrefix}${newName}.pmd`;
}
