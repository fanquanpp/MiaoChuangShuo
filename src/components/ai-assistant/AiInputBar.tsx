// AI 输入栏组件 (SubTask 12.2)
//
// 功能概述:
//   抽取自 AiAssistantPanel 的输入栏与操作按钮区域. 负责用户指令的输入、
//   发送、中断等交互. 支持快捷指令填充与流式状态下的禁用切换.
//
// 模块职责:
//   1. 渲染多行文本输入框 (textarea)
//   2. 渲染发送按钮 (空闲态) 与中断按钮 (流式态)
//   3. 处理 Enter 发送 / Shift+Enter 换行
//   4. 通过 props 与父组件通信 (受控输入)
//
// 设计说明:
//   - 受控组件, value/onChange 由父组件管理
//   - 流式状态由父组件传入, 期间禁用输入框
//   - Esc 键中断由父组件全局监听处理, 此处不重复绑定

import type { RefObject } from "react";
import { Send, Square } from "lucide-react";
import { useI18n } from "../../lib/i18n";

/**
 * AiInputBar 组件属性
 */
interface AiInputBarProps {
  /** 输入框文本值 (受控) */
  value: string;
  /** 输入框内容变化回调 */
  onChange: (value: string) => void;
  /** 发送指令回调 */
  onSend: () => void;
  /** 中断流式生成回调 (Esc 触发) */
  onCancel: () => void;
  /** 是否正在流式生成 */
  isStreaming: boolean;
  /** 输入框 ref (用于外部聚焦控制) */
  inputRef: RefObject<HTMLTextAreaElement>;
}

/**
 * AiInputBar 输入栏组件
 * 输入:
 *   value       - 输入框文本
 *   onChange    - 文本变化回调
 *   onSend      - 发送回调
 *   onCancel    - 中断回调
 *   isStreaming  - 流式状态
 *   inputRef    - 输入框 ref
 * 输出: JSX 输入栏底部区域
 * 流程:
 *   1. 渲染 textarea, 绑定 onChange/onKeyDown
 *   2. Enter 发送, Shift+Enter 换行
 *   3. 流式时渲染中断按钮, 否则渲染发送按钮
 */
export default function AiInputBar({
  value,
  onChange,
  onSend,
  onCancel,
  isStreaming,
  inputRef,
}: AiInputBarProps) {
  const { t } = useI18n();

  return (
    <footer className="border-t border-nf-border-light px-4 py-3 space-y-2">
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter 发送, Shift+Enter 换行
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={t("ai.panel.inputPlaceholder")}
        disabled={isStreaming}
        rows={3}
        className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder:text-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition-colors duration-fast resize-none disabled:opacity-60"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-nf-text-tertiary">
          {t("ai.panel.inputHint")}
        </span>
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-1 h-7 px-3 text-xs text-fandex-tertiary border border-fandex-tertiary/40 hover:bg-fandex-tertiary/10 transition-colors duration-fast"
            >
              <Square className="w-3 h-3" />
              {t("ai.panel.stop")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSend()}
              disabled={!value.trim()}
              className="flex items-center gap-1 h-7 px-3 text-xs text-nf-text-inverse bg-fandex-primary hover:bg-fandex-primary-hover transition-colors duration-fast disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-3 h-3" />
              {t("ai.panel.send")}
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}
