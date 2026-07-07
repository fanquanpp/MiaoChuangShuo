// 主题状态管理 (Web 版)
//
// 功能概述:
// 使用 Zustand 管理 Web 版主题 (亮色/暗色), 支持 localStorage 持久化。
// 通过在 document.documentElement 上切换 .light 类实现主题切换。
// 与桌面版 themeStore 逻辑保持一致, 但独立实现, 不引用桌面版。
//
// 模块职责:
// 1. 管理当前主题状态
// 2. 提供主题切换方法
// 3. 持久化主题到 localStorage
// 4. 应用主题到 DOM 根元素

import { create } from "zustand";
import type { WebThemeMode } from "./types";

// 主题状态接口
interface WebThemeState {
  // 当前主题
  theme: WebThemeMode;
  // 切换主题 (dark <-> light)
  toggleTheme: () => void;
  // 设置主题
  setTheme: (theme: WebThemeMode) => void;
  // 初始化主题 (从 localStorage 读取并应用)
  initTheme: () => void;
}

// localStorage 键名 (与桌面版区分, 避免互相干扰)
const THEME_STORAGE_KEY = "miaochuangshuo-web-theme";

/**
 * 应用主题到 DOM 根元素
 * 输入: theme 主题模式
 * 输出: 无
 * 流程: 在 documentElement 上添加/移除 .light 类
 */
function applyThemeToDom(theme: WebThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "light") {
    root.classList.add("light");
  } else {
    root.classList.remove("light");
  }
  root.style.colorScheme = theme;
}

/**
 * 从 localStorage 读取主题
 * 输入: 无
 * 输出: 主题模式, 默认 dark
 */
function loadThemeFromStorage(): WebThemeMode {
  if (typeof localStorage === "undefined") return "dark";
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

/**
 * 保存主题到 localStorage
 * 输入: theme 主题模式
 * 输出: 无
 */
function saveThemeToStorage(theme: WebThemeMode): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

/**
 * 创建主题状态 store
 * 输入: 无
 * 输出: Zustand store 实例
 * 流程: 定义主题状态与操作方法
 */
export const useWebThemeStore = create<WebThemeState>((set, get) => ({
  theme: "dark",

  toggleTheme: () => {
    const current = get().theme;
    const next: WebThemeMode = current === "dark" ? "light" : "dark";
    applyThemeToDom(next);
    saveThemeToStorage(next);
    set({ theme: next });
  },

  setTheme: (theme) => {
    applyThemeToDom(theme);
    saveThemeToStorage(theme);
    set({ theme });
  },

  initTheme: () => {
    const stored = loadThemeFromStorage();
    applyThemeToDom(stored);
    set({ theme: stored });
  },
}));
