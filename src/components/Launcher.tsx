// 启动器页面
//
// 功能概述：
// NovelForge 的入口页面，支持创建新项目、导入已有项目、
// 扫描目录下的项目列表、搜索过滤和最近创作项目展示。
// 采用 FANDEX 直角美学与品牌色。
//
// 模块职责：
// 1. 项目扫描与导入
// 2. 最近项目列表展示
// 3. 搜索过滤
// 4. 启动创建项目对话框

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
} from "lucide-react";
import { useAppStore } from "../lib/store";
import {
  scanProjects,
  importProject,
  pickDirectory,
  type ProjectInfo,
} from "../lib/api";
import ProjectCard, { type ProjectData } from "./ProjectCard";
import CreateProjectDialog from "./CreateProjectDialog";
import { ProjectGridSkeleton } from "./SkeletonComponents";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";

const SCAN_DIR_KEY = "novelforge:scanDir:v1";

export default function Launcher() {
  const openProject = useAppStore((s) => s.openProject);
  const closeProject = useAppStore((s) => s.closeProject);
  const { t } = useI18n();
  const { showToast } = useToast();
  const [scanDir, setScanDir] = useState("");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [appVersion, setAppVersion] = useState("1.4.0"); // 默认值

  const handleScan = useCallback(async () => {
    if (!scanDir) return;
    setLoading(true);
    try {
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
      if (!dir) return; // 用户取消选择
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

  // 从 package.json 读取版本号（而非硬编码）
  useEffect(() => {
    import("../../package.json")
      .then((pkg) => {
        if (pkg.version) setAppVersion(pkg.version);
      })
      .catch(() => {
        // 保持默认值
      });
  }, []);

  // 从 localStorage 恢复扫描目录并自动扫描
  useEffect(() => {
    const savedDir = localStorage.getItem(SCAN_DIR_KEY);
    if (savedDir) {
      setScanDir(savedDir);
      // 自动触发扫描
      (async () => {
        setLoading(true);
        try {
          const list = await scanProjects(savedDir);
          setProjects(list);
        } catch {
          // 静默失败，用户可手动重试
        } finally {
          setLoading(false);
        }
      })();
    }
  }, []);

  // 持久化扫描目录到 localStorage
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

  const recentProjects = useMemo(() => {
    return [...filteredProjects]
      .sort((a, b) => b.meta.updated_at.localeCompare(a.meta.updated_at))
      .slice(0, 9);
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
    };
  }, [t, formatWordCount, formatTimeAgo]);

  const handleCreateSuccess = useCallback(async (projectPath: string) => {
    setShowCreateDialog(false);
    try {
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
      // 自动打开新创建的项目
      openProject(project);
    } catch (e) {
      showToast("error", t("launcher.importFailed", { error: String(e) }));
    }
  }, [openProject, t, showToast]);

  const hasProjects = projects.length > 0;
  const hasSearchResults = recentProjects.length > 0;
  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="flex h-screen bg-nf-bg overflow-hidden">
      {/* 左侧品牌栏 */}
      <aside className="w-64 bg-nf-bg-sidebar border-r border-nf-border-light flex flex-col flex-shrink-0">
        <div className="px-6 pt-12 pb-8">
          <div className="flex items-center gap-2 mb-1">
            <PenLine className="w-5 h-5 text-fandex-primary" />
            <h1 className="text-xl font-bold font-display text-nf-text tracking-tight">
              {t("launcher.title")}
            </h1>
          </div>
          <p className="text-xs text-nf-text-tertiary mt-1">
            {t("launcher.subtitle")}
          </p>
        </div>

        <nav className="flex-1 px-4 space-y-1">
          <button
            onClick={() => setShowCreateDialog(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse font-medium text-sm transition duration-fast"
          >
            <BookOpen className="w-4 h-4" />
            {t("launcher.createNew")}
            <ArrowRight className="w-3.5 h-3.5 ml-auto" />
          </button>
          <button
            onClick={handleImport}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover border border-nf-border-light hover:border-fandex-primary/40 text-sm transition duration-fast"
          >
            <FolderOpen className="w-4 h-4" />
            {t("launcher.importLocal")}
          </button>
        </nav>

        <div className="px-4 pb-4 space-y-1.5">
          <div className="flex items-center gap-1 text-xs text-nf-text-tertiary mb-1">
            <FolderSync className="w-3 h-3" />
            {t("launcher.setScanDir")}
          </div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={scanDir}
              onChange={(e) => setScanDir(e.target.value)}
              placeholder={t("launcher.scanDirPlaceholder")}
              className="flex-1 bg-nf-bg border border-nf-border-light px-2.5 py-1.5 text-xs text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60"
            />
            <button
              onClick={handleBrowseScanDir}
              title={t("launcher.scanDirPlaceholder")}
              className="flex-shrink-0 px-2 py-1.5 text-xs text-nf-text-tertiary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/40 hover:bg-nf-bg-hover transition duration-fast"
            >
              <FolderSearch className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex gap-1">
            <button
              onClick={handleScan}
              disabled={!scanDir || loading}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast disabled:opacity-40"
            >
              {loading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
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
                className="px-2 py-1.5 text-xs text-nf-text-tertiary hover:text-nf-text border border-nf-border-light hover:bg-nf-bg-hover transition duration-fast"
              >
                {t("launcher.changeDir")}
              </button>
            )}
          </div>
        </div>

        <div className="px-6 pb-4">
          <p className="text-[10px] text-nf-text-tertiary">
            {t("launcher.localReady")} (v{appVersion})
          </p>
        </div>
      </aside>

      {/* 右侧主区域 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-8 py-5 border-b border-nf-border-light bg-nf-bg">
          <div>
            <h2 className="text-lg font-bold font-display text-nf-text">
              {t("launcher.welcome")}
            </h2>
            <p className="text-xs text-nf-text-tertiary mt-0.5">
              {t("launcher.welcomeHint")}
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-nf-text-tertiary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("launcher.searchPlaceholder")}
              className="w-64 bg-nf-bg-sidebar border border-nf-border-light pl-9 pr-8 py-1.5 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60"
            />
            {isSearching && (
              <button
                onClick={() => setSearchQuery("")}
                title={t("launcher.clearSearch")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-nf-text-tertiary hover:text-nf-text transition duration-fast"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          {loading ? (
            <ProjectGridSkeleton count={6} />
          ) : !hasProjects && !isSearching ? (
            <div className="text-center py-12 text-nf-text-tertiary text-sm">
              <BookOpen className="w-12 h-12 text-nf-border mx-auto mb-3" />
              {t("launcher.noProjects")}
            </div>
          ) : isSearching && !hasSearchResults ? (
            <div className="text-center py-12 text-nf-text-tertiary text-sm">
              <Search className="w-12 h-12 text-nf-border mx-auto mb-3" />
              {t("launcher.noSearchResults", { query: searchQuery })}
            </div>
          ) : (
            <section className="mb-10">
              <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text mb-4">
                {t("launcher.recentProjectsCount", { count: recentProjects.length })}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {recentProjects.map((p) => (
                  <ProjectCard
                    key={p.path}
                    project={toProjectData(p)}
                    projectInfo={p}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      {showCreateDialog && (
        <CreateProjectDialog
          onClose={() => setShowCreateDialog(false)}
          onSuccess={handleCreateSuccess}
        />
      )}
    </div>
  );
}
