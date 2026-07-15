// 文件树节点组件（列表视图 + 卡片视图）
//
// 功能概述：
// 递归渲染文件目录树节点，支持文件夹展开/折叠、文件图标、选中高亮、
// 拖拽悬停高亮等交互。提供两种视图模式：紧凑列表与卡片网格。
// 章节名使用 'break-all' 与 truncate 确保长名称完整可读。
//
// 模块职责：
// 1. 渲染文件夹节点（含展开/折叠箭头与子节点递归）
// 2. 渲染文件节点（含图标、标题、尺寸、悬浮操作按钮）
// 3. 提供文件名 → 显示标题的格式化工具函数
// 4. 支持正文分类按章节序号排序（卷首语 → 正文章节 → 卷尾语）
//
// 设计说明：
// - 视觉风格遵循 FANDEX 暗色主题（直角、左侧色条、1px 边框）
// - 拖拽逻辑由父组件通过 props 注入，节点本身不持有拖拽状态
// - 重命名/删除按钮采用悬浮显示策略，避免占用文件名横向空间

import { useState } from "react";
import {
  FileText,
  Trash2,
  PenLine,
  FolderOpen,
  Folder,
  ChevronRight,
  ChevronDown,
  GripVertical,
} from "lucide-react";
import type { FileNode } from "../../lib/api";
import { extractChapterNumber } from "../../lib/fileTreeUtils";
import { useSettingsStore, toChineseNumber, type ChapterFormat } from "../../lib/settingsStore";

/**
 * i18n 翻译函数类型
 * 与 useI18n 返回的 t 函数签名保持一致
 */
type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/**
 * 格式化文件大小为人类可读字符串
 * 输入: bytes 文件字节数
 * 输出: 带 B/KB/MB 单位的字符串
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 从文件名中去除编号前缀，保留纯名称
 * 兼容 .txt 与 .pmd 扩展名，避免扩展名残留影响显示
 * 输入: name 物理文件名（含扩展名）
 * 输出: 去除编号前缀与扩展名后的纯标题
 */
export function stripNumberPrefix(name: string): string {
  return name
    .replace(/^\d+[._\-\s]*/, "")
    .replace(/\.(txt|pmd)$/i, "")
    .trim();
}

/**
 * 将物理文件名转换为用户友好的显示标题
 * 三段式章节元数据解耦：物理文件名 / 显示标题 / 章号
 *
 * 转换规则：
 *   - "1.开端.txt" → "开端"（去除数字前缀和扩展名）
 *   - "第一章 开端.txt" → "第一章 开端"（仅去除扩展名，保留章节号前缀）
 *   - "序章.pmd" → "序章"
 *   - "角色档案.txt" → "角色档案"
 *   - "亚瑟.pmd" → "亚瑟"（兼容 .pmd 设定文件扩展名）
 *
 * 输入: name 物理文件名（含扩展名）
 * 输出: 用户友好的显示标题
 */
export function getDisplayTitle(name: string): string {
  // 去除扩展名（兼容 .txt 与 .pmd）
  let title = name.replace(/\.(txt|pmd)$/i, "").trim();
  // 去除阿拉伯数字前缀（如 "1." / "1_" / "1-" / "1 "）
  // 仅当文件名以 "数字.标题" 格式开头时去除，保留 "第一章" 等中文格式前缀
  title = title.replace(/^\d+[._\-\s]+/, "").trim();
  // 如果去除后为空（如文件名就是 "1.txt"），回退到原始名去扩展名
  if (!title) {
    title = name.replace(/\.(txt|pmd)$/i, "").trim();
  }
  return title;
}

/**
 * 正文分类专用：将物理文件名转换为带章节编号的显示标题
 * 根据 chapterFormat 设置，将 "N.标题.txt" 转换为 "第N章 标题" / "01 标题" / "Chapter N 标题"
 *
 * 输入:
 *   name 物理文件名（含扩展名，如 "1.开端.txt"）
 *   chapterFormat 章节标题格式（chinese/arabic/english）
 *   autoNumbering 是否开启自动编号
 * 输出:
 *   带章节编号的显示标题（如 "第一章 开端"）
 *   若文件名不含 N. 前缀或未开启自动编号，回退到 getDisplayTitle
 */
