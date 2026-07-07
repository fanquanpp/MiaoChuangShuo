// 项目文体类型统一工具层
//
// 功能概述：
// 喵创说 采用 3 标准文体（novel/script/essay），配合统一 5 一级目录结构。
// 本模块集中提供文体判断函数，消除重复并保证一致性。
//
// 模块职责：
// 1. normalizeProjectType: 将类型字符串归一化到 3 标准文体之一
// 2. isNovelType / isScriptType / isEssayType: 三大文体族判断
// 3. isChapterNumberedType: 是否启用章节自动编号（小说族启用，剧本/散文关闭）

/**
 * 3 标准文体常量
 */
export const STANDARD_TYPES = ["novel", "script", "essay"] as const;
export type StandardProjectType = (typeof STANDARD_TYPES)[number];

/**
 * 将任意项目类型字符串归一化为 3 标准文体之一
 * 输入: rawType 项目元数据中的 type 字符串
 * 输出: StandardProjectType 归一化后的标准文体（novel/script/essay）
 * 流程:
 *   1. 空值或未知类型默认归为 novel（最通用场景）
 *   2. 匹配 3 标准文体字符串
 *   3. 仍未命中则返回 novel
 */
export function normalizeProjectType(rawType: string | undefined | null): StandardProjectType {
  if (!rawType) return "novel";
  switch (rawType) {
    case "novel":
      return "novel";
    case "script":
      return "script";
    case "essay":
      return "essay";
    default:
      return "novel";
  }
}

/**
 * 判断是否为小说族文体（用于章节自动编号等场景）
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
 * 判断是否为散文族文体
 * 输入: rawType 项目类型字符串
 * 输出: boolean 是否为散文族
 */
export function isEssayType(rawType: string | undefined | null): boolean {
  return normalizeProjectType(rawType) === "essay";
}

/**
 * 判断是否启用章节自动编号
 * 输入: rawType 项目类型字符串
 * 输出: boolean 是否启用章节自动编号
 * 流程: 仅小说族启用，剧本/散文不生成章节号
 */
export function isChapterNumberedType(rawType: string | undefined | null): boolean {
  return isNovelType(rawType);
}
