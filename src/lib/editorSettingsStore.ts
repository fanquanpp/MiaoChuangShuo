// 编辑器设置状态管理
//
// 功能概述：
// 使用 Zustand 管理编辑器相关设置（字号、自动保存、章节格式、缩进、音效、快照等），
// 支持 localStorage 持久化。设置变更即时生效到 DOM 和编辑器。
//
// 模块职责：
// 1. 管理编辑器字号、自动保存间隔、章节标题格式、缩进、音效、快照等设置
// 2. 持久化编辑器设置到 localStorage（与外观设置共享 STORAGE_KEY，采用读-改-写模式避免覆盖）
// 3. 应用字号到 DOM（CSS 变量 --fandex-editor-font-size）
// 4. 提供章节标题格式化工具函数（toChineseNumber、formatChapterHeading 等）
//
// 设计说明：
// - localStorage 采用共享键 `novelforge-settings`，写入时先读取已有数据再合并，避免覆盖外观设置
// - DOM 副作用 applyFontSize 直接操作 document.documentElement.style，属于设置应用的必要副作用
// - 章节工具函数为纯函数，无副作用，可独立测试

import { create } from "zustand";

// 章节标题格式类型
export type ChapterFormat = "chinese" | "arabic" | "english";

// 共享 localStorage 键（与 appearanceStore 共用，保证向后兼容）
const STORAGE_KEY = "novelforge-settings";

// 编辑器设置数据接口（序列化用）
interface EditorSettingsData {
  fontSize: number;
  autoSaveInterval: number;
  chapterFormat: ChapterFormat;
  autoFillBookTitle: boolean;
  autoOutlineSkeleton: boolean;
  autoNumbering: boolean;
  autoTemplateFill: boolean;
  indentEnabled: boolean;
  indentWidth: number;
  typingSound: boolean;
  sessionWordTarget: number;
  snapshotEnabled: boolean;
  snapshotMinInterval: number;
  lastProjectPath: string;
  checkUpdateOnStartup: boolean;
  lastUpdateCheckTime: number;
  skipUpdateVersion: string;
}

// 编辑器设置状态接口（含 Actions）
export interface EditorSettingsState extends EditorSettingsData {
  setFontSize: (size: number) => void;
  setAutoSaveInterval: (seconds: number) => void;
  setChapterFormat: (format: ChapterFormat) => void;
  setAutoFillBookTitle: (enabled: boolean) => void;
  setAutoOutlineSkeleton: (enabled: boolean) => void;
  setAutoNumbering: (enabled: boolean) => void;
  setAutoTemplateFill: (enabled: boolean) => void;
  setIndentEnabled: (enabled: boolean) => void;
  setIndentWidth: (width: number) => void;
  setTypingSound: (enabled: boolean) => void;
  setSessionWordTarget: (target: number) => void;
  setSnapshotEnabled: (enabled: boolean) => void;
  setSnapshotMinInterval: (seconds: number) => void;
  setLastProjectPath: (path: string) => void;
  setCheckUpdateOnStartup: (enabled: boolean) => void;
  setLastUpdateCheckTime: (timestamp: number) => void;
  setSkipUpdateVersion: (version: string) => void;
  /** 从 localStorage 加载编辑器设置并应用到 DOM */
  initEditorSettings: () => void;
}

// 默认编辑器设置
const DEFAULT_EDITOR_SETTINGS: EditorSettingsData = {
  fontSize: 17,
  autoSaveInterval: 30,
  chapterFormat: "chinese",
  autoFillBookTitle: true,
  autoOutlineSkeleton: true,
  autoNumbering: true,
  autoTemplateFill: true,
  indentEnabled: true,
  indentWidth: 2,
  typingSound: false,
  sessionWordTarget: 0,
  snapshotEnabled: true,
  snapshotMinInterval: 60,
  lastProjectPath: "",
  checkUpdateOnStartup: false,
  lastUpdateCheckTime: 0,
  skipUpdateVersion: "",
};

/**
 * 从 localStorage 加载编辑器设置
 * 输出: EditorSettingsData 编辑器设置数据
 * 流程:
 *   1. 读取共享 STORAGE_KEY 的完整数据
 *   2. 与默认值合并，仅提取编辑器相关字段
 *   3. 解析失败时返回默认值
 */
function loadEditorSettings(): EditorSettingsData {
  if (typeof localStorage === "undefined") return DEFAULT_EDITOR_SETTINGS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_EDITOR_SETTINGS, ...parsed };
    }
  } catch {
    // JSON 解析失败，返回默认值
  }
  return DEFAULT_EDITOR_SETTINGS;
}

/**
 * 持久化编辑器设置到 localStorage（读-改-写模式）
 * 输入: data 待写入的编辑器设置数据
 * 流程:
 *   1. 读取共享键的现有完整数据（包含外观设置）
 *   2. 合并编辑器设置字段
 *   3. 写回 localStorage，避免覆盖外观设置
 * 说明: 与 appearanceStore 共享 STORAGE_KEY，必须采用读-改-写避免数据丢失
 */
