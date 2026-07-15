// 关于设置分区组件
//
// 功能概述：
// 设置对话框「关于」分区，展示应用 Logo、版本号、项目介绍、核心特性、
// 技术栈、作者信息、致谢与开源协议。同时提供「复制版本号」「打开日志目录」
// 「检查更新」「跳转 GitHub 仓库 / Issue / Release」等辅助操作。
//
// 模块职责：
// 1. 顶部展示应用 Logo（Wand2 + 蓝紫渐变）+ 应用名 + slogan + 大字版本号
// 2. 项目介绍区（2-3 句话简介 + 三大原则卡片化展示）
// 3. 核心特性列表（5 大模块图标列表）
// 4. 技术栈展示（Tauri / React / Rust / TypeScript / TipTap / React Flow / Tantivy）
// 5. 作者信息区（fanquanpp + GitHub 仓库 / Issue / Release 链接按钮）
// 6. 致谢区（折叠，列出核心依赖库）
// 7. 开源协议区（链接到 LICENSE 文件）
// 8. 复制版本号按钮（navigator.clipboard.writeText）
// 9. 打开日志目录按钮（Tauri shell.open 打开 %APPDATA%/MiaoChuangShuo/logs）
// 10. 保留原有更新检查功能（手动检查 / 上次检查时间 / 自动检查开关 / 跳过版本）
//
// 设计说明：
// - 分区卡片化：bg-zinc-900/40 + rounded-lg + p-4
// - 链接按钮化：lucide-react ExternalLink 图标
// - 版本号大字展示：text-3xl font-bold + FANDEX primary 色
// - 默认版本号使用 FALLBACK_VERSION 常量，组件挂载时异步获取真实版本

import { useState, useEffect, useCallback } from "react";
import {
  Info,
  RefreshCw,
  ExternalLink,
  CheckCircle,
  Wand2,
  Copy,
  FolderOpen,
  BookOpen,
  Boxes,
  Users,
  GitBranch,
  Eye,
  Code,
  Bug,
  Tag,
  Shield,
  Heart,
  FileText,
} from "lucide-react";
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

// GitHub 仓库相关常量
const GITHUB_REPO_URL = "https://github.com/fanquanpp/MiaoChuangShuo";
const GITHUB_ISSUES_URL = "https://github.com/fanquanpp/MiaoChuangShuo/issues";
const GITHUB_LICENSE_URL =
  "https://github.com/fanquanpp/MiaoChuangShuo/blob/main/LICENSE";

// 日志目录路径片段（Windows: %APPDATA%\MiaoChuangShuo\logs）
const APP_DATA_DIR_NAME = "MiaoChuangShuo";
const LOGS_DIR_NAME = "logs";

/**
 * 核心特性条目数据结构
 */
type FeatureItem = {
  icon: typeof BookOpen;
  titleKey: string;
  descKey: string;
  iconColor: string;
};

/**
 * 技术栈条目数据结构
 */
type TechStackItem = {
  name: string;
  color: string;
};

/**
 * 致谢依赖条目数据结构
 */
type AcknowledgmentItem = {
  name: string;
  url: string;
  desc: string;
};

