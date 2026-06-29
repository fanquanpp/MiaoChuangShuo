// 工作台左侧导航栏组件
//
// 功能概述：
// 显示项目分类导航(角色/世界观/名词/时间线/正文/大纲/素材)和最近打开文件。
// 采用 FANDEX 美术风格：左侧色条装饰、直角按钮、1px 边框。
//
// 模块职责：
// 1. 渲染项目名称与返回按钮
// 2. 渲染分类导航列表
// 3. 渲染最近打开的 5 个文件
// 4. 高亮当前选中分类
// 5. 触发分类切换

import { useEffect, useState, useMemo } from "react";
import {
  Users,
  Globe,
  BookMarked,
  GitBranch,
  FileText,
  ListTree,
  FolderOpen,
  ChevronLeft,
  Plus,
  Sun,
  Moon,
  BarChart3,
  Search,
  Clock,
  Layers,
} from "lucide-react";
import {
  useAppStore,
  CATEGORY_NAMES,
  CATEGORY_DIRS,
  getCategoryName,
  getCategoryDir,
  type SidebarCategory,
} from "../lib/store";
import { useThemeStore } from "../lib/themeStore";
import { getRecentFiles, type RecentFile } from "../lib/recentFiles";
import { findFileByPath } from "../lib/fileTreeUtils";
import { getTypeSpecificDirs } from "../lib/templateRegistry";
import { useI18n } from "../lib/i18n";
import { useAutoSaveOnExit } from "../hooks/useAutoSaveOnExit";

// 图标映射
const ICON_MAP: Record<SidebarCategory, React.ComponentType<{ className?: string }>> = {
  characters: Users,
  worldview: Globe,
  glossary: BookMarked,
  timeline: GitBranch,
  manuscript: FileText,
  outline: ListTree,
  materials: FolderOpen,
  stats: BarChart3,
  search: Search,
};

// 内容分类列表(按显示顺序)
const CONTENT_CATEGORIES: SidebarCategory[] = [
  "manuscript",
  "characters",
  "worldview",
  "glossary",
  "timeline",
  "outline",
  "materials",
];

// 工具分类列表
const TOOL_CATEGORIES: SidebarCategory[] = ["stats", "search"];

// 左侧导航栏属性接口
interface SidebarProps {
  onCreateFile: () => void;
}

