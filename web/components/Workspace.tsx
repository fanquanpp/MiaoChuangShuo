// 工作台组件 (Workspace)
//
// 功能概述:
// 「喵创说」在线体验版的核心工作区, 左侧为章节列表, 右侧为 TipTap 编辑器。
// 顶部导航显示项目名称、返回按钮与主题切换。
//
// 模块职责:
// 1. 加载项目信息并显示在顶部
// 2. 管理当前选中的章节 ID
// 3. 组合 FileList 与 Editor 组件
// 4. 提供返回启动页入口

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, BookOpen, Loader2 } from "lucide-react";
import type { WebProject } from "../lib/types";
import { getProject } from "../lib/db";
import FileList from "./FileList";
import Editor from "./Editor";
import ThemeToggle from "./ThemeToggle";

// Workspace 组件属性
interface WorkspaceProps {
  // 当前项目 ID
  projectId: string;
  // 返回启动页回调
  onBack: () => void;
}

/**
 * Workspace 工作台组件
 * 输入: projectId / onBack
 * 输出: JSX.Element
 * 流程:
 *   1. 加载项目信息
 *   2. 渲染顶部导航 (返回 + 项目名 + 主题切换)
 *   3. 左侧 FileList, 右侧 Editor
 *   4. 章节切换时更新 activeChapterId
 */
export default function Workspace({ projectId, onBack }: WorkspaceProps): JSX.Element {
  // 项目信息
  const [project, setProject] = useState<WebProject | null>(null);
  // 加载状态
  const [loading, setLoading] = useState<boolean>(true);
  // 当前选中章节 ID
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

  /**
   * 加载项目信息
   * 输入: id 项目 ID
   * 输出: 无
   * 流程: 调用 getProject 并更新状态
   */
  const loadProject = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const p = await getProject(id);
      setProject(p);
    } catch (e) {
      console.error("[MiaoChuangShuo Web] 加载项目失败:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // projectId 变化时加载项目
  useEffect(() => {
    void loadProject(projectId);
  }, [projectId, loadProject]);

  /**
   * 选择章节
   * 输入: chapterId 章节 ID
   * 输出: 无
   * 流程: 更新 activeChapterId
   */
  const handleSelectChapter = useCallback((chapterId: string) => {
    setActiveChapterId(chapterId);
  }, []);

  if (loading) {
    return (
      <div className="workspace">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "var(--mc-text-tertiary)",
            gap: 8,
          }}
        >
          <Loader2 size={20} className="mc-spin" />
          正在加载项目...
        </div>
      </div>
    );
  }

  // 项目不存在时返回启动页
  if (!project) {
    return (
      <div className="workspace">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "var(--mc-text-tertiary)",
            gap: 12,
          }}
        >
          <p>项目不存在或已被删除</p>
          <button type="button" className="mc-btn" onClick={onBack}>
            返回启动页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace">
      {/* 顶部导航 */}
      <header className="workspace-header">
        <div className="workspace-header-left">
          <button
            type="button"
            className="mc-btn mc-btn-icon mc-btn-ghost"
            onClick={onBack}
            title="返回启动页"
            aria-label="返回启动页"
          >
            <ArrowLeft size={16} />
          </button>
          <BookOpen size={16} style={{ color: "var(--mc-primary)" }} />
          <span className="workspace-title">{project.name}</span>
          <span
            style={{
              fontSize: "0.7rem",
              padding: "2px 6px",
              background: "var(--mc-bg-code)",
              color: "var(--mc-text-tertiary)",
              borderRadius: 2,
            }}
          >
            {project.wordCount} 字
          </span>
        </div>
        <div className="workspace-header-right">
          <ThemeToggle />
        </div>
      </header>

      {/* 工作区主体 */}
      <div className="workspace-body">
        <FileList
          projectId={projectId}
          activeChapterId={activeChapterId}
          onSelectChapter={handleSelectChapter}
        />
        <Editor chapterId={activeChapterId} />
      </div>
    </div>
  );
}
