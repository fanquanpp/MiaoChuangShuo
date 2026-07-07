// 文件目录树公共工具函数
//
// 功能概述：
// 提供项目目录树的通用查找与路径拼接函数，消除 FileList / CardManager /
// WritingStats 等组件中的重复代码。
//
// 模块职责：
// 1. 按目录名递归查找目录节点
// 2. 按相对路径查找文件节点
// 3. 项目路径与相对路径拼接

import type { FileNode } from "./api";

// 按目录名递归查找目录节点
// 输入: tree 目录树, name 目标目录名
// 输出: FileNode | null
export function findDirByName(tree: FileNode[], name: string): FileNode | null {
  for (const node of tree) {
    if (node.name === name && node.is_dir) return node;
    if (node.is_dir && node.children.length > 0) {
      const found = findDirByName(node.children, name);
      if (found) return found;
    }
  }
  return null;
}

// 按相对路径查找文件节点（路径分隔符归一化匹配）
// 输入: tree 目录树, relativePath 相对路径（可含 / 或 \）
// 输出: FileNode | null
export function findFileByPath(
  tree: FileNode[],
  relativePath: string
): FileNode | null {
  const normalizedTarget = relativePath.replace(/\\/g, "/");
  for (const node of tree) {
    const normalizedNode = node.relative_path.replace(/\\/g, "/");
    if (normalizedNode === normalizedTarget && !node.is_dir) return node;
    if (node.is_dir && node.children.length > 0) {
      const found = findFileByPath(node.children, relativePath);
      if (found) return found;
    }
  }
  return null;
}

// 拼接项目路径与相对路径为绝对路径（跨平台）
// 输入: projectPath 项目根路径, relativePath 相对路径
// 输出: 绝对路径字符串（正斜杠，Rust PathBuf 自动适配）
export function getAbsolutePath(
  projectPath: string,
  relativePath: string
): string {
  return `${projectPath}/${relativePath}`;
}

// 从路径中提取文件名
// 输入: filePath 文件路径
// 输出: 文件名(含扩展名)
export function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

// 去掉文件扩展名（仅 .txt）
// 输入: fileName 文件名
// 输出: 无扩展名的标题
export function stripExtension(fileName: string): string {
  return fileName.replace(/\.txt$/i, "");
}

// 检测文件名是否合法(不含 Windows 非法字符)
// 输入: fileName 文件名
// 输出: 是否合法
export function isValidFileName(fileName: string): boolean {
  return !/[<>:"/\\|?*]/.test(fileName);
}

/**
 * 从文件名中提取章节序号，用于正文文件自动排序
 * 排序规则：
 *   - 序章/楔子/引子/前言/引言/卷首语 → 排在最前面（返回 -2）
 *   - 正文章节（第N章/Chapter N/N.标题） → 按序号升序
 *   - 续章/尾声/后记/番外/终章/卷尾语 → 排在最后（返回 Infinity）
 *   - 未识别章节 → 排在最后（返回 Infinity），避免被误排到首位
 * 兼容 .txt 与 .pmd 扩展名，避免设定文件等带扩展名文件被误排序
 *
 * 输入: name 文件名（可能含 .txt 或 .pmd 扩展名）
 * 输出: 章节排序权重数值（-2 最前 / 正数章节号 / Infinity 最后）
 */
export function extractChapterNumber(name: string): number {
  // 去除扩展名后的小写基准名，用于关键词匹配（兼容 .txt 与 .pmd）
  const base = name.replace(/\.(txt|pmd)$/i, "").trim().toLowerCase();
  // 序章类与卷首语前置于所有章节之前
  const prologueKeywords = ["序章", "楔子", "引子", "前言", "引言", "卷首语", "prologue", "preface"];
  if (prologueKeywords.some((kw) => base === kw || base.startsWith(kw))) {
    return -2;
  }
  // 续章/尾声/后记/番外/终章/卷尾语 排在所有正文章节之后
  const epilogueKeywords = ["续章", "尾声", "后记", "番外", "终章", "卷尾语", "epilogue", "afterword"];
  if (epilogueKeywords.some((kw) => base === kw || base.startsWith(kw))) {
    return Infinity;
  }
  const patterns = [
    /第(\d+)章/,
    /第(\d+)节/,
    /第(\d+)回/,
    /[Cc]hapter\s*(\d+)/,
    /^(\d+)[._\-]/,
  ];
  for (const p of patterns) {
    const m = name.match(p);
    if (m) return parseInt(m[1], 10);
  }
  return Infinity;
}
