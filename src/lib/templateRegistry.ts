// 项目模板注册表 — 前端镜像 Rust project_template.rs 的类型专属目录
//
// 功能概述：
// 3 标准文体（Novel/Script/Essay）采用统一 5 一级目录结构，
// 不再有文体专属目录。本注册表提供按项目类型获取专属目录的函数，
// 当前所有标准文体均返回空数组，保留接口以便未来扩展。

/**
 * 各项目类型的专属目录
 * 3 标准文体(novel/script/essay)采用统一 5 一级目录结构，无专属目录
 */
const TYPE_SPECIFIC_DIRS: Record<string, string[]> = {
  novel: [],
  script: [],
  essay: [],
};

/**
 * 获取项目类型的专属目录列表
 * 输入: 项目类型字符串（来自 ProjectMeta.type）
 * 输出: 专属目录名数组（如未匹配则返回空数组）
 */
export function getTypeSpecificDirs(projectType: string): string[] {
  return TYPE_SPECIFIC_DIRS[projectType] ?? [];
}
