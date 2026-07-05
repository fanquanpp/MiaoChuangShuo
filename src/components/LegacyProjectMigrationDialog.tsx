// 旧版项目迁移对话框组件
//
// 功能概述：
// 当 is_legacy_project 命令检测到旧版目录结构时弹出，引导用户将旧版 8 种目录
// 迁移至新版 6 种统一目录。迁移前自动创建 .bak 备份，失败时自动回滚。
//
// 模块职责：
// 1. 显示旧版与新版目录映射关系
// 2. 调用 migrate_legacy_project Tauri 命令执行迁移
// 3. 显示迁移进度与结果统计
// 4. 失败时提示已自动回滚
// 5. 成功后通知父组件刷新项目树
//
// 设计说明：
// - 迁移过程在后端执行（Rust fs 操作），前端仅显示进度
// - 进度通过 Tauri Event 推送（migration:progress），避免轮询
// - 迁移失败时后端自动回滚，前端仅需展示错误信息
// - 用户可选择"暂不迁移"继续使用兼容模式（read_project_tree 仍可扫描旧版目录）

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  X,
  XCircle,
} from "lucide-react";
import { useI18n } from "../lib/i18n";

// 迁移状态枚举
type MigrationStatus = "idle" | "migrating" | "success" | "failed";

// 迁移进度事件载荷（由后端 migration:progress 事件推送）
interface MigrationProgress {
  done: number;
  total: number;
  currentFile: string;
}

// 迁移结果（由 migrate_legacy_project 命令返回）
interface MigrationResult {
  migratedCount: number;
  backupPath: string;
  rollback: boolean;
}

interface LegacyProjectMigrationDialogProps {
  /** 是否显示 */
  open: boolean;
  /** 项目根路径 */
  projectPath: string;
  /** 关闭对话框回调 */
  onClose: () => void;
  /** 迁移成功后回调（父组件刷新项目树） */
  onMigrated: () => void;
}

// 旧版 → 新版目录映射表（用于 UI 展示）
const DIRECTORY_MAPPINGS: Array<{ from: string; to: string; note: string }> = [
  { from: "角色", to: "设定/", note: "合并至设定库" },
  { from: "世界观", to: "设定/", note: "合并至设定库" },
  { from: "术语", to: "设定/", note: "合并至设定库" },
  { from: "剧情图谱", to: "保留", note: "自定义目录" },
  { from: "素材", to: "草稿箱/", note: "归档至草稿箱" },
];

/**
 * 旧版项目迁移对话框
 * 输入:
 *   - open: 显示状态
 *   - projectPath: 项目根路径
 *   - onClose: 关闭回调
 *   - onMigrated: 迁移成功回调
 * 输出: JSX 对话框（open=false 时返回 null）
 * 流程:
 *   1. idle 状态显示目录映射与警告
 *   2. 用户点击"立即迁移"触发 migrate_legacy_project 命令
 *   3. 监听 migration:progress 事件更新进度条
 *   4. 命令返回后切换至 success/failed 状态
 *   5. 成功后调用 onMigrated 通知父组件刷新
 */
