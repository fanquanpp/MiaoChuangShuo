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
  /**
   * 待定位行号（搜索结果跳转时设置，编辑器加载后消费并清空）
   * 用于 GlobalSearch 跳转后自动滚动到匹配行
   */
  pendingScrollLine: number | null;

  setActiveCategory: (category: SidebarCategory) => void;
  setSelectedFile: (file: FileNode | null) => void;
  setActiveFileWordCount: (count: number) => void;
  /** 一次性设置分类和文件，避免 setActiveCategory 重置 selectedFile 的竞态 */
  navigateToFile: (file: FileNode, category: SidebarCategory) => void;
  /** 设置待定位行号（null 表示清除） */
  setPendingScrollLine: (line: number | null) => void;
}

export const createCategorySlice: StateCreator<CategorySlice> = (set) => ({
  activeCategory: "manuscript",
  selectedFile: null,
  activeFileWordCount: 0,
  pendingScrollLine: null,

  // P2-9 撕裂点修复: 切换分类时不再强制清空 selectedFile,
  // 保留用户已选中的文件上下文, 切回编辑器分类时无需重新选文件
  // 仅重置字数(等待编辑器重新推送)与待定位行号(切换分类后行号失效)
  setActiveCategory: (category): void =>
    set({ activeCategory: category, activeFileWordCount: 0, pendingScrollLine: null }),

  setSelectedFile: (file): void => set({ selectedFile: file, activeFileWordCount: 0, pendingScrollLine: null }),

  setActiveFileWordCount: (count): void => set({ activeFileWordCount: count }),

  navigateToFile: (file, category): void =>
    set({ activeCategory: category, selectedFile: file, activeFileWordCount: 0 }),

  setPendingScrollLine: (line): void => set({ pendingScrollLine: line }),
});
