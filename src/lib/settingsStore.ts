// 应用设置状态管理
//
// 功能概述：
// 使用 Zustand 管理应用级设置（编辑器字号、自动保存间隔、章节标题格式等），
// 支持 localStorage 持久化。设置变更即时生效到 DOM 和编辑器。
//
// 模块职责：
// 1. 管理编辑器字号、自动保存间隔、章节标题格式
// 2. 持久化设置到 localStorage
// 3. 应用字号到 DOM（CSS 变量）

import { create } from "zustand";

// 章节标题格式类型
export type ChapterFormat = "chinese" | "arabic" | "english";

// 应用设置状态接口
interface SettingsState {
  /** 编辑器字体大小（px） */
  fontSize: number;
  /** 自动保存间隔（秒），0 表示禁用 */
  autoSaveInterval: number;
  /** 章节标题格式：chinese=第X章, arabic=01, english=Chapter X */
  chapterFormat: ChapterFormat;
  /** 新建章节时自动填充书名 */
  autoFillBookTitle: boolean;
  /** 新建大纲文件时自动生成骨架 */
  autoOutlineSkeleton: boolean;
  /** 日记自动添加本地日期 */
  diaryAutoDate: boolean;
  /** 天气自动填充 */
  weatherAutoFill: boolean;
  /** 章节自动编号 */
  autoNumbering: boolean;
  /** 模板自动填充 */
  autoTemplateFill: boolean;
  /** 首行缩进开关 */
  indentEnabled: boolean;
  /** 首行缩进宽度（全角空格数，1-4） */
  indentWidth: number;
  /** 打字机模式：光标行始终居中 */
  typewriterMode: boolean;
  /** 焦点暗化：非当前段落降低透明度 */
  focusDim: boolean;
  /** 焦点暗化透明度（0-1，越低越暗） */
  focusDimOpacity: number;
  /** 打字音效开关 */
  typingSound: boolean;
  /** 字数目标（本次会话，0=未设定） */
  sessionWordTarget: number;
  /** 版本快照开关（每次保存自动创建快照） */
  snapshotEnabled: boolean;
  /** 快照最小间隔（秒，避免高频保存产生重复快照） */
  snapshotMinInterval: number;
  /** 上次创建项目使用的父目录（用于目录选择器记忆） */
  lastProjectPath: string;
  /** 纯阅读模式：编辑器只读，隐藏格式工具栏与 BubbleMenu，适合阅读已写内容 */
  readingMode: boolean;
  /** 编辑器背景预设 ID：default/inkblue/parchment/forest/purple/custom */
  backgroundPreset: string;
  /** 自定义背景色（仅当 backgroundPreset='custom' 时使用，hex 格式） */
  customBackgroundColor: string;
  /** 毛玻璃透明度（0-1，1=完全不透明，0=完全透明） */
  glassOpacity: number;
  /** 启动时自动检查更新（默认关闭，遵循离线优先原则） */
  checkUpdateOnStartup: boolean;
  /** 上次检查更新的时间戳（毫秒，0=从未检查） */
  lastUpdateCheckTime: number;
  /** 用户主动跳过的版本号（如 "3.1.0"，"" 表示未跳过任何版本） */
  skipUpdateVersion: string;

