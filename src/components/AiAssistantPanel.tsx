// AI 辅助创作中心面板组件（接口预留，不实装）
//
// 功能概述：
// NovelForge 的 AI 辅助创作中心入口，展示未来规划的 6 项 AI 功能。
// 当前版本仅提供界面骨架，所有功能点击时提示"尚未实装"。
// 后续接入实际 AI 服务时，只需替换后端命令实现，前端面板无需重构。
//
// 模块职责：
// 1. 渲染 AI 功能卡片网格（6 项功能）
// 2. 点击功能时显示"尚未实装"提示
// 3. 提供 AI 配置入口（配置保存同样未实装）
// 4. 展示功能规划路线图

import { useState } from "react";
import {
  X,
  PenLine,
  FileText,
  Sparkles,
  ListTree,
  Users,
  ShieldCheck,
  Settings,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import { AI_FEATURES } from "../lib/aiApi";

// 功能图标映射
const FEATURE_ICONS: Record<string, LucideIcon> = {
  PenLine,
  FileText,
  Sparkles,
  ListTree,
  Users,
  ShieldCheck,
};

interface AiAssistantPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * AI 辅助创作中心面板
 * 输入:
 *   open 面板是否打开
 *   onClose 关闭回调
 * 输出: JSX 对话框面板
 * 流程:
 *   1. 渲染功能卡片网格
 *   2. 点击功能卡片时显示"尚未实装"提示
 *   3. 底部显示配置入口与路线图说明
 */
export default function AiAssistantPanel({ open, onClose }: AiAssistantPanelProps) {
  const { showToast } = useToast();
  const { t } = useI18n();
  const [showConfig, setShowConfig] = useState(false);

  if (!open) return null;

  // 点击功能卡片：显示未实装提示
  const handleFeatureClick = () => {
    showToast("info", t("ai.notImplemented"));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[640px] max-w-[90vw] max-h-[80vh] bg-nf-bg-panel border border-nf-border-light rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-nf-border-light">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-fandex-primary" />
            <h2 className="text-base font-semibold text-nf-text">{t("ai.title")}</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-fandex-tertiary/10 text-fandex-tertiary font-medium">
              {t("ai.comingSoon")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowConfig((v) => !v)}
              title={t("ai.config")}
              className="text-nf-text-tertiary hover:text-fandex-primary transition-colors p-1"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              title={t("common.close")}
              className="text-nf-text-tertiary hover:text-nf-text transition-colors p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 配置区域（折叠） */}
        {showConfig && (
          <div className="px-5 py-3 border-b border-nf-border-light bg-nf-bg-sidebar">
            <div className="text-xs text-nf-text-tertiary mb-2">{t("ai.configHint")}</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder={t("ai.providerPlaceholder")}
                disabled
                className="px-2 py-1.5 text-xs bg-nf-bg-input border border-nf-border-light rounded text-nf-text-tertiary cursor-not-allowed"
              />
              <input
                type="text"
                placeholder={t("ai.modelPlaceholder")}
                disabled
                className="px-2 py-1.5 text-xs bg-nf-bg-input border border-nf-border-light rounded text-nf-text-tertiary cursor-not-allowed"
              />
            </div>
          </div>
        )}

        {/* 功能卡片网格 */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3">
            {AI_FEATURES.map((feature) => {
              const Icon = FEATURE_ICONS[feature.icon] || Sparkles;
              return (
                <button
                  key={feature.id}
                  onClick={() => handleFeatureClick()}
                  className="text-left p-4 rounded-lg border border-nf-border-light bg-nf-bg-sidebar hover:border-fandex-primary/40 hover:bg-nf-bg-hover transition-all duration-150 group relative overflow-hidden"
                >
                  {/* 顶部装饰条 */}
                  <div className="absolute top-0 left-0 right-0 h-[2px] opacity-50 group-hover:opacity-100 transition-opacity" style={{
                    background: 'linear-gradient(90deg, var(--fandex-primary), var(--fandex-secondary))',
                  }} />
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-fandex-primary/10 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-fandex-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-nf-text mb-1">{feature.label}</div>
                      <div className="text-xs text-nf-text-tertiary leading-relaxed line-clamp-2">
                        {feature.description}
                      </div>
                    </div>
                  </div>
                  {/* 角标：即将推出 */}
                  <div className="absolute top-2 right-2 flex items-center gap-1 text-[10px] text-fandex-tertiary">
                    <Clock className="w-2.5 h-2.5" />
                    <span>{t("ai.soon")}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* 路线图说明 */}
          <div className="mt-5 p-3 rounded-lg bg-fandex-primary/5 border border-fandex-primary/20">
            <div className="text-xs text-nf-text-secondary leading-relaxed">
              {t("ai.roadmapHint")}
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div className="px-5 py-3 border-t border-nf-border-light flex items-center justify-between">
          <span className="text-[10px] text-nf-text-tertiary">{t("ai.footerHint")}</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-nf-text-secondary hover:text-nf-text border border-nf-border-light rounded transition-colors"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
