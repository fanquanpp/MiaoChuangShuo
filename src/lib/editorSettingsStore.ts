// 编辑器设置状态管理
//
// 功能概述：
// 使用 Zustand 管理编辑器相关设置（字号、自动保存、章节格式、缩进、音效、快照等），
// 通过 zustand persist 中间件实现 localStorage 自动持久化，设置变更即时生效到 DOM 和编辑器。
//
// 模块职责：
// 1. 管理编辑器字号、自动保存间隔、章节标题格式、缩进、音效、快照等设置
// 2. 通过 persist 中间件自动持久化到 localStorage（独立 key，避免与外观设置共享造成数据污染）
// 3. 应用字号到 DOM（CSS 变量 --fandex-editor-font-size）
// 4. 提供章节标题格式化工具函数（toChineseNumber、formatChapterHeading 等）
//
// 设计说明：
// - 采用 zustand persist 中间件，替代原手工 read-modify-write 持久化模式
// - STORAGE_KEY 独立为 `miaochuangshuo-editor-settings`，与 appearanceStore 彻底分离，消除数据污染风险
// - 模块顶层执行一次性迁移：从旧共享 key `novelforge-settings` 提取编辑器字段到新独立 key
// - DOM 副作用 applyFontSize 直接操作 document.documentElement.style，属于设置应用的必要副作用
// - 章节工具函数为纯函数，无副作用，可独立测试

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// 章节标题格式类型
export type ChapterFormat = "chinese" | "arabic" | "english";

// 独立 localStorage 键（消除与 appearanceStore 的共享）
const STORAGE_KEY = "miaochuangshuo-editor-settings";
// 旧共享 localStorage 键（用于一次性迁移，与 appearanceStore 共用）
const LEGACY_STORAGE_KEY = "novelforge-settings";
// 当前 schema 版本（用于未来字段变更时的迁移）
const SCHEMA_VERSION = 1;

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
  /** 初始化编辑器设置：应用 DOM 副作用（persist 中间件已自动加载状态） */
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

// 编辑器数据字段白名单（迁移时从旧共享 key 仅提取这些字段）
const EDITOR_DATA_KEYS = [
  "fontSize", "autoSaveInterval", "chapterFormat", "autoFillBookTitle",
  "autoOutlineSkeleton", "autoNumbering", "autoTemplateFill", "indentEnabled",
  "indentWidth", "typingSound", "sessionWordTarget", "snapshotEnabled",
  "snapshotMinInterval", "lastProjectPath", "checkUpdateOnStartup",
  "lastUpdateCheckTime", "skipUpdateVersion",
] as const;

/**
 * 从完整状态中提取需持久化的数据字段（排除 actions）
 * 输入: state 完整状态（含数据与 actions）
 * 输出: 仅含数据字段的纯对象
 */
function pickEditorData(state: EditorSettingsState): EditorSettingsData {
  return {
    fontSize: state.fontSize,
    autoSaveInterval: state.autoSaveInterval,
    chapterFormat: state.chapterFormat,
    autoFillBookTitle: state.autoFillBookTitle,
    autoOutlineSkeleton: state.autoOutlineSkeleton,
    autoNumbering: state.autoNumbering,
    autoTemplateFill: state.autoTemplateFill,
    indentEnabled: state.indentEnabled,
    indentWidth: state.indentWidth,
    typingSound: state.typingSound,
    sessionWordTarget: state.sessionWordTarget,
    snapshotEnabled: state.snapshotEnabled,
    snapshotMinInterval: state.snapshotMinInterval,
    lastProjectPath: state.lastProjectPath,
    checkUpdateOnStartup: state.checkUpdateOnStartup,
    lastUpdateCheckTime: state.lastUpdateCheckTime,
    skipUpdateVersion: state.skipUpdateVersion,
  };
}

/**
 * 一次性迁移：从旧共享 key 提取编辑器字段到新独立 key
 * 仅在新 key 不存在且旧 key 存在时执行
 * 流程:
 *   1. 检测新 key 是否已有数据（已有则跳过，避免覆盖）
 *   2. 读取旧共享 key 的完整数据（包含编辑器与外观字段）
 *   3. 按字段白名单提取编辑器相关字段
 *   4. 写入新独立 key
 * 说明: 旧 key `novelforge-settings` 与 appearanceStore 共享，此处仅提取编辑器字段，不删除旧 key
 *       （appearanceStore 迁移时也会读取同一旧 key 提取外观字段）
 */
