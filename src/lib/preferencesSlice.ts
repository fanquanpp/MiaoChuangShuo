// 编辑器偏好配置状态管理
//
// 功能概述：
// 使用 Zustand 管理用户级编辑器偏好（功能开关集合），通过 Tauri 命令
// 读写 AppData/preferences.json，同时在 localStorage 维护一份缓存
// 供前端即时读取，避免每次访问都触发后端调用。
//
// 模块职责：
// 1. 定义 EditorPreferences 接口（与 Rust 端结构对应）
// 2. 提供 loadPreferences / savePreferences 方法
// 3. 提供 updatePreference 单字段更新方法
// 4. localStorage 缓存保证页面刷新后设置不丢失
// 5. 与 settingsStore 互补：settingsStore 管理应用设置（字号/自动保存），
//    本 store 专注功能开关（Tab 补全/智能引号等）
//
// 设计说明：
// 配置存储拆分——项目级配置存 .novelforge/config.json（阶段 2 启用），
// 用户级偏好存 AppData/preferences.json（本 store 管理）。
// 前端优先读 localStorage 缓存（即时），后端 Tauri 命令用于持久化。

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

// 用户级编辑器偏好接口（与 Rust EditorPreferences 结构对应）
export interface EditorPreferences {
  /** Tab 键角色名补全（默认关闭） */
  enableCharacterMentionPicker: boolean;
  /** 首行自动缩进（默认开启） */
  enableAutoIndent: boolean;
  /** 智能引号配对（默认开启） */
  enableSmartQuotes: boolean;
  /** 诗歌排版模式（默认关闭） */
  enablePoetryFormat: boolean;
  /** 场景分隔辅助（默认关闭） */
  enableSceneBreakHelper: boolean;
  /** 实体名自动高亮（默认开启） */
  enableEntityHighlight: boolean;
}

// 项目级配置接口（与 Rust ProjectConfig 结构对应）
export interface ProjectConfig {
  /** 模板类型："novel" / "script" / "essay" */
  templateType: string;
  /** 创建时间（ISO 8601） */
  createdAt: string;
}

// localStorage 缓存键
const PREFS_CACHE_KEY = "novelforge-editor-preferences";

// 默认偏好（与 Rust 端 Default 实现一致）
const DEFAULT_PREFERENCES: EditorPreferences = {
  enableCharacterMentionPicker: false,
  enableAutoIndent: true,
  enableSmartQuotes: true,
  enablePoetryFormat: false,
  enableSceneBreakHelper: false,
  enableEntityHighlight: true,
};

/**
 * 从 localStorage 加载缓存的偏好
 * 输入: 无
 * 输出: EditorPreferences 缓存的偏好（加载失败返回默认值）
 * 流程: 读取并解析 localStorage，合并默认值保证字段完整
 */
function loadCachedPreferences(): EditorPreferences {
  if (typeof localStorage === "undefined") return DEFAULT_PREFERENCES;
  try {
    const cached = localStorage.getItem(PREFS_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      return { ...DEFAULT_PREFERENCES, ...parsed };
    }
  } catch {
    // 解析失败返回默认值
  }
  return DEFAULT_PREFERENCES;
}

/**
 * 缓存偏好到 localStorage
 * 输入: prefs 偏好数据
 * 输出: 无（副作用：写入 localStorage）
 */
function cachePreferences(prefs: EditorPreferences): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(prefs));
  } catch {
    // 写入失败静默处理
  }
}

// 偏好状态接口
interface PreferencesState {
  /** 当前编辑器偏好 */
  preferences: EditorPreferences;
  /** 是否已从后端加载 */
  loaded: boolean;

  /** 从后端加载偏好并更新缓存 */
  loadPreferences: () => Promise<void>;
  /** 保存偏好到后端并更新缓存 */
  savePreferences: (prefs: EditorPreferences) => Promise<void>;
  /** 更新单个偏好字段并持久化 */
  updatePreference: <K extends keyof EditorPreferences>(
    key: K,
    value: EditorPreferences[K]
  ) => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  // 初始值从 localStorage 缓存加载（即时可用），后端加载后覆盖
  preferences: loadCachedPreferences(),
  loaded: false,

  loadPreferences: async () => {
    try {
      const prefs = await invoke<EditorPreferences>("get_user_preferences");
      cachePreferences(prefs);
      set({ preferences: prefs, loaded: true });
    } catch {
      // 后端调用失败时保持缓存值，标记为已加载
      set({ loaded: true });
    }
  },

  savePreferences: async (prefs: EditorPreferences) => {
    // 先更新缓存与状态（即时反馈）
    cachePreferences(prefs);
    set({ preferences: prefs });
    try {
      await invoke("set_user_preferences", { preferences: prefs });
    } catch {
      // 后端保存失败时静默处理，缓存已更新保证前端一致
    }
  },

  updatePreference: async (key, value) => {
    const current = get().preferences;
    const next = { ...current, [key]: value };
    await get().savePreferences(next);
  },
}));

// ===== 项目级配置 API（非 store，按需调用） =====

/**
 * 读取项目级配置
 * 输入: projectRoot 项目根目录
 * 输出: Promise<ProjectConfig> 配置数据
 * 流程: 调用 get_project_config Tauri 命令
 */
export async function getProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  return invoke<ProjectConfig>("get_project_config", { projectRoot });
}

/**
 * 保存项目级配置
 * 输入: projectRoot 项目根目录, config 配置数据
 * 输出: Promise<void>
 * 流程: 调用 set_project_config Tauri 命令
 */
export async function setProjectConfig(projectRoot: string, config: ProjectConfig): Promise<void> {
  await invoke("set_project_config", { projectRoot, config });
}

/**
 * 根据模板类型生成默认偏好
 * 输入: templateType 模板类型 ("novel" / "script" / "essay")
 * 输出: EditorPreferences 该模板对应的默认偏好
 * 流程: 以默认值为基线，按模板类型调整开关
 */
export function getDefaultsForTemplate(templateType: string): EditorPreferences {
  const prefs = { ...DEFAULT_PREFERENCES };
  if (templateType === "script") {
    prefs.enableAutoIndent = false;
    prefs.enableCharacterMentionPicker = true;
  }
  // novel 与 essay 使用默认值（开缩进、关 Tab 补全）
  return prefs;
}
