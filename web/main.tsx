// Web 版 React 入口
//
// 功能概述:
// 「喵创说」在线体验版的 React 渲染入口。
// 初始化主题状态, 注入示例数据, 挂载根组件 App。
// 不依赖任何 Tauri API, 完全运行在浏览器中。
//
// 模块职责:
// 1. 初始化主题 (从 localStorage 读取并应用)
// 2. 触发示例数据注入 (首次访问时)
// 3. 挂载 React 根组件

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { useWebThemeStore } from "./lib/theme";
import { ensureSampleData } from "./lib/db";

// 应用启动前初始化主题, 避免主题闪烁
useWebThemeStore.getState().initTheme();

// 异步注入示例数据 (不阻塞首屏渲染)
// 输入: 无
// 输出: Promise<void>
// 流程: 调用 ensureSampleData, 失败时静默处理 (IndexedDB 可能被禁用)
void ensureSampleData().catch((e: unknown) => {
  // IndexedDB 不可用时仅记录错误, 不影响应用启动
  console.error("[MiaoChuangShuo Web] 示例数据注入失败:", e);
});

// React 应用入口
// 输入: 无
// 输出: 挂载到 DOM 的 React 根组件
// 流程: 创建 React 根并渲染 App 组件
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
