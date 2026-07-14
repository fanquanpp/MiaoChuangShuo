// 启动器主组件(重构后)
//
// 功能概述：
// 喵创说 的入口页面,通过组合 useProjectScan/useVersionCheck hooks 与
// ProjectCreationPanel/ProjectGrid 子组件,实现左右两栏布局(30%:70%)。
// 业务逻辑下沉到 hooks,UI 拆分到子组件,本组件仅保留对话框编排与窗口控制。
//
// 模块职责:
// 1. 组合左右两栏布局(ProjectCreationPanel + 主区域)
// 2. 顶部搜索栏 + 窗口控制(全屏/退出)
// 3. 对话框编排(创建/编辑/删除/压缩包导入/欢迎/更新/设置)
// 4. 搜索过滤与项目列表排序
// 5. ProjectInfo 到 ProjectData 的转换

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Search,
  X,
  Palette,
  Sparkles,
  Settings,
  Keyboard,
  Maximize2,
  Minimize2,
  Power,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "../lib/store";
import {
  importProject,
  deleteProject,
  listCustomTemplates,
  type ProjectInfo,
  type ProjectType,
  type CustomTemplate,
} from "../lib/api";
import { logger } from "../lib/logger";
import { type ProjectData } from "./ProjectCard";
import CreateProjectDialog from "./CreateProjectDialog";
import EditProjectDialog from "./EditProjectDialog";
import TemplateManager from "./TemplateManager";
import ConfirmDialog from "./ConfirmDialog";
import ProjectArchiveDialog from "./ProjectArchiveDialog";
import WelcomeDialog from "./WelcomeDialog";
import UpdateNoticeDialog from "./UpdateNoticeDialog";
import SettingsDialog, { type SettingsSection } from "./SettingsDialog";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { useProjectScan } from "../hooks/useProjectScan";
import { useVersionCheck } from "../hooks/useVersionCheck";
import {
  formatWordCount,
  formatTimeAgo,
  formatCreatedDate,
} from "../lib/formatters";
import ProjectCreationPanel from "./launcher/ProjectCreationPanel";
import ProjectGrid from "./launcher/ProjectGrid";

/**
 * 启动器主组件
 * 输入: 无
 * 输出: JSX 启动器页面
 * 流程:
 *   1. 通过 useProjectScan 获取项目列表与扫描/导入方法
 *   2. 通过 useVersionCheck 获取版本号与更新检查状态
 *   3. 渲染左侧 ProjectCreationPanel(30%) + 右侧主区域(70%)
 *   4. 主区域顶部为搜索栏与窗口控制,中部为 ProjectGrid
 *   5. 各对话框由本组件统一编排开关状态
 */
