// 版本快照历史面板
//
// 功能概述：
// 显示当前文件的所有版本快照，支持预览、恢复、删除、清空、立即创建快照。
// 每次保存时自动创建快照，作者平时完全无感，需要时打开此面板查看或回滚。
//
// 模块职责：
// 1. 加载并展示快照列表（时间倒序）
// 2. 选中快照后展开预览（只读）
// 3. 恢复快照到源文件（恢复前自动备份当前内容）
// 4. 删除单个快照 / 清空全部
// 5. 立即创建手动快照
// 6. 显示快照统计（数量、总大小）
//
// 设计理念：
// 作者只需关心"我想回到某个版本"——其余一切自动化
// 恢复前自动备份当前内容，杜绝误操作丢稿

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  X,
  History,
  RotateCcw,
  Trash2,
  Plus,
  Eraser,
  FileText,
  Clock,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  listSnapshots,
  readSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  clearSnapshots,
  createSnapshot,
  type SnapshotInfo,
} from "../lib/api";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import ConfirmDialog from "./ConfirmDialog";

/**
 * 待确认操作类型
 * - restore: 恢复快照(危险操作,会覆盖当前内容)
 * - delete: 删除单个快照
 * - clear: 清空所有快照
 */
type ConfirmAction =
  | { type: "restore"; snapshot: SnapshotInfo }
  | { type: "delete"; snapshot: SnapshotInfo }
  | { type: "clear" };

interface SnapshotHistoryProps {
  /** 当前文件路径（绝对路径） */
  filePath: string;
  /** 项目根路径 */
  projectPath: string;
  /** 当前编辑器内容（用于对比与立即快照） */
  currentContent: string;
  /** 关闭面板回调 */
  onClose: () => void;
  /** 恢复成功后的回调（编辑器需重新加载文件） */
  onRestored: () => void;
}

/**
 * 格式化字节数为可读字符串
 * 输入: bytes 字节数
 * 输出: B / KB / MB 格式字符串
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 格式化 ISO 时间为本地可读时间
 * 输入: iso ISO 8601 时间字符串
 * 输出: 本地化时间字符串（YYYY-MM-DD HH:mm:ss）
 */
function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  } catch {
    return iso;
  }
}

/**
 * 计算两个文本之间的简单行级差异统计
 * 输入: oldText 旧文本, newText 新文本
 * 输出: { added, removed, kept } 行数统计
 */
function computeLineDiff(oldText: string, newText: string): { added: number; removed: number; kept: number } {
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  let added = 0;
  let removed = 0;
  for (const line of newLines) {
    if (!oldSet.has(line)) added++;
  }
  for (const line of oldLines) {
    if (!newSet.has(line)) removed++;
  }
  const kept = Math.min(oldLines.length, newLines.length) - Math.min(added, removed);
  return { added, removed, kept: Math.max(0, kept) };
}

// 触发方式徽章颜色映射
const TRIGGER_COLORS: Record<string, string> = {
  auto: "bg-fandex-primary/10 text-fandex-primary border-fandex-primary/30",
  manual: "bg-fandex-secondary/10 text-fandex-secondary border-fandex-secondary/30",
  "pre-restore": "bg-fandex-tertiary/10 text-fandex-tertiary border-fandex-tertiary/30",
};

/**
 * 版本快照历史面板组件
 * 输入: filePath 当前文件路径, projectPath 项目路径, currentContent 当前内容, onClose 关闭回调, onRestored 恢复后回调
 * 输出: JSX 抽屉式面板
 * 流程:
 *   1. 加载快照列表
 *   2. 渲染列表项（时间、字数、大小、触发方式、操作按钮）
 *   3. 选中快照展开预览
 *   4. 提供恢复/删除/清空/立即创建操作
 */
