// 右侧文件列表组件（支持子文件夹展开/折叠）
//
// 功能概述：
// 显示当前分类下的文件列表，支持卡片视图与列表视图切换，
// 支持子文件夹展开/折叠导航。
// 正文分类支持拖拽排序和批量重编号。
// 采用 FANDEX 美术风格：直角、左侧色条标题、1px 边框。
//
// 模块职责：
// 1. 从项目目录树中过滤当前分类的文件
// 2. 渲染卡片网格或列表（含子文件夹展开/折叠）
// 3. 处理文件选择、重命名与删除
// 4. 正文分类拖拽排序 + 批量重编号

import { useState, useMemo, useCallback } from "react";
import {
  FileText,
  Trash2,
  Grid,
  List,
  FilePlus,
  PenLine,
  FolderOpen,
  Folder,
  ChevronRight,
  ChevronDown,
  GripVertical,
  RefreshCw,
} from "lucide-react";
import { useAppStore, getCategoryDir, type SidebarCategory } from "../lib/store";
import type { FileNode } from "../lib/api";
import { deletePath, readProjectTree, renamePath } from "../lib/api";
import { findDirByName, isValidFileName } from "../lib/fileTreeUtils";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { extractChapterNum } from "../lib/settingsStore";
import ConfirmDialog from "./ConfirmDialog";