  // Actions
  setFontSize: (size: number) => void;
  setAutoSaveInterval: (seconds: number) => void;
  setChapterFormat: (format: ChapterFormat) => void;
  setAutoFillBookTitle: (enabled: boolean) => void;
  setAutoOutlineSkeleton: (enabled: boolean) => void;
  setDiaryAutoDate: (enabled: boolean) => void;
  setWeatherAutoFill: (enabled: boolean) => void;
  setAutoNumbering: (enabled: boolean) => void;
  setAutoTemplateFill: (enabled: boolean) => void;
  setIndentEnabled: (enabled: boolean) => void;
  setIndentWidth: (width: number) => void;
  setTypewriterMode: (enabled: boolean) => void;
  setFocusDim: (enabled: boolean) => void;
  setFocusDimOpacity: (opacity: number) => void;
  setTypingSound: (enabled: boolean) => void;
  setSessionWordTarget: (target: number) => void;
  setSnapshotEnabled: (enabled: boolean) => void;
  setSnapshotMinInterval: (seconds: number) => void;
  /** 记忆上次创建项目使用的父目录 */
  setLastProjectPath: (path: string) => void;
  /** 切换纯阅读模式（只读 + 隐藏格式工具栏） */
  setReadingMode: (enabled: boolean) => void;
  /** 设置背景预设 ID（default/inkblue/parchment/forest/purple/custom） */
  setBackgroundPreset: (preset: string) => void;
  /** 设置自定义背景色（hex 格式，仅 custom 预设生效） */
  setCustomBackgroundColor: (color: string) => void;
  /** 设置毛玻璃透明度（0-1） */
  setGlassOpacity: (opacity: number) => void;
  /** 设置启动时自动检查更新开关 */
  setCheckUpdateOnStartup: (enabled: boolean) => void;
  /** 记录本次检查更新的时间戳 */
  setLastUpdateCheckTime: (timestamp: number) => void;
  /** 设置用户跳过的版本号（"" 表示清除跳过） */
  setSkipUpdateVersion: (version: string) => void;
  /** 从 localStorage 加载并应用 */
  initSettings: () => void;
}

const STORAGE_KEY = "novelforge-settings";

// 设置数据接口（序列化用）
interface SettingsData {
  fontSize: number;
  autoSaveInterval: number;
  chapterFormat: ChapterFormat;
  autoFillBookTitle: boolean;
  autoOutlineSkeleton: boolean;
  diaryAutoDate: boolean;
  weatherAutoFill: boolean;
  autoNumbering: boolean;
  autoTemplateFill: boolean;
  indentEnabled: boolean;
  indentWidth: number;
  typewriterMode: boolean;
  focusDim: boolean;
  focusDimOpacity: number;
  typingSound: boolean;
  sessionWordTarget: number;
  snapshotEnabled: boolean;
  snapshotMinInterval: number;
  lastProjectPath: string;
  readingMode: boolean;
  backgroundPreset: string;
  customBackgroundColor: string;
  glassOpacity: number;
  checkUpdateOnStartup: boolean;
  lastUpdateCheckTime: number;
  skipUpdateVersion: string;
}

// 默认设置
const DEFAULT_SETTINGS: SettingsData = {
  fontSize: 17,
  autoSaveInterval: 30,
  chapterFormat: "chinese",
  autoFillBookTitle: true,
  autoOutlineSkeleton: true,
  diaryAutoDate: true,
  weatherAutoFill: false,
  autoNumbering: true,
  autoTemplateFill: true,
  indentEnabled: true,
  indentWidth: 2,
  typewriterMode: false,
  focusDim: false,
  focusDimOpacity: 0.35,
  typingSound: false,
  sessionWordTarget: 0,
  snapshotEnabled: true,
  snapshotMinInterval: 60,
  lastProjectPath: "",
  readingMode: false,
  backgroundPreset: "default",
  customBackgroundColor: "#0c0d14",
  glassOpacity: 1,
  checkUpdateOnStartup: false,
  lastUpdateCheckTime: 0,
  skipUpdateVersion: "",
};

function loadSettings(): SettingsData {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // JSON 解析失败，返回默认值
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(data: SettingsData): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// 应用字体大小到 DOM（CSS 变量）
function applyFontSize(size: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--fandex-editor-font-size", `${size}px`);
}

// 背景色预设方案：每套方案包含主背景色与对应面板色（略亮于主背景）
export interface BackgroundPreset {
  id: string;
  /** 主背景色（hex） */
  bg: string;
  /** 卡片/面板背景色（hex，略亮于 bg） */
  cardBg: string;
  /** 侧边栏背景色（hex，略暗于 bg） */
  sidebarBg: string;
}

// 预设列表：default=深空黑、inkblue=墨水蓝、parchment=羊皮暖、forest=森林绿、purple=暗紫
export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { id: "default", bg: "#0c0d14", cardBg: "#161821", sidebarBg: "#101218" },
  { id: "inkblue", bg: "#0a1420", cardBg: "#0f1c2e", sidebarBg: "#08101a" },
  { id: "parchment", bg: "#1a1612", cardBg: "#241f1a", sidebarBg: "#15110d" },
  { id: "forest", bg: "#0d1814", cardBg: "#13231c", sidebarBg: "#0a1410" },
  { id: "purple", bg: "#150a1a", cardBg: "#1f1228", sidebarBg: "#100815" },
];

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
 * 应用背景主题到 DOM（CSS 变量注入）
 * 输入:
 *   preset 预设 ID
 *   customColor 自定义颜色（仅 custom 预设使用）
 *   glassOpacity 毛玻璃透明度（0-1）
 * 输出: 无（副作用：修改 document.documentElement.style）
 * 流程:
 *   1. 根据预设解析出主背景色/卡片色/侧边栏色
 *   2. 若为 custom 预设，使用 customColor 作为主背景，自动派生卡片/侧边栏色
 *   3. 注入 CSS 变量：--fandex-bg、--fandex-bg-card、--fandex-bg-sidebar
 *   4. 注入毛玻璃变量：--nf-glass-opacity、--nf-bg-rgb（供 rgba 拼接使用）
 */
