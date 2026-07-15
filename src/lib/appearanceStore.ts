// 外观设置状态管理
//
// 功能概述：
// 使用 Zustand 管理外观相关设置（背景预设、质感模式、毛玻璃透明度等），
// 通过 zustand persist 中间件实现 localStorage 自动持久化，设置变更即时生效到 DOM（CSS 变量与质感类名）。
//
// 模块职责：
// 1. 管理背景预设 ID、自定义背景色、毛玻璃透明度、质感模式
// 2. 通过 persist 中间件自动持久化到 localStorage（独立 key，避免与编辑器设置共享造成数据污染）
// 3. 应用背景主题到 DOM（注入 CSS 变量、切换质感类名）
// 4. 提供背景预设数据与主题默认预设查询函数
//
// 设计说明：
// - 采用 zustand persist 中间件，替代原手工 read-modify-write 持久化模式
// - STORAGE_KEY 独立为 `miaochuangshuo-appearance`，与 editorSettingsStore 彻底分离，消除数据污染风险
// - 模块顶层执行一次性迁移：从旧共享 key `novelforge-settings` 提取外观字段到新独立 key
// - DOM 副作用 applyBackgroundTheme 操作 document.documentElement.style 与 classList，属于外观应用的必要副作用
// - 背景预设数据为静态常量，可在模块顶层直接导出供组件渲染色板

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// 质感模式类型
// solid=纯色面板，无模糊无纹理
// frosted=磨砂玻璃，面板应用 backdrop-blur + 半透明背景
// paper=纸质书，全局叠加纸张纤维颗粒纹理层
// blur=高斯模糊，更强的 backdrop-blur，面板呈现深度模糊蒙纱感
export type TextureMode = "solid" | "frosted" | "paper" | "blur";

// 独立 localStorage 键（消除与 editorSettingsStore 的共享）
const STORAGE_KEY = "miaochuangshuo-appearance";
// 旧共享 localStorage 键（用于一次性迁移，与 editorSettingsStore 共用）
const LEGACY_STORAGE_KEY = "novelforge-settings";
// 当前 schema 版本（用于未来字段变更时的迁移）
const SCHEMA_VERSION = 1;

// 背景色预设方案：每套方案包含主背景色与对应面板色（略亮于主背景）
// mode 字段标识预设所属主题：dark=暗色主题预设 / light=亮色主题预设
// 主题切换时仅展示同 mode 的预设，并自动切换到对应主题的默认预设
export interface BackgroundPreset {
  id: string;
  /** 主题归属：dark=暗色预设 / light=亮色预设 */
  mode: "dark" | "light";
  /** 主背景色（hex） */
  bg: string;
  /** 卡片/面板背景色（hex，略亮于 bg） */
  cardBg: string;
  /** 侧边栏背景色（hex，略暗于 bg） */
  sidebarBg: string;
}

// 暗色主题默认预设 ID（深空黑）
export const DARK_DEFAULT_PRESET = "default";
// 亮色主题默认预设 ID（晨光白）
export const LIGHT_DEFAULT_PRESET = "lightDay";

// 预设列表：
//   暗色：default=深空黑、inkblue=墨水蓝、midnight=午夜蓝
//   亮色：lightDay=晨光白、lightCream=米黄
export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  // 暗色预设
  { id: "default", mode: "dark", bg: "#0c0d14", cardBg: "#161821", sidebarBg: "#101218" },
  { id: "inkblue", mode: "dark", bg: "#0a1420", cardBg: "#0f1c2e", sidebarBg: "#08101a" },
  { id: "midnight", mode: "dark", bg: "#0a0f1f", cardBg: "#101830", sidebarBg: "#080d1a" },
  // 亮色预设
  { id: "lightDay", mode: "light", bg: "#f8f8fc", cardBg: "#eeeef4", sidebarBg: "#f2f2f8" },
  { id: "lightCream", mode: "light", bg: "#faf6ec", cardBg: "#f1ebda", sidebarBg: "#f5efdf" },
];

/**
 * 根据主题模式获取默认预设 ID
 * 输入: mode 主题模式（dark/light）
 * 输出: 对应主题的默认预设 ID
 */
export function getDefaultPresetByMode(mode: "dark" | "light"): string {
  return mode === "light" ? LIGHT_DEFAULT_PRESET : DARK_DEFAULT_PRESET;
}

// 外观设置数据接口（序列化用）
interface AppearanceSettingsData {
  backgroundPreset: string;
  customBackgroundColor: string;
  glassOpacity: number;
  textureMode: TextureMode;
}

