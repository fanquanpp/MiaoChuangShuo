// Toast 通知系统
//
// 功能概述：
// 提供统一的全局 Toast 通知，支持成功、错误、警告、信息四种类型。
// 自动堆叠多条消息，支持手动关闭和自动消失。
//
// 模块职责：
// 1. ToastProvider: 全局 Toast 容器
// 2. useToast: 触发 Toast 的 Hook
// 3. Toast 组件: 单条 Toast 渲染

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react";

export type ToastType = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastContextValue {
  showToast: (type: ToastType, message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

let nextId = 0;

const ICON_MAP: Record<ToastType, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLOR_MAP: Record<ToastType, string> = {
  success: "border-fandex-secondary text-fandex-secondary",
  error: "border-red-400 text-red-400",
  warning: "border-fandex-tertiary text-fandex-tertiary",
  info: "border-fandex-primary text-fandex-primary",
};

const BG_MAP: Record<ToastType, string> = {
  success: "bg-fandex-secondary/10",
  error: "bg-red-400/10",
  warning: "bg-fandex-tertiary/10",
  info: "bg-fandex-primary/10",
};

const MAX_TOASTS = 5;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback(
    (type: ToastType, message: string, duration = 3000) => {
      setToasts((prev) => {
        // 去重：如果已有相同类型+消息的 toast，不重复添加
        const isDuplicate = prev.some((t) => t.type === type && t.message === message);
        if (isDuplicate) return prev;

        const id = nextId++;
        const newToasts = [...prev, { id, type, message, duration }];

        // 超过上限时移除最早的 toast
        if (newToasts.length > MAX_TOASTS) {
          return newToasts.slice(newToasts.length - MAX_TOASTS);
        }
        return newToasts;
      });
    },
    []
  );

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast 容器 - 固定右下角 */}
      <div
        className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 max-w-sm w-full pointer-events-none"
        role="region"
        aria-label="通知"
      >
        {toasts.map((toast) => (
          <ToastItemComponent
            key={toast.id}
            toast={toast}
            onRemove={removeToast}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItemComponent({
  toast,
  onRemove,
}: {
  toast: ToastItem;
  onRemove: (id: number) => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const Icon = ICON_MAP[toast.type];

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      onRemove(toast.id);
    }, toast.duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.duration, onRemove]);

  // Success toasts use a compact mini pill style (less intrusive for auto-save etc.)
  const isMini = toast.type === "success";

  if (isMini) {
    return (
      <div
        className={`pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 border ${COLOR_MAP[toast.type]} ${BG_MAP[toast.type]} bg-nf-bg-card/80 backdrop-blur-sm shadow-sm transition-all animate-slide-in-right text-xs`}
        role="status"
      >
        <Icon className="w-3 h-3 flex-shrink-0" />
        <span className="text-nf-text-secondary leading-tight">{toast.message}</span>
      </div>
    );
  }

  // 错误类型增加左侧 2px 红色色条,强化视觉警示区分
  const accentClass = toast.type === "error" ? "border-l-2 border-l-red-400" : "";

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2.5 px-4 py-3 border ${COLOR_MAP[toast.type]} ${BG_MAP[toast.type]} ${accentClass} bg-nf-bg-card shadow-lg transition-all animate-slide-in-right`}
      role="alert"
    >
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span className="flex-1 text-sm text-nf-text leading-relaxed">{toast.message}</span>
      <button
        onClick={() => onRemove(toast.id)}
        className="flex-shrink-0 text-nf-text-tertiary hover:text-nf-text transition duration-fast"
        aria-label="关闭通知"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
