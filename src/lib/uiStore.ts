// UI 布局状态管理
//
// 功能概述：
// 使用 Zustand 管理用户界面布局偏好（文件列表视图模式、侧边栏折叠状态、
// 分组展开状态等），并通过 localStorage 持久化，确保用户重新进入应用时
// 保留上次设置的界面布局。
//
// 模块职责：
// 1. 管理文件列表视图模式（卡片/列表）
// 2. 管理侧边栏整体折叠状态
// 3. 管理侧边栏各分组（写作/设置/扩展/自定义/工具）展开状态
// 4. 持久化布局状态到 localStorage
//
// 设计说明：
// 与 settingsStore 分离，因为 settingsStore 管理的是应用功能设置
// （字号、自动保存、缩进等），而本 store 专注于界面布局偏好。
// 两者职责不同，分离便于维护与扩展。

import { create } from "zustand";

// 文件列表视图模式类型
export type FileListViewMode = "grid" | "list";

// UI 布局状态接口
interface UILayoutState {
  /** 文件列表视图模式：grid=卡片视图, list=列表视图 */
  fileListViewMode: FileListViewMode;
  /** 侧边栏整体折叠状态（true=折叠仅显示图标列） */
  sidebarCollapsed: boolean;
  /** 侧边栏写作分组展开状态 */
  sidebarWritingExpanded: boolean;
  /** 侧边栏设置分组展开状态 */
  sidebarSettingsExpanded: boolean;
  /** 侧边栏扩展分组展开状态 */
  sidebarExtensionExpanded: boolean;
  /** 侧边栏自定义分组展开状态 */
  sidebarCustomExpanded: boolean;
  /** 侧边栏工具分组展开状态 */
  sidebarToolExpanded: boolean;

  /** 设置文件列表视图模式 */
  setFileListViewMode: (mode: FileListViewMode) => void;
  /** 设置侧边栏整体折叠状态 */
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** 切换侧边栏整体折叠状态 */
  toggleSidebarCollapsed: () => void;
  /** 设置侧边栏写作分组展开状态 */
  setSidebarWritingExpanded: (expanded: boolean) => void;
  /** 设置侧边栏设置分组展开状态 */
  setSidebarSettingsExpanded: (expanded: boolean) => void;
  /** 设置侧边栏扩展分组展开状态 */
  setSidebarExtensionExpanded: (expanded: boolean) => void;
  /** 设置侧边栏自定义分组展开状态 */
  setSidebarCustomExpanded: (expanded: boolean) => void;
  /** 设置侧边栏工具分组展开状态 */
  setSidebarToolExpanded: (expanded: boolean) => void;
}

// localStorage 存储键
const STORAGE_KEY = "novelforge-ui-layout";

// 序列化数据接口
interface UILayoutData {
  fileListViewMode: FileListViewMode;
  sidebarCollapsed: boolean;
  sidebarWritingExpanded: boolean;
  sidebarSettingsExpanded: boolean;
  sidebarExtensionExpanded: boolean;
  sidebarCustomExpanded: boolean;
  sidebarToolExpanded: boolean;
}

// 默认布局配置
const DEFAULT_LAYOUT: UILayoutData = {
  // 文件列表默认列表视图：章节以列表排列更紧凑，避免卡片占用过多垂直空间
  fileListViewMode: "list",
  // 侧边栏默认展开，便于查看分类
  sidebarCollapsed: false,
  // 各分组默认展开，符合初次使用预期
  sidebarWritingExpanded: true,
  sidebarSettingsExpanded: true,
  sidebarExtensionExpanded: true,
  sidebarCustomExpanded: true,
  sidebarToolExpanded: true,
};

/**
 * 从 localStorage 加载布局数据
 * 输入: 无
 * 输出: UILayoutData 布局数据（加载失败返回默认值）
 * 流程:
 *   1. 检查 localStorage 可用性
 *   2. 读取并解析 JSON
 *   3. 合并默认值（保证新增字段有默认值）
 */
function loadLayout(): UILayoutData {
  if (typeof localStorage === "undefined") return DEFAULT_LAYOUT;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_LAYOUT, ...parsed };
    }
  } catch {
    // JSON 解析失败，返回默认值
  }
  return DEFAULT_LAYOUT;
}

/**
 * 保存布局数据到 localStorage
 * 输入: data 布局数据
 * 输出: 无（副作用：写入 localStorage）
 */
function saveLayout(data: UILayoutData): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 写入失败（如存储空间不足），静默处理
  }
}

export const useUILayoutStore = create<UILayoutState>((set, get) => ({
  // 初始值从 localStorage 加载（已合并默认值）
  ...loadLayout(),

  setFileListViewMode: (mode) => {
    const data = { ...get(), fileListViewMode: mode };
    saveLayout(data);
    set({ fileListViewMode: mode });
  },

  setSidebarCollapsed: (collapsed) => {
    const data = { ...get(), sidebarCollapsed: collapsed };
    saveLayout(data);
    set({ sidebarCollapsed: collapsed });
  },

  toggleSidebarCollapsed: () => {
    const next = !get().sidebarCollapsed;
    const data = { ...get(), sidebarCollapsed: next };
    saveLayout(data);
    set({ sidebarCollapsed: next });
  },

  setSidebarWritingExpanded: (expanded) => {
    const data = { ...get(), sidebarWritingExpanded: expanded };
    saveLayout(data);
    set({ sidebarWritingExpanded: expanded });
  },

  setSidebarSettingsExpanded: (expanded) => {
    const data = { ...get(), sidebarSettingsExpanded: expanded };
    saveLayout(data);
    set({ sidebarSettingsExpanded: expanded });
  },

  setSidebarExtensionExpanded: (expanded) => {
    const data = { ...get(), sidebarExtensionExpanded: expanded };
    saveLayout(data);
    set({ sidebarExtensionExpanded: expanded });
  },

  setSidebarCustomExpanded: (expanded) => {
    const data = { ...get(), sidebarCustomExpanded: expanded };
    saveLayout(data);
    set({ sidebarCustomExpanded: expanded });
  },

  setSidebarToolExpanded: (expanded) => {
    const data = { ...get(), sidebarToolExpanded: expanded };
    saveLayout(data);
    set({ sidebarToolExpanded: expanded });
  },
}));
