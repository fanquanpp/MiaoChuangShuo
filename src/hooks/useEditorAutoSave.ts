// 编辑器自动保存 Hook
//
// 功能概述：
// 抽取 NovelEditor 的自动保存定时器逻辑，基于用户设置的间隔触发保存。
// 所有 setTimeout 引用保存到 ref，组件卸载时通过 clearTimeout 清理，
// 满足 Task 35.1 的定时器清理要求（原 NovelEditor.tsx line 1097）。
//
// 模块职责：
// 1. 监听 filePath/dirty/autoSaveInterval 变化触发自动保存
// 2. 通过 savingRef 判断当前是否正在保存，避免并发
// 3. 保存 timer 引用到 ref，卸载时清理
//
// 设计原则：
// - 仅负责"何时触发保存"，"如何保存"由 useEditorFileIO 的 handleSave 负责
// - autoSaveInterval=0 表示禁用自动保存
// - dirty=false 时不启动定时器（无修改无需保存）

import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

/** useEditorAutoSave 输入参数 */
export interface UseEditorAutoSaveParams {
  /** 当前文件路径（null 时禁用自动保存） */
  filePath: string | null;
  /** 是否有未保存修改 */
  dirty: boolean;
  /** 自动保存间隔（秒，0 表示禁用） */
  autoSaveInterval: number;
  /** 保存函数（来自 useEditorFileIO） */
  handleSave: () => Promise<boolean>;
  /** 保存中状态 ref（来自 useEditorFileIO，用于判断竞态） */
  savingRef: MutableRefObject<boolean>;
}

/**
 * 编辑器自动保存 Hook
 * 输入: UseEditorAutoSaveParams（filePath/dirty/autoSaveInterval/handleSave/savingRef）
 * 输出: 无（纯副作用 Hook）
 * 核心流程:
 *   1. filePath 为空 / dirty 为 false / autoSaveInterval 为 0 时不启动定时器
 *   2. 启动定时器：autoSaveInterval 秒后检查 savingRef，若未在保存则调用 handleSave
 *   3. 依赖变化时清理旧定时器并启动新定时器
 *   4. 卸载时清理定时器（Task 35.1）
 * 定时器清理（Task 35.1）:
 *   - autoSaveTimerRef 保存自动保存 timer 引用（原 NovelEditor.tsx line 1097）
 *   - effect cleanup 与组件卸载时均执行 clearTimeout
 */
export function useEditorAutoSave(params: UseEditorAutoSaveParams): void {
  const { filePath, dirty, autoSaveInterval, handleSave, savingRef } = params;

  // 自动保存定时器引用（Task 35.1：保存引用到 ref）
  const autoSaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // 前置条件检查：无文件 / 无修改 / 禁用自动保存时不启动定时器
    if (!filePath || !dirty || autoSaveInterval === 0) return;
    // Task 35.1：保存 timer 引用到 ref，effect cleanup 时清理
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      // 竞态保护：正在保存时跳过，等当前保存完成后的 dirty 状态会重新触发
      if (!savingRef.current) {
        handleSave();
      }
    }, autoSaveInterval * 1000);
    return () => {
      // effect cleanup：依赖变化时清理旧定时器
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [filePath, dirty, handleSave, autoSaveInterval, savingRef]);

  // 组件卸载时清理定时器（Task 35.1）
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, []);
}
