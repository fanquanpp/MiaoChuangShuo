// 右侧文件列表组件（支持子文件夹展开/折叠）
//
// 功能概述：
// 显示当前分类下的文件列表，支持卡片视图与列表视图切换，
// 支持子文件夹展开/折叠导航。
// 正文分类支持拖拽排序（拖拽后自动按新顺序重新编号）。
// 采用 FANDEX 美术风格：直角、左侧色条标题、1px 边框。
//
// 模块职责：
// 1. 从项目目录树中过滤当前分类的文件
// 2. 渲染卡片网格或列表（含子文件夹展开/折叠）
// 3. 处理文件选择、重命名与删除
// 4. 正文分类拖拽排序（拖拽后自动重新编号）

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
  ListTree,
  BookCopy,
  Copy,
  ClipboardCopy,
  Files,
} from "lucide-react";
import { useAppStore, getCategoryDir } from "../lib/store";
import type { FileNode } from "../lib/api";
import { deletePath, readProjectTree, renamePath, copyFile, removeFileIndex, updateFileIndex } from "../lib/api";
import { findDirByName, isValidFileName } from "../lib/fileTreeUtils";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { useSettingsStore, toChineseNumber, type ChapterFormat } from "../lib/settingsStore";
import { useUILayoutStore } from "../lib/uiStore";
import ConfirmDialog from "./ConfirmDialog";
import OutlineToChapters from "./OutlineToChapters";
import VolumeChapterGenerator from "./VolumeChapterGenerator";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";

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
// 排序规则：
//   - 序章/楔子/引子/前言/引言/卷首语 → 排在最前面（返回 -2）
//   - 正文章节（第N章/Chapter N/N.标题） → 按序号升序
//   - 续章/尾声/后记/番外/终章/卷尾语 → 排在最后（返回 Infinity）
// 卷首语/卷尾语纳入分卷目录排序逻辑，确保卷首语始终在顶部、卷尾语始终在底部
function extractChapterNumber(name: string): number {
  // 去除扩展名后的小写基准名，用于关键词匹配
  const base = name.replace(/\.txt$/i, "").trim().toLowerCase();
  // 序章类与卷首语前置于所有章节之前
  const prologueKeywords = ["序章", "楔子", "引子", "前言", "引言", "卷首语", "prologue", "preface"];
  if (prologueKeywords.some((kw) => base === kw || base.startsWith(kw))) {
    return -2;
  }
  // 续章/尾声/后记/番外/终章/卷尾语 排在所有正文章节之后
  const epilogueKeywords = ["续章", "尾声", "后记", "番外", "终章", "卷尾语", "epilogue", "afterword"];
  if (epilogueKeywords.some((kw) => base === kw || base.startsWith(kw))) {
    return Infinity;
  }
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
  return Infinity; // 非章节文件排在最后
}

// 从文件名中去除编号前缀，保留纯名称
function stripNumberPrefix(name: string): string {
  return name
    .replace(/^\d+[._\-\s]*/, "")
    .replace(/\.txt$/i, "")
    .trim();
}

/**
 * 将物理文件名转换为用户友好的显示标题
 * 三段式章节元数据解耦：物理文件名 / 显示标题 / 章号
 *
 * 转换规则：
 *   - "1.开端.txt" → "开端"（去除数字前缀和扩展名）
 *   - "第一章 开端.txt" → "第一章 开端"（仅去除扩展名，保留章节号前缀）
 *   - "序章.txt" → "序章"
 *   - "角色档案.txt" → "角色档案"
 *
 * 输入: name 物理文件名（含扩展名）
 * 输出: string 用户友好的显示标题
 */
