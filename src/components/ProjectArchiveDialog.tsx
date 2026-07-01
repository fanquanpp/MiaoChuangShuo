// 项目归档对话框组件
//
// 功能概述：
// 提供项目导入导出的统一入口。支持将整个项目打包为 .novelforge 压缩包，
// 以及从 .novelforge 压缩包恢复项目。基于 zip 格式，含路径穿越防护。
//
// 模块职责：
// 1. 导出模式：选择保存位置 → 调用 exportProject → 显示结果统计
// 2. 导入模式：选择压缩包 → 选择目标目录 → 调用 importArchive → 显示结果统计
// 3. 友好的进度反馈与错误提示
// 4. 导入完成后回调通知调用方刷新项目列表

import { useState, useCallback } from "react";
import { X, Download, Upload, FileArchive, FolderOpen, Loader2, CheckCircle2 } from "lucide-react";
import {
  exportProject,
  importArchive,
  pickSaveFile,
  pickOpenArchive,
  pickDirectory,
  type ExportResult,
  type ImportResult,
} from "../lib/api";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";

/** 对话框模式 */
type ArchiveMode = "export" | "import";

interface ProjectArchiveDialogProps {
  /** 是否显示 */
  open: boolean;
  /** 模式：导出 / 导入 */
  mode: ArchiveMode;
  /** 关闭回调 */
  onClose: () => void;
  /** 当前项目路径（导出模式必填） */
  projectPath?: string;
  /** 当前项目名称（用于默认导出文件名） */
  projectName?: string;
  /** 导入成功回调（调用方可在此刷新项目列表） */
  onImported?: (targetDir: string, projectName: string) => void;
}

/**
 * 项目归档对话框
 * 输入:
 *   - open: 显示状态
 *   - mode: "export" | "import"
 *   - projectPath: 项目根路径（导出模式）
 *   - projectName: 项目名称（导出默认文件名）
 *   - onClose: 关闭回调
 *   - onImported: 导入成功回调
 * 输出: JSX 模态框
 * 流程:
 *   导出: 选择保存位置 → 调用 exportProject → 显示统计
 *   导入: 选择压缩包 → 选择目标目录 → 调用 importArchive → 回调刷新
 */
