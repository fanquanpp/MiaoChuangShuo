// 喵创说 后端 API 类型定义
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
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";

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

// 项目文体类型（架构重构后 3 种标准文体）
// 旧版 8 种文体字符串透传到后端，由 StandardProjectType::from_str 自动映射
export type ProjectType = "novel" | "script" | "essay";

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

// 可用的项目文体模板列表（3 种标准文体，对应 Rust StandardProjectType）
export const PROJECT_TEMPLATES: TemplateInfo[] = [
  { id: "novel", name: "长短篇小说", desc: "通用小说架构，统一目录结构、设定库" },
  { id: "script", name: "剧本与脚本", desc: "影视剧本、舞台剧本、对话体，角色名册与分幕大纲" },
  { id: "essay", name: "散文与文章", desc: "散文、随笔、诗歌、杂文，主题构思与意象集" },
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

// 更新项目元数据（编辑项目设定）
// 输入:
//   projectPath 项目根目录路径
//   name 项目名称
//   genre 题材（可为空字符串）
//   author 作者
//   description 描述
// 输出: Promise<ProjectInfo> 更新后的项目信息（含重新统计的字数与章节数）
// 流程: 调用 Rust 后端 update_project_meta 命令，原子写入元数据文件
// 注意: 仅更新元数据字段，不重命名项目目录；后端会自动刷新 updated_at 与字数统计
export async function updateProjectMeta(
  projectPath: string,
  name: string,
  genre: string,
  author: string,
  description: string
): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("update_project_meta", {
    projectPath,
    name,
    genre,
    author,
    description,
  });
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

// 复制文件到项目内新路径
// 输入: projectPath 项目路径, srcRelPath 源相对路径, destRelPath 目标相对路径
// 输出: Promise<string> 目标文件绝对路径
// 流程: 拼接绝对路径后调用 Rust 后端 copy_file 命令
export async function copyFile(
  projectPath: string,
  srcRelPath: string,
  destRelPath: string
): Promise<string> {
  const sep = navigator.platform.toLowerCase().includes('win') ? '\\' : '/';
  const normalizeRel = (p: string) => p.replace(/[\\/]/g, sep);
  const srcAbs = `${projectPath}${sep}${normalizeRel(srcRelPath)}`;
  const destAbs = `${projectPath}${sep}${normalizeRel(destRelPath)}`;
  return invoke<string>("copy_file", {
    srcPath: srcAbs,
    destPath: destAbs,
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

// 角色摘要信息接口（用于正文悬停卡片）
export interface CharacterSummary {
  // 角色名
  name: string;
  // 角色设定文件相对路径
  source_file: string;
  // 身份/职业
  identity: string;
  // 核心特质
  personality: string;
  // 一句话简介
  brief: string;
  // 是否找到角色设定文件
  found: boolean;
}

// 读取指定角色的摘要信息
// 输入: projectPath 项目路径, characterName 角色名
// 输出: Promise<CharacterSummary> 角色摘要（含身份、性格、简介）
// 流程: 调用 Rust 后端 read_character_summary 命令，扫描角色目录匹配首行
export async function readCharacterSummary(
  projectPath: string,
  characterName: string
): Promise<CharacterSummary> {
  return invoke<CharacterSummary>("read_character_summary", {
    projectPath,
    characterName,
  });
}

// ===== 项目导入导出 API =====

// 导出结果统计
export interface ExportResult {
  /** 输出文件绝对路径 */
  output_path: string;
  /** 打包文件数 */
  file_count: number;
  /** 原始总大小（字节） */
  total_size: number;
  /** 压缩后大小（字节） */
  output_size: number;
}

// 导入结果统计
export interface ImportResult {
  /** 解压目标目录绝对路径 */
  target_dir: string;
  /** 解压文件数 */
  file_count: number;
  /** 解压总大小（字节） */
  total_size: number;
  /** 推断的项目名（zip 内第一层目录名） */
  project_name: string;
}

// 将整个项目打包导出为 .novelforge 压缩包
// 输入:
//   projectPath 项目根路径
//   outputPath 输出文件路径（建议以 .novelforge 为扩展名）
// 输出: Promise<ExportResult> 导出结果统计
// 流程: 调用 Rust 后端 export_project，递归打包项目所有文件并写入元数据
export async function exportProject(
  projectPath: string,
  outputPath: string
): Promise<ExportResult> {
  return invoke<ExportResult>("export_project", {
    projectPath,
    outputPath,
  });
}

// 从 .novelforge 压缩包导入项目
// 输入:
//   archivePath 压缩包路径
//   targetDir 解压目标目录（项目将解压到此目录下）
// 输出: Promise<ImportResult> 导入结果统计
// 流程: 调用 Rust 后端 import_archive，解压 zip 并做路径穿越防护
export async function importArchive(
  archivePath: string,
  targetDir: string
): Promise<ImportResult> {
  return invoke<ImportResult>("import_archive", {
    archivePath,
    targetDir,
  });
}

// 弹出文件保存对话框（用于选择导出位置）
// 输入: defaultName 默认文件名（不含扩展名）
// 输出: Promise<string | null> 用户选择的路径或取消返回 null
// 流程: 调用 Tauri dialog 插件的 save 对话框
export async function pickSaveFile(defaultName: string): Promise<string | null> {
  const result = await saveDialog({
    defaultPath: defaultName,
    filters: [{ name: "喵创说 项目包", extensions: ["novelforge"] }],
  });
  return result ?? null;
}

// 弹出文件选择对话框（用于选择导入压缩包）
// 输出: Promise<string | null> 用户选择的路径或取消返回 null
// 流程: 调用 Tauri dialog 插件的 open 对话框
export async function pickOpenArchive(): Promise<string | null> {
  const result = await openDialog({
    multiple: false,
    filters: [{ name: "喵创说 项目包", extensions: ["novelforge", "zip"] }],
  });
  // open 返回 string | string[] | null，单选模式下为 string | null
  return typeof result === "string" ? result : null;
}

// ===== 全文索引与搜索（Tantivy + jieba 中文分词）=====
//
// 功能概述：
// 基于 Tantivy 全文索引引擎，提供项目级全文搜索能力。
// 支持中文分词（jieba）、异步索引构建、增量更新。
// 索引存储于 .novelforge/index/ 目录，与项目元数据隔离。
//
// 设计说明：
// - 所有索引操作通过 Tauri 命令调用 Rust 后端
// - 索引构建进度通过 "index-progress" 事件推送到前端

// 索引构建进度事件 payload（与后端 IndexProgress 对应）
export interface IndexProgress {
  // 已处理文件数
  processed: number;
  // 总文件数
  total: number;
  // 当前处理文件名
  current_file: string;
  // 进度百分比（0-100）
  percent: number;
  // 阶段：scan / index / commit / done / error
  stage: string;
}

// 索引统计信息（与后端 IndexStats 对应）
export interface IndexStats {
  // 索引文档总数（Chunk 粒度）
  doc_count: number;
  // 已索引文件数
  file_count: number;
  // 索引大小（字节）
  index_size: number;
  // 最后构建时间（ISO 8601）
  last_built_at: string;
}

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

// 索引构建进度事件名（与后端 INDEX_PROGRESS_EVENT 常量一致）
const INDEX_PROGRESS_EVENT = "index-progress";

// 全文搜索项目内容
// 输入: request 搜索请求参数（项目路径、关键词、可选过滤条件）
// 输出: Promise<TantivySearchResponse> 搜索响应
// 流程: 调用 Rust 后端 search_project 命令执行 Tantivy 全文搜索
// 用途: 全局搜索面板、AI 上下文检索（RAG）
export async function searchProject(
  request: TantivySearchRequest
): Promise<TantivySearchResponse> {
  return invoke<TantivySearchResponse>("search_project", { request });
}

// 异步构建项目全文索引（全量重建）
// 输入: projectPath 项目根路径
// 输出: Promise<IndexStats> 索引统计信息
// 流程: 调用 Rust 后端 build_project_index 命令，后端推送 index-progress 事件
// 注意: 调用前应通过 onIndexProgress 注册进度回调，事件可能在本函数返回前触发
export async function buildProjectIndex(projectPath: string): Promise<IndexStats> {
  return invoke<IndexStats>("build_project_index", { projectPath });
}

// 获取项目索引统计信息
// 输入: projectPath 项目根路径
// 输出: Promise<IndexStats> 索引统计
// 用途: 判断索引是否存在、是否需要重建
export async function getProjectIndexStats(projectPath: string): Promise<IndexStats> {
  return invoke<IndexStats>("get_project_index_stats", { projectPath });
}

// 增量更新单文件索引
// 输入: projectPath 项目根路径, relativePath 文件相对路径
// 输出: Promise<number> 写入的 Chunk 数量
// 流程: 调用 Rust 后端 update_file_index 命令，采用"先删后建"策略
// 用途: 文件保存后自动更新索引，避免全量重建
export async function updateFileIndex(
  projectPath: string,
  relativePath: string
): Promise<number> {
  return invoke<number>("update_file_index", { projectPath, relativePath });
}

// 删除单文件索引
// 输入: projectPath 项目根路径, relativePath 文件相对路径
// 输出: Promise<void>
// 用途: 文件删除后清理索引文档
export async function removeFileIndex(
  projectPath: string,
  relativePath: string
): Promise<void> {
  return invoke<void>("remove_file_index", { projectPath, relativePath });
}

// 注册索引构建进度事件监听器
// 输入: callback 进度回调函数
// 输出: Promise<UnlistenFn> 取消监听函数（组件卸载时调用以避免内存泄漏）
// 流程: 调用 Tauri event API 的 listen 函数订阅 index-progress 事件
// 用途: 在索引构建对话框中实时显示进度条与当前处理文件名
export async function onIndexProgress(
  callback: (progress: IndexProgress) => void
): Promise<UnlistenFn> {
  return listen<IndexProgress>(INDEX_PROGRESS_EVENT, (event) => {
    callback(event.payload);
  });
}

// ===== AI 上下文提取（AI-Ready 基础设施）=====
//
// 功能概述：
// 为 AI 功能（续写、推演、一致性校验）提供结构化上下文数据。
// 当前为接口定义阶段，后端返回 Mock 空数据，前端可 Mock 数据进行开发。
// 后续阶段 6 实现 RAG 检索与上下文组装。
//
// 设计说明：
// - 所有结构使用 camelCase 字段名（后端使用 #[serde(rename_all = "camelCase")]）
// - AI-Ready: SceneContext 的 povCharacterId 和 mood 为强类型化字段
// - 接口提前定义，确保 AI 功能上线时前端无需重构

// 角色简要信息（用于场景上下文中的出场角色列表）
export interface CharacterBrief {
  // 角色 ID（设定库 UUID）
  id: string;
  // 角色名称
  name: string;
  // 角色别名列表（AI-Ready: 用于实体识别匹配）
  aliases: string[];
  // 角色简介（一句话描述）
  summary: string;
}

// 设定简要信息（用于场景上下文中的相关设定引用）
export interface SettingBrief {
  // 设定 ID
  id: string;
  // 设定名称
  name: string;
  // 设定类型（角色/地点/物品/组织/概念）
  category: string;
  // 设定摘要
  summary: string;
}

// 场景上下文（AI 续写的核心数据）
// AI 价值：这是 AI 理解"剧情结构"的锚点
export interface SceneContext {
  // 场景 ID（关联 sceneBreak 节点 id）
  sceneId: string;
  // 场景标题
  sceneTitle: string;
  // AI-Ready: 视角角色 ID（强类型化，关联设定库 UUID）
  povCharacterId: string | null;
  // 视角角色名称（从设定库解析）
  povCharacterName: string | null;
  // AI-Ready: 氛围（强类型化，如"紧张"/"温馨"/"悲伤"）
  mood: string | null;
  // 场景所在章节
  chapter: string | null;
  // 前文摘要（最近 N 个 Chunk 的拼接，从 Tantivy 索引检索）
  precedingSummary: string;
  // 场景内出场角色列表（从设定库提取）
  presentCharacters: CharacterBrief[];
  // 相关设定引用（从设定库提取，如地点/物品/组织）
  relatedSettings: SettingBrief[];
  // AI-2 层1: 当前场景正文文本（从 .pmd ProseMirror JSON 提取的纯文本）
  currentSceneText: string;
}

// 角色出场记录
export interface AppearanceRecord {
  // 文件路径
  filePath: string;
  // 文件名
  fileName: string;
  // 出场文本片段（匹配的 Chunk 文本）
  excerpt: string;
  // AI-Ready: 场景 ID（关联 sceneBreak 节点）
  sceneId: string | null;
}

// 角色关系简要
export interface RelationshipBrief {
  // 目标角色 ID
  targetId: string;
  // 目标角色名称
  targetName: string;
  // 关系类型（朋友/敌人/师徒/恋人等）
  relationType: string;
  // 关系描述
  description: string;
}

// 角色上下文（AI 角色一致性校验的核心数据）
// AI 价值：避免"角色幻觉"（如把 A 的性格安在 B 身上）
export interface CharacterContext {
  // 角色 ID（设定库 UUID）
  characterId: string;
  // 角色名称
  name: string;
  // 角色别名列表
  aliases: string[];
  // 角色设定全文（从设定库读取）
  fullProfile: string;
  // 角色出场记录（从 Tantivy 索引检索，按时间倒序）
  appearanceRecords: AppearanceRecord[];
  // 角色关系列表（从人物关系图读取）
  relationships: RelationshipBrief[];
}

// 章节摘要
export interface ChapterSummary {
  // 章节名
  chapterName: string;
  // 文件路径
  filePath: string;
  // 摘要文本（前 200 字）
  summary: string;
  // 字数
  wordCount: number;
}

// 项目全局上下文（AI 大纲生成、剧情推演的核心数据）
// AI 价值：提供全局视角的项目信息
export interface ProjectContext {
  // 项目名称
  projectName: string;
  // 项目类型（novel/script/essay）
  projectType: string;
  // 项目描述
  description: string;
  // 主要角色列表（从设定库提取，按重要度排序）
  mainCharacters: CharacterBrief[];
  // 主要设定列表（从设定库提取，如世界观/地点/组织）
  keySettings: SettingBrief[];
  // 已完成章节摘要（从 Tantivy 索引检索，前 200 字）
  chapterSummaries: ChapterSummary[];
  // 总字数
  totalWords: number;
  // 章节数
  chapterCount: number;
}

// 场景上下文请求参数（AI-2 前端调用入口）
// 字段说明:
//   - projectPath: 项目根路径
//   - chapterId: 章节标识（文件相对路径，如 "正文/第一章.pmd"）
//   - sceneIndex: 场景索引（0-based，由 getCurrentSceneLocation 计算）
export interface SceneContextRequest {
  projectPath: string;
  chapterId: string;
  sceneIndex: number;
}

// 获取场景上下文（AI-2 四层上下文组装）
// 输入: req 场景上下文请求（项目路径 + 章节 ID + 场景索引）
// 输出: Promise<SceneContext> 场景上下文（含 4 层数据）
// 用途: AI 续写时提供当前场景正文/出场角色/前文摘要
// 实现状态: AI-2 已实现后端 4 层组装（读取 .pmd + 设定库）
export async function getSceneContext(
  req: SceneContextRequest
): Promise<SceneContext> {
  return invoke<SceneContext>("get_scene_context", { req });
}

// 获取角色上下文
// 输入: projectPath 项目根路径, characterId 角色 ID
// 输出: Promise<CharacterContext> 角色上下文
// 用途: AI 角色一致性校验，提供角色设定全文与出场记录
// 当前状态: 后端返回 Mock 空数据，前端可 Mock 数据进行开发
export async function getCharacterContext(
  projectPath: string,
  characterId: string
): Promise<CharacterContext> {
  return invoke<CharacterContext>("get_character_context", { projectPath, characterId });
}

// 获取项目全局上下文
// 输入: projectPath 项目根路径
// 输出: Promise<ProjectContext> 项目上下文
// 用途: AI 大纲生成、剧情推演，提供全局视角的项目信息
// 当前状态: 后端返回 Mock 空数据，前端可 Mock 数据进行开发
export async function getProjectContext(
  projectPath: string
): Promise<ProjectContext> {
  return invoke<ProjectContext>("get_project_context", { projectPath });
}
