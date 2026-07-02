// 更新提示对话框组件
//
// 功能概述：
// 当检测到新版本时弹出，展示版本号、发布说明，提供立即下载、稍后提醒、
// 跳过此版本三种操作。采用 FANDEX 暗色主题模态框风格。
//
// 模块职责：
// 1. 展示当前版本与最新版本对比
// 2. 渲染发布说明（Markdown 原文以等宽字体展示）
// 3. 提供三种用户操作入口
// 4. 通过 Tauri shell.open 在系统浏览器中打开下载页面

import { useCallback } from "react";
import { X, Download, Clock, SkipForward, Sparkles, ExternalLink } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { openExternalUrl, type ReleaseInfo } from "../lib/updateChecker";

interface UpdateNoticeDialogProps {
  /** 对话框显示状态 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 当前应用版本号 */
  currentVersion: string;
  /** 最新版本信息 */
  release: ReleaseInfo | null;
  /** 跳过此版本回调 */
  onSkip: (version: string) => void;
}

/**
 * 更新提示对话框组件
 * 输入:
 *   - open: 显示状态
 *   - onClose: 关闭回调
 *   - currentVersion: 当前版本号
 *   - release: 最新版本信息（null 时不渲染内容）
 *   - onSkip: 跳过指定版本回调
 * 输出: JSX 模态框（open=false 或 release=null 时返回 null）
 * 流程:
 *   1. 接收 release 信息渲染版本对比
 *   2. 发布说明截断显示（避免过长）
 *   3. 用户点击"立即下载"调用 openExternalUrl 打开 Releases 页面
 *   4. 用户点击"跳过此版本"触发 onSkip 回调
 */
export default function UpdateNoticeDialog({
  open,
  onClose,
  currentVersion,
  release,
  onSkip,
}: UpdateNoticeDialogProps) {
  const { t } = useI18n();

  /**
   * 处理立即下载点击
   * 调用 openExternalUrl 打开 Releases 页面，然后关闭对话框
   */
  const handleDownload = useCallback(async () => {
    if (!release) return;
    await openExternalUrl(release.htmlUrl);
    onClose();
  }, [release, onClose]);

  /**
   * 处理跳过此版本点击
   * 触发 onSkip 回调并关闭对话框
   */
  const handleSkip = useCallback(() => {
    if (!release) return;
    onSkip(release.version);
    onClose();
  }, [release, onSkip, onClose]);

  /**
   * 格式化发布时间
   * 将 ISO 字符串转为本地化日期显示（YYYY-MM-DD）
   */
  const formatPublishedDate = useCallback((iso: string): string => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    } catch {
      return iso;
    }
  }, []);

  if (!open || !release) return null;

  // 发布说明最大显示长度（超出部分截断，提示用户前往 GitHub 查看）
  const MAX_NOTES_LENGTH = 600;
  const notesRaw = release.releaseNotes || "";
  const isTruncated = notesRaw.length > MAX_NOTES_LENGTH;
  const notesDisplay = isTruncated
    ? notesRaw.slice(0, MAX_NOTES_LENGTH) + "..."
    : notesRaw;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="nf-glass-panel w-full max-w-md bg-nf-bg-card border border-nf-border-light shadow-2xl max-h-[85vh] flex flex-col">
        {/* 头部：渐变背景 + 新版本标识 */}
        <div className="relative px-6 py-5 border-b border-nf-border-light overflow-hidden flex-shrink-0">
          {/* 背景渐变装饰 */}
          <div
            className="absolute inset-0 opacity-[0.08]"
            style={{
              background:
                "linear-gradient(135deg, var(--fandex-primary), var(--fandex-secondary))",
            }}
          />
          <div className="relative flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 flex items-center justify-center bg-fandex-primary/10 border border-fandex-primary/30">
                <Sparkles className="w-4 h-4 text-fandex-primary" />
              </div>
              <div>
                <h2 className="fandex-bar-left text-base font-bold font-display text-nf-text">
                  {t("update.newVersionAvailable")}
                </h2>
                <p className="text-[11px] text-nf-text-tertiary mt-0.5 pl-3">
                  {t("update.newVersionDesc")}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
              title={t("app.close")}
              aria-label={t("app.close")}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* 版本对比 */}
          <div className="flex items-center gap-3">
            <div className="flex-1 text-center py-3 border border-nf-border-light bg-nf-bg">
              <div className="text-[10px] text-nf-text-tertiary mb-1 uppercase tracking-wider">
                {t("update.currentVersion")}
              </div>
              <div className="text-lg font-mono font-bold text-nf-text-secondary">
                v{currentVersion}
              </div>
            </div>
            {/* 箭头 */}
            <div className="text-nf-text-tertiary text-xl">→</div>
            <div className="flex-1 text-center py-3 border border-fandex-primary/40 bg-fandex-primary/5">
              <div className="text-[10px] text-fandex-primary mb-1 uppercase tracking-wider">
                {t("update.latestVersion")}
              </div>
              <div className="text-lg font-mono font-bold text-fandex-primary">
                v{release.version}
              </div>
            </div>
          </div>

          {/* 发布时间 */}
          {release.publishedAt && (
            <div className="text-[11px] text-nf-text-tertiary text-center">
              {t("update.publishedAt", {
                date: formatPublishedDate(release.publishedAt),
              })}
            </div>
          )}

          {/* 发布说明 */}
          {notesDisplay && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-3 bg-fandex-secondary" />
                <h3 className="text-xs font-bold font-display text-nf-text">
                  {t("update.releaseNotes")}
                </h3>
              </div>
              <pre className="px-3 py-2.5 bg-nf-bg border border-nf-border-light text-[11px] text-nf-text-secondary whitespace-pre-wrap break-words font-mono leading-relaxed max-h-48 overflow-y-auto">
                {notesDisplay}
              </pre>
              {isTruncated && (
                <p className="text-[10px] text-nf-text-tertiary text-right">
                  {t("update.viewReleases")} →
                </p>
              )}
            </div>
          )}
        </div>

        {/* 底部：操作按钮区 */}
        <div className="flex items-center gap-2 px-6 py-3 border-t border-nf-border-light flex-shrink-0">
          {/* 跳过此版本 */}
          <button
            onClick={handleSkip}
            title={t("update.skipVersionHint")}
            className="h-8 px-4 text-sm flex items-center justify-center gap-1.5 text-nf-text-tertiary hover:text-nf-text-secondary border border-nf-border-light hover:border-nf-border transition duration-fast nf-tool-btn"
          >
            <SkipForward className="w-3.5 h-3.5" />
            {t("update.skipVersion")}
          </button>

          {/* 稍后提醒 */}
          <button
            onClick={onClose}
            title={t("update.remindLaterHint")}
            className="h-8 px-4 text-sm flex items-center justify-center gap-1.5 text-nf-text-secondary hover:text-nf-text border border-nf-border-light hover:border-nf-border transition duration-fast nf-tool-btn"
          >
            <Clock className="w-3.5 h-3.5" />
            {t("update.remindLater")}
          </button>

          {/* 立即下载（主按钮） */}
          <button
            onClick={handleDownload}
            className="h-8 px-4 text-sm flex items-center justify-center gap-1.5 font-medium bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast ml-auto"
          >
            <Download className="w-3.5 h-3.5" />
            {t("update.downloadNow")}
            <ExternalLink className="w-3 h-3 opacity-70" />
          </button>
        </div>
      </div>
    </div>
  );
}