function applyBackgroundTheme(
  preset: string,
  customColor: string,
  glassOpacity: number
): void {
  if (typeof document === "undefined") return;

  let bg: string;
  let cardBg: string;
  let sidebarBg: string;

  if (preset === "custom" && customColor) {
    // 自定义颜色：以用户选择色为基础，派生略亮/略暗变体
    bg = customColor;
    const rgb = hexToRgbStr(customColor)
      .split(",")
      .map((s) => parseInt(s.trim(), 10));
    if (rgb.length === 3 && rgb.every((n) => !isNaN(n))) {
      const [r, g, b] = rgb;
      // 卡片色：各通道提升 10，钳制到 255
      cardBg = `#${[r + 10, g + 10, b + 10]
        .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
        .join("")}`;
      // 侧边栏色：各通道降低 4，钳制到 255
      sidebarBg = `#${[r - 4, g - 4, b - 4]
        .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
        .join("")}`;
    } else {
      cardBg = "#161821";
      sidebarBg = "#101218";
    }
  } else {
    const found = BACKGROUND_PRESETS.find((p) => p.id === preset);
    if (found) {
      bg = found.bg;
      cardBg = found.cardBg;
      sidebarBg = found.sidebarBg;
    } else {
      bg = "#0c0d14";
      cardBg = "#161821";
      sidebarBg = "#101218";
    }
  }

  const root = document.documentElement;
  root.style.setProperty("--fandex-bg", bg);
  root.style.setProperty("--fandex-bg-card", cardBg);
  root.style.setProperty("--fandex-bg-sidebar", sidebarBg);
  // 毛玻璃透明度：0-1，供 .nf-glass 类使用 rgba 拼接
  root.style.setProperty("--nf-glass-opacity", String(glassOpacity));
  // 主背景 RGB 通道：供毛玻璃面板使用 rgba(var(--nf-bg-rgb), opacity)
  root.style.setProperty("--nf-bg-rgb", hexToRgbStr(bg));
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,

  setFontSize: (size) => {
    const clamped = Math.max(12, Math.min(28, size));
    applyFontSize(clamped);
    const data = { ...get(), fontSize: clamped };
    saveSettings(data);
    set({ fontSize: clamped });
  },

  setAutoSaveInterval: (seconds) => {
    const clamped = Math.max(0, Math.min(600, seconds));
    const data = { ...get(), autoSaveInterval: clamped };
    saveSettings(data);
    set({ autoSaveInterval: clamped });
  },

  setChapterFormat: (format) => {
    const data = { ...get(), chapterFormat: format };
    saveSettings(data);
    set({ chapterFormat: format });
  },

  setAutoFillBookTitle: (enabled) => {
    const data = { ...get(), autoFillBookTitle: enabled };
    saveSettings(data);
    set({ autoFillBookTitle: enabled });
  },

  setAutoOutlineSkeleton: (enabled) => {
    const data = { ...get(), autoOutlineSkeleton: enabled };
    saveSettings(data);
    set({ autoOutlineSkeleton: enabled });
  },

  setDiaryAutoDate: (enabled) => {
    const data = { ...get(), diaryAutoDate: enabled };
    saveSettings(data);
    set({ diaryAutoDate: enabled });
  },

  setWeatherAutoFill: (enabled) => {
    const data = { ...get(), weatherAutoFill: enabled };
    saveSettings(data);
    set({ weatherAutoFill: enabled });
  },

  setAutoNumbering: (enabled) => {
    const data = { ...get(), autoNumbering: enabled };
    saveSettings(data);
    set({ autoNumbering: enabled });
  },

  setAutoTemplateFill: (enabled) => {
    const data = { ...get(), autoTemplateFill: enabled };
    saveSettings(data);
    set({ autoTemplateFill: enabled });
  },

  setIndentEnabled: (enabled) => {
    const data = { ...get(), indentEnabled: enabled };
    saveSettings(data);
    set({ indentEnabled: enabled });
  },

  setIndentWidth: (width) => {
    // 上限放宽至 8,既支持标准 1-4 全角空格快捷选择,也允许高级用户自定义更宽缩进
    const clamped = Math.max(1, Math.min(8, Math.floor(width)));
    const data = { ...get(), indentWidth: clamped };
    saveSettings(data);
    set({ indentWidth: clamped });
  },

  setTypewriterMode: (enabled) => {
    const data = { ...get(), typewriterMode: enabled };
    saveSettings(data);
    set({ typewriterMode: enabled });
  },

  setFocusDim: (enabled) => {
    const data = { ...get(), focusDim: enabled };
    saveSettings(data);
    set({ focusDim: enabled });
  },

  setFocusDimOpacity: (opacity) => {
    const clamped = Math.max(0.1, Math.min(0.7, opacity));
    const data = { ...get(), focusDimOpacity: clamped };
    saveSettings(data);
    set({ focusDimOpacity: clamped });
  },

  setTypingSound: (enabled) => {
    const data = { ...get(), typingSound: enabled };
    saveSettings(data);
    set({ typingSound: enabled });
  },

  setSessionWordTarget: (target) => {
    const clamped = Math.max(0, Math.floor(target));
    const data = { ...get(), sessionWordTarget: clamped };
    saveSettings(data);
    set({ sessionWordTarget: clamped });
  },

  setSnapshotEnabled: (enabled) => {
    const data = { ...get(), snapshotEnabled: enabled };
    saveSettings(data);
    set({ snapshotEnabled: enabled });
  },

  setSnapshotMinInterval: (seconds) => {
    const clamped = Math.max(0, Math.min(3600, Math.floor(seconds)));
    const data = { ...get(), snapshotMinInterval: clamped };
    saveSettings(data);
    set({ snapshotMinInterval: clamped });
  },

  setLastProjectPath: (path) => {
    const data = { ...get(), lastProjectPath: path };
    saveSettings(data);
    set({ lastProjectPath: path });
  },

  setReadingMode: (enabled) => {
    const data = { ...get(), readingMode: enabled };
    saveSettings(data);
    set({ readingMode: enabled });
  },

  setBackgroundPreset: (preset) => {
    const data = { ...get(), backgroundPreset: preset };
    saveSettings(data);
    applyBackgroundTheme(preset, data.customBackgroundColor, data.glassOpacity);
    set({ backgroundPreset: preset });
  },

  setCustomBackgroundColor: (color) => {
    const data = { ...get(), customBackgroundColor: color };
    saveSettings(data);
    // 仅当当前为 custom 预设时才立即应用，避免修改自定义色但未切换预设时产生视觉跳变
    if (data.backgroundPreset === "custom") {
      applyBackgroundTheme("custom", color, data.glassOpacity);
    }
    set({ customBackgroundColor: color });
  },

  setGlassOpacity: (opacity) => {
    const clamped = Math.max(0, Math.min(1, opacity));
    const data = { ...get(), glassOpacity: clamped };
    saveSettings(data);
    applyBackgroundTheme(data.backgroundPreset, data.customBackgroundColor, clamped);
    set({ glassOpacity: clamped });
  },

  setCheckUpdateOnStartup: (enabled) => {
    const data = { ...get(), checkUpdateOnStartup: enabled };
    saveSettings(data);
    set({ checkUpdateOnStartup: enabled });
  },

  setLastUpdateCheckTime: (timestamp) => {
    const data = { ...get(), lastUpdateCheckTime: timestamp };
    saveSettings(data);
    set({ lastUpdateCheckTime: timestamp });
  },

  setSkipUpdateVersion: (version) => {
    const data = { ...get(), skipUpdateVersion: version };
    saveSettings(data);
    set({ skipUpdateVersion: version });
  },

  initSettings: () => {
    const stored = loadSettings();
    applyFontSize(stored.fontSize);
    applyBackgroundTheme(
      stored.backgroundPreset,
      stored.customBackgroundColor,
      stored.glassOpacity
    );
    set(stored);
  },
}));