function getDisplayTitle(name: string): string {
  // 去除扩展名
  let title = name.replace(/\.txt$/i, "").trim();
  // 去除阿拉伯数字前缀（如 "1." / "1_" / "1-" / "1 "）
  // 仅当文件名以 "数字.标题" 格式开头时去除，保留 "第一章" 等中文格式前缀
  title = title.replace(/^\d+[._\-\s]+/, "").trim();
  // 如果去除后为空（如文件名就是 "1.txt"），回退到原始名去扩展名
  if (!title) {
    title = name.replace(/\.txt$/i, "").trim();
  }
  return title;
}

/**
 * 正文分类专用:将物理文件名转换为带章节编号的显示标题
 * 根据 chapterFormat 设置,将 "N.标题.txt" 转换为 "第N章 标题" / "01 标题" / "Chapter N 标题"
 *
 * 输入:
 *   name 物理文件名(含扩展名,如 "1.开端.txt")
 *   chapterFormat 章节标题格式(chinese/arabic/english)
 *   autoNumbering 是否开启自动编号
 * 输出:
 *   带章节编号的显示标题(如 "第一章 开端")
 *   若文件名不含 N. 前缀或未开启自动编号,回退到 getDisplayTitle
 */
function formatManuscriptTitle(
  name: string,
  chapterFormat: ChapterFormat,
  autoNumbering: boolean
): string {
  // 去除扩展名
  const baseName = name.replace(/\.txt$/i, "").trim();
  // 匹配 "N.标题" / "N_标题" / "N-标题" / "N 标题" 格式
  const match = baseName.match(/^(\d+)[._\-\s]+(.+)/);
  if (match && autoNumbering) {
    const num = parseInt(match[1], 10);
    const pureTitle = match[2].trim();
    switch (chapterFormat) {
      case "chinese":
        return pureTitle
          ? `第${toChineseNumber(num)}章 ${pureTitle}`
          : `第${toChineseNumber(num)}章`;
      case "arabic":
        return pureTitle
          ? `${String(num).padStart(2, "0")} ${pureTitle}`
          : String(num).padStart(2, "0");
      case "english":
        return pureTitle
          ? `Chapter ${num} ${pureTitle}`
          : `Chapter ${num}`;
      default:
        return pureTitle
          ? `第${toChineseNumber(num)}章 ${pureTitle}`
          : `第${toChineseNumber(num)}章`;
    }
  }
  // 非编号格式或未开启自动编号:回退到普通显示(去除数字前缀)
  return baseName.replace(/^\d+[._\-\s]+/, "").trim() || baseName;
}

