// 设置对话框外壳组件
//
// 功能概述：
// 设置对话框的容器与分区导航外壳，采用左侧导航 + 右侧内容布局。
// 实际设置项由 4 个子分区组件承载：GeneralSettingsSection、
// AiSettingsSection、AppearanceSettingsSection、AboutSettingsSection。
//
// 模块职责：
// 1. 渲染模态框容器（遮罩、头部、底部）
// 2. 提供左侧分区导航（常规/AI/外观/关于）
// 3. 根据 activeTab 渲染对应的子分区组件
// 4. 将 initialSection 属性映射到对应分区并切换
//
// 设计说明：
// - 外壳不承载任何业务逻辑，仅负责布局与导航
// - 子分区组件各自管理状态与副作用，通过条件渲染按需挂载
// - SettingsSection 类型保持导出以确保向后兼容

import { useState, useEffect, useCallback } from "react";
import { X, Settings, Sparkles, Palette, Info } from "lucide-react";
import { useI18n } from "../lib/i18n";
import GeneralSettingsSection from "./settings/GeneralSettingsSection";
import AiSettingsSection from "./settings/AiSettingsSection";
import AppearanceSettingsSection from "./settings/AppearanceSettingsSection";
import AboutSettingsSection from "./settings/AboutSettingsSection";

// 设置分区类型：用于 initialSection 属性指定打开时定位的分区
// 保持原有类型定义以确保向后兼容（Launcher.tsx / Workspace.tsx 依赖此类型）
export type SettingsSection =
  | "editor"
  | "chapter"
  | "automation"
  | "indent"
  | "features"
  | "appearance"
  | "ai"
  | "index"
  | "about";

// 内部分区导航标签类型
type SettingsTab = "general" | "ai" | "appearance" | "about";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** 打开时自动定位到的分区，未指定时默认显示常规分区 */
  initialSection?: SettingsSection;
}

/**
 * 将外部 SettingsSection 映射到内部分区标签
 * 输入: section 外部分区标识（editor/chapter/automation 等细粒度分区）
 * 输出: 对应的内部分区标签（general/ai/appearance/about）
 * 流程: 按预设映射表转换，editor/chapter/automation/indent/features/index 统一归入 general
 */
function mapSectionToTab(section?: SettingsSection): SettingsTab {
  switch (section) {
    case "ai":
      return "ai";
    case "appearance":
      return "appearance";
    case "about":
      return "about";
    default:
      return "general";
  }
}

/**
 * 设置对话框外壳组件
 * 输入:
 *   - open: 对话框显示状态
 *   - onClose: 关闭回调
 *   - initialSection: 打开时自动定位到的分区（可选）
 * 输出: JSX 模态框（open=false 时返回 null）
 * 流程:
 *   1. 根据 initialSection 确定初始分区标签
 *   2. 渲染模态框容器（遮罩 + 面板）
 *   3. 左侧渲染分区导航，右侧渲染当前选中分区的内容
 *   4. 点击遮罩或关闭按钮触发 onClose
 */
export default function SettingsDialog({ open, onClose, initialSection }: SettingsDialogProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => mapSectionToTab(initialSection));

  // initialSection 变化时切换到对应分区
  useEffect(() => {
    if (open) {
      setActiveTab(mapSectionToTab(initialSection));
    }
  }, [open, initialSection]);

  /**
   * 遮罩点击关闭
   * 流程: 仅当点击目标为遮罩本身（非子元素）时触发关闭
   */
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  if (!open) return null;

  // 分区导航配置：标签文案 + 图标
  const tabs: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
    { id: "general", label: t("settings.generalSection"), icon: Settings },
    { id: "ai", label: t("settings.ai.section"), icon: Sparkles },
    { id: "appearance", label: t("settings.appearanceSection"), icon: Palette },
    { id: "about", label: t("settings.aboutSection"), icon: Info },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={handleOverlayClick}
    >
      <div className="nf-glass-panel w-[680px] h-[1204px] max-w-[95vw] max-h-[95vh] bg-nf-bg-card border border-nf-border-light shadow-2xl flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light flex-shrink-0">
          <h2 className="fandex-bar-left text-base font-bold font-display text-nf-text">
            {t("settings.title")}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
            title={t("app.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区：左侧导航 + 右侧内容 */}
        <div className="flex-1 min-h-0 flex">
          {/* 左侧分区导航 */}
          <nav className="w-32 border-r border-nf-border-light flex-shrink-0 py-4 space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition duration-fast ${
                    isActive
                      ? "bg-fandex-primary/10 text-fandex-primary border-l-2 border-fandex-primary"
                      : "text-nf-text-tertiary hover:text-nf-text-secondary hover:bg-nf-bg-hover border-l-2 border-transparent"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* 右侧内容（条件渲染，仅挂载当前分区以避免不必要的副作用触发）
              注:min-h-0 必须保留。flex 列布局下子元素默认 min-height:auto,
              会导致内容过多时撑破 max-h-[85vh] 约束,把底部按钮推出视口。
              设置 min-h-0 后 overflow-y-auto 才能正确触发滚动。 */}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
            {activeTab === "general" && <GeneralSettingsSection />}
            {activeTab === "ai" && <AiSettingsSection />}
            {activeTab === "appearance" && <AppearanceSettingsSection />}
            {activeTab === "about" && <AboutSettingsSection />}
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end px-6 py-3 border-t border-nf-border-light flex-shrink-0">
          <button
            onClick={onClose}
            className="h-8 px-4 text-sm flex items-center justify-center gap-1.5 bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast"
          >
            {t("app.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
