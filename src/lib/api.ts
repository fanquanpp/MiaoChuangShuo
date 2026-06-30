// NovelForge 后端 API 类型定义
//
// 功能概述：
// 定义与 Rust 后端交互的 TypeScript 类型与接口封装。
// 所有 Tauri 命令调用通过此模块统一管理。
//
// 模块职责：
// 1. 定义项目元数据类型
// 2. 定义文件节点类型
// 3. 封装 Tauri invoke 调用

import { invoke } from "@tauri-apps/api/core";

/**
 * 路径安全校验：确保文件路径在项目目录内
 * 防止目录遍历攻击的前端防护层（后端 Rust 也有校验）
 */
function validatePathInProject(filePath: string, projectPath: string): void {
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedProject = projectPath.replace(/\\/g, '/');
  if (!normalizedFile.startsWith(normalizedProject)) {
    throw new Error(`路径越界: 文件路径不在项目目录内`);
  }
}

// 项目文体类型（按文体体裁分类）
export type ProjectType =
  | "short_story"
  | "diary"
  | "dialogue"
  | "multi_volume"
  | "shared_world"
  | "screenplay"
  | "poetry"
  | "standard";

// 项目元数据接口
export interface ProjectMeta {
  name: string;
  type: string;
  genre?: string;
  created_at: string;
  updated_at: string;
  version: string;
  author: string;
  description: string;
  word_count: number;
}

// 项目信息接口(包含路径与元数据)
export interface ProjectInfo {
  path: string;
  meta: ProjectMeta;
  word_count: number;
  // 正文章节总数
  chapter_count: number;
}

// 文件节点接口
export interface FileNode {
  name: string;
  relative_path: string;
  is_dir: boolean;
  children: FileNode[];
  size: number;
}

// 创建项目参数
export interface CreateProjectParams {
  name: string;
  type_str: ProjectType;
  genre: string;
  author: string;
  description: string;
  parent_path: string;
}

// 项目模板信息
export interface TemplateInfo {
  id: ProjectType;
  name: string;
  desc: string;
}

// 可用的项目文体模板列表（按文体体裁分类）
export const PROJECT_TEMPLATES: TemplateInfo[] = [
  { id: "standard", name: "标准长篇", desc: "通用长篇小说架构，分卷管理、伏笔追踪、人物关系图" },
  { id: "short_story", name: "短篇小说", desc: "单篇精炼结构，灵感笔记与人物速写模板" },
  { id: "diary", name: "日记体", desc: "日期驱动叙事，心理轨迹追踪、日记模板" },
  { id: "dialogue", name: "对话体", desc: "对话推动叙事，角色声线设定、场景模板" },
  { id: "multi_volume", name: "长篇分卷", desc: "多卷深度架构，分卷大纲、卷间关联、伏笔跨卷追踪" },
  { id: "shared_world", name: "同世界观系列", desc: "多作品共享世界观，系列规划、跨作品伏笔、人物档案库" },
  { id: "screenplay", name: "剧本式", desc: "幕次结构叙事，场景设定、道具清单、分幕大纲" },
  { id: "poetry", name: "诗歌体", desc: "诗意叙事，诗稿模板、韵律笔记、意象集" },
];

// 小说题材列表（次级可选分类）
export const NOVEL_GENRES: string[] = [
  "",           // 不指定
  "玄幻",
  "仙侠",
  "武侠",
  "都市",
  "历史",
  "军事",
  "科幻",
  "悬疑",
  "言情",
  "奇幻",
  "现实",
  "同人",
  "游戏",
  "体育",
  "传记",
];

// ===== API 封装函数 =====

// 创建小说项目
// 输入: CreateProjectParams 参数对象
// 输出: Promise<string> 项目根目录路径
// 流程: 调用 Rust 后端 create_project 命令
export async function createProject(params: CreateProjectParams): Promise<string> {
  return invoke<string>("create_project", {
    name: params.name,
    typeStr: params.type_str,
    genre: params.genre,
    author: params.author,
    description: params.description,
    parentPath: params.parent_path,
  });
}

// 扫描项目列表
// 输入: parentPath 父目录路径
// 输出: Promise<ProjectInfo[]> 项目列表
// 流程: 调用 Rust 后端 scan_projects 命令
export async function scanProjects(parentPath: string): Promise<ProjectInfo[]> {
  return invoke<ProjectInfo[]>("scan_projects", { parentPath });
}

// 导入已有项目
// 输入: projectPath 项目路径
// 输出: Promise<ProjectInfo> 项目信息
// 流程: 调用 Rust 后端 import_project 命令
export async function importProject(projectPath: string): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("import_project", { projectPath });
}