// 外观设置状态接口（含 Actions）
export interface AppearanceSettingsState extends AppearanceSettingsData {
  /** 设置背景预设 ID（default/inkblue/midnight/lightDay/lightCream/custom） */
  setBackgroundPreset: (preset: string) => void;
  /** 设置自定义背景色（hex 格式，仅 custom 预设生效） */
  setCustomBackgroundColor: (color: string) => void;
  /** 设置毛玻璃透明度（0-1） */
  setGlassOpacity: (opacity: number) => void;
  /** 设置质感模式（solid/frosted/paper/blur） */
  setTextureMode: (mode: TextureMode) => void;
  /** 初始化外观设置：应用 DOM 副作用（persist 中间件已自动加载状态） */
  initAppearanceSettings: () => void;
}

// 默认外观设置
const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettingsData = {
  backgroundPreset: "default",
  customBackgroundColor: "#0c0d14",
  glassOpacity: 1,
  textureMode: "frosted",
};

// 外观数据字段白名单（迁移时从旧共享 key 仅提取这些字段）
const APPEARANCE_DATA_KEYS = [
  "backgroundPreset", "customBackgroundColor", "glassOpacity", "textureMode",
] as const;

/**
 * 从完整状态中提取需持久化的数据字段（排除 actions）
 * 输入: state 完整状态（含数据与 actions）
 * 输出: 仅含数据字段的纯对象
 */
function pickAppearanceData(state: AppearanceSettingsState): AppearanceSettingsData {
  return {
    backgroundPreset: state.backgroundPreset,
    customBackgroundColor: state.customBackgroundColor,
    glassOpacity: state.glassOpacity,
    textureMode: state.textureMode,
  };
}

/**
 * 一次性迁移：从旧共享 key 提取外观字段到新独立 key
 * 仅在新 key 不存在且旧 key 存在时执行
 * 流程:
 *   1. 检测新 key 是否已有数据（已有则跳过，避免覆盖）
 *   2. 读取旧共享 key 的完整数据（包含编辑器与外观字段）
 *   3. 按字段白名单提取外观相关字段
 *   4. 写入新独立 key
 * 说明: 旧 key `novelforge-settings` 与 editorSettingsStore 共享，此处仅提取外观字段，不删除旧 key
 *       （editorSettingsStore 迁移时也会读取同一旧 key 提取编辑器字段）
 */
function migrateLegacyAppearanceSettings(): void {
  if (typeof localStorage === "undefined") return;
  try {
    // 新 key 已有数据，跳过迁移
    if (localStorage.getItem(STORAGE_KEY)) return;
    const oldRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!oldRaw) return;
    const parsed = JSON.parse(oldRaw) as Record<string, unknown>;
    const extracted: Record<string, unknown> = {};
    for (const key of APPEARANCE_DATA_KEYS) {
      if (key in parsed) {
        extracted[key] = parsed[key];
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(extracted));
  } catch {
    // 迁移失败静默处理，persist 将使用默认值
  }
}

// 模块顶层执行迁移（store 创建前立即执行，非 React 组件内）
migrateLegacyAppearanceSettings();

/**
 * 将 hex 颜色转为 "r, g, b" 字符串（用于 rgba 拼接）
 * 输入: hex 字符串（如 "#0c0d14" 或 "0c0d14"）
 * 输出: "r, g, b" 字符串
 */
function hexToRgbStr(hex: string): string {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6) return "12, 13, 20"; // 解析失败回退默认值
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some((n) => isNaN(n))) return "12, 13, 20";
  return `${r}, ${g}, ${b}`;
}

/**
 * 应用背景主题到 DOM（CSS 变量注入与质感类名切换）
 * 输入:
 *   preset 预设 ID
 *   customColor 自定义颜色（仅 custom 预设使用）
 *   glassOpacity 毛玻璃透明度（0-1）
 *   textureMode 质感模式（solid/frosted/paper/blur）
 * 输出: 无（副作用：修改 document.documentElement.style 与 classList）
 * 流程:
 *   1. 检测当前主题模式（.light 类），按主题选择预设查询路径
 *   2. 解析预设背景色：custom 预设使用 customColor；其他预设直接查表；查表失败时按主题回退到默认预设
 *   3. 注入主背景变量 --fandex-bg，以及对应的 --fandex-bg-card / --fandex-bg-sidebar
 *   4. 注入毛玻璃变量：--nf-glass-opacity、--nf-bg-rgb（供 rgba 拼接使用）
 *   5. 应用质感模式：在 root 上切换 .nf-tex-* 类，控制全局面板质感渲染
 */
