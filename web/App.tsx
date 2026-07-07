// Web 版根组件 (路由: 启动页 / 工作台)
//
// 功能概述:
// 「喵创说」在线体验版的根组件, 使用 useState 实现轻量路由切换。
// 包含两个视图:
//   - Launcher 启动页: 项目列表 + 创建项目 + 桌面版下载入口
//   - Workspace 工作台: 章节列表 + TipTap 编辑器
// 不引入 react-router, 保持依赖最小化。
//
// 模块职责:
// 1. 管理当前视图状态 (launcher / workspace)
// 2. 管理当前打开的项目 ID
// 3. 在 Launcher 与 Workspace 之间切换

import { useState, useCallback } from "react";
import Launcher from "./components/Launcher";
import Workspace from "./components/Workspace";

// 视图类型
type View = "launcher" | "workspace";

/**
 * App 根组件
 * 输入: 无
 * 输出: JSX.Element
 * 流程:
 *   1. 默认显示 Launcher 启动页
 *   2. 用户点击项目卡片时, 记录 projectId 并切换到 workspace
 *   3. Workspace 返回时, 切换回 launcher
 */
export default function App(): JSX.Element {
  // 当前视图
  const [view, setView] = useState<View>("launcher");
  // 当前打开的项目 ID
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  /**
   * 打开指定项目, 切换到工作台
   * 输入: projectId 项目 ID
   * 输出: 无
   * 流程: 设置 activeProjectId 并切换视图
   */
  const handleOpenProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    setView("workspace");
  }, []);

  /**
   * 返回启动页
   * 输入: 无
   * 输出: 无
   * 流程: 清空 activeProjectId 并切换视图
   */
  const handleBackToLauncher = useCallback(() => {
    setActiveProjectId(null);
    setView("launcher");
  }, []);

  if (view === "workspace" && activeProjectId !== null) {
    return (
      <Workspace
        projectId={activeProjectId}
        onBack={handleBackToLauncher}
      />
    );
  }

  return <Launcher onOpenProject={handleOpenProject} />;
}
