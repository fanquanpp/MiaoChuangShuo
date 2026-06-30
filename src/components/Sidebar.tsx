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

import { useMemo, useState, useEffect } from "react";
import {
  Users,
  Globe,
  Quote,
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
  Layers,
  Settings,
  BookOpen,
  Folder,
  Eye,
} from "lucide-react";
import {
  useAppStore,
  type SidebarCategory,
  CATEGORY_DIRS,
} from "../lib/store";
import { useThemeStore } from "../lib/themeStore";
import { getTypeSpecificDirs } from "../lib/templateRegistry";
import { useI18n } from "../lib/i18n";
import { useAutoSaveOnExit } from "../hooks/useAutoSaveOnExit";
import { readProjectTree } from "../lib/api";
import type { FileNode } from "../lib/api";

// 图标映射
const ICON_MAP: Record<SidebarCategory, React.ComponentType<{ className?: string }>> = {
  characters: Users,
  worldview: Globe,
  glossary: Quote,
  timeline: GitBranch,
  manuscript: FileText,
  outline: ListTree,
  materials: FolderOpen,
  stats: BarChart3,
  search: Search,
  knowledge: Search,
  volumes: BookOpen,
  foreshadowing: Eye,
};

// 内容分类列表(按显示顺序)
const CONTENT_CATEGORIES: SidebarCategory[] = [
  "manuscript",
  "characters",
  "worldview",
  "glossary",
  "outline",
  "materials",
  "foreshadowing",
];

// 工具分类列表
const TOOL_CATEGORIES: SidebarCategory[] = ["stats", "search"];

// 左侧导航栏属性接口
interface SidebarProps {
  onCreateFile: () => void;
  onOpenSettings?: () => void;
  onSwitchCategory?: (category: SidebarCategory) => void;
}

/**
 * 左侧导航栏组件
 * 输入:
 *   onCreateFile 新建文件回调
 *   onOpenSettings 打开设置回调（可选）
 *   onSwitchCategory 切换分类回调（可选，带保存检查）
 * 输出: JSX 侧边栏界面（项目信息 + 分类导航 + 最近文件 + 工具区）
 * 流程:
 *   1. 渲染项目信息头：项目名、作者、返回启动器按钮
 *   2. 渲染分类导航列表：角色/世界观/名词/时间线/正文/大纲/素材
 *   3. 渲染工具分类：统计、全局搜索
 *   4. 渲染最近打开文件列表（最多5项，按时间倒序）
 *   5. 高亮当前选中分类，点击触发 onSwitchCategory
 *   6. 底部工具区：主题切换、新建文件、设置入口
 */
