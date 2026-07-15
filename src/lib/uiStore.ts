// UI 布局状态管理
//
// 功能概述：
// 使用 Zustand 管理用户界面布局偏好（文件列表视图模式、侧边栏折叠状态、
// 分组展开状态等），通过 zustand persist 中间件实现 localStorage 自动持久化，
// 确保用户重新进入应用时保留上次设置的界面布局。
//
// 模块职责：
// 1. 管理文件列表视图模式（卡片/列表）
// 2. 管理侧边栏整体折叠状态
// 3. 管理侧边栏各分组（写作/设置/扩展/自定义/工具）展开状态
// 4. 通过 persist 中间件自动持久化布局状态到 localStorage
//
// 设计说明：
// - 采用 zustand persist 中间件，替代原手工 localStorage 读写
// - STORAGE_KEY 改为 `miaochuangshuo-ui-layout`（原为 `novelforge-ui-layout`）
// - 模块顶层执行一次性迁移：从旧 key 读取 JSON 数据，转为 persist 的 JSON 格式写入新 key
// - 与 settingsStore 分离，因为本 store 专注界面布局偏好，与功能设置职责不同

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// 文件列表视图模式类型
export type FileListViewMode = "grid" | "list";

// 独立 localStorage 键
const STORAGE_KEY = "miaochuangshuo-ui-layout";
// 旧 localStorage 键（用于一次性迁移）
const LEGACY_STORAGE_KEY = "novelforge-ui-layout";
// 当前 schema 版本（用于未来字段变更时的迁移）
const SCHEMA_VERSION = 1;

// UI 布局数据接口（序列化用）
interface UILayoutData {
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
}

// UI 布局状态接口（含 Actions）
interface UILayoutState extends UILayoutData {
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

// 布局数据字段白名单（迁移与持久化时使用）
const LAYOUT_DATA_KEYS = [
  "fileListViewMode", "sidebarCollapsed", "sidebarWritingExpanded",
  "sidebarSettingsExpanded", "sidebarExtensionExpanded", "sidebarCustomExpanded",
  "sidebarToolExpanded",
] as const;

/**
 * 从完整状态中提取需持久化的数据字段（排除 actions）
 * 输入: state 完整状态（含数据与 actions）
 * 输出: 仅含数据字段的纯对象
 */
function pickLayoutData(state: UILayoutState): UILayoutData {
  return {
    fileListViewMode: state.fileListViewMode,
    sidebarCollapsed: state.sidebarCollapsed,
    sidebarWritingExpanded: state.sidebarWritingExpanded,
    sidebarSettingsExpanded: state.sidebarSettingsExpanded,
    sidebarExtensionExpanded: state.sidebarExtensionExpanded,
    sidebarCustomExpanded: state.sidebarCustomExpanded,
    sidebarToolExpanded: state.sidebarToolExpanded,
  };
}

/**
 * 一次性迁移：从旧 key 读取 JSON 数据，转为 persist 的 JSON 格式写入新 key
 * 仅在新 key 不存在且旧 key 存在时执行
 * 流程:
 *   1. 检测新 key 是否已有数据（已有则跳过，避免覆盖）
 *   2. 读取旧 key 的 JSON 数据（纯对象，非 persist 格式）
 *   3. 按字段白名单提取布局字段
 *   4. 构造 persist 标准格式 { state: {...}, version } 写入新 key
 * 说明: 旧数据为纯 JSON 对象，需转为 persist 内部格式
 */
function migrateLegacyLayout(): void {
  if (typeof localStorage === "undefined") return;
  try {
    // 新 key 已有数据，跳过迁移
    if (localStorage.getItem(STORAGE_KEY)) return;
    const oldRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!oldRaw) return;
    const parsed = JSON.parse(oldRaw) as Record<string, unknown>;
    const extracted: Record<string, unknown> = {};
    for (const key of LAYOUT_DATA_KEYS) {
      if (key in parsed) {
        extracted[key] = parsed[key];
      }
    }
    // 构造 persist 标准 JSON 格式
    const newData = JSON.stringify({ state: extracted, version: SCHEMA_VERSION });
    localStorage.setItem(STORAGE_KEY, newData);
  } catch {
    // 迁移失败静默处理，persist 将使用默认值
  }
}

// 模块顶层执行迁移（store 创建前立即执行，非 React 组件内）
migrateLegacyLayout();

// 创建 UI 布局状态 store，使用 persist 中间件自动持久化
// 泛型 <UILayoutState, [], [], UILayoutData> 分别指定完整状态类型、空 middleware mutators、持久化数据类型
export const useUILayoutStore = create<UILayoutState>()(
  persist<UILayoutState, [], [], UILayoutData>(
    (set) => ({
      ...DEFAULT_LAYOUT,

      setFileListViewMode: (mode): void => {
        set({ fileListViewMode: mode });
      },

      setSidebarCollapsed: (collapsed): void => {
        set({ sidebarCollapsed: collapsed });
      },

      toggleSidebarCollapsed: (): void => {
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
      },

      setSidebarWritingExpanded: (expanded): void => {
        set({ sidebarWritingExpanded: expanded });
      },

      setSidebarSettingsExpanded: (expanded): void => {
        set({ sidebarSettingsExpanded: expanded });
      },

      setSidebarExtensionExpanded: (expanded): void => {
        set({ sidebarExtensionExpanded: expanded });
      },

      setSidebarCustomExpanded: (expanded): void => {
        set({ sidebarCustomExpanded: expanded });
      },

      setSidebarToolExpanded: (expanded): void => {
        set({ sidebarToolExpanded: expanded });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: SCHEMA_VERSION,
      partialize: (state) => pickLayoutData(state),
      migrate: (persistedState, version) => {
        // 版本兼容处理：未知或格式异常的数据回退默认值
        if (version < SCHEMA_VERSION && persistedState && typeof persistedState === "object") {
          const data = persistedState as Partial<UILayoutData>;
          return { ...DEFAULT_LAYOUT, ...data };
        }
        return DEFAULT_LAYOUT;
      },
    }
  )
);