export default function Launcher() {
  const closeProject = useAppStore((s) => s.closeProject);
  const { t } = useI18n();
  const { showToast } = useToast();

  // 项目扫描逻辑(已迁移到 useProjectScan hook)
  const {
    scanDir,
    setScanDir,
    projects,
    loading,
    scan,
    importFromDir,
    importFromPath,
    browseScanDir,
    removeProject,
    addOrUpdateProject,
    clearScanDir,
  } = useProjectScan();

  // 版本检查逻辑(已迁移到 useVersionCheck hook)
  const {
    appVersion,
    autoCheckRelease,
    autoCheckDialogOpen,
    setAutoCheckDialogOpen,
    skipVersion,
  } = useVersionCheck();

  // UI 状态(组件局部状态,不需要全局共享)
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedType, setSelectedType] = useState<ProjectType>("novel");
  const [deleteTarget, setDeleteTarget] = useState<ProjectInfo | null>(null);
  // 编辑项目对话框目标:非 null 时渲染 EditProjectDialog
  const [editTarget, setEditTarget] = useState<ProjectInfo | null>(null);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [selectedCustomTemplate, setSelectedCustomTemplate] = useState<CustomTemplate | null>(null);
  const [importArchiveOpen, setImportArchiveOpen] = useState(false);
  // 首次欢迎页受控开关:主页「回顾」按钮触发
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  // 设置对话框受控状态:主页右上角设置入口按钮触发
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 设置对话框打开时定位的分区:外观入口按钮传入 appearance,普通设置入口为 undefined
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection | undefined>(undefined);
  // 全屏状态:跟踪当前窗口是否处于 OS 全屏模式,用于切换按钮图标与提示
  const [isFullscreen, setIsFullscreen] = useState(false);

  /**
   * 打开设置对话框
   * 输入: section 可选,指定打开时定位到的分区(如 appearance)
   * 输出: 无
   */
  const handleOpenSettings = useCallback((section?: SettingsSection) => {
    setSettingsInitialSection(section);
    setSettingsOpen(true);
  }, []);

  /**
   * 切换 OS 全屏模式
   * 非 Tauri 环境(浏览器开发)静默忽略
   */
  const handleToggleFullscreen = useCallback(async () => {
    try {
      const appWindow = getCurrentWindow();
      const next = !isFullscreen;
      await appWindow.setFullscreen(next);
      setIsFullscreen(next);
    } catch (err) {
      logger.warn("toggleFullscreen failed:", err instanceof Error ? err : String(err));
    }
  }, [isFullscreen]);

  /**
   * 退出软件
   * 调用 Tauri 窗口 close() 触发已注册的 onCloseRequested 守卫,
   * 守卫内部处理未保存修改确认与自动保存,保证退出前数据安全
   */
  const handleExitApp = useCallback(async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.close();
    } catch {
      // 非 Tauri 环境回退到浏览器关闭
      window.close();
    }
  }, []);

  /**
   * 打开快捷键参考面板(介绍页面)
   * 派发自定义事件 nf:open-shortcuts,由 ShortcutPanel 监听并打开
   */
  const handleOpenShortcuts = useCallback(() => {
    window.dispatchEvent(new CustomEvent("nf:open-shortcuts"));
  }, []);

  // 启动时关闭已有项目(从 workspace 返回场景)
  useEffect(() => {
    closeProject();
  }, [closeProject]);

  // 监听 Tauri 窗口全屏状态变化,同步本地 state
  // 用户通过 OS 快捷键(如 F11/Win+Up)切换全屏时,按钮图标保持同步
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    try {
      const appWindow = getCurrentWindow();
      appWindow.onResized(async () => {
        try {
          const fs = await appWindow.isFullscreen();
          setIsFullscreen(fs);
        } catch {
          // 静默忽略
        }
      }).then((fn) => {
        unlisten = fn;
      });
    } catch {
      // 非 Tauri 环境静默忽略
    }
    return () => {
      unlisten?.();
    };
  }, []);

  // 加载自定义模板
  const loadCustomTemplates = useCallback(async () => {
    try {
      const list = await listCustomTemplates();
      setCustomTemplates(list);
    } catch {
      // 静默失败
    }
  }, []);

  useEffect(() => {
    loadCustomTemplates();
  }, [loadCustomTemplates]);

  // 按名称/作者过滤项目列表
  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects;
    const q = searchQuery.toLowerCase();
    return projects.filter(
      (p) =>
        p.meta.name.toLowerCase().includes(q) ||
        p.meta.author.toLowerCase().includes(q)
    );
  }, [projects, searchQuery]);

  // 按更新时间降序排序
  const sortedProjects = useMemo(() => {
    return [...filteredProjects].sort((a, b) =>
      b.meta.updatedAt.localeCompare(a.meta.updatedAt)
    );
  }, [filteredProjects]);

  /**
   * 将 ProjectInfo 转换为 ProjectCard 所需的 ProjectData
   * 使用 formatters.ts 中的纯函数完成字数/时间/日期格式化
   * 输入: p 原始项目信息
   * 输出: ProjectCard 展示数据
   */
  const toProjectData = useCallback((p: ProjectInfo): ProjectData => {
    const typeI18nMap: Record<string, string> = {
      novel: t("launcher.typeNovel"),
      script: t("launcher.typeScript"),
      essay: t("launcher.typeEssay"),
    };
    const typeColors: Record<string, string> = {
      novel: "bg-fandex-primary/10 text-fandex-primary border-fandex-primary/30",
      script: "bg-fandex-primary/10 text-fandex-primary border-fandex-primary/30",
      essay: "bg-fandex-secondary/10 text-fandex-secondary border-fandex-secondary/30",
    };
    const gradients: Record<string, string> = {
      novel: "from-fandex-primary to-fandex-primary/40",
      script: "from-fandex-primary to-fandex-primary/40",
      essay: "from-fandex-secondary to-fandex-secondary/40",
    };
    return {
      id: p.path,
      name: p.meta.name,
      type: typeI18nMap[p.meta.projectType] || p.meta.projectType,
      typeColor: typeColors[p.meta.projectType] || "bg-nf-bg-hover text-nf-text-secondary border-nf-border",
      words: formatWordCount(p.word_count, t),
      chapters: p.chapter_count,
      updated: formatTimeAgo(p.meta.updatedAt, t),
      gradient: gradients[p.meta.projectType] || "from-nf-border to-nf-border/40",
      // 透传元数据字段,供卡片展示详细信息
      author: p.meta.author || "",
      description: p.meta.description || "",
      genre: p.meta.genre || "",
      // 创建时间格式化为 YYYY-MM-DD 供卡片展示
      createdAt: formatCreatedDate(p.meta.createdAt),
    };
  }, [t]);

  // 选择文体类型后打开创建对话框
  const handleTypeSelect = useCallback((typeId: ProjectType) => {
    setSelectedType(typeId);
    setSelectedCustomTemplate(null);
    setShowCreateDialog(true);
  }, []);

  // 选择自定义模板后打开创建对话框
  const handleCustomTemplateSelect = useCallback((template: CustomTemplate) => {
    setSelectedCustomTemplate(template);
    setSelectedType("novel"); // 自定义模板基于 novel 类型(架构重构后标准文体)
    setShowCreateDialog(true);
  }, []);

  /**
   * 创建项目成功回调
   * 关闭对话框 + 调用 importProject 加入列表 + 提示成功
   * 不自动跳转工作台,用户停留在主页通过点击卡片主动进入
   */
  const handleCreateSuccess = useCallback(async (projectPath: string) => {
    setShowCreateDialog(false);
    setSelectedCustomTemplate(null);
    try {
      const project = await importProject(projectPath);
      addOrUpdateProject(project);
      showToast("success", t("launcher.createSuccess"));
    } catch (e) {
      showToast("error", t("launcher.importFailed", { error: String(e) }));
    }
  }, [addOrUpdateProject, showToast, t]);

  // 删除项目:打开确认对话框
  const handleDeleteProject = useCallback((project: ProjectInfo) => {
    setDeleteTarget(project);
  }, []);

  /**
   * 删除项目确认:调用后端 deleteProject 并从列表移除
   */
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    const project = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteProject(project.path);
      removeProject(project.path);
      showToast("success", t("project.deleteSuccess", { name: project.meta.name }));
    } catch (e) {
      showToast("error", t("project.deleteFailed", { error: String(e) }));
    }
  }, [deleteTarget, removeProject, t, showToast]);

  /**
   * 编辑项目设定成功回调
   * 关闭对话框 + 用最新信息替换列表中对应项 + 提示成功
   */
  const handleEditSuccess = useCallback((updated: ProjectInfo) => {
    setEditTarget(null);
    addOrUpdateProject(updated);
    showToast("success", t("project.editSuccess"));
  }, [addOrUpdateProject, t, showToast]);

  /**
   * 从压缩包导入成功后的回调:扫描解压目录将新项目加入列表
   * 复用 useProjectScan 的 importFromPath 方法(包含 toast 反馈)
   */
  const handleArchiveImported = useCallback(
    async (targetDir: string, projectName: string) => {
      const projectPath = `${targetDir}/${projectName}`;
      await importFromPath(projectPath);
      setImportArchiveOpen(false);
    },
    [importFromPath]
  );

  // 派生标志位
  const hasProjects = projects.length > 0;
  const hasSearchResults = sortedProjects.length > 0;
  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="flex h-screen bg-nf-bg overflow-hidden relative">
      {/* 全局舒缓柔光背景层:替代单一渐变,提升空间感 */}
      <div className="nf-ambient-bg" />
      {/* 小米护眼模式纸质感纹理层:暖色染色 + 纤维颗粒,强化纸质感指示感 */}
      <div className="nf-paper-grain" />
      {/* 背景装饰渐变(保留原主区域光斑) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 70% 20%, rgba(124, 158, 255, 0.04), transparent)",
        }}
      />

      {/* 左侧创建控制面板(30%) */}
      <ProjectCreationPanel
        scanDir={scanDir}
        onScanDirChange={setScanDir}
        loading={loading}
        onScan={scan}
        onBrowseScanDir={browseScanDir}
        onClearScanDir={clearScanDir}
        onImport={importFromDir}
        onArchiveImportOpen={() => setImportArchiveOpen(true)}
        selectedType={selectedType}
        onTypeSelect={handleTypeSelect}
        customTemplates={customTemplates}
        onCustomTemplateSelect={handleCustomTemplateSelect}
        onManageTemplates={() => setShowTemplateManager(true)}
        appVersion={appVersion}
      />

      {/* 右侧主区域(70%) */}
      <main className="flex-1 flex flex-col overflow-hidden relative z-10 animate-fade-in bg-nf-bg">
        {/* 主区域背景装饰图案:不影响功能与显示,极低透明度 */}
        <div className="nf-bg-grid-dots" aria-hidden="true" />
        <svg
          className="nf-bg-rings"
          viewBox="0 0 320 320"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="60" cy="260" r="140" stroke="currentColor" strokeWidth="0.6" className="text-fandex-primary" opacity="0.3" />
          <circle cx="60" cy="260" r="100" stroke="currentColor" strokeWidth="0.5" className="text-fandex-secondary" opacity="0.4" />
          <circle cx="60" cy="260" r="64" stroke="currentColor" strokeWidth="0.5" className="text-fandex-tertiary" opacity="0.5" />
          <circle cx="60" cy="260" r="32" stroke="currentColor" strokeWidth="0.4" className="text-fandex-primary" opacity="0.4" />
        </svg>

        {/* 顶部搜索栏 */}
        <header className="flex items-center justify-between px-8 py-5 border-b border-nf-border-light bg-nf-bg/80 backdrop-blur-sm">
          <div>
            <h2 className="text-lg font-bold font-display text-nf-text">
              {t("launcher.welcome")}
            </h2>
            <p className="text-xs text-nf-text-tertiary mt-0.5">
              {hasProjects && sortedProjects.length > 0
                ? t("launcher.welcomeRecentHint", { name: sortedProjects[0].meta.name })
                : t("launcher.welcomeHint")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setWelcomeOpen(true)}
              title={t("welcome.reviewButton")}
              className="nf-icon-spark nf-border-glow nf-border-glow-secondary flex items-center gap-1.5 px-3 py-2 text-xs text-nf-text-secondary hover:text-fandex-secondary border border-nf-border-light hover:border-fandex-secondary/40 hover:bg-nf-bg-hover transition duration-fast"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {t("welcome.reviewButton")}
            </button>
            {/* 外观入口:打开设置对话框并定位到外观分区 */}
            <button
              onClick={() => handleOpenSettings("appearance")}
              title={t("launcher.openAppearance")}
              className="nf-icon-spin nf-border-glow flex items-center gap-1.5 px-3 py-2 text-xs text-nf-text-secondary hover:text-fandex-tertiary border border-nf-border-light hover:border-fandex-tertiary/40 hover:bg-nf-bg-hover transition duration-fast"
            >
              <Palette className="w-3.5 h-3.5" />
              {t("launcher.openAppearance")}
            </button>
            {/* 设置入口:打开设置对话框(默认顶部) */}
            <button
              onClick={() => handleOpenSettings()}
              title={t("launcher.openSettings")}
              className="nf-icon-spin nf-border-glow flex items-center gap-1.5 px-3 py-2 text-xs text-nf-text-secondary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/40 hover:bg-nf-bg-hover transition duration-fast"
            >
              <Settings className="w-3.5 h-3.5" />
              {t("launcher.openSettings")}
            </button>
            {/* 快捷键参考入口(介绍页面):复用全局 ShortcutPanel */}
            <button
              onClick={handleOpenShortcuts}
              title={t("launcher.openShortcuts")}
              className="nf-icon-slide nf-border-glow flex items-center gap-1.5 px-3 py-2 text-xs text-nf-text-secondary hover:text-fandex-secondary border border-nf-border-light hover:border-fandex-secondary/40 hover:bg-nf-bg-hover transition duration-fast"
            >
              <Keyboard className="w-3.5 h-3.5" />
              {t("launcher.openShortcuts")}
            </button>
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nf-text-tertiary transition-colors duration-fast group-focus-within:text-fandex-primary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("launcher.searchPlaceholder")}
                className="w-72 bg-nf-bg-sidebar/80 border border-nf-border-light pl-10 pr-9 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 focus:bg-nf-bg transition-all duration-base ease-fandex"
              />
              {isSearching && (
                <button
                  onClick={() => setSearchQuery("")}
                  title={t("launcher.clearSearch")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-nf-text-tertiary hover:text-nf-text transition duration-fast"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {/* 窗口控制组:全屏切换 + 退出软件 */}
            <div className="flex items-center gap-1.5 ml-1 pl-3 border-l border-nf-border-light">
              <button
                onClick={handleToggleFullscreen}
                title={isFullscreen ? t("launcher.exitFullscreen") : t("launcher.enterFullscreen")}
                aria-label={isFullscreen ? t("launcher.exitFullscreen") : t("launcher.enterFullscreen")}
                className="nf-win-ctrl"
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <button
                onClick={handleExitApp}
                title={t("launcher.exitApp")}
                aria-label={t("launcher.exitApp")}
                className="nf-win-ctrl nf-win-danger"
              >
                <Power className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* 项目列表区域:委托 ProjectGrid 渲染所有状态分支 */}
        <div className="flex-1 overflow-y-auto p-8">
          <ProjectGrid
            projects={sortedProjects}
            loading={loading}
            searchQuery={searchQuery}
            hasProjects={hasProjects}
            isSearching={isSearching}
            hasSearchResults={hasSearchResults}
            toProjectData={toProjectData}
            onDelete={handleDeleteProject}
            onEdit={setEditTarget}
          />
        </div>
      </main>

      {/* 创建项目对话框 - 传入预选类型或自定义模板,以及扫描目录作为默认存储路径 */}
      {showCreateDialog && (
        <CreateProjectDialog
          defaultType={selectedType}
          customTemplate={selectedCustomTemplate}
          defaultPath={scanDir}
          onClose={() => {
            setShowCreateDialog(false);
            setSelectedCustomTemplate(null);
          }}
          onSuccess={handleCreateSuccess}
        />
      )}

      {/* 自定义模板管理对话框 */}
      {showTemplateManager && (
        <TemplateManager
          onClose={() => {
            setShowTemplateManager(false);
            loadCustomTemplates();
          }}
        />
      )}

      {/* 项目删除确认对话框 */}
      <ConfirmDialog
        open={!!deleteTarget}
        type="danger"
        title={t("project.deleteConfirmTitle")}
        message={t("project.deleteConfirmMsg", { name: deleteTarget?.meta.name || "" })}
        confirmLabel={t("app.delete")}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* 编辑项目设定对话框:由项目卡片右键菜单「编辑」触发 */}
      {editTarget && (
        <EditProjectDialog
          project={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={handleEditSuccess}
        />
      )}

      {/* 从压缩包导入项目对话框 */}
      <ProjectArchiveDialog
        open={importArchiveOpen}
        mode="import"
        onClose={() => setImportArchiveOpen(false)}
        onImported={handleArchiveImported}
      />

      {/* 首次欢迎页:首次启动自动弹出,主页「回顾」按钮可重新打开 */}
      <WelcomeDialog open={welcomeOpen} onClose={() => setWelcomeOpen(false)} />

      {/* 启动时自动检查更新提示(仅当检测到新版本时显示) */}
      <UpdateNoticeDialog
        open={autoCheckDialogOpen}
        onClose={() => setAutoCheckDialogOpen(false)}
        currentVersion={appVersion}
        release={autoCheckRelease}
        onSkip={skipVersion}
      />

      {/* 设置对话框:主页右上角入口按钮触发,支持定位到指定分区 */}
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialSection={settingsInitialSection}
      />
    </div>
  );
}
