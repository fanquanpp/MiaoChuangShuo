// 首次欢迎页组件
//
// 功能概述：
// 喵创说 的首次启动欢迎页，集中展示产品定位、核心功能、快速上手教程与
// 关键快捷键。首次启动自动弹出（localStorage 标记），后续可从主页"回顾"按钮
// 重新打开。采用 FANDEX 直角美学与三色品牌体系。
//
// 模块职责：
// 1. 首次启动延迟自动弹出，并在 localStorage 标记已展示
// 2. 渲染产品介绍、功能卡片、上手步骤、快捷键速览四区
// 3. 提供"开始创作"按钮关闭面板
// 4. 受控模式：父组件可通过 open/onClose 主动唤起（用于主页回顾按钮）

import { useEffect, useState } from "react";
import {
  X,
  BookOpen,
  Library,
  Eye,
  History,
  PenLine,
  Keyboard,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { useI18n } from "../lib/i18n";

const STORAGE_KEY = "novelforge-welcome-seen";

interface WelcomeDialogProps {
  /** 外部受控打开状态（主页回顾按钮使用） */
  open?: boolean;
  /** 关闭回调 */
  onClose?: () => void;
}

/**
 * 首次欢迎页组件
 * 输入: open 外部受控开关 / onClose 关闭回调
 * 输出: JSX 浮层欢迎页（未打开时返回 null）
 * 流程:
 *   1. 首次启动时延迟 800ms 自动弹出，并写入 localStorage 标记
 *   2. 外部 open 为 true 时强制打开（用于回顾）
 *   3. 点击遮罩、"开始创作"按钮或 Escape 关闭
 */
export default function WelcomeDialog({ open, onClose }: WelcomeDialogProps) {
  const { t } = useI18n();
  const [internalOpen, setInternalOpen] = useState(false);

  // 首次启动自动弹出
  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      const timer = setTimeout(() => {
        setInternalOpen(true);
        localStorage.setItem(STORAGE_KEY, "1");
      }, 800);
      return () => clearTimeout(timer);
    }
  }, []);

  // 受控状态合并：外部 open 优先
  const isOpen = open ?? internalOpen;

  const handleClose = () => {
    setInternalOpen(false);
    onClose?.();
  };

  // Escape 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  if (!isOpen) return null;

  // 功能卡片数据：图标 + 标题 + 简介
  const features = [
    { icon: BookOpen, color: "text-fandex-primary", title: t("welcome.featureEditorTitle"), desc: t("welcome.featureEditorDesc") },
    { icon: Library, color: "text-fandex-secondary", title: t("welcome.featureCodexTitle"), desc: t("welcome.featureCodexDesc") },
    { icon: Eye, color: "text-fandex-tertiary", title: t("welcome.featureFocusTitle"), desc: t("welcome.featureFocusDesc") },
    { icon: History, color: "text-fandex-primary", title: t("welcome.featureSnapshotTitle"), desc: t("welcome.featureSnapshotDesc") },
  ];

  // 快速上手步骤
  const steps = [
    t("welcome.step1"),
    t("welcome.step2"),
    t("welcome.step3"),
    t("welcome.step4"),
  ];

  // 核心快捷键速览
  const coreShortcuts = [
    { keys: "Ctrl + S", desc: t("shortcuts.save") },
    { keys: "Ctrl + K", desc: t("shortcuts.commandPalette") },
    { keys: "?", desc: t("shortcuts.togglePanel") },
    { keys: "F11", desc: t("shortcuts.focusMode") },
    { keys: "Alt + 1", desc: t("shortcuts.navManuscript") },
    { keys: "Ctrl + F", desc: t("shortcuts.findReplace") },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        className="w-full max-w-2xl bg-nf-bg-card border border-nf-border-light shadow-lg overflow-hidden max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：品牌标识 + 关闭按钮 */}
        <div className="relative px-7 py-5 border-b border-nf-border-light flex-shrink-0">
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{
            background: 'linear-gradient(90deg, var(--fandex-primary), var(--fandex-secondary), var(--fandex-tertiary))',
          }} />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-fandex-primary/10 rounded-md">
                <PenLine className="w-5 h-5 text-fandex-primary" />
              </div>
              <div>
                <h2 id="welcome-title" className="fandex-bar-left text-lg font-bold font-display text-nf-text">
                  {t("welcome.title")}
                </h2>
                <p className="text-xs text-nf-text-tertiary mt-0.5">{t("welcome.subtitle")}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 hover:bg-nf-bg-hover text-nf-text-tertiary hover:text-nf-text transition duration-fast"
              aria-label={t("app.close")}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 内容区：滚动 */}
        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-7">
          {/* 产品定位 */}
          <section>
            <div className="flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-fandex-secondary flex-shrink-0 mt-0.5" />
            <p className="text-sm text-nf-text-secondary leading-relaxed">
              {t("welcome.intro")}
            </p>
            </div>
          </section>

          {/* 核心功能卡片 */}
          <section>
            <h3 className="fandex-bar-left text-xs font-semibold font-display text-nf-text-secondary uppercase tracking-wider mb-3">
              {t("welcome.featuresTitle")}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {features.map((f) => {
                const Icon = f.icon;
                return (
                  <div
                    key={f.title}
                    className="p-3 border border-nf-border-light bg-nf-bg/40 hover:bg-nf-bg-hover/40 transition-colors duration-base"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <Icon className={`w-4 h-4 ${f.color}`} />
                      <span className="text-sm font-medium text-nf-text">{f.title}</span>
                    </div>
                    <p className="text-xs text-nf-text-tertiary leading-relaxed">{f.desc}</p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 快速上手 */}
          <section>
            <h3 className="fandex-bar-left text-xs font-semibold font-display text-nf-text-secondary uppercase tracking-wider mb-3">
              {t("welcome.stepsTitle")}
            </h3>
            <ol className="space-y-2">
              {steps.map((step, idx) => (
                <li key={idx} className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center bg-fandex-primary/10 text-fandex-primary text-[11px] font-bold font-display rounded">
                    {idx + 1}
                  </span>
                  <span className="text-sm text-nf-text-secondary leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* 核心快捷键速览 */}
          <section>
            <h3 className="fandex-bar-left text-xs font-semibold font-display text-nf-text-secondary uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Keyboard className="w-3.5 h-3.5" />
              {t("welcome.shortcutsTitle")}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {coreShortcuts.map((sc) => (
                <div
                  key={sc.keys + sc.desc}
                  className="flex items-center justify-between py-1.5 px-2 bg-nf-bg/40 border border-nf-border-light/60"
                >
                  <span className="text-xs text-nf-text-secondary">{sc.desc}</span>
                  <kbd className="px-1.5 py-0.5 bg-nf-bg-hover border border-nf-border-light text-[11px] font-mono text-nf-text-secondary">
                    {sc.keys}
                  </kbd>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-nf-text-tertiary mt-2.5">
              {t("welcome.shortcutsHint")}
            </p>
          </section>
        </div>

        {/* 底部：开始创作按钮 */}
        <div className="px-7 py-4 border-t border-nf-border-light flex items-center justify-between flex-shrink-0">
          <span className="text-[11px] text-nf-text-tertiary">
            {t("welcome.reopenHint")}
          </span>
          <button
            onClick={handleClose}
            className="nf-tool-btn flex items-center gap-1.5 px-5 py-2 bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse font-medium text-sm transition-all duration-base ease-fandex shadow-sm hover:shadow-md group"
          >
            {t("welcome.startButton")}
            <ArrowRight className="w-3.5 h-3.5 transition-transform duration-fast group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