// 递归渲染文件树节点（列表视图）
function TreeNodeList({
  node,
  depth,
  selectedPath,
  onSelect,
  onRename,
  onDelete,
  onContextMenu,
  t,
  activeFileWordCount,
  isDraggable,
  isDragOver,
  isDragging,
  isManuscript,
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
  onContextMenu: (node: FileNode, e: React.MouseEvent) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  activeFileWordCount?: number;
  isDraggable?: boolean;
  isDragOver?: boolean;
  isDragging?: boolean;
  isManuscript?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // 正文分类:读取章节格式设置,用于显示"第N章 标题"
  const chapterFormat = useSettingsStore((s) => s.chapterFormat);
  const autoNumbering = useSettingsStore((s) => s.autoNumbering);

  if (node.is_dir) {
    const hasChildren = node.children && node.children.length > 0;
    return (
      <div>
        <div
          className="group flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer transition duration-fast border border-transparent hover:bg-nf-bg-hover hover:text-nf-text text-nf-text-secondary"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => hasChildren && setExpanded(!expanded)}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(node, e); }}
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
          <span className="flex-1 text-sm truncate">{getDisplayTitle(node.name)}</span>
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
        {expanded && node.children && (
          // 正文分类: 按 extractChapterNumber 排序(卷首语 -2 → 正文章节按数值 → 卷尾语 Infinity)
          // 非正文分类: 保持原始顺序
          (isManuscript
            ? [...node.children].sort(
                (a, b) => extractChapterNumber(a.name) - extractChapterNumber(b.name)
              )
            : node.children
          ).map((child) => (
            <TreeNodeList
              key={child.relative_path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
              onContextMenu={onContextMenu}
              t={t}
              activeFileWordCount={activeFileWordCount}
              isManuscript={isManuscript}
            />
          ))
        )}
      </div>
    );
  }

  // 文件节点
  const isSelected = selectedPath === node.relative_path;
  const displayTitle = isManuscript
    ? formatManuscriptTitle(node.name, chapterFormat, autoNumbering)
    : getDisplayTitle(node.name);
  return (
    <div
      onClick={() => onSelect(node)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(node, e); }}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group relative flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer transition duration-fast border ${
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
      {!isDraggable && <span className="w-3 flex-shrink-0" />}
      <FileText className="w-4 h-4 flex-shrink-0" />
      {/* 章节名称:单行显示,超出用省略号截断,释放横向空间给文件名 */}
      <span
        className="flex-1 min-w-0 text-sm truncate leading-snug"
        title={displayTitle}
      >
        {displayTitle}
      </span>
      {/* 右侧悬浮层:尺寸+操作按钮,默认隐藏,悬浮时覆盖显示,避免占用文件名横向空间 */}
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto transition-opacity duration-fast bg-nf-bg/85 backdrop-blur-sm pl-3">
        <span className="text-[10px] text-nf-text-tertiary whitespace-nowrap">
          {formatSize(node.size)}
          {isSelected && activeFileWordCount !== undefined && activeFileWordCount > 0 && (
            <span className="ml-1 text-fandex-primary">
              {t("filelist.wordCount", { count: activeFileWordCount })}
            </span>
          )}
        </span>
        <button
          onClick={(e) => onRename(node, e)}
          className="p-1 text-nf-text-tertiary hover:text-fandex-primary transition duration-fast"
        >
          <PenLine className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => onDelete(node, e)}
          className="p-1 text-nf-text-tertiary hover:text-red-400 transition duration-fast"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
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
  onContextMenu,
  activeFileWordCount,
  t,
  isDraggable,
  isDragOver,
  isDragging,
  isManuscript,
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
  onContextMenu: (node: FileNode, e: React.MouseEvent) => void;
  activeFileWordCount?: number;
  t: (key: string, params?: Record<string, string | number>) => string;
  isDraggable?: boolean;
  isDragOver?: boolean;
  isDragging?: boolean;
  isManuscript?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // 正文分类:读取章节格式设置,用于显示"第N章 标题"
  const chapterFormat = useSettingsStore((s) => s.chapterFormat);
  const autoNumbering = useSettingsStore((s) => s.autoNumbering);

  if (node.is_dir) {
    const hasChildren = node.children && node.children.length > 0;
    return (
      <div className="col-span-2">
        <div
          className="group flex items-center gap-2 p-2 cursor-pointer hover:bg-nf-bg-hover transition duration-fast border-b border-nf-border-light"
          onClick={() => hasChildren && setExpanded(!expanded)}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(node, e); }}
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
          <span className="text-xs font-medium text-nf-text truncate">{getDisplayTitle(node.name)}</span>
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
        {expanded && node.children && (
          <div className="grid grid-cols-2 gap-1 bg-nf-bg border border-nf-border-light pl-2">
            {/* 正文分类: 按 extractChapterNumber 排序(卷首语 -2 → 正文章节按数值 → 卷尾语 Infinity) */}
            {/* 非正文分类: 保持原始顺序 */}
            {(isManuscript
              ? [...node.children].sort(
                  (a, b) => extractChapterNumber(a.name) - extractChapterNumber(b.name)
                )
              : node.children
            ).map((child) => (
              <TreeNodeGrid
                key={child.relative_path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onRename={onRename}
                onDelete={onDelete}
                onContextMenu={onContextMenu}
                activeFileWordCount={activeFileWordCount}
                t={t}
                isManuscript={isManuscript}
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
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(node, e); }}
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`nf-card-sheen nf-hover-float group relative p-3 cursor-pointer overflow-hidden border border-nf-border-light/50 transition-all duration-base ${
        isDragging
          ? "opacity-40 ring-1 ring-fandex-primary/40"
          : isDragOver
            ? "ring-2 ring-fandex-primary ring-inset"
            : isSelected
              ? "bg-fandex-primary/10 border-fandex-primary/60 shadow-lg shadow-fandex-primary/10"
              : "bg-nf-bg-card hover:border-fandex-primary/40 hover:shadow-md hover:shadow-black/30 hover:-translate-y-0.5"
      }`}
      style={!isSelected && !isDragging && !isDragOver ? { backgroundColor: 'var(--fandex-bg-card)' } : undefined}
    >
      {/* 背景点阵装饰:呼应项目卡片质感,极低透明度不影响文字 */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.4] group-hover:opacity-[0.7] transition-opacity duration-500"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(124, 158, 255, 0.06) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
        }}
      />
      {isDraggable && (
        <GripVertical className="w-3.5 h-3.5 absolute top-1 left-1 text-nf-text-tertiary opacity-0 group-hover:opacity-60 cursor-grab z-10" />
      )}
      <FileText className="w-5 h-5 text-fandex-primary mb-2 relative z-[1]" />
      <div className="text-xs font-medium font-display text-nf-text truncate relative z-[1]">
        {isManuscript
          ? formatManuscriptTitle(node.name, chapterFormat, autoNumbering)
          : getDisplayTitle(node.name)}
      </div>
      <div className="text-[10px] text-nf-text-tertiary mt-1 relative z-[1]">
        {formatSize(node.size)}
        {isSelected && activeFileWordCount !== undefined && activeFileWordCount > 0 && (
          <span className="ml-1 text-fandex-primary">
            {t("filelist.wordCount", { count: activeFileWordCount })}
          </span>
        )}
      </div>
      <button
        onClick={(e) => onRename(node, e)}
        className="absolute top-2 right-8 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto p-1 text-nf-text-tertiary hover:text-fandex-primary transition duration-fast z-10"
      >
        <PenLine className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={(e) => onDelete(node, e)}
        className="absolute top-2 right-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto p-1 text-nf-text-tertiary hover:text-red-400 transition duration-fast z-10"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      {/* 底部进度条装饰:悬停时显现,呼应项目卡片美术 */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-fandex-primary via-fandex-secondary to-fandex-tertiary opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
    </div>
  );
}

