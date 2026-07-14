// 全文索引管理面板组件（Sprint 4 任务 4.2）
//
// 功能概述：
// 提供 Tantivy 全文索引的可视化管理界面，包含统计展示、索引构建、
// 重建触发、进度条显示等功能。作为设置对话框的独立分区嵌入。
//
// 模块职责：
// 1. 展示索引统计信息（文档数、文件数、索引大小、最后构建时间）
// 2. 提供构建索引与重建索引按钮
// 3. 监听 index-progress 事件实时显示构建进度
// 4. 构建完成后刷新统计并提示结果
//
// 设计说明：
// - 组件挂载时自动加载索引统计（不触发构建）
// - 构建过程通过 Tauri Event 推送进度，前端监听并渲染进度条
// - 重建索引需二次确认（避免误触清空已有索引）
// - 索引大小自动选择合适的单位（字节/KB/MB）

import { useEffect, useState, useCallback } from "react";
import { Database, RefreshCw, Hammer, RotateCcw } from "lucide-react";
import { useAppStore } from "../lib/store";
import {
  getProjectIndexStats,
  buildProjectIndex,
  onIndexProgress,
  type IndexStats,
} from "../lib/api";
import { useI18n } from "../lib/i18n";
import { logger } from "../lib/logger";
import { useToast } from "../lib/toast";

// 索引构建进度事件 payload（与后端 IndexProgress 对应）
interface IndexProgress {
  processed: number;
  total: number;
  current_file: string;
  percent: number;
  stage: string;
}

interface IndexManagerPanelProps {
  // 无额外属性，项目路径从 useAppStore 获取
}

/**
 * 格式化索引大小为可读字符串
 * 输入: bytes 字节数
 * 输出: string 带单位的可读大小（字节/KB/MB）
 * 流程:
 *   1. 小于 1024 字节：显示字节数
 *   2. 小于 1024*1024：显示 KB（保留 1 位小数）
 *   3. 否则：显示 MB（保留 2 位小数）
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 格式化 ISO 8601 时间为本地可读格式
 * 输入: iso 时间字符串
 * 输出: 本地化时间字符串（失败返回空字符串）
 */
