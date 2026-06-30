// 写作会话追踪 Hook
//
// 功能概述：
// 追踪单次写作会话的关键指标，包括：本次会话新增字数、会话时长、每分钟字数（WPM）、
// 字数目标与进度。为编辑器底部状态栏与专注计时器提供数据支撑。
//
// 模块职责：
// 1. 记录会话起始时间与起始字数
// 2. 实时计算会话时长与 WPM
// 3. 计算本次会话净增字数（当前字数 - 起始字数）
// 4. 支持字数目标设定与进度计算
// 5. 支持会话暂停/恢复（切换文件或失焦时暂停）
// 6. 会话数据持久化到 localStorage（支持跨重启恢复）
//
// 设计原则：
// - 使用 useRef 存储时间戳，避免频繁重渲染
// - 使用 setInterval 定时刷新时长显示（每秒）
// - 切换文件时自动结束当前会话并开始新会话
// - 失焦超过 5 分钟自动暂停会话

import { useState, useEffect, useRef, useCallback } from "react";

// 会话状态
export interface SessionStats {
  /** 本次会话净增字数（可为负，表示删除多于新增） */
  sessionWords: number;
  /** 会话累计活跃时长（秒，不含暂停时间） */
  sessionDuration: number;
  /** 每分钟字数 */
  wpm: number;
  /** 字数目标（0 表示未设定） */
  wordTarget: number;
  /** 目标完成进度（0-1） */
  progress: number;
  /** 是否已暂停 */
  paused: boolean;
  /** 会话开始时间（ISO 字符串） */
  startedAt: string;
}

// 会话数据持久化键
const SESSION_STORAGE_KEY = "novelforge-writing-session";

// 持久化的会话数据结构
interface PersistedSession {
  startedAt: string;
  startWordCount: number;
  accumulatedDuration: number;
  wordTarget: number;
  lastActiveAt: string;
}

/**
 * 从 localStorage 加载持久化会话
 * 输入: 无
 * 输出: PersistedSession | null
 * 流程: 读取并解析 JSON，校验字段完整性
 */
function loadPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!parsed.startedAt || typeof parsed.startWordCount !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 持久化会话数据到 localStorage
 * 输入: data 会话数据
 * 输出: 无
 */
function persistSession(data: PersistedSession): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage 写入失败（如配额满）时静默忽略
  }
}

/**
 * 清除持久化会话
 */
function clearPersistedSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // 忽略
  }
}

// 失焦超过此秒数自动暂停会话（5 分钟）
const AUTO_PAUSE_THRESHOLD = 5 * 60 * 1000;

/**
 * 写作会话追踪 Hook
 * 输入:
 *   currentWordCount 当前文件字数
 *   filePath 当前文件路径（变化时重置会话）
 * 输出: SessionStats 会话统计 + 控制函数
 * 流程:
 *   1. 文件切换或首次挂载时初始化会话（记录起始字数与时间）
 *   2. 每秒更新会话时长
 *   3. 字数变化时更新净增字数与 WPM
 *   4. 窗口失焦超过阈值时暂停会话
 *   5. 卸载时持久化当前会话
 */
