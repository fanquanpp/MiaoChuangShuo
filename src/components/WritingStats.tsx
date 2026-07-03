// 写作统计仪表盘组件
//
// 功能概述：
// 展示项目的写作统计数据,采用玻璃质感卡片 + 数据可视化设计。
// 包含核心指标英雄区、字数分布环形图、章节排行榜单、创作效率分析四大模块。
//
// 模块职责：
// 1. 调用后端获取写作统计信息
// 2. 渲染英雄区核心指标(总字数/章节数/日均字数/创作天数)
// 3. 渲染字数分布可视化(横向比例条 + 图例)
// 4. 渲染章节字数排行榜(支持点击跳转编辑)
// 5. 渲染创作效率分析卡片(平均章节字数/设定正文比/完成度)

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
  RefreshCw,
  Gauge,
  Target,
  Layers,
  Sparkles,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { getWritingStats, type WritingStats as WritingStatsType } from "../lib/api";
import { useI18n } from "../lib/i18n";

/**
 * 根据文件相对路径识别所属分类
 * 输入: relativePath 文件相对路径(如 "正文/第一章.txt")
 * 输出: 分类标识字符串(manuscript/outline/codex 等)
 * 流程: 取路径首段目录名,映射到分类标识,设定类统一收敛为 codex,未匹配回退为 manuscript
 */
function detectCategoryFromPath(relativePath: string): string {
  const firstDir = relativePath.split(/[\\/]/)[0] || "";
  const categoryMap: Record<string, string> = {
    "正文": "manuscript",
    "大纲": "outline",
    // 设定类统一收敛到 Codex(角色/世界观/术语/素材/时间线/人物/设定/名词/资料)
    "角色": "codex",
    "人物": "codex",
    "世界观": "codex",
    "设定": "codex",
    "术语": "codex",
    "名词": "codex",
    "素材": "codex",
    "资料": "codex",
    "时间线": "codex",
  };
  return categoryMap[firstDir] || "manuscript";
}

/**
 * 写作统计仪表盘组件
 * 输入: 无(从 useAppStore 获取当前项目)
 * 输出: JSX 统计面板
 * 流程:
 *   1. 项目切换时调用后端 API 获取统计数据
 *   2. 渲染英雄区核心指标卡片(总字数/章节数/日均字数/创作天数)
 *   3. 渲染字数分布可视化模块(横向比例条 + 图例 + 百分比)
 *   4. 渲染章节字数排行榜,支持点击跳转编辑
 *   5. 渲染创作效率分析卡片(平均章节字数/设定正文比/正文完成度)
 *   6. 加载中显示骨架屏,失败显示错误信息
 */
