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

// 项目类型枚举
export type ProjectType = "epic" | "standard" | "essay" | "script";

// 项目元数据接口
export interface ProjectMeta {
  name: string;
  type: string;
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

// 可用的项目模板列表
export const PROJECT_TEMPLATES: TemplateInfo[] = [
  { id: "epic", name: "西幻史诗", desc: "集成世界观宏观体系、势力编年史工具" },
  { id: "standard", name: "标准长篇", desc: "常规网文/大纲流架构，多卷轴深度目录" },
  { id: "essay", name: "散文随笔", desc: "侧重视觉留白，支持全自动双字首行缩进" },
  { id: "script", name: "舞台剧本", desc: "台词智能排版，人名预设一键浮动呼出" },
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

// 读取文件内容
// 输入: filePath 文件路径
// 输出: Promise<string> 文件内容
// 流程: 调用 Rust 后端 read_file 命令
export async function readFile(filePath: string): Promise<string> {
  return invoke<string>("read_file", { filePath });
}

// 写入文件内容
// 输入: filePath 文件路径, content 内容
// 输出: Promise<void>
// 流程: 调用 Rust 后端 write_file 命令
export async function writeFile(filePath: string, content: string): Promise<void> {
  return invoke<void>("write_file", { filePath, content });
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
  return invoke<string>("create_file", {
    projectPath,
    relativePath,
    content,
  });
}

// 删除文件或目录
// 输入: path 路径
// 输出: Promise<void>
// 流程: 调用 Rust 后端 delete_path 命令
export async function deletePath(path: string): Promise<void> {
  return invoke<void>("delete_path", { path });
}
