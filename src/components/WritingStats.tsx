// 写作统计仪表盘组件
//
// 功能概述：
// 展示项目的写作统计数据，包括总字数、章节数、文件数、
// 正文/设定/大纲字数分布、章节字数排行、创作天数等。
// 采用 FANDEX 直角美学与三色品牌体系。
//
// 模块职责：
// 1. 调用后端获取写作统计信息
// 2. 渲染统计卡片网格
// 3. 渲染字数分布比例条
// 4. 渲染章节字数排行榜
// 5. 支持点击章节跳转编辑

import { useState, useEffect, useCallback } from "react";
import {
  BarChart3,
  FileText,
  BookOpen,
  FolderTree,
  Calendar,
  TrendingUp,
  Award,
  Loader2,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { getWritingStats, type WritingStats as WritingStatsType } from "../lib/api";
import { useI18n } from "../lib/i18n";

function detectCategoryFromPath(relativePath: string): string {
  const firstDir = relativePath.split(/[\\/]/)[0] || "";
  const categoryMap: Record<string, string> = {
    "正文": "manuscript",
    "大纲": "outline",
    "角色": "characters",
    "世界观": "worldview",
    "名词": "glossary",
    "素材": "materials",
    "时间线": "timeline",
  };
  return categoryMap[firstDir] || "manuscript";
}

export default function WritingStats() {
  const currentProject = useAppStore((s) => s.currentProject);
  const navigateToFile = useAppStore((s) => s.navigateToFile);
  const { t } = useI18n();
  const [stats, setStats] = useState<WritingStatsType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadStats = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    setError("");
    try {
      const data = await getWritingStats(currentProject.path);
      setStats(data);
    } catch (e) {
      setError(t("stats.loadFailed", { error: String(e) }));
    } finally {
      setLoading(false);
    }
  }, [currentProject, t]);

  useEffect(() => {
    let cancelled = false;
    if (!currentProject) return;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const data = await getWritingStats(currentProject.path);
        if (cancelled) return;
        setStats(data);
      } catch (e) {
        if (cancelled) return;
        setError(t("stats.loadFailed", { error: String(e) }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentProject, t]);

  const handleJumpToChapter = (relativePath: string) => {
    if (!currentProject) return;
    const fileName = relativePath.split(/[\\/]/).pop() || relativePath;
    const category = detectCategoryFromPath(relativePath);
    navigateToFile(
      {
        name: fileName,
        relative_path: relativePath,
        is_dir: false,
        children: [],
        size: 0,
      },
      category as any
    );
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-nf-bg">
        <Loader2 className="w-6 h-6 animate-spin text-fandex-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-nf-bg">
        <div className="fandex-admonition fandex-admonition-danger px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex-1 flex items-center justify-center bg-nf-bg text-nf-text-tertiary text-sm">
        {t("stats.noData")}
      </div>
    );
  }

  const totalForDist = stats.manuscript_words + stats.setting_words + stats.outline_words;
  const manuscriptPct = totalForDist > 0 ? (stats.manuscript_words / totalForDist) * 100 : 0;
  const settingPct = totalForDist > 0 ? (stats.setting_words / totalForDist) * 100 : 0;
  const outlinePct = totalForDist > 0 ? (stats.outline_words / totalForDist) * 100 : 0;

  const cards = [
    {
      label: t("stats.totalWords"),
      value: stats.total_words.toLocaleString(),
      icon: BarChart3,
      color: "text-fandex-primary",
      barClass: "fandex-bar-left",
    },
    {
      label: t("stats.totalChapters"),
      value: stats.total_chapters.toString(),
      icon: BookOpen,
      color: "text-fandex-secondary",
      barClass: "fandex-bar-left-secondary",
    },
    {
      label: t("stats.totalFiles"),
      value: stats.total_files.toString(),
      icon: FolderTree,
      color: "text-fandex-tertiary",
      barClass: "fandex-bar-left-tertiary",
    },
    {
      label: t("stats.creationDays"),
      value: `${stats.days_since_creation} ${t("stats.dayUnit")}`,
      icon: Calendar,
      color: "text-fandex-primary",
      barClass: "fandex-bar-left",
    },
  ];

  return (
    <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
        <h2 className="fandex-bar-left text-lg font-semibold font-display text-nf-text">
          {t("stats.title")}
        </h2>
        <button
          onClick={loadStats}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-fandex-primary border border-fandex-primary/30 hover:bg-fandex-primary/10 transition duration-fast"
        >
          <TrendingUp className="w-4 h-4" />
          {t("stats.refresh")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1 bg-nf-border-light border border-nf-border-light">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className={`${card.barClass} bg-nf-bg-card p-4 flex flex-col gap-2`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-nf-text-tertiary">{card.label}</span>
                    <Icon className={`w-4 h-4 ${card.color}`} />
                  </div>
                  <span className={`text-2xl font-bold font-display ${card.color}`}>
                    {card.value}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="bg-nf-bg-card border border-nf-border-light p-5">
            <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text mb-4">
              {t("stats.distribution")}
            </h3>
            <div className="flex h-6 mb-4 border border-nf-border-light overflow-hidden">
              {manuscriptPct > 0 && (
                <div
                  className="bg-fandex-primary flex items-center justify-center text-xs text-nf-text-inverse font-medium"
                  style={{ width: `${manuscriptPct}%` }}
                  title={`${t("stats.manuscript")} ${stats.manuscript_words} ${t("stats.wordUnit")}`}
                >
                  {manuscriptPct > 10 ? `${manuscriptPct.toFixed(0)}%` : ""}
                </div>
              )}
              {settingPct > 0 && (
                <div
                  className="bg-fandex-secondary flex items-center justify-center text-xs text-nf-text-inverse font-medium"
                  style={{ width: `${settingPct}%` }}
                  title={`${t("stats.setting")} ${stats.setting_words} ${t("stats.wordUnit")}`}
                >
                  {settingPct > 10 ? `${settingPct.toFixed(0)}%` : ""}
                </div>
              )}
              {outlinePct > 0 && (
                <div
                  className="bg-fandex-tertiary flex items-center justify-center text-xs text-nf-text-inverse font-medium"
                  style={{ width: `${outlinePct}%` }}
                  title={`${t("stats.outline")} ${stats.outline_words} ${t("stats.wordUnit")}`}
                >
                  {outlinePct > 10 ? `${outlinePct.toFixed(0)}%` : ""}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 bg-fandex-primary" />
                <span className="text-nf-text-secondary">{t("stats.manuscript")}</span>
                <span className="text-nf-text-tertiary">{stats.manuscript_words.toLocaleString()} {t("stats.wordUnit")}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 bg-fandex-secondary" />
                <span className="text-nf-text-secondary">{t("stats.setting")}</span>
                <span className="text-nf-text-tertiary">{stats.setting_words.toLocaleString()} {t("stats.wordUnit")}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 bg-fandex-tertiary" />
                <span className="text-nf-text-secondary">{t("stats.outline")}</span>
                <span className="text-nf-text-tertiary">{stats.outline_words.toLocaleString()} {t("stats.wordUnit")}</span>
              </div>
            </div>
          </div>

          <div className="bg-nf-bg-card border border-nf-border-light p-5">
            <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text mb-4 flex items-center gap-2">
              <Award className="w-4 h-4 text-fandex-tertiary" />
              {t("stats.chapterRanking")}
            </h3>
            {stats.chapter_words.length === 0 ? (
              <div className="text-center py-8 text-nf-text-tertiary text-sm">
                <FileText className="w-12 h-12 text-nf-border mx-auto mb-2" />
                {t("stats.noChapterData")}
              </div>
            ) : (
              <div className="space-y-1">
                {stats.chapter_words.slice(0, 15).map((chapter, idx) => {
                  const maxWords = stats.chapter_words[0]?.word_count || 1;
                  const pct = (chapter.word_count / maxWords) * 100;
                  const rankColor =
                    idx === 0
                      ? "text-fandex-tertiary"
                      : idx === 1
                      ? "text-fandex-secondary"
                      : idx === 2
                      ? "text-fandex-primary"
                      : "text-nf-text-tertiary";
                  return (
                    <div
                      key={chapter.relative_path}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleJumpToChapter(chapter.relative_path)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleJumpToChapter(chapter.relative_path);
                        }
                      }}
                      className="flex items-center gap-3 p-2 hover:bg-nf-bg-hover transition duration-fast cursor-pointer group focus-visible:outline focus-visible:outline-2 focus-visible:outline-fandex-primary focus-visible:outline-offset-[-2px]"
                    >
                      <span className={`text-xs font-bold font-display w-6 text-center ${rankColor}`}>
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-nf-text truncate group-hover:text-fandex-primary transition duration-fast">
                            {chapter.file_name}
                          </span>
                          <span className="text-xs text-nf-text-tertiary ml-2 flex-shrink-0">
                            {chapter.word_count.toLocaleString()} {t("stats.wordUnit")}
                          </span>
                        </div>
                        <div className="h-1 bg-nf-bg-hover overflow-hidden">
                          <div
                            className={`h-full transition duration-fast ${
                              idx === 0
                                ? "bg-fandex-tertiary"
                                : idx === 1
                                ? "bg-fandex-secondary"
                                : idx === 2
                                ? "bg-fandex-primary"
                                : "bg-nf-text-tertiary"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
