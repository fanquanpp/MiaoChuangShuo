// 通用格式化工具函数
//
// 功能概述：
// 提供项目卡片与启动器界面所需的通用格式化函数,包括字数、相对时间、日期格式化。
// 所有函数为纯函数,无副作用,翻译文案由调用方通过 t 函数注入,保持模块独立可测试。
//
// 模块职责:
// 1. formatWordCount: 字数格式化(万字单位切换)
// 2. formatTimeAgo: 相对时间格式化(刚刚/N 分钟前/N 小时前 等)
// 3. formatCreatedDate: 创建时间格式化为 YYYY-MM-DD

/**
 * 翻译函数类型,与 i18n.tsx 中的 TFunction 保持一致
 * 通过参数注入避免对 React Context 的耦合,保证本模块为纯函数
 */
export type FormatterTFunction = (
  key: string,
  params?: Record<string, string | number>
) => string;

/**
 * 格式化字数显示
 * 大于等于 1 万字时使用「万」单位,保留 1 位小数;否则显示原数字 + 单位
 *
 * 输入:
 *   n 原始字数
 *   t 翻译函数(用于获取「万字」「字」本地化文案)
 * 输出: 格式化后的字数字符串,如 "12.3 万字" 或 "1234 字"
 */
export function formatWordCount(
  n: number,
  t: FormatterTFunction
): string {
  if (n >= 10000) {
    return `${(n / 10000).toFixed(1)}${t("launcher.wanWords")}`;
  }
  return `${n}${t("launcher.wordUnit")}`;
}

/**
 * 格式化相对时间(多久以前)
 * 按分钟/小时/天/月/年逐级降级显示,符合中文阅读习惯
 *
 * 输入:
 *   ts ISO 8601 时间字符串
 *   t 翻译函数(用于获取「刚刚」「N 分钟前」等本地化文案)
 * 输出: 相对时间字符串,如 "刚刚"、"5 分钟前"、"3 天前"
 */
export function formatTimeAgo(
  ts: string,
  t: FormatterTFunction
): string {
  const now = Date.now();
  const diff = now - new Date(ts).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t("launcher.justNow");
  if (minutes < 60) return t("launcher.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("launcher.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("launcher.daysAgo", { n: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t("launcher.monthsAgo", { n: months });
  const years = Math.floor(months / 12);
  return t("launcher.yearsAgo", { n: years });
}

/**
 * 格式化创建时间为 YYYY-MM-DD 简洁日期格式
 * 用于项目卡片展示创建日期,与相对时间区分
 *
 * 输入:
 *   ts ISO 8601 时间字符串
 * 输出: YYYY-MM-DD 格式字符串,解析失败时返回空字符串
 */
export function formatCreatedDate(ts: string): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return "";
  }
}
