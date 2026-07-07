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

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  FileText,
  ListTree,
  Library,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Plus,
  Palette,
  BarChart3,
  Search,
  Layers,
  Settings,
  BookOpen,
  Folder,
  PanelLeft,
  PanelLeftClose,
  GitBranch,
  Trash2,
  X,
  Users,
} from "lucide-react";
import {
  useAppStore,
  type SidebarCategory,
  CATEGORY_DIRS,
} from "../lib/store";
import { getTypeSpecificDirs } from "../lib/templateRegistry";
import { CODEX_TYPE_DIRS } from "../lib/codexApi";
import { useI18n } from "../lib/i18n";
import { useAutoSaveOnExit } from "../hooks/useAutoSaveOnExit";
import { readProjectTree, createFile, deletePath } from "../lib/api";
import type { FileNode } from "../lib/api";
import { useUILayoutStore } from "../lib/uiStore";

// 图标映射
const ICON_MAP: Record<SidebarCategory, React.ComponentType<{ className?: string }>> = {
  manuscript: FileText,
  outline: ListTree,
  codex: Library,
  stats: BarChart3,
  search: Search,
  volumes: BookOpen,
  timeline: GitBranch,
  characterGraph: Users,
};

// 写作主分类：核心写作功能，常驻显示（含剧情图谱/人物关系图，归类到写作）
const PRIMARY_CATEGORIES: SidebarCategory[] = ["manuscript", "outline", "timeline", "characterGraph"];

// 设定类分类：统一设定库入口（替代原 characters/worldview/glossary/materials 分散入口）
const SETTINGS_CATEGORIES: SidebarCategory[] = ["codex"];

// 工具分类列表
const TOOL_CATEGORIES: SidebarCategory[] = ["stats", "search"];

// Codex 保留目录名集合：设定库兼容目录（角色/人物/世界观/设定/术语/名词/素材/资料）
// 自定义分类创建时拦截这些名称，避免与设定库扫描逻辑冲突导致数据双向同步异常
const CODEX_RESERVED_DIRS: Set<string> = new Set(
  Object.values(CODEX_TYPE_DIRS).flat()
);

// 左侧导航栏属性接口
interface SidebarProps {
  onCreateFile: () => void;
  onOpenSettings?: () => void;
  /** 打开外观设置回调（定位到主题/外观分区），未提供时回退到 onOpenSettings */
  onOpenAppearance?: () => void;
  onSwitchCategory?: (category: SidebarCategory) => void;
}

/**
 * 左侧导航栏组件
 * 输入:
 *   onCreateFile 新建文件回调
 *   onOpenSettings 打开设置回调（可选）
 *   onOpenAppearance 打开外观设置回调（可选，定位到外观分区）
 *   onSwitchCategory 切换分类回调（可选，带保存检查）
 * 输出: JSX 侧边栏界面（项目信息 + 分类导航 + 最近文件 + 工具区）
 * 流程:
 *   1. 渲染项目信息头：项目名、作者、返回启动器按钮
 *   2. 渲染分类导航列表：角色/世界观/名词/时间线/正文/大纲/素材
 *   3. 渲染工具分类：统计、全局搜索
 *   4. 渲染最近打开文件列表（最多5项，按时间倒序）
 *   5. 高亮当前选中分类，点击触发 onSwitchCategory
 *   6. 底部工具区：主题设置入口、新建文件、设置入口
 */