export default function SnapshotHistory({
  filePath,
  projectPath,
  currentContent,
  onClose,
  onRestored,
}: SnapshotHistoryProps) {
  const { t } = useI18n();
  const { showToast } = useToast();

  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  // 待确认操作状态(null 表示无待确认操作)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  // 加载快照列表
  const loadSnapshots = useCallback(async () => {
    if (!filePath || !projectPath) return;
    setLoading(true);
    setError("");
    try {
      const list = await listSnapshots(filePath, projectPath);
      setSnapshots(list);
      // 默认选中最新一条
      if (list.length > 0 && !selectedPath) {
        setSelectedPath(list[0].snapshot_path);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filePath, projectPath, selectedPath]);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  // 加载选中快照的预览内容
  useEffect(() => {
    if (!selectedPath || !projectPath) {
      setPreviewContent("");
      return;
    }
    setPreviewLoading(true);
    readSnapshot(selectedPath, projectPath)
      .then((content) => {
        setPreviewContent(content);
      })
      .catch((e) => {
        setPreviewContent("");
        setError(String(e));
      })
      .finally(() => {
        setPreviewLoading(false);
      });
  }, [selectedPath, projectPath]);

  // 统计信息
  const stats = useMemo(() => {
    const count = snapshots.length;
    const totalSize = snapshots.reduce((sum, s) => sum + s.meta.size, 0);
    return { count, totalSize };
  }, [snapshots]);

  // 选中快照与当前内容的差异统计
  const diffStats = useMemo(() => {
    if (!previewContent) return null;
    return computeLineDiff(previewContent, currentContent);
  }, [previewContent, currentContent]);

  // 立即创建手动快照
  const handleCreateManual = async () => {
    if (!filePath || !projectPath) return;
    setActionLoading(true);
    try {
      await createSnapshot(filePath, projectPath, currentContent, "manual");
      showToast("success", t("snapshot.snapshotCreated"));
      await loadSnapshots();
    } catch (e) {
      showToast("error", t("snapshot.snapshotCreateFailed"));
    } finally {
      setActionLoading(false);
    }
  };

  // 恢复快照(实际执行,已在 ConfirmDialog 中确认)
  const performRestore = async (snapshot: SnapshotInfo) => {
    if (!filePath || !projectPath) return;
    setActionLoading(true);
    try {
      await restoreSnapshot(snapshot.snapshot_path, filePath, projectPath);
      showToast("success", t("snapshot.restoreSuccess"));
      onRestored();
      onClose();
    } catch (e) {
      showToast("error", t("snapshot.restoreFailed", { error: String(e) }));
    } finally {
      setActionLoading(false);
    }
  };

  // 删除单个快照(实际执行,已在 ConfirmDialog 中确认)
  const performDelete = async (snapshot: SnapshotInfo) => {
    if (!filePath || !projectPath) return;
    setActionLoading(true);
    try {
      await deleteSnapshot(
        snapshot.snapshot_path,
        snapshot.meta.timestamp,
        filePath,
        projectPath
      );
      showToast("success", t("snapshot.deleteSuccess"));
      // 如果删除的是当前选中的，切换到下一个
      if (selectedPath === snapshot.snapshot_path) {
        setSelectedPath(null);
      }
      await loadSnapshots();
    } catch (e) {
      showToast("error", t("snapshot.deleteFailed", { error: String(e) }));
    } finally {
      setActionLoading(false);
    }
  };

  // 清空所有快照(实际执行,已在 ConfirmDialog 中确认)
  const performClearAll = async () => {
    if (!filePath || !projectPath) return;
    setActionLoading(true);
    try {
      await clearSnapshots(filePath, projectPath);
      showToast("success", t("snapshot.clearSuccess"));
      setSelectedPath(null);
      setSnapshots([]);
    } catch (e) {
      showToast("error", t("snapshot.clearFailed", { error: String(e) }));
    } finally {
      setActionLoading(false);
    }
  };

  // 请求恢复快照:打开确认对话框
  const handleRestore = (snapshot: SnapshotInfo) => {
    setConfirmAction({ type: "restore", snapshot });
  };

  // 请求删除快照:打开确认对话框
  const handleDelete = (snapshot: SnapshotInfo) => {
    setConfirmAction({ type: "delete", snapshot });
  };

  // 请求清空所有:打开确认对话框
  const handleClearAll = () => {
    setConfirmAction({ type: "clear" });
  };

  // 确认对话框确认回调:根据类型分发到实际执行函数
  const handleConfirm = () => {
    if (!confirmAction) return;
    const action = confirmAction;
    setConfirmAction(null);
    if (action.type === "restore") {
      performRestore(action.snapshot);
    } else if (action.type === "delete") {
      performDelete(action.snapshot);
    } else {
      performClearAll();
    }
  };

  return (
    <aside
      className="w-[420px] h-full flex flex-col border-l border-nf-border-light bg-nf-bg-sidebar overflow-hidden animate-slide-up"
      role="complementary"
      aria-label={t("snapshot.title")}
    >
      {/* 顶部标题栏 */}
      <header className="flex items-center gap-2 px-4 py-3 border-b border-nf-border-light bg-nf-bg-card/40">
        <History className="w-4 h-4 text-fandex-primary" />
        <h2 className="text-sm font-medium text-nf-text flex-1 truncate">
          {t("snapshot.title")}
        </h2>
        <button
          onClick={handleCreateManual}
          disabled={actionLoading}
          title={t("snapshot.createManually")}
          className="p-1.5 text-nf-text-tertiary hover:text-fandex-secondary hover:bg-fandex-secondary/10 border border-transparent hover:border-fandex-secondary/30 transition-all duration-fast ease-fandex disabled:opacity-50"
        >
          {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={onClose}
          title={t("app.close")}
          className="p-1.5 text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-hover border border-transparent hover:border-nf-border-light transition-all duration-fast ease-fandex"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </header>

      {/* 统计信息 */}
      {snapshots.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-nf-border-light/60 text-xs text-nf-text-tertiary bg-nf-bg/40">
          <span>{t("snapshot.snapshotCount", { count: stats.count })}</span>
          <span>·</span>
          <span>{t("snapshot.totalSize", { size: formatBytes(stats.totalSize) })}</span>
          <button
            onClick={handleClearAll}
            disabled={actionLoading}
            title={t("snapshot.clearAll")}
            className="ml-auto flex items-center gap-1 px-1.5 py-0.5 text-nf-text-tertiary hover:text-fandex-tertiary hover:bg-fandex-tertiary/10 border border-transparent hover:border-fandex-tertiary/30 transition-all duration-fast ease-fandex disabled:opacity-50"
          >
            <Eraser className="w-3 h-3" />
            {t("snapshot.clearAll")}
          </button>
        </div>
      )}

      {/* 快照列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-nf-text-tertiary text-xs">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            {t("common.loading")}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-nf-text-tertiary text-xs px-4 text-center">
            <AlertCircle className="w-6 h-6 text-fandex-tertiary" />
            <p>{t("snapshot.loadFailed")}</p>
            <p className="text-nf-text-tertiary/60 text-[10px]">{error}</p>
          </div>
        ) : snapshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-nf-text-tertiary text-xs px-4 text-center">
            <FileText className="w-8 h-8 opacity-40" />
            <p>{t("snapshot.empty")}</p>
            <p className="text-nf-text-tertiary/60 text-[10px]">{t("snapshot.emptyHint")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-nf-border-light/40">
            {snapshots.map((snapshot) => {
              const isSelected = selectedPath === snapshot.snapshot_path;
              const triggerColor = TRIGGER_COLORS[snapshot.meta.trigger] || TRIGGER_COLORS.auto;
              return (
                <li key={snapshot.snapshot_path}>
                  <button
                    onClick={() => setSelectedPath(snapshot.snapshot_path)}
                    className={`w-full text-left px-4 py-3 transition-all duration-fast ease-fandex border-l-2 ${
                      isSelected
                        ? "bg-fandex-primary/5 border-fandex-primary"
                        : "border-transparent hover:bg-nf-bg-hover/40"
                    }`}
                  >
                    {/* 时间与触发方式 */}
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="w-3 h-3 text-nf-text-tertiary flex-shrink-0" />
                      <span className="text-xs tabular-nums text-nf-text-secondary font-mono">
                        {formatTime(snapshot.meta.created_at)}
                      </span>
                      <span
                        className={`ml-auto px-1.5 py-0.5 text-[10px] border ${triggerColor}`}
                      >
                        {t(`snapshot.trigger${snapshot.meta.trigger.charAt(0).toUpperCase()}${snapshot.meta.trigger.slice(1)}` as string)}
                      </span>
                    </div>
                    {/* 字数与大小 */}
                    <div className="flex items-center gap-3 text-[11px] text-nf-text-tertiary tabular-nums">
                      <span>{t("snapshot.words", { count: snapshot.meta.word_count })}</span>
                      <span>·</span>
                      <span>{formatBytes(snapshot.meta.size)}</span>
                    </div>
                  </button>
                  {/* 选中时展开操作区 */}
                  {isSelected && (
                    <div className="flex items-center gap-1 px-4 py-2 border-t border-nf-border-light/40 bg-nf-bg-card/30">
                      <button
                        onClick={() => handleRestore(snapshot)}
                        disabled={actionLoading}
                        title={t("snapshot.restore")}
                        className="nf-tool-btn flex items-center gap-1 px-2 py-1 text-xs text-fandex-secondary border border-fandex-secondary/30 hover:bg-fandex-secondary/10 transition-all duration-fast ease-fandex disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3" />
                        {t("snapshot.restore")}
                      </button>
                      <button
                        onClick={() => handleDelete(snapshot)}
                        disabled={actionLoading}
                        title={t("snapshot.delete")}
                        className="nf-tool-btn flex items-center gap-1 px-2 py-1 text-xs text-fandex-tertiary border border-fandex-tertiary/30 hover:bg-fandex-tertiary/10 transition-all duration-fast ease-fandex disabled:opacity-50 ml-auto"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 底部预览区 */}
      {selectedPath && (
        <div className="border-t border-nf-border-light bg-nf-bg/60 flex flex-col" style={{ height: "40%" }}>
          <div className="flex items-center gap-2 px-4 py-2 border-b border-nf-border-light/60">
            <FileText className="w-3 h-3 text-nf-text-tertiary" />
            <span className="text-xs text-nf-text-secondary flex-1 truncate">
              {t("snapshot.currentVersion")}
            </span>
            {/* 差异统计 */}
            {diffStats && (
              <div className="flex items-center gap-2 text-[10px] tabular-nums">
                {diffStats.added > 0 && (
                  <span className="text-fandex-secondary">+{diffStats.added}</span>
                )}
                {diffStats.removed > 0 && (
                  <span className="text-fandex-tertiary">-{diffStats.removed}</span>
                )}
                {diffStats.added === 0 && diffStats.removed === 0 && (
                  <span className="text-nf-text-tertiary">{t("snapshot.currentVersion")}</span>
                )}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto p-3">
            {previewLoading ? (
              <div className="flex items-center justify-center h-full text-nf-text-tertiary text-xs">
                <Loader2 className="w-3 h-3 animate-spin mr-2" />
                {t("common.loading")}
              </div>
            ) : (
              <pre className="text-xs text-nf-text-secondary font-mono whitespace-pre-wrap break-all leading-relaxed">
                {previewContent || "(empty)"}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* 确认对话框:替代原生 window.confirm,统一视觉风格 */}
      <ConfirmDialog
        open={confirmAction !== null}
        title={
          confirmAction?.type === "restore"
            ? t("snapshot.restore")
            : confirmAction?.type === "delete"
              ? t("snapshot.delete")
              : t("snapshot.clearAll")
        }
        message={
          confirmAction?.type === "restore"
            ? t("snapshot.restoreConfirm")
            : confirmAction?.type === "delete"
              ? t("snapshot.deleteConfirm")
              : t("snapshot.clearConfirm")
        }
        type={confirmAction?.type === "clear" ? "danger" : "confirm"}
        confirmLabel={
          confirmAction?.type === "restore"
            ? t("snapshot.restore")
            : confirmAction?.type === "delete"
              ? t("snapshot.delete")
              : t("snapshot.clearAll")
        }
        onConfirm={handleConfirm}
        onCancel={() => setConfirmAction(null)}
      />
    </aside>
  );
}