function persistEditorSettings(data: Partial<EditorSettingsData>): void {
  if (typeof localStorage === "undefined") return;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const existing = stored ? JSON.parse(stored) : {};
    const merged = { ...existing, ...data };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // 写入失败，静默处理
  }
}

/**
 * 应用字体大小到 DOM（CSS 变量注入）
 * 输入: size 字体大小（px）
 * 输出: 无（副作用：修改 document.documentElement.style）
 */
function applyFontSize(size: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--fandex-editor-font-size", `${size}px`);
}

export const useEditorSettingsStore = create<EditorSettingsState>((set) => ({
  ...DEFAULT_EDITOR_SETTINGS,

  setFontSize: (size): void => {
    const clamped = Math.max(12, Math.min(28, size));
    applyFontSize(clamped);
    persistEditorSettings({ fontSize: clamped });
    set({ fontSize: clamped });
  },

  setAutoSaveInterval: (seconds): void => {
    const clamped = Math.max(0, Math.min(600, seconds));
    persistEditorSettings({ autoSaveInterval: clamped });
    set({ autoSaveInterval: clamped });
  },

  setChapterFormat: (format): void => {
    persistEditorSettings({ chapterFormat: format });
    set({ chapterFormat: format });
  },

  setAutoFillBookTitle: (enabled): void => {
    persistEditorSettings({ autoFillBookTitle: enabled });
    set({ autoFillBookTitle: enabled });
  },

  setAutoOutlineSkeleton: (enabled): void => {
    persistEditorSettings({ autoOutlineSkeleton: enabled });
    set({ autoOutlineSkeleton: enabled });
  },

  setAutoNumbering: (enabled): void => {
    persistEditorSettings({ autoNumbering: enabled });
    set({ autoNumbering: enabled });
  },

  setAutoTemplateFill: (enabled): void => {
    persistEditorSettings({ autoTemplateFill: enabled });
    set({ autoTemplateFill: enabled });
  },

  setIndentEnabled: (enabled): void => {
    persistEditorSettings({ indentEnabled: enabled });
    set({ indentEnabled: enabled });
  },

  setIndentWidth: (width): void => {
    // 上限放宽至 8,既支持标准 1-4 全角空格快捷选择,也允许高级用户自定义更宽缩进
    const clamped = Math.max(1, Math.min(8, Math.floor(width)));
    persistEditorSettings({ indentWidth: clamped });
    set({ indentWidth: clamped });
  },

  setTypingSound: (enabled): void => {
    persistEditorSettings({ typingSound: enabled });
    set({ typingSound: enabled });
  },

  setSessionWordTarget: (target): void => {
    const clamped = Math.max(0, Math.floor(target));
    persistEditorSettings({ sessionWordTarget: clamped });
    set({ sessionWordTarget: clamped });
  },

  setSnapshotEnabled: (enabled): void => {
    persistEditorSettings({ snapshotEnabled: enabled });
    set({ snapshotEnabled: enabled });
  },

  setSnapshotMinInterval: (seconds): void => {
    const clamped = Math.max(0, Math.min(3600, Math.floor(seconds)));
    persistEditorSettings({ snapshotMinInterval: clamped });
    set({ snapshotMinInterval: clamped });
  },

  setLastProjectPath: (path): void => {
    persistEditorSettings({ lastProjectPath: path });
    set({ lastProjectPath: path });
  },

  setCheckUpdateOnStartup: (enabled): void => {
    persistEditorSettings({ checkUpdateOnStartup: enabled });
    set({ checkUpdateOnStartup: enabled });
  },

  setLastUpdateCheckTime: (timestamp): void => {
    persistEditorSettings({ lastUpdateCheckTime: timestamp });
    set({ lastUpdateCheckTime: timestamp });
  },

  setSkipUpdateVersion: (version): void => {
    persistEditorSettings({ skipUpdateVersion: version });
    set({ skipUpdateVersion: version });
  },

  initEditorSettings: (): void => {
    const stored = loadEditorSettings();
    applyFontSize(stored.fontSize);
    set(stored);
  },
}));

// ===== 章节标题格式化工具函数 =====

// 中文数字映射表（0-50）
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
 * 输入: n 数字
 * 输出: 中文数字字符串（支持 1-50，超过 50 回退为阿拉伯数字字符串）
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
  // 使用空格分隔（行业通行格式）
  if (autoFillTitle && bookTitle) {
    heading += ` ${bookTitle}`;
  }
  return heading;
}

/**
 * 从文件名或文本中提取章节序号
 * 输入: name 文件名或文本
 * 输出: 章节序号（0 表示无法识别）
 * 支持格式: 第X章, 第X节, 第X回, Chapter X, 01., 1.，以及中文数字（一至五十）
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
 * 输入: files 文件节点列表
 * 输出: 下一章序号
 */
export function getNextChapterNum(files: { name: string }[]): number {
  let maxNum = 0;
  for (const f of files) {
    const num = extractChapterNum(f.name);
    if (num > maxNum) maxNum = num;
  }
  return maxNum + 1;
}