// 删除项目（永久删除项目目录）
// 输入: projectPath 项目根目录路径
// 输出: Promise<void>
// 流程: 调用 Rust 后端 delete_project 命令（后端校验为有效项目后删除）
// 注意: 调用前应在 UI 层显示确认对话框
export async function deleteProject(projectPath: string): Promise<void> {
  return invoke<void>("delete_project", { projectPath });
}

// 打开目录选择对话框
// 输入: 无
// 输出: Promise<string | null> 选中目录路径
// 流程: 调用 Rust 后端 pick_directory 命令
export async function pickDirectory(): Promise<string | null> {
  const result = await invoke<string | null>("pick_directory");
  return result;
}

// 读取项目目录树
// 输入: projectPath 项目路径
// 输出: Promise<FileNode[]> 目录树
// 流程: 调用 Rust 后端 read_project_tree 命令
export async function readProjectTree(projectPath: string): Promise<FileNode[]> {
  return invoke<FileNode[]>("read_project_tree", { projectPath });
}

// 读取文件内容（含项目路径校验）
// 输入: filePath 文件绝对路径, projectPath 项目根路径用于沙箱校验
// 输出: Promise<string> 文件内容
// 流程: 调用 Rust 后端 read_file 命令（后端校验路径在项目内）
export async function readFile(filePath: string, projectPath: string): Promise<string> {
  validatePathInProject(filePath, projectPath);
  return invoke<string>("read_file", { filePath, projectPath });
}

// 写入文件内容（含项目路径校验）
// 输入: filePath 文件绝对路径, content 内容, projectPath 项目根路径
// 输出: Promise<void>
// 流程: 调用 Rust 后端 write_file 命令（后端校验路径并写入）
export async function writeFile(filePath: string, content: string, projectPath: string): Promise<void> {
  validatePathInProject(filePath, projectPath);
  return invoke<void>("write_file", { filePath, content, projectPath });
}

// 创建新文件
// 输入: projectPath 项目路径, relativePath 相对路径, content 内容
// 输出: Promise<string> 文件绝对路径
// 流程: 调用 Rust 后端 create_file 命令
export async function createFile(
  projectPath: string,
  relativePath: string,
  content: string
): Promise<string> {
  const sep = navigator.platform.toLowerCase().includes('win') ? '\\' : '/';
  const normalizedRel = relativePath.replace(/[\\/]/g, sep);
  validatePathInProject(`${projectPath}${sep}${normalizedRel}`, projectPath);
  return invoke<string>("create_file", {
    projectPath,
    relativePath: normalizedRel,
    content,
  });
}

// 删除文件或目录（含项目路径校验）
// 输入: path 文件/目录绝对路径, projectPath 项目根路径
// 输出: Promise<void>
// 流程: 调用 Rust 后端 delete_path 命令（后端校验路径后删除）
export async function deletePath(path: string, projectPath: string): Promise<void> {
  validatePathInProject(path, projectPath);
  return invoke<void>("delete_path", { path, projectPath });
}

// ===== 搜索与统计 API =====

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

// 获取项目写作统计
// 输入: projectPath 项目路径
// 输出: Promise<WritingStats> 统计信息
// 流程: 调用 Rust 后端 get_writing_stats 命令
export async function getWritingStats(projectPath: string): Promise<WritingStats> {
  return invoke<WritingStats>("get_writing_stats", { projectPath });
}

// 重命名文件/目录（跨平台路径归一化）
// 输入: projectPath 项目根路径, oldRelPath 原相对路径, newRelPath 新相对路径
// 输出: Promise<void>
// 流程: 拼接绝对路径后调用 Rust 后端 rename_path 命令
export async function renamePath(
  projectPath: string,
  oldRelPath: string,
  newRelPath: string
): Promise<void> {
  // 跨平台路径拼接：统一使用反斜杠（Windows）或正斜杠（Unix）
  // 关键：relativePath 可能含混合分隔符（来自后端），需先统一
  const sep = navigator.platform.toLowerCase().includes('win') ? '\\' : '/';
  const normalizeRel = (p: string) => p.replace(/[\\/]/g, sep);
  const oldAbs = `${projectPath}${sep}${normalizeRel(oldRelPath)}`;
  const newAbs = `${projectPath}${sep}${normalizeRel(newRelPath)}`;

  validatePathInProject(oldAbs, projectPath);
  validatePathInProject(newAbs, projectPath);

  return invoke<void>("rename_path", {
    oldPath: oldAbs,
    newPath: newAbs,
    projectPath: projectPath,
  });
}
