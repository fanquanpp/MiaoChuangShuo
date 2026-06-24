// 全局应用状态管理
//
// 功能概述：
// 使用 Zustand 管理应用全局状态，包括当前打开的项目、视图切换、
// 选中的分类与文件等。作为 UI 层与 Service 层之间的状态桥梁。
//
// 模块职责：
// 1. 管理当前视图模式(launcher/workspace)
// 2. 管理当前打开的项目信息
// 3. 管理左侧导航选中的分类
// 4. 管理中间列表选中的文件

import { create } from "zustand";
import type { ProjectInfo, FileNode } from "./api";

// 视图模式枚举
export type ViewMode = "launcher" | "workspace";

// 左侧导航分类枚举
export type SidebarCategory =
  | "characters" // 角色
  | "worldview" // 世界观
  | "glossary" // 名词
  | "timeline" // 时间线
  | "manuscript" // 正文
  | "outline" // 大纲
  | "materials" // 素材
  | "stats" // 写作统计
  | "search"; // 全局搜索

// 分类中文名称映射
export const CATEGORY_NAMES: Record<SidebarCategory, string> = {
  characters: "角色",
  worldview: "世界观",
  glossary: "名词",
  timeline: "时间线",
  manuscript: "正文",
  outline: "大纲",
  materials: "素材",
  stats: "统计",
  search: "搜索",
};

// 分类对应的目录名(统计与搜索无对应目录,使用空字符串)
export const CATEGORY_DIRS: Record<SidebarCategory, string> = {
  characters: "角色",
  worldview: "世界观",
  glossary: "名词",
  timeline: "时间线",
  manuscript: "正文",
  outline: "大纲",
  materials: "素材",
  stats: "",
  search: "",
};

// 分类图标名(lucide-react)
export const CATEGORY_ICONS: Record<SidebarCategory, string> = {
  characters: "Users",
  worldview: "Globe",
  glossary: "BookMarked",
  timeline: "GitBranch",
  manuscript: "FileText",
  outline: "ListTree",
  materials: "FolderOpen",
  stats: "BarChart3",
  search: "Search",
};

// 应用状态接口
interface AppState {
  // 当前视图模式
  viewMode: ViewMode;
  // 当前打开的项目
  currentProject: ProjectInfo | null;
  // 当前选中的分类
  activeCategory: SidebarCategory;
  // 当前选中的文件节点
  selectedFile: FileNode | null;
  // 项目目录树
  projectTree: FileNode[];
  // 是否正在加载
  loading: boolean;

  // 设置视图模式
  setViewMode: (mode: ViewMode) => void;
  // 打开项目
  openProject: (project: ProjectInfo) => void;
  // 关闭项目，返回启动器
  closeProject: () => void;
  // 设置当前分类
  setActiveCategory: (category: SidebarCategory) => void;
  // 设置选中的文件
  setSelectedFile: (file: FileNode | null) => void;
  // 设置项目目录树
  setProjectTree: (tree: FileNode[]) => void;
  // 设置加载状态
  setLoading: (loading: boolean) => void;
}

// 创建全局状态 store
// 输入: 无
// 输出: Zustand store 实例
// 流程: 定义状态字段与操作方法
export const useAppStore = create<AppState>((set) => ({
  viewMode: "launcher",
  currentProject: null,
  activeCategory: "manuscript",
  selectedFile: null,
  projectTree: [],
  loading: false,

  setViewMode: (mode) => set({ viewMode: mode }),

  openProject: (project) =>
    set({
      currentProject: project,
      viewMode: "workspace",
      activeCategory: "manuscript",
      selectedFile: null,
    }),

  closeProject: () =>
    set({
      currentProject: null,
      viewMode: "launcher",
      selectedFile: null,
      projectTree: [],
    }),

  setActiveCategory: (category) =>
    set({ activeCategory: category, selectedFile: null }),

  setSelectedFile: (file) => set({ selectedFile: file }),

  setProjectTree: (tree) => set({ projectTree: tree }),

  setLoading: (loading) => set({ loading }),
}));
