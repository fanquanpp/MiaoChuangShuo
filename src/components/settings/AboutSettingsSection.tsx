// 关于设置分区组件
//
// 功能概述：
// 设置对话框「关于」分区，展示应用版本号、提供手动检查更新功能、
// 启动时自动检查开关、已跳过版本管理，以及发布页面链接跳转。
// 检测到新版本时弹出 UpdateNoticeDialog 供用户查看详情。
//
// 模块职责：
// 1. 展示当前应用版本号
// 2. 提供手动检查更新按钮（含 loading 状态）
// 3. 显示上次检查时间
// 4. 提供启动时自动检查开关
// 5. 显示已跳过版本并提供取消跳过入口
// 6. 提供发布页面外部链接
// 7. 检测到新版本时弹出更新提示对话框
//
// 设计说明：
// - 默认版本号使用 FALLBACK_VERSION 常量，组件挂载时异步获取真实版本
// - 检查更新通过 updateChecker 模块的 checkForUpdates 函数
// - 跳过版本状态持久化在 settingsStore 中

import { useState, useEffect, useCallback } from "react";
import { Info, RefreshCw, ExternalLink, CheckCircle } from "lucide-react";
import { useSettingsStore } from "../../lib/settingsStore";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import {
  checkForUpdates,
  getCurrentVersion,
  openExternalUrl,
  RELEASES_PAGE_URL,
  FALLBACK_VERSION,
  type ReleaseInfo,
} from "../../lib/updateChecker";
import UpdateNoticeDialog from "../UpdateNoticeDialog";

/**
 * 关于设置分区组件
 *
 * 输入: 无（通过 Zustand store 获取全局状态）
 * 输出: JSX 关于设置分区内容（含更新提示弹窗）
 * 流程:
 *   1. 组件挂载时异步获取当前版本号
 *   2. 用户点击「检查更新」触发 checkForUpdates
 *   3. 有新版本: 检查是否已跳过，未跳过则弹出 UpdateNoticeDialog
 *   4. 无新版本: toast 提示「已是最新」
 *   5. 失败: toast 提示错误信息
 *   6. 更新 lastUpdateCheckTime 到 store
 */
export default function AboutSettingsSection() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const {
    checkUpdateOnStartup,
    lastUpdateCheckTime,
    skipUpdateVersion,
    setCheckUpdateOnStartup,
    setLastUpdateCheckTime,
    setSkipUpdateVersion,
  } = useSettingsStore();

  // ===== 版本更新检测状态 =====
  // 当前应用版本号（初始使用 FALLBACK_VERSION，挂载后异步获取真实版本）
  const [currentVersion, setCurrentVersion] = useState(FALLBACK_VERSION);
  // 检查中状态（控制按钮 loading 动画）
  const [checking, setChecking] = useState(false);
  // 检测到的新版本信息（null=未检测到或未检查）
  const [latestRelease, setLatestRelease] = useState<ReleaseInfo | null>(null);
  // 更新提示弹窗显示状态
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);

  // 组件挂载时获取当前版本号
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const v = await getCurrentVersion();
        if (mounted) setCurrentVersion(v);
      } catch {
        // 获取失败时保持 FALLBACK_VERSION
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  /**
   * 手动触发检查更新
   * 流程:
   *   1. 设置 checking 状态
   *   2. 调用 checkForUpdates 获取结果
   *   3. 有新版本: 检查是否已跳过，未跳过则弹出 UpdateNoticeDialog
   *   4. 无新版本: toast 提示「已是最新」
   *   5. 失败: toast 提示错误信息
   *   6. 更新 lastUpdateCheckTime
   */
  const handleCheckUpdate = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      const result = await checkForUpdates();
      setLastUpdateCheckTime(Date.now());

      if (result.hasUpdate) {
        // 检查用户是否已跳过此版本
        if (skipUpdateVersion === result.latest.version) {
          showToast("info", t("update.upToDateDesc", { version: result.current }), 4000);
        } else {
          setLatestRelease(result.latest);
          setUpdateDialogOpen(true);
        }
      } else {
        showToast("success", t("update.upToDateDesc", { version: result.current }), 4000);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("error", t("update.checkFailed", { error: msg }), 5000);
    } finally {
      setChecking(false);
    }
  }, [checking, setLastUpdateCheckTime, skipUpdateVersion, showToast, t]);

  return (
    <>
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Info className="w-4 h-4 text-fandex-primary" />
          <h3 className="text-sm font-bold font-display text-nf-text">
            {t("update.section")}
          </h3>
        </div>

        <div className="space-y-3">
          {/* 当前版本号 + 检查更新按钮 */}
          <div className="flex items-center justify-between p-3 border border-nf-border-light bg-nf-bg">
            <div>
              <div className="text-xs text-nf-text-secondary mb-0.5">
                {t("update.currentVersion")}
              </div>
              <div className="text-sm font-mono font-bold text-nf-text">
                v{currentVersion}
              </div>
            </div>
            <button
              onClick={handleCheckUpdate}
              disabled={checking}
              className="flex items-center gap-1.5 px-3 py-2 text-xs bg-fandex-primary/10 hover:bg-fandex-primary/20 border border-fandex-primary/40 text-fandex-primary transition duration-fast disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} />
              {checking ? t("update.checking") : t("update.checkNow")}
            </button>
          </div>

          {/* 上次检查时间 */}
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-nf-text-tertiary">{t("update.lastCheck")}</span>
            <span className="text-nf-text-secondary font-mono">
              {lastUpdateCheckTime > 0
                ? new Date(lastUpdateCheckTime).toLocaleString("zh-CN", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : t("update.neverChecked")}
            </span>
          </div>

          {/* 启动时自动检查更新 */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={checkUpdateOnStartup}
              onChange={(e) => setCheckUpdateOnStartup(e.target.checked)}
              className="w-4 h-4 accent-fandex-primary cursor-pointer"
            />
            <div>
              <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                {t("update.autoCheck")}
              </span>
              <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                {t("update.autoCheckHint")}
              </p>
            </div>
          </label>

          {/* 已跳过版本显示（仅当用户跳过过版本时显示） */}
          {skipUpdateVersion && (
            <div className="flex items-center justify-between p-2 border border-nf-border-light bg-nf-bg-hover/50">
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-3 h-3 text-nf-text-tertiary" />
                <span className="text-[11px] text-nf-text-tertiary">
                  {t("update.skipVersion")}: v{skipUpdateVersion}
                </span>
              </div>
              <button
                onClick={() => setSkipUpdateVersion("")}
                className="text-[10px] text-fandex-primary hover:text-fandex-primary-hover transition duration-fast"
              >
                {t("app.cancel")}
              </button>
            </div>
          )}

          {/* 查看发布页面链接 */}
          <button
            onClick={() => openExternalUrl(RELEASES_PAGE_URL)}
            className="flex items-center gap-1.5 text-[11px] text-nf-text-tertiary hover:text-fandex-primary transition duration-fast"
          >
            <ExternalLink className="w-3 h-3" />
            {t("update.viewReleases")}
          </button>
        </div>
      </section>

      {/* 更新提示弹窗（检测到新版本时显示） */}
      <UpdateNoticeDialog
        open={updateDialogOpen}
        onClose={() => setUpdateDialogOpen(false)}
        currentVersion={currentVersion}
        release={latestRelease}
        onSkip={(version) => setSkipUpdateVersion(version)}
      />
    </>
  );
}