export function formatManuscriptTitle(
  name: string,
  chapterFormat: ChapterFormat,
  autoNumbering: boolean
): string {
  // 去除扩展名（兼容 .txt 与 .pmd）
  const baseName = name.replace(/\.(txt|pmd)$/i, "").trim();
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
  // 非编号格式或未开启自动编号：回退到普通显示（去除数字前缀）
  return baseName.replace(/^\d+[._\-\s]+/, "").trim() || baseName;
}

/**
 * 文件树节点公共属性接口
 * 包含列表视图与卡片视图共享的回调和状态字段
 */
interface FileTreeNodeProps {
  /** 当前节点数据 */
  node: FileNode;
  /** 递归深度（用于缩进计算） */
  depth: number;
  /** 当前选中文件的相对路径 */
  selectedPath: string | null;
  /** 文件选择回调（可选 event 参数用于 Ctrl/Shift 多选检测，Task 5.2.1） */
  onSelect: (node: FileNode, e?: React.MouseEvent) => void;
  /** 重命名按钮点击回调 */
  onRename: (node: FileNode, e: React.MouseEvent) => void;
  /** 删除按钮点击回调 */
  onDelete: (node: FileNode, e: React.MouseEvent) => void;
  /** 右键菜单触发回调 */
  onContextMenu: (node: FileNode, e: React.MouseEvent) => void;
  /** i18n 翻译函数 */
  t: TranslateFn;
  /** 是否可拖拽（仅正文分类文件节点为 true） */
  isDraggable?: boolean;
  /** 当前节点是否为拖拽悬停目标 */
  isDragOver?: boolean;
  /** 当前节点是否正在被拖拽 */
  isDragging?: boolean;
  /** 是否为正文分类（影响标题格式化与排序） */
  isManuscript?: boolean;
  /** 拖拽开始事件回调 */
  onDragStart?: (e: React.DragEvent) => void;
  /** 拖拽悬停事件回调 */
  onDragOver?: (e: React.DragEvent) => void;
  /** 拖拽离开事件回调 */
  onDragLeave?: (e: React.DragEvent) => void;
  /** 拖拽放置事件回调 */
  onDrop?: (e: React.DragEvent) => void;
  /** Task 5.2.1: 多选模式下是否被选中（用于多选高亮显示，与单选 selectedPath 区分） */
  isMultiSelected?: boolean;
  /** Task 5.3.1: 目录节点的 drop 属性（用于跨目录拖拽，仅正文分类卷目录有效） */
  dirDropProps?: Partial<{
    isDragOver: boolean;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  }>;
}

/**
 * 递归渲染文件树节点（列表视图）
 * 输入: FileTreeNodeProps 节点数据与回调
 * 输出: JSX 列表行（文件夹含可展开的子节点容器）
 * 流程:
 *   1. 文件夹节点：渲染展开/折叠箭头、文件夹图标、子节点数量、悬浮操作按钮
 *   2. 文件节点：渲染文件图标、显示标题、尺寸、悬浮操作按钮
 *   3. 递归渲染子节点，正文分类按章节序号排序
 */
