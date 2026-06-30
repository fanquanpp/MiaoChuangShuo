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

  initSettings: () => {
    const stored = loadSettings();
    applyFontSize(stored.fontSize);
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
 * @param chapterNum 章节序号（从1开始）
 * @param bookTitle 书名（可选）
 * @param format 章节格式
 * @param autoFillTitle 是否自动填充书名
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
  if (autoFillTitle && bookTitle) {
    heading += `：${bookTitle}`;
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
