// 伏笔追踪面板组件
//
// 功能概述：
// 扫描项目伏笔目录，以结构化面板展示所有伏笔项的状态追踪。
// 包括统计概览卡片、按状态分组的伏笔列表、点击跳转编辑。
// 采用 FANDEX 直角美学与三色品牌体系。
//
// 模块职责：
// 1. 调用后端 scan_foreshadowing 获取伏笔数据
// 2. 渲染统计概览卡片（总数/未回收/已回收/已废弃）
// 3. 渲染伏笔列表，按状态分组展示
// 4. 支持点击伏笔项跳转到对应文件编辑
// 5. 支持手动刷新

import { useState, useEffect, useCallback } from "react";
import {
  Eye,
  Loader2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  CircleDot,
  ChevronRight,
  FileText,
  MapPin,
  Flag,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { scanForeshadowing, type ForeshadowingSummary as ForeshadowingSummaryType, type ForeshadowingItem } from "../lib/api";
import { useI18n } from "../lib/i18n";

/**
 * 伏笔追踪面板组件
 * 输入: 无（从 useAppStore 获取当前项目）
 * 输出: JSX 伏笔追踪面板
 * 流程:
 *   1. 项目切换时调用后端 API 获取伏笔数据
 *   2. 渲染统计概览卡片（总数/未回收/已回收/已废弃）
 *   3. 渲染伏笔列表，按状态分组，支持展开/折叠详情
 *   4. 点击伏笔项可跳转到对应文件编辑
 */
export default function ForeshadowingPanel() {
  const currentProject = useAppStore((s) => s.currentProject);
  const navigateToFile = useAppStore((s) => s.navigateToFile);
  const { t } = useI18n();
  const [summary, setSummary] = useState<ForeshadowingSummaryType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // 展开的伏笔项名称集合（用于详情展开/折叠）
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /**
   * 加载伏笔数据
   * 输入: 无
   * 输出: 无（设置状态）
   * 流程: 调用 scanForeshadowing API，成功后设置 summary 状态
   */
  const loadData = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    setError("");
    try {
      const data = await scanForeshadowing(currentProject.path);
      setSummary(data);
    } catch (e) {
      setError(t("foreshadowing.loadFailed", { error: String(e) }));
    } finally {
      setLoading(false);
    }
  }, [currentProject, t]);

  // 项目切换时自动加载
  useEffect(() => {
    let cancelled = false;
    if (!currentProject) return;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const data = await scanForeshadowing(currentProject.path);
        if (cancelled) return;
        setSummary(data);
      } catch (e) {
        if (cancelled) return;
        setError(t("foreshadowing.loadFailed", { error: String(e) }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentProject, t]);

  /**
   * 切换伏笔项的展开状态
   * 输入: name 伏笔名称
   */
  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  /**
   * 跳转到伏笔项对应的文件进行编辑
   * 输入: item 伏笔项
   */
  const handleJumpToFile = (item: ForeshadowingItem) => {
    if (!currentProject) return;
    const fileName = item.file_path.split(/[\\/]/).pop() || item.file_path;
    navigateToFile(
      {
        name: fileName,
        relative_path: item.file_path,
        is_dir: false,
        children: [],
        size: 0,
      },
      "foreshadowing" as any
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

  if (!summary) {
    return (
      <div className="flex-1 flex items-center justify-center bg-nf-bg text-nf-text-tertiary text-sm">
        {t("foreshadowing.noData")}
      </div>
    );
  }

  // 统计卡片配置
  const cards = [
    {
      label: t("foreshadowing.total"),
      value: summary.total,
      icon: Eye,
      color: "text-fandex-primary",
      barClass: "fandex-bar-left",
    },
    {
      label: t("foreshadowing.pending"),
      value: summary.pending,
      icon: CircleDot,
      color: "text-fandex-tertiary",
      barClass: "fandex-bar-left-tertiary",
    },
    {
      label: t("foreshadowing.resolved"),
      value: summary.resolved,
      icon: CheckCircle2,
      color: "text-fandex-secondary",
      barClass: "fandex-bar-left-secondary",
    },
    {
      label: t("foreshadowing.abandoned"),
      value: summary.abandoned,
      icon: XCircle,
      color: "text-nf-text-tertiary",
      barClass: "",
    },
  ];

  // 按状态分组的伏笔项
  const pendingItems = summary.items.filter((i) => i.status.trim() === "未回收");
  const resolvedItems = summary.items.filter((i) => i.status.trim() === "已回收");
  const otherItems = summary.items.filter(
    (i) => i.status.trim() !== "未回收" && i.status.trim() !== "已回收"
  );

  /**
   * 渲染单个伏笔项
   * 输入: item 伏笔项, index 索引
   * 输出: JSX 伏笔项行
   */
  const renderItem = (item: ForeshadowingItem, index: number) => {
    const isExpanded = expanded.has(item.name);
    const statusColor =
      item.status.trim() === "已回收"
        ? "text-fandex-secondary"
        : item.status.trim() === "已废弃"
        ? "text-nf-text-tertiary"
        : "text-fandex-tertiary";
    const importanceBadge =
      item.importance.trim() === "高"
        ? "bg-fandex-tertiary/20 text-fandex-tertiary"
        : item.importance.trim() === "中"
        ? "bg-fandex-primary/20 text-fandex-primary"
        : "bg-nf-bg-hover text-nf-text-tertiary";

    return (
      <div
        key={`${item.name}-${index}`}
        className="border-b border-nf-border-light last:border-b-0"
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => toggleExpand(item.name)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleExpand(item.name);
            }
          }}
          className="flex items-center gap-2 p-3 hover:bg-nf-bg-hover transition duration-fast cursor-pointer group focus-visible:outline focus-visible:outline-2 focus-visible:outline-fandex-primary"
        >
          <ChevronRight
            className={`w-3.5 h-3.5 text-nf-text-tertiary flex-shrink-0 transition-transform duration-fast ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
          <span className="text-sm text-nf-text flex-1 truncate group-hover:text-fandex-primary transition duration-fast">
            {item.name}
          </span>
          {item.importance && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${importanceBadge} flex-shrink-0`}>
              {item.importance}
            </span>
          )}
          {item.status && (
            <span className={`text-xs flex-shrink-0 ${statusColor}`}>{item.status}</span>
          )}
        </div>

        {/* 展开后的详情 */}
        {isExpanded && (
          <div className="px-4 pb-3 pl-10 space-y-2">
            {item.plant_location && (
              <div className="flex items-start gap-2 text-xs">
                <MapPin className="w-3 h-3 text-fandex-tertiary flex-shrink-0 mt-0.5" />
                <span className="text-nf-text-tertiary w-12 flex-shrink-0">{t("foreshadowing.plant")}</span>
                <span className="text-nf-text-secondary">{item.plant_location}</span>
              </div>
            )}
            {item.payoff_location && (
              <div className="flex items-start gap-2 text-xs">
                <Flag className="w-3 h-3 text-fandex-secondary flex-shrink-0 mt-0.5" />
                <span className="text-nf-text-tertiary w-12 flex-shrink-0">{t("foreshadowing.payoff")}</span>
                <span className="text-nf-text-secondary">{item.payoff_location}</span>
              </div>
            )}
            {item.notes && (
              <div className="flex items-start gap-2 text-xs">
                <FileText className="w-3 h-3 text-nf-text-tertiary flex-shrink-0 mt-0.5" />
                <span className="text-nf-text-tertiary w-12 flex-shrink-0">{t("foreshadowing.notes")}</span>
                <span className="text-nf-text-secondary whitespace-pre-wrap">{item.notes}</span>
              </div>
            )}
            <button
              onClick={() => handleJumpToFile(item)}
              className="flex items-center gap-1 text-xs text-fandex-primary hover:underline mt-1"
            >
              <FileText className="w-3 h-3" />
              {t("foreshadowing.openFile")}
            </button>
          </div>
        )}
      </div>
    );
  };

  /**
   * 渲染状态分组
   * 输入: title 分组标题, items 伏笔项列表, accentColor 标题强调色
   */
  const renderGroup = (
    title: string,
    items: ForeshadowingItem[],
    accentClass: string
  ) => {
    if (items.length === 0) return null;
    return (
      <div>
        <div className={`flex items-center gap-2 px-3 py-2 ${accentClass}`}>
          <span className="text-xs font-semibold font-display">{title}</span>
          <span className="text-[10px] text-nf-text-tertiary">({items.length})</span>
        </div>
        <div>{items.map((item, idx) => renderItem(item, idx))}</div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
        <h2 className="fandex-bar-left text-lg font-semibold font-display text-nf-text flex items-center gap-2">
          <Eye className="w-5 h-5 text-fandex-primary" />
          {t("foreshadowing.title")}
        </h2>
        <button
          onClick={loadData}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-fandex-primary border border-fandex-primary/30 hover:bg-fandex-primary/10 transition duration-fast"
        >
          <RefreshCw className="w-4 h-4" />
          {t("foreshadowing.refresh")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* 统计卡片网格 */}
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

          {/* 伏笔列表 */}
          {summary.total === 0 ? (
            <div className="bg-nf-bg-card border border-nf-border-light p-8 text-center">
              <AlertTriangle className="w-12 h-12 text-nf-border mx-auto mb-3" />
              <p className="text-sm text-nf-text-tertiary">{t("foreshadowing.empty")}</p>
            </div>
          ) : (
            <div className="bg-nf-bg-card border border-nf-border-light">
              {/* 未回收组（最高优先级） */}
              {renderGroup(
                t("foreshadowing.pending"),
                pendingItems,
                "bg-fandex-tertiary/5 border-b border-nf-border-light"
              )}
              {/* 已回收组 */}
              {renderGroup(
                t("foreshadowing.resolved"),
                resolvedItems,
                "bg-fandex-secondary/5 border-b border-nf-border-light"
              )}
              {/* 其他/已废弃组 */}
              {renderGroup(
                t("foreshadowing.otherStatus"),
                otherItems,
                "bg-nf-bg-hover/50 border-b border-nf-border-light"
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
