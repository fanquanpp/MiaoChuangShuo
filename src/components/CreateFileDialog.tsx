// 新建文件对话框组件
//
// 功能概述：
// 提供统一的新建文件对话框 UI，含文件名输入校验、
// 目标目录提示、创建/取消操作。
// 采用 FANDEX 直角美学。
//
// 模块职责：
// 1. 渲染新建文件对话框
// 2. 文件名输入与实时校验
// 3. 键盘快捷操作（Enter 提交）
// 4. 创建中加载状态

import { useState } from "react";
import { X, FilePlus, Loader2 } from "lucide-react";
import { isValidFileName } from "../lib/fileTreeUtils";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";

interface CreateFileDialogProps {
  open: boolean;
  dirName: string;
  onClose: () => void;
  onConfirm: (fileName: string) => Promise<void>;
}

export default function CreateFileDialog({
  open,
  dirName,
  onClose,
  onConfirm,
}: CreateFileDialogProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [newFileName, setNewFileName] = useState("");
  const [fileNameError, setFileNameError] = useState("");
  const [creating, setCreating] = useState(false);

  if (!open) return null;

  const handleCreate = async () => {
    const name = newFileName.trim();
    if (!name) return;

    if (!isValidFileName(name)) {
      setFileNameError(t("filelist.invalidChars"));
      return;
    }

    if (name.includes(".")) {
      const ext = name.split(".").pop()?.toLowerCase();
      if (ext !== "txt") {
        setFileNameError(t("filelist.unsupportedExt"));
        return;
      }
    }

    setFileNameError("");
    setCreating(true);
    try {
      let fileName = name;
      if (!fileName.endsWith(".txt")) {
        fileName += ".txt";
      }
      await onConfirm(fileName);
      setNewFileName("");
      onClose();
    } catch (e) {
      showToast("error", t("filelist.createFailed", { error: String(e) }));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-md bg-nf-bg-card border border-nf-border-light shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-nf-border-light">
          <div className="flex items-center gap-2">
            <FilePlus className="w-4 h-4 text-fandex-primary" />
            <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text">
              {t("filelist.newFileTitle")}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-nf-bg-hover text-nf-text-tertiary transition duration-fast"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <label className="block text-xs text-nf-text-secondary mb-1.5">
            {t("filelist.newFileName", { dirName })}
          </label>
          <input
            type="text"
            value={newFileName}
            onChange={(e) => {
              setNewFileName(e.target.value);
              setFileNameError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            placeholder={t("filelist.newFilePlaceholder")}
            autoFocus
            className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
          />
          {fileNameError && (
            <p className="text-xs text-red-400 mt-1.5">{fileNameError}</p>
          )}
          <p className="text-xs text-nf-text-tertiary mt-2">
            {t("filelist.autoMd")}
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-nf-border-light">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
          >
            {t("app.cancel")}
          </button>
          <button
            onClick={handleCreate}
            disabled={!newFileName.trim() || creating}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-fandex-primary hover:bg-fandex-primary-hover text-sm font-medium text-nf-text-inverse transition duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {creating ? t("app.creating") : t("filelist.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