function migrateLegacyEditorSettings(): void {
  if (typeof localStorage === "undefined") return;
  try {
    // 新 key 已有数据，跳过迁移
    if (localStorage.getItem(STORAGE_KEY)) return;
    const oldRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!oldRaw) return;
    const parsed = JSON.parse(oldRaw) as Record<string, unknown>;
    const extracted: Record<string, unknown> = {};
    for (const key of EDITOR_DATA_KEYS) {
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
migrateLegacyEditorSettings();

/**
 * 应用字体大小到 DOM（CSS 变量注入）
 * 输入: size 字体大小（px）
 * 输出: 无（副作用：修改 document.documentElement.style）
 */
function applyFontSize(size: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--fandex-editor-font-size", `${size}px`);
}

// 创建编辑器设置 store，使用 persist 中间件自动持久化
// 泛型 <EditorSettingsState, [], [], EditorSettingsData> 分别指定完整状态类型、空 middleware mutators、持久化数据类型
export const useEditorSettingsStore = create<EditorSettingsState>()(
  persist<EditorSettingsState, [], [], EditorSettingsData>(
    (set, get) => ({
      ...DEFAULT_EDITOR_SETTINGS,

      setFontSize: (size): void => {
        const clamped = Math.max(12, Math.min(28, size));
        applyFontSize(clamped);
        set({ fontSize: clamped });
      },

      setAutoSaveInterval: (seconds): void => {
        const clamped = Math.max(0, Math.min(600, seconds));
        set({ autoSaveInterval: clamped });
      },

      setChapterFormat: (format): void => {
        set({ chapterFormat: format });
      },

      setAutoFillBookTitle: (enabled): void => {
        set({ autoFillBookTitle: enabled });
      },

      setAutoOutlineSkeleton: (enabled): void => {
        set({ autoOutlineSkeleton: enabled });
      },

      setAutoNumbering: (enabled): void => {
        set({ autoNumbering: enabled });
      },

      setAutoTemplateFill: (enabled): void => {
        set({ autoTemplateFill: enabled });
      },

      setIndentEnabled: (enabled): void => {
        set({ indentEnabled: enabled });
      },

      setIndentWidth: (width): void => {
        // 上限放宽至 8，既支持标准 1-4 全角空格快捷选择，也允许高级用户自定义更宽缩进
        const clamped = Math.max(1, Math.min(8, Math.floor(width)));
        set({ indentWidth: clamped });
      },

      setTypingSound: (enabled): void => {
        set({ typingSound: enabled });
      },

      setSessionWordTarget: (target): void => {
        const clamped = Math.max(0, Math.floor(target));
        set({ sessionWordTarget: clamped });
      },

      setSnapshotEnabled: (enabled): void => {
        set({ snapshotEnabled: enabled });
      },

      setSnapshotMinInterval: (seconds): void => {
        const clamped = Math.max(0, Math.min(3600, Math.floor(seconds)));
        set({ snapshotMinInterval: clamped });
      },

      setLastProjectPath: (path): void => {
        set({ lastProjectPath: path });
      },

      setCheckUpdateOnStartup: (enabled): void => {
        set({ checkUpdateOnStartup: enabled });
      },

      setLastUpdateCheckTime: (timestamp): void => {
        set({ lastUpdateCheckTime: timestamp });
      },

      setSkipUpdateVersion: (version): void => {
        set({ skipUpdateVersion: version });
      },

      initEditorSettings: (): void => {
        // persist 中间件已自动 rehydrate 状态，此处仅应用 DOM 副作用
        applyFontSize(get().fontSize);
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: SCHEMA_VERSION,
      partialize: (state) => pickEditorData(state),
      migrate: (persistedState, version) => {
        // 版本兼容处理：未知或格式异常的数据回退默认值
        // persistedState 类型由 zustand 库推断，此处用类型守卫保证安全
        if (version < SCHEMA_VERSION && persistedState && typeof persistedState === "object") {
          const data = persistedState as Partial<EditorSettingsData>;
          return { ...DEFAULT_EDITOR_SETTINGS, ...data };
        }
        return DEFAULT_EDITOR_SETTINGS;
      },
      onRehydrateStorage: () => (state) => {
        // rehydrate 完成后应用字号到 DOM
        if (state) {
          applyFontSize(state.fontSize);
        }
      },
    }
  )
);

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