export default function ProjectArchiveDialog({
  open,
  mode,
  projectPath,
  projectName,
  onClose,
  onImported,
}: ProjectArchiveDialogProps) {
  const { t } = useI18n();
  const { showToast } = useToast();

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | ImportResult | null>(null);

  // 导入模式临时状态
  const [archivePath, setArchivePath] = useState<string>("");
  const [targetDir, setTargetDir] = useState<string>("");

  // 格式化字节为可读字符串
  const formatSize = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }, []);

  // 导出处理：弹出保存对话框 → 调用后端打包
  const handleExport = useCallback(async () => {
    if (!projectPath) {
      showToast("error", t("archive.noProject"));
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      // 默认文件名：项目名.novelforge
      const defaultName = (projectName || "project") + ".novelforge";
      const outputPath = await pickSaveFile(defaultName);
      if (!outputPath) {
        setBusy(false);
        return;
      }
      const res = await exportProject(projectPath, outputPath);
      setResult(res);
      showToast("success", t("archive.exportSuccess", { count: res.file_count }));
    } catch (e) {
      showToast("error", t("archive.exportFailed", { error: String(e) }));
    } finally {
      setBusy(false);
    }
  }, [projectPath, projectName, t, showToast]);

  // 选择压缩包文件
  const handlePickArchive = useCallback(async () => {
    try {
      const path = await pickOpenArchive();
      if (path) setArchivePath(path);
    } catch {
      // 用户取消，静默忽略
    }
  }, []);

  // 选择目标目录
  const handlePickTarget = useCallback(async () => {
    try {
      const dir = await pickDirectory();
      if (dir) setTargetDir(dir);
    } catch {
      // 用户取消，静默忽略
    }
  }, []);

  // 导入处理：校验路径 → 调用后端解压 → 回调刷新
  const handleImport = useCallback(async () => {
    if (!archivePath) {
      showToast("error", t("archive.noArchiveSelected"));
      return;
    }
    if (!targetDir) {
      showToast("error", t("archive.noTargetDir"));
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await importArchive(archivePath, targetDir);
      setResult(res);
      showToast(
        "success",
        t("archive.importSuccess", { name: res.project_name || t("archive.defaultProjectName"), count: res.file_count })
      );
      if (onImported && res.project_name) {
        // 解压后的项目路径：target_dir/project_name
        onImported(targetDir, res.project_name);
      }
    } catch (e) {
      showToast("error", t("archive.importFailed", { error: String(e) }));
    } finally {
      setBusy(false);
    }
  }, [archivePath, targetDir, onImported, t, showToast]);

  // 关闭时重置状态
  const handleClose = useCallback(() => {
    if (busy) return;
    setResult(null);
    setArchivePath("");
    setTargetDir("");
    onClose();
  }, [busy, onClose]);

  // 遮罩点击关闭
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) handleClose();
    },
    [handleClose]
  );

  if (!open) return null;

  const isExport = mode === "export";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      <div className="w-full max-w-lg bg-nf-bg-card border border-nf-border-light shadow-2xl max-h-[85vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light flex-shrink-0">
          <h2 className="fandex-bar-left text-base font-bold font-display text-nf-text flex items-center gap-2">
            {isExport ? (
              <Download className="w-4 h-4 text-fandex-primary" />
            ) : (
              <Upload className="w-4 h-4 text-fandex-secondary" />
            )}
            {isExport ? t("archive.exportTitle") : t("archive.importTitle")}
          </h2>
          <button
            onClick={handleClose}
            disabled={busy}
            className="text-nf-text-secondary hover:text-nf-text disabled:opacity-30 transition-colors"
            title={t("app.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="px-6 py-5 overflow-y-auto space-y-4">
          {/* 说明文字 */}
          <p className="text-xs text-nf-text-secondary leading-relaxed">
            {isExport ? t("archive.exportDesc") : t("archive.importDesc")}
          </p>

          {/* 导出模式 */}
          {isExport && (
            <div className="space-y-3">
              {/* 项目信息 */}
              <div className="flex items-center gap-2 px-3 py-2 bg-nf-bg-hover border border-nf-border-light">
                <FileArchive className="w-4 h-4 text-fandex-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-nf-text-secondary">{t("archive.currentProject")}</div>
                  <div className="text-sm text-nf-text truncate">
                    {projectName || t("archive.unnamed")}
                  </div>
                </div>
              </div>

              {/* 格式说明 */}
              <div className="text-xs text-nf-text-secondary px-3 py-2 border border-dashed border-nf-border-light">
                {t("archive.formatHint")}
              </div>
            </div>
          )}

          {/* 导入模式 */}
          {!isExport && (
            <div className="space-y-3">
              {/* 选择压缩包 */}
              <div>
                <label className="block text-xs text-nf-text-secondary mb-1.5">
                  {t("archive.archiveFile")}
                </label>
                <button
                  onClick={handlePickArchive}
                  disabled={busy}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-nf-bg-hover border border-nf-border-light hover:border-fandex-secondary/60 text-left transition-colors disabled:opacity-50"
                >
                  <FileArchive className="w-4 h-4 text-fandex-secondary flex-shrink-0" />
                  <span className="flex-1 text-sm text-nf-text truncate">
                    {archivePath || t("archive.archivePlaceholder")}
                  </span>
                </button>
              </div>

              {/* 选择目标目录 */}
              <div>
                <label className="block text-xs text-nf-text-secondary mb-1.5">
                  {t("archive.targetDir")}
                </label>
                <button
                  onClick={handlePickTarget}
                  disabled={busy}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-nf-bg-hover border border-nf-border-light hover:border-fandex-primary/60 text-left transition-colors disabled:opacity-50"
                >
                  <FolderOpen className="w-4 h-4 text-fandex-primary flex-shrink-0" />
                  <span className="flex-1 text-sm text-nf-text truncate">
                    {targetDir || t("archive.targetPlaceholder")}
                  </span>
                </button>
              </div>

              {/* 安全提示 */}
              <div className="text-xs text-nf-text-secondary px-3 py-2 border border-dashed border-nf-border-light">
                {t("archive.safetyHint")}
              </div>
            </div>
          )}

          {/* 结果统计 */}
          {result && (
            <div className="space-y-2 px-3 py-3 bg-fandex-primary/5 border border-fandex-primary/30">
              <div className="flex items-center gap-2 text-sm text-fandex-primary">
                <CheckCircle2 className="w-4 h-4" />
                <span className="font-medium">
                  {isExport ? t("archive.exportDone") : t("archive.importDone")}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-nf-text-secondary">
                <div>
                  <span className="text-nf-text-secondary">{t("archive.fileCount")}：</span>
                  <span className="text-nf-text font-medium">
                    {result.file_count}
                  </span>
                </div>
                <div>
                  <span className="text-nf-text-secondary">{t("archive.totalSize")}：</span>
                  <span className="text-nf-text font-medium">
                    {formatSize(result.total_size)}
                  </span>
                </div>
                {"output_size" in result && (
                  <div className="col-span-2">
                    <span className="text-nf-text-secondary">{t("archive.archiveSize")}：</span>
                    <span className="text-nf-text font-medium">
                      {formatSize(result.output_size)}
                    </span>
                  </div>
                )}
                {"project_name" in result && result.project_name && (
                  <div className="col-span-2">
                    <span className="text-nf-text-secondary">{t("archive.projectNameLabel")}：</span>
                    <span className="text-nf-text font-medium">{result.project_name}</span>
                  </div>
                )}
              </div>
              {"output_path" in result && (
                <div className="text-xs text-nf-text-secondary break-all">
                  <span>{t("archive.outputPath")}：</span>
                  <code className="text-fandex-primary">{result.output_path}</code>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部操作区 */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-nf-border-light flex-shrink-0">
          <button
            onClick={handleClose}
            disabled={busy}
            className="px-4 py-1.5 text-xs text-nf-text-secondary hover:text-nf-text border border-nf-border-light hover:bg-nf-bg-hover transition-colors disabled:opacity-50"
          >
            {result ? t("app.close") : t("app.cancel")}
          </button>
          {!result && (
            <button
              onClick={isExport ? handleExport : handleImport}
              disabled={busy || (!isExport && (!archivePath || !targetDir))}
              className="px-4 py-1.5 text-xs text-white bg-fandex-primary hover:bg-fandex-primary/90 border border-fandex-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {busy ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {isExport ? t("archive.exporting") : t("archive.importing")}
                </>
              ) : (
                <>
                  {isExport ? (
                    <Download className="w-3.5 h-3.5" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  {isExport ? t("archive.exportBtn") : t("archive.importBtn")}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
