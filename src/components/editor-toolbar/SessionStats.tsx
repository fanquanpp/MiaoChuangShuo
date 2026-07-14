// 写作会话统计组件
//
// 功能概述：
// 显示本次会话的净增字数、时长、WPM 与目标进度条。
// 提供暂停/恢复、目标设定、会话重置交互，目标设定与重置均通过自定义对话框确认。
//
// 模块职责：
// 仅负责会话统计的展示与交互，统计数据与回调通过 props 注入，不持有数据源。

import { useState } from "react";
import { Play, Pause, Target, RotateCcw } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import ConfirmDialog from "../ConfirmDialog";

// 会话统计属性
interface SessionStatsProps {
  /** 本次会话净增字数 */
  sessionWords: number;
  /** 会话时长（秒） */
  sessionDuration: number;
  /** 每分钟字数 */
  wpm: number;
  /** 字数目标（0=未设定） */
  wordTarget: number;
  /** 目标完成进度（0-1） */
  progress: number;
  /** 是否暂停 */
  paused: boolean;
  /** 会话开始时间（ISO） */
  startedAt?: string;
  /** 暂停/恢复回调 */
  onTogglePause: () => void;
  /** 设定目标回调 */
  onSetTarget: (target: number) => void;
  /** 重置会话回调 */
  onResetSession?: () => void;
}

/**
 * 格式化时长为 mm:ss 或 hh:mm:ss
 *
 * 输入参数:
 *   - seconds: 秒数
 * 返回值: 格式化后的时间字符串
 * 核心流程:
 *   超过 1 小时使用 hh:mm:ss，否则使用 mm:ss，各段左侧补零
 */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/**
 * 写作会话统计小组件
 *
 * 输入参数:
 *   - sessionWords: 净增字数（正数绿色，负数红色，零灰色）
 *   - sessionDuration: 会话时长（秒）
 *   - wpm: 每分钟字数
 *   - wordTarget: 字数目标（0 表示未设定）
 *   - progress: 目标完成进度（0-1）
 *   - paused: 是否暂停
 *   - startedAt: 会话开始 ISO 时间
 *   - onTogglePause: 暂停/恢复回调
 *   - onSetTarget: 设定目标回调
 *   - onResetSession: 重置会话回调
 * 返回值: JSX 会话统计组件
 * 核心流程:
 *   1. 渲染暂停/恢复按钮、净增字数、时长、WPM
 *   2. 渲染目标进度条，点击弹出目标设定对话框
 *   3. 有目标或会话有数据时显示重置按钮，点击弹出确认对话框
 */
