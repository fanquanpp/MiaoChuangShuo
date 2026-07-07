// 伏笔追踪面板组件
//
// 功能概述：
// 扫描项目伏笔目录（伏笔/伏笔记录/系列伏笔），按状态分组展示全部伏笔。
// 提供统计概览卡片与可展开列表，点击伏笔条目跳转到伏笔文件编辑。
//
// 模块职责：
// 1. 调用 scanForeshadowings 加载全部伏笔（含已回收/已放弃）
// 2. 渲染统计概览卡片（总数/已埋设/待回收/已回收）
// 3. 按状态分组渲染可展开列表，支持折叠/展开
// 4. 点击伏笔条目跳转到伏笔文件编辑（切换到 manuscript 分类并选中文件）
//
// 设计说明：
// - 状态分组顺序：已埋设 → 待回收 → 已回收 → 已放弃 → 其他
// - 重要度用颜色标识：高（红）/中（黄）/低（灰）
// - 遵循 FANDEX 暗黑主题，与 WritingStats/CodexPanel 风格一致

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  Bookmark,
  RefreshCw,
  Loader2,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  FileText,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import {
  scanForeshadowings,
  type ForeshadowingDetail,
  type FileNode,
} from "../lib/api";

// 状态分组顺序与显示名映射
// 顺序决定列表渲染顺序，未知状态归入"其他"
const STATUS_ORDER: string[] = ["已埋设", "待回收", "已回收", "已放弃"];

/**
 * 获取状态的显示顺序索引
 * 输入: status 状态字符串
 * 输出: number 排序索引（未知状态返回 STATUS_ORDER.length，归入"其他"组）
 */
function getStatusOrder(status: string): number {
  const idx = STATUS_ORDER.indexOf(status);
  return idx === -1 ? STATUS_ORDER.length : idx;
}

/**
 * 获取状态对应的主题色类
 * 输入: status 状态字符串
 * 输出: string Tailwind 类名（用于状态标签着色）
 */
function getStatusColorClass(status: string): string {
  switch (status) {
    case "已埋设":
      return "text-fandex-primary bg-fandex-primary/10 border-fandex-primary/30";
    case "待回收":
      return "text-fandex-tertiary bg-fandex-tertiary/10 border-fandex-tertiary/30";
    case "已回收":
      return "text-green-400 bg-green-400/10 border-green-400/30";
    case "已放弃":
      return "text-nf-text-tertiary bg-nf-text-tertiary/10 border-nf-text-tertiary/30";
    default:
      return "text-nf-text-secondary bg-nf-text-secondary/10 border-nf-text-secondary/30";
  }
}

/**
 * 获取重要度对应的颜色类
 * 输入: importance 重要度字符串
 * 输出: string Tailwind 类名（用于重要度标识着色）
 */
function getImportanceColorClass(importance: string): string {
  switch (importance) {
    case "高":
      return "text-red-400";
    case "中":
      return "text-yellow-400";
    case "低":
      return "text-nf-text-tertiary";
    default:
      return "text-nf-text-tertiary";
  }
}

/**
 * 伏笔追踪面板组件
 * 输入: 无（通过 useAppStore 获取当前项目）
 * 输出: JSX 伏笔追踪界面
 * 流程:
 *   1. 从全局 store 读取当前项目
 *   2. 调用 scanForeshadowings 加载伏笔列表
 *   3. 按状态分组并渲染统计卡片与可展开列表
 *   4. 点击伏笔条目跳转到伏笔文件编辑
 */
