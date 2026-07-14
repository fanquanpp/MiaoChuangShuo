// 角色悬停卡片组件
//
// 功能概述：
// 在正文中鼠标悬停在角色名上时，浮动显示该角色的摘要卡片。
// 卡片内容从角色设定文件自动提取（身份、性格、简介），
// 让作者无需切换到角色目录即可快速回忆角色设定。
//
// 模块职责：
// 1. 接收悬停位置（x, y）与角色名
// 2. 调用后端 API 获取角色摘要
// 3. 渲染浮动卡片，自动调整位置防止溢出屏幕
// 4. 加载中/未找到/正常 三种状态展示
// 5. 预留 AI 操作区（p5-26 占位，p6 阶段接入实际 AI 命令）
//
// 设计理念：
// 减少作者在正文与角色设定之间的切换操作，保持写作沉浸感
//
// AI-Ready 设计说明：
// characterId 字段来自 p5-25 实体高亮装饰的 data-entity-id 属性（UUID v4），
// 未来 AI 模块可通过此 ID 精确查询角色结构化数据（避免按名称模糊匹配）。
// AI 操作区按钮当前为占位 disabled 状态，p6 阶段接入 PromptBuilder 后启用。

import { useEffect, useState, useRef } from "react";
import { Loader2, UserCircle, AlertCircle, FileText, Sparkles, MessageSquare } from "lucide-react";
import { readCharacterSummary, type CharacterSummary } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { CharacterAiActionType } from "../hooks/useEditorAiCommands";

interface CharacterHoverCardProps {
  /** 是否显示 */
  open: boolean;
  /** 卡片锚点 X 坐标（屏幕坐标） */
  x: number;
  /** 卡片锚点 Y 坐标（屏幕坐标） */
  y: number;
  /** 角色名 */
  characterName: string;
  /** 项目根路径 */
  projectPath: string;
  /** 角色实体 UUID（来自 p5-25 实体高亮装饰的 data-entity-id）
   * AI-Ready：未来 AI 操作通过此 ID 精确查询结构化设定数据 */
  characterId?: string;
  /**
   * AI 操作回调（Sprint 3 任务 3.2 启用）
   * 输入:
   *   action - 操作类型（"summarize-state" | "generate-dialogue"）
   *   characterId - 角色实体 UUID（可能为 undefined，调用方需容错）
   *   characterName - 角色显示名
   * 流程: 由 NovelEditor 接收并组装指令，打开 AiAssistantPanel 自动发送
   */
  onAiAction?: (action: CharacterAiActionType, characterId: string | undefined, characterName: string) => void;
}

/**
 * 角色悬停卡片
 * 输入:
 *   - open: 显示状态
 *   - x, y: 锚点坐标
 *   - characterName: 角色名
 *   - projectPath: 项目路径
 *   - characterId: 角色实体 UUID（可选，用于 AI 操作）
 * 输出: JSX 浮动卡片（open=false 时返回 null）
 * 流程:
 *   1. open 切换为 true 时调用后端读取角色摘要
 *   2. 加载中显示 spinner
 *   3. 未找到设定文件显示提示
 *   4. 正常显示身份、性格、简介
 *   5. 渲染 AI 操作区占位按钮（p6 阶段启用）
 *   6. 自动调整位置防止溢出屏幕
 */
