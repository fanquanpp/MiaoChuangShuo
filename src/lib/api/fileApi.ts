// 喵创说 文件 IO API
//
// 模块职责：
// 封装项目内文件的读写、创建、删除、重命名、复制等 IO 操作。
// 所有文件操作均经过路径沙箱校验（validatePathInProject），
// 后端 Rust 也会做二次校验，形成双重防护。
//
// 依赖：
// - @tauri-apps/api/core 的 invoke 调用 Rust 后端
// - ./_internal 的 validatePathInProject 做路径前缀校验

import { invoke } from "@tauri-apps/api/core";
import { validatePathInProject } from "./_internal";

// 文件节点接口（用于目录树展示）
export interface FileNode {
  name: string;
  relative_path: string;
  is_dir: boolean;
  children: FileNode[];
  size: number;
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