interface FileListProps {
  onCreateFile: () => void;
  onSelectFile?: (file: FileNode) => void;
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 从文件名中提取章节序号，用于正文文件自动排序
function extractChapterNumber(name: string): number {
  const patterns = [
    /第(\d+)章/,
    /第(\d+)节/,
    /第(\d+)回/,
    /[Cc]hapter\s*(\d+)/,
    /^(\d+)[._\-]/,
  ];
  for (const p of patterns) {
    const m = name.match(p);
    if (m) return parseInt(m[1], 10);
  }
  return Infinity; // non-chapter files sort last
}

// 从文件名中去除编号前缀，保留纯名称
function stripNumberPrefix(name: string): string {
  return name
    .replace(/^\d+[._\-\s]*/, "")
    .replace(/\.txt$/i, "")
    .trim();
}

// 递归渲染文件树节点（列表视图）
function TreeNodeList({
  node,
  depth,
  selectedPath,
  onSelect,
  onRename,
  onDelete,
  t,
  activeFileWordCount,
  isDraggable,
  isDragOver,
  isDragging,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (node: FileNode) => void;
  onRename: (node: FileNode, e: React.MouseEvent) => void;
  onDelete: (node: FileNode, e: React.MouseEvent) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  activeFileWordCount?: number;
  isDraggable?: boolean;
  isDragOver?: boolean;
  isDragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (node.is_dir) {
    const hasChildren = node.children && node.children.length > 0;
    return (
      <div>
        <div
          className="group flex items-center gap-2 px-3 py-2 cursor-pointer transition duration-fast border border-transparent hover:bg-nf-bg-hover hover:text-nf-text text-nf-text-secondary"
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => hasChildren && setExpanded(!expanded)}
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-nf-text-tertiary" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-nf-text-tertiary" />
            )
          ) : (
            <span className="w-3.5 flex-shrink-0" />
          )}
          {expanded ? (
            <FolderOpen className="w-4 h-4 flex-shrink-0 text-fandex-secondary" />
          ) : (
            <Folder className="w-4 h-4 flex-shrink-0 text-fandex-secondary" />
          )}
          <span className="flex-1 text-sm truncate">{node.name}</span>
          <span className="text-[10px] text-nf-text-tertiary">
            {node.children?.length || 0} {t("filelist.itemUnit")}
          </span>
          <button
            onClick={(e) => onRename(node, e)}
            className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto p-1 text-nf-text-tertiary hover:text-fandex-primary transition duration-fast"
          >
            <PenLine className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => onDelete(node, e)}
            className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto p-1 text-nf-text-tertiary hover:text-red-400 transition duration-fast"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        {expanded &&
          node.children?.map((child) => (
            <TreeNodeList
              key={child.relative_path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
              t={t}
              activeFileWordCount={activeFileWordCount}
            />
          ))}
      </div>
    );
  }

  // 文件节点
  const isSelected = selectedPath === node.relative_path;
  return (
    <div
      onClick={() => onSelect(node)}
      style={{ paddingLeft: `${12 + depth * 16}px` }}
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition duration-fast border ${
        isDragging
          ? "opacity-40 border-fandex-primary/40"
          : isDragOver
            ? "border-t-2 border-t-fandex-primary"
            : isSelected
              ? "bg-fandex-primary/10 text-fandex-primary border-fandex-primary"
              : "text-nf-text-secondary hover:bg-nf-bg-hover hover:text-nf-text border-transparent"
      }`}
    >
      {isDraggable && (
        <GripVertical className="w-3.5 h-3.5 flex-shrink-0 text-nf-text-tertiary opacity-0 group-hover:opacity-60 cursor-grab" />
      )}
      {!isDraggable && <span className="w-3.5 flex-shrink-0" />}
      <FileText className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1 text-sm truncate">{node.name}</span>
      <span className="text-xs text-nf-text-tertiary whitespace-nowrap">
        {formatSize(node.size)}
        {isSelected && activeFileWordCount !== undefined && activeFileWordCount > 0 && (
          <span className="ml-1.5 text-fandex-primary">
            {t("filelist.wordCount", { count: activeFileWordCount })}
          </span>
        )}
      </span>
      <button
        onClick={(e) => onRename(node, e)}
        className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto p-1 text-nf-text-tertiary hover:text-fandex-primary transition duration-fast"
      >
        <PenLine className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={(e) => onDelete(node, e)}
        className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto p-1 text-nf-text-tertiary hover:text-red-400 transition duration-fast"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// 递归渲染文件树节点（卡片视图）
function TreeNodeGrid({
  node,
  depth,
  selectedPath,
  onSelect,
  onRename,
  onDelete,
  activeFileWordCount,
  t,
  isDraggable,
  isDragOver,
  isDragging,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (node: FileNode) => void;
  onRename: (node: FileNode, e: React.MouseEvent) => void;
  onDelete: (node: FileNode, e: React.MouseEvent) => void;
  activeFileWordCount?: number;
  t: (key: string, params?: Record<string, string | number>) => string;
  isDraggable?: boolean;
  isDragOver?: boolean;
  isDragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (node.is_dir) {
    const hasChildren = node.children && node.children.length > 0;
    return (
      <div className="col-span-2">
        <div
          className="group flex items-center gap-2 p-2 cursor-pointer hover:bg-nf-bg-hover transition duration-fast border-b border-nf-border-light"
          onClick={() => hasChildren && setExpanded(!expanded)}
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-nf-text-tertiary" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-nf-text-tertiary" />
            )
          ) : (
            <span className="w-3.5 flex-shrink-0" />
          )}
          {expanded ? (
            <FolderOpen className="w-4 h-4 flex-shrink-0 text-fandex-secondary" />
          ) : (
            <Folder className="w-4 h-4 flex-shrink-0 text-fandex-secondary" />
          )}
          <span className="text-xs font-medium text-nf-text truncate">{node.name}</span>
          <span className="text-[10px] text-nf-text-tertiary ml-auto">
            {node.children?.length || 0}
          </span>
          <button
            onClick={(e) => onRename(node, e)}
            className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto p-1 text-nf-text-tertiary hover:text-fandex-primary transition duration-fast"
          >
            <PenLine className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => onDelete(node, e)}
            className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto p-1 text-nf-text-tertiary hover:text-red-400 transition duration-fast"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        {expanded && (
          <div className="grid grid-cols-2 gap-1 bg-nf-bg border border-nf-border-light pl-2">
            {node.children?.map((child) => (
              <TreeNodeGrid
                key={child.relative_path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onRename={onRename}
                onDelete={onDelete}
                activeFileWordCount={activeFileWordCount}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // 文件卡片
  const isSelected = selectedPath === node.relative_path;
  return (
    <div
      onClick={() => onSelect(node)}
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group relative p-3 cursor-pointer transition duration-fast bg-nf-bg ${
        isDragging
          ? "opacity-40 ring-1 ring-fandex-primary/40"
          : isDragOver
            ? "ring-t-2 ring-t-fandex-primary"
            : isSelected
              ? "bg-fandex-primary/10 border-fandex-primary"
              : "hover:bg-nf-bg-hover"
      }`}
    >
      {isDraggable && (
        <GripVertical className="w-3.5 h-3.5 absolute top-1 left-1 text-nf-text-tertiary opacity-0 group-hover:opacity-60 cursor-grab" />
      )}
      <FileText className="w-5 h-5 text-fandex-primary mb-2" />
      <div className="text-xs font-medium font-display text-nf-text truncate">
        {node.name}
      </div>
      <div className="text-[10px] text-nf-text-tertiary mt-1">
        {formatSize(node.size)}
        {isSelected && activeFileWordCount !== undefined && activeFileWordCount > 0 && (
          <span className="ml-1 text-fandex-primary">
            {t("filelist.wordCount", { count: activeFileWordCount })}
          </span>
        )}
      </div>
      <button
        onClick={(e) => onRename(node, e)}
        className="absolute top-2 right-8 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto p-1 text-nf-text-tertiary hover:text-fandex-primary transition duration-fast"
      >
        <PenLine className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={(e) => onDelete(node, e)}
        className="absolute top-2 right-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto p-1 text-nf-text-tertiary hover:text-red-400 transition duration-fast"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function FileList({ onCreateFile, onSelectFile }: FileListProps) {
  const projectTree = useAppStore((s) => s.projectTree);
  const activeCategory = useAppStore((s) => s.activeCategory);
  const selectedFile = useAppStore((s) => s.selectedFile);
  const setSelectedFile = useAppStore((s) => s.setSelectedFile);
  const activeFileWordCount = useAppStore((s) => s.activeFileWordCount);
  const { t } = useI18n();
  const { showToast } = useToast();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [deleteTarget, setDeleteTarget] = useState<FileNode | null>(null);
  const [renameTarget, setRenameTarget] = useState<FileNode | null>(null);

  // 拖拽排序状态（仅正文分类有效）
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isRenumbering, setIsRenumbering] = useState(false);

  // 文件选择：优先使用外部传入的保存后切换回调
  const handleFileSelect = onSelectFile || setSelectedFile;

  const dirName = getCategoryDir(activeCategory);
  const isManuscript = activeCategory === "manuscript";

  const children = useMemo(() => {
    const dir = findDirByName(projectTree, dirName);
    const items = dir?.children ? [...dir.children] : [];
    // 正文分类按章节序号自动排序
    if (isManuscript) {
      items.sort(
        (a, b) => extractChapterNumber(a.name) - extractChapterNumber(b.name)
      );
    }
    return items;
  }, [projectTree, dirName, isManuscript]);

  // ── 拖拽排序处理 ──
  const handleDragStart = useCallback((index: number) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback((targetIndex: number) => async (e: React.DragEvent) => {
    e.preventDefault();
    const sourceIndex = dragIndex;
    setDragIndex(null);
    setDragOverIndex(null);

    if (sourceIndex === null || sourceIndex === targetIndex) return;
    if (!isManuscript) return;

    // 构建新顺序
    const newOrder = [...children];
    const [moved] = newOrder.splice(sourceIndex, 1);
    newOrder.splice(targetIndex, 0, moved);

    // 批量重命名：按新顺序重新编号
    const { currentProject } = useAppStore.getState();
    if (!currentProject) return;

    setIsRenumbering(true);
    try {
      // 先全部改为临时名称（避免名称冲突）
      const tempNames: string[] = [];
      for (let i = 0; i < newOrder.length; i++) {
        const node = newOrder[i];
        if (node.is_dir) continue;
        const cleanName = stripNumberPrefix(node.name);
        const tempName = `__tmp_${i}_${cleanName}.txt`;
        const dirPath = node.relative_path.substring(0, node.relative_path.lastIndexOf("/") + 1);
        const newRelPath = dirPath + tempName;
        await renamePath(currentProject.path, node.relative_path, newRelPath);
        tempNames.push(newRelPath);
      }

      // 再从临时名称改为正式编号名称
      let fileIdx = 0;
      for (let i = 0; i < newOrder.length; i++) {
        const node = newOrder[i];
        if (node.is_dir) continue;
        const cleanName = stripNumberPrefix(node.name);
        const newName = `${i + 1}.${cleanName}.txt`;
        const dirPath = node.relative_path.substring(0, node.relative_path.lastIndexOf("/") + 1);
        const newRelPath = dirPath + newName;
        await renamePath(currentProject.path, tempNames[fileIdx], newRelPath);
        fileIdx++;
      }

      // 刷新项目树
      const tree = await readProjectTree(currentProject.path);
      useAppStore.getState().setProjectTree(tree);
      showToast("success", t("filelist.renumbered"));
    } catch (e) {
      showToast("error", t("filelist.renameFailed", { error: String(e) }));
      // 刷新以恢复正确状态
      const tree = await readProjectTree(currentProject.path);
      useAppStore.getState().setProjectTree(tree);
    } finally {
      setIsRenumbering(false);
    }
  }, [dragIndex, children, isManuscript, showToast, t]);

  // ── 批量重编号 ──
  const handleBatchRenumber = useCallback(async () => {
    if (!isManuscript || children.length === 0) return;
    const { currentProject } = useAppStore.getState();
    if (!currentProject) return;

    setIsRenumbering(true);
    try {
      // 先全部改为临时名称
      const tempNames: string[] = [];
      for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (node.is_dir) continue;
        const cleanName = stripNumberPrefix(node.name);
        const tempName = `__tmp_${i}_${cleanName}.txt`;
        const dirPath = node.relative_path.substring(0, node.relative_path.lastIndexOf("/") + 1);
        const newRelPath = dirPath + tempName;
        await renamePath(currentProject.path, node.relative_path, newRelPath);
        tempNames.push(newRelPath);
      }

      // 再从临时名称改为正式编号名称
      let fileIdx = 0;
      for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (node.is_dir) continue;
        const cleanName = stripNumberPrefix(node.name);
        const newName = `${i + 1}.${cleanName}.txt`;
        const dirPath = node.relative_path.substring(0, node.relative_path.lastIndexOf("/") + 1);
        const newRelPath = dirPath + newName;
        await renamePath(currentProject.path, tempNames[fileIdx], newRelPath);
        fileIdx++;
      }

      const tree = await readProjectTree(currentProject.path);
      useAppStore.getState().setProjectTree(tree);
      showToast("success", t("filelist.renumbered"));
    } catch (e) {
      showToast("error", t("filelist.renameFailed", { error: String(e) }));
      const tree = await readProjectTree(currentProject.path);
      useAppStore.getState().setProjectTree(tree);
    } finally {
      setIsRenumbering(false);
    }
  }, [isManuscript, children, showToast, t]);

  const handleDelete = (node: FileNode, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget(node);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const node = deleteTarget;
    setDeleteTarget(null);
    const { currentProject } = useAppStore.getState();
    if (!currentProject) return;
    const fullPath = `${currentProject.path}/${node.relative_path}`;
    try {
      await deletePath(fullPath, currentProject.path);
      showToast("success", t("filelist.deleted", { name: node.name }));
      const tree = await readProjectTree(currentProject.path);
      useAppStore.getState().setProjectTree(tree);
      // 如果删除的是当前选中文件，清除选中状态
      if (useAppStore.getState().selectedFile?.relative_path === node.relative_path) {
        useAppStore.getState().setSelectedFile(null);
      }
    } catch (e) {
      showToast("error", t("filelist.deleteFailed", { error: String(e) }));
    }
  };

  const handleRename = (node: FileNode, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameTarget(node);
  };

  const handleRenameConfirm = async (newName?: string) => {
    const node = renameTarget;
    setRenameTarget(null);
    if (!node || !newName || newName === node.name) return;
    if (!isValidFileName(newName)) {
      showToast("error", t("filelist.invalidChars"));
      return;
    }
    const { currentProject } = useAppStore.getState();
    if (!currentProject) return;
    // 文件确保 .txt 扩展名，目录不添加扩展名
    const ensuredName = node.is_dir
      ? newName
      : (newName.endsWith(".txt") ? newName : `${newName}.txt`);
    const dirPath = node.relative_path.substring(
      0,
      node.relative_path.lastIndexOf("/") + 1
    );
    const newRelPath = dirPath + ensuredName;
    try {
      await renamePath(currentProject.path, node.relative_path, newRelPath);
      showToast("success", t("filelist.renamed", { name: ensuredName }));
      const tree = await readProjectTree(currentProject.path);
      useAppStore.getState().setProjectTree(tree);
    } catch (e) {
      showToast("error", t("filelist.renameFailed", { error: String(e) }));
    }
  };

  // 判断某个文件节点是否正在被拖拽或作为拖拽目标
  const getFileDragProps = (node: FileNode, index: number) => {
    if (!isManuscript || node.is_dir) return {};
    return {
      isDraggable: true,
      isDragOver: dragOverIndex === index,
      isDragging: dragIndex === index,
      onDragStart: handleDragStart(index),
      onDragOver: handleDragOver(index),
      onDragLeave: handleDragLeave,
      onDrop: handleDrop(index),
    };
  };

  return (
    <div className="w-72 min-w-[260px] border-l border-nf-border-light bg-nf-bg flex flex-col">
      {/* 顶部: 标题与视图切换 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-nf-border-light">
        <h2 className="fandex-bar-left text-sm font-bold font-display text-nf-text">
          {dirName}
        </h2>
        <div className="flex items-center gap-1">
          {isManuscript && (
            <>
              <button
                onClick={onCreateFile}
                className="flex items-center gap-1 px-2 py-1 text-xs text-fandex-primary border border-fandex-primary hover:bg-fandex-primary/10 transition duration-fast"
                title={t("filelist.newChapter")}
              >
                <FilePlus className="w-3.5 h-3.5" />
                <span>{t("filelist.newChapter")}</span>
              </button>
              <button
                onClick={handleBatchRenumber}
                disabled={isRenumbering || children.filter(c => !c.is_dir).length < 2}
                className="flex items-center gap-1 px-2 py-1 text-xs text-nf-text-secondary border border-nf-border-light hover:border-fandex-secondary/60 hover:text-fandex-secondary transition duration-fast disabled:opacity-40 disabled:cursor-not-allowed"
                title={t("filelist.batchRenumber")}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRenumbering ? "animate-spin" : ""}`} />
              </button>
            </>
          )}
          <button
            onClick={() => setViewMode("grid")}
            className={`p-1.5 transition duration-fast border ${
              viewMode === "grid"
                ? "text-fandex-primary bg-fandex-primary/10 border-fandex-primary"
                : "text-nf-text-tertiary hover:text-nf-text border-transparent hover:border-nf-border-light"
            }`}
            title={t("filelist.gridView")}
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-1.5 transition duration-fast border ${
              viewMode === "list"
                ? "text-fandex-primary bg-fandex-primary/10 border-fandex-primary"
                : "text-nf-text-tertiary hover:text-nf-text border-transparent hover:border-nf-border-light"
            }`}
            title={t("filelist.listView")}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 文件列表区域 */}
      <div className="flex-1 overflow-y-auto p-3">
        {children.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <FileText className="w-12 h-12 text-nf-border mb-3" />
            <p className="text-sm text-nf-text-tertiary mb-3">{t("filelist.empty")}</p>
            <button
              onClick={onCreateFile}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-fandex-primary border border-fandex-primary hover:bg-fandex-primary/10 transition duration-fast"
            >
              <FilePlus className="w-4 h-4" />
              {t("filelist.createFirst")}
            </button>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-2 gap-1 bg-nf-border-light border border-nf-border-light">
            {children.map((node, index) => (
              <TreeNodeGrid
                key={node.relative_path}
                node={node}
                depth={0}
                selectedPath={selectedFile?.relative_path ?? null}
                onSelect={handleFileSelect}
                onRename={handleRename}
                onDelete={handleDelete}
                activeFileWordCount={activeFileWordCount}
                t={t}
                {...getFileDragProps(node, index)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {children.map((node, index) => (
              <TreeNodeList
                key={node.relative_path}
                node={node}
                depth={0}
                selectedPath={selectedFile?.relative_path ?? null}
                onSelect={handleFileSelect}
                onRename={handleRename}
                onDelete={handleDelete}
                t={t}
                activeFileWordCount={activeFileWordCount}
                {...getFileDragProps(node, index)}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        type="danger"
        title={t("app.delete")}
        message={t("filelist.confirmDelete", { name: deleteTarget?.name || "" })}
        confirmLabel={t("app.delete")}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={!!renameTarget}
        type="prompt"
        title={t("app.rename")}
        message={t("filelist.renamePrompt")}
        defaultValue={renameTarget?.name || ""}
        onConfirm={handleRenameConfirm}
        onCancel={() => setRenameTarget(null)}
      />
    </div>
  );
}
