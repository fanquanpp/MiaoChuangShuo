// 喵创说 项目管理 API
//
// 模块职责：
// 1. 项目 CRUD（创建、扫描、导入、删除、更新元数据）
// 2. 自定义模板管理（列表、保存、删除）
// 3. 项目导入导出（打包为 .novelforge 压缩包、解包导入）
// 4. 角色联动（出场统计、全局改名、摘要读取）
// 5. 目录与文件选择对话框（pickDirectory/pickSaveFile/pickOpenArchive）
//
// 依赖：
// - @tauri-apps/api/core 的 invoke 调用 Rust 后端
// - @tauri-apps/plugin-dialog 的 save/open 弹出原生对话框

import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";

// ===== 项目基础类型 =====

// 项目文体类型（架构重构后 3 种标准文体）
// 旧版 8 种文体字符串透传到后端，由 StandardProjectType::from_str 自动映射
export type ProjectType = "novel" | "script" | "essay";

// 项目元数据接口
// Task 1.8: 新增 codexDirs/outlineDir/manuscriptDir/draftDir 字段统一目录扫描配置
export interface ProjectMeta {
  name: string;
  projectType: string;
  genre?: string;
  createdAt: string;
  updatedAt: string;
  version: string;
  author: string;
  description: string;
  wordCount: number;
  /** 设定库扫描目录列表(Task 1.8)
   * 旧项目反序列化时缺失此字段,前端视为空数组,后端扫描时回退到内置默认列表
   * 新建项目由后端填充默认 codex_dirs(8 个标准+兼容目录)
   */
  codexDirs?: string[];
  /** 大纲目录名(Task 1.8),默认 "大纲",缺失时由后端 #[serde(default)] 填充 */
  outlineDir?: string;
  /** 正文目录名(Task 1.8),默认 "正文",缺失时由后端 #[serde(default)] 填充 */
  manuscriptDir?: string;
  /** 草稿箱目录名(Task 1.8),默认 "草稿箱",缺失时由后端 #[serde(default)] 填充 */
  draftDir?: string;
}

// 项目信息接口(包含路径与元数据)
// Task 4.5.2: 移除 word_count 缓存字段,字数 SSOT 收敛到 WritingStats
// 前端获取字数时调用 getWritingStats(projectPath) 读取 WritingStats.total_words
export interface ProjectInfo {
  path: string;
  meta: ProjectMeta;
  // 正文章节总数
  chapter_count: number;
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

// ===== 项目 CRUD API =====

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

// 在项目所有支持文档中全局替换角色名(Task 4.6.2 升级为 UUID 关联优先)
// 输入:
//   projectPath 项目路径
//   oldName 旧角色名
//   newName 新角色名
//   codexId 设定库卡片 UUID(Task 4.6.2)
//     - 非空时优先通过 UUID 关联更新 characterMentionNode.attrs.name,避免子串误伤
//     - 为空时回退到字符串替换(词边界检测),仅作为兜底策略
// 输出: Promise<RenameResult> 修改文件数与替换次数
// 流程:
//   1. 后端按 ProjectMeta 配置扫描"设定/大纲/草稿箱/正文"目录
//   2. codexId 非空时,通过 manifest 反向索引找到引用章节,精确更新 Mention 节点
//   3. 对未通过 UUID 处理的文件,使用词边界检测的字符串替换作为回退
export async function renameCharacterInProject(
  projectPath: string,
  oldName: string,
  newName: string,
  codexId: string
): Promise<RenameResult> {
  return invoke<RenameResult>("rename_character_in_project", {
    projectPath,
    oldName,
    newName,
    codexId,
  });
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

// ===== TXT 导出 API (Task 3.3.1) =====

// TXT 导出模式
// single: 单章导出 / merged: 整项目合并 / per_chapter: 每章一个文件 / per_volume: 按分卷导出
export type TxtExportMode = "single" | "merged" | "per_chapter" | "per_volume";

// TXT 导出选项接口
// 与后端 TxtExportOptions 结构体一一对应（camelCase 序列化）
export interface TxtExportOptions {
  /** 导出模式 */
  mode: TxtExportMode;
  /** 是否在每章前插入标题行 */
  includeChapterTitle: boolean;
  /** 是否写入 UTF-8 BOM（Windows 记事本兼容） */
  bom: boolean;
  /** 是否使用 CRLF 换行符（Windows 风格） */
  crlf: boolean;
  /** 用户选择的导出目录绝对路径 */
  outputPath: string;
  /** 单章导出模式下的章节文件相对路径（相对项目根目录），仅 mode="single" 时使用 */
  chapterPath?: string;
}

// TXT 导出结果统计接口
// 与后端 TxtExportResult 结构体一一对应（camelCase 序列化）
// 注意：命名为 TxtExportResult 以避免与归档导出的 ExportResult 冲突
export interface TxtExportResult {
  /** 是否导出成功 */
  success: boolean;
  /** 生成的文件绝对路径列表 */
  files: string[];
  /** 导出的章节总数 */
  totalChapters: number;
  /** 导出的总字数 */
  totalWords: number;
  /** 结果消息（成功/失败描述） */
  message: string;
}

// 导出项目正文章节为 TXT 文件
// 输入:
//   projectPath 项目根目录绝对路径
//   options 导出选项（模式/标题/BOM/CRLF/输出目录/单章路径）
// 输出: Promise<TxtExportResult> 导出结果统计
// 流程: 调用 Rust 后端 export_project_to_txt 命令，按模式分派到对应的导出逻辑
export async function exportProjectToTxt(
  projectPath: string,
  options: TxtExportOptions
): Promise<TxtExportResult> {
  return invoke<TxtExportResult>("export_project_to_txt", {
    projectPath,
    options,
  });
}