// 左侧导航栏组件
// 输入: onCreateFile 新建文件回调
// 输出: 渲染导航栏
// 流程:
//   1. 顶部显示项目名称与返回按钮
//   2. 中间显示分类列表
//   3. 底部显示主题切换与新建文件按钮
export default function Sidebar({ onCreateFile }: SidebarProps) {
  const currentProject = useAppStore((s) => s.currentProject);
  const projectTree = useAppStore((s) => s.projectTree);
  const activeCategory = useAppStore((s) => s.activeCategory);
  const selectedFile = useAppStore((s) => s.selectedFile);
  const setActiveCategory = useAppStore((s) => s.setActiveCategory);
  const setSelectedFile = useAppStore((s) => s.setSelectedFile);
  const closeProject = useAppStore((s) => s.closeProject);
  const { theme, toggleTheme } = useThemeStore();
  const { t } = useI18n();
  const { handleBackToLauncher } = useAutoSaveOnExit();
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);

  // 根据项目类型获取专属目录列表
  const typeSpecificDirs = useMemo(() => {
    if (!currentProject) return [];
    return getTypeSpecificDirs(currentProject.meta.type);
  }, [currentProject]);

  // 加载最近文件（仅显示当前项目的，文件切换时也刷新排序）
  useEffect(() => {
    if (!currentProject) return;
    const all = getRecentFiles();
    const projectFiles = all.filter(
      (f) => f.project_path === currentProject.path
    );
    setRecentFiles(projectFiles.slice(0, 5));
  }, [currentProject, selectedFile]);

  return (
    <div className="w-40 min-w-[150px] border-r border-nf-border-light bg-nf-bg-sidebar flex flex-col">
      {/* 顶部: 项目名称与返回 - FANDEX 左侧色条 */}
      <div className="px-3 py-3 border-b border-nf-border-light">
        <button
          onClick={handleBackToLauncher}
          className="flex items-center gap-1 text-xs text-nf-text-tertiary hover:text-fandex-primary transition duration-fast mb-1.5"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          {t("app.back")}
        </button>
        <h1 className="fandex-bar-left text-sm font-bold font-display text-nf-text truncate" title={currentProject?.meta.name}>
          {currentProject?.meta.name || t("sidebar.unnamedProject")}
        </h1>
        <div className="text-[11px] text-nf-text-tertiary mt-0.5 truncate">
          {currentProject?.meta.author || t("sidebar.anonymousAuthor")}
        </div>
      </div>

      {/* 中间: 分类导航 - FANDEX 左侧色条激活态 */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-3 py-1 text-[10px] font-semibold text-nf-text-tertiary uppercase tracking-wider">
          {t("sidebar.categorySection")}
        </div>
        {CONTENT_CATEGORIES.map((cat) => {
          const Icon = ICON_MAP[cat];
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              title={CATEGORY_NAMES[cat]}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition duration-fast relative ${
                isActive
                  ? "bg-fandex-primary/10 text-fandex-primary"
                  : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
              }`}
            >
              {/* FANDEX 左侧色条激活指示器 */}
              {isActive && (
                <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-fandex-primary"></span>
              )}
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{CATEGORY_NAMES[cat]}</span>
            </button>
          );
        })}

        {/* 类型专属目录（模板扩展） */}
        {typeSpecificDirs.length > 0 && (
          <>
            <div className="px-3 py-1 mt-3 text-[10px] font-semibold text-nf-text-tertiary uppercase tracking-wider">
              {t("sidebar.extensionSection")}
            </div>
            {typeSpecificDirs.map((dirName) => {
              const isActive = activeCategory === dirName;
              return (
                <button
                  key={dirName}
                  onClick={() => setActiveCategory(dirName as SidebarCategory)}
                  title={dirName}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition duration-fast relative ${
                    isActive
                      ? "bg-fandex-primary/10 text-fandex-primary"
                      : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-fandex-primary"></span>
                  )}
                  <Layers className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{dirName}</span>
                </button>
              );
            })}
          </>
        )}

        {/* 最近文件（仅当前项目） */}
        {recentFiles.length > 0 && (
          <>
            <div className="px-3 py-1 mt-3 text-[10px] font-semibold text-nf-text-tertiary uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {t("sidebar.recentSection")}
            </div>
            {recentFiles.map((rf) => {
              const isActive = selectedFile?.relative_path === rf.relative_path;
              return (
                <button
                  key={rf.relative_path}
                  title={rf.name}
                  onClick={() => {
                    const node = findFileByPath(projectTree, rf.relative_path);
                    if (!node) return;
                    // 自动切换到文件所属分类
                    const topDir = rf.relative_path.split(/[\\/]/)[0] || "";
                    // 先检查固定分类
                    let matched = false;
                    for (const [cat, dir] of Object.entries(CATEGORY_DIRS)) {
                      if (dir === topDir) {
                        setActiveCategory(cat as SidebarCategory);
                        matched = true;
                        break;
                      }
                    }
                    // 固定分类未匹配，检查是否为类型专属目录
                    if (!matched && typeSpecificDirs.includes(topDir)) {
                      setActiveCategory(topDir as SidebarCategory);
                    }
                    setSelectedFile(node);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition duration-fast truncate relative ${
                    isActive
                      ? "bg-fandex-primary/10 text-fandex-primary"
                      : "text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-hover"
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-fandex-primary"></span>
                  )}
                  <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{rf.name}</span>
                </button>
              );
            })}
          </>
        )}

        {/* 工具分组 */}
        <div className="px-3 py-1 mt-3 text-[10px] font-semibold text-nf-text-tertiary uppercase tracking-wider">
          {t("sidebar.toolSection")}
        </div>
        {TOOL_CATEGORIES.map((cat) => {
          const Icon = ICON_MAP[cat];
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              title={CATEGORY_NAMES[cat]}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition duration-fast relative ${
                isActive
                  ? "bg-fandex-tertiary/10 text-fandex-tertiary"
                  : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
              }`}
            >
              {/* FANDEX 左侧色条激活指示器(工具类用 tertiary 色) */}
              {isActive && (
                <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-fandex-tertiary"></span>
              )}
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{CATEGORY_NAMES[cat]}</span>
            </button>
          );
        })}
      </div>

      {/* 底部: 主题切换与新建文件按钮 - FANDEX 直角 */}
      <div className="px-2 py-2 border-t border-nf-border-light space-y-1">
        <button
          onClick={toggleTheme}
          title={theme === "dark" ? t("sidebar.switchLight") : t("sidebar.switchDark")}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-nf-text-secondary hover:text-fandex-tertiary border border-nf-border-light hover:border-fandex-tertiary hover:bg-nf-bg-hover transition duration-fast"
        >
          {theme === "dark" ? (
            <Sun className="w-3.5 h-3.5" />
          ) : (
            <Moon className="w-3.5 h-3.5" />
          )}
          {theme === "dark" ? t("sidebar.light") : t("sidebar.dark")}
        </button>
        <button
          onClick={onCreateFile}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-nf-text-secondary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary hover:bg-nf-bg-hover transition duration-fast"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("sidebar.newFile")}
        </button>
      </div>
    </div>
  );
}