export function TreeNodeList({
  node,
  depth,
  selectedPath,
  onSelect,
  onRename,
  onDelete,
  onContextMenu,
  t,
  isDraggable,
  isDragOver,
  isDragging,
  isManuscript,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  isMultiSelected,
}: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  // 正文分类：读取章节格式设置，用于显示"第N章 标题"
  const chapterFormat = useSettingsStore((s) => s.chapterFormat);
  const autoNumbering = useSettingsStore((s) => s.autoNumbering);

  // 文件夹节点：渲染展开/折叠控制与子节点容器
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
          {/* 章节名称使用 break-all 确保长名称完整显示 */}
          <span className="flex-1 text-sm break-all">{getDisplayTitle(node.name)}</span>
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
          // 正文分类：按 extractChapterNumber 排序（卷首语 -2 → 正文章节按数值 → 卷尾语 Infinity）
          // 非正文分类：保持原始顺序
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
      onClick={(e) => onSelect(node, e)}
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
            : isMultiSelected
              ? "bg-fandex-tertiary/15 text-fandex-tertiary border-fandex-tertiary/50"
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
      {/* 章节名称：单行显示，超出用省略号截断，释放横向空间给文件名 */}
      <span
        className="flex-1 min-w-0 text-sm break-all leading-snug"
        title={displayTitle}
      >
        {displayTitle}
      </span>
      {/* 右侧悬浮层：尺寸+操作按钮，默认隐藏，悬浮时覆盖显示，避免占用文件名横向空间 */}
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto transition-opacity duration-fast bg-nf-bg/85 backdrop-blur-sm pl-3">
        <span className="text-[10px] text-nf-text-tertiary whitespace-nowrap">
          {formatSize(node.size)}
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

/**
 * 递归渲染文件树节点（卡片视图）
 * 输入: FileTreeNodeProps 节点数据与回调
 * 输出: JSX 卡片（文件夹含可展开的子节点网格）
 * 流程:
 *   1. 文件夹节点：渲染展开/折叠控制与子节点 2 列网格容器
 *   2. 文件节点：渲染带 FANDEX 卡片样式的文件卡片
 *   3. 递归渲染子节点，正文分类按章节序号排序
 */
export function TreeNodeGrid({
  node,
  depth,
  selectedPath,
  onSelect,
  onRename,
  onDelete,
  onContextMenu,
  t,
  isDraggable,
  isDragOver,
  isDragging,
  isManuscript,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  isMultiSelected,
  dirDropProps,
}: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  // 正文分类：读取章节格式设置，用于显示"第N章 标题"
  const chapterFormat = useSettingsStore((s) => s.chapterFormat);
  const autoNumbering = useSettingsStore((s) => s.autoNumbering);

  // 文件夹节点：渲染展开/折叠控制与子节点网格容器
  if (node.is_dir) {
    const hasChildren = node.children && node.children.length > 0;
    return (
      <div className="col-span-2">
        <div
          className={`group flex items-center gap-2 p-2 cursor-pointer hover:bg-nf-bg-hover transition duration-fast border-b ${
            dirDropProps?.isDragOver
              ? "bg-fandex-tertiary/10 border-fandex-tertiary/60 ring-1 ring-fandex-tertiary/40"
              : "border-nf-border-light"
          }`}
          onClick={() => hasChildren && setExpanded(!expanded)}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(node, e); }}
          onDragOver={dirDropProps?.onDragOver}
          onDragLeave={dirDropProps?.onDragLeave}
          onDrop={dirDropProps?.onDrop}
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
          {/* 章节名称使用 break-all 确保长名称完整显示 */}
          <span className="text-xs font-medium text-nf-text break-all">{getDisplayTitle(node.name)}</span>
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
            {/* 正文分类：按 extractChapterNumber 排序（卷首语 -2 → 正文章节按数值 → 卷尾语 Infinity） */}
            {/* 非正文分类：保持原始顺序 */}
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
      onClick={(e) => onSelect(node, e)}
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
            : isMultiSelected
              ? "bg-fandex-tertiary/15 border-fandex-tertiary/60 shadow-lg shadow-fandex-tertiary/10"
              : isSelected
                ? "bg-fandex-primary/10 border-fandex-primary/60 shadow-lg shadow-fandex-primary/10"
                : "bg-nf-bg-card hover:border-fandex-primary/40 hover:shadow-md hover:shadow-black/30 hover:-translate-y-0.5"
      }`}
      style={!isSelected && !isDragging && !isDragOver && !isMultiSelected ? { backgroundColor: 'var(--fandex-bg-card)' } : undefined}
    >
      {/* 背景点阵装饰：呼应项目卡片质感，极低透明度不影响文字 */}
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
      {/* 章节名称使用 break-all 确保长名称完整显示 */}
      <div className="text-xs font-medium font-display text-nf-text break-all relative z-[1]">
        {isManuscript
          ? formatManuscriptTitle(node.name, chapterFormat, autoNumbering)
          : getDisplayTitle(node.name)}
      </div>
      <div className="text-[10px] text-nf-text-tertiary mt-1 relative z-[1]">
        {formatSize(node.size)}
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
      {/* 底部进度条装饰：悬停时显现，呼应项目卡片美术 */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-fandex-primary via-fandex-secondary to-fandex-tertiary opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
    </div>
  );
}

// ===== Task 2.4.3: 虚拟化扁平树节点 =====

/**
 * 扁平化树节点结构
 * 将递归树形结构展开为线性数组,供 useVirtualizer 使用
 * - node: 原始文件节点
 * - depth: 递归深度(用于缩进计算)
 * - topLevelIndex: 在顶层 children 数组中的索引(仅 depth=0 节点有效,用于拖拽排序)
 */
export interface FlatNode {
  node: FileNode;
  depth: number;
  topLevelIndex: number;
}

/**
 * 扁平化可见树节点(Task 2.4.3: 树形结构虚拟化前置步骤)
 *
 * 将递归的文件树按可见性(展开的节点 + 其子节点)展开为线性数组。
 * 仅展开的目录的子节点会被包含,折叠的目录的子节点被跳过。
 *
 * 输入:
 *   nodes 文件节点数组(当前层级)
 *   expandedPaths 已展开目录的 relative_path 集合
 *   isManuscript 是否为正文分类(影响子节点排序)
 *   depth 当前递归深度
 * 输出: FlatNode[] 扁平化后的可见节点数组
 * 流程:
 *   1. 正文分类按章节序号排序,非正文保持原始顺序
 *   2. 遍历节点,将当前节点加入结果数组
 *   3. 若当前节点为已展开目录,递归扁平化其子节点
 */
export function flattenVisibleNodes(
  nodes: FileNode[],
  expandedPaths: Set<string>,
  isManuscript: boolean,
  depth: number = 0
): FlatNode[] {
  const result: FlatNode[] = [];
  // 正文分类:按 extractChapterNumber 排序(卷首语 → 正文章节 → 卷尾语)
  const sortedNodes = isManuscript
    ? [...nodes].sort((a, b) => extractChapterNumber(a.name) - extractChapterNumber(b.name))
    : nodes;
  for (let i = 0; i < sortedNodes.length; i++) {
    const node = sortedNodes[i];
    // topLevelIndex 仅在顶层(depth=0)有意义,用于拖拽排序回调
    result.push({ node, depth, topLevelIndex: depth === 0 ? i : -1 });
    // 目录已展开时递归扁平化子节点
    if (node.is_dir && node.children.length > 0 && expandedPaths.has(node.relative_path)) {
      result.push(...flattenVisibleNodes(node.children, expandedPaths, isManuscript, depth + 1));
    }
  }
  return result;
}

/**
 * 扁平化文件树节点行组件(列表视图,Task 2.4.3)
 *
 * 与 TreeNodeList 的区别:
 *   - 不递归渲染子节点(由父组件通过 flattenVisibleNodes 统一扁平化)
 *   - 展开状态由父组件管理(isExpanded + onToggleExpand)
 *   - 缩进通过 depth 计算,适配虚拟列表的绝对定位布局
 *
 * 视觉样式与 TreeNodeList 保持一致,确保用户体验无缝迁移。
 *
 * 输入: FlatFileTreeNodeProps 节点数据、展开状态与回调
 * 输出: JSX 单行节点(文件夹或文件)
 */
interface FlatFileTreeNodeProps {
  /** 当前节点数据 */
  node: FileNode;
  /** 递归深度(用于缩进计算) */
  depth: number;
  /** 是否展开(仅文件夹节点有效) */
  isExpanded: boolean;
  /** 切换展开/折叠回调 */
  onToggleExpand: (relativePath: string) => void;
  /** 当前选中文件的相对路径 */
  selectedPath: string | null;
  /** 文件选择回调(可选 event 参数用于 Ctrl/Shift 多选检测,Task 5.2.1) */
  onSelect: (node: FileNode, e?: React.MouseEvent) => void;
  /** 重命名按钮点击回调 */
  onRename: (node: FileNode, e: React.MouseEvent) => void;
  /** 删除按钮点击回调 */
  onDelete: (node: FileNode, e: React.MouseEvent) => void;
  /** 右键菜单触发回调 */
  onContextMenu: (node: FileNode, e: React.MouseEvent) => void;
  /** i18n 翻译函数 */
  t: TranslateFn;
  /** 是否为正文分类 */
  isManuscript?: boolean;
  /** Task 5.2.1: 多选模式下是否被选中(用于多选高亮显示) */
  isMultiSelected?: boolean;
  /** 拖拽属性(仅正文分类顶层文件节点注入) */
  dragProps?: Partial<{
    isDraggable: boolean;
    isDragOver: boolean;
    isDragging: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  }>;
  /** Task 5.3.1: 目录节点的 drop 属性(用于跨目录拖拽,仅正文分类卷目录有效) */
  dirDropProps?: Partial<{
    isDragOver: boolean;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  }>;
}

/**
 * 扁平化文件树节点行组件实现(列表视图)
 * 渲染逻辑与 TreeNodeList 一致,但移除了递归子节点渲染
 */
export function FlatFileTreeNode({
  node,
  depth,
  isExpanded,
  onToggleExpand,
  selectedPath,
  onSelect,
  onRename,
  onDelete,
  onContextMenu,
  t,
  isManuscript,
  isMultiSelected,
  dragProps,
  dirDropProps,
}: FlatFileTreeNodeProps) {
  // 正文分类:读取章节格式设置,用于显示"第N章 标题"
  const chapterFormat = useSettingsStore((s) => s.chapterFormat);
  const autoNumbering = useSettingsStore((s) => s.autoNumbering);

  // 文件夹节点:渲染展开/折叠控制(无子节点递归)
  if (node.is_dir) {
    const hasChildren = node.children && node.children.length > 0;
    return (
      <div
        className={`group flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer transition duration-fast border ${
          dirDropProps?.isDragOver
            ? "bg-fandex-tertiary/10 border-fandex-tertiary/60 ring-1 ring-fandex-tertiary/40"
            : "border-transparent hover:bg-nf-bg-hover hover:text-nf-text text-nf-text-secondary"
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => hasChildren && onToggleExpand(node.relative_path)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(node, e); }}
        onDragOver={dirDropProps?.onDragOver}
        onDragLeave={dirDropProps?.onDragLeave}
        onDrop={dirDropProps?.onDrop}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-label={getDisplayTitle(node.name)}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-nf-text-tertiary" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-nf-text-tertiary" />
          )
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}
        {isExpanded ? (
          <FolderOpen className="w-4 h-4 flex-shrink-0 text-fandex-secondary" />
        ) : (
          <Folder className="w-4 h-4 flex-shrink-0 text-fandex-secondary" />
        )}
        {/* 章节名称使用 break-all 确保长名称完整显示 */}
        <span className="flex-1 text-sm break-all">{getDisplayTitle(node.name)}</span>
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
    );
  }

  // 文件节点
  const isSelected = selectedPath === node.relative_path;
  const displayTitle = isManuscript
    ? formatManuscriptTitle(node.name, chapterFormat, autoNumbering)
    : getDisplayTitle(node.name);
  return (
    <div
      onClick={(e) => onSelect(node, e)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(node, e); }}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      draggable={dragProps?.isDraggable}
      onDragStart={dragProps?.onDragStart}
      onDragOver={dragProps?.onDragOver}
      onDragLeave={dragProps?.onDragLeave}
      onDrop={dragProps?.onDrop}
      className={`group relative flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer transition duration-fast border ${
        dragProps?.isDragging
          ? "opacity-40 border-fandex-primary/40"
          : dragProps?.isDragOver
            ? "border-t-2 border-t-fandex-primary"
            : isMultiSelected
              ? "bg-fandex-tertiary/15 text-fandex-tertiary border-fandex-tertiary/50"
              : isSelected
                ? "bg-fandex-primary/10 text-fandex-primary border-fandex-primary"
                : "text-nf-text-secondary hover:bg-nf-bg-hover hover:text-nf-text border-transparent"
      }`}
      role="treeitem"
      aria-selected={isSelected || isMultiSelected}
      aria-label={displayTitle}
    >
      {dragProps?.isDraggable && (
        <GripVertical className="w-3.5 h-3.5 flex-shrink-0 text-nf-text-tertiary opacity-0 group-hover:opacity-60 cursor-grab" />
      )}
      {!dragProps?.isDraggable && <span className="w-3 flex-shrink-0" />}
      <FileText className="w-4 h-4 flex-shrink-0" />
      {/* 章节名称:单行显示,超出用省略号截断 */}
      <span
        className="flex-1 min-w-0 text-sm break-all leading-snug"
        title={displayTitle}
      >
        {displayTitle}
      </span>
      {/* 右侧悬浮层:尺寸+操作按钮,默认隐藏,悬浮时覆盖显示 */}
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto transition-opacity duration-fast bg-nf-bg/85 backdrop-blur-sm pl-3">
        <span className="text-[10px] text-nf-text-tertiary whitespace-nowrap">
          {formatSize(node.size)}
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