export default function Sidebar({ onCreateFile, onOpenSettings, onOpenAppearance, onSwitchCategory }: SidebarProps) {
  const currentProject = useAppStore((s) => s.currentProject);
  const activeCategory = useAppStore((s) => s.activeCategory);
  const setActiveCategory = useAppStore((s) => s.setActiveCategory);
  const { t } = useI18n();
  const { handleBackToLauncher } = useAutoSaveOnExit();

  // 各分组折叠状态：从持久化 store 读取，保留用户上次设置
  const writingExpanded = useUILayoutStore((s) => s.sidebarWritingExpanded);
  const setWritingExpanded = useUILayoutStore((s) => s.setSidebarWritingExpanded);
  const settingsExpanded = useUILayoutStore((s) => s.sidebarSettingsExpanded);
  const setSettingsExpanded = useUILayoutStore((s) => s.setSidebarSettingsExpanded);
  const extensionExpanded = useUILayoutStore((s) => s.sidebarExtensionExpanded);
  const setExtensionExpanded = useUILayoutStore((s) => s.setSidebarExtensionExpanded);
  const customExpanded = useUILayoutStore((s) => s.sidebarCustomExpanded);
  const setCustomExpanded = useUILayoutStore((s) => s.setSidebarCustomExpanded);
  const toolExpanded = useUILayoutStore((s) => s.sidebarToolExpanded);
  const setToolExpanded = useUILayoutStore((s) => s.setSidebarToolExpanded);

  // 侧边栏整体折叠状态：持久化到 localStorage，跨会话保留用户偏好
  const collapsed = useUILayoutStore((s) => s.sidebarCollapsed);
  const setCollapsed = useUILayoutStore((s) => s.setSidebarCollapsed);

  // 分类切换：优先使用外部传入的保存后切换回调
  const switchTo = onSwitchCategory || setActiveCategory;

  // 是否为分卷类型（决定是否显示分卷入口）
  const showVolumeEntry = useMemo(() => {
    const type = currentProject?.meta?.type;
    return type === "novel" || type === "multi_volume" || type === "standard" || type === "shared_world";
  }, [currentProject]);

  // 根据项目类型获取专属目录列表
  const typeSpecificDirs = useMemo(() => {
    if (!currentProject) return [];
    return getTypeSpecificDirs(currentProject.meta.type);
  }, [currentProject]);

  // 读取项目目录树，找出不在标准分类和类型专属目录中的额外目录
  const [extraDirs, setExtraDirs] = useState<string[]>([]);

  // 刷新额外目录列表（提取为可复用函数，新建/删除分类后调用）
  const refreshExtraDirs = useCallback(async () => {
    if (!currentProject) { setExtraDirs([]); return; }
    try {
      const tree = await readProjectTree(currentProject.path);
      // 同步更新全局 projectTree：自定义分类增删后 FileList 需感知目录变化
      useAppStore.getState().setProjectTree(tree);
      // 收集所有已知目录名（标准分类 + 类型专属）
      const knownDirs = new Set<string>();
      for (const dir of Object.values(CATEGORY_DIRS)) {
        if (dir) knownDirs.add(dir);
      }
      for (const d of typeSpecificDirs) knownDirs.add(d);
      knownDirs.add(".novelforge");
      const extras = tree
        .filter((n: FileNode) => n.is_dir && !knownDirs.has(n.name))
        .map((n: FileNode) => n.name);
      setExtraDirs(extras);
    } catch {
      setExtraDirs([]);
    }
  }, [currentProject, typeSpecificDirs]);

  useEffect(() => {
    refreshExtraDirs();
  }, [refreshExtraDirs]);

  // ===== 自定义分类新建功能(悬浮模态面板) =====
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const newCategoryInputRef = useRef<HTMLInputElement>(null);

  // 打开新建分类模态: 重置状态并自动聚焦输入框
  const openAddCategoryDialog = () => {
    setNewCategoryName("");
    setCategoryError(null);
    setIsAddingCategory(true);
    // 延迟聚焦, 等待模态渲染完成
    setTimeout(() => newCategoryInputRef.current?.focus(), 50);
  };

  // 关闭新建分类模态
  const closeAddCategoryDialog = () => {
    setIsAddingCategory(false);
    setNewCategoryName("");
    setCategoryError(null);
  };

  // 提交新建分类：在项目根目录创建对应目录（通过创建 .gitkeep 占位文件）
  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name || !currentProject) {
      setCategoryError(t("sidebar.customCategoryNameRequired"));
      return;
    }
    // 校验名称合法性：禁止路径分隔符与特殊字符
    if (/[\\/:*?"<>|]/.test(name)) {
      setCategoryError(t("sidebar.customCategoryNameInvalid"));
      return;
    }
    // 禁止与已知分类目录重名
    const knownDirs = new Set<string>();
    for (const dir of Object.values(CATEGORY_DIRS)) {
      if (dir) knownDirs.add(dir);
    }
    for (const d of typeSpecificDirs) knownDirs.add(d);
    if (knownDirs.has(name) || extraDirs.includes(name)) {
      setCategoryError(t("sidebar.customCategoryNameExists"));
      return;
    }
    // 拦截 Codex 保留目录名：设定库兼容目录（角色/人物/世界观/设定/术语/名词/素材/资料）
    // 这些目录由设定库子系统（CodexPanel）统一管理，自定义分类使用同名目录会导致
    // 文件被双向同步逻辑误处理，引发数据冲突与卡片错乱
    if (CODEX_RESERVED_DIRS.has(name)) {
      setCategoryError(t("sidebar.customCategoryCodexReserved"));
      return;
    }
    try {
      // 创建 .gitkeep 占位文件，后端会自动创建父目录
      await createFile(currentProject.path, `${name}/.gitkeep`, "");
      await refreshExtraDirs();
      // 成功后关闭模态
      closeAddCategoryDialog();
    } catch (err) {
      setCategoryError(`${t("sidebar.customCategoryCreateFailed")}: ${String(err)}`);
    }
  };

  // ===== 自定义分类右键删除功能 =====
  const [contextMenu, setContextMenu] = useState<{ dirName: string; x: number; y: number } | null>(null);

  // 删除自定义分类目录
  const handleDeleteCategory = async (dirName: string) => {
    if (!currentProject) return;
    const sep = navigator.platform.toLowerCase().includes("win") ? "\\" : "/";
    const dirPath = `${currentProject.path}${sep}${dirName}`;
    try {
      await deletePath(dirPath, currentProject.path);
      await refreshExtraDirs();
      // 若删除的是当前激活分类，切回正文
      if (activeCategory === dirName) {
        setActiveCategory("manuscript");
      }
    } catch {
      // 静默处理删除失败
    }
    setContextMenu(null);
  };

  // 点击其他区域关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = () => setContextMenu(null);
    document.addEventListener("click", handleClose);
    document.addEventListener("contextmenu", handleClose);
    return () => {
      document.removeEventListener("click", handleClose);
      document.removeEventListener("contextmenu", handleClose);
    };
  }, [contextMenu]);

  return (
    <div className={`${collapsed ? "w-12 min-w-[48px]" : "w-52 min-w-[200px]"} border-r border-nf-border-light bg-nf-bg-sidebar flex flex-col relative z-10 nf-sidebar-glow transition-all duration-300`}>
      {/* 顶部渐变装饰条 */}
      <div className="absolute top-0 left-0 right-0 h-[2px] z-10" style={{
        background: 'linear-gradient(90deg, var(--fandex-primary), var(--fandex-secondary))',
      }} />

      {/* 顶部: 项目名称与返回 - FANDEX 左侧色条 */}
      {/* 折叠态增加顶部内边距,为居中的折叠按钮预留空间,避免与返回按钮重叠 */}
      <div className={`px-3 py-3 border-b border-nf-border-light relative overflow-hidden flex-shrink-0 ${collapsed ? "pt-9" : ""}`}>
        {/* 微妙的背景渐变 */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{
          background: 'linear-gradient(135deg, var(--fandex-primary), var(--fandex-secondary))',
        }} />
        {/* 折叠/展开切换按钮:固定右上角,提升 z 层级避免被相邻元素覆盖,
            折叠态下居中显示为顶部控件 */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          className={`absolute top-2 ${collapsed ? "left-1/2 -translate-x-1/2" : "right-2"} z-30 w-6 h-6 flex items-center justify-center text-nf-text-tertiary hover:text-fandex-primary hover:bg-nf-bg-hover transition-colors duration-fast`}
        >
          {collapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
        {/* 返回启动器按钮:始终显示,折叠时仅图标居中,保证用户随时可返回 */}
        <button
          onClick={handleBackToLauncher}
          title={t("app.back")}
          className={`relative flex items-center gap-1 text-xs text-nf-text-tertiary hover:text-fandex-primary transition-all duration-base ease-fandex mb-1.5 group ${collapsed ? "justify-center w-full" : ""}`}
        >
          <ChevronLeft className="w-3.5 h-3.5 transition-transform duration-fast group-hover:-translate-x-0.5" />
          {!collapsed && t("app.back")}
        </button>
        {/* 项目名:折叠时隐藏 */}
        {!collapsed && (
          <h1 className="relative fandex-bar-left text-sm font-bold font-display text-nf-text truncate leading-snug pr-8" title={currentProject?.meta.name}>
            《{currentProject?.meta.name || t("sidebar.unnamedProject")}》
          </h1>
        )}
        {/* 作者:折叠时隐藏 */}
        {!collapsed && (
          <div className="relative text-[11px] text-nf-text-tertiary mt-0.5 truncate pl-3">
            {currentProject?.meta.author || t("sidebar.anonymousAuthor")}
          </div>
        )}
      </div>

      {/* 中间: 分类导航 - FANDEX 左侧色条激活态 */}
      <div className="flex-1 overflow-y-auto py-2">
        {/* 写作主分类组：正文、大纲 - 可折叠，聚焦核心写作 */}
        {!collapsed && (
          <button
            onClick={() => setWritingExpanded(!writingExpanded)}
            title={writingExpanded ? t("sidebar.collapse") : t("sidebar.expand")}
            className="w-full flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold text-nf-text-tertiary uppercase tracking-wider hover:text-nf-text-secondary transition-colors duration-fast"
          >
            {writingExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            {t("sidebar.writingSection")}
          </button>
        )}
        {/* 折叠容器:使用 max-height + opacity 实现舒缓展开/关闭 */}
        {/* 整体折叠时强制展开以显示图标列 */}
        {/* max-h-[70vh] 自适应视口高度，避免长列表被截断；overflow-y-auto 内部滚动 */}
        <div className={`overflow-hidden overflow-y-auto transition-all duration-300 ease-fandex ${
          (collapsed || writingExpanded) ? 'max-h-[70vh] opacity-100' : 'max-h-0 opacity-0'
        }`}>
          {PRIMARY_CATEGORIES.map((cat) => {
            const Icon = ICON_MAP[cat];
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => switchTo(cat)}
                title={t(`sidebar.${cat}`)}
                className={`nf-sidebar-item w-full flex items-center ${collapsed ? "justify-center px-0" : "gap-2 px-3"} py-2 text-sm relative group ${
                  isActive
                    ? `nf-active bg-fandex-primary/10 text-fandex-primary`
                    : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
                }`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 transition-transform duration-fast ${
                  isActive ? 'scale-110' : ''
                }`} />
                {!collapsed && <span className="truncate">{t(`sidebar.${cat}`)}</span>}
              </button>
            );
          })}
        </div>

        {/* 设定类分组：可折叠，避免辅助功能干扰写作焦点 */}
        {/* 整体折叠时隐藏分组折叠按钮(已是最简形态) */}
        {!collapsed && (
          <button
            onClick={() => setSettingsExpanded(!settingsExpanded)}
            title={settingsExpanded ? t("sidebar.collapse") : t("sidebar.expand")}
            className="w-full flex items-center gap-1.5 px-3 mt-2 py-1 text-[10px] font-semibold text-nf-text-tertiary uppercase tracking-wider hover:text-nf-text-secondary transition-colors duration-fast"
          >
            {settingsExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            {t("sidebar.settingsGroup")}
          </button>
        )}
        {/* 折叠容器:使用 max-height + opacity 实现舒缓展开/关闭 */}
        {/* 整体折叠时强制展开以显示图标列 */}
        {/* max-h-[70vh] 自适应视口高度，避免长列表被截断；overflow-y-auto 内部滚动 */}
        <div className={`overflow-hidden overflow-y-auto transition-all duration-300 ease-fandex ${
          (collapsed || settingsExpanded) ? 'max-h-[70vh] opacity-100' : 'max-h-0 opacity-0'
        }`}>
          {SETTINGS_CATEGORIES.map((cat) => {
            const Icon = ICON_MAP[cat];
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => switchTo(cat)}
                title={t(`sidebar.${cat}`)}
                className={`nf-sidebar-item w-full flex items-center ${collapsed ? "justify-center px-0" : "gap-2 px-3"} py-2 text-sm relative group ${
                  isActive
                    ? `nf-active bg-fandex-primary/10 text-fandex-primary`
                    : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
                }`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 transition-transform duration-fast ${
                  isActive ? 'scale-110' : ''
                }`} />
                {!collapsed && <span className="truncate">{t(`sidebar.${cat}`)}</span>}
              </button>
            );
          })}
        </div>

        {/* 分隔线:折叠时隐藏 */}
        {!collapsed && <div className="mx-3 my-2 border-t border-nf-border-light/60" />}

        {/* 分卷管理入口（仅对分卷类型项目显示） */}
        {showVolumeEntry && (
          <>
            <button
              onClick={() => switchTo("volumes" as SidebarCategory)}
              title={t("sidebar.volumes")}
              className={`nf-sidebar-item nf-sidebar-tertiary w-full flex items-center ${collapsed ? "justify-center px-0" : "gap-2 px-3"} py-2 text-sm relative group ${
                activeCategory === "volumes"
                  ? `nf-active bg-fandex-tertiary/10 text-fandex-tertiary`
                  : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
              }`}
            >
              <BookOpen className={`w-4 h-4 flex-shrink-0 transition-transform duration-fast ${
                activeCategory === "volumes" ? 'scale-110' : ''
              }`} />
              {!collapsed && <span className="truncate">{t("sidebar.volumes")}</span>}
            </button>
            {!collapsed && <div className="mx-3 my-2 border-t border-nf-border-light/60" />}
          </>
        )}

        {/* 类型专属目录（模板扩展）- 可折叠 */}
        {typeSpecificDirs.length > 0 && (
          <>
            {!collapsed && (
              <button
                onClick={() => setExtensionExpanded(!extensionExpanded)}
                title={extensionExpanded ? t("sidebar.collapse") : t("sidebar.expand")}
                className="w-full flex items-center gap-1.5 px-3 mt-1 py-1 text-[10px] font-semibold text-nf-text-tertiary uppercase tracking-wider hover:text-nf-text-secondary transition-colors duration-fast"
              >
                {extensionExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                {t("sidebar.extensionSection")}
              </button>
            )}
            <div className={`overflow-hidden overflow-y-auto transition-all duration-300 ease-fandex ${
              (collapsed || extensionExpanded) ? 'max-h-[70vh] opacity-100' : 'max-h-0 opacity-0'
            }`}>
              {typeSpecificDirs.map((dirName) => {
                const isActive = activeCategory === dirName;
                return (
                  <button
                    key={dirName}
                    onClick={() => switchTo(dirName as SidebarCategory)}
                    title={dirName}
                    className={`nf-sidebar-item w-full flex items-center ${collapsed ? "justify-center px-0" : "gap-2 px-3"} py-2 text-sm relative group ${
                      isActive
                        ? `nf-active bg-fandex-primary/10 text-fandex-primary`
                        : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
                    }`}
                  >
                    <Layers className={`w-4 h-4 flex-shrink-0 transition-transform duration-fast ${
                      isActive ? 'scale-110' : ''
                    }`} />
                    {!collapsed && <span className="truncate">{dirName}</span>}
                  </button>
                );
              })}
            </div>

            {/* 分隔线:折叠时隐藏 */}
            {!collapsed && <div className="mx-3 my-2 border-t border-nf-border-light/60" />}
          </>
        )}

        {/* 项目自定义目录（非预设的额外目录）- 可折叠，始终显示以支持新建 */}
        {!collapsed && (
          <div className="flex items-center gap-1 mt-1">
            <button
              onClick={() => setCustomExpanded(!customExpanded)}
              title={customExpanded ? t("sidebar.collapse") : t("sidebar.expand")}
              className="flex-1 flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold text-nf-text-tertiary uppercase tracking-wider hover:text-nf-text-secondary transition-colors duration-fast"
            >
              {customExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              {t("sidebar.customSection")}
            </button>
            {/* 新建自定义分类按钮 - 打开悬浮模态面板 */}
            <button
              onClick={openAddCategoryDialog}
              title={t("sidebar.newCustomCategory")}
              className="w-5 h-5 mr-2 flex items-center justify-center text-nf-text-tertiary hover:text-fandex-primary hover:bg-nf-bg-hover transition-colors duration-fast"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className={`overflow-hidden overflow-y-auto transition-all duration-300 ease-fandex ${
          (collapsed || customExpanded) ? 'max-h-[70vh] opacity-100' : 'max-h-0 opacity-0'
        }`}>
          {extraDirs.map((dirName) => {
            const isActive = activeCategory === dirName;
            return (
              <div
                key={dirName}
                className={`nf-sidebar-item w-full flex items-center ${collapsed ? "justify-center px-0" : "gap-2 px-3"} py-2 text-sm relative group ${
                  isActive
                    ? `nf-active bg-fandex-primary/10 text-fandex-primary`
                    : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
                }`}
                onClick={() => switchTo(dirName as SidebarCategory)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ dirName, x: e.clientX, y: e.clientY });
                }}
                title={dirName}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    switchTo(dirName as SidebarCategory);
                  }
                }}
              >
                <Folder className={`w-4 h-4 flex-shrink-0 transition-transform duration-fast ${
                  isActive ? 'scale-110' : ''
                }`} />
                {!collapsed && <span className="truncate flex-1">{dirName}</span>}
                {/* 悬停显示删除按钮: 自定义分类可删除, 提升可发现性
                    折叠态隐藏避免图标拥挤; 点击阻止冒泡防止触发分类切换 */}
                {!collapsed && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(t("sidebar.confirmDeleteCategory").replace("{name}", dirName))) {
                        handleDeleteCategory(dirName);
                      }
                    }}
                    title={t("sidebar.deleteCategory")}
                    aria-label={t("sidebar.deleteCategory")}
                    className="opacity-0 group-hover:opacity-100 flex-shrink-0 w-5 h-5 flex items-center justify-center text-nf-text-tertiary hover:text-fandex-tertiary hover:bg-nf-bg-hover transition-all duration-fast"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {!collapsed && <div className="mx-3 my-2 border-t border-nf-border-light/60" />}

        {/* 工具分组 - 可折叠 */}
        {!collapsed && (
          <button
            onClick={() => setToolExpanded(!toolExpanded)}
            title={toolExpanded ? t("sidebar.collapse") : t("sidebar.expand")}
            className="w-full flex items-center gap-1.5 px-3 mt-1 py-1 text-[10px] font-semibold text-nf-text-tertiary uppercase tracking-wider hover:text-nf-text-secondary transition-colors duration-fast"
          >
            {toolExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            {t("sidebar.toolSection")}
          </button>
        )}
        <div className={`overflow-hidden transition-all duration-300 ease-fandex ${
          (collapsed || toolExpanded) ? 'max-h-[70vh] opacity-100' : 'max-h-0 opacity-0'
        }`}>
          {TOOL_CATEGORIES.map((cat) => {
            const Icon = ICON_MAP[cat];
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => switchTo(cat)}
                title={t(`sidebar.${cat}`)}
                className={`nf-sidebar-item nf-sidebar-tertiary w-full flex items-center ${collapsed ? "justify-center px-0" : "gap-2 px-3"} py-2 text-sm relative group ${
                  isActive
                    ? `nf-active bg-fandex-tertiary/10 text-fandex-tertiary`
                    : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
                }`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 transition-transform duration-fast ${
                  isActive ? 'scale-110' : ''
                }`} />
                {!collapsed && <span className="truncate">{t(`sidebar.${cat}`)}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* 底部: 主题设置入口、设置与新建文件按钮 - 统一大小,协调布局 */}
      <div className="px-2 py-2 border-t border-nf-border-light space-y-1.5">
        {/* 第一行:主题设置 + 设置按钮,等宽并排,折叠时仅图标
            主题切换已迁移至设置对话框外观分区,此处仅作为入口,避免与多预设主题冲突 */}
        <div className={`flex gap-1.5 ${collapsed ? "flex-col" : ""}`}>
          <button
            onClick={() => (onOpenAppearance ? onOpenAppearance() : onOpenSettings?.())}
            title={t("sidebar.openAppearanceSettings")}
            className={`flex items-center justify-center gap-1.5 py-2 text-xs text-nf-text-secondary hover:text-fandex-tertiary border border-nf-border-light hover:border-fandex-tertiary/60 hover:bg-nf-bg-hover transition-all duration-base ease-fandex ${collapsed ? "w-full" : "flex-1"}`}
          >
            <Palette className="w-4 h-4 transition-transform duration-fast" />
            {!collapsed && t("sidebar.themeSettings")}
          </button>
          <button
            onClick={onOpenSettings}
            title={t("sidebar.settings")}
            className={`flex items-center justify-center gap-1.5 py-2 text-xs text-nf-text-secondary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/60 hover:bg-nf-bg-hover transition-all duration-base ease-fandex ${collapsed ? "w-full" : "flex-1"}`}
          >
            <Settings className="w-4 h-4" />
            {!collapsed && t("sidebar.settings")}
          </button>
        </div>
        {/* 第二行:新建文件按钮,独占一行,主色高亮 */}
        <button
          onClick={onCreateFile}
          title={t("sidebar.newFile")}
          className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-nf-text-secondary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/60 hover:bg-fandex-primary/5 transition-all duration-base ease-fandex"
        >
          <Plus className="w-4 h-4" />
          {!collapsed && t("sidebar.newFile")}
        </button>
      </div>

      {/* 自定义分类右键删除菜单（浮动定位到鼠标位置）
          使用 createPortal 渲染到 body, 避免父容器 relative z-10 层叠上下文限制 */}
      {contextMenu && createPortal(
        <div
          className="fixed z-[200] min-w-[120px] bg-nf-bg-card border border-nf-border-light shadow-xl py-0.5"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            onClick={() => {
              if (window.confirm(t("sidebar.confirmDeleteCategory").replace("{name}", contextMenu.dirName))) {
                handleDeleteCategory(contextMenu.dirName);
              } else {
                setContextMenu(null);
              }
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-nf-text-secondary hover:text-fandex-tertiary hover:bg-nf-bg-hover transition-colors duration-fast"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t("sidebar.deleteCategory")}
          </button>
        </div>,
        document.body
      )}

      {/* 新建自定义分类悬浮模态面板 - 类似 SettingsDialog 的居中模态
          使用 createPortal 渲染到 body, 避免父容器 relative z-10 层叠上下文限制导致面板被遮挡 */}
      {isAddingCategory && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAddCategoryDialog();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeAddCategoryDialog();
          }}
        >
          <div
            className="nf-glass-panel w-full max-w-sm bg-nf-bg-card border border-nf-border-light shadow-lg flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-nf-border-light">
              <h3 className="text-sm font-semibold font-display text-nf-text flex items-center gap-2">
                <Plus className="w-3.5 h-3.5 text-fandex-primary" />
                {t("sidebar.newCustomCategory")}
              </h3>
              <button
                onClick={closeAddCategoryDialog}
                className="p-1 hover:bg-nf-bg-hover text-nf-text-tertiary transition duration-fast"
                aria-label="close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 表单内容 */}
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs text-nf-text-secondary mb-1">
                  {t("sidebar.customCategoryName")}
                </label>
                <input
                  ref={newCategoryInputRef}
                  value={newCategoryName}
                  onChange={(e) => {
                    setNewCategoryName(e.target.value);
                    if (categoryError) setCategoryError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateCategory();
                    if (e.key === "Escape") closeAddCategoryDialog();
                  }}
                  placeholder={t("sidebar.customCategoryName")}
                  className="w-full h-8 px-2.5 text-sm bg-nf-bg border border-nf-border-light text-nf-text placeholder:text-nf-text-tertiary focus:outline-none focus:border-fandex-primary transition duration-fast"
                />
                {/* 错误提示 */}
                {categoryError && (
                  <p className="mt-1.5 text-[11px] text-fandex-tertiary flex items-center gap-1">
                    <X className="w-3 h-3" />
                    {categoryError}
                  </p>
                )}
                <p className="mt-1.5 text-[10px] text-nf-text-tertiary">
                  {t("sidebar.customCategoryHint")}
                </p>
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-nf-border-light">
              <button
                onClick={closeAddCategoryDialog}
                className="px-3 py-1.5 text-xs text-nf-text-secondary hover:text-nf-text border border-nf-border-light hover:bg-nf-bg-hover transition-colors duration-fast"
              >
                {t("app.cancel")}
              </button>
              <button
                onClick={handleCreateCategory}
                className="px-3 py-1.5 text-xs text-nf-bg-card bg-fandex-primary hover:bg-fandex-primary/90 transition-colors duration-fast"
              >
                {t("app.confirm")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