function formatTime(iso: string): string {
  if (!iso) return "";
  try {
    const dt = new Date(iso);
    return dt.toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * 全文索引管理面板组件
 * 输入: 无（项目路径从全局 store 获取）
 * 输出: JSX 索引管理界面（统计卡片 + 操作按钮 + 进度条）
 * 流程:
 *   1. 挂载时调用 getProjectIndexStats 加载统计
 *   2. 监听 index-progress 事件更新进度条
 *   3. 点击构建/重建按钮调用 buildProjectIndex
 *   4. 构建完成后刷新统计并 toast 提示
 */
export default function IndexManagerPanel({}: IndexManagerPanelProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const currentProject = useAppStore((s) => s.currentProject);

  // 索引统计状态
  const [stats, setStats] = useState<IndexStats | null>(null);
  // 统计加载中状态
  const [loadingStats, setLoadingStats] = useState(false);
  // 索引构建中状态
  const [building, setBuilding] = useState(false);
  // 构建进度状态
  const [progress, setProgress] = useState<IndexProgress | null>(null);

  /**
   * 加载索引统计信息
   * 流程: 调用 getProjectIndexStats，更新 stats 状态
   * 容错: 失败时 toast 提示并保留原统计
   */
  const loadStats = useCallback(async () => {
    if (!currentProject) return;
    setLoadingStats(true);
    try {
      const result = await getProjectIndexStats(currentProject.path);
      setStats(result);
    } catch (err) {
      logger.error("加载索引统计失败:", err instanceof Error ? err : String(err));
    } finally {
      setLoadingStats(false);
    }
  }, [currentProject]);

  // 挂载时与项目切换时加载统计
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // 监听索引构建进度事件
  useEffect(() => {
    if (!building) return;
    let unlisten: (() => void) | null = null;
    // 注册进度事件监听器
    onIndexProgress((p: IndexProgress) => {
      setProgress(p);
      // 构建完成阶段标记
      if (p.stage === "done") {
        setBuilding(false);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [building]);

  /**
   * 触发索引构建（全量重建）
   * 流程:
   *   1. 设置 building 状态
   *   2. 调用 buildProjectIndex 后端命令
   *   3. 成功后刷新统计并 toast 提示
   *   4. 失败时 toast 提示错误
   */
  const handleBuild = useCallback(async () => {
    if (!currentProject || building) return;
    setBuilding(true);
    setProgress(null);
    try {
      const result = await buildProjectIndex(currentProject.path);
      setStats(result);
      showToast(
        "success",
        t("index.buildSuccess", {
          docs: result.doc_count,
          files: result.file_count,
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("error", t("index.buildFailed", { error: msg }));
    } finally {
      setBuilding(false);
      setProgress(null);
    }
  }, [currentProject, building, showToast, t]);

  /**
   * 触发索引重建（二次确认后执行）
   * 流程: 弹出确认对话框，确认后调用 handleBuild
   */
  const handleRebuild = useCallback(async () => {
    if (!currentProject || building) return;
    // 二次确认避免误触清空已有索引
    const confirmed = window.confirm(t("index.confirmRebuild"));
    if (!confirmed) return;
    await handleBuild();
  }, [building, handleBuild, t]);

  // 索引是否已构建
  const hasIndex = stats !== null && (stats.doc_count > 0 || !!stats.last_built_at);

  return (
    <section className="space-y-4">
      {/* 标题与描述 */}
      <div className="flex items-start gap-2">
        <Database className="w-4 h-4 text-fandex-primary mt-0.5 shrink-0" />
        <div>
          <h3 className="text-sm font-bold font-display text-nf-text">
            {t("index.title")}
          </h3>
          <p className="text-xs text-nf-text-secondary mt-1 leading-relaxed">
            {t("index.description")}
          </p>
        </div>
      </div>

      {/* 索引统计卡片 */}
      <div className="border border-nf-border-light bg-nf-bg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-nf-text-secondary uppercase tracking-wider">
            {t("index.stats")}
          </span>
          <button
            onClick={loadStats}
            disabled={loadingStats}
            title={t("index.refresh")}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-nf-text-secondary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/40 transition duration-fast disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3 h-3 ${loadingStats ? "animate-spin" : ""}`} />
            {loadingStats ? t("index.refreshing") : t("index.refresh")}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          {/* 文档数 */}
          <div className="flex flex-col">
            <span className="text-nf-text-secondary mb-0.5">{t("index.docCount")}</span>
            <span className="text-sm font-mono font-bold text-fandex-primary">
              {stats?.doc_count ?? 0}
            </span>
          </div>
          {/* 文件数 */}
          <div className="flex flex-col">
            <span className="text-nf-text-secondary mb-0.5">{t("index.fileCount")}</span>
            <span className="text-sm font-mono font-bold text-fandex-secondary">
              {stats?.file_count ?? 0}
            </span>
          </div>
          {/* 索引大小 */}
          <div className="flex flex-col">
            <span className="text-nf-text-secondary mb-0.5">{t("index.size")}</span>
            <span className="text-sm font-mono font-bold text-fandex-tertiary">
              {stats ? formatSize(stats.index_size) : "—"}
            </span>
          </div>
          {/* 最后构建时间 */}
          <div className="flex flex-col">
            <span className="text-nf-text-secondary mb-0.5">{t("index.lastBuilt")}</span>
            <span className="text-[11px] text-nf-text">
              {stats?.last_built_at ? formatTime(stats.last_built_at) : t("index.notBuilt")}
            </span>
          </div>
        </div>
      </div>

      {/* 构建进度条 */}
      {building && progress && (
        <div className="border border-fandex-primary/30 bg-fandex-primary/5 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-fandex-primary font-semibold">
              {t("index.progress", {
                percent: progress.percent,
                processed: progress.processed,
                total: progress.total,
              })}
            </span>
            <span className="text-nf-text-secondary">{progress.percent}%</span>
          </div>
          {/* 进度条主体 */}
          <div className="h-1.5 bg-nf-bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-fandex-primary to-fandex-secondary transition-all duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          {/* 当前处理文件名 */}
          {progress.current_file && (
            <div className="text-[11px] text-nf-text-secondary truncate">
              {t("index.currentFile", { file: progress.current_file })}
            </div>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        {!hasIndex ? (
          // 索引未构建：显示"构建索引"按钮
          <button
            onClick={handleBuild}
            disabled={building || !currentProject}
            className="flex items-center gap-1.5 px-3 py-2 text-xs bg-fandex-primary/10 hover:bg-fandex-primary/20 border border-fandex-primary/40 text-fandex-primary transition duration-fast disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Hammer className={`w-3.5 h-3.5 ${building ? "animate-pulse" : ""}`} />
            {building ? t("index.building") : t("index.build")}
          </button>
        ) : (
          // 索引已构建：显示"重建索引"按钮
          <button
            onClick={handleRebuild}
            disabled={building || !currentProject}
            className="flex items-center gap-1.5 px-3 py-2 text-xs bg-fandex-tertiary/10 hover:bg-fandex-tertiary/20 border border-fandex-tertiary/40 text-fandex-tertiary transition duration-fast disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${building ? "animate-spin" : ""}`} />
            {building ? t("index.building") : t("index.rebuild")}
          </button>
        )}
      </div>
    </section>
  );
}