// ===== 章节标题格式化工具函数 =====

// 中文数字映射
const CHINESE_NUMERALS = [
  "零", "一", "二", "三", "四", "五", "六", "七", "八", "九",
  "十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九",
  "二十", "二十一", "二十二", "二十三", "二十四", "二十五", "二十六", "二十七", "二十八", "二十九",
  "三十", "三十一", "三十二", "三十三", "三十四", "三十五", "三十六", "三十七", "三十八", "三十九",
  "四十", "四十一", "四十二", "四十三", "四十四", "四十五", "四十六", "四十七", "四十八", "四十九",
  "五十",
];

/**
 * 将阿拉伯数字转为中文数字
 * 支持 1-50，超过 50 则回退为阿拉伯数字
 */
export function toChineseNumber(n: number): string {
  if (n >= 0 && n < CHINESE_NUMERALS.length) return CHINESE_NUMERALS[n];
  return String(n);
}

/**
 * 根据设置生成章节标题
 * 输入:
 *   chapterNum 章节序号（从1开始）
 *   bookTitle 书名（可选，当 autoFillTitle 为 true 时追加）
 *   format 章节格式（chinese/arabic/english）
 *   autoFillTitle 是否自动填充书名
 * 输出:
 *   章节标题字符串（如 "第一章"、"01"、"Chapter 1"）
 * 流程:
 *   1. 根据 format 生成基础章节号
 *   2. 若 autoFillTitle 且有书名，用空格连接追加书名
 */