export default function LegacyProjectMigrationDialog({
  open,
  projectPath,
  onClose,
  onMigrated,
}: LegacyProjectMigrationDialogProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<MigrationStatus>("idle");
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [error, setError] = useState<string>("");

  // 监听迁移进度事件
  useEffect(() => {
    if (!open || status !== "migrating") return;

    // 订阅 migration:progress 事件（后端推送进度）
    const unlistenPromise = listen<MigrationProgress>("migration:progress", (event) => {
      setProgress(event.payload);
    });

    return () => {
      // 组件卸载或状态变更时取消订阅
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {
        // 取消订阅失败静默处理
      });
    };
  }, [open, status]);

  // 重置状态（对话框打开时）
  useEffect(() => {
    if (open) {
      setStatus("idle");
      setProgress(null);
      setResult(null);
      setError("");
    }
  }, [open]);

  /**
   * 执行迁移
   * 流程:
   *   1. 切换至 migrating 状态
   *   2. 调用 migrate_legacy_project Tauri 命令
   *   3. 成功则切换至 success 状态，2 秒后调用 onMigrated
   *   4. 失败则切换至 failed 状态，显示错误信息
   */
  const handleMigrate = useCallback(async () => {
    setStatus("migrating");
    setError("");
    setResult(null);
    try {
      const res = await invoke<MigrationResult>("migrate_legacy_project", {
        projectPath,
      });
      setResult(res);
      setStatus("success");
      // 成功后延迟 1.5 秒通知父组件刷新（让用户看到成功提示）
      setTimeout(() => {
        onMigrated();
      }, 1500);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(errMsg);
      setStatus("failed");
    }
  }, [projectPath, onMigrated]);

  // Esc 键关闭（仅 idle/success/failed 状态允许，migrating 中禁止）
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && status !== "migrating") {
        e.preventDefault();
        onClose();
      }
    },
    [status, onClose]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        // migrating 中禁止点击遮罩关闭
        if (e.target === e.currentTarget && status !== "migrating") {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="legacy-migration-title"
        className="nf-glass-panel w-full max-w-lg bg-nf-bg-card border border-nf-border-light shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-nf-border-light">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h3
              id="legacy-migration-title"
              className="text-sm font-semibold font-display text-nf-text"
            >
              {t("legacyMigration.title")}
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={status === "migrating"}
            className="p-1 hover:bg-nf-bg-hover text-nf-text-tertiary transition duration-fast disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={t("app.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="px-5 py-4 space-y-4">
          {/* 说明 */}
          <p className="text-sm text-nf-text-secondary leading-relaxed">
            {t("legacyMigration.description")}
          </p>

          {/* 目录映射表 */}
          <div className="bg-nf-bg/40 border border-nf-border-light rounded-md p-3">
            <div className="text-xs font-medium text-nf-text-tertiary uppercase tracking-wider mb-2">
              {t("legacyMigration.mapping")}
            </div>
            <div className="space-y-1.5">
              {DIRECTORY_MAPPINGS.map((m) => (
                <div
                  key={m.from}
                  className="flex items-center gap-2 text-xs text-nf-text-secondary"
                >
                  <span className="font-mono px-1.5 py-0.5 bg-nf-bg rounded border border-nf-border-light min-w-[60px] text-center">
                    {m.from}
                  </span>
                  <ArrowRight className="w-3 h-3 text-fandex-primary flex-shrink-0" />
                  <span className="font-mono px-1.5 py-0.5 bg-nf-bg rounded border border-nf-border-light min-w-[60px] text-center">
                    {m.to}
                  </span>
                  <span className="text-nf-text-tertiary ml-1">({m.note})</span>
                </div>
              ))}
            </div>
          </div>

          {/* 警告提示 */}
          <div className="flex items-start gap-2 text-xs text-amber-400/90 bg-amber-500/5 border border-amber-500/20 rounded-md p-2.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span className="leading-relaxed">{t("legacyMigration.warning")}</span>
          </div>

          {/* 迁移进度 */}
          {status === "migrating" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-nf-text-secondary">
                <Loader2 className="w-3.5 h-3.5 text-fandex-primary animate-spin" />
                <span>{t("legacyMigration.migrating")}</span>
              </div>
              {progress && (
                <>
                  <div className="w-full h-1.5 bg-nf-bg rounded-full overflow-hidden">
                    <div
                      className="h-full bg-fandex-primary transition-all duration-200"
                      style={{
                        width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-nf-text-tertiary">
                    <span>
                      {t("legacyMigration.progress")
                        .replace("{done}", String(progress.done))
                        .replace("{total}", String(progress.total))}
                    </span>
                    <span className="truncate ml-2 max-w-[200px]" title={progress.currentFile}>
                      {progress.currentFile}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 成功提示 */}
          {status === "success" && result && (
            <div className="flex items-start gap-2 text-xs text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded-md p-2.5">
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-medium">{t("legacyMigration.success")}</div>
                <div className="text-nf-text-tertiary">
                  {t("legacyMigration.successDesc").replace(
                    "{count}",
                    String(result.migratedCount)
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 失败提示 */}
          {status === "failed" && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-md p-2.5">
                <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-medium">{t("legacyMigration.failed")}</div>
                  <div className="text-nf-text-tertiary break-all">{error}</div>
                </div>
              </div>
              <div className="text-[10px] text-nf-text-tertiary italic">
                {t("legacyMigration.rollback")}
              </div>
            </div>
          )}
        </div>

        {/* 操作栏 */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-nf-border-light">
          {status === "idle" && (
            <>
              <button
                onClick={onClose}
                className="nf-tool-btn h-8 px-4 text-sm flex items-center justify-center gap-1.5 border border-nf-border-light text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
              >
                {t("legacyMigration.later")}
              </button>
              <button
                onClick={handleMigrate}
                className="nf-tool-btn h-8 px-4 text-sm flex items-center justify-center gap-1.5 font-medium text-nf-text-inverse bg-fandex-primary hover:bg-fandex-primary-hover transition duration-fast"
              >
                {t("legacyMigration.migrate")}
              </button>
            </>
          )}
          {status === "migrating" && (
            <button
              disabled
              className="nf-tool-btn h-8 px-4 text-sm flex items-center justify-center gap-1.5 font-medium text-nf-text-tertiary bg-nf-bg border border-nf-border-light cursor-not-allowed"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t("legacyMigration.migrating")}
            </button>
          )}
          {(status === "success" || status === "failed") && (
            <button
              onClick={onClose}
              className="nf-tool-btn h-8 px-4 text-sm flex items-center justify-center gap-1.5 font-medium text-nf-text-inverse bg-fandex-primary hover:bg-fandex-primary-hover transition duration-fast"
            >
              {t("legacyMigration.close")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
