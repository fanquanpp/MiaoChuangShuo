// 错误边界组件
//
// 功能概述：
// React 错误边界，捕获子组件渲染过程中的同步异常，展示降级 UI 防止整页白屏。
// 支持自定义 fallback 与重试按钮，错误信息输出到控制台便于调试。
//
// 模块职责：
// 1. 拦截子组件渲染异常（不拦截事件回调、异步错误）
// 2. 提供默认降级 UI（错误信息 + 重试按钮）
// 3. 支持外部注入 i18n 函数，实现错误文案本地化

import React from "react";
import { logger } from "../lib/logger";

/** 错误边界 i18n 上下文，由外部通过 setErrorBoundaryI18n 注入 */
interface ErrorBoundaryContext {
  t: (key: string) => string;
}

// 默认 i18n 上下文：未注入时直接返回键名作为兜底
let ctx: ErrorBoundaryContext = { t: (key: string) => key };

/**
 * 注入 i18n 上下文到错误边界
 * 输入: i18nCtx 包含 t 翻译函数的上下文
 * 输出: 无
 * 流程: 将外部 i18n 函数保存到模块级变量，供 ErrorBoundary 渲染时使用
 */
export function setErrorBoundaryI18n(i18nCtx: ErrorBoundaryContext) {
  ctx = i18nCtx;
}

/** ErrorBoundary 组件属性 */
interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/** ErrorBoundary 内部状态 */
interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * 错误边界组件
 * 输入:
 *   - children: 受保护的子组件树
 *   - fallback: 可选的自定义降级 UI（未提供时使用默认错误页）
 * 输出: 正常渲染 children，或捕获异常后渲染降级 UI
 * 流程:
 *   1. 子组件渲染抛出异常时，getDerivedStateFromError 更新 state
 *   2. componentDidCatch 将错误信息输出到控制台
 *   3. render 判断 state.hasError，渲染默认错误页或 fallback
 *   4. 用户点击重试按钮后重置 state，触发子组件重新渲染
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error(error.message, info.componentStack, "ErrorBoundary");
  }

  /** 重试按钮回调：重置错误状态，触发子组件重新渲染 */
  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-nf-bg text-nf-text">
          <h2 className="text-lg font-semibold mb-2">{ctx.t("error.renderError")}</h2>
          <p className="text-sm text-nf-text-secondary mb-4 max-w-md text-center">
            {this.state.error?.message || ctx.t("error.unknownError")}
          </p>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 bg-fandex-primary text-nf-text-inverse text-sm hover:bg-fandex-primary-hover transition duration-fast"
          >
            {ctx.t("error.retry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
