// 版本检查 Hook
//
// 功能概述：
// 封装应用版本号读取与启动时自动检查更新逻辑,统一管理版本检查相关状态。
// 通过 settingsStore 读取用户偏好(是否启动时检查、跳过的版本号、上次检查时间),
// 检测到新版本时通过 autoCheckDialogOpen 状态由组件渲染 UpdateNoticeDialog。
//
// 模块职责:
// 1. 读取 package.json 应用版本号
// 2. 启动时根据设置自动检查更新(24 小时内不重复检查)
// 3. 提供手动检查方法 checkNow
// 4. 维护 hasUpdate/latestVersion/autoCheckRelease 状态供 UI 渲染

import { useState, useEffect, useCallback } from "react";
import { checkForUpdates, FALLBACK_VERSION, type ReleaseInfo } from "../lib/updateChecker";
import { logger } from "../lib/logger";
import { useSettingsStore } from "../lib/settingsStore";

// 24 小时常量(毫秒),用于限制自动检查频率
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 版本检查 Hook
 * 输入: 无
 * 输出:
 *   - appVersion: 当前应用版本号(来源 package.json,失败时回退到 FALLBACK_VERSION)
 *   - latestVersion: 最新版本号(检查后才有值,未检查时为空字符串)
 *   - hasUpdate: 是否检测到新版本
 *   - autoCheckRelease: 自动检查发现的 Release 信息(用于 UpdateNoticeDialog 渲染)
 *   - autoCheckDialogOpen: 自动检查对话框是否打开
 *   - setAutoCheckDialogOpen: 控制对话框开关
 *   - skipVersion: 跳过指定版本(用户在对话框选择「跳过此版本」时调用)
 *   - checkNow: 手动触发检查(失败时静默处理,返回检查结果)
 * 流程:
 *   1. 挂载时从 package.json 读取版本号
 *   2. 挂载时根据 settingsStore 配置启动自动检查
 *   3. 自动检查条件:启用 + 距上次检查超过 24 小时 + 未被用户跳过
 *   4. 检测到新版本时设置 autoCheckRelease 并打开对话框
 */
export function useVersionCheck() {
  // 当前应用版本号(由 package.json 注入,失败时回退到 FALLBACK_VERSION)
  const [appVersion, setAppVersion] = useState(FALLBACK_VERSION);
  // 最新版本号(执行检查后才有值)
  const [latestVersion, setLatestVersion] = useState("");
  // 是否检测到新版本
  const [hasUpdate, setHasUpdate] = useState(false);
  // 自动检查发现的 Release 信息
  const [autoCheckRelease, setAutoCheckRelease] = useState<ReleaseInfo | null>(null);
  // 自动检查对话框是否打开
  const [autoCheckDialogOpen, setAutoCheckDialogOpen] = useState(false);

  // 从 settingsStore 读取更新检查相关配置
  const checkUpdateOnStartup = useSettingsStore((s) => s.checkUpdateOnStartup);
  const lastUpdateCheckTime = useSettingsStore((s) => s.lastUpdateCheckTime);
  const skipUpdateVersion = useSettingsStore((s) => s.skipUpdateVersion);
  const setLastUpdateCheckTime = useSettingsStore((s) => s.setLastUpdateCheckTime);
  const setSkipUpdateVersion = useSettingsStore((s) => s.setSkipUpdateVersion);

  /**
   * 从 package.json 读取应用版本号
   * 失败时保持默认版本号,仅在控制台输出警告便于调试
   */
  useEffect(() => {
    let cancelled = false;
    import("../../package.json")
      .then((pkg) => {
        if (cancelled) return;
        if (pkg.version) setAppVersion(pkg.version);
      })
      .catch((e) => {
        logger.warn("读取版本号失败:", e instanceof Error ? e : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 启动时自动检查更新
   * 条件:
   *   1. 用户启用了「启动时自动检查更新」
   *   2. 距离上次检查超过 24 小时(避免频繁请求)
   * 失败时静默处理,不干扰用户
   */
  useEffect(() => {
    if (!checkUpdateOnStartup) return;
    const now = Date.now();
    // 24 小时内已检查过则跳过
    if (lastUpdateCheckTime > 0 && now - lastUpdateCheckTime < ONE_DAY_MS) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await checkForUpdates();
        if (cancelled) return;
        setLastUpdateCheckTime(now);
        setLatestVersion(result.latest.version);
        setHasUpdate(result.hasUpdate);
        // 有新版本且未被用户跳过时弹出提示
        if (result.hasUpdate && result.latest.version !== skipUpdateVersion) {
          setAutoCheckRelease(result.latest);
          setAutoCheckDialogOpen(true);
        }
      } catch {
        // 自动检查失败时静默处理,不干扰用户
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    checkUpdateOnStartup,
    lastUpdateCheckTime,
    skipUpdateVersion,
    setLastUpdateCheckTime,
  ]);

  /**
   * 手动触发版本检查
   * 输入: 无
   * 输出:
   *   成功时返回 { hasUpdate, current, latest },失败时返回 null
   * 流程:
   *   1. 调用 checkForUpdates 获取最新版本信息
   *   2. 同步 latestVersion 与 hasUpdate 状态
   *   3. 失败时静默返回 null(由调用方决定是否反馈)
   */
  const checkNow = useCallback(async () => {
    try {
      const result = await checkForUpdates();
      setLatestVersion(result.latest.version);
      setHasUpdate(result.hasUpdate);
      setLastUpdateCheckTime(Date.now());
      return result;
    } catch {
      // 手动检查失败时静默处理,由调用方决定是否反馈
      return null;
    }
  }, [setLastUpdateCheckTime]);

  /**
   * 跳过指定版本
   * 用户在 UpdateNoticeDialog 选择「跳过此版本」时调用
   * 同时关闭对话框并持久化跳过版本号
   *
   * 输入: version 要跳过的版本号
   */
  const skipVersion = useCallback(
    (version: string) => {
      setSkipUpdateVersion(version);
      setAutoCheckDialogOpen(false);
    },
    [setSkipUpdateVersion]
  );

  return {
    appVersion,
    latestVersion,
    hasUpdate,
    autoCheckRelease,
    autoCheckDialogOpen,
    setAutoCheckDialogOpen,
    skipVersion,
    checkNow,
  };
}
