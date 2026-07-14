// 喵创说 搜索与统计 API
//
// 模块职责：
// 1. 项目内全局搜索（searchInProject）与全局替换（replaceInProject）
// 2. 基于 Tantivy 的全文搜索（searchProject）
// 3. 写作统计（getWritingStats）
//
// 依赖：
// - @tauri-apps/api/core 的 invoke 调用 Rust 后端
// - ./indexApi 的 IndexStats 类型（TantivySearchResponse 引用）

import { invoke } from "@tauri-apps/api/core";
import type { IndexStats } from "./indexApi";

// ===== 搜索结果类型 =====

// 搜索结果项接口
export interface SearchResult {
  // 文件相对路径
  relative_path: string;
  // 文件名
  file_name: string;
  // 匹配行号(从1开始)
  line_number: number;
  // 匹配行内容
  line_content: string;
  // 匹配前上下文
  context_before: string;
  // 匹配后上下文
  context_after: string;
}

// 章节字数统计项接口
export interface ChapterWordCount {
  // 文件名
  file_name: string;
  // 相对路径
  relative_path: string;
  // 字数
  word_count: number;
}

// 写作统计信息接口
export interface WritingStats {
  // 总字数
  total_words: number;
  // 总章节数
  total_chapters: number;
  // 总文件数
  total_files: number;
  // 正文字数
  manuscript_words: number;
  // 设定文件字数
  setting_words: number;
  // 大纲字数
  outline_words: number;
  // 各章节字数列表
  chapter_words: ChapterWordCount[];
  // 项目创建天数
  days_since_creation: number;
}

// 单个文件替换结果项
export interface ReplaceFileResult {
  /** 相对路径 */
  relative_path: string;
  /** 文件名 */
  file_name: string;
  /** 替换次数 */
  replacements: number;
}

// 全局替换结果
export interface ReplaceResult {
  /** 修改的文件数 */
  files_modified: number;
  /** 总替换次数 */
  total_replacements: number;
  /** 各文件替换详情 */
  files: ReplaceFileResult[];
}

// ===== Tantivy 全文搜索类型 =====

// 搜索结果（单个 Chunk，与后端 SearchResult 对应）
export interface TantivySearchResult {
  // 文件相对路径（相对于项目根，含"正文/"前缀）
  file_path: string;
  // 文件名
  file_name: string;
  // Chunk 序号
  chunk_index: number;
  // 匹配的文本片段
  text: string;
  // 文件更新时间
  updated_at: string;
}

// 搜索请求参数（与后端 SearchRequest 对应）
// 注意：字段名使用 snake_case，与后端 Rust 结构体一致
export interface TantivySearchRequest {
  // 项目根路径（绝对路径）
  project_path: string;
  // 搜索关键词
  query: string;
  // 返回结果上限（默认 50）
  limit?: number;
}

// 搜索响应（与后端 SearchResponse 对应）
export interface TantivySearchResponse {
  // 查询关键词
  query: string;
  // 匹配结果总数
  total: number;
  // 匹配结果列表
  results: TantivySearchResult[];
  // 索引统计信息（便于前端判断是否需要重建索引）
  index_stats: IndexStats | null;
}

// ===== 搜索与统计 API 函数 =====

// 全局搜索项目内容
// 输入: projectPath 项目路径, query 搜索词, caseSensitive 区分大小写
// 输出: Promise<SearchResult[]> 搜索结果列表
// 流程: 调用 Rust 后端 search_in_project 命令
export async function searchInProject(
  projectPath: string,
  query: string,
  caseSensitive: boolean
): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search_in_project", {
    projectPath,
    query,
    caseSensitive,
  });
}

// 全局替换项目内容
// 输入:
//   projectPath 项目路径
//   query 查找词
//   replacement 替换字符串
//   caseSensitive 区分大小写
// 输出: Promise<ReplaceResult> 替换结果统计
// 流程: 调用 Rust 后端 replace_in_project 命令，递归遍历 .txt 文件执行替换
export async function replaceInProject(
  projectPath: string,
  query: string,
  replacement: string,
  caseSensitive: boolean
): Promise<ReplaceResult> {
  return invoke<ReplaceResult>("replace_in_project", {
    projectPath,
    query,
    replacement,
    caseSensitive,
  });
}

// 获取项目写作统计
// 输入: projectPath 项目路径
// 输出: Promise<WritingStats> 统计信息
// 流程: 调用 Rust 后端 get_writing_stats 命令
export async function getWritingStats(projectPath: string): Promise<WritingStats> {
  return invoke<WritingStats>("get_writing_stats", { projectPath });
}

// 全文搜索项目内容（基于 Tantivy 索引）
// 输入: request 搜索请求参数（项目路径、关键词、可选过滤条件）
// 输出: Promise<TantivySearchResponse> 搜索响应
// 流程: 调用 Rust 后端 search_project 命令执行 Tantivy 全文搜索
// 用途: 全局搜索面板、AI 上下文检索（RAG）
export async function searchProject(
  request: TantivySearchRequest
): Promise<TantivySearchResponse> {
  return invoke<TantivySearchResponse>("search_project", { request });
}