export default function CharacterHoverCard({
  open,
  x,
  y,
  characterName,
  projectPath,
  characterId,
  onAiAction,
}: CharacterHoverCardProps) {
  const { t } = useI18n();
  const [summary, setSummary] = useState<CharacterSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [adjustedPos, setAdjustedPos] = useState({ x, y });
  const cardRef = useRef<HTMLDivElement>(null);

  // 加载角色摘要
  useEffect(() => {
    if (!open || !characterName || !projectPath) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSummary(null);
    readCharacterSummary(projectPath, characterName)
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, characterName, projectPath]);

  // 调整位置防止溢出屏幕
  useEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    let adjustedX = x;
    let adjustedY = y;
    // 右溢出：向左偏移
    if (x + rect.width > window.innerWidth - 8) {
      adjustedX = window.innerWidth - rect.width - 8;
    }
    // 下溢出：向上方显示
    if (y + rect.height > window.innerHeight - 8) {
      adjustedY = y - rect.height - 8;
    }
    // 确保不超出左上边界
    adjustedX = Math.max(8, adjustedX);
    adjustedY = Math.max(8, adjustedY);
    setAdjustedPos({ x: adjustedX, y: adjustedY });
  }, [open, x, y, summary, loading]);

  if (!open) return null;

  return (
    <div
      ref={cardRef}
      className="nf-glass-panel fixed z-[200] w-72 max-w-[90vw] bg-nf-bg-card border border-nf-border-light shadow-2xl overflow-hidden"
      style={{ left: adjustedPos.x, top: adjustedPos.y }}
      role="tooltip"
    >
      {/* 头部：角色名 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-fandex-primary/10 border-b border-fandex-primary/20">
        <UserCircle className="w-4 h-4 text-fandex-primary flex-shrink-0" />
        <span className="text-sm font-bold font-display text-nf-text truncate">
          {characterName}
        </span>
      </div>

      {/* 内容区 */}
      <div className="px-3 py-2.5">
        {loading ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="w-3.5 h-3.5 text-fandex-primary animate-spin" />
            <span className="text-xs text-nf-text-tertiary">{t("characterHover.loading")}</span>
          </div>
        ) : !summary ? (
          <div className="flex items-center gap-2 py-2">
            <AlertCircle className="w-3.5 h-3.5 text-nf-text-tertiary" />
            <span className="text-xs text-nf-text-tertiary">{t("characterHover.loadFailed")}</span>
          </div>
        ) : !summary.found ? (
          <div className="flex items-center gap-2 py-2">
            <AlertCircle className="w-3.5 h-3.5 text-nf-text-tertiary" />
            <span className="text-xs text-nf-text-tertiary">
              {t("characterHover.notFound")}
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {/* 身份 */}
            {summary.identity && (
              <div className="flex items-start gap-1.5">
                <span className="text-[10px] text-nf-text-tertiary flex-shrink-0 mt-0.5 w-10">
                  {t("characterHover.identity")}
                </span>
                <span className="text-xs text-nf-text-secondary leading-relaxed">
                  {summary.identity}
                </span>
              </div>
            )}
            {/* 性格 */}
            {summary.personality && (
              <div className="flex items-start gap-1.5">
                <span className="text-[10px] text-nf-text-tertiary flex-shrink-0 mt-0.5 w-10">
                  {t("characterHover.personality")}
                </span>
                <span className="text-xs text-nf-text-secondary leading-relaxed">
                  {summary.personality}
                </span>
              </div>
            )}
            {/* 简介 */}
            {summary.brief && (
              <div className="flex items-start gap-1.5">
                <span className="text-[10px] text-nf-text-tertiary flex-shrink-0 mt-0.5 w-10">
                  {t("characterHover.brief")}
                </span>
                <span className="text-xs text-nf-text-secondary leading-relaxed">
                  {summary.brief}
                </span>
              </div>
            )}
            {/* 来源文件 */}
            {summary.source_file && (
              <div className="flex items-center gap-1 pt-1 border-t border-nf-border-light">
                <FileText className="w-2.5 h-2.5 text-nf-text-tertiary" />
                <span className="text-[10px] text-nf-text-tertiary truncate">
                  {summary.source_file}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI 操作区（Sprint 3 任务 3.2 启用）
       * 设计说明：
       *   - 按钮已接入 PromptBuilder + AiAssistantPanel（通过 onAiAction 回调）
       *   - 点击后由 NovelEditor 组装角色上下文指令并打开 AI 助手面板
       *   - characterId 用于精确查询结构化设定（undefined 时回退到按名称匹配）
       *   - 仅在成功加载角色摘要后显示（无角色档案时不显示 AI 入口） */}
      {summary && summary.found && (
        <div className="px-3 py-2 border-t border-nf-border-light bg-nf-bg/40">
          <div className="flex items-center gap-1 mb-1.5">
            <Sparkles className="w-2.5 h-2.5 text-fandex-tertiary" />
            <span className="text-[10px] font-medium text-nf-text-tertiary uppercase tracking-wider">
              {t("characterHover.aiSectionTitle")}
            </span>
          </div>
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => onAiAction?.("summarize-state", characterId, characterName)}
              title={t("characterHover.aiSummarizeState")}
              className="flex items-center gap-1.5 w-full px-2 py-1 text-left text-[11px] text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover rounded-sm transition-colors"
              data-character-id={characterId}
              data-ai-action="summarize-state"
            >
              <Sparkles className="w-2.5 h-2.5 flex-shrink-0" />
              <span className="truncate">{t("characterHover.aiSummarizeState")}</span>
            </button>
            <button
              type="button"
              onClick={() => onAiAction?.("generate-dialogue", characterId, characterName)}
              title={t("characterHover.aiGenerateDialogue")}
              className="flex items-center gap-1.5 w-full px-2 py-1 text-left text-[11px] text-nf-text-secondary hover:text-fandex-primary hover:bg-nf-bg-hover rounded-sm transition-colors"
              data-character-id={characterId}
              data-ai-action="generate-dialogue"
            >
              <MessageSquare className="w-2.5 h-2.5 flex-shrink-0" />
              <span className="truncate">{t("characterHover.aiGenerateDialogue")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
