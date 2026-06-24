import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// React 应用入口
// 输入: 无
// 输出: 挂载到 DOM 的 React 根组件
// 流程: 创建 React 根并渲染 App 组件
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
