// 启动器页面
//
// 功能概述：
// 喵创说 的入口页面，支持创建新项目、导入已有项目、
// 扫描目录下的项目列表、搜索过滤、删除项目。
// 采用 FANDEX 直角美学与品牌色。
//
// 模块职责：
// 1. 项目扫描与导入
// 2. 最近项目列表展示（支持全部项目，不限数量）
// 3. 搜索过滤
// 4. 文体类型选择（侧边栏展开）→ 触发创建项目对话框
// 5. 删除项目（带确认对话框）

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Search,
  FolderSync,
  FolderOpen,
  FolderSearch,
  BookOpen,
  PenLine,
  ArrowRight,
  Loader2,
  RefreshCw,
  X,
  Palette,
  FileText,
  BookMarked,
  ScrollText,
  MessageSquare,
  Library,
  Globe2,
  Clapperboard,
  Feather,
  Layers,
  Settings,
  FileArchive,
  Sparkles,
  Maximize2,
  Minimize2,
  Power,
  Keyboard,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "../lib/store";
import {
  scanProjects,
  importProject,
  pickDirectory,
  deleteProject,
  PROJECT_TEMPLATES,
  listCustomTemplates,
  type ProjectInfo,
  type ProjectType,
  type CustomTemplate,
} from "../lib/api";
import ProjectCard, { type ProjectData } from "./ProjectCard";
import CreateProjectDialog from "./CreateProjectDialog";
import EditProjectDialog from "./EditProjectDialog";
import TemplateManager from "./TemplateManager";
import { ProjectGridSkeleton } from "./SkeletonComponents";
import { useI18n } from "../lib/i18n";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { useToast } from "../lib/toast";
import ConfirmDialog from "./ConfirmDialog";
import ProjectArchiveDialog from "./ProjectArchiveDialog";
import WelcomeDialog from "./WelcomeDialog";
import UpdateNoticeDialog from "./UpdateNoticeDialog";
import SettingsDialog, { type SettingsSection } from "./SettingsDialog";
import { useSettingsStore } from "../lib/settingsStore";
import { checkForUpdates, type ReleaseInfo } from "../lib/updateChecker";

const SCAN_DIR_KEY = "novelforge:scanDir:v1";

// 项目类型图标映射
const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  standard: BookMarked,
  short_story: FileText,
  diary: ScrollText,
  dialogue: MessageSquare,
  multi_volume: Library,
  shared_world: Globe2,
  screenplay: Clapperboard,
  poetry: Feather,
};

/**
 * 启动器主组件
 * 输入: 无
 * 输出: JSX 启动器页面
 * 流程:
 *   1. 挂载时从 localStorage 恢复扫描目录并自动扫描
 *   2. 调用后端 scanProjects 获取项目列表，渲染卡片网格
 *   3. 支持创建项目（文体类型选择 → 创建对话框）
 *   4. 支持导入本地项目（选择目录 → 调用 importProject）
 *   5. 支持搜索过滤、删除项目（带确认对话框）
 *   6. 支持自定义模板管理与使用
 */
