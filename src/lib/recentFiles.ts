// 最近文件追踪工具
//
// 功能概述：
// 基于 localStorage 记录用户最近打开的文件，
// 支持添加、获取、清空操作。最多保留 20 条。
//
// 模块职责：
// 1. addRecentFile: 记录最近打开的文件
// 2. getRecentFiles: 获取最近文件列表
// 3. clearRecentFiles: 清空记录

export interface RecentFile {
  name: string;
  relative_path: string;
  project_name: string;
  project_path: string;
  opened_at: number; // Unix 时间戳 ms
}

const STORAGE_KEY = "novelforge-recent-files";
const MAX_ITEMS = 20;

function loadAll(): RecentFile[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAll(files: RecentFile[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
}

// 添加文件到最近列表（自动去重：同一路径只保留最新一条）
export function addRecentFile(file: Omit<RecentFile, "opened_at">): void {
  const all = loadAll();
  const filtered = all.filter((f) => f.relative_path !== file.relative_path || f.project_path !== file.project_path);
  filtered.unshift({ ...file, opened_at: Date.now() });
  saveAll(filtered.slice(0, MAX_ITEMS));
}

// 获取最近文件列表（项目过滤可选）
export function getRecentFiles(projectPath?: string): RecentFile[] {
  const all = loadAll();
  if (projectPath) return all.filter((f) => f.project_path === projectPath);
  return all;
}

// 清空全部记录
export function clearRecentFiles(): void {
  saveAll([]);
}
