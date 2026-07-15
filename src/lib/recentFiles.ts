// 最近文件追踪工具
//
// 功能概述：
// 基于 zustand persist 中间件记录用户最近打开的文件，支持添加、获取、清空操作，最多保留 20 条。
// 内部使用 Zustand store + persist 中间件实现 localStorage 自动持久化，
// 对外保留原有的独立函数 API（addRecentFile / getRecentFiles / clearRecentFiles），保证向后兼容。
//
// 模块职责：
// 1. addRecentFile: 记录最近打开的文件（自动去重，同路径仅保留最新一条）
// 2. getRecentFiles: 获取最近文件列表（支持按项目路径过滤）
// 3. clearRecentFiles: 清空全部记录
//
// 设计说明：
// - 采用 zustand persist 中间件，替代原手工 localStorage 读写
// - STORAGE_KEY 改为 `miaochuangshuo-recent-files`（原为 `novelforge-recent-files`）
// - 模块顶层执行一次性迁移：从旧 key 读取 JSON 数组数据，转为 persist 的 JSON 格式写入新 key
// - 对外暴露独立函数（非 hook），内部通过 store.getState() 操作，兼容现有调用方

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// 最近文件信息接口
export interface RecentFile {
  name: string;
  relative_path: string;
  project_name: string;
  project_path: string;
  opened_at: number; // Unix 时间戳 ms
}

// 独立 localStorage 键
const STORAGE_KEY = "miaochuangshuo-recent-files";
// 旧 localStorage 键（用于一次性迁移）
const LEGACY_STORAGE_KEY = "novelforge-recent-files";
// 当前 schema 版本（用于未来字段变更时的迁移）
const SCHEMA_VERSION = 1;
// 最大保留条数
const MAX_ITEMS = 20;

// 最近文件持久化数据接口
interface RecentFilesPersistedData {
  files: RecentFile[];
}

// 最近文件状态接口（含 Actions）
interface RecentFilesState {
  /** 最近文件列表 */
  files: RecentFile[];
  /** 添加文件到最近列表（内部：去重 + 限制数量 + 持久化） */
  addFile: (file: Omit<RecentFile, "opened_at">) => void;
  /** 清空全部记录 */
  clear: () => void;
}

/**
 * 一次性迁移：从旧 key 读取 JSON 数组数据，转为 persist 的 JSON 格式写入新 key
 * 仅在新 key 不存在且旧 key 存在时执行
 * 流程:
 *   1. 检测新 key 是否已有数据（已有则跳过，避免覆盖）
 *   2. 读取旧 key 的 JSON 数据（RecentFile[] 数组格式）
 *   3. 构造 persist 标准格式 { state: { files: [...] }, version } 写入新 key
 * 说明: 旧数据为纯 JSON 数组，需转为 persist 内部格式
 */
function migrateLegacyRecentFiles(): void {
  if (typeof localStorage === "undefined") return;
  try {
    // 新 key 已有数据，跳过迁移
    if (localStorage.getItem(STORAGE_KEY)) return;
    const oldRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!oldRaw) return;
    const parsed = JSON.parse(oldRaw);
    // 校验旧数据为数组格式
    if (Array.isArray(parsed)) {
      // 构造 persist 标准 JSON 格式
      const newData = JSON.stringify({ state: { files: parsed }, version: SCHEMA_VERSION });
      localStorage.setItem(STORAGE_KEY, newData);
    }
  } catch {
    // 迁移失败静默处理，persist 将使用默认值
  }
}

// 模块顶层执行迁移（store 创建前立即执行，非 React 组件内）
migrateLegacyRecentFiles();

// 内部 store：使用 persist 中间件自动持久化
// 泛型 <RecentFilesState, [], [], RecentFilesPersistedData> 分别指定完整状态类型、空 middleware mutators、持久化数据类型
const useRecentFilesStore = create<RecentFilesState>()(
  persist<RecentFilesState, [], [], RecentFilesPersistedData>(
    (set) => ({
      files: [],

      addFile: (file): void => {
        set((state) => {
          // 去重：同一路径（相对路径 + 项目路径）仅保留最新一条
          const filtered = state.files.filter(
            (f) => f.relative_path !== file.relative_path || f.project_path !== file.project_path
          );
          // 新文件插入头部，限制最大条数
          const next = [{ ...file, opened_at: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
          return { files: next };
        });
      },

      clear: (): void => {
        set({ files: [] });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: SCHEMA_VERSION,
      partialize: (state) => ({ files: state.files }),
      migrate: (persistedState, version) => {
        // 版本兼容处理：未知或格式异常的数据回退默认值
        if (version < SCHEMA_VERSION && persistedState && typeof persistedState === "object") {
          const data = persistedState as Partial<RecentFilesPersistedData>;
          if (Array.isArray(data.files)) {
            return { files: data.files };
          }
        }
        return { files: [] };
      },
    }
  )
);

/**
 * 添加文件到最近列表（对外 API，自动去重：同一路径只保留最新一条）
 * 输入: file 文件信息（不含 opened_at，由内部生成）
 * 输出: 无
 * 流程: 委托内部 store 的 addFile action 执行去重、插入与持久化
 */
export function addRecentFile(file: Omit<RecentFile, "opened_at">): void {
  useRecentFilesStore.getState().addFile(file);
}

/**
 * 获取最近文件列表（对外 API，项目过滤可选）
 * 输入: projectPath 项目路径（可选，提供时仅返回该项目的文件）
 * 输出: RecentFile[] 最近文件列表
 * 流程: 从内部 store 读取，按项目路径过滤
 */
export function getRecentFiles(projectPath?: string): RecentFile[] {
  const { files } = useRecentFilesStore.getState();
  if (projectPath) return files.filter((f) => f.project_path === projectPath);
  return files;
}

/**
 * 清空全部记录（对外 API）
 * 输入: 无
 * 输出: 无
 * 流程: 委托内部 store 的 clear action 执行清空与持久化
 */
export function clearRecentFiles(): void {
  useRecentFilesStore.getState().clear();
}
