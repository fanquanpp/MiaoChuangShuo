// 确认对话框组件
//
// 功能概述：
// 统一的确认/提示对话框，替代浏览器原生 confirm/prompt。
// 支持 confirm 模式和 prompt 模式（带文本输入）。
// 采用 FANDEX 直角美学，键盘无障碍支持。

import { useState, useRef, useEffect, useCallback } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useI18n } from "../lib/i18n";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  type?: "confirm" | "prompt" | "danger";
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value?: string) => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  type = "confirm",
  placeholder,
  defaultValue = "",
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const [inputValue, setInputValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setInputValue(defaultValue);
      // 聚焦输入框或确认按钮
      setTimeout(() => {
        if (type === "prompt") {
          inputRef.current?.focus();
        }
      }, 50);
    }
  }, [open, defaultValue, type]);

  const handleConfirm = useCallback(() => {
    onConfirm(type === "prompt" ? inputValue : undefined);
  }, [onConfirm, type, inputValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (type === "prompt" && !inputValue.trim()) return;
        handleConfirm();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [handleConfirm, onCancel, type, inputValue]
  );

  if (!open) return null;

  const isDanger = type === "danger";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-sm bg-nf-bg-card border border-nf-border-light shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-nf-border-light">
          <div className="flex items-center gap-2">
            {isDanger && (
              <AlertTriangle className="w-4 h-4 text-red-400" />
            )}
            <h3 id="confirm-dialog-title" className="text-sm font-semibold font-display text-nf-text">
              {title}
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-nf-bg-hover text-nf-text-tertiary transition duration-fast"
            aria-label={t("app.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-sm text-nf-text-secondary">{message}</p>

          {type === "prompt" && (
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={placeholder}
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 mt-3 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
            />
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-nf-border-light">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
          >
            {cancelLabel || t("app.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={type === "prompt" && !inputValue.trim()}
            className={`px-3 py-1.5 text-sm font-medium text-nf-text-inverse transition duration-fast disabled:opacity-50 disabled:cursor-not-allowed ${
              isDanger
                ? "bg-red-500 hover:bg-red-600"
                : "bg-fandex-primary hover:bg-fandex-primary-hover"
            }`}
          >
            {confirmLabel || t("app.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