/**
 * 右侧文件列表组件
 * 输入:
 *   onCreateFile 新建文件回调
 *   onSelectFile 文件选择回调（可选）
 * 输出: JSX 文件列表界面（卡片视图或列表视图）
 * 流程:
 *   1. 从全局 store 读取项目目录树与当前分类
 *   2. 通过 findDirByName 定位分类目录，过滤 .txt 文件
 *   3. 渲染卡片网格或列表视图（支持子文件夹展开/折叠）
 *   4. 处理文件操作：选择、重命名（含非法字符校验）、删除（带确认）
 *   5. 正文分类特殊功能：拖拽排序、批量重编号
 *   6. 视图切换：卡片/列表，记忆用户偏好
 */
export default function FileList({ onCreateFile, onSelectFile }: FileListProps) {
  const projectTree = useAppStore((s) => s.projectTree);
  const activeCategory = useAppStore((s) => s.activeCategory);
  const selectedFile = useAppStore((s) => s.selectedFile);
  const setSelectedFile = useAppStore((s) => s.setSelectedFile);
  const activeFileWordCount = useAppStore((s) => s.activeFileWordCount);
  const currentProject = useAppStore((s) => s.currentProject);
  const { t } = useI18n();
  const { showToast } = useToast();
  // 文件列表视图模式：从持久化 store 读取，保留用户上次选择
  const fileListViewMode = useUILayoutStore((s) => s.fileListViewMode);
  const setFileListViewMode = useUILayoutStore((s) => s.setFileListViewMode);
  const viewMode = fileListViewMode;
  const setViewMode = setFileListViewMode;
  const [deleteTarget, setDeleteTarget] = useState<FileNode | null>(null);
  const [renameTarget, setRenameTarget] = useState<FileNode | null>(null);
  // 右键上下文菜单状态
  const [ctxMenu, setCtxMenu] = useState<{ open: boolean; x: number; y: number; node: FileNode | null }>({
    open: false, x: 0, y: 0, node: null,
  });

  // 拖拽排序状态（仅正文分类有效）
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // 大纲生成章节对话框状态（仅正文分类有效）
  const [showOutlineToChapters, setShowOutlineToChapters] = useState(false);
  const [showVolumeGenerator, setShowVolumeGenerator] = useState(false);

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
    }
  }, [dragIndex, children, isManuscript, showToast, t]);

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
      // Sprint 4 任务 4.4：文件删除后清理 Tantivy 索引（静默执行）
      // 仅对文件操作（目录不索引），同时清理 .txt 与 .pmd 两种路径避免残留
      if (!node.is_dir) {
        removeFileIndex(currentProject.path, node.relative_path).catch((err) => {
          console.error("清理索引失败:", err);
        });
        // 若为 .txt 文件，同时清理可能存在的 .pmd 路径索引
        if (node.relative_path.toLowerCase().endsWith(".txt")) {
          const pmdRelPath = node.relative_path.replace(/\.txt$/i, ".pmd");
          if (pmdRelPath !== node.relative_path) {
            removeFileIndex(currentProject.path, pmdRelPath).catch((err) => {
              console.error("清理 .pmd 索引失败:", err);
            });
          }
        }
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
      // Sprint 4 任务 4.4：文件重命名后更新 Tantivy 索引（静默执行）
      // 策略：先清理旧路径索引（.txt 与 .pmd），再异步触发新路径索引构建
      if (!node.is_dir) {
        // 清理旧路径索引
        removeFileIndex(currentProject.path, node.relative_path).catch((err) => {
          console.error("清理旧路径索引失败:", err);
        });
        if (node.relative_path.toLowerCase().endsWith(".txt")) {
          const oldPmdPath = node.relative_path.replace(/\.txt$/i, ".pmd");
          if (oldPmdPath !== node.relative_path) {
            removeFileIndex(currentProject.path, oldPmdPath).catch((err) => {
              console.error("清理旧 .pmd 索引失败:", err);
            });
          }
        }
        // 异步触发新路径索引构建（文件可能为 .pmd 格式）
        const newPmdPath = newRelPath.replace(/\.txt$/i, ".pmd");
        updateFileIndex(currentProject.path, newPmdPath).catch((err) => {
          console.error("更新新路径索引失败:", err);
        });
      }
    } catch (e) {
      showToast("error", t("filelist.renameFailed", { error: String(e) }));
    }
  };

  // 右键菜单触发：记录坐标与目标节点
  const handleContextMenu = useCallback((node: FileNode, e: React.MouseEvent) => {
    setCtxMenu({ open: true, x: e.clientX, y: e.clientY, node });
  }, []);

  // 创建文件副本：在同级目录下生成 副本_ 前缀的同名文件
  const handleDuplicate = useCallback(async () => {
    const node = ctxMenu.node;
    setCtxMenu((prev) => ({ ...prev, open: false }));
    if (!node || node.is_dir || !currentProject) return;
    const dirPath = node.relative_path.substring(0, node.relative_path.lastIndexOf("/") + 1);
    const baseName = node.name.replace(/\.txt$/i, "");
    const newName = `${t("filelist.copyPrefix")}${baseName}.txt`;
    const newRelPath = dirPath + newName;
    try {
      await copyFile(currentProject.path, node.relative_path, newRelPath);
      showToast("success", t("ctxmenu.duplicated", { name: newName }));
      const tree = await readProjectTree(currentProject.path);
      useAppStore.getState().setProjectTree(tree);
    } catch (e) {
      showToast("error", t("ctxmenu.duplicateFailed", { error: String(e) }));
    }
  }, [ctxMenu.node, currentProject, showToast, t]);

  // 复制文件完整路径到剪贴板
  const handleCopyPath = useCallback(async () => {
    const node = ctxMenu.node;
    setCtxMenu((prev) => ({ ...prev, open: false }));
    if (!node || !currentProject) return;
    const fullPath = `${currentProject.path}/${node.relative_path}`;
    try {
      await navigator.clipboard.writeText(fullPath);
      showToast("success", t("ctxmenu.pathCopied"));
    } catch {
      showToast("error", t("ctxmenu.copyFailed"));
    }
  }, [ctxMenu.node, currentProject, showToast, t]);

  // 复制文件名到剪贴板
  const handleCopyName = useCallback(async () => {
    const node = ctxMenu.node;
    setCtxMenu((prev) => ({ ...prev, open: false }));
    if (!node) return;
    try {
      await navigator.clipboard.writeText(node.name);
      showToast("success", t("ctxmenu.nameCopied"));
    } catch {
      showToast("error", t("ctxmenu.copyFailed"));
    }
  }, [ctxMenu.node, showToast, t]);

  // 构建右键菜单项
  const ctxMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!ctxMenu.node) return [];
    const node = ctxMenu.node;
    return [
      {
        id: "open",
        label: t("ctxmenu.open"),
        icon: FileText,
        action: () => { if (!node.is_dir) handleFileSelect(node); },
      },
      { id: "sep1", label: "", action: () => {}, separator: true },
      {
        id: "rename",
        label: t("ctxmenu.rename"),
        icon: PenLine,
        action: () => setRenameTarget(node),
      },
      ...(!node.is_dir ? [{
        id: "duplicate",
        label: t("ctxmenu.duplicate"),
        icon: Files,
        action: handleDuplicate,
      }] : []),
      { id: "sep2", label: "", action: () => {}, separator: true },
      {
        id: "copyPath",
        label: t("ctxmenu.copyPath"),
        icon: ClipboardCopy,
        action: handleCopyPath,
      },
      {
        id: "copyName",
        label: t("ctxmenu.copyName"),
        icon: Copy,
        action: handleCopyName,
      },
      { id: "sep3", label: "", action: () => {}, separator: true },
      {
        id: "delete",
        label: t("ctxmenu.delete"),
        icon: Trash2,
        action: () => setDeleteTarget(node),
        danger: true,
      },
    ];
  }, [ctxMenu.node, t, handleFileSelect, handleDuplicate, handleCopyPath, handleCopyName]);

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
    <div className="w-72 min-w-[260px] border-l border-nf-border-light bg-nf-bg flex flex-col nf-slide-in-left">
      {/* 顶部: 标题与视图切换 - 改为两行布局防溢出 */}
      <div className="px-4 py-3 border-b border-nf-border-light">
        {/* 第一行:目录名 + 视图切换 */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="fandex-bar-left text-sm font-bold font-display text-nf-text flex-shrink-0">
              {dirName}
            </h2>
            {/* 新建入口提示:新建按钮在最左侧侧边栏底部,此处提示用户创建入口位置 */}
            <span className="text-[10px] text-nf-text-tertiary/70 truncate">
              {t("filelist.createHint")}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setViewMode("grid")}
              className={`nf-tool-btn h-7 w-7 flex items-center justify-center border ${
                viewMode === "grid"
                  ? "text-fandex-primary bg-fandex-primary/10 border-fandex-primary"
                  : "text-nf-text-tertiary hover:text-nf-text border-transparent hover:border-nf-border-light"
              }`}
              title={t("filelist.gridView")}
            >
              <Grid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`nf-tool-btn h-7 w-7 flex items-center justify-center border ${
                viewMode === "list"
                  ? "text-fandex-primary bg-fandex-primary/10 border-fandex-primary"
                  : "text-nf-text-tertiary hover:text-nf-text border-transparent hover:border-nf-border-light"
              }`}
              title={t("filelist.listView")}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {/* 第二行:正文分类的快捷操作按钮 - 三按钮均匀分布,主按钮突出 */}
        {isManuscript && (
          <div className="grid grid-cols-3 gap-1">
            <button
              onClick={onCreateFile}
              className="nf-tool-btn h-7 px-2 text-xs flex items-center justify-center gap-1.5 text-fandex-primary border border-fandex-primary hover:bg-fandex-primary/10 transition-all duration-fast"
              title={t("filelist.newChapter")}
            >
              <FilePlus className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{t("filelist.newChapter")}</span>
            </button>
            <button
              onClick={() => setShowOutlineToChapters(true)}
              className="nf-tool-btn h-7 px-2 text-xs flex items-center justify-center gap-1.5 text-fandex-tertiary border border-fandex-tertiary/50 hover:bg-fandex-tertiary/10 transition-all duration-fast"
              title={t("outlineToChapters.btnTitle")}
            >
              <ListTree className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{t("outlineToChapters.btn")}</span>
            </button>
            <button
              onClick={() => setShowVolumeGenerator(true)}
              className="nf-tool-btn h-7 px-2 text-xs flex items-center justify-center gap-1.5 text-fandex-secondary border border-fandex-secondary/50 hover:bg-fandex-secondary/10 transition-all duration-fast"
              title={t("volumeGen.title")}
            >
              <BookCopy className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{t("volumeGen.title")}</span>
            </button>
          </div>
        )}
      </div>

      {/* 文件列表区域 */}
      <div className="flex-1 overflow-y-auto p-3">
        {children.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <FileText className="w-12 h-12 text-nf-border mb-3" />
            <p className="text-sm text-nf-text-tertiary mb-3">{t("filelist.empty")}</p>
            <button
              onClick={onCreateFile}
              className="h-8 px-4 text-sm flex items-center justify-center gap-1.5 text-fandex-primary border border-fandex-primary hover:bg-fandex-primary/10 transition duration-fast"
            >
              <FilePlus className="w-4 h-4" />
              {t("filelist.createFirst")}
            </button>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-2 gap-0">
            {children.map((node, index) => (
              <TreeNodeGrid
                key={node.relative_path}
                node={node}
                depth={0}
                selectedPath={selectedFile?.relative_path ?? null}
                onSelect={handleFileSelect}
                onRename={handleRename}
                onDelete={handleDelete}
                onContextMenu={handleContextMenu}
                activeFileWordCount={activeFileWordCount}
                t={t}
                isManuscript={isManuscript}
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
                onContextMenu={handleContextMenu}
                t={t}
                activeFileWordCount={activeFileWordCount}
                isManuscript={isManuscript}
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

      {showOutlineToChapters && currentProject && (
        <OutlineToChapters
          onClose={() => setShowOutlineToChapters(false)}
          onCreated={async () => {
            if (!currentProject) return;
            try {
              const tree = await readProjectTree(currentProject.path);
              useAppStore.getState().setProjectTree(tree);
            } catch {
              // 刷新失败静默处理
            }
          }}
        />
      )}

      {showVolumeGenerator && currentProject && (
        <VolumeChapterGenerator
          onClose={() => setShowVolumeGenerator(false)}
          onCreated={async () => {
            if (!currentProject) return;
            try {
              const tree = await readProjectTree(currentProject.path);
              useAppStore.getState().setProjectTree(tree);
            } catch {
              // 刷新失败静默处理
            }
          }}
        />
      )}

      {/* 右键上下文菜单：文件列表节点右键触发 */}
      <ContextMenu
        open={ctxMenu.open}
        x={ctxMenu.x}
        y={ctxMenu.y}
        items={ctxMenuItems}
        onClose={() => setCtxMenu((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}
