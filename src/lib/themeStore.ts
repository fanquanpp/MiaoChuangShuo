// 主题状态管理
//
// 功能概述：
// 使用 Zustand 管理应用主题(亮色/暗色)，支持本地持久化。
// 通过在 document.documentElement 上切换 .light 类实现主题切换。
//
// 模块职责：
// 1. 管理当前主题状态
// 2. 提供主题切换方法
// 3. 持久化主题到 localStorage
// 4. 应用主题到 DOM 根元素
// 5. 主题切换时联动 settingsStore 重新应用背景预设，确保亮/暗主题与背景色协同
//    - 切换到亮色：自动切到亮色默认预设（晨光白），除非当前已是亮色预设
//    - 切换到暗色：自动切到暗色默认预设（深空黑），除非当前已是暗色预设

import { create } from "zustand";

// 主题类型枚举
export type ThemeMode = "dark" | "light";

// 主题状态接口
interface ThemeState {
  // 当前主题
  theme: ThemeMode;
  // 切换主题
  toggleTheme: () => void;
  // 设置主题
  setTheme: (theme: ThemeMode) => void;
  // 初始化主题(从 localStorage 读取并应用)
  initTheme: () => void;
}

// localStorage 键名
const THEME_STORAGE_KEY = "novelforge-theme";

// 应用主题到 DOM 根元素
// 输入: theme 主题模式
// 输出: 无
// 流程: 在 documentElement 上添加/移除 .light 类
function applyThemeToDom(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "light") {
    root.classList.add("light");
  } else {
    root.classList.remove("light");
  }
}

// 从 localStorage 读取主题
// 输入: 无
// 输出: 主题模式
// 流程: 读取本地存储，默认返回 dark
function loadThemeFromStorage(): ThemeMode {
  if (typeof localStorage === "undefined") return "dark";
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

// 保存主题到 localStorage
// 输入: theme 主题模式
// 输出: 无
// 流程: 写入本地存储
function saveThemeToStorage(theme: ThemeMode): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

// 主题切换后联动 settingsStore 重新应用背景预设
// 输入: nextTheme 即将切换到的主题模式
// 输出: 无
// 流程:
//   1. 动态导入 settingsStore，避免循环依赖
//   2. 读取当前预设，若其 mode 与目标主题不一致，则切到目标主题的默认预设
//      （例如从暗色 default 切到亮色时，自动切到 lightDay）
//   3. 若当前预设已是目标主题的预设，则仅重新应用以刷新内联变量
function syncBackgroundWithTheme(nextTheme: ThemeMode): void {
  import("./settingsStore").then(({ useSettingsStore, BACKGROUND_PRESETS, getDefaultPresetByMode }) => {
    const state = useSettingsStore.getState();
    const currentPreset = BACKGROUND_PRESETS.find((p) => p.id === state.backgroundPreset);
    // 当前预设与目标主题不匹配（或为 custom）时，切到目标主题的默认预设
    if (!currentPreset || currentPreset.mode !== nextTheme) {
      state.setBackgroundPreset(getDefaultPresetByMode(nextTheme));
    } else {
      // 已是匹配预设，仅重新应用以刷新内联变量
      state.setBackgroundPreset(state.backgroundPreset);
    }
  }).catch(() => {
    // 静默处理，主题切换本身已生效
  });
}

// 创建主题状态 store
// 输入: 无
// 输出: Zustand store 实例
// 流程: 定义主题状态与操作方法
export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: "dark",

  toggleTheme: () => {
    const current = get().theme;
    const next: ThemeMode = current === "dark" ? "light" : "dark";
    applyThemeToDom(next);
    saveThemeToStorage(next);
    set({ theme: next });
    // 主题切换后联动重新应用背景预设，确保亮色主题下不被深色内联样式覆盖
    syncBackgroundWithTheme(next);
  },

  setTheme: (theme) => {
    applyThemeToDom(theme);
    saveThemeToStorage(theme);
    set({ theme });
    syncBackgroundWithTheme(theme);
  },

  initTheme: () => {
    const stored = loadThemeFromStorage();
    applyThemeToDom(stored);
    set({ theme: stored });
    // 初始化时也同步一次，确保背景预设与主题一致
    syncBackgroundWithTheme(stored);
  },
}));
