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
  BookOpen,
  PenLine,
  ArrowRight,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import {
  scanProjects,
  importProject,
  type ProjectInfo,
} from "../lib/api";
import ProjectCard, { type ProjectData } from "./ProjectCard";
import CreateProjectDialog from "./CreateProjectDialog";
import { ProjectGridSkeleton } from "./SkeletonComponents";
import { useI18n } from "../lib/i18n";

export default function Launcher() {
  const { openProject, currentProject, closeProject } = useAppStore();
  const { t } = useI18n();
  const [scanDir, setScanDir] = useState("");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const handleScan = useCallback(async () => {
    if (!scanDir) return;
    setLoading(true);
    try {
      const list = await scanProjects(scanDir);
      setProjects(list);
    } catch (e) {
      console.error(t("launcher.scanFailed"), e);
    } finally {
      setLoading(false);
    }
  }, [scanDir, t]);

  const handleImport = useCallback(async () => {
    try {
      const project = await importProject("");
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
      }
    } catch (e) {
      console.error(t("launcher.importFailed"), e);
    }
  }, [t]);

  useEffect(() => {
    if (currentProject) {
      closeProject();
    }
  }, []);

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

  const formatWordCount = (n: number) => {
    if (n >= 10000) return `${(n / 10000).toFixed(1)}${t("launcher.wanWords")}`;
    return `${n}${t("launcher.wordUnit")}`;
  };

  const formatTimeAgo = (ts: string) => {
    const now = Date.now();
    const diff = now - new Date(ts).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t("launcher.justNow");
    if (minutes < 60) return t("launcher.minutesAgo", { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("launcher.hoursAgo", { n: hours });
    const days = Math.floor(hours / 24);
    if (days < 30) return t("launcher.daysAgo", { n: days });
    return t("launcher.unknownTime");
  };

  const toProjectData = (p: ProjectInfo): ProjectData => {
    const typeNames: Record<string, string> = {
      epic: "西幻史诗", standard: "标准长篇", essay: "散文随笔",
      script: "舞台剧本", wuxia: "武侠江湖", scifi: "科幻未来",
      mystery: "悬疑推理", romance: "言情都市",
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
    };
    return {
      id: p.path,
      name: p.meta.name,
      type: typeNames[p.meta.type] || p.meta.type,
      typeColor: typeColors[p.meta.type] || "bg-nf-bg-hover text-nf-text-secondary border-nf-border",
      words: formatWordCount(p.word_count),
      chapters: p.chapter_count,
      updated: formatTimeAgo(p.meta.updated_at),
      gradient: gradients[p.meta.type] || "from-nf-border to-nf-border/40",
    };
  };

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
            className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse font-medium text-sm transition-fast"
          >
            <BookOpen className="w-4 h-4" />
            {t("launcher.createNew")}
            <ArrowRight className="w-3.5 h-3.5 ml-auto" />
          </button>
          <button
            onClick={handleImport}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover border border-nf-border-light hover:border-fandex-primary/40 text-sm transition-fast"
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
          <input
            type="text"
            value={scanDir}
            onChange={(e) => setScanDir(e.target.value)}
            placeholder="C:\\Users\\..."
            className="w-full bg-nf-bg border border-nf-border-light px-2.5 py-1.5 text-xs text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60"
          />
          <div className="flex gap-1">
            <button
              onClick={handleScan}
              disabled={!scanDir || loading}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition-fast disabled:opacity-40"
            >
              {loading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              {t("launcher.scanDir")}
            </button>
            <button
              onClick={() => setScanDir("")}
              className="px-2 py-1.5 text-xs text-nf-text-tertiary hover:text-nf-text border border-nf-border-light hover:bg-nf-bg-hover transition-fast"
            >
              {t("launcher.changeDir")}
            </button>
          </div>
        </div>

        <div className="px-6 pb-4">
          <p className="text-[10px] text-nf-text-tertiary">
            {t("launcher.localReady")} (v1.0.0)
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
              className="w-64 bg-nf-bg-sidebar border border-nf-border-light pl-9 pr-3 py-1.5 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60"
            />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          {loading ? (
            <ProjectGridSkeleton count={6} />
          ) : (
            <>
              <section className="mb-10">
                <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text mb-4">
                  {t("launcher.recentProjectsCount", { count: recentProjects.length })}
                </h3>
                {recentProjects.length === 0 ? (
                  <div className="text-center py-12 text-nf-text-tertiary text-sm">
                    <BookOpen className="w-12 h-12 text-nf-border mx-auto mb-3" />
                    {t("launcher.noProjects")}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                    {recentProjects.map((p) => (
                      <ProjectCard
                        key={p.path}
                        project={toProjectData(p)}
                        projectInfo={p}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>

      {showCreateDialog && (
        <CreateProjectDialog
          onClose={() => setShowCreateDialog(false)}
          onSuccess={(projectPath: string) => {
            setProjects((prev) => [{ path: projectPath, meta: { name: projectPath.split(/[\\/]/).pop() || "", type: "standard", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: "1.0.0", author: "", description: "", word_count: 0 }, word_count: 0, chapter_count: 0 }, ...prev]);
            setShowCreateDialog(false);
          }}
        />
      )}
    </div>
  );
}
