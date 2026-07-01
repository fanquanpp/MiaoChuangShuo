// 全局应用状态管理（领域拆分版）
//
// 功能概述：
// 使用 Zustand 管理应用全局状态，按领域拆分为三个切片：
// - ViewSlice: 视图模式与项目打开/关闭
// - CategorySlice: 分类选择与文件选中
// - ProjectSlice: 项目信息与目录树
// 通过组合切片保持单一 store 接口，对组件透明。
//
// 模块职责：
// 1. 组合领域切片为统一 store
// 2. 导出 CATEGORY_NAMES / CATEGORY_DIRS / CATEGORY_ICONS
// 3. 导出 useAppStore 供组件使用

import { create } from "zustand";
import type { ProjectSlice } from "./stores/projectSlice";
import { createProjectSlice } from "./stores/projectSlice";
import type { CategorySlice } from "./stores/categorySlice";
import { createCategorySlice } from "./stores/categorySlice";
import type { ViewSlice } from "./stores/viewSlice";
import { createViewSlice } from "./stores/viewSlice";

// 左侧导航分类枚举
export type SidebarCategory =
  | "manuscript"
  | "outline"
  | "codex"
  | "foreshadowing"
  | "volumes"
  | "stats"
  | "search";

// 分类中文名称
export const CATEGORY_NAMES: Record<SidebarCategory, string> = {
  manuscript: "正文",
  outline: "大纲",
  codex: "设定库",
  foreshadowing: "伏笔",
  volumes: "分卷",
  stats: "统计",
  search: "搜索",
};

// 分类对应目录名
export const CATEGORY_DIRS: Record<SidebarCategory, string> = {
  manuscript: "正文",
  outline: "大纲",
  codex: "",
  foreshadowing: "伏笔记录",
  volumes: "卷宗",
  stats: "",
  search: "",
};

// 分类图标名 (lucide-react)
export const CATEGORY_ICONS: Record<SidebarCategory, string> = {
  manuscript: "FileText",
  outline: "ListTree",
  codex: "Library",
  foreshadowing: "Eye",
  volumes: "BookOpen",
  stats: "BarChart3",
  search: "Search",
};

// 组合后的完整 App 状态类型
export type AppState = ViewSlice & CategorySlice & ProjectSlice;

// 创建组合 store
export const useAppStore = create<AppState>()((...args) => ({
  ...createViewSlice(...args),
  ...createCategorySlice(...args),
  ...createProjectSlice(...args),
}));

/**
 * 获取分类对应的目录名，动态分类（模板专属目录）回退为分类名本身。
 * 用于 FileList/Workspace 等组件按分类定位文件目录。
 */
export function getCategoryDir(category: string): string {
  return CATEGORY_DIRS[category as SidebarCategory] ?? category;
}

/**
 * 获取分类的显示名称，动态分类回退为分类名本身。
 */
export function getCategoryName(category: string): string {
  return CATEGORY_NAMES[category as SidebarCategory] ?? category;
}

// 重新导出 ViewMode 供外部使用
export type { ViewMode } from "./stores/viewSlice";