export function SessionStats({
  sessionWords,
  sessionDuration,
  wpm,
  wordTarget,
  progress,
  paused,
  startedAt,
  onTogglePause,
  onSetTarget,
  onResetSession,
}: SessionStatsProps) {
  const { t } = useI18n();
  // 目标设定对话框开关
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  // 重置会话确认对话框状态
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  // 目标输入框值（字符串，便于受控输入）
  const [inputTarget, setInputTarget] = useState<string>(
    String(wordTarget || ""),
  );

  // 净增字数着色：正数绿色，负数红色，零灰色
  const wordsColor =
    sessionWords > 0
      ? "text-fandex-secondary"
      : sessionWords < 0
        ? "text-fandex-tertiary"
        : "text-nf-text-tertiary";

  // 打开目标对话框时同步当前目标值
  const handleOpenDialog = () => {
    setInputTarget(String(wordTarget || ""));
    setTargetDialogOpen(true);
  };

  // 确认设定目标：解析输入为非负整数后回调
  const handleConfirmTarget = () => {
    const n = parseInt(inputTarget, 10);
    if (!isNaN(n) && n >= 0) {
      onSetTarget(n);
    }
    setTargetDialogOpen(false);
  };

  // 清除目标：设置目标为 0
  const handleClearTarget = () => {
    onSetTarget(0);
    setTargetDialogOpen(false);
  };

  // 常用目标快捷设定项
  const quickTargets = [500, 1000, 2000, 5000];

  return (
    <div className="flex items-center gap-2 text-xs">
      {/* 暂停/恢复按钮 */}
      <button
        type="button"
        onClick={onTogglePause}
        onMouseDown={(e) => e.preventDefault()}
        title={paused ? t("editor.sessionResume") : t("editor.sessionPause")}
        tabIndex={-1}
        className={`nf-tool-btn h-8 w-8 flex items-center justify-center transition-colors duration-fast ease-fandex border ${
          paused
            ? "bg-fandex-tertiary/10 text-fandex-tertiary border-fandex-tertiary/40"
            : "text-nf-text-tertiary hover:text-nf-text border-transparent"
        }`}
      >
        {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
      </button>
      {/* 会话字数 */}
      <span className={`tabular-nums font-medium ${wordsColor}`}>
        {sessionWords > 0 ? "+" : ""}
        {sessionWords}
      </span>
      {/* 会话时长 */}
      <span className="tabular-nums text-nf-text-tertiary">
        {formatDuration(sessionDuration)}
      </span>
      {/* WPM */}
      {wpm > 0 && (
        <span className="tabular-nums text-nf-text-tertiary">
          {wpm}{" "}
          <span className="text-nf-text-tertiary/60">
            {t("editor.wordsPerMinuteUnit")}
          </span>
        </span>
      )}
      {/* 目标进度条（点击可设定/修改目标） */}
      <button
        type="button"
        onClick={handleOpenDialog}
        onMouseDown={(e) => e.preventDefault()}
        title={t("editor.setTarget")}
        tabIndex={-1}
        className={`nf-tool-btn flex items-center gap-1.5 h-8 px-2 transition-colors duration-fast ease-fandex border ${
          wordTarget > 0
            ? "bg-fandex-primary/10 border-fandex-primary/30"
            : "border-transparent hover:bg-nf-bg-card/40"
        }`}
      >
        <Target
          className={`w-4 h-4 ${wordTarget > 0 ? "text-fandex-primary" : "text-nf-text-tertiary"}`}
        />
        {wordTarget > 0 ? (
          <>
            <div className="w-16 h-1.5 bg-nf-bg-hover border border-nf-border-light/40 overflow-hidden">
              <div
                className="h-full bg-fandex-primary transition-all duration-base ease-fandex"
                style={{ width: `${Math.min(100, progress * 100)}%` }}
              />
            </div>
            <span className="tabular-nums text-nf-text-tertiary text-[10px]">
              {Math.round(progress * 100)}%
            </span>
          </>
        ) : (
          <span className="text-[10px] text-nf-text-tertiary">
            {t("editor.setTarget")}
          </span>
        )}
      </button>
      {/* 重置会话按钮（仅当有目标或会话有数据时显示） */}
      {onResetSession && (wordTarget > 0 || sessionWords !== 0) && (
        <button
          type="button"
          onClick={() => setResetConfirmOpen(true)}
          onMouseDown={(e) => e.preventDefault()}
          title={t("editor.sessionReset")}
          tabIndex={-1}
          className="nf-tool-btn h-8 w-8 flex items-center justify-center text-nf-text-tertiary hover:text-fandex-tertiary transition-colors duration-fast"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      )}

      {/* 重置会话确认对话框:替代原生 window.confirm */}
      <ConfirmDialog
        open={resetConfirmOpen}
        title={t("editor.sessionReset")}
        message={t("editor.sessionResetConfirm")}
        type="confirm"
        confirmLabel={t("editor.sessionReset")}
        onConfirm={() => {
          setResetConfirmOpen(false);
          onResetSession?.();
        }}
        onCancel={() => setResetConfirmOpen(false)}
      />

      {/* 目标设定对话框 */}
      {targetDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
          onClick={() => setTargetDialogOpen(false)}
        >
          <div
            className="nf-glass-panel w-full max-w-sm bg-nf-bg-card border border-nf-border-light shadow-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-nf-border-light">
              <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text">
                {t("editor.targetDialogTitle")}
              </h3>
              <p className="text-xs text-nf-text-tertiary mt-1">
                {t("editor.targetDialogDesc")}
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              {/* 目标输入 */}
              <div>
                <label className="text-xs text-nf-text-secondary mb-1.5 block">
                  {t("editor.targetValue")}
                </label>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={inputTarget}
                  onChange={(e) => setInputTarget(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmTarget();
                    if (e.key === "Escape") setTargetDialogOpen(false);
                  }}
                  autoFocus
                  className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
                />
                <p className="text-[10px] text-nf-text-tertiary mt-1">
                  {t("editor.targetHint")}
                </p>
              </div>
              {/* 快捷目标按钮 */}
              <div className="flex flex-wrap gap-1.5">
                {quickTargets.map((n) => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => setInputTarget(String(n))}
                    tabIndex={-1}
                    className="px-2.5 py-1 text-xs text-nf-text-secondary bg-nf-bg border border-nf-border-light hover:border-fandex-primary/50 hover:text-fandex-primary transition duration-fast"
                  >
                    {n}
                  </button>
                ))}
              </div>
              {/* 会话信息（若有 startedAt） */}
              {startedAt && (
                <div className="text-[10px] text-nf-text-tertiary border-t border-nf-border-light pt-2">
                  {t("editor.sessionStarted")}:{" "}
                  {new Date(startedAt).toLocaleTimeString()}
                </div>
              )}
            </div>
            <div className="flex justify-between gap-2 px-5 py-3 border-t border-nf-border-light">
              <button
                type="button"
                onClick={handleClearTarget}
                tabIndex={-1}
                className="px-3 py-1.5 text-sm text-nf-text-tertiary hover:text-fandex-tertiary transition duration-fast"
              >
                {t("editor.targetClear")}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTargetDialogOpen(false)}
                  tabIndex={-1}
                  className="px-3 py-1.5 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
                >
                  {t("editor.targetCancel")}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmTarget}
                  tabIndex={-1}
                  className="px-3 py-1.5 text-sm font-medium text-nf-text-inverse bg-fandex-primary hover:bg-fandex-primary-hover transition duration-fast"
                >
                  {t("editor.targetConfirm")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SessionStats;
