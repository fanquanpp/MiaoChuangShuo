// 版本更新检测模块
//
// 功能概述：
// 通过 GitHub Releases API 检查应用最新版本，与本地版本比较，
// 提示用户更新。遵循离线优先原则：仅在被触发时联网，不后台静默检查。
//
// 模块职责：
// 1. 获取当前应用版本（优先 Tauri API，失败回退硬编码常量）
// 2. 调用 GitHub API 获取最新 Release 信息
// 3. 语义化版本比较
// 4. 提供发布页面 URL 供前端跳转

import { getVersion } from "@tauri-apps/api/app";
import { open as shellOpen } from "@tauri-apps/plugin-shell";

// GitHub 仓库 API 端点（获取最新正式 Release）
// 仓库已重命名为 MiaoChuangShuo（与应用拼音 productName 保持一致）
const GITHUB_LATEST_API =
  "https://api.github.com/repos/fanquanpp/MiaoChuangShuo/releases/latest";

// GitHub Releases 页面（供用户手动下载）
export const RELEASES_PAGE_URL =
  "https://github.com/fanquanpp/MiaoChuangShuo/releases";

// 本地回退版本号（Tauri API 不可用时使用，需与 package.json/tauri.conf.json 保持同步）
const FALLBACK_VERSION = "26.7.26";

/**
 * 远程 Release 信息结构
 */
export interface ReleaseInfo {
  /** 版本号（已去除前缀 v，如 "26.7.1"） */
  version: string;
  /** 发布页面 URL */
  htmlUrl: string;
  /** 发布说明（Markdown 原文，可能为空） */
  releaseNotes: string;
  /** 发布时间（ISO 8601 字符串） */
  publishedAt: string;
  /** 是否为预发布版本 */
  prerelease: boolean;
}

/**
 * 获取当前应用版本号
 * 优先调用 Tauri API 获取真实版本（来源 tauri.conf.json），
 * 在浏览器开发环境或 API 不可用时回退到硬编码常量。
 *
 * 输入: 无
 * 输出: 当前版本号字符串（如 "3.0.0"）
 */
export async function getCurrentVersion(): Promise<string> {
  try {
    const v = await getVersion();
    if (v && typeof v === "string") return v;
    return FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

/**
 * 从 GitHub Releases API 获取最新版本信息
 * 仅获取最新正式 Release（不含 prerelease/draft）
 *
 * 输入: 无
 * 输出: ReleaseInfo 对象
 * 异常: 网络错误或 API 返回非 2xx 时抛出 Error
 */
export async function fetchLatestRelease(): Promise<ReleaseInfo> {
  const response = await fetch(GITHUB_LATEST_API, {
    headers: {
      Accept: "application/vnd.github+json",
      // GitHub API 匿名调用有速率限制(60次/小时)，足够日常使用
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("尚未发布任何 Release");
    }
    if (response.status === 403) {
      throw new Error("GitHub API 速率限制，请稍后再试");
    }
    throw new Error(`GitHub API 返回 ${response.status}`);
  }

  const data = await response.json();
  // tag_name 通常为 "v26.7.1"，去除前缀 v 以便比较
  const tag: string = data.tag_name || "";
  const version = tag.startsWith("v") ? tag.slice(1) : tag;

  if (!version) {
    throw new Error("Release 信息缺少 tag_name 字段");
  }

  return {
    version,
    htmlUrl: data.html_url || RELEASES_PAGE_URL,
    releaseNotes: typeof data.body === "string" ? data.body : "",
    publishedAt: data.published_at || "",
    prerelease: Boolean(data.prerelease),
  };
}

/**
 * 语义化版本比较
 * 仅比较数字部分，忽略预发布后缀（如 -beta.1）
 *
 * 输入:
 *   a 版本字符串（如 "3.0.0"）
 *   b 版本字符串（如 "26.7.1"）
 * 输出:
 *   a > b 返回 1
 *   a < b 返回 -1
 *   a === b 返回 0
 */
export function compareVersions(a: string, b: string): number {
  // 提取主版本号部分（截断 - 或 + 后缀）
  const cleanA = a.split(/[-+]/)[0];
  const cleanB = b.split(/[-+]/)[0];

  const parseParts = (v: string): number[] => {
    return v
      .split(".")
      .map((part) => {
        const n = parseInt(part.replace(/\D/g, ""), 10);
        return isNaN(n) ? 0 : n;
      });
  };

  const partsA = parseParts(cleanA);
  const partsB = parseParts(cleanB);
  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

/**
 * 检查更新整合函数
 * 获取本地版本与远程最新版本，判断是否有新版本
 *
 * 输入: 无
 * 输出:
 *   { hasUpdate, current, latest, release } 对象
 *   hasUpdate 为 true 时表示存在新版本
 * 异常: 网络或 API 错误时抛出
 */
export async function checkForUpdates(): Promise<{
  hasUpdate: boolean;
  current: string;
  latest: ReleaseInfo;
}> {
  const [current, latest] = await Promise.all([
    getCurrentVersion(),
    fetchLatestRelease(),
  ]);

  const hasUpdate = compareVersions(latest.version, current) > 0;

  return { hasUpdate, current, latest };
}

/**
 * 在系统默认浏览器中打开指定 URL
 * 优先使用 Tauri shell.open（跨平台调用系统浏览器），
 * 回退到 window.open（浏览器环境）
 *
 * 输入:
 *   url 要打开的外部 URL
 * 输出: 无
 */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    await shellOpen(url);
  } catch {
    // Tauri API 不可用时（如浏览器开发环境），回退到 window.open
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
}