/**
 * 关于设置分区组件
 *
 * 输入: 无（通过 Zustand store 获取全局状态）
 * 输出: JSX 关于设置分区内容（含更新提示弹窗）
 * 流程:
 *   1. 组件挂载时异步获取当前版本号
 *   2. 渲染 Logo / 介绍 / 特性 / 技术栈 / 作者 / 致谢 / 协议
 *   3. 用户点击「复制版本号」调用 clipboard API
 *   4. 用户点击「打开日志目录」调用 Tauri shell.open
 *   5. 用户点击「检查更新」触发 checkForUpdates
 *   6. 有新版本: 检查是否已跳过，未跳过则弹出 UpdateNoticeDialog
 *   7. 无新版本: toast 提示「已是最新」
 *   8. 失败: toast 提示错误信息
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

  /**
   * 复制当前版本号到剪贴板
   * 使用 navigator.clipboard.writeText，失败时回退到 textarea + execCommand
   */
  const handleCopyVersion = useCallback(async () => {
    const text = `v${currentVersion}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // 回退方案：临时 textarea + execCommand（兼容旧环境）
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      showToast("success", t("about.versionCopied"), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("error", t("about.openLogsFailed", { error: msg }), 4000);
    }
  }, [currentVersion, showToast, t]);

  /**
   * 打开日志目录
   * 动态加载 @tauri-apps/api/path 获取 appDataDir，
   * 拼接 MiaoChuangShuo/logs 后调用 shell.open
   * 失败时 toast 提示错误信息
   */
  const handleOpenLogs = useCallback(async () => {
    try {
      const pathApi = await import("@tauri-apps/api/path");
      const shellApi = await import("@tauri-apps/plugin-shell");
      const appDataDir = await pathApi.appDataDir();
      // appDataDir 在 Windows 返回 %APPDATA%（如 C:\Users\<user>\AppData\Roaming）
      const sep = pathApi.sep();
      const logsPath = `${appDataDir}${sep}${APP_DATA_DIR_NAME}${sep}${LOGS_DIR_NAME}`;
      // shell.open 会在目录不存在时由系统资源管理器提示
      await shellApi.open(logsPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("error", t("about.openLogsFailed", { error: msg }), 5000);
    }
  }, [showToast, t]);

  // ===== 静态数据 =====
  // 核心特性列表（5 大模块）
  const features: FeatureItem[] = [
    {
      icon: BookOpen,
      titleKey: "about.feature.editor",
      descKey: "about.feature.editorDesc",
      iconColor: "text-fandex-primary",
    },
    {
      icon: Boxes,
      titleKey: "about.feature.codex",
      descKey: "about.feature.codexDesc",
      iconColor: "text-fandex-secondary",
    },
    {
      icon: Users,
      titleKey: "about.feature.characterGraph",
      descKey: "about.feature.characterGraphDesc",
      iconColor: "text-fandex-tertiary",
    },
    {
      icon: GitBranch,
      titleKey: "about.feature.timeline",
      descKey: "about.feature.timelineDesc",
      iconColor: "text-fandex-primary",
    },
    {
      icon: Eye,
      titleKey: "about.feature.foreshadowing",
      descKey: "about.feature.foreshadowingDesc",
      iconColor: "text-fandex-tertiary",
    },
  ];

  // 技术栈条目
  const techStack: TechStackItem[] = [
    { name: "Tauri", color: "text-[#FFC131]" },
    { name: "React", color: "text-[#61dafb]" },
    { name: "Rust", color: "text-[#dea584]" },
    { name: "TypeScript", color: "text-[#3178c6]" },
    { name: "TipTap", color: "text-fandex-primary" },
    { name: "React Flow", color: "text-fandex-secondary" },
    { name: "Tantivy", color: "text-fandex-tertiary" },
  ];

  // 三大原则
  const principles: FeatureItem[] = [
    {
      icon: Shield,
      titleKey: "about.principle.offline",
      descKey: "about.principle.offlineDesc",
      iconColor: "text-fandex-primary",
    },
    {
      icon: FolderOpen,
      titleKey: "about.principle.ownership",
      descKey: "about.principle.ownershipDesc",
      iconColor: "text-fandex-secondary",
    },
    {
      icon: Heart,
      titleKey: "about.principle.focus",
      descKey: "about.principle.focusDesc",
      iconColor: "text-fandex-tertiary",
    },
  ];

  // 致谢依赖列表
  const acknowledgments: AcknowledgmentItem[] = [
    {
      name: "Tauri",
      url: "https://tauri.app/",
      desc: "构建轻量级跨平台桌面应用的 Rust 框架",
    },
    {
      name: "React",
      url: "https://react.dev/",
      desc: "Meta 出品的声明式 UI 库",
    },
    {
      name: "TipTap",
      url: "https://tiptap.dev/",
      desc: "基于 ProseMirror 的可扩展富文本编辑器框架",
    },
    {
      name: "React Flow",
      url: "https://reactflow.dev/",
      desc: "可定制化的图谱/节点编辑器 React 库",
    },
    {
      name: "Tantivy",
      url: "https://github.com/quickwit-oss/tantivy",
      desc: "Rust 全文搜索引擎，本项目用于离线语义检索",
    },
    {
      name: "Zustand",
      url: "https://github.com/pmndrs/zustand",
      desc: "轻量级 React 状态管理库",
    },
    {
      name: "lucide-react",
      url: "https://lucide.dev/",
      desc: "统一的 SVG 图标库",
    },
    {
      name: "Tailwind CSS",
      url: "https://tailwindcss.com/",
      desc: "原子化 CSS 框架",
    },
  ];

  return (
    <>
      <section className="space-y-4">
        {/* ===== 顶部应用图标 + 名称 + slogan + 大字版本号 ===== */}
        <div className="bg-zinc-900/40 rounded-lg p-4 border border-nf-border-light">
          <div className="flex items-start gap-4">
            {/* Logo 区：Wand2 图标 + 蓝紫渐变背景 + 小点装饰 */}
            <div className="relative flex-shrink-0">
              <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-fandex-primary via-purple-500 to-fandex-tertiary flex items-center justify-center shadow-lg shadow-fandex-primary/20">
                <Wand2 className="w-8 h-8 text-white" strokeWidth={2} />
              </div>
              {/* 装饰小点 */}
              <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-fandex-secondary border border-nf-bg" />
              <div className="absolute -bottom-1 -left-1 w-2 h-2 rounded-full bg-fandex-tertiary border border-nf-bg" />
            </div>

            {/* 名称 + slogan */}
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold font-display text-nf-text">
                {t("about.title")}
              </h2>
              <p className="text-xs text-nf-text-tertiary mt-0.5">
                {t("about.slogan")}
              </p>

              {/* 大字版本号 + 操作按钮 */}
              <div className="flex items-center gap-3 mt-2">
                <span className="text-3xl font-bold text-fandex-primary font-mono leading-none">
                  v{currentVersion}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleCopyVersion}
                    title={t("about.copyVersion")}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] bg-nf-bg-hover hover:bg-fandex-primary/10 border border-nf-border-light hover:border-fandex-primary/40 text-nf-text-secondary hover:text-fandex-primary transition duration-fast"
                  >
                    <Copy className="w-3 h-3" />
                    {t("about.copyVersion")}
                  </button>
                  <button
                    onClick={handleOpenLogs}
                    title={t("about.openLogs")}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] bg-nf-bg-hover hover:bg-fandex-primary/10 border border-nf-border-light hover:border-fandex-primary/40 text-nf-text-secondary hover:text-fandex-primary transition duration-fast"
                  >
                    <FolderOpen className="w-3 h-3" />
                    {t("about.openLogs")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ===== 项目介绍区 ===== */}
        <div className="bg-zinc-900/40 rounded-lg p-4 border border-nf-border-light">
          <p className="text-xs leading-relaxed text-nf-text-secondary">
            {t("about.intro")}
          </p>

          {/* 三大原则 */}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {principles.map((p) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.titleKey}
                  className="p-2 bg-nf-bg/50 border border-nf-border-light rounded"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className={`w-3.5 h-3.5 ${p.iconColor}`} />
                    <span className="text-xs font-semibold text-nf-text">
                      {t(p.titleKey)}
                    </span>
                  </div>
                  <p className="text-[10px] text-nf-text-tertiary leading-snug">
                    {t(p.descKey)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* ===== 核心特性列表 ===== */}
        <div className="bg-zinc-900/40 rounded-lg p-4 border border-nf-border-light">
          <h3 className="text-sm font-bold font-display text-nf-text mb-3 flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-fandex-primary" />
            {t("about.features")}
          </h3>
          <ul className="space-y-1.5">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <li
                  key={f.titleKey}
                  className="flex items-start gap-2 p-1.5 hover:bg-nf-bg-hover/50 rounded transition duration-fast"
                >
                  <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${f.iconColor}`} />
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-nf-text">
                      {t(f.titleKey)}
                    </span>
                    <span className="text-[11px] text-nf-text-tertiary ml-1.5">
                      {t(f.descKey)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* ===== 技术栈展示 ===== */}
        <div className="bg-zinc-900/40 rounded-lg p-4 border border-nf-border-light">
          <h3 className="text-sm font-bold font-display text-nf-text mb-3 flex items-center gap-1.5">
            <Boxes className="w-3.5 h-3.5 text-fandex-secondary" />
            {t("about.techStack")}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {techStack.map((tech) => (
              <span
                key={tech.name}
                className="px-2 py-1 text-[11px] font-mono bg-nf-bg border border-nf-border-light rounded"
              >
                <span className={tech.color}>{tech.name}</span>
              </span>
            ))}
          </div>
        </div>

        {/* ===== 作者信息区 ===== */}
        <div className="bg-zinc-900/40 rounded-lg p-4 border border-nf-border-light">
          <h3 className="text-sm font-bold font-display text-nf-text mb-3 flex items-center gap-1.5">
            <Code className="w-3.5 h-3.5 text-nf-text-secondary" />
            {t("about.author")}
          </h3>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-fandex-primary to-fandex-tertiary flex items-center justify-center text-white text-xs font-bold">
              F
            </div>
            <span className="text-sm font-semibold text-nf-text">
              {t("about.authorName")}
            </span>
            <span className="text-[10px] text-nf-text-tertiary">
              {t("about.madeFor")}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
            <button
              onClick={() => openExternalUrl(GITHUB_REPO_URL)}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] bg-nf-bg-hover hover:bg-fandex-primary/10 border border-nf-border-light hover:border-fandex-primary/40 text-nf-text-secondary hover:text-fandex-primary transition duration-fast rounded"
            >
              <Code className="w-3 h-3" />
              {t("about.githubRepo")}
              <ExternalLink className="w-2.5 h-2.5 opacity-60" />
            </button>
            <button
              onClick={() => openExternalUrl(GITHUB_ISSUES_URL)}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] bg-nf-bg-hover hover:bg-fandex-primary/10 border border-nf-border-light hover:border-fandex-primary/40 text-nf-text-secondary hover:text-fandex-primary transition duration-fast rounded"
            >
              <Bug className="w-3 h-3" />
              {t("about.reportIssue")}
              <ExternalLink className="w-2.5 h-2.5 opacity-60" />
            </button>
            <button
              onClick={() => openExternalUrl(RELEASES_PAGE_URL)}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] bg-nf-bg-hover hover:bg-fandex-primary/10 border border-nf-border-light hover:border-fandex-primary/40 text-nf-text-secondary hover:text-fandex-primary transition duration-fast rounded"
            >
              <Tag className="w-3 h-3" />
              {t("about.viewReleases")}
              <ExternalLink className="w-2.5 h-2.5 opacity-60" />
            </button>
          </div>
        </div>

        {/* ===== 更新检查区（保留原有功能） ===== */}
        <div className="bg-zinc-900/40 rounded-lg p-4 border border-nf-border-light">
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
        </div>

        {/* ===== 致谢区（折叠） ===== */}
        <details className="bg-zinc-900/40 rounded-lg p-4 border border-nf-border-light">
          <summary className="cursor-pointer flex items-center gap-2 text-sm font-bold font-display text-nf-text select-none">
            <Heart className="w-3.5 h-3.5 text-fandex-tertiary" />
            {t("about.acknowledgments")}
            <span className="text-[10px] text-nf-text-tertiary font-normal ml-auto">
              {t("about.acknowledgmentsDesc")}
            </span>
          </summary>
          <ul className="mt-3 space-y-1.5">
            {acknowledgments.map((item) => (
              <li
                key={item.name}
                className="flex items-start gap-2 p-1.5 hover:bg-nf-bg-hover/50 rounded transition duration-fast"
              >
                <button
                  onClick={() => openExternalUrl(item.url)}
                  className="text-xs font-semibold text-fandex-primary hover:text-fandex-primary-hover flex items-center gap-1"
                >
                  {item.name}
                  <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                </button>
                <span className="text-[11px] text-nf-text-tertiary">
                  {item.desc}
                </span>
              </li>
            ))}
          </ul>
        </details>

        {/* ===== 开源协议区 ===== */}
        <div className="bg-zinc-900/40 rounded-lg p-4 border border-nf-border-light">
          <div className="flex items-start gap-3">
            <FileText className="w-4 h-4 text-fandex-secondary mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold font-display text-nf-text mb-1">
                {t("about.license")}
              </h3>
              <p className="text-[11px] text-nf-text-tertiary leading-relaxed mb-2">
                {t("about.licenseDesc")}
              </p>
              <button
                onClick={() => openExternalUrl(GITHUB_LICENSE_URL)}
                className="flex items-center gap-1.5 text-[11px] text-fandex-primary hover:text-fandex-primary-hover transition duration-fast"
              >
                <ExternalLink className="w-3 h-3" />
                {t("about.licenseLink")}
              </button>
            </div>
          </div>
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