export default function Launcher() {
  const closeProject = useAppStore((s) => s.closeProject);
  const { t } = useI18n();
  const { showToast } = useToast();
  const [scanDir, setScanDir] = useState("");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedType, setSelectedType] = useState<ProjectType>("standard");
  const [typePanelExpanded, setTypePanelExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [appVersion, setAppVersion] = useState("26.7.10");
  const [deleteTarget, setDeleteTarget] = useState<ProjectInfo | null>(null);
  // 编辑项目对话框目标：非 null 时渲染 EditProjectDialog
  const [editTarget, setEditTarget] = useState<ProjectInfo | null>(null);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [selectedCustomTemplate, setSelectedCustomTemplate] = useState<CustomTemplate | null>(null);
  const [importArchiveOpen, setImportArchiveOpen] = useState(false);
  // 首次欢迎页受控开关：主页"回顾"按钮触发
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  // 设置对话框受控状态:主页右上角设置入口按钮触发
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 设置对话框打开时定位的分区:外观入口按钮传入 appearance,普通设置入口为 undefined
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection | undefined>(undefined);
  // 全屏状态:跟踪当前窗口是否处于 OS 全屏模式,用于切换按钮图标与提示
  const [isFullscreen, setIsFullscreen] = useState(false);

  /**
   * 打开设置对话框
   * 输入:
   *   section 可选,指定打开时定位到的分区(如 appearance)
   * 输出: 无
   * 流程: 设置 initialSection 并打开对话框
   */
  const handleOpenSettings = useCallback((section?: SettingsSection) => {
    setSettingsInitialSection(section);
    setSettingsOpen(true);
  }, []);

  /**
   * 切换 OS 全屏模式
   * 输入: 无
   * 输出: 无
   * 流程: 调用 Tauri 窗口 API 反转全屏状态,同步本地 state
   *      非 Tauri 环境(浏览器开发)静默忽略
   */
  const handleToggleFullscreen = useCallback(async () => {
    try {
      const appWindow = getCurrentWindow();
      const next = !isFullscreen;
      await appWindow.setFullscreen(next);
      setIsFullscreen(next);
    } catch (err) {
      // 非 Tauri 环境或权限不足时静默忽略,仅在控制台输出便于调试
      console.warn("toggleFullscreen failed:", err);
    }
  }, [isFullscreen]);

  /**
   * 退出软件
   * 输入: 无
   * 输出: 无
   * 流程: 调用 Tauri 窗口 close(),触发已注册的 onCloseRequested 守卫
   *      守卫内部处理未保存修改确认与自动保存,保证退出前数据安全
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
   * 输入: 无
   * 输出: 无
   * 流程: 派发自定义事件 nf:open-shortcuts,由 ShortcutPanel 监听并打开
   *      复用全局已有的快捷键面板,避免重复实现介绍内容
   */
  const handleOpenShortcuts = useCallback(() => {
    window.dispatchEvent(new CustomEvent("nf:open-shortcuts"));
  }, []);

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

  // ===== 启动时自动检查更新 =====
  // 从 settingsStore 读取更新检查相关设置
  const checkUpdateOnStartup = useSettingsStore((s) => s.checkUpdateOnStartup);
  const lastUpdateCheckTime = useSettingsStore((s) => s.lastUpdateCheckTime);
  const skipUpdateVersion = useSettingsStore((s) => s.skipUpdateVersion);
  const setLastUpdateCheckTime = useSettingsStore((s) => s.setLastUpdateCheckTime);
  const setSkipUpdateVersion = useSettingsStore((s) => s.setSkipUpdateVersion);
  // 自动检查检测到的新版本信息
  const [autoCheckRelease, setAutoCheckRelease] = useState<ReleaseInfo | null>(null);
  const [autoCheckDialogOpen, setAutoCheckDialogOpen] = useState(false);

  /**
   * 启动时自动检查更新
   * 条件:
   *   1. 用户启用了"启动时自动检查更新"
   *   2. 距离上次检查超过 24 小时（避免频繁请求）
   * 失败时静默处理，不干扰用户
   */
  useEffect(() => {
    if (!checkUpdateOnStartup) return;
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    // 24 小时内已检查过则跳过
    if (lastUpdateCheckTime > 0 && now - lastUpdateCheckTime < ONE_DAY) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await checkForUpdates();
        if (cancelled) return;
        setLastUpdateCheckTime(now);
        // 有新版本且未被用户跳过时弹出提示
        if (result.hasUpdate && result.latest.version !== skipUpdateVersion) {
          setAutoCheckRelease(result.latest);
          setAutoCheckDialogOpen(true);
        }
      } catch {
        // 自动检查失败时静默处理，不干扰用户
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [checkUpdateOnStartup, lastUpdateCheckTime, skipUpdateVersion, setLastUpdateCheckTime]);

  const handleScan = useCallback(async () => {
    if (!scanDir) return;
    setLoading(true);
    try {
      // 若目录不存在则自动创建
      try {
        const dirExists = await exists(scanDir);
        if (!dirExists) {
          await mkdir(scanDir, { recursive: true });
        }
      } catch {
        // 目录检查/创建失败时静默继续，让 scanProjects 自行处理
      }
      const list = await scanProjects(scanDir);
      setProjects(list);
      showToast("success", t("launcher.scanSuccess", { count: list.length }));
    } catch (e) {
      showToast("error", t("launcher.scanFailed", { error: String(e) }));
    } finally {
      setLoading(false);
    }
  }, [scanDir, t, showToast]);

  const handleImport = useCallback(async () => {
    try {
      const dir = await pickDirectory();
      if (!dir) return;
      const project = await importProject(dir);
      if (project) {
        setProjects((prev) => {
          const idx = prev.findIndex((p) => p.path === project.path);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = project;
            return copy;
          }
          return [project, ...prev];
        });
        showToast("success", t("launcher.importSuccess", { name: project.meta.name }));
      }
    } catch (e) {
      showToast("error", t("launcher.importFailed", { error: String(e) }));
    }
  }, [t, showToast]);

  // 从压缩包导入成功后的回调：扫描解压目录将新项目加入列表
  const handleArchiveImported = useCallback(
    async (targetDir: string, projectName: string) => {
      try {
        // 解压后的项目路径：targetDir/projectName
        const projectPath = `${targetDir}/${projectName}`;
        const project = await importProject(projectPath);
        if (project) {
          setProjects((prev) => {
            const idx = prev.findIndex((p) => p.path === project.path);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = project;
              return copy;
            }
            return [project, ...prev];
          });
          showToast("success", t("launcher.importSuccess", { name: project.meta.name }));
        }
      } catch (e) {
        showToast("error", t("launcher.importFailed", { error: String(e) }));
      }
      setImportArchiveOpen(false);
    },
    [t, showToast]
  );

  const handleBrowseScanDir = useCallback(async () => {
    try {
      const dir = await pickDirectory();
      if (dir) setScanDir(dir);
    } catch {
      // 用户取消选择，静默忽略
    }
  }, []);

  // 启动时关闭已有项目（从 workspace 返回场景）
  useEffect(() => {
    closeProject();
  }, [closeProject]);

  // 从 package.json 读取版本号
  useEffect(() => {
    import("../../package.json")
      .then((pkg) => {
        if (pkg.version) setAppVersion(pkg.version);
      })
      .catch((e) => console.warn("读取版本号失败:", e));
  }, []);

  // 从 localStorage 恢复扫描目录并自动扫描
  useEffect(() => {
    const savedDir = localStorage.getItem(SCAN_DIR_KEY);
    if (savedDir) {
      setScanDir(savedDir);
      (async () => {
        setLoading(true);
        try {
          const list = await scanProjects(savedDir);
          setProjects(list);
        } catch {
          // 静默失败
        } finally {
          setLoading(false);
        }
      })();
    }
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

  // 持久化扫描目录
  useEffect(() => {
    if (scanDir) {
      localStorage.setItem(SCAN_DIR_KEY, scanDir);
    }
  }, [scanDir]);

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects;
    const q = searchQuery.toLowerCase();
    return projects.filter(
      (p) =>
        p.meta.name.toLowerCase().includes(q) ||
        p.meta.author.toLowerCase().includes(q)
    );
  }, [projects, searchQuery]);

  // 按更新时间排序
  const sortedProjects = useMemo(() => {
    return [...filteredProjects].sort((a, b) =>
      b.meta.updated_at.localeCompare(a.meta.updated_at)
    );
  }, [filteredProjects]);

  const formatWordCount = useCallback((n: number) => {
    if (n >= 10000) return `${(n / 10000).toFixed(1)}${t("launcher.wanWords")}`;
    return `${n}${t("launcher.wordUnit")}`;
  }, [t]);

  const formatTimeAgo = useCallback((ts: string) => {
    const now = Date.now();
    const diff = now - new Date(ts).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t("launcher.justNow");
    if (minutes < 60) return t("launcher.minutesAgo", { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("launcher.hoursAgo", { n: hours });
    const days = Math.floor(hours / 24);
    if (days < 30) return t("launcher.daysAgo", { n: days });
    const months = Math.floor(days / 30);
    if (months < 12) return t("launcher.monthsAgo", { n: months });
    const years = Math.floor(months / 12);
    return t("launcher.yearsAgo", { n: years });
  }, [t]);

  /**
   * 格式化创建时间为 YYYY-MM-DD 简洁日期格式
   * 输入: ISO 8601 时间字符串
   * 输出: YYYY-MM-DD 格式字符串,解析失败时返回空字符串
   */
  const formatCreatedDate = useCallback((ts: string) => {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return "";
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    } catch {
      return "";
    }
  }, []);

  const toProjectData = useCallback((p: ProjectInfo): ProjectData => {
    const typeI18nMap: Record<string, string> = {
      epic: t("launcher.typeEpic"),
      standard: t("launcher.typeStandard"),
      essay: t("launcher.typeEssay"),
      script: t("launcher.typeScript"),
      wuxia: t("launcher.typeWuxia"),
      scifi: t("launcher.typeScifi"),
      mystery: t("launcher.typeMystery"),
      romance: t("launcher.typeRomance"),
      short_story: t("launcher.typeShortStory"),
      diary: t("launcher.typeDiary"),
      dialogue: t("launcher.typeDialogue"),
      multi_volume: t("launcher.typeMultiVolume"),
      shared_world: t("launcher.typeSharedWorld"),
      screenplay: t("launcher.typeScreenplay"),
      poetry: t("launcher.typePoetry"),
      // 兼容旧版 Rust 后端 format!("{:?}").to_lowercase() 产生的无下划线格式
      shortstory: t("launcher.typeShortStory"),
      multivolume: t("launcher.typeMultiVolume"),
      sharedworld: t("launcher.typeSharedWorld"),
    };
    const typeColors: Record<string, string> = {
      epic: "bg-fandex-tertiary/10 text-fandex-tertiary border-fandex-tertiary/30",
      standard: "bg-fandex-primary/10 text-fandex-primary border-fandex-primary/30",
      essay: "bg-fandex-secondary/10 text-fandex-secondary border-fandex-secondary/30",
      script: "bg-fandex-primary/10 text-fandex-primary border-fandex-primary/30",
      wuxia: "bg-fandex-tertiary/10 text-fandex-tertiary border-fandex-tertiary/30",
      scifi: "bg-fandex-secondary/10 text-fandex-secondary border-fandex-secondary/30",
      mystery: "bg-fandex-primary/10 text-fandex-primary border-fandex-primary/30",
      romance: "bg-fandex-tertiary/10 text-fandex-tertiary border-fandex-tertiary/30",
      short_story: "bg-fandex-primary/10 text-fandex-primary border-fandex-primary/30",
      diary: "bg-fandex-secondary/10 text-fandex-secondary border-fandex-secondary/30",
      dialogue: "bg-fandex-tertiary/10 text-fandex-tertiary border-fandex-tertiary/30",
      multi_volume: "bg-fandex-primary/10 text-fandex-primary border-fandex-primary/30",
      shared_world: "bg-fandex-secondary/10 text-fandex-secondary border-fandex-secondary/30",
      screenplay: "bg-fandex-tertiary/10 text-fandex-tertiary border-fandex-tertiary/30",
      poetry: "bg-fandex-primary/10 text-fandex-primary border-fandex-primary/30",
      // 兼容旧版无下划线格式
      shortstory: "bg-fandex-primary/10 text-fandex-primary border-fandex-primary/30",
      multivolume: "bg-fandex-primary/10 text-fandex-primary border-fandex-primary/30",
      sharedworld: "bg-fandex-secondary/10 text-fandex-secondary border-fandex-secondary/30",
    };
    const gradients: Record<string, string> = {
      epic: "from-fandex-tertiary to-fandex-tertiary/40",
      standard: "from-fandex-primary to-fandex-primary/40",
      essay: "from-fandex-secondary to-fandex-secondary/40",
      script: "from-fandex-primary to-fandex-primary/40",
      wuxia: "from-fandex-tertiary to-fandex-tertiary/40",
      scifi: "from-fandex-secondary to-fandex-secondary/40",
      mystery: "from-fandex-primary to-fandex-primary/40",
      romance: "from-fandex-tertiary to-fandex-tertiary/40",
      short_story: "from-fandex-primary to-fandex-primary/40",
      diary: "from-fandex-secondary to-fandex-secondary/40",
      dialogue: "from-fandex-tertiary to-fandex-tertiary/40",
      multi_volume: "from-fandex-primary to-fandex-primary/40",
      shared_world: "from-fandex-secondary to-fandex-secondary/40",
      screenplay: "from-fandex-tertiary to-fandex-tertiary/40",
      poetry: "from-fandex-primary to-fandex-primary/40",
      // 兼容旧版无下划线格式
      shortstory: "from-fandex-primary to-fandex-primary/40",
      multivolume: "from-fandex-primary to-fandex-primary/40",
      sharedworld: "from-fandex-secondary to-fandex-secondary/40",
    };
    return {
      id: p.path,
      name: p.meta.name,
      type: typeI18nMap[p.meta.type] || p.meta.type,
      typeColor: typeColors[p.meta.type] || "bg-nf-bg-hover text-nf-text-secondary border-nf-border",
      words: formatWordCount(p.word_count),
      chapters: p.chapter_count,
      updated: formatTimeAgo(p.meta.updated_at),
      gradient: gradients[p.meta.type] || "from-nf-border to-nf-border/40",
      // 透传元数据字段,供卡片展示详细信息
      author: p.meta.author || "",
      description: p.meta.description || "",
      genre: p.meta.genre || "",
      // 创建时间格式化为 YYYY-MM-DD 供卡片展示
      createdAt: formatCreatedDate(p.meta.created_at),
    };
  }, [t, formatWordCount, formatTimeAgo, formatCreatedDate]);

  const handleCreateSuccess = useCallback(async (projectPath: string) => {
    setShowCreateDialog(false);
    setTypePanelExpanded(false);
    setSelectedCustomTemplate(null);
    try {
      // 创建成功后将项目导入列表,但不自动跳转工作台
      // 用户停留在主页,通过点击项目卡片主动进入,符合"先创建后选择"的交互预期
      const project = await importProject(projectPath);
      setProjects((prev) => {
        const idx = prev.findIndex((p) => p.path === projectPath);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = project;
          return copy;
        }
        return [project, ...prev];
      });
      showToast("success", t("launcher.createSuccess"));
    } catch (e) {
      showToast("error", t("launcher.importFailed", { error: String(e) }));
    }
  }, [t, showToast]);

  // 点击"新建项目"按钮：切换类型选择面板
  const handleNewProjectClick = useCallback(() => {
    setTypePanelExpanded((prev) => !prev);
  }, []);

  // 选择文体类型后打开创建对话框
  const handleTypeSelect = useCallback((typeId: ProjectType) => {
    setSelectedType(typeId);
    setSelectedCustomTemplate(null);
    setShowCreateDialog(true);
  }, []);

  // 选择自定义模板后打开创建对话框
  const handleCustomTemplateSelect = useCallback((template: CustomTemplate) => {
    setSelectedCustomTemplate(template);
    setSelectedType("standard"); // 自定义模板基于 standard 类型
    setShowCreateDialog(true);
  }, []);

  // 删除项目处理
  const handleDeleteProject = useCallback((project: ProjectInfo) => {
    setDeleteTarget(project);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    const project = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteProject(project.path);
      setProjects((prev) => prev.filter((p) => p.path !== project.path));
      showToast("success", t("project.deleteSuccess", { name: project.meta.name }));
    } catch (e) {
      showToast("error", t("project.deleteFailed", { error: String(e) }));
    }
  }, [deleteTarget, t, showToast]);

  /**
   * 编辑项目设定成功回调
   * 输入: updated 后端返回的最新 ProjectInfo
   * 输出: 无
   * 流程: 关闭对话框 + 用最新信息替换列表中对应项 + 提示成功
   */
  const handleEditSuccess = useCallback((updated: ProjectInfo) => {
    setEditTarget(null);
    setProjects((prev) =>
      prev.map((p) => (p.path === updated.path ? updated : p))
    );
    showToast("success", t("project.editSuccess"));
  }, [t, showToast]);

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
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 80% 60% at 70% 20%, rgba(124, 158, 255, 0.04), transparent)',
      }} />

      {/* 左侧品牌栏 - 优化布局 */}
      <aside className="w-72 bg-nf-bg-sidebar border-r border-nf-border-light flex flex-col flex-shrink-0 relative z-10">
        {/* 顶部渐变装饰条 */}
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{
          background: 'linear-gradient(90deg, var(--fandex-primary), var(--fandex-secondary), var(--fandex-tertiary))',
        }} />

        {/* 品牌区域 - 入口按钮(点击展开创建面板) + 小点装饰 */}
        <div className="px-6 pt-8 pb-6 relative overflow-hidden">
          <div className="flex items-center gap-2.5 mb-1.5 relative z-[2]">
            {/* 品牌图标容器:右上角小点装饰 */}
            <div className="relative p-2 bg-fandex-primary/10">
              <PenLine className="w-5 h-5 text-fandex-primary" />
              {/* 小点装饰图案:不占位,绝对定位右上角 */}
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-fandex-secondary" />
              <span className="absolute -top-0.5 -right-2.5 w-1 h-1 rounded-full bg-fandex-tertiary/70" />
            </div>
            <div>
              {/* 品牌名:主显示使用中文「喵创说」,增强可读性与品牌识别 */}
              <h1 className="text-lg font-bold font-display text-nf-text tracking-tight">
                喵创说
              </h1>
              {/* 副标题:使用拼音/英文标识,避免与品牌名重复,符合国际命名规范 */}
              <p className="text-[10px] text-nf-text-tertiary">
                {t("launcher.subtitle")}
              </p>
            </div>
          </div>
          {/* logo 右侧空白装饰图案:呼应品牌笔与点,不影响文字排版
           * 由斜线矩阵 + 渐变小点构成,极低透明度,纯视觉点缀 */}
          <svg
            className="nf-logo-decor"
            viewBox="0 0 90 60"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            {/* 斜线矩阵:精致科技感,呼应品牌几何美学 */}
            {Array.from({ length: 5 }).map((_, i) => (
              <line
                key={i}
                x1={20 + i * 14}
                y1={10}
                x2={10 + i * 14}
                y2={50}
                stroke="currentColor"
                strokeWidth="0.6"
                className="text-fandex-primary"
                opacity={0.5 - i * 0.08}
              />
            ))}
            {/* 渐变小点:星光点缀,呼应品牌图标右上角小点 */}
            <circle cx="78" cy="14" r="1.5" className="text-fandex-secondary" fill="currentColor" />
            <circle cx="84" cy="22" r="1" className="text-fandex-tertiary" fill="currentColor" opacity="0.7" />
            <circle cx="80" cy="32" r="0.8" className="text-fandex-primary" fill="currentColor" opacity="0.5" />
          </svg>
        </div>

        {/* 新建项目按钮 + 类型选择面板 */}
        <div className="px-4 space-y-2 flex flex-col flex-1 min-h-0">
          <button
            onClick={handleNewProjectClick}
            className="nf-btn-shine group w-full flex items-center gap-2.5 px-4 py-3 bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse font-medium text-sm transition-all duration-base ease-fandex shadow-sm hover:shadow-md"
          >
            <BookOpen className="w-4 h-4 transition-transform duration-base ease-fandex group-hover:scale-110" />
            {t("launcher.createNew")}
            {/* 箭头:展开时旋转 90 度朝下,悬停时额外右移,增强方向感 */}
            <ArrowRight className={`w-3.5 h-3.5 ml-auto transition-transform duration-base ease-fandex group-hover:translate-x-0.5 ${typePanelExpanded ? 'rotate-90' : ''}`} />
          </button>

          {/* 文体类型选择面板 - 展开式 */}
          <div className={`overflow-hidden transition-all duration-300 ease-fandex flex flex-col ${
            typePanelExpanded ? 'flex-1 min-h-0 opacity-100' : 'max-h-0 opacity-0'
          }`}>
            <div className="border border-nf-border-light bg-nf-bg/50 mt-2 flex flex-col flex-1 min-h-0">
              <div className="flex items-center justify-between px-3 py-2 border-b border-nf-border-light/50 flex-shrink-0">
                <span className="text-xs font-semibold text-nf-text-secondary">
                  {t("project.formTypeLabel")}
                </span>
                <button
                  onClick={() => setTypePanelExpanded(false)}
                  className="p-0.5 text-nf-text-tertiary hover:text-nf-text transition duration-fast"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="p-1.5 overflow-y-auto flex-1 space-y-0.5">
                {PROJECT_TEMPLATES.map((tpl) => {
                  const Icon = TYPE_ICONS[tpl.id] || FileText;
                  return (
                    <button
                      key={tpl.id}
                      onClick={() => handleTypeSelect(tpl.id)}
                      className={`w-full flex items-start gap-2.5 px-2.5 py-2 text-left transition-all duration-fast hover:bg-fandex-primary/10 group ${
                        selectedType === tpl.id ? 'bg-fandex-primary/5' : ''
                      }`}
                    >
                      <Icon className="w-4 h-4 text-fandex-primary/70 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium font-display text-nf-text group-hover:text-fandex-primary transition-colors">
                          {tpl.name}
                        </div>
                        <div className="text-[11px] text-nf-text-tertiary mt-0.5 line-clamp-2 leading-relaxed">
                          {tpl.desc}
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* 自定义模板分隔线 */}
                {customTemplates.length > 0 && (
                  <div className="mx-1 my-1.5 border-t border-nf-border-light/40" />
                )}

                {/* 自定义模板列表 */}
                {customTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => handleCustomTemplateSelect(tpl)}
                    className="w-full flex items-start gap-2.5 px-2.5 py-2 text-left transition-all duration-fast hover:bg-fandex-secondary/10 group"
                  >
                    <Layers className="w-4 h-4 text-fandex-secondary/70 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium font-display text-nf-text group-hover:text-fandex-secondary transition-colors">
                        {tpl.name}
                      </div>
                      <div className="text-[11px] text-nf-text-tertiary mt-0.5 line-clamp-2 leading-relaxed">
                        {tpl.description || tpl.directories.join("、")}
                      </div>
                    </div>
                  </button>
                ))}

                {/* 管理自定义模板按钮 */}
                <div className="mx-1 my-1.5 border-t border-nf-border-light/40" />
                <button
                  onClick={() => setShowTemplateManager(true)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-all duration-fast hover:bg-nf-bg-hover group"
                >
                  <Settings className="w-4 h-4 text-nf-text-tertiary mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-nf-text-tertiary group-hover:text-nf-text-secondary transition-colors">
                      {t("template.manageTemplates")}
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* 导入按钮 */}
          <button
            onClick={handleImport}
            className="nf-icon-slide nf-border-glow w-full flex items-center gap-2.5 px-4 py-2.5 text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover border border-nf-border-light hover:border-fandex-primary/40 text-sm transition-all duration-base ease-fandex"
          >
            <FolderOpen className="w-4 h-4" />
            {t("launcher.importLocal")}
          </button>

          {/* 从压缩包导入按钮 */}
          <button
            onClick={() => setImportArchiveOpen(true)}
            className="nf-icon-slide nf-border-glow nf-border-glow-secondary w-full flex items-center gap-2.5 px-4 py-2.5 text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover border border-nf-border-light hover:border-fandex-secondary/40 text-sm transition-all duration-base ease-fandex"
          >
            <FileArchive className="w-4 h-4" />
            {t("archive.importTitle")}
          </button>
        </div>

        {/* 扫描目录区域 */}
        <div className="px-4 pt-6 pb-4 mt-auto">
          <div className="flex items-center gap-1.5 text-xs text-nf-text-tertiary mb-2">
            <FolderSync className="w-3.5 h-3.5" />
            <span className="font-medium">{t("launcher.setScanDir")}</span>
          </div>
          <div className="flex items-center gap-1.5 mb-2">
            <input
              type="text"
              value={scanDir}
              onChange={(e) => setScanDir(e.target.value)}
              placeholder={t("launcher.scanDirPlaceholder")}
              className="flex-1 bg-nf-bg border border-nf-border-light px-2.5 py-2 text-xs text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
            />
            <button
              onClick={handleBrowseScanDir}
              title={t("launcher.scanDirPlaceholder")}
              className="nf-icon-spin nf-border-glow flex-shrink-0 p-2 text-xs text-nf-text-tertiary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/40 hover:bg-nf-bg-hover transition duration-fast"
            >
              <FolderSearch className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={handleScan}
              disabled={!scanDir || loading}
              className="nf-btn-shine group flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 transition-transform duration-500 ease-out group-hover:rotate-[360deg]" />
              )}
              {t("launcher.scanDir")}
            </button>
            {scanDir && (
              <button
                onClick={() => {
                  setScanDir("");
                  setProjects([]);
                  localStorage.removeItem(SCAN_DIR_KEY);
                }}
                className="px-3 py-2 text-xs text-nf-text-tertiary hover:text-nf-text border border-nf-border-light hover:bg-nf-bg-hover transition duration-fast"
              >
                {t("launcher.changeDir")}
              </button>
            )}
          </div>
        </div>

        {/* 版本与状态信息:绿点状态指示 + 结构化版本/离线标识 */}
        <div className="px-6 pb-4">
          <div className="flex items-center gap-2 mb-1">
            {/* 状态指示绿点:带柔和呼吸光晕 */}
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60 animate-ping opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
            <span className="text-[10px] font-medium text-nf-text-secondary tracking-wide">
              {t("launcher.statusReady")}
            </span>
            <span className="text-[10px] text-nf-text-tertiary/40">·</span>
            <span className="text-[10px] text-nf-text-tertiary tracking-wide">
              {t("launcher.statusOffline")}
            </span>
          </div>
          <p className="text-[10px] text-nf-text-tertiary/70 tabular-nums tracking-wide">
            {t("launcher.statusVersion")} v{appVersion}
          </p>
        </div>
      </aside>

      {/* 右侧主区域 */}
      <main className="flex-1 flex flex-col overflow-hidden relative z-10 animate-fade-in bg-nf-bg">
        {/* 主区域背景装饰图案:不影响功能与显示,极低透明度
         * 右上角网格点阵 + 左下角同心圆,营造空间纵深感与质感统一 */}
        <div className="nf-bg-grid-dots" aria-hidden="true" />
        <svg
          className="nf-bg-rings"
          viewBox="0 0 320 320"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* 同心圆装饰:层次递进,呼应项目卡片同心圆图案 */}
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
            {/* 外观入口:打开设置对话框并定位到外观分区
                替代原昼夜/阳光主题快速切换按钮,因当前预设主题不止三种,
                快速切换会与多预设主题产生冲突,统一改为入口形式 */}
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
            {/* 快捷键参考入口(介绍页面):复用全局 ShortcutPanel,弥补主界面无入口 */}
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
            {/* 窗口控制组:全屏切换 + 退出软件,独立成组置于最右 */}
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

        {/* 项目列表区域 */}
        <div className="flex-1 overflow-y-auto p-8">
          {loading ? (
            <ProjectGridSkeleton count={6} />
          ) : !hasProjects && !isSearching ? (
            <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in">
              <div className="w-20 h-20 mb-5 bg-nf-bg-card border border-nf-border-light flex items-center justify-center">
                <BookOpen className="w-9 h-9 text-nf-border" />
              </div>
              <p className="text-nf-text-secondary font-medium text-base mb-2">
                {t("launcher.noProjects")}
              </p>
              {/* 文本提示:引导用户使用左侧创建按钮,不再放置冗余按钮 */}
              <p className="text-sm text-nf-text-tertiary max-w-sm">
                {t("launcher.welcomeHint")}
              </p>
            </div>
          ) : isSearching && !hasSearchResults ? (
            <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in">
              <div className="w-20 h-20 mb-5 bg-nf-bg-card border border-nf-border-light flex items-center justify-center">
                <Search className="w-9 h-9 text-nf-border" />
              </div>
              <p className="text-nf-text-secondary font-medium text-base mb-2">
                {t("launcher.noSearchResults", { query: searchQuery })}
              </p>
            </div>
          ) : (
            <section className="animate-slide-up">
              <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text mb-6">
                {t("launcher.recentProjectsCount", { count: sortedProjects.length })}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {sortedProjects.map((p, idx) => (
                  <div
                    key={p.path}
                    className="nf-rise-in"
                    style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
                  >
                    <ProjectCard
                      project={toProjectData(p)}
                      projectInfo={p}
                      onDelete={handleDeleteProject}
                      onEdit={setEditTarget}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      {/* 创建项目对话框 - 传入预选类型或自定义模板,以及扫描目录作为默认存储路径 */}
      {showCreateDialog && (
        <CreateProjectDialog
          defaultType={selectedType}
          customTemplate={selectedCustomTemplate}
          defaultPath={scanDir}
          onClose={() => { setShowCreateDialog(false); setSelectedCustomTemplate(null); }}
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

      {/* 编辑项目设定对话框：由项目卡片右键菜单"编辑"触发 */}
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

      {/* 首次欢迎页：首次启动自动弹出，主页"回顾"按钮可重新打开 */}
      <WelcomeDialog open={welcomeOpen} onClose={() => setWelcomeOpen(false)} />

      {/* 启动时自动检查更新提示（仅当检测到新版本时显示） */}
      <UpdateNoticeDialog
        open={autoCheckDialogOpen}
        onClose={() => setAutoCheckDialogOpen(false)}
        currentVersion={appVersion}
        release={autoCheckRelease}
        onSkip={(version) => setSkipUpdateVersion(version)}
      />

      {/* 设置对话框：主页右上角入口按钮触发，支持定位到指定分区 */}
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialSection={settingsInitialSection}
      />
    </div>
  );
}