export default function ForeshadowingPanel() {
  const currentProject = useAppStore((s) => s.currentProject);
  const setActiveCategory = useAppStore((s) => s.setActiveCategory);
  const setSelectedFile = useAppStore((s) => s.setSelectedFile);
  const { showToast } = useToast();
  const { t } = useI18n();

  const [foreshadowings, setForeshadowings] = useState<ForeshadowingDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // 折叠状态映射：key 为状态分组名，value 为是否折叠（默认 false 展开）
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  /**
   * 加载伏笔列表
   * 流程:
   *   1. 校验项目路径
   *   2. 调用 scanForeshadowings 获取全部伏笔
   *   3. 更新状态，清空错误
   * 容错: 加载失败时设置 error 字段并提示
   */
  const loadForeshadowings = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    setError("");
    try {
      const list = await scanForeshadowings(currentProject.path);
      setForeshadowings(list);
    } catch (err) {
      const msg = String(err);
      setError(msg);
      showToast("error", t("foreshadowing.loadFailed", { error: msg }));
    } finally {
      setLoading(false);
    }
  }, [currentProject, showToast, t]);

  // 项目切换时自动加载
  useEffect(() => {
    loadForeshadowings();
  }, [loadForeshadowings]);

  /**
   * 按状态分组伏笔列表
   * 依赖: foreshadowings 原始列表
   * 输出: Array<{ status: string; items: ForeshadowingDetail[] }> 按状态顺序排列的分组
   */
  const groupedByStatus = useMemo(() => {
    const groups = new Map<string, ForeshadowingDetail[]>();
    for (const f of foreshadowings) {
      const key = f.status || "其他";
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(f);
    }
    // 按 STATUS_ORDER 排序，未知状态归入末尾
    const result = Array.from(groups.entries()).map(([status, items]) => ({
      status,
      items,
    }));
    result.sort((a, b) => {
      const orderA = getStatusOrder(a.status);
      const orderB = getStatusOrder(b.status);
      if (orderA !== orderB) return orderA - orderB;
      return a.status.localeCompare(b.status, "zh-CN");
    });
    return result;
  }, [foreshadowings]);

  // 统计概览数据
  const stats = useMemo(() => {
    const total = foreshadowings.length;
    const setup = foreshadowings.filter((f) => f.status === "已埋设").length;
    const pending = foreshadowings.filter((f) => f.status === "待回收").length;
    const resolved = foreshadowings.filter((f) => f.status === "已回收").length;
    return { total, setup, pending, resolved };
  }, [foreshadowings]);

  /**
   * 切换分组折叠状态
   * 输入: status 分组状态名
   */
  const toggleGroup = useCallback((status: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [status]: !prev[status] }));
  }, []);

  /**
   * 点击伏笔条目跳转到伏笔文件编辑
   * 输入: foreshadowing 伏笔详情
   * 流程:
   *   1. 构造 FileNode（从 sourceFile 相对路径）
   *   2. 切换到 manuscript 分类（编辑器分类）
   *   3. 设置 selectedFile 触发 NovelEditor 加载伏笔文件
   */
  const handleJumpToFile = useCallback(
    (foreshadowing: ForeshadowingDetail) => {
      if (!foreshadowing.sourceFile || !currentProject) return;
      // 从相对路径提取文件名
      const relPath = foreshadowing.sourceFile;
      const fileName = relPath.split("/").pop() || relPath;
      // 构造 FileNode，NovelEditor 根据 relative_path 拼接完整路径加载
      const fileNode: FileNode = {
        name: fileName,
        relative_path: relPath,
        is_dir: false,
        children: [],
        size: 0,
      };
      // 切换到编辑器分类并选中伏笔文件
      setActiveCategory("manuscript");
      setSelectedFile(fileNode);
    },
    [currentProject, setActiveCategory, setSelectedFile]
  );

  // 无项目状态
  if (!currentProject) {
    return (
      <div className="flex-1 flex items-center justify-center bg-nf-bg text-nf-text-tertiary text-sm">
        {t("foreshadowing.noProject")}
      </div>
    );
  }

  // 加载中状态
  if (loading && foreshadowings.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-nf-bg">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-fandex-primary" />
          <span className="text-sm text-nf-text-tertiary">{t("foreshadowing.loading")}</span>
        </div>
      </div>
    );
  }

  // 加载错误状态
  if (error && foreshadowings.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-nf-bg p-6">
        <div className="fandex-admonition fandex-admonition-danger px-4 py-3 text-sm text-red-400 max-w-md">
          {t("foreshadowing.loadFailed", { error })}
        </div>
      </div>
    );
  }

  // 空状态
  if (foreshadowings.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden relative">
        <div className="nf-ambient-bg" />
        <div className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-nf-border-light bg-nf-bg-card/60 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center border border-fandex-primary/40 bg-fandex-primary/10">
              <Bookmark className="w-5 h-5 text-fandex-primary" />
            </div>
            <div>
              <h2 className="fandex-bar-left text-lg font-semibold font-display text-nf-text">
                {t("foreshadowing.title")}
              </h2>
              <p className="text-xs text-nf-text-tertiary mt-0.5">{t("foreshadowing.subtitle")}</p>
            </div>
          </div>
          <button
            onClick={loadForeshadowings}
            className="nf-tool-btn nf-icon-rotate flex items-center gap-1.5 px-3 py-1.5 text-sm text-fandex-primary border border-fandex-primary/30 hover:bg-fandex-primary/10"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{t("foreshadowing.refresh")}</span>
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center relative z-10 gap-3">
          <AlertCircle className="w-10 h-10 text-nf-text-tertiary" />
          <p className="text-sm text-nf-text-tertiary">{t("foreshadowing.empty")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden relative">
      <div className="nf-ambient-bg" />

      {/* 顶部标题栏 */}
      <div className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-nf-border-light bg-nf-bg-card/60 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center border border-fandex-primary/40 bg-fandex-primary/10">
            <Bookmark className="w-5 h-5 text-fandex-primary" />
          </div>
          <div>
            <h2 className="fandex-bar-left text-lg font-semibold font-display text-nf-text">
              {t("foreshadowing.title")}
            </h2>
            <p className="text-xs text-nf-text-tertiary mt-0.5">{t("foreshadowing.subtitle")}</p>
          </div>
        </div>
        <button
          onClick={loadForeshadowings}
          disabled={loading}
          className="nf-tool-btn nf-icon-rotate flex items-center gap-1.5 px-3 py-1.5 text-sm text-fandex-primary border border-fandex-primary/30 hover:bg-fandex-primary/10 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          <span>{t("foreshadowing.refresh")}</span>
        </button>
      </div>

      {/* 主体内容：统计卡片 + 分组列表 */}
      <div className="flex-1 overflow-y-auto p-6 relative z-10">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* 统计概览卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label={t("foreshadowing.statTotal")}
              value={stats.total}
              colorClass="text-nf-text"
              borderClass="border-nf-border-light"
            />
            <StatCard
              label={t("foreshadowing.statSetup")}
              value={stats.setup}
              colorClass="text-fandex-primary"
              borderClass="border-fandex-primary/30"
            />
            <StatCard
              label={t("foreshadowing.statPending")}
              value={stats.pending}
              colorClass="text-fandex-tertiary"
              borderClass="border-fandex-tertiary/30"
            />
            <StatCard
              label={t("foreshadowing.statResolved")}
              value={stats.resolved}
              colorClass="text-green-400"
              borderClass="border-green-400/30"
            />
          </div>

          {/* 按状态分组的可展开列表 */}
          {groupedByStatus.map((group) => {
            const collapsed = collapsedGroups[group.status] ?? false;
            return (
              <div
                key={group.status}
                className="nf-glass-panel border border-nf-border-light rounded-md overflow-hidden"
              >
                {/* 分组标题（可点击折叠/展开） */}
                <button
                  onClick={() => toggleGroup(group.status)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-nf-bg-card/40 hover:bg-nf-bg-card/70 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {collapsed ? (
                      <ChevronRight className="w-4 h-4 text-nf-text-tertiary" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-nf-text-tertiary" />
                    )}
                    <span
                      className={`px-2 py-0.5 text-xs border rounded-sm ${getStatusColorClass(group.status)}`}
                    >
                      {group.status}
                    </span>
                    <span className="text-sm text-nf-text-secondary">
                      {t("foreshadowing.groupCount", { count: group.items.length })}
                    </span>
                  </div>
                </button>
                {/* 分组内容列表 */}
                {!collapsed && (
                  <div className="divide-y divide-nf-border-light/50">
                    {group.items.map((item, idx) => (
                      <button
                        key={`${item.name}-${idx}`}
                        onClick={() => handleJumpToFile(item)}
                        className="w-full text-left px-4 py-3 hover:bg-nf-bg-card/40 transition-colors group"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {/* 伏笔名称与重要度 */}
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-nf-text truncate">
                                {item.name}
                              </span>
                              {item.importance && (
                                <span
                                  className={`text-xs font-semibold ${getImportanceColorClass(item.importance)}`}
                                >
                                  [{item.importance}]
                                </span>
                              )}
                            </div>
                            {/* 埋设/回收位置信息 */}
                            {(item.setup || item.payoff) && (
                              <div className="text-xs text-nf-text-tertiary space-y-0.5">
                                {item.setup && (
                                  <div>
                                    <span className="text-nf-text-secondary">
                                      {t("foreshadowing.setupLabel")}:
                                    </span>{" "}
                                    {item.setup}
                                  </div>
                                )}
                                {item.payoff && (
                                  <div>
                                    <span className="text-nf-text-secondary">
                                      {t("foreshadowing.payoffLabel")}:
                                    </span>{" "}
                                    {item.payoff}
                                  </div>
                                )}
                              </div>
                            )}
                            {/* 备注 */}
                            {item.remark && (
                              <div className="text-xs text-nf-text-tertiary mt-1 italic">
                                {item.remark}
                              </div>
                            )}
                          </div>
                          {/* 跳转编辑图标 */}
                          <FileText className="w-4 h-4 text-nf-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * 统计卡片子组件
 * 输入:
 *   label 标签文本
 *   value 数值
 *   colorClass 数值颜色类
 *   borderClass 边框颜色类
 * 输出: JSX 统计卡片
 */
function StatCard({
  label,
  value,
  colorClass,
  borderClass,
}: {
  label: string;
  value: number;
  colorClass: string;
  borderClass: string;
}) {
  return (
    <div
      className={`nf-glass-panel border ${borderClass} rounded-md px-4 py-3 flex flex-col gap-1`}
    >
      <span className="text-xs text-nf-text-tertiary">{label}</span>
      <span className={`text-2xl font-semibold font-display ${colorClass}`}>
        {value}
      </span>
    </div>
  );
}
