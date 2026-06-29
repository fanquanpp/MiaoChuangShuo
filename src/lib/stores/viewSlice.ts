// 视图模式状态切片
//
// openProject / closeProject 是跨切片动作，会同时设置 currentProject、
// activeCategory、selectedFile、projectTree 等跨领域字段。
// 使用 StateCreator<CombinedSlice> 泛型以在类型层面支持跨切片 set。
//
// 退出保存机制：
// editorDirty 由 NovelEditor 实时同步，供退出流程判断是否有未保存修改。
// editorSaveFn 由 NovelEditor 注册，退出流程调用以触发保存。
// closeProject 仅重置视图状态，实际退出编排由 useAutoSaveOnExit hook 负责。

import type { StateCreator } from "zustand";
import type { ProjectInfo, FileNode } from "../api";
import type { SidebarCategory } from "../store";

export type ViewMode = "launcher" | "workspace";

// 编辑器保存函数签名：返回 true 表示保存成功，false 表示失败
export type EditorSaveFn = () => Promise<boolean>;

// 本切片支持的视图模式字段
export interface ViewSlice {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  // 编辑器脏状态（供退出流程使用）
  editorDirty: boolean;
  setEditorDirty: (dirty: boolean) => void;
  /** 注册编辑器的保存回调（NovelEditor 在挂载时调用） */
  registerEditorSave: (fn: EditorSaveFn | null) => void;

  // 跨切片动作：这些 setter 会写入不属于 ViewSlice 的字段
  openProject: (project: ProjectInfo) => void;
  closeProject: () => void;
}

// 扩展切片类型，声明 openProject / closeProject 可能写入的跨切片字段
export interface CrossSliceState {
  viewMode: ViewMode;
  currentProject: ProjectInfo | null;
  activeCategory: SidebarCategory;
  selectedFile: FileNode | null;
  projectTree: FileNode[];
  editorDirty: boolean;
}

// 模块级保存函数引用（非响应式，避免 Zustand 序列化问题）
let editorSaveFnRef: EditorSaveFn | null = null;
export function getEditorSaveFn(): EditorSaveFn | null {
  return editorSaveFnRef;
}

export const createViewSlice: StateCreator<CrossSliceState, [], [], ViewSlice> = (
  set
) => ({
  viewMode: "launcher",
  editorDirty: false,

  setViewMode: (mode) => set({ viewMode: mode }),

  setEditorDirty: (dirty) => set({ editorDirty: dirty }),

  registerEditorSave: (fn) => {
    editorSaveFnRef = fn;
  },

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
});
