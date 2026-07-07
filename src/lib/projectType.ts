// 项目文体类型统一兼容层
//
// 功能概述：
// 新版采用 3 标准文体（novel/script/essay），旧版存在 8 文体 + 5 题材共 13 种字符串。
// 各模块（Workspace/Sidebar/NovelEditor/VolumeManager/Launcher）原本各自维护兼容判断，
// 导致 isNovelType 等逻辑在多处重复，且新增类型时易遗漏。
// 本模块集中提供归一化与判断函数，消除重复并保证一致性。
//
// 模块职责：
// 1. normalizeProjectType: 将旧版字符串归一化到新版 3 标准文体之一（保留原值用于展示）
// 2. isNovelType / isScriptType / isEssayType: 三大文体族判断
// 3. isMultiVolumeLike: 是否为分卷类文体（决定侧边栏分卷入口与卷管理器显示）
// 4. isChapterNumberedType: 是否启用章节自动编号（小说族启用，剧本/对话/散文/诗歌关闭）

/**
 * 新版 3 标准文体常量
 */
export const STANDARD_TYPES = ["novel", "script", "essay"] as const;
export type StandardProjectType = (typeof STANDARD_TYPES)[number];

/**
 * 旧版文体 → 新版文体的归一化映射
 * - 小说族（standard/short_story/multi_volume/shared_world）→ novel
 * - 剧本族（screenplay）→ script
 * - 散文族（diary/dialogue/poetry）→ essay
 * - 题材类（epic/wuxia/scifi/mystery/romance）本质仍属小说族 → novel
 *
 * 注：归一化仅用于功能行为判断（是否分卷、是否自动编号、扩展注册等），
 * 项目卡片展示仍使用原始 meta.type 字符串以保留历史信息。
 */
const LEGACY_TYPE_MAP: Record<string, StandardProjectType> = {
  // 新版 3 标准文体（自映射）
  novel: "novel",
  script: "script",
  essay: "essay",

  // 旧版小说族 → novel
  standard: "novel",
  short_story: "novel",
  multi_volume: "novel",
  shared_world: "novel",

  // 旧版题材类（均为小说变体）→ novel
  epic: "novel",
  wuxia: "novel",
  scifi: "novel",
  mystery: "novel",
  romance: "novel",

  // 旧版剧本族 → script
  screenplay: "script",

  // 旧版散文族 → essay
  diary: "essay",
  dialogue: "essay",
  poetry: "essay",
};

/**
 * 兼容旧版 Rust 后端 format!("{:?}").to_lowercase() 产生的无下划线格式
 * 仅出现在极早期版本的项目元数据中，归一化时一并处理
 */
const LEGACY_UNSCORED_MAP: Record<string, StandardProjectType> = {
  shortstory: "novel",
  multivolume: "novel",
  sharedworld: "novel",
};

/**
 * 将任意项目类型字符串归一化为新版 3 标准文体之一
 * 输入: rawType 项目元数据中的 type 字符串（可能为新版或旧版）
 * 输出: StandardProjectType 归一化后的标准文体（novel/script/essay）
 * 流程:
 *   1. 空值或未知类型默认归为 novel（最通用场景）
 *   2. 优先查 LEGACY_TYPE_MAP（含下划线版本）
 *   3. 兜底查 LEGACY_UNSCORED_MAP（无下划线版本）
 *   4. 仍未命中则返回 novel
 */
export function normalizeProjectType(rawType: string | undefined | null): StandardProjectType {
  if (!rawType) return "novel";
  const mapped = LEGACY_TYPE_MAP[rawType];
  if (mapped) return mapped;
  const lower = rawType.toLowerCase();
  const unscored = LEGACY_UNSCORED_MAP[lower];
  if (unscored) return unscored;
  return "novel";
}

/**
 * 判断是否为小说族文体（用于章节自动编号、分卷管理等场景）
 * 输入: rawType 项目类型字符串
 * 输出: boolean 是否为小说族
 * 流程: 归一化后判断是否为 novel
 */
export function isNovelType(rawType: string | undefined | null): boolean {
  return normalizeProjectType(rawType) === "novel";
}

/**
 * 判断是否为剧本族文体
 * 输入: rawType 项目类型字符串
 * 输出: boolean 是否为剧本族
 */
export function isScriptType(rawType: string | undefined | null): boolean {
  return normalizeProjectType(rawType) === "script";
}

/**
 * 判断是否为散文族文体（含日记/对话/诗歌等旧版变体）
 * 输入: rawType 项目类型字符串
 * 输出: boolean 是否为散文族
 */
export function isEssayType(rawType: string | undefined | null): boolean {
  return normalizeProjectType(rawType) === "essay";
}

/**
 * 判断是否为分卷类文体（决定侧边栏分卷入口与卷管理器显示）
 * 输入: rawType 项目类型字符串
 * 输出: boolean 是否为分卷类
 * 流程:
 *   - 新版 novel → true
 *   - 旧版 multi_volume / shared_world / standard → true
 *   - 其他 → false
 */
export function isMultiVolumeLike(rawType: string | undefined | null): boolean {
  if (!rawType) return false;
  return (
    rawType === "novel" ||
    rawType === "multi_volume" ||
    rawType === "shared_world" ||
    rawType === "standard"
  );
}

/**
 * 判断是否启用章节自动编号
 * 输入: rawType 项目类型字符串
 * 输出: boolean 是否启用章节自动编号
 * 流程: 仅小说族启用，剧本/对话/散文/诗歌等不生成章节号
 */
export function isChapterNumberedType(rawType: string | undefined | null): boolean {
  return isNovelType(rawType);
}