export function useWritingSession(currentWordCount: number, filePath: string | null) {
  // 会话起始字数
  const startWordCountRef = useRef<number>(currentWordCount);
  // 会话开始时间戳
  const startedAtRef = useRef<string>(new Date().toISOString());
  // 累计活跃时长（秒）
  const accumulatedDurationRef = useRef<number>(0);
  // 本次活跃段开始时间戳
  const activeSegmentStartRef = useRef<number>(Date.now());
  // 是否暂停
  const [paused, setPaused] = useState<boolean>(false);
  // 用于触发重渲染的计时器
  const [tick, setTick] = useState<number>(0);
  // 字数目标
  const [wordTarget, setWordTarget] = useState<number>(0);

  // 文件切换时重置会话
  useEffect(() => {
    // 尝试恢复持久化会话（仅当文件路径匹配时）
    const persisted = loadPersistedSession();
    if (persisted) {
      // 校验会话是否过于陈旧（超过 24 小时则丢弃）
      const persistedTime = new Date(persisted.startedAt).getTime();
      const now = Date.now();
      if (now - persistedTime > 24 * 60 * 60 * 1000) {
        clearPersistedSession();
      } else {
        startedAtRef.current = persisted.startedAt;
        startWordCountRef.current = persisted.startWordCount;
        accumulatedDurationRef.current = persisted.accumulatedDuration;
        activeSegmentStartRef.current = Date.now();
        setWordTarget(persisted.wordTarget || 0);
        return;
      }
    }
    // 全新会话
    startWordCountRef.current = currentWordCount;
    startedAtRef.current = new Date().toISOString();
    accumulatedDurationRef.current = 0;
    activeSegmentStartRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // 每秒刷新时长显示
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [paused]);

  // 窗口失焦自动暂停
  useEffect(() => {
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    const handleBlur = () => {
      pauseTimer = setTimeout(() => {
        setPaused(true);
      }, AUTO_PAUSE_THRESHOLD);
    };
    const handleFocus = () => {
      if (pauseTimer) {
        clearTimeout(pauseTimer);
        pauseTimer = null;
      }
      if (paused) {
        setPaused(false);
        activeSegmentStartRef.current = Date.now();
      }
    };
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    return () => {
      if (pauseTimer) clearTimeout(pauseTimer);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
    };
  }, [paused]);

  // 卸载时持久化
  useEffect(() => {
    return () => {
      const duration = paused
        ? accumulatedDurationRef.current
        : accumulatedDurationRef.current + Math.floor((Date.now() - activeSegmentStartRef.current) / 1000);
      persistSession({
        startedAt: startedAtRef.current,
        startWordCount: startWordCountRef.current,
        accumulatedDuration: duration,
        wordTarget,
        lastActiveAt: new Date().toISOString(),
      });
    };
  }, [paused, wordTarget]);

  // 计算当前会话统计
  const sessionWords = currentWordCount - startWordCountRef.current;
  const currentSegmentDuration = paused
    ? 0
    : Math.floor((Date.now() - activeSegmentStartRef.current) / 1000);
  const sessionDuration = accumulatedDurationRef.current + currentSegmentDuration;
  // WPM = 净增字数 / 会话分钟数（至少 1 分钟避免除零）
  const wpm = sessionDuration > 0 ? Math.max(0, Math.round(sessionWords / (sessionDuration / 60 || 1))) : 0;
  const progress = wordTarget > 0 ? Math.min(1, Math.max(0, sessionWords / wordTarget)) : 0;

  // 暂停/恢复
  const togglePause = useCallback(() => {
    setPaused((prev) => {
      if (!prev) {
        // 即将暂停：累计当前段时长
        accumulatedDurationRef.current += Math.floor((Date.now() - activeSegmentStartRef.current) / 1000);
      } else {
        // 即将恢复：重置段开始时间
        activeSegmentStartRef.current = Date.now();
      }
      return !prev;
    });
  }, []);

  // 重置会话
  const resetSession = useCallback(() => {
    startWordCountRef.current = currentWordCount;
    startedAtRef.current = new Date().toISOString();
    accumulatedDurationRef.current = 0;
    activeSegmentStartRef.current = Date.now();
    setPaused(false);
    clearPersistedSession();
  }, [currentWordCount]);

  // 更新字数目标
  const updateWordTarget = useCallback((target: number) => {
    setWordTarget(Math.max(0, Math.floor(target)));
  }, []);

  // 标记 tick 被使用，避免 lint 报错
  void tick;

  return {
    sessionWords,
    sessionDuration,
    wpm,
    wordTarget,
    progress,
    paused,
    startedAt: startedAtRef.current,
    togglePause,
    resetSession,
    updateWordTarget,
  } satisfies SessionStats & {
    togglePause: () => void;
    resetSession: () => void;
    updateWordTarget: (target: number) => void;
  };
}
