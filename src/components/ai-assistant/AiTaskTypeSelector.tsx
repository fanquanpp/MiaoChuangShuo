// AI 任务类型选择器组件 (辅助 SubTask 12.6)
//
// 功能概述:
//   抽取自 AiAssistantPanel 的任务类型切换栏, 集中渲染 Sprint 6 任务类型
//   下拉菜单. 支持 5 种任务类型切换, 切换时清空关联上下文 (角色 ID / 选中文本).
//
// 模块职责:
//   1. 渲染当前任务类型按钮与下拉箭头
//   2. 渲染下拉菜单项 (5 种任务类型)
//   3. 处理外部点击关闭菜单
//   4. 切换任务类型时通知父组件清理关联上下文
//
// 设计说明:
//   - 纯展示 + 交互组件, 状态由父组件管理 (受控)
//   - 任务类型清单内部常量化, 父组件通过 onTaskTypeChange 接收变化
//   - 外部点击关闭由内部 effect 完成

import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import type { AiTaskType } from "../../lib/promptBuilder";

/**
 * 任务类型清单 (固定顺序, 用于下拉菜单渲染)
 */
const TASK_TYPES: AiTaskType[] = [
  "continuation",
  "dialogue",
  "consistencyCheck",
  "plotReview",
  "outlineGeneration",
];

/**
 * AiTaskTypeSelector 组件属性
 */
interface AiTaskTypeSelectorProps {
  /** 当前任务类型 */
  taskType: AiTaskType;
  /** 任务类型变化回调 */
  onTaskTypeChange: (taskType: AiTaskType) => void;
  /** 是否正在流式生成 (流式时禁用切换) */
  isStreaming: boolean;
}

/**
 * AiTaskTypeSelector 任务类型选择器
 * 输入:
 *   taskType        - 当前任务类型
 *   onTaskTypeChange - 任务类型变化回调
 *   isStreaming      - 流式状态
 * 输出: JSX 任务类型切换栏
 * 流程:
 *   1. 渲染按钮显示当前任务类型
 *   2. 点击展开下拉菜单
 *   3. 选择任务类型后通知父组件并关闭菜单
 *   4. 外部点击自动关闭菜单
 */
export default function AiTaskTypeSelector({
  taskType,
  onTaskTypeChange,
  isStreaming,
}: AiTaskTypeSelectorProps) {
  const { t } = useI18n();
  // 任务菜单展开状态
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  // 任务菜单 ref (外部点击关闭)
  const taskMenuRef = useRef<HTMLDivElement>(null);

  // 外部点击关闭菜单
  useEffect(() => {
    if (!taskMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (taskMenuRef.current && !taskMenuRef.current.contains(e.target as Node)) {
        setTaskMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [taskMenuOpen]);

  return (
    <div className="px-4 py-2 border-b border-nf-border-light bg-nf-bg-hover/30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-nf-text-tertiary">
            {t("ai.panel.taskType")}:
          </span>
          <div className="relative" ref={taskMenuRef}>
            <button
              type="button"
              onClick={() => setTaskMenuOpen((v) => !v)}
              disabled={isStreaming}
              tabIndex={-1}
              className="flex items-center gap-1 h-6 px-2 text-[11px] text-nf-text-secondary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/40 bg-nf-bg transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="font-medium">{t(`ai.panel.task.${taskType}`)}</span>
              <ChevronDown
                className={`w-3 h-3 transition-transform duration-fast ${
                  taskMenuOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {taskMenuOpen && (
              <div className="absolute top-full left-0 mt-1 z-[102] min-w-[140px] bg-nf-bg-card border border-nf-border-light shadow-xl py-1">
                {TASK_TYPES.map((tt) => (
                  <button
                    key={tt}
                    type="button"
                    onClick={() => {
                      onTaskTypeChange(tt);
                      setTaskMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors duration-fast ${
                      tt === taskType
                        ? "text-fandex-primary bg-fandex-primary/10"
                        : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
                    }`}
                  >
                    {t(`ai.panel.task.${tt}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <span className="text-[10px] text-nf-text-tertiary italic">
          {t("ai.panel.taskHint")}
        </span>
      </div>
    </div>
  );
}