export function formatChapterHeading(
  chapterNum: number,
  bookTitle: string,
  format: ChapterFormat,
  autoFillTitle: boolean
): string {
  let heading: string;
  switch (format) {
    case "chinese":
      heading = `第${toChineseNumber(chapterNum)}章`;
      break;
    case "arabic":
      heading = `${String(chapterNum).padStart(2, "0")}`;
      break;
    case "english":
      heading = `Chapter ${chapterNum}`;
      break;
    default:
      heading = `第${toChineseNumber(chapterNum)}章`;
  }
  // 使用空格分隔（行业通行格式），不再使用全角冒号
  if (autoFillTitle && bookTitle) {
    heading += ` ${bookTitle}`;
  }
  return heading;
}

/**
 * 从文件名或文本中提取章节序号
 * 支持：第X章, 第X节, 第X回, Chapter X, 01., 1.
 * 同时支持中文数字（一至五十）
 */
export function extractChapterNum(name: string): number {
  // 中文数字反向映射
  const chineseToArabic: Record<string, number> = {};
  for (let i = 0; i < CHINESE_NUMERALS.length; i++) {
    chineseToArabic[CHINESE_NUMERALS[i]] = i;
  }

  // 尝试匹配阿拉伯数字模式
  const arabicPatterns = [
    /第(\d+)[章节回卷集部篇]/,
    /[Cc]hapter\s*(\d+)/,
    /^(\d+)[._\-]/,
    /^(\d+)\s/,
  ];
  for (const p of arabicPatterns) {
    const m = name.match(p);
    if (m) return parseInt(m[1], 10);
  }

  // 尝试匹配中文数字模式：第X章
  const chineseMatch = name.match(/第([一二三四五六七八九十百千万零\d]+)[章节回卷集部篇]/);
  if (chineseMatch) {
    const num = chineseToArabic[chineseMatch[1]];
    if (num !== undefined) return num;
  }

  return 0; // 0 表示无法识别
}

/**
 * 统计目录下的章节文件数并推算下一章序号
 * @param files 文件节点列表
 * @returns 下一章序号
 */
export function getNextChapterNum(files: { name: string }[]): number {
  let maxNum = 0;
  for (const f of files) {
    const num = extractChapterNum(f.name);
    if (num > maxNum) maxNum = num;
  }
  return maxNum + 1;
}
