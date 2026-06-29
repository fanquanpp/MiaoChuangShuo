// 写作专注模式计时器
//
// 功能概述：
// 提供可定制的专注写作计时器，支持倒计时与正计时模式，
// 可设置目标时长（默认 25 分钟番茄钟）。
// 计时期间自动隐藏侧边栏和文件列表。
//
// 模块职责：
// 1. 计时器逻辑（开始/暂停/重置）
// 2. 目标时长设置
// 3. 完成通知

import { useState, useEffect, useRef, useCallback } from "react";
import { Timer, Play, Pause, RotateCcw, X, ChevronDown } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";

const PRESET_DURATIONS = [15, 25, 40, 60, 90];
const TICK_MS = 1000;

export function FocusTimer({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [targetMinutes, setTargetMinutes] = useState(25);
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showPresets, setShowPresets] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const total = targetMinutes * 60;
  const progress = total > 0 ? ((total - remainingSeconds) / total) * 100 : 0;

  const startTimeRef = useRef<number>(0);

  const startTimer = useCallback(() => {
    const remaining = remainingSeconds;
    startTimeRef.current = Date.now() - (total - remaining) * 1000;
    setRunning(true);
    intervalRef.current = setInterval(() => {
      const elapsedMs = Date.now() - startTimeRef.current;
      const elapsedSec = Math.floor(elapsedMs / 1000);
      const remainingSec = Math.max(0, total - elapsedSec);
      setRemainingSeconds(remainingSec);
      setElapsed(elapsedSec);
      if (remainingSec <= 0) {
        setRunning(false);
        if (intervalRef.current) clearInterval(intervalRef.current);
        showToast("success", t("timer.completed"));
      }
    }, TICK_MS);
  }, [total, remainingSeconds]);

  const pauseTimer = useCallback(() => {
    setRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  const resetTimer = useCallback(() => {
    pauseTimer();
    setRemainingSeconds(targetMinutes * 60);
    setElapsed(0);
  }, [pauseTimer, targetMinutes]);

  const setDuration = useCallback(
    (min: number) => {
      setTargetMinutes(min);
      setRemainingSeconds(min * 60);
      setElapsed(0);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const remainingPct = total > 0 ? (remainingSeconds / total) * 100 : 0;

  return (
    <div className="fandex-nav-blur flex items-center gap-3 px-4 py-1.5 border-b border-nf-border-light text-xs">
      <Timer className="w-3.5 h-3.5 text-fandex-tertiary" />
      <span className="font-mono font-medium text-nf-text tabular-nums">
        {formatTime(remainingSeconds)}
      </span>
      <div className="flex-1 h-1.5 bg-nf-bg-hover overflow-hidden max-w-[120px]">
        <div
          className={`h-full transition-all duration-200 ease-linear ${
            remainingSeconds <= 60 ? "bg-red-400" : "bg-fandex-primary"
          }`}
          style={{ width: `${remainingPct}%` }}
        />
      </div>
      <button
        onClick={running ? pauseTimer : startTimer}
        className="text-nf-text-tertiary hover:text-fandex-primary transition duration-fast"
        title={running ? t("timer.pause") : t("timer.start")}
      >
        {running ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
      </button>
      <button
        onClick={resetTimer}
        className="text-nf-text-tertiary hover:text-nf-text transition duration-fast"
        title={t("timer.reset")}
      >
        <RotateCcw className="w-3 h-3" />
      </button>

      <div className="relative">
        <button
          onClick={() => setShowPresets((v) => !v)}
          className="flex items-center gap-0.5 text-nf-text-tertiary hover:text-nf-text transition duration-fast"
          title={t("timer.setDuration")}
        >
          <span className="font-mono">{targetMinutes}m</span>
          <ChevronDown className="w-3 h-3" />
        </button>
        {showPresets && (
          <div className="absolute bottom-full right-0 mb-1 bg-nf-bg-card border border-nf-border-light shadow-lg py-1 z-10">
            {PRESET_DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => {
                  setDuration(d);
                  setShowPresets(false);
                }}
                className={`block w-full text-left px-3 py-1 hover:bg-nf-bg-hover transition duration-fast font-mono ${
                  d === targetMinutes
                    ? "text-fandex-primary"
                    : "text-nf-text-secondary"
                }`}
              >
                {t("timer.minutes", { d })}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onClose}
        className="text-nf-text-tertiary hover:text-nf-text transition duration-fast ml-1"
        title={t("timer.close")}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
