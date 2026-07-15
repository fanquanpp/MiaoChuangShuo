// 分类与文件选择状态切片
//
// 管理侧边栏分类导航、当前选中文件。
// Task 4.5.1: 删除 activeFileWordCount 缓存,字数统计改为以 WritingStats 为 SSOT:
//   - 编辑器内部字数显示由 NovelEditor 本地 state 维护(基于 countWords 实时计算)
//   - 文件列表节点不再显示字数(避免与 WritingStats 数据冗余)
//   - 项目级字数从 WritingStats.total_words 派生
// setActiveCategory 切换分类时重置 selectedFile;
// setSelectedFile 切换文件时清空待定位行号。

import type { StateCreator } from "zustand";
import type { FileNode } from "../api";
import type { SidebarCategory } from "./types";

export interface CategorySlice {
  activeCategory: SidebarCategory;
  selectedFile: FileNode | null;
  /**
   * 待定位行号（搜索结果跳转时设置，编辑器加载后消费并清空）
   * 用于 GlobalSearch 跳转后自动滚动到匹配行
   */
  pendingScrollLine: number | null;

  setActiveCategory: (category: SidebarCategory) => void;
  setSelectedFile: (file: FileNode | null) => void;
  /** 一次性设置分类和文件，避免 setActiveCategory 重置 selectedFile 的竞态 */
  navigateToFile: (file: FileNode, category: SidebarCategory) => void;
  /** 设置待定位行号（null 表示清除） */
  setPendingScrollLine: (line: number | null) => void;
}

export const createCategorySlice: StateCreator<CategorySlice> = (set) => ({
  activeCategory: "manuscript",
  selectedFile: null,
  pendingScrollLine: null,

  // P2-9 撕裂点修复: 切换分类时不再强制清空 selectedFile,
  // 保留用户已选中的文件上下文, 切回编辑器分类时无需重新选文件
  // 仅重置待定位行号(切换分类后行号失效)
  setActiveCategory: (category): void =>
    set({ activeCategory: category, pendingScrollLine: null }),

  setSelectedFile: (file): void => set({ selectedFile: file, pendingScrollLine: null }),

  navigateToFile: (file, category): void =>
    set({ activeCategory: category, selectedFile: file }),

  setPendingScrollLine: (line): void => set({ pendingScrollLine: line }),
});