function applyBackgroundTheme(
  preset: string,
  customColor: string,
  glassOpacity: number,
  textureMode: TextureMode
): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const isLightTheme = root.classList.contains("light");

  let bg: string;
  let sidebarBg: string;
  let cardBg: string;

  if (preset === "custom" && customColor) {
    // 自定义颜色：以用户选择色作为主背景，侧边栏与卡片沿用同色避免脱节
    bg = customColor;
    sidebarBg = customColor;
    cardBg = customColor;
  } else {
    const found = BACKGROUND_PRESETS.find((p) => p.id === preset);
    if (found) {
      bg = found.bg;
      sidebarBg = found.sidebarBg;
      cardBg = found.cardBg;
    } else {
      // 回退到当前主题的默认预设
      const fallbackId = getDefaultPresetByMode(isLightTheme ? "light" : "dark");
      const fallback = BACKGROUND_PRESETS.find((p) => p.id === fallbackId);
      bg = fallback?.bg ?? (isLightTheme ? "#f8f8fc" : "#0c0d14");
      sidebarBg = fallback?.sidebarBg ?? (isLightTheme ? "#f2f2f8" : "#101218");
      cardBg = fallback?.cardBg ?? (isLightTheme ? "#eeeef4" : "#161821");
    }
  }

  // 注入主背景变量（编辑区/画布跟随背景色调节）
  root.style.setProperty("--fandex-bg", bg);
  // 注入侧边栏背景变量：使侧边栏随主题预设联动
  root.style.setProperty("--fandex-bg-sidebar", sidebarBg);
  // 注入卡片/面板背景变量：保持卡片与背景预设的视觉协调
  root.style.setProperty("--fandex-bg-card", cardBg);
  // 毛玻璃透明度：0-1，供 .nf-glass 类使用 rgba 拼接
  root.style.setProperty("--nf-glass-opacity", String(glassOpacity));
  // 主背景 RGB 通道：供毛玻璃面板使用 rgba(var(--nf-bg-rgb), opacity)
  root.style.setProperty("--nf-bg-rgb", hexToRgbStr(bg));

  // 应用质感模式：切换 root 上的质感类，CSS 据此渲染全局面板
  root.classList.remove("nf-tex-solid", "nf-tex-frosted", "nf-tex-paper", "nf-tex-blur");
  root.classList.add(`nf-tex-${textureMode}`);
}

// 创建外观设置 store，使用 persist 中间件自动持久化
// 泛型 <AppearanceSettingsState, [], [], AppearanceSettingsData> 分别指定完整状态类型、空 middleware mutators、持久化数据类型
export const useAppearanceSettingsStore = create<AppearanceSettingsState>()(
  persist<AppearanceSettingsState, [], [], AppearanceSettingsData>(
    (set, get) => ({
      ...DEFAULT_APPEARANCE_SETTINGS,

      setBackgroundPreset: (preset): void => {
        const data = get();
        applyBackgroundTheme(preset, data.customBackgroundColor, data.glassOpacity, data.textureMode);
        set({ backgroundPreset: preset });
      },

      setCustomBackgroundColor: (color): void => {
        const data = get();
        // 仅当当前为 custom 预设时才立即应用，避免修改自定义色但未切换预设时产生视觉跳变
        if (data.backgroundPreset === "custom") {
          applyBackgroundTheme("custom", color, data.glassOpacity, data.textureMode);
        }
        set({ customBackgroundColor: color });
      },

      setGlassOpacity: (opacity): void => {
        const clamped = Math.max(0, Math.min(1, opacity));
        const data = get();
        applyBackgroundTheme(data.backgroundPreset, data.customBackgroundColor, clamped, data.textureMode);
        set({ glassOpacity: clamped });
      },

      setTextureMode: (mode): void => {
        const data = get();
        applyBackgroundTheme(data.backgroundPreset, data.customBackgroundColor, data.glassOpacity, mode);
        set({ textureMode: mode });
      },

      initAppearanceSettings: (): void => {
        // persist 中间件已自动 rehydrate 状态，此处仅应用 DOM 副作用
        const data = get();
        applyBackgroundTheme(
          data.backgroundPreset,
          data.customBackgroundColor,
          data.glassOpacity,
          data.textureMode
        );
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: SCHEMA_VERSION,
      partialize: (state) => pickAppearanceData(state),
      migrate: (persistedState, version) => {
        // 版本兼容处理：未知或格式异常的数据回退默认值
        if (version < SCHEMA_VERSION && persistedState && typeof persistedState === "object") {
          const data = persistedState as Partial<AppearanceSettingsData>;
          return { ...DEFAULT_APPEARANCE_SETTINGS, ...data };
        }
        return DEFAULT_APPEARANCE_SETTINGS;
      },
      onRehydrateStorage: () => (state) => {
        // rehydrate 完成后应用背景主题到 DOM
        if (state) {
          applyBackgroundTheme(
            state.backgroundPreset,
            state.customBackgroundColor,
            state.glassOpacity,
            state.textureMode
          );
        }
      },
    }
  )
);
