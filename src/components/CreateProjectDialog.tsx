// 创建项目对话框组件
//
// 功能概述：
// 模态对话框，用于收集新建小说项目所需的参数。
// 采用 FANDEX 美术风格：直角按钮、左侧色条标题、1px 边框。
//
// 模块职责：
// 1. 收集用户输入的项目元数据
// 2. 调用目录选择器选择保存位置
// 3. 调用后端 API 创建项目
// 4. 创建成功后触发回调

import { useState } from "react";
import { X, FolderOpen, Loader2 } from "lucide-react";
import { createProject, pickDirectory, PROJECT_TEMPLATES, type ProjectType } from "../lib/api";

// 组件属性接口
interface CreateProjectDialogProps {
  defaultType?: ProjectType;
  onClose: () => void;
  onSuccess: (projectPath: string) => void;
}

// 创建项目对话框组件
// 输入: defaultType 默认类型, onClose 关闭回调, onSuccess 成功回调
// 输出: 渲染模态对话框
// 流程:
//   1. 用户填写项目信息
//   2. 选择保存目录
//   3. 点击创建调用后端 API
//   4. 成功后触发 onSuccess
export default function CreateProjectDialog({
  defaultType = "standard",
  onClose,
  onSuccess,
}: CreateProjectDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ProjectType>(defaultType);
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [parentPath, setParentPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const handlePickDir = async () => {
    try {
      const dir = await pickDirectory();
      if (dir) {
        setParentPath(dir);
      }
    } catch (e) {
      setError(`选择目录失败: ${e}`);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("请输入项目名称");
      return;
    }
    if (!parentPath.trim()) {
      setError("请选择保存位置");
      return;
    }

    setCreating(true);
    setError("");
    try {
      const projectPath = await createProject({
        name: name.trim(),
        type_str: type,
        author: author.trim(),
        description: description.trim(),
        parent_path: parentPath,
      });
      onSuccess(projectPath);
    } catch (e) {
      setError(`创建失败: ${e}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-nf-bg-card border border-nf-border-light shadow-lg overflow-hidden">
        {/* 头部 - FANDEX 左侧色条标题 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
          <h2 className="fandex-bar-left text-lg font-bold font-display text-nf-text">
            创建新项目
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-nf-bg-hover text-nf-text-tertiary hover:text-nf-text transition-fast"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 表单内容 */}
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* 项目名称 */}
          <div>
            <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
              项目名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入你的小说项目名称"
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary transition-fast"
            />
          </div>

          {/* 项目类型 - FANDEX 1px 网格 */}
          <div>
            <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
              创作题材
            </label>
            <div className="grid grid-cols-2 gap-1 bg-nf-border-light border border-nf-border-light">
              {PROJECT_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => setType(tpl.id)}
                  className={`p-3 text-left transition-fast bg-nf-bg ${
                    type === tpl.id
                      ? "bg-fandex-primary/10 border-fandex-primary"
                      : "hover:bg-nf-bg-hover"
                  }`}
                >
                  <div className="text-sm font-medium font-display text-nf-text">{tpl.name}</div>
                  <div className="text-xs text-nf-text-tertiary mt-0.5 line-clamp-2">
                    {tpl.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 作者 */}
          <div>
            <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
              作者(可选)
            </label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="输入作者名"
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary transition-fast"
            />
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
              项目描述(可选)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要描述你的小说项目"
              rows={3}
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary transition-fast resize-none"
            />
          </div>

          {/* 保存位置 */}
          <div>
            <label className="block text-sm font-medium text-nf-text-secondary mb-1.5">
              保存位置
            </label>
            <div className="flex gap-1">
              <input
                type="text"
                value={parentPath}
                onChange={(e) => setParentPath(e.target.value)}
                placeholder="选择项目保存目录"
                readOnly
                className="flex-1 bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none transition-fast"
              />
              <button
                onClick={handlePickDir}
                className="px-3 py-2 bg-nf-bg-hover hover:bg-nf-border-light border border-nf-border-light text-sm text-nf-text flex items-center gap-1.5 transition-fast"
              >
                <FolderOpen className="w-4 h-4" />
                浏览
              </button>
            </div>
          </div>

          {/* 错误提示 - FANDEX 提示块样式 */}
          {error && (
            <div className="fandex-admonition fandex-admonition-danger text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* 底部按钮 - FANDEX 直角 */}
        <div className="flex justify-end gap-1 px-6 py-4 border-t border-nf-border-light">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover border border-nf-border-light transition-fast"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 bg-fandex-primary hover:bg-fandex-primary-hover text-sm font-medium text-nf-text-inverse flex items-center gap-1.5 transition-fast disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            {creating ? "创建中..." : "创建项目"}
          </button>
        </div>
      </div>
    </div>
  );
}
