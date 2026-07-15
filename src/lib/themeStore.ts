// 主题状态管理
//
// 功能概述：
// 使用 Zustand 管理应用主题（亮色/暗色），通过 zustand persist 中间件实现 localStorage 自动持久化。
// 通过在 document.documentElement 上切换 .light 类实现主题切换。
//
// 模块职责：
// 1. 管理当前主题状态
// 2. 提供主题切换方法
// 3. 通过 persist 中间件自动持久化主题到 localStorage
// 4. 应用主题到 DOM 根元素
// 5. 主题切换时联动 settingsStore 重新应用背景预设，确保亮/暗主题与背景色协同
//    - 切换到亮色：自动切到亮色默认预设（晨光白），除非当前已是亮色预设
//    - 切换到暗色：自动切到暗色默认预设（深空黑），除非当前已是暗色预设
//
// 设计说明：
// - 采用 zustand persist 中间件，替代原手工 localStorage 读写
// - STORAGE_KEY 改为 `miaochuangshuo-theme`（原为 `novelforge-theme`）
// - 模块顶层执行一次性迁移：从旧 key 读取纯字符串数据，转为 persist 的 JSON 格式写入新 key
// - 旧数据为纯字符串（"dark"/"light"），新数据为 persist 标准 JSON 结构

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// 主题类型枚举
export type ThemeMode = "dark" | "light";

// 独立 localStorage 键
const STORAGE_KEY = "miaochuangshuo-theme";
// 旧 localStorage 键（用于一次性迁移）
const LEGACY_STORAGE_KEY = "novelforge-theme";
// 当前 schema 版本（用于未来字段变更时的迁移）
const SCHEMA_VERSION = 1;

// 主题持久化数据接口
interface ThemePersistedData {
  theme: ThemeMode;
}

// 主题状态接口
interface ThemeState {
  // 当前主题
  theme: ThemeMode;
  // 切换主题
  toggleTheme: () => void;
  // 设置主题
  setTheme: (theme: ThemeMode) => void;
  // 初始化主题：应用 DOM 副作用（persist 中间件已自动加载状态）
  initTheme: () => void;
}

// 默认主题
const DEFAULT_THEME: ThemeMode = "dark";

/**
 * 应用主题到 DOM 根元素
 * 输入: theme 主题模式
 * 输出: 无（副作用：修改 document.documentElement.classList）
 * 流程: 在 documentElement 上添加/移除 .light 类
 */
function applyThemeToDom(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "light") {
    root.classList.add("light");
  } else {
    root.classList.remove("light");
  }
}

/**
 * 一次性迁移：从旧 key 读取纯字符串数据，转为 persist 的 JSON 格式写入新 key
 * 仅在新 key 不存在且旧 key 存在时执行
 * 流程:
 *   1. 检测新 key 是否已有数据（已有则跳过，避免覆盖）
 *   2. 读取旧 key 的纯字符串数据（"dark" 或 "light"）
 *   3. 构造 persist 标准格式 { state: {...}, version } 写入新 key
 * 说明: 旧数据为纯字符串，非 JSON 对象，需手动构造 persist 内部格式
 */
function migrateLegacyTheme(): void {
  if (typeof localStorage === "undefined") return;
  try {
    // 新 key 已有数据，跳过迁移
    if (localStorage.getItem(STORAGE_KEY)) return;
    const oldRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (oldRaw === "dark" || oldRaw === "light") {
      // 旧数据为纯字符串，转为 persist 标准 JSON 格式
      const newData = JSON.stringify({ state: { theme: oldRaw }, version: SCHEMA_VERSION });
      localStorage.setItem(STORAGE_KEY, newData);
    }
  } catch {
    // 迁移失败静默处理，persist 将使用默认值
  }
}

// 模块顶层执行迁移（store 创建前立即执行，非 React 组件内）
migrateLegacyTheme();

/**
 * 主题切换后联动 settingsStore 重新应用背景预设
 * 输入: nextTheme 即将切换到的主题模式
 * 输出: 无
 * 流程:
 *   1. 动态导入 settingsStore，避免循环依赖
 *   2. 读取当前预设，若其 mode 与目标主题不一致，则切到目标主题的默认预设
 *      （例如从暗色 default 切到亮色时，自动切到 lightDay）
 *   3. 若当前预设已是目标主题的预设，则仅重新应用以刷新内联变量
 */
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

// 创建主题状态 store，使用 persist 中间件自动持久化
// 泛型 <ThemeState, [], [], ThemePersistedData> 分别指定完整状态类型、空 middleware mutators、持久化数据类型
export const useThemeStore = create<ThemeState>()(
  persist<ThemeState, [], [], ThemePersistedData>(
    (set, get) => ({
      theme: DEFAULT_THEME,

      toggleTheme: (): void => {
        const current = get().theme;
        const next: ThemeMode = current === "dark" ? "light" : "dark";
        applyThemeToDom(next);
        set({ theme: next });
        // 主题切换后联动重新应用背景预设，确保亮色主题下不被深色内联样式覆盖
        syncBackgroundWithTheme(next);
      },

      setTheme: (theme): void => {
        applyThemeToDom(theme);
        set({ theme });
        syncBackgroundWithTheme(theme);
      },

      initTheme: (): void => {
        // persist 中间件已自动 rehydrate 状态，此处仅应用 DOM 副作用
        const stored = get().theme;
        applyThemeToDom(stored);
        // 初始化时也同步一次，确保背景预设与主题一致
        syncBackgroundWithTheme(stored);
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: SCHEMA_VERSION,
      partialize: (state) => ({ theme: state.theme }),
      migrate: (persistedState, version) => {
        // 版本兼容处理：未知或格式异常的数据回退默认值
        if (version < SCHEMA_VERSION && persistedState && typeof persistedState === "object") {
          const data = persistedState as Partial<ThemePersistedData>;
          if (data.theme === "dark" || data.theme === "light") {
            return { theme: data.theme };
          }
        }
        return { theme: DEFAULT_THEME };
      },
      onRehydrateStorage: () => (state) => {
        // rehydrate 完成后应用主题到 DOM
        if (state) {
          applyThemeToDom(state.theme);
        }
      },
    }
  )
);
