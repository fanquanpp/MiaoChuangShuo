// 创建项目对话框组件
//
// 功能概述：
// 模态对话框，用于收集新建小说项目所需的参数。
// 文体类型由侧边栏预选传入，此处仅显示简要标识和可更改选项。
// 采用 FANDEX 美术风格：直角按钮、左侧色条标题、1px 边框。
//
// 模块职责：
// 1. 显示预选的文体类型（可更改）
// 2. 收集项目元数据（名称、题材、作者、描述）
// 3. 调用目录选择器选择保存位置
// 4. 调用后端 API 创建项目
// 5. 创建成功后触发回调

import { useState, useEffect, useCallback, useRef } from "react";
import { X, FolderOpen, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { createProject, pickDirectory, PROJECT_TEMPLATES, NOVEL_GENRES, type ProjectType } from "../lib/api";
import { useI18n } from "../lib/i18n";

// 组件属性接口
interface CreateProjectDialogProps {
  defaultType?: ProjectType;
  onClose: () => void;
  onSuccess: (projectPath: string) => void;
}

// 创建项目对话框组件
export default function CreateProjectDialog({
  defaultType = "standard",
  onClose,
  onSuccess,
}: CreateProjectDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [type, setType] = useState<ProjectType>(defaultType);
  const [genre, setGenre] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [parentPath, setParentPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [showTypeSelector, setShowTypeSelector] = useState(false);

  const handleCreateRef = useRef<() => void>(() => {});

  // 获取当前选中类型的模板信息
  const currentTemplate = PROJECT_TEMPLATES.find((tpl) => tpl.id === type) || PROJECT_TEMPLATES[0];

  // Esc 关闭, Enter 提交
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !creating) {
        onClose();
        return;
      }
      if (
        e.key === "Enter" &&
        !creating &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLButtonElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        handleCreateRef.current();
      }
    },
    [onClose, creating]
  );
  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handlePickDir = async () => {
    try {
      const dir = await pickDirectory();
      if (dir) {
        setParentPath(dir);
      }
    } catch (e) {
      setError(t("project.dirPickFailed", { error: String(e) }));
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError(t("project.nameRequired"));
      return;
    }
    if (!parentPath.trim()) {
      setError(t("project.locationRequired"));
      return;
    }

    setCreating(true);
    setError("");
    try {
      const projectPath = await createProject({
        name: name.trim(),
        type_str: type,
        genre: genre,
        author: author.trim(),
        description: description.trim(),
        parent_path: parentPath,
      });
      onSuccess(projectPath);
    } catch (e) {
      setError(t("project.createFailed", { error: String(e) }));
    } finally {
      setCreating(false);
    }
  };

  handleCreateRef.current = handleCreate;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-lg bg-nf-bg-card border border-nf-border-light shadow-xl overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
          <h2 className="fandex-bar-left text-lg font-bold font-display text-nf-text">
            {t("project.createTitle")}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-nf-bg-hover text-nf-text-tertiary hover:text-nf-text transition duration-fast"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 表单内容 */}
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* 文体类型 - 紧凑显示，可展开更改 */}
          <div>
            <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
              {t("project.formTypeLabel")}
            </label>
            <button
              onClick={() => setShowTypeSelector(!showTypeSelector)}
              className="w-full flex items-center gap-2 px-3 py-2.5 bg-nf-bg border border-nf-border-light hover:border-fandex-primary/50 transition duration-fast text-left"
            >
              <span className="flex-1">
                <span className="text-sm font-medium font-display text-nf-text">
                  {currentTemplate.name}
                </span>
                <span className="text-xs text-nf-text-tertiary ml-2">
                  {currentTemplate.desc}
                </span>
              </span>
              <ChevronDown className={`w-4 h-4 text-nf-text-tertiary transition-transform duration-fast ${
                showTypeSelector ? 'rotate-180' : ''
              }`} />
            </button>

            {/* 类型选择下拉面板 */}
            {showTypeSelector && (
              <div className="mt-1 border border-nf-border-light bg-nf-bg max-h-48 overflow-y-auto animate-fade-in">
                {PROJECT_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => {
                      setType(tpl.id);
                      setShowTypeSelector(false);
                    }}
                    className={`w-full flex items-start gap-2 px-3 py-2 text-left transition duration-fast ${
                      type === tpl.id
                        ? 'bg-fandex-primary/10'
                        : 'hover:bg-nf-bg-hover'
                    }`}
                  >
                    <ChevronRight className={`w-3 h-3 mt-0.5 ${
                      type === tpl.id ? 'text-fandex-primary' : 'text-transparent'
                    }`} />
                    <div>
                      <div className="text-sm font-medium font-display text-nf-text">
                        {tpl.name}
                      </div>
                      <div className="text-xs text-nf-text-tertiary mt-0.5 line-clamp-1">
                        {tpl.desc}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 项目名称 */}
          <div>
            <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
              {t("project.name")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("project.namePlaceholder")}
              autoFocus
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary transition duration-fast"
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
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nf-text-tertiary pointer-events-none" />
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

          {/* 保存位置 */}
          <div>
            <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
              {t("project.saveLocation")}
            </label>
            <div className="flex gap-1">
              <input
                type="text"
                value={parentPath}
                onChange={(e) => setParentPath(e.target.value)}
                placeholder={t("project.saveLocationPlaceholder")}
                readOnly
                className="flex-1 bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none transition duration-fast"
              />
              <button
                onClick={handlePickDir}
                className="px-3 py-2 bg-nf-bg-hover hover:bg-nf-border-light border border-nf-border-light text-sm text-nf-text flex items-center gap-1.5 transition duration-fast"
              >
                <FolderOpen className="w-4 h-4" />
                {t("app.browse")}
              </button>
            </div>
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
            className="px-4 py-2 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover border border-nf-border-light transition duration-fast"
          >
            {t("app.cancel")}
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 bg-fandex-primary hover:bg-fandex-primary-hover text-sm font-medium text-nf-text-inverse flex items-center gap-1.5 transition duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            {creating ? t("app.creating") : t("project.createTitle")}
          </button>
        </div>
      </div>
    </div>
  );
}