export default function WritingStats() {
  const currentProject = useAppStore((s) => s.currentProject);
  const navigateToFile = useAppStore((s) => s.navigateToFile);
  const { t } = useI18n();
  const [stats, setStats] = useState<WritingStatsType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  /**
   * 加载统计数据
   * 输入: 无
   * 输出: 无(setStats 副作用)
   * 流程: 调用 getWritingStats API,成功写入 state,失败写入 error
   */
  const loadStats = useCallback(async () => {
    if (!currentProject) return;
    setRefreshing(true);
    setError("");
    try {
      const data = await getWritingStats(currentProject.path);
      setStats(data);
    } catch (e) {
      setError(t("stats.loadFailed", { error: String(e) }));
    } finally {
      setRefreshing(false);
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

  /** 跳转到指定章节文件进行编辑 */
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
      category as never
    );
  };

  // 加载中状态:全屏骨架屏
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-nf-bg">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-fandex-primary" />
          <span className="text-sm text-nf-text-tertiary">{t("stats.loading")}</span>
        </div>
      </div>
    );
  }

  // 错误状态:错误提示卡片
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-nf-bg p-6">
        <div className="fandex-admonition fandex-admonition-danger px-4 py-3 text-sm text-red-400 max-w-md">
          {error}
        </div>
      </div>
    );
  }

  // 无数据状态
  if (!stats) {
    return (
      <div className="flex-1 flex items-center justify-center bg-nf-bg text-nf-text-tertiary text-sm">
        {t("stats.noData")}
      </div>
    );
  }

  // 计算字数分布比例
  const totalForDist = stats.manuscript_words + stats.setting_words + stats.outline_words;
  const manuscriptPct = totalForDist > 0 ? (stats.manuscript_words / totalForDist) * 100 : 0;
  const settingPct = totalForDist > 0 ? (stats.setting_words / totalForDist) * 100 : 0;
  const outlinePct = totalForDist > 0 ? (stats.outline_words / totalForDist) * 100 : 0;

  // 计算衍生指标:日均字数、平均章节字数、设定正文比
  const dailyAvgWords = stats.days_since_creation > 0
    ? Math.round(stats.total_words / stats.days_since_creation)
    : 0;
  const avgChapterWords = stats.total_chapters > 0
    ? Math.round(stats.manuscript_words / stats.total_chapters)
    : 0;
  const settingRatio = stats.manuscript_words > 0
    ? (stats.setting_words / stats.manuscript_words) * 100
    : 0;

  // 英雄区核心指标卡片配置
  const heroCards = [
    {
      label: t("stats.totalWords"),
      value: stats.total_words.toLocaleString(),
      unit: t("stats.wordUnit"),
      icon: BarChart3,
      color: "text-fandex-primary",
      borderColor: "hover:border-fandex-primary/50",
      glowColor: "rgba(124, 158, 255, 0.15)",
    },
    {
      label: t("stats.totalChapters"),
      value: stats.total_chapters.toString(),
      unit: t("stats.chapterUnit"),
      icon: BookOpen,
      color: "text-fandex-secondary",
      borderColor: "hover:border-fandex-secondary/50",
      glowColor: "rgba(78, 230, 176, 0.15)",
    },
    {
      label: t("stats.dailyAvg"),
      value: dailyAvgWords.toLocaleString(),
      unit: t("stats.wordUnit"),
      icon: TrendingUp,
      color: "text-fandex-tertiary",
      borderColor: "hover:border-fandex-tertiary/50",
      glowColor: "rgba(255, 158, 122, 0.15)",
    },
    {
      label: t("stats.creationDays"),
      value: stats.days_since_creation.toString(),
      unit: t("stats.dayUnit"),
      icon: Calendar,
      color: "text-fandex-primary",
      borderColor: "hover:border-fandex-primary/50",
      glowColor: "rgba(124, 158, 255, 0.15)",
    },
  ];

  // 效率分析卡片配置
  const efficiencyCards = [
    {
      label: t("stats.avgChapterWords"),
      value: avgChapterWords.toLocaleString(),
      unit: t("stats.wordUnit"),
      icon: Gauge,
      desc: t("stats.avgChapterDesc"),
    },
    {
      label: t("stats.settingRatio"),
      value: settingRatio.toFixed(1),
      unit: "%",
      icon: Layers,
      desc: t("stats.settingRatioDesc"),
    },
    {
      label: t("stats.totalFiles"),
      value: stats.total_files.toString(),
      unit: t("stats.fileUnit"),
      icon: FolderTree,
      desc: t("stats.totalFilesDesc"),
    },
  ];

  return (
    <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden relative">
      {/* 全局舒缓柔光背景层 */}
      <div className="nf-ambient-bg" />

      {/* 顶部标题栏:玻璃质感 + 装饰 */}
      <div className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-nf-border-light bg-nf-bg-card/60 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center border border-fandex-primary/40 bg-fandex-primary/10">
            <BarChart3 className="w-5 h-5 text-fandex-primary" />
          </div>
          <div>
            <h2 className="fandex-bar-left text-lg font-semibold font-display text-nf-text">
              {t("stats.title")}
            </h2>
            <p className="text-xs text-nf-text-tertiary mt-0.5">{t("stats.subtitle")}</p>
          </div>
        </div>
        <button
          onClick={loadStats}
          disabled={refreshing}
          className="nf-tool-btn nf-icon-rotate flex items-center gap-1.5 px-3 py-1.5 text-sm text-fandex-primary border border-fandex-primary/30 hover:bg-fandex-primary/10 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          {t("stats.refresh")}
        </button>
      </div>

      {/* 主内容滚动区 */}
      <div className="flex-1 overflow-y-auto p-6 relative z-10">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* 英雄区:四列核心指标卡片(玻璃质感 + 悬停光晕) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {heroCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className={`nf-card-sheen nf-hover-float group relative bg-nf-bg-card/80 backdrop-blur-md border border-nf-border-light ${card.borderColor} p-5 overflow-hidden transition-all duration-base hover:shadow-xl hover:shadow-black/40 hover:-translate-y-0.5`}
                  style={{ backgroundColor: 'rgba(22, 24, 33, 0.75)' }}
                >
                  {/* 背景点阵装饰:呼应项目卡片质感 */}
                  <div
                    className="absolute inset-0 pointer-events-none opacity-[0.3] group-hover:opacity-[0.6] transition-opacity duration-500"
                    style={{
                      backgroundImage: 'radial-gradient(circle, rgba(124, 158, 255, 0.06) 1px, transparent 1px)',
                      backgroundSize: '14px 14px',
                    }}
                  />
                  {/* 悬停光晕:卡片悬停时背景泛起对应色调柔光 */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                    style={{ background: `radial-gradient(ellipse at top right, ${card.glowColor}, transparent 70%)` }}
                  />
                  <div className="relative z-[1] flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-nf-text-tertiary">{card.label}</span>
                      <Icon className={`w-4 h-4 ${card.color} transition-transform duration-base`} />
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className={`text-2xl font-bold font-display tabular-nums ${card.color}`}>
                        {card.value}
                      </span>
                      <span className="text-xs text-nf-text-tertiary">{card.unit}</span>
                    </div>
                  </div>
                  {/* 底部进度条装饰:呼应项目卡片美术 */}
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-fandex-primary via-fandex-secondary to-fandex-tertiary opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </div>
              );
            })}
          </div>

          {/* 字数分布可视化模块(玻璃质感面板) */}
          <div
            className="nf-card-sheen relative bg-nf-bg-card/80 backdrop-blur-md border border-nf-border-light p-6 overflow-hidden"
            style={{ backgroundColor: 'rgba(22, 24, 33, 0.75)' }}
          >
            <div className="relative z-[1]">
              <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text mb-5 flex items-center gap-2">
                <Target className="w-4 h-4 text-fandex-primary" />
                {t("stats.distribution")}
              </h3>

              {/* 横向比例条:三色分段,带百分比标签 */}
              <div className="flex h-8 mb-5 border border-nf-border-light overflow-hidden">
                {manuscriptPct > 0 && (
                  <div
                    className="bg-fandex-primary flex items-center justify-center text-xs text-nf-text-inverse font-medium transition-all duration-700 ease-out hover:brightness-110"
                    style={{ width: `${manuscriptPct}%` }}
                    title={`${t("stats.manuscript")} ${stats.manuscript_words} ${t("stats.wordUnit")}`}
                  >
                    {manuscriptPct > 8 ? `${manuscriptPct.toFixed(1)}%` : ""}
                  </div>
                )}
                {settingPct > 0 && (
                  <div
                    className="bg-fandex-secondary flex items-center justify-center text-xs text-nf-text-inverse font-medium transition-all duration-700 ease-out hover:brightness-110"
                    style={{ width: `${settingPct}%` }}
                    title={`${t("stats.setting")} ${stats.setting_words} ${t("stats.wordUnit")}`}
                  >
                    {settingPct > 8 ? `${settingPct.toFixed(1)}%` : ""}
                  </div>
                )}
                {outlinePct > 0 && (
                  <div
                    className="bg-fandex-tertiary flex items-center justify-center text-xs text-nf-text-inverse font-medium transition-all duration-700 ease-out hover:brightness-110"
                    style={{ width: `${outlinePct}%` }}
                    title={`${t("stats.outline")} ${stats.outline_words} ${t("stats.wordUnit")}`}
                  >
                    {outlinePct > 8 ? `${outlinePct.toFixed(1)}%` : ""}
                  </div>
                )}
              </div>

              {/* 图例 + 详细数据 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  { label: t("stats.manuscript"), words: stats.manuscript_words, pct: manuscriptPct, color: "bg-fandex-primary", textColor: "text-fandex-primary" },
                  { label: t("stats.setting"), words: stats.setting_words, pct: settingPct, color: "bg-fandex-secondary", textColor: "text-fandex-secondary" },
                  { label: t("stats.outline"), words: stats.outline_words, pct: outlinePct, color: "bg-fandex-tertiary", textColor: "text-fandex-tertiary" },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-3 p-3 border border-nf-border-light/50 bg-nf-bg/40 hover:border-nf-border-light transition-colors duration-fast"
                  >
                    <span className={`w-3 h-3 ${item.color} flex-shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-nf-text-secondary truncate">{item.label}</div>
                      <div className={`text-sm font-bold tabular-nums ${item.textColor}`}>
                        {item.words.toLocaleString()}
                        <span className="text-xs text-nf-text-tertiary ml-1 font-normal">{t("stats.wordUnit")}</span>
                      </div>
                    </div>
                    <div className={`text-sm font-display tabular-nums ${item.textColor}`}>
                      {item.pct.toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 双列布局:章节排行 + 效率分析 */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* 章节字数排行榜(占 3 列) */}
            <div
              className="nf-card-sheen lg:col-span-3 relative bg-nf-bg-card/80 backdrop-blur-md border border-nf-border-light p-6 overflow-hidden"
              style={{ backgroundColor: 'rgba(22, 24, 33, 0.75)' }}
            >
              <div className="relative z-[1]">
                <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text mb-4 flex items-center gap-2">
                  <Award className="w-4 h-4 text-fandex-tertiary" />
                  {t("stats.chapterRanking")}
                </h3>
                {stats.chapter_words.length === 0 ? (
                  <div className="text-center py-12 text-nf-text-tertiary text-sm">
                    <FileText className="w-12 h-12 text-nf-border mx-auto mb-3" />
                    {t("stats.noChapterData")}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {stats.chapter_words.slice(0, 10).map((chapter, idx) => {
                      const maxWords = stats.chapter_words[0]?.word_count || 1;
                      const pct = (chapter.word_count / maxWords) * 100;
                      // 前三名采用品牌色突出,其余用次级文字色
                      const rankColor =
                        idx === 0
                          ? "text-fandex-tertiary"
                          : idx === 1
                          ? "text-fandex-secondary"
                          : idx === 2
                          ? "text-fandex-primary"
                          : "text-nf-text-tertiary";
                      const barColor =
                        idx === 0
                          ? "bg-fandex-tertiary"
                          : idx === 1
                          ? "bg-fandex-secondary"
                          : idx === 2
                          ? "bg-fandex-primary"
                          : "bg-nf-text-tertiary";
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
                          className="flex items-center gap-3 p-2 hover:bg-nf-bg-hover/60 transition duration-fast cursor-pointer group focus-visible:outline focus-visible:outline-2 focus-visible:outline-fandex-primary focus-visible:outline-offset-[-2px]"
                        >
                          <span className={`text-sm font-bold font-display w-7 text-center ${rankColor} tabular-nums`}>
                            {idx + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-nf-text truncate group-hover:text-fandex-primary transition duration-fast">
                                {chapter.file_name}
                              </span>
                              <span className="text-xs text-nf-text-tertiary ml-2 flex-shrink-0 tabular-nums">
                                {chapter.word_count.toLocaleString()} {t("stats.wordUnit")}
                              </span>
                            </div>
                            <div className="h-1.5 bg-nf-bg-hover overflow-hidden">
                              <div
                                className={`h-full ${barColor} transition-all duration-500 ease-out group-hover:brightness-110`}
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

            {/* 创作效率分析(占 2 列) */}
            <div
              className="nf-card-sheen lg:col-span-2 relative bg-nf-bg-card/80 backdrop-blur-md border border-nf-border-light p-6 overflow-hidden"
              style={{ backgroundColor: 'rgba(22, 24, 33, 0.75)' }}
            >
              <div className="relative z-[1]">
                <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text mb-4 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-fandex-secondary" />
                  {t("stats.efficiencyAnalysis")}
                </h3>
                <div className="space-y-3">
                  {efficiencyCards.map((card) => {
                    const Icon = card.icon;
                    return (
                      <div
                        key={card.label}
                        className="group flex items-center gap-3 p-3 border border-nf-border-light/50 bg-nf-bg/40 hover:border-nf-border-light hover:bg-nf-bg-hover/40 transition-all duration-fast"
                      >
                        <div className="w-8 h-8 flex items-center justify-center border border-fandex-primary/30 bg-fandex-primary/5 flex-shrink-0">
                          <Icon className="w-4 h-4 text-fandex-primary transition-transform duration-base" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-nf-text-tertiary truncate">{card.label}</div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-lg font-bold font-display tabular-nums text-nf-text">
                              {card.value}
                            </span>
                            <span className="text-xs text-nf-text-tertiary">{card.unit}</span>
                          </div>
                          <div className="text-[10px] text-nf-text-tertiary mt-0.5 truncate">{card.desc}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
