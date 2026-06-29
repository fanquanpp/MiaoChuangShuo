// 项目状态切片
//
// 管理当前打开项目信息、目录树、加载状态。
// refreshProjectTree 供编辑器保存后调用，刷新侧边栏文件大小等元数据。

import type { StateCreator } from "zustand";
import type { ProjectInfo, FileNode } from "../api";
import { readProjectTree } from "../api";

export interface ProjectSlice {
  currentProject: ProjectInfo | null;
  projectTree: FileNode[];
  loading: boolean;

  setProjectTree: (tree: FileNode[]) => void;
  setLoading: (loading: boolean) => void;
  /** 重新读取项目目录树（编辑器保存后触发，更新文件大小/修改时间） */
  refreshProjectTree: () => Promise<void>;
}

export const createProjectSlice: StateCreator<ProjectSlice> = (set, get) => ({
  currentProject: null,
  projectTree: [],
  loading: false,

  setProjectTree: (tree) => set({ projectTree: tree }),
  setLoading: (loading) => set({ loading }),

  refreshProjectTree: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      const tree = await readProjectTree(currentProject.path);
      set({ projectTree: tree });
    } catch {
      // 静默失败，避免干扰编辑体验
    }
  },
});
