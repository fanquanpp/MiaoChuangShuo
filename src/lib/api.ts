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
export async function createProject(params: CreateProjectParams, customDirs?: string[]): Promise<string> {
  return invoke<string>("create_project", {
    name: params.name,
    typeStr: params.type_str,
    genre: params.genre,
    author: params.author,
    description: params.description,
    parentPath: params.parent_path,
    customDirs: customDirs || null,
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

// ===== 自定义模板 API =====

// 自定义模板接口
export interface CustomTemplate {
  id: string;
  name: string;
  description: string;
  directories: string[];
  created_at: string;
}

// 列出所有自定义模板
export async function listCustomTemplates(): Promise<CustomTemplate[]> {
  return invoke<CustomTemplate[]>("list_custom_templates");
}

// 保存自定义模板
export async function saveCustomTemplate(template: CustomTemplate): Promise<void> {
  return invoke<void>("save_custom_template", { template });
}

// 删除自定义模板
export async function deleteCustomTemplate(id: string): Promise<void> {
  return invoke<void>("delete_custom_template", { id });
}

// ===== 版本快照 API =====

// 快照元数据接口
export interface SnapshotMeta {
  // 快照时间戳（Unix 毫秒）
  timestamp: number;
  // 创建时间 ISO 8601
  created_at: string;
  // 字数
  word_count: number;
  // 文件大小（字节）
  size: number;
  // 触发方式（auto/manual/pre-restore）
  trigger: string;
}

// 快照列表项接口
export interface SnapshotInfo {
  // 快照元数据
  meta: SnapshotMeta;
  // 快照文件绝对路径
  snapshot_path: string;
  // 源文件相对路径
  source_relative_path: string;
}

// 快照统计接口
export interface SnapshotStats {
  // 快照总数
  total_snapshots: number;
  // 总字节数
  total_size: number;
  // 拥有快照的文件数
  files_with_snapshots: number;
}

// 创建文件快照
// 输入: filePath 源文件路径, projectPath 项目路径, content 内容, trigger 触发方式
// 输出: Promise<SnapshotMeta> 创建的快照元数据
export async function createSnapshot(
  filePath: string,
  projectPath: string,
  content: string,
  trigger: string
): Promise<SnapshotMeta> {
  validatePathInProject(filePath, projectPath);
  return invoke<SnapshotMeta>("create_snapshot", {
    filePath,
    projectPath,
    content,
    trigger,
  });
}

// 列出文件的所有快照
// 输入: filePath 源文件路径, projectPath 项目路径
// 输出: Promise<SnapshotInfo[]> 快照列表（按时间倒序）
export async function listSnapshots(
  filePath: string,
  projectPath: string
): Promise<SnapshotInfo[]> {
  validatePathInProject(filePath, projectPath);
  return invoke<SnapshotInfo[]>("list_snapshots", { filePath, projectPath });
}

// 读取快照内容
// 输入: snapshotPath 快照路径, projectPath 项目路径
// 输出: Promise<string> 快照内容
export async function readSnapshot(
  snapshotPath: string,
  projectPath: string
): Promise<string> {
  validatePathInProject(snapshotPath, projectPath);
  return invoke<string>("read_snapshot", { snapshotPath, projectPath });
}

// 恢复快照到源文件
// 输入: snapshotPath 快照路径, filePath 源文件路径, projectPath 项目路径
// 输出: Promise<void>
// 注意: 恢复前会自动为当前内容创建一个 "pre-restore" 快照，避免误操作丢失
export async function restoreSnapshot(
  snapshotPath: string,
  filePath: string,
  projectPath: string
): Promise<void> {
  validatePathInProject(snapshotPath, projectPath);
  validatePathInProject(filePath, projectPath);
  return invoke<void>("restore_snapshot", {
    snapshotPath,
    filePath,
    projectPath,
  });
}

// 删除单个快照
// 输入: snapshotPath 快照路径, timestamp 时间戳, filePath 源文件路径, projectPath 项目路径
// 输出: Promise<void>
export async function deleteSnapshot(
  snapshotPath: string,
  timestamp: number,
  filePath: string,
  projectPath: string
): Promise<void> {
  validatePathInProject(snapshotPath, projectPath);
  validatePathInProject(filePath, projectPath);
  return invoke<void>("delete_snapshot", {
    snapshotPath,
    timestamp,
    filePath,
    projectPath,
  });
}

// 清空文件的所有快照
// 输入: filePath 源文件路径, projectPath 项目路径
// 输出: Promise<number> 删除的快照数量
export async function clearSnapshots(
  filePath: string,
  projectPath: string
): Promise<number> {
  validatePathInProject(filePath, projectPath);
  return invoke<number>("clear_snapshots", { filePath, projectPath });
}

// 获取项目快照统计
// 输入: projectPath 项目路径
// 输出: Promise<SnapshotStats>
export async function getSnapshotStats(
  projectPath: string
): Promise<SnapshotStats> {
  return invoke<SnapshotStats>("get_snapshot_stats", { projectPath });
}

// ===== 角色联动 API =====

// 角色出场统计 - 单个文件维度
export interface CharacterAppearanceFile {
  // 相对项目根的路径
  path: string;
  // 该文件中出现次数
  count: number;
  // 是否位于正文目录
  is_manuscript: boolean;
}

// 角色出场统计 - 单个角色汇总
export interface CharacterAppearance {
  // 角色名
  name: string;
  // 总出现次数
  total_count: number;
  // 出现在的文件数
  file_count: number;
  // 出现的文件列表（按出现次数降序）
  files: CharacterAppearanceFile[];
}

// 全局改名结果
export interface RenameResult {
  // 修改的文件数
  files_modified: number;
  // 替换的总次数
  occurrences: number;
  // 修改的文件相对路径列表
  renamed_files: string[];
}

// 统计角色在项目所有 .txt 文件中的出场情况
// 输入: projectPath 项目路径, names 角色名列表
// 输出: Promise<CharacterAppearance[]> 每个角色的出场统计（按总次数降序）
export async function countCharacterAppearances(
  projectPath: string,
  names: string[]
): Promise<CharacterAppearance[]> {
  return invoke<CharacterAppearance[]>("count_character_appearances", {
    projectPath,
    names,
  });
}

// 在项目所有 .txt 文件中全局替换角色名
// 输入: projectPath 项目路径, oldName 旧角色名, newName 新角色名
// 输出: Promise<RenameResult> 修改文件数与替换次数
// 注意: 简单字符串替换，存在子串误伤风险，建议改名前先创建快照
export async function renameCharacterInProject(
  projectPath: string,
  oldName: string,
  newName: string
): Promise<RenameResult> {
  return invoke<RenameResult>("rename_character_in_project", {
    projectPath,
    oldName,
    newName,
  });
}
