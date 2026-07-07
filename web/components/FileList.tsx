// 章节列表组件 (FileList)
//
// 功能概述:
// 展示当前项目下的所有章节, 支持新建/重命名/删除章节。
// 章节按 order 升序排列, 选中章节高亮显示。
//
// 模块职责:
// 1. 加载并展示项目下的章节列表
// 2. 提供新建章节按钮 (内联输入名称)
// 3. 提供重命名章节 (内联输入名称)
// 4. 提供删除章节 (确认对话框)
// 5. 点击章节触发 onSelect 回调

import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, FileText, Loader2 } from "lucide-react";
import type { WebChapter } from "../lib/types";
import { listChapters, createChapter, renameChapter, deleteChapter } from "../lib/db";

// FileList 组件属性
interface FileListProps {
  // 当前项目 ID
  projectId: string;
  // 当前选中的章节 ID (null 表示未选中)
  activeChapterId: string | null;
  // 选择章节回调
  onSelectChapter: (chapterId: string) => void;
}

/**
 * FileList 章节列表组件
 * 输入: projectId / activeChapterId / onSelectChapter
 * 输出: JSX.Element
 * 流程:
 *   1. 加载项目下所有章节
 *   2. 渲染章节列表与操作按钮
 *   3. 提供新建/重命名/删除交互
 */
export default function FileList({
  projectId,
  activeChapterId,
  onSelectChapter,
}: FileListProps): JSX.Element {
  // 章节列表
  const [chapters, setChapters] = useState<WebChapter[]>([]);
  // 加载状态
  const [loading, setLoading] = useState<boolean>(true);
  // 新建模式 (显示输入框)
  const [creating, setCreating] = useState<boolean>(false);
  // 新建章节名称
  const [newName, setNewName] = useState<string>("");
  // 正在重命名的章节 ID
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // 重命名输入值
  const [renameValue, setRenameValue] = useState<string>("");
  // 待删除章节
  const [pendingDelete, setPendingDelete] = useState<WebChapter | null>(null);
  // 操作中状态
  const [acting, setActing] = useState<boolean>(false);

  /**
   * 刷新章节列表
   * 输入: 无
   * 输出: 无
   * 流程: 调用 listChapters 并更新状态
   */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listChapters(projectId);
      setChapters(list);
    } catch (e) {
      console.error("[MiaoChuangShuo Web] 加载章节列表失败:", e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // projectId 变化时刷新
  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * 提交新建章节
   * 输入: 无
   * 输出: 无
   * 流程:
   *   1. 校验名称非空
   *   2. 调用 createChapter 创建
   *   3. 刷新列表并自动选中新章节
   */
  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setActing(true);
    try {
      const ch = await createChapter(projectId, trimmed);
      setNewName("");
      setCreating(false);
      await refresh();
      onSelectChapter(ch.id);
    } catch (e) {
      console.error("[MiaoChuangShuo Web] 创建章节失败:", e);
    } finally {
      setActing(false);
    }
  }, [newName, projectId, refresh, onSelectChapter]);

  /**
   * 提交重命名
   * 输入: id 章节 ID
   * 输出: 无
   * 流程: 校验名称后调用 renameChapter 并刷新
   */
  const handleRename = useCallback(
    async (id: string) => {
      const trimmed = renameValue.trim();
      if (!trimmed) {
        setRenamingId(null);
        return;
      }
      setActing(true);
      try {
        await renameChapter(id, trimmed);
        setRenamingId(null);
        await refresh();
      } catch (e) {
        console.error("[MiaoChuangShuo Web] 重命名章节失败:", e);
      } finally {
        setActing(false);
      }
    },
    [renameValue, refresh]
  );

  /**
   * 确认删除章节
   * 输入: 无
   * 输出: 无
   * 流程: 调用 deleteChapter 并刷新
   */
  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setActing(true);
    try {
      await deleteChapter(pendingDelete.id);
      setPendingDelete(null);
      await refresh();
    } catch (e) {
      console.error("[MiaoChuangShuo Web] 删除章节失败:", e);
    } finally {
      setActing(false);
    }
  }, [pendingDelete, refresh]);

  return (
    <div className="filelist">
      <div className="filelist-header">
        <span className="filelist-header-title">章节 ({chapters.length})</span>
        <button
          type="button"
          className="mc-btn mc-btn-icon mc-btn-ghost"
          title="新建章节"
          onClick={() => setCreating(true)}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="filelist-body">
        {loading ? (
          <div className="filelist-empty">
            <Loader2 size={16} className="mc-spin" />
            <p style={{ marginTop: 8 }}>加载中...</p>
          </div>
        ) : chapters.length === 0 && !creating ? (
          <div className="filelist-empty">
            <FileText size={20} style={{ opacity: 0.4 }} />
            <p style={{ marginTop: 8 }}>暂无章节</p>
            <p style={{ fontSize: "0.7rem", marginTop: 4 }}>点击右上角加号创建</p>
          </div>
        ) : (
          <>
            {chapters.map((chapter) => (
              <div
                key={chapter.id}
                className={`filelist-item${
                  activeChapterId === chapter.id ? " active" : ""
                }`}
                onClick={() => onSelectChapter(chapter.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectChapter(chapter.id);
                  }
                }}
              >
                {renamingId === chapter.id ? (
                  <input
                    className="mc-input"
                    style={{ flex: 1, padding: "2px 6px", fontSize: "0.8rem" }}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => void handleRename(chapter.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleRename(chapter.id);
                      } else if (e.key === "Escape") {
                        setRenamingId(null);
                      }
                    }}
                    autoFocus
                    maxLength={50}
                  />
                ) : (
                  <>
                    <span className="filelist-item-name">{chapter.name}</span>
                    <span className="filelist-item-wordcount">
                      {chapter.wordCount}
                    </span>
                    <div className="filelist-item-actions">
                      <button
                        type="button"
                        className="filelist-item-action"
                        title="重命名"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(chapter.id);
                          setRenameValue(chapter.name);
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        className="filelist-item-action danger"
                        title="删除章节"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDelete(chapter);
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}

            {/* 新建章节输入框 */}
            {creating && (
              <div className="filelist-item" style={{ cursor: "default" }}>
                <input
                  className="mc-input"
                  style={{ flex: 1, padding: "2px 6px", fontSize: "0.8rem" }}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="章节名称"
                  onBlur={() => {
                    if (newName.trim()) {
                      void handleCreate();
                    } else {
                      setCreating(false);
                      setNewName("");
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreate();
                    } else if (e.key === "Escape") {
                      setCreating(false);
                      setNewName("");
                    }
                  }}
                  autoFocus
                  maxLength={50}
                  disabled={acting}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* 删除确认对话框 */}
      {pendingDelete && (
        <div
          className="mc-modal-overlay"
          onClick={() => !acting && setPendingDelete(null)}
        >
          <div className="mc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mc-modal-title">删除章节</div>
            <div className="mc-modal-body">
              确定要删除章节{" "}
              <strong style={{ color: "var(--mc-tertiary)" }}>
                {pendingDelete.name}
              </strong>{" "}
              吗? 此操作不可恢复。
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
