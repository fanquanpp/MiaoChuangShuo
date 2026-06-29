// 分类注册表 — 集中管理分类与组件、是否显示文件列表的映射

import type { SidebarCategory } from "./store";

export type PanelType = "editor" | "card-manager" | "timeline" | "stats" | "search";

export interface CategoryConfig {
  // 中间面板渲染类型
  panelType: PanelType;
  // 是否显示右侧文件列表
  showFileList: boolean;
}

// 配置映射（硬编码 → 可扩展）
const CATEGORY_CONFIG: Record<SidebarCategory, CategoryConfig> = {
  manuscript:    { panelType: "editor",        showFileList: true },
  outline:      { panelType: "editor",        showFileList: true },
  characters:   { panelType: "editor",        showFileList: true },
  worldview:    { panelType: "editor",        showFileList: true },
  glossary:     { panelType: "editor",        showFileList: true },
  materials:    { panelType: "editor",        showFileList: true },
  timeline:     { panelType: "timeline",      showFileList: false },
  stats:        { panelType: "stats",         showFileList: false },
  search:       { panelType: "search",        showFileList: false },
};

/**
 * 获取分类配置，未注册分类回退到 editor + showFileList
 */
export function getCategoryConfig(category: SidebarCategory): CategoryConfig {
  return CATEGORY_CONFIG[category] ?? { panelType: "editor", showFileList: true };
}