export default function Sidebar({ onCreateFile, onOpenSettings, onSwitchCategory }: SidebarProps) {
  const currentProject = useAppStore((s) => s.currentProject);
  const activeCategory = useAppStore((s) => s.activeCategory);
  const setActiveCategory = useAppStore((s) => s.setActiveCategory);
  const closeProject = useAppStore((s) => s.closeProject);
  const { theme, toggleTheme } = useThemeStore();
  const { t } = useI18n();
  const { handleBackToLauncher } = useAutoSaveOnExit();

  // 分类切换：优先使用外部传入的保存后切换回调
  const switchTo = onSwitchCategory || setActiveCategory;

  // 是否为分卷类型（决定是否显示分卷入口）
  const showVolumeEntry = useMemo(() => {
    const type = currentProject?.meta?.type;
    return type === "multi_volume" || type === "standard" || type === "shared_world";
  }, [currentProject]);

  // 根据项目类型获取专属目录列表
  const typeSpecificDirs = useMemo(() => {
    if (!currentProject) return [];
    return getTypeSpecificDirs(currentProject.meta.type);
  }, [currentProject]);

  // 读取项目目录树，找出不在标准分类和类型专属目录中的额外目录
  const [extraDirs, setExtraDirs] = useState<string[]>([]);
  useEffect(() => {
    if (!currentProject) { setExtraDirs([]); return; }
    (async () => {
      try {
        const tree = await readProjectTree(currentProject.path);
        // 收集所有已知目录名（标准分类 + 类型专属）
        const knownDirs = new Set<string>();
        // 标准分类目录
        for (const dir of Object.values(CATEGORY_DIRS)) {
          if (dir) knownDirs.add(dir);
        }
        // 类型专属目录
        for (const d of typeSpecificDirs) knownDirs.add(d);
        // 隐藏目录
        knownDirs.add(".novelforge");
        // 找出额外的顶层目录
        const extras = tree
          .filter((n: FileNode) => n.is_dir && !knownDirs.has(n.name))
          .map((n: FileNode) => n.name);
        setExtraDirs(extras);
      } catch {
        setExtraDirs([]);
      }
    })();
  }, [currentProject, typeSpecificDirs]);

  return (
    <div className="w-40 min-w-[150px] border-r border-nf-border-light bg-nf-bg-sidebar flex flex-col relative">
      {/* 顶部渐变装饰条 */}
      <div className="absolute top-0 left-0 right-0 h-[2px] z-10" style={{
        background: 'linear-gradient(90deg, var(--fandex-primary), var(--fandex-secondary))',
      }} />

      {/* 顶部: 项目名称与返回 - FANDEX 左侧色条 */}
      <div className="px-3 py-3 border-b border-nf-border-light relative overflow-hidden">
        {/* 微妙的背景渐变 */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          background: 'linear-gradient(135deg, var(--fandex-primary), var(--fandex-secondary))',
        }} />
        <button
          onClick={handleBackToLauncher}
          className="relative flex items-center gap-1 text-xs text-nf-text-tertiary hover:text-fandex-primary transition-all duration-base ease-fandex mb-1.5 group"
        >
          <ChevronLeft className="w-3.5 h-3.5 transition-transform duration-fast group-hover:-translate-x-0.5" />
          {t("app.back")}
        </button>
        <h1 className="relative fandex-bar-left text-sm font-bold font-display text-nf-text truncate leading-snug" title={currentProject?.meta.name}>
          《{currentProject?.meta.name || t("sidebar.unnamedProject")}》
        </h1>
        <div className="relative text-[11px] text-nf-text-tertiary mt-0.5 truncate pl-3">
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
              onClick={() => switchTo(cat)}
              title={t(`sidebar.${cat}`)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-all duration-base ease-fandex relative group ${
                isActive
                  ? "bg-fandex-primary/10 text-fandex-primary"
                  : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
              }`}
            >
              {/* FANDEX 左侧色条激活指示器 - 带过渡动画 */}
              <span className={`absolute left-0 top-1 bottom-1 w-[3px] bg-fandex-primary transition-all duration-base ease-fandex ${
                isActive ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-0'
              }`} style={{ transformOrigin: 'center' }} />
              <Icon className={`w-4 h-4 flex-shrink-0 transition-transform duration-fast ${
                isActive ? 'scale-110' : 'group-hover:scale-105'
              }`} />
              <span className="truncate">{t(`sidebar.${cat}`)}</span>
            </button>
          );
        })}

        {/* 分隔线 */}
        <div className="mx-3 my-2 border-t border-nf-border-light/60" />

        {/* 分卷管理入口（仅对分卷类型项目显示） */}
        {showVolumeEntry && (
          <>
            <button
              onClick={() => switchTo("volumes" as SidebarCategory)}
              title={t("sidebar.volumes")}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-all duration-base ease-fandex relative group ${
                activeCategory === "volumes"
                  ? "bg-fandex-tertiary/10 text-fandex-tertiary"
                  : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
              }`}
            >
              <span className={`absolute left-0 top-1 bottom-1 w-[3px] bg-fandex-tertiary transition-all duration-base ease-fandex ${
                activeCategory === "volumes" ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-0'
              }`} style={{ transformOrigin: 'center' }} />
              <BookOpen className={`w-4 h-4 flex-shrink-0 transition-transform duration-fast ${
                activeCategory === "volumes" ? 'scale-110' : 'group-hover:scale-105'
              }`} />
              <span className="truncate">{t("sidebar.volumes")}</span>
            </button>
            <div className="mx-3 my-2 border-t border-nf-border-light/60" />
          </>
        )}

        {/* 类型专属目录（模板扩展） */}
        {typeSpecificDirs.length > 0 && (
          <>
            <div className="px-3 py-1 mt-1 text-[10px] font-semibold text-nf-text-tertiary uppercase tracking-wider">
              {t("sidebar.extensionSection")}
            </div>
            {typeSpecificDirs.map((dirName) => {
              const isActive = activeCategory === dirName;
              return (
                <button
                  key={dirName}
                  onClick={() => switchTo(dirName as SidebarCategory)}
                  title={dirName}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-all duration-base ease-fandex relative group ${
                    isActive
                      ? "bg-fandex-primary/10 text-fandex-primary"
                      : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
                  }`}
                >
                  <span className={`absolute left-0 top-1 bottom-1 w-[3px] bg-fandex-primary transition-all duration-base ease-fandex ${
                    isActive ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-0'
                  }`} style={{ transformOrigin: 'center' }} />
                  <Layers className={`w-4 h-4 flex-shrink-0 transition-transform duration-fast ${
                    isActive ? 'scale-110' : 'group-hover:scale-105'
                  }`} />
                  <span className="truncate">{dirName}</span>
                </button>
              );
            })}

            {/* 分隔线 */}
            <div className="mx-3 my-2 border-t border-nf-border-light/60" />
          </>
        )}

        {/* 项目自定义目录（非预设的额外目录） */}
        {extraDirs.length > 0 && (
          <>
            <div className="px-3 py-1 mt-1 text-[10px] font-semibold text-nf-text-tertiary uppercase tracking-wider">
              {t("sidebar.customSection")}
            </div>
            {extraDirs.map((dirName) => {
              const isActive = activeCategory === dirName;
              return (
                <button
                  key={dirName}
                  onClick={() => switchTo(dirName as SidebarCategory)}
                  title={dirName}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-all duration-base ease-fandex relative group ${
                    isActive
                      ? "bg-fandex-primary/10 text-fandex-primary"
                      : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
                  }`}
                >
                  <span className={`absolute left-0 top-1 bottom-1 w-[3px] bg-fandex-primary transition-all duration-base ease-fandex ${
                    isActive ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-0'
                  }`} style={{ transformOrigin: 'center' }} />
                  <Folder className={`w-4 h-4 flex-shrink-0 transition-transform duration-fast ${
                    isActive ? 'scale-110' : 'group-hover:scale-105'
                  }`} />
                  <span className="truncate">{dirName}</span>
                </button>
              );
            })}
            <div className="mx-3 my-2 border-t border-nf-border-light/60" />
          </>
        )}

        {/* 工具分组 */}
        <div className="px-3 py-1 mt-1 text-[10px] font-semibold text-nf-text-tertiary uppercase tracking-wider">
          {t("sidebar.toolSection")}
        </div>
        {TOOL_CATEGORIES.map((cat) => {
          const Icon = ICON_MAP[cat];
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => switchTo(cat)}
              title={t(`sidebar.${cat}`)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-all duration-base ease-fandex relative group ${
                isActive
                  ? "bg-fandex-tertiary/10 text-fandex-tertiary"
                  : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
              }`}
            >
              {/* FANDEX 左侧色条激活指示器(工具类用 tertiary 色) */}
              <span className={`absolute left-0 top-1 bottom-1 w-[3px] bg-fandex-tertiary transition-all duration-base ease-fandex ${
                isActive ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-0'
              }`} style={{ transformOrigin: 'center' }} />
              <Icon className={`w-4 h-4 flex-shrink-0 transition-transform duration-fast ${
                isActive ? 'scale-110' : 'group-hover:scale-105'
              }`} />
              <span className="truncate">{t(`sidebar.${cat}`)}</span>
            </button>
          );
        })}
      </div>

      {/* 底部: 主题切换、设置与新建文件按钮 - FANDEX 直角 */}
      <div className="px-2 py-2 border-t border-nf-border-light space-y-1">
        <div className="flex gap-1">
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? t("sidebar.switchLight") : t("sidebar.switchDark")}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-nf-text-secondary hover:text-fandex-tertiary border border-nf-border-light hover:border-fandex-tertiary/60 hover:bg-nf-bg-hover transition-all duration-base ease-fandex"
          >
            {theme === "dark" ? (
              <Sun className="w-3.5 h-3.5 transition-transform duration-fast hover:rotate-45" />
            ) : (
              <Moon className="w-3.5 h-3.5" />
            )}
            {theme === "dark" ? t("sidebar.light") : t("sidebar.dark")}
          </button>
          <button
            onClick={onOpenSettings}
            title={t("sidebar.settings")}
            className="flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-nf-text-secondary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/60 hover:bg-nf-bg-hover transition-all duration-base ease-fandex"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={onCreateFile}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-nf-text-secondary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/60 hover:bg-fandex-primary/5 transition-all duration-base ease-fandex"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("sidebar.newFile")}
        </button>
      </div>
    </div>
  );
}
