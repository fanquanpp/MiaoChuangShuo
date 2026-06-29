// 分类与文件选择状态切片
//
// 管理侧边栏分类导航、当前选中文件，以及编辑器实时推送的字数统计。
// setActiveCategory 切换分类时重置 selectedFile 和字数；
// setSelectedFile 切换文件时重置字数，等待编辑器重新推送。

import type { StateCreator } from "zustand";
import type { FileNode } from "../api";
import type { SidebarCategory } from "./types";

export interface CategorySlice {
  activeCategory: SidebarCategory;
  selectedFile: FileNode | null;
  /** 当前编辑文件的实时字数（由编辑器 onUpdate 推送） */
  activeFileWordCount: number;

  setActiveCategory: (category: SidebarCategory) => void;
  setSelectedFile: (file: FileNode | null) => void;
  setActiveFileWordCount: (count: number) => void;
  /** 一次性设置分类和文件，避免 setActiveCategory 重置 selectedFile 的竞态 */
  navigateToFile: (file: FileNode, category: SidebarCategory) => void;
}

export const createCategorySlice: StateCreator<CategorySlice> = (set) => ({
  activeCategory: "manuscript",
  selectedFile: null,
  activeFileWordCount: 0,

  setActiveCategory: (category) =>
    set({ activeCategory: category, selectedFile: null, activeFileWordCount: 0 }),

  setSelectedFile: (file) => set({ selectedFile: file, activeFileWordCount: 0 }),

  setActiveFileWordCount: (count) => set({ activeFileWordCount: count }),

  navigateToFile: (file, category) =>
    set({ activeCategory: category, selectedFile: file, activeFileWordCount: 0 }),
});
