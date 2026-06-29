// 右侧文件列表组件（支持子文件夹展开/折叠）
//
// 功能概述：
// 显示当前分类下的文件列表，支持卡片视图与列表视图切换，
// 支持子文件夹展开/折叠导航。
// 采用 FANDEX 美术风格：直角、左侧色条标题、1px 边框。
//
// 模块职责：
// 1. 从项目目录树中过滤当前分类的文件
// 2. 渲染卡片网格或列表（含子文件夹展开/折叠）
// 3. 处理文件选择、重命名与删除

import { useState, useMemo } from "react";
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
} from "lucide-react";
import { useAppStore, CATEGORY_DIRS, type SidebarCategory } from "../lib/store";
import type { FileNode } from "../lib/api";
import { deletePath, readProjectTree, renamePath } from "../lib/api";
import { findDirByName, isValidFileName } from "../lib/fileTreeUtils";
import { useI18n } from "../lib/i18n";

interface FileListProps {
  onCreateFile: () => void;
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
}: {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (node: FileNode) => void;
  onRename: (node: FileNode, e: React.MouseEvent) => void;
  onDelete: (node: FileNode, e: React.MouseEvent) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  activeFileWordCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  if (node.is_dir) {
    const hasChildren = node.children && node.children.length > 0;
    return (
      <div>
        <div
          className="group flex items-center gap-2 px-3 py-2 cursor-pointer transition-fast border border-transparent hover:bg-nf-bg-hover hover:text-nf-text text-nf-text-secondary"
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
      className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-fast border ${
        isSelected
          ? "bg-fandex-primary/10 text-fandex-primary border-fandex-primary"
          : "text-nf-text-secondary hover:bg-nf-bg-hover hover:text-nf-text border-transparent"
      }`}
    >
      <span className="w-3.5 flex-shrink-0" />
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
        className="opacity-0 group-hover:opacity-100 p-1 text-nf-text-tertiary hover:text-fandex-primary transition-fast"
      >
        <PenLine className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={(e) => onDelete(node, e)}
        className="opacity-0 group-hover:opacity-100 p-1 text-nf-text-tertiary hover:text-red-400 transition-fast"
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
}: {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (node: FileNode) => void;
  onRename: (node: FileNode, e: React.MouseEvent) => void;
  onDelete: (node: FileNode, e: React.MouseEvent) => void;
  activeFileWordCount?: number;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (node.is_dir) {
    const hasChildren = node.children && node.children.length > 0;
    return (
      <div className="col-span-2">
        <div
          className="flex items-center gap-2 p-2 cursor-pointer hover:bg-nf-bg-hover transition-fast border-b border-nf-border-light"
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
        </div>
        {expanded && (
          <div className="grid grid-cols-2 gap-1 bg-nf-border-light border border-nf-border-light pl-2">
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
      className={`group relative p-3 cursor-pointer transition-fast bg-nf-bg ${
        isSelected
          ? "bg-fandex-primary/10 border-fandex-primary"
          : "hover:bg-nf-bg-hover"
      }`}
    >
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
        className="absolute top-2 right-8 opacity-0 group-hover:opacity-100 p-1 text-nf-text-tertiary hover:text-fandex-primary transition-fast"
      >
        <PenLine className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={(e) => onDelete(node, e)}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-nf-text-tertiary hover:text-red-400 transition-fast"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function FileList({ onCreateFile }: FileListProps) {
  const { projectTree, activeCategory, selectedFile, setSelectedFile, activeFileWordCount } =
    useAppStore();
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const dirName = CATEGORY_DIRS[activeCategory as SidebarCategory];

  const children = useMemo(() => {
    const dir = findDirByName(projectTree, dirName);
    return dir?.children || [];
  }, [projectTree, dirName]);

  const handleDelete = async (node: FileNode, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(t("filelist.confirmDelete", { name: node.name }))) {
      const { currentProject } = useAppStore.getState();
      if (!currentProject) return;
      const fullPath = `${currentProject.path}\\${node.relative_path}`;
      try {
        await deletePath(fullPath);
        const tree = await readProjectTree(currentProject.path);
        useAppStore.getState().setProjectTree(tree);
      } catch (e) {
        alert(t("filelist.deleteFailed", { error: String(e) }));
      }
    }
  };

  const handleRename = async (node: FileNode, e: React.MouseEvent) => {
    e.stopPropagation();
    const { currentProject } = useAppStore.getState();
    if (!currentProject) return;
    const newName = prompt(t("filelist.renamePrompt"), node.name);
    if (!newName || newName === node.name) return;
    if (!isValidFileName(newName)) {
      alert(t("filelist.invalidChars"));
      return;
    }
    const dirPath = node.relative_path.substring(
      0,
      node.relative_path.lastIndexOf("/") + 1
    );
    const newRelPath = dirPath + newName;
    try {
      await renamePath(currentProject.path, node.relative_path, newRelPath);
      const tree = await readProjectTree(currentProject.path);
      useAppStore.getState().setProjectTree(tree);
    } catch (e) {
      alert(t("filelist.renameFailed", { error: String(e) }));
    }
  };

  const hasFiles = children.some((n) => !n.is_dir);
  const hasDirs = children.some((n) => n.is_dir);

  return (
    <div className="w-72 min-w-[260px] border-l border-nf-border-light bg-nf-bg flex flex-col">
      {/* 顶部: 标题与视图切换 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-nf-border-light">
        <h2 className="fandex-bar-left text-sm font-bold font-display text-nf-text">
          {dirName}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode("grid")}
            className={`p-1.5 transition-fast border ${
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
            className={`p-1.5 transition-fast border ${
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-fandex-primary border border-fandex-primary hover:bg-fandex-primary/10 transition-fast"
            >
              <FilePlus className="w-4 h-4" />
              {t("filelist.createFirst")}
            </button>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-2 gap-1 bg-nf-border-light border border-nf-border-light">
            {children.map((node) => (
              <TreeNodeGrid
                key={node.relative_path}
                node={node}
                depth={0}
                selectedPath={selectedFile?.relative_path ?? null}
                onSelect={setSelectedFile}
                onRename={handleRename}
                onDelete={handleDelete}
                activeFileWordCount={activeFileWordCount}
                t={t}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {children.map((node) => (
              <TreeNodeList
                key={node.relative_path}
                node={node}
                depth={0}
                selectedPath={selectedFile?.relative_path ?? null}
                onSelect={setSelectedFile}
                onRename={handleRename}
                onDelete={handleDelete}
                t={t}
                activeFileWordCount={activeFileWordCount}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
