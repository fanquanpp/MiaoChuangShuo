// 编辑项目设定对话框组件
//
// 功能概述：
// 模态对话框，用于编辑已有项目的元数据（名称、题材、作者、描述）。
// 复用 CreateProjectDialog 的视觉风格（FANDEX 直角美学 + 左侧色条标题）。
// 文体类型与项目路径在创建后不可变更，仅作只读展示。
//
// 模块职责：
// 1. 预填当前项目元数据
// 2. 收集用户修改后的可编辑字段
// 3. 调用后端 API 更新项目元数据
// 4. 成功后回调通知父组件刷新列表

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Loader2, ArrowRight, Lock } from "lucide-react";
import { updateProjectMeta, NOVEL_GENRES, type ProjectInfo } from "../lib/api";
import { useI18n } from "../lib/i18n";

// 组件属性接口
interface EditProjectDialogProps {
  /** 待编辑的项目信息（提供初始值与项目路径） */
  project: ProjectInfo;
  /** 关闭对话框回调 */
  onClose: () => void;
  /** 更新成功回调，参数为后端返回的最新 ProjectInfo */
  onSuccess: (updated: ProjectInfo) => void;
}

/**
 * 编辑项目设定对话框
 * 输入:
 *   - project: 待编辑项目（提供初始值与路径）
 *   - onClose: 关闭回调
 *   - onSuccess: 更新成功回调
 * 输出: JSX 模态对话框
 * 流程:
 *   1. 以 project.meta 初始化表单字段
 *   2. 用户编辑名称/题材/作者/描述
 *   3. 提交时调用 updateProjectMeta 写回 .novelforge/project.json
 *   4. 成功后触发 onSuccess 并关闭对话框
 */
export default function EditProjectDialog({ project, onClose, onSuccess }: EditProjectDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState(project.meta.name);
  const [genre, setGenre] = useState(project.meta.genre || "");
  const [author, setAuthor] = useState(project.meta.author || "");
  const [description, setDescription] = useState(project.meta.description || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSaveRef = useRef<() => void>(() => {});

  // 当前项目文体类型（只读展示，兼容旧版字符串与新版 3 标准文体）
  const currentType: string = project.meta.projectType || "novel";

  // Esc 关闭, Enter 提交（编辑中禁用 Esc 防止误触丢失修改）
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) {
        onClose();
        return;
      }
      if (
        e.key === "Enter" &&
        !saving &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLButtonElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        handleSaveRef.current();
      }
    },
    [onClose, saving]
  );
  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  /**
   * 提交保存：校验后调用后端 update_project_meta
   * 流程:
   *   1. 校验名称非空
   *   2. 调用后端命令原子写入元数据
   *   3. 成功触发 onSuccess，失败显示错误
   */
  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError(t("project.nameRequired"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await updateProjectMeta(
        project.path,
        name.trim(),
        genre,
        author.trim(),
        description.trim()
      );
      onSuccess(updated);
    } catch (e) {
      setError(t("project.editFailed", { error: String(e) }));
    } finally {
      setSaving(false);
    }
  }, [name, genre, author, description, project.path, t, onSuccess]);

  // Task 2.9: useRef.current 赋值移入 useEffect, 避免渲染期间副作用
  useEffect(() => {
    handleSaveRef.current = handleSave;
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] animate-fade-in"
      onClick={(e) => {
        // 点击遮罩关闭（保存中时禁止）
        if (e.target === e.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <div
        className="nf-glass-panel w-full max-w-lg bg-nf-bg-card border border-nf-border-light shadow-xl overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
          <h2 className="fandex-bar-left text-lg font-bold font-display text-nf-text">
            {t("project.editTitle")}
          </h2>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1.5 hover:bg-nf-bg-hover text-nf-text-tertiary hover:text-nf-text transition duration-fast disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 表单内容 */}
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* 文体类型（只读展示，创建后不可更改） */}
          <div>
            <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
              {t("project.formTypeLabel")}
              <Lock className="inline-block w-3 h-3 ml-1 text-nf-text-tertiary" aria-hidden="true" />
            </label>
            <div className="w-full flex items-center gap-2 px-3 py-2.5 bg-nf-bg/50 border border-nf-border-light text-left">
              <span className="flex-1 text-sm text-nf-text-tertiary">
                {currentType}
                <span className="text-xs text-nf-text-tertiary/70 ml-2">
                  {t("project.editTypeLocked")}
                </span>
              </span>
            </div>
          </div>

          {/* 项目名称 */}
          <div>
            <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
              {t("project.name")}
              <span className="text-red-400 ml-0.5" aria-hidden="true">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("project.namePlaceholder")}
              autoFocus
              className={`w-full bg-nf-bg border px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary transition duration-fast ${
                name.trim() ? "border-nf-border-light" : "border-red-400/50"
              }`}
            />
          </div>

          {/* 题材（次级可选） */}
          <div>
            <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
              {t("project.genreLabel")}
              <span className="text-nf-text-tertiary ml-1">{t("project.genreOptional")}</span>
            </label>
            <div className="relative">
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full appearance-none bg-nf-bg border border-nf-border-light px-3 py-2 pr-9 text-sm text-nf-text focus:outline-none focus:border-fandex-primary transition duration-fast cursor-pointer"
              >
                {NOVEL_GENRES.map((g) => (
                  <option key={g} value={g}>
                    {g || t("project.genreNone")}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 作者 */}
          <div>
            <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
              {t("project.author")}
            </label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder={t("project.authorPlaceholder")}
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary transition duration-fast"
            />
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
              {t("project.description")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("project.descriptionPlaceholder")}
              rows={3}
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary transition duration-fast resize-none"
            />
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="fandex-admonition fandex-admonition-danger text-sm text-red-400 animate-shake">
              {error}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-1 px-6 py-4 border-t border-nf-border-light">
          <button
            onClick={onClose}
            disabled={saving}
            className="nf-tool-btn h-8 px-4 text-sm flex items-center justify-center gap-1.5 text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover border border-nf-border-light transition duration-fast disabled:opacity-50"
          >
            {t("app.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="nf-tool-btn group h-8 px-4 text-sm flex items-center justify-center gap-1.5 bg-fandex-primary hover:bg-fandex-primary-hover font-medium text-nf-text-inverse transition duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? t("app.saving") : t("app.save")}
            {!saving && (
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-fast group-hover:translate-x-0.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
