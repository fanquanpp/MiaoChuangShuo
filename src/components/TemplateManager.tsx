// 自定义模板管理组件
//
// 功能概述：
// 管理用户自定义的项目文体模板。
// 支持创建、删除自定义模板，每个模板定义一组目录结构。
// 自定义模板在 Launcher 创建项目时可选择使用。
//
// 模块职责：
// 1. 显示已有自定义模板列表
// 2. 创建新模板（名称、描述、目录列表）
// 3. 删除已有模板
// 4. 从 Launcher 打开管理

import { useState, useEffect, useCallback } from "react";
import { X, Plus, Trash2, FolderPlus, Save, Layers } from "lucide-react";
import { listCustomTemplates, saveCustomTemplate, deleteCustomTemplate, type CustomTemplate } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";

interface TemplateManagerProps {
  onClose: () => void;
}

export default function TemplateManager({ onClose }: TemplateManagerProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [templates, setTemplates] = useState<CustomTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // 创建表单状态
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newDirs, setNewDirs] = useState<string[]>([]);
  const [newDirInput, setNewDirInput] = useState("");

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listCustomTemplates();
      setTemplates(list);
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleCreate = async () => {
    if (!newName.trim()) {
      showToast("error", t("template.nameRequired"));
      return;
    }
    if (newDirs.length === 0) {
      showToast("error", t("template.dirsRequired"));
      return;
    }
    try {
      const template: CustomTemplate = {
        id: `custom_${Date.now()}`,
        name: newName.trim(),
        description: newDesc.trim(),
        directories: newDirs.filter((d) => d.trim()),
        created_at: new Date().toISOString(),
      };
      await saveCustomTemplate(template);
      showToast("success", t("template.created", { name: template.name }));
      setNewName("");
      setNewDesc("");
      setNewDirs([]);
      setShowCreateForm(false);
      await loadTemplates();
    } catch (e) {
      showToast("error", t("template.createFailed", { error: String(e) }));
    }
  };

  const handleDelete = async (template: CustomTemplate) => {
    try {
      await deleteCustomTemplate(template.id);
      showToast("success", t("template.deleted", { name: template.name }));
      await loadTemplates();
    } catch (e) {
      showToast("error", t("template.deleteFailed", { error: String(e) }));
    }
  };

  const addDir = () => {
    const dir = newDirInput.trim();
    if (dir && !newDirs.includes(dir)) {
      setNewDirs([...newDirs, dir]);
      setNewDirInput("");
    }
  };

  const removeDir = (dir: string) => {
    setNewDirs(newDirs.filter((d) => d !== dir));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-manager-title"
        className="w-full max-w-2xl bg-nf-bg-card border border-nf-border-light shadow-xl overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
          <h2 id="template-manager-title" className="fandex-bar-left text-lg font-bold font-display text-nf-text">
            {t("template.managerTitle")}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-nf-bg-hover text-nf-text-tertiary hover:text-nf-text transition duration-fast"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <div className="text-center py-8 text-nf-text-tertiary text-sm">
              {t("common.loading")}
            </div>
          ) : showCreateForm ? (
            /* 创建新模板表单 */
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
                  {t("template.name")}
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("template.namePlaceholder")}
                  autoFocus
                  className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary transition duration-fast"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
                  {t("template.description")}
                </label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder={t("template.descriptionPlaceholder")}
                  rows={2}
                  className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary transition duration-fast resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
                  {t("template.directories")}
                </label>
                <p className="text-xs text-nf-text-tertiary mb-2">
                  {t("template.directoriesHint")}
                </p>
                {/* 已添加的目录 */}
                {newDirs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {newDirs.map((dir) => (
                      <span
                        key={dir}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-fandex-primary/10 text-fandex-primary border border-fandex-primary/20"
                      >
                        <Layers className="w-3 h-3" />
                        {dir}
                        <button
                          onClick={() => removeDir(dir)}
                          className="ml-0.5 hover:text-red-400 transition duration-fast"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {/* 添加新目录 */}
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={newDirInput}
                    onChange={(e) => setNewDirInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addDir();
                      }
                    }}
                    placeholder={t("template.dirPlaceholder")}
                    className="flex-1 bg-nf-bg border border-nf-border-light px-3 py-1.5 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary transition duration-fast"
                  />
                  <button
                    onClick={addDir}
                    disabled={!newDirInput.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm bg-nf-bg-hover hover:bg-nf-border-light text-nf-text-secondary transition duration-fast disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    {t("template.addDir")}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* 模板列表 */
            <div className="space-y-2">
              {templates.length === 0 ? (
                <div className="text-center py-8">
                  <Layers className="w-10 h-10 text-nf-border mx-auto mb-3" />
                  <p className="text-sm text-nf-text-secondary mb-1">
                    {t("template.noTemplates")}
                  </p>
                  <p className="text-xs text-nf-text-tertiary">
                    {t("template.noTemplatesHint")}
                  </p>
                </div>
              ) : (
                templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="flex items-start gap-3 p-4 border border-nf-border-light hover:border-fandex-primary/30 bg-nf-bg transition duration-fast group"
                  >
                    <div className="p-2 bg-fandex-primary/10 flex-shrink-0">
                      <Layers className="w-4 h-4 text-fandex-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold font-display text-nf-text">
                        {tpl.name}
                      </h3>
                      {tpl.description && (
                        <p className="text-xs text-nf-text-tertiary mt-0.5 line-clamp-1">
                          {tpl.description}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {tpl.directories.map((dir) => (
                          <span
                            key={dir}
                            className="px-1.5 py-0.5 text-[10px] bg-nf-bg-hover text-nf-text-tertiary border border-nf-border-light/50"
                          >
                            {dir}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(tpl)}
                      className="p-1.5 text-nf-text-tertiary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all duration-fast flex-shrink-0"
                      title={t("app.delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-nf-border-light">
          {!showCreateForm && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-nf-text-secondary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/40 hover:bg-nf-bg-hover transition duration-fast"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("template.createNew")}
            </button>
          )}
          {showCreateForm && <div />}
          <div className="flex items-center gap-2">
            {showCreateForm && (
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  setNewName("");
                  setNewDesc("");
                  setNewDirs([]);
                }}
                className="px-4 py-2 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
              >
                {t("app.cancel")}
              </button>
            )}
            {showCreateForm && (
              <button
                onClick={handleCreate}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast"
              >
                <Save className="w-3.5 h-3.5" />
                {t("template.save")}
              </button>
            )}
            {!showCreateForm && (
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast"
              >
                {t("app.done")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
