// 启动页组件 (Launcher)
//
// 功能概述:
// 「喵创说」在线体验版的入口页面, 包含:
//   - 顶部导航: 品牌标识 + 在线体验版标签 + 主题切换
//   - Hero 区: 项目标题 + 简介 + 开始创作按钮 + 桌面版下载链接
//   - 项目列表: 网格展示所有项目, 支持新建/打开/删除
//   - 底部: 版权信息与仓库链接
//
// 模块职责:
// 1. 加载并展示 IndexedDB 中的项目列表
// 2. 提供新建项目对话框
// 3. 提供删除项目确认对话框
// 4. 点击项目卡片触发 onOpenProject 回调
// 5. 明确标注"在线体验版"并提供桌面版下载入口

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  BookOpen,
  Trash2,
  Download,
  ExternalLink,
  Feather,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { WebProject } from "../lib/types";
import {
  listProjects,
  createProject,
  deleteProject,
} from "../lib/db";
import { DESKTOP_DOWNLOAD_URL, REPO_URL } from "../lib/sampleData";
import ThemeToggle from "./ThemeToggle";

// Launcher 组件属性
interface LauncherProps {
  // 打开项目回调
  onOpenProject: (projectId: string) => void;
}

// 项目类型显示名映射
const TYPE_LABELS: Record<string, string> = {
  novel: "小说",
  essay: "散文",
  script: "剧本",
  poetry: "诗歌",
};

/**
 * 格式化字数为友好显示
 * 输入: count 字数
 * 输出: 格式化字符串 (如 "1.2 万" / "3500")
 * 流程:
 *   - 超过 10000 显示 "x.x 万"
 *   - 否则显示原始数字
 */
function formatWordCount(count: number): string {
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)} 万字`;
  }
  return `${count} 字`;
}

/**
 * 格式化 ISO 时间为短日期
 * 输入: iso ISO 时间字符串
 * 输出: 形如 "2025-07-07" 的字符串
 */
function formatDate(iso: string): string {
  try {
    return iso.slice(0, 10);
  } catch {
    return "";
  }
}

/**
 * Launcher 启动页组件
 * 输入: onOpenProject 打开项目回调
 * 输出: JSX.Element
 * 流程:
 *   1. 挂载时加载项目列表
 *   2. 渲染 Hero 区与项目网格
 *   3. 提供新建/删除项目交互
 */
export default function Launcher({ onOpenProject }: LauncherProps): JSX.Element {
  // 项目列表
  const [projects, setProjects] = useState<WebProject[]>([]);
  // 加载状态
  const [loading, setLoading] = useState<boolean>(true);
  // 错误信息
  const [error, setError] = useState<string | null>(null);
  // 新建项目对话框可见性
  const [showCreate, setShowCreate] = useState<boolean>(false);
  // 新建项目名称
  const [newName, setNewName] = useState<string>("");
  // 新建项目类型
  const [newType, setNewType] = useState<string>("novel");
  // 待删除项目 (null 表示未触发删除)
  const [pendingDelete, setPendingDelete] = useState<WebProject | null>(null);
  // 操作中状态 (用于禁用按钮)
  const [acting, setActing] = useState<boolean>(false);

  /**
   * 加载项目列表
   * 输入: 无
   * 输出: 无
   * 流程: 调用 listProjects 并更新状态
   */
  const refreshProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listProjects();
      setProjects(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载项目失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 挂载时加载项目列表
  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  /**
   * 提交新建项目
   * 输入: 无
   * 输出: 无
   * 流程:
   *   1. 校验名称非空
   *   2. 调用 createProject 创建
   *   3. 关闭对话框并刷新列表
   */
  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setActing(true);
    try {
      await createProject(trimmed, newType);
      setShowCreate(false);
      setNewName("");
      setNewType("novel");
      await refreshProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建项目失败");
    } finally {
      setActing(false);
    }
  }, [newName, newType, refreshProjects]);

  /**
   * 确认删除项目
   * 输入: 无
   * 输出: 无
   * 流程: 调用 deleteProject 并刷新列表
   */
  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setActing(true);
    try {
      await deleteProject(pendingDelete.id);
      setPendingDelete(null);
      await refreshProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除项目失败");
    } finally {
      setActing(false);
    }
  }, [pendingDelete, refreshProjects]);

  return (
    <div className="launcher">
      {/* 顶部导航 */}
      <header className="launcher-header">
        <div className="launcher-brand">
          <Feather size={18} />
          <span>喵创说</span>
          <span className="launcher-brand-tag">在线体验版</span>
        </div>
        <div className="launcher-header-actions">
          <a
            href={DESKTOP_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mc-btn mc-btn-sm"
            title="下载桌面版 (功能更完整)"
          >
            <Download size={14} />
            桌面版
          </a>
          <ThemeToggle />
        </div>
      </header>

      {/* Hero 区 */}
      <section className="launcher-hero">
        <h1 className="launcher-hero-title">喵创说</h1>
        <p className="launcher-hero-subtitle">
          离线小说创作工作站的在线体验版。无需下载安装, 在浏览器中即可体验
          TipTap 富文本编辑、项目管理、章节管理与实时字数统计等核心创作功能。
        </p>
        <div className="launcher-hero-actions">
          <button
            type="button"
            className="mc-btn mc-btn-primary"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={16} />
            开始创作
          </button>
          <a
            href={DESKTOP_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mc-btn"
          >
            <Download size={16} />
            下载桌面完整版
          </a>
        </div>
        <div className="launcher-notice">
          <strong>提示:</strong>
          在线体验版数据存储在浏览器本地 (IndexedDB), 清除浏览器数据将导致丢失。
          桌面版提供 AI 助手、人物图谱、剧情时间线、设定库、版本快照等完整功能, 且数据以文件形式持久保存。
        </div>
      </section>

      {/* 项目列表区 */}
      <main className="launcher-main">
        <div className="launcher-section-title">
          <h2>我的项目 ({projects.length})</h2>
          <button
            type="button"
            className="mc-btn mc-btn-sm"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={14} />
            新建项目
          </button>
        </div>

        {error && (
          <div
            className="mc-toast error"
            style={{ position: "static", transform: "none", margin: "0 0 16px" }}
          >
            <AlertCircle size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
            {error}
          </div>
        )}

        {loading ? (
          <div className="launcher-empty">
            <Loader2 size={24} className="mc-spin" />
            <p style={{ marginTop: 12 }}>正在加载项目列表...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="launcher-empty">
            <BookOpen size={32} style={{ opacity: 0.4 }} />
            <p style={{ marginTop: 12 }}>还没有项目, 点击"开始创作"创建第一个吧</p>
          </div>
        ) : (
          <div className="project-grid">
            {projects.map((project) => (
              <div
                key={project.id}
                className="project-card"
                onClick={() => onOpenProject(project.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenProject(project.id);
                  }
                }}
              >
                <div className="project-card-header">
                  <div className="project-card-name">{project.name}</div>
                  <span className="project-card-type">
                    {TYPE_LABELS[project.type] ?? project.type}
                  </span>
                </div>
                <div className="project-card-meta">
                  <span className="project-card-meta-item">
                    创建: {formatDate(project.createdAt)}
                  </span>
                  <span className="project-card-meta-item">
                    修改: {formatDate(project.updatedAt)}
                  </span>
                </div>
                <div className="project-card-footer">
                  <span className="project-card-wordcount">
                    {formatWordCount(project.wordCount)}
                  </span>
                  <div className="project-card-actions">
                    <button
                      type="button"
                      className="mc-btn mc-btn-icon mc-btn-ghost mc-btn-danger"
                      title="删除项目"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete(project);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 底部 */}
      <footer className="launcher-footer">
        <p>
          喵创说 在线体验版 - 数据存储于浏览器本地, 不上传任何服务器
          <br />
          完整功能请下载{" "}
          <a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
            桌面版
          </a>{" "}
          /{" "}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub 仓库
            <ExternalLink size={11} style={{ marginLeft: 2, verticalAlign: "middle" }} />
          </a>
        </p>
      </footer>

      {/* 新建项目对话框 */}
      {showCreate && (
        <div
          className="mc-modal-overlay"
          onClick={() => !acting && setShowCreate(false)}
        >
          <div className="mc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mc-modal-title">新建项目</div>
            <div className="mc-modal-body">
              <label className="mc-input-label" htmlFor="project-name">
                项目名称
              </label>
              <input
                id="project-name"
                className="mc-input"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="请输入项目名称"
                autoFocus
                maxLength={50}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleCreate();
                  }
                }}
              />
              <label className="mc-input-label" htmlFor="project-type" style={{ marginTop: 12 }}>
                项目类型
              </label>
              <select
                id="project-type"
                className="mc-input"
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
              >
                <option value="novel">小说</option>
                <option value="essay">散文</option>
                <option value="script">剧本</option>
                <option value="poetry">诗歌</option>
              </select>
            </div>
            <div className="mc-modal-footer">
              <button
                type="button"
                className="mc-btn"
                onClick={() => setShowCreate(false)}
                disabled={acting}
              >
                取消
              </button>
              <button
                type="button"
                className="mc-btn mc-btn-primary"
                onClick={handleCreate}
                disabled={acting || !newName.trim()}
              >
                {acting ? <Loader2 size={14} className="mc-spin" /> : <Plus size={14} />}
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认对话框 */}
      {pendingDelete && (
        <div
          className="mc-modal-overlay"
          onClick={() => !acting && setPendingDelete(null)}
        >
          <div className="mc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mc-modal-title">删除项目</div>
            <div className="mc-modal-body">
              确定要删除项目{" "}
              <strong style={{ color: "var(--mc-tertiary)" }}>
                {pendingDelete.name}
              </strong>{" "}
              及其所有章节吗? 此操作不可恢复。
            </div>
            <div className="mc-modal-footer">
              <button
                type="button"
                className="mc-btn"
                onClick={() => setPendingDelete(null)}
                disabled={acting}
              >
                取消
              </button>
              <button
                type="button"
                className="mc-btn mc-btn-danger"
                onClick={handleConfirmDelete}
                disabled={acting}
              >
                {acting ? <Loader2 size={14} className="mc-spin" /> : <Trash2 size={14} />}
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
