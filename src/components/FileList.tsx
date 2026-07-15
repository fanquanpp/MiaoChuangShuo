// 右侧文件列表组件（容器）
// 组合 FileTreeNode 子组件与 useFileDragSort/useFileContextMenu/useCodexSync
// 三个 hooks，提供完整的文件管理交互。支持卡片/列表视图切换、子文件夹展开/折叠。
// Task 5.2.1/5.2.2: 新增多选模式（Ctrl+Click / Shift+Click / Esc 退出）与批量工具栏。

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  FileText,
  Grid,
  List,
  FilePlus,
  ListTree,
  CheckSquare,
  Trash2,
  FolderInput,
  Download,
  Pencil,
  X,
  ChevronDown,
} from "lucide-react";
import { useAppStore, getCategoryDir } from "../lib/store";
import type { FileNode } from "../lib/api";
import { deletePath, readProjectTree, renamePath } from "../lib/api";
import { findDirByName, isValidFileName, extractChapterNumber } from "../lib/fileTreeUtils";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { useUILayoutStore } from "../lib/uiStore";
import { exportProjectToTxt, pickDirectory } from "../lib/api/projectApi";
import ConfirmDialog from "./ConfirmDialog";
import OutlineToChapters from "./OutlineToChapters";
import ContextMenu from "./ContextMenu";
import { TreeNodeGrid, FlatFileTreeNode, flattenVisibleNodes } from "./file-list/FileTreeNode";
import { useFileDragSort } from "../hooks/useFileDragSort";
import { useFileContextMenu } from "../hooks/useFileContextMenu";
import { useCodexSync } from "../hooks/useCodexSync";

interface FileListProps {
  onCreateFile: () => void;
  onSelectFile?: (file: FileNode) => void;
}

/**
 * 右侧文件列表组件
 * 输入: onCreateFile 新建文件回调, onSelectFile 文件选择回调（可选）
 * 输出: JSX 文件列表界面（卡片/列表视图）
 * 流程: 读取分类目录 → 委托 FileTreeNode 渲染 → 处理选择/重命名/删除 →
 *       hooks 处理拖拽/右键/索引同步 → 视图切换并记忆偏好
 */
export default function FileList({ onCreateFile, onSelectFile }: FileListProps) {
  const projectTree = useAppStore((s) => s.projectTree);
  const activeCategory = useAppStore((s) => s.activeCategory);
  const selectedFile = useAppStore((s) => s.selectedFile);
  const setSelectedFile = useAppStore((s) => s.setSelectedFile);
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
  // 大纲生成章节对话框状态（仅正文分类有效）
  const [showOutlineToChapters, setShowOutlineToChapters] = useState(false);
  // Task 2.4.3: 已展开目录的 relative_path 集合(虚拟列表需要集中管理展开状态)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  // Task 2.4.3: 虚拟列表滚动容器引用
  const listScrollRef = useRef<HTMLDivElement>(null);

  // 当前分类对应的目录名与正文分类标记
  const dirName = getCategoryDir(activeCategory);
  const isManuscript = activeCategory === "manuscript";

  // 过滤当前分类的子节点，正文分类按章节序号自动排序
  const children = useMemo(() => {
    const dir = findDirByName(projectTree, dirName);
    const items = dir?.children ? [...dir.children] : [];
    if (isManuscript) {
      items.sort((a, b) => extractChapterNumber(a.name) - extractChapterNumber(b.name));
    }
    return items;
  }, [projectTree, dirName, isManuscript]);

  // Task 2.4.3: 扁平化可见树节点(展开的目录 + 其子节点),供虚拟列表使用
  const flatNodes = useMemo(
    () => flattenVisibleNodes(children, expandedPaths, isManuscript),
    [children, expandedPaths, isManuscript]
  );

  // Task 5.2.1: 多选模式状态
  // multiSelectMode: 是否处于多选模式（true 时显示批量工具栏，点击不切换单选选中）
  // selectedIds: 选中的文件 relative_path 集合
  // lastSelectedId: 上次选中的文件 ID（用于 Shift+Click 范围选择）
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  // Task 5.2.2: 批量删除确认对话框
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  // Task 5.2.2: 移动到卷下拉菜单
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  // Task 5.2.2: 批量操作进行中标记（禁用按钮防止重复点击）
  const [batchProcessing, setBatchProcessing] = useState(false);

  // Task 5.2.1: Esc 键退出多选模式
  // 监听全局 keydown，Esc 时清空选中并退出多选模式
  useEffect(() => {
    if (!multiSelectMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMultiSelectMode(false);
        setSelectedIds(new Set());
        setLastSelectedId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [multiSelectMode]);

  /**
   * Task 5.2.1: 多选感知的文件选择处理函数
   * 输入:
   *   node 文件节点
   *   e 鼠标事件（用于检测 Ctrl/Shift 修饰键）
   * 流程:
   *   1. 目录节点：不参与多选，直接交给 onToggleExpand 处理（由子组件内部完成）
   *   2. Ctrl+Click：进入多选模式，切换该节点的选中状态
   *   3. Shift+Click：进入多选模式，选中从 lastSelectedId 到当前节点的范围
   *   4. 普通点击：
   *      - 多选模式下：清空选中，退出多选，切换单选
   *      - 非多选模式下：直接切换单选
   */
  const handleFileSelect = useCallback((node: FileNode, e?: React.MouseEvent) => {
    // 目录节点不参与多选
    if (node.is_dir) {
      if (onSelectFile) onSelectFile(node);
      else setSelectedFile(node);
      return;
    }
    const isCtrl = e?.ctrlKey || e?.metaKey;
    const isShift = e?.shiftKey;

    if (isCtrl) {
      // Ctrl+Click: 进入多选模式并切换选中
      setMultiSelectMode(true);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(node.relative_path)) {
          next.delete(node.relative_path);
        } else {
          next.add(node.relative_path);
        }
        return next;
      });
      setLastSelectedId(node.relative_path);
      return;
    }

    if (isShift && lastSelectedId) {
      // Shift+Click: 范围选择（从 lastSelectedId 到当前节点）
      setMultiSelectMode(true);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        // 在 flatNodes 中查找两个节点的索引，选中区间内所有文件节点
        const startIndex = flatNodes.findIndex(
          (fn) => fn.node.relative_path === lastSelectedId
        );
        const endIndex = flatNodes.findIndex(
          (fn) => fn.node.relative_path === node.relative_path
        );
        if (startIndex === -1 || endIndex === -1) {
          next.add(node.relative_path);
          return next;
        }
        const from = Math.min(startIndex, endIndex);
        const to = Math.max(startIndex, endIndex);
        for (let i = from; i <= to; i++) {
          const fn = flatNodes[i];
          if (fn && !fn.node.is_dir) {
            next.add(fn.node.relative_path);
          }
        }
        return next;
      });
      return;
    }

    // 普通点击：多选模式下退出多选并切换单选
    if (multiSelectMode) {
      setMultiSelectMode(false);
      setSelectedIds(new Set());
      setLastSelectedId(null);
    }
    if (onSelectFile) onSelectFile(node);
    else setSelectedFile(node);
  }, [onSelectFile, setSelectedFile, multiSelectMode, lastSelectedId, flatNodes]);

  /**
   * Task 5.2.1: 主动进入多选模式（点击工具栏多选按钮）
   */
  const handleEnterMultiSelect = useCallback(() => {
    setMultiSelectMode(true);
    // 若当前有选中文件，初始化为选中集合
    if (selectedFile && !selectedFile.is_dir) {
      setSelectedIds(new Set([selectedFile.relative_path]));
      setLastSelectedId(selectedFile.relative_path);
    }
  }, [selectedFile]);

  /**
   * Task 5.2.1: 退出多选模式
   */
  const handleExitMultiSelect = useCallback(() => {
    setMultiSelectMode(false);
    setSelectedIds(new Set());
    setLastSelectedId(null);
    setMoveMenuOpen(false);
  }, []);

  /**
   * Task 5.2.2: 批量删除确认处理
   * 循环调用 deletePath 删除选中文件，统计成功/失败数量
   * 完成后刷新项目树，通过 toast 反馈结果
   */
  const handleBatchDeleteConfirm = useCallback(async () => {
    if (!currentProject || selectedIds.size === 0) return;
    setBatchDeleteOpen(false);
    setBatchProcessing(true);
    const ids = Array.from(selectedIds);
    let success = 0;
    let failed = 0;
    try {
      for (const relPath of ids) {
        try {
          const fullPath = `${currentProject.path}/${relPath}`;
          await deletePath(fullPath, currentProject.path);
          success++;
        } catch {
          failed++;
        }
      }
      // 刷新项目树
      const tree = await readProjectTree(currentProject.path);
      useAppStore.getState().setProjectTree(tree);
      // 若删除了当前选中文件，清除选中
      if (selectedFile && ids.includes(selectedFile.relative_path)) {
        useAppStore.getState().setSelectedFile(null);
      }
      // 反馈结果
      const failedSuffix = failed > 0 ? t("filelist.batch.deleteFailedPartial", { failed }) : "";
      showToast("success", t("filelist.batch.deleteSuccess", { success, failed: failedSuffix }));
      // 退出多选模式
      handleExitMultiSelect();
    } catch (e) {
      showToast("error", t("filelist.deleteFailed", { error: String(e) }));
    } finally {
      setBatchProcessing(false);
    }
  }, [currentProject, selectedIds, selectedFile, showToast, t, handleExitMultiSelect]);

  /**
   * Task 5.2.2: 批量导出选中文件为 TXT
   * 弹出目录选择对话框，对每个文件调用 exportProjectToTxt（single 模式）
   * 完成后通过 toast 反馈导出数量
   */
  const handleBatchExport = useCallback(async () => {
    if (!currentProject || selectedIds.size === 0) return;
    setBatchProcessing(true);
    try {
      const outputDir = await pickDirectory();
      if (!outputDir) {
        setBatchProcessing(false);
        return;
      }
      const ids = Array.from(selectedIds);
      let count = 0;
      for (const relPath of ids) {
        try {
          await exportProjectToTxt(currentProject.path, {
            mode: "single",
            includeChapterTitle: true,
            bom: true,
            crlf: false,
            outputPath: outputDir,
            chapterPath: relPath,
          });
          count++;
        } catch {
          // 单个文件失败不中断整体流程
        }
      }
      if (count > 0) {
        showToast("success", t("filelist.batch.exportSuccess", { count }));
      }
      handleExitMultiSelect();
    } catch (e) {
      showToast("error", t("filelist.batch.exportFailed", { error: String(e) }));
    } finally {
      setBatchProcessing(false);
    }
  }, [currentProject, selectedIds, showToast, t, handleExitMultiSelect]);

  /**
   * Task 5.2.2: 批量移动选中文件到指定卷目录
   * 输入: targetVolumeDir 目标卷目录的 relative_path（如 "正文/第一卷"）
   * 流程: 循环调用 renamePath 跨目录移动，跳过已在目标卷中的文件
   */
  const handleBatchMoveToVolume = useCallback(async (targetVolumeDir: string) => {
    if (!currentProject || selectedIds.size === 0) return;
    setMoveMenuOpen(false);
    setBatchProcessing(true);
    const ids = Array.from(selectedIds);
    let success = 0;
    let failed = 0;
    try {
      for (const relPath of ids) {
        // 跳过已在目标卷中的文件
        if (relPath.startsWith(targetVolumeDir + "/")) {
          continue;
        }
        // 提取文件名（保留原扩展名）
        const fileName = relPath.split("/").pop() || relPath;
        const newRelPath = `${targetVolumeDir}/${fileName}`;
        try {
          await renamePath(currentProject.path, relPath, newRelPath);
          success++;
        } catch {
          failed++;
        }
      }
      // 刷新项目树
      const tree = await readProjectTree(currentProject.path);
      useAppStore.getState().setProjectTree(tree);
      const failedSuffix = failed > 0 ? t("filelist.batch.deleteFailedPartial", { failed }) : "";
      showToast(
        "success",
        t("filelist.batch.moveSuccess", {
          success,
          target: targetVolumeDir.split("/").pop() || targetVolumeDir,
          failed: failedSuffix,
        })
      );
      handleExitMultiSelect();
    } catch (e) {
      showToast("error", t("filelist.batch.moveFailed", { error: String(e) }));
    } finally {
      setBatchProcessing(false);
    }
  }, [currentProject, selectedIds, showToast, t, handleExitMultiSelect]);

  /**
   * Task 5.2.2: 获取可用的卷目录列表（正文分类下的所有子目录）
   * 用于"移动到卷"下拉菜单
   */
  const volumeDirs = useMemo(() => {
    if (!isManuscript) return [];
    const dir = findDirByName(projectTree, dirName);
    if (!dir || !dir.children) return [];
    return dir.children.filter((c) => c.is_dir);
  }, [projectTree, dirName, isManuscript]);

  // Task 2.4.3: 文件列表虚拟化(预估 500+ 文件时受益)
  // 使用动态测量(measureElement)适配不同行高(文件夹/文件行高略有差异)
  const virtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 36,
    overscan: 8,
    getItemKey: (index) => flatNodes[index]?.node.relative_path ?? index,
  });

  /**
   * Task 2.4.3: 切换目录展开/折叠状态
   * 输入: relativePath 目录相对路径
   * 流程: 在 expandedPaths 集合中添加/移除该路径
   */
  const handleToggleExpand = useCallback((relativePath: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return next;
    });
  }, []);

  // 拖拽排序 hook：注入到 FileTreeNode 实现正文分类拖拽排序
  // Task 5.3.1: getVolumeDropProps 为卷目录注入 drop 属性,支持跨目录拖拽移动
  const { getFileDragProps, getVolumeDropProps } = useFileDragSort(children, isManuscript);
  // 右键菜单 hook：管理菜单显示与菜单项构建
  const { ctxMenu, ctxMenuItems, handleContextMenu, closeContextMenu } = useFileContextMenu({
    currentProject,
    onSelectFile: handleFileSelect,
    setRenameTarget: (node) => setRenameTarget(node),
    setDeleteTarget: (node) => setDeleteTarget(node),
  });
  // 设定库/索引同步 hook：删除/重命名后调用
  const { syncOnDelete, syncOnRename } = useCodexSync();

  /** 删除按钮点击：阻止冒泡并设置删除目标，触发确认对话框 */
  const handleDelete = (node: FileNode, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget(node);
  };

  /**
   * 确认删除：调用 deletePath API，刷新项目树，同步索引与设定库
   * 异常处理：失败时通过 toast 提示用户
   */
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
      // 若删除的是当前选中文件，清除选中状态
      if (useAppStore.getState().selectedFile?.relative_path === node.relative_path) {
        useAppStore.getState().setSelectedFile(null);
      }
      // 同步索引与设定库（静默执行）
      syncOnDelete(currentProject.path, node);
    } catch (e) {
      showToast("error", t("filelist.deleteFailed", { error: String(e) }));
    }
  };

  /** 重命名按钮点击：阻止冒泡并设置重命名目标，触发 prompt 对话框 */
  const handleRename = (node: FileNode, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameTarget(node);
  };

  /**
   * 确认重命名：校验文件名、保留扩展名、调用 renamePath API，
   * 刷新项目树，同步索引与设定库
   * 异常处理：失败时通过 toast 提示用户
   */
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
    // 文件扩展名保留策略：目录不加扩展名；文件保留原扩展名（.txt/.pmd），
    // 用户输入已含扩展名则直接使用，未含则追加原扩展名，缺失时回退 .txt
    const ensuredName = node.is_dir
      ? newName
      : (/\.(txt|pmd)$/i.test(newName)
        ? newName
        : `${newName}${node.name.match(/\.(txt|pmd)$/i)?.[0] ?? ".txt"}`);
    const dirPath = node.relative_path.substring(0, node.relative_path.lastIndexOf("/") + 1);
    const newRelPath = dirPath + ensuredName;
    try {
      await renamePath(currentProject.path, node.relative_path, newRelPath);
      showToast("success", t("filelist.renamed", { name: ensuredName }));
      const tree = await readProjectTree(currentProject.path);
      useAppStore.getState().setProjectTree(tree);
      // 同步索引与设定库（静默执行）
      syncOnRename(currentProject.path, node.relative_path, newRelPath, node.is_dir);
    } catch (e) {
      showToast("error", t("filelist.renameFailed", { error: String(e) }));
    }
  };

  return (
    <div className="w-72 min-w-[260px] border-l border-nf-border-light bg-nf-bg flex flex-col nf-slide-in-left">
      {/* 顶部：标题与视图切换 - 两行布局防溢出 */}
      <div className="px-4 py-3 border-b border-nf-border-light">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="fandex-bar-left text-sm font-bold font-display text-nf-text flex-shrink-0">{dirName}</h2>
            {/* 新建入口提示：新建按钮在最左侧侧边栏底部，此处提示用户创建入口位置 */}
            <span className="text-[10px] text-nf-text-tertiary/70 truncate">{t("filelist.createHint")}</span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setViewMode("grid")}
              className={`nf-tool-btn h-7 w-7 flex items-center justify-center border ${viewMode === "grid" ? "text-fandex-primary bg-fandex-primary/10 border-fandex-primary" : "text-nf-text-tertiary hover:text-nf-text border-transparent hover:border-nf-border-light"}`}
              title={t("filelist.gridView")}
            >
              <Grid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`nf-tool-btn h-7 w-7 flex items-center justify-center border ${viewMode === "list" ? "text-fandex-primary bg-fandex-primary/10 border-fandex-primary" : "text-nf-text-tertiary hover:text-nf-text border-transparent hover:border-nf-border-light"}`}
              title={t("filelist.listView")}
            >
              <List className="w-3.5 h-3.5" />
            </button>
            {/* Task 5.2.1: 多选模式入口按钮 */}
            <button
              onClick={handleEnterMultiSelect}
              className={`nf-tool-btn h-7 w-7 flex items-center justify-center border ${multiSelectMode ? "text-fandex-tertiary bg-fandex-tertiary/10 border-fandex-tertiary" : "text-nf-text-tertiary hover:text-nf-text border-transparent hover:border-nf-border-light"}`}
              title={t("filelist.batch.exit")}
            >
              <CheckSquare className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {/* 第二行：正文分类的快捷操作按钮 - 双按钮均匀分布，主按钮突出 */}
        {isManuscript && (
          <div className="grid grid-cols-2 gap-1">
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
          </div>
        )}
      </div>

      {/* Task 5.2.2: 批量操作工具栏（多选模式下显示） */}
      {multiSelectMode && (
        <div className="flex-shrink-0 px-3 py-2 border-b border-nf-border-light bg-fandex-tertiary/5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-fandex-tertiary font-medium">
              {t("filelist.batch.selectedCount", { count: selectedIds.size })}
            </span>
            <button
              onClick={handleExitMultiSelect}
              className="text-nf-text-tertiary hover:text-nf-text transition duration-fast"
              title={t("filelist.batch.exit")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {/* 重命名：仅单选时可用 */}
            <button
              onClick={() => {
                if (selectedIds.size !== 1) {
                  showToast("warning", t("filelist.batch.renameOnlySingle"));
                  return;
                }
                // 从 selectedIds 中取出唯一文件节点
                const relPath = Array.from(selectedIds)[0];
                const node = children.find((c) => c.relative_path === relPath)
                  || flatNodes.find((fn) => fn.node.relative_path === relPath)?.node;
                if (node) setRenameTarget(node);
              }}
              disabled={batchProcessing || selectedIds.size !== 1}
              className="nf-tool-btn h-6 px-2 text-[11px] flex items-center gap-1 text-nf-text-secondary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/60 disabled:opacity-40 disabled:cursor-not-allowed transition duration-fast"
              title={t("filelist.batch.rename")}
            >
              <Pencil className="w-3 h-3" />
              <span className="truncate">{t("filelist.batch.rename")}</span>
            </button>
            {/* 导出 */}
            <button
              onClick={handleBatchExport}
              disabled={batchProcessing || selectedIds.size === 0}
              className="nf-tool-btn h-6 px-2 text-[11px] flex items-center gap-1 text-nf-text-secondary hover:text-fandex-secondary border border-nf-border-light hover:border-fandex-secondary/60 disabled:opacity-40 disabled:cursor-not-allowed transition duration-fast"
              title={t("filelist.batch.export")}
            >
              <Download className="w-3 h-3" />
              <span className="truncate">{t("filelist.batch.export")}</span>
            </button>
            {/* 删除 */}
            <button
              onClick={() => setBatchDeleteOpen(true)}
              disabled={batchProcessing || selectedIds.size === 0}
              className="nf-tool-btn h-6 px-2 text-[11px] flex items-center gap-1 text-nf-text-secondary hover:text-red-400 border border-nf-border-light hover:border-red-400/60 disabled:opacity-40 disabled:cursor-not-allowed transition duration-fast"
              title={t("filelist.batch.delete")}
            >
              <Trash2 className="w-3 h-3" />
              <span className="truncate">{t("filelist.batch.delete")}</span>
            </button>
            {/* 移动到卷：仅正文分类显示 */}
            {isManuscript && (
              <div className="relative">
                <button
                  onClick={() => setMoveMenuOpen((v) => !v)}
                  disabled={batchProcessing || selectedIds.size === 0}
                  className="nf-tool-btn h-6 px-2 text-[11px] flex items-center gap-1 text-nf-text-secondary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/60 disabled:opacity-40 disabled:cursor-not-allowed transition duration-fast"
                  title={t("filelist.batch.moveToVolume")}
                >
                  <FolderInput className="w-3 h-3" />
                  <span className="truncate">{t("filelist.batch.moveToVolume")}</span>
                  <ChevronDown className="w-3 h-3 opacity-70" />
                </button>
                {moveMenuOpen && (
                  <>
                    {/* 透明遮罩：点击外部关闭下拉 */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMoveMenuOpen(false)}
                    />
                    <div className="nf-glass-panel absolute top-full left-0 mt-1 w-44 max-h-60 overflow-y-auto bg-nf-bg-card border border-nf-border-light shadow-lg z-50 py-1">
                      {volumeDirs.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-nf-text-tertiary">
                          {t("filelist.batch.noVolumes")}
                        </div>
                      ) : (
                        volumeDirs.map((vol) => (
                          <button
                            key={vol.relative_path}
                            onClick={() => handleBatchMoveToVolume(vol.relative_path)}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-nf-text hover:bg-nf-bg-hover transition duration-fast"
                          >
                            <FolderInput className="w-3.5 h-3.5 text-fandex-primary flex-shrink-0" />
                            <span className="truncate">{vol.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 文件列表区域 */}
      <div
        ref={listScrollRef}
        className="flex-1 overflow-y-auto p-3"
        role={viewMode === "list" ? "tree" : undefined}
        aria-label={viewMode === "list" ? dirName : undefined}
      >
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
          // 卡片视图:保持原有递归渲染(卡片视图文件数通常较少,暂不虚拟化)
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
                t={t}
                isManuscript={isManuscript}
                isMultiSelected={multiSelectMode && selectedIds.has(node.relative_path)}
                dirDropProps={getVolumeDropProps(node)}
                {...getFileDragProps(node, index)}
              />
            ))}
          </div>
        ) : (
          // Task 2.4.3: 列表视图虚拟化(扁平化可见节点 + useVirtualizer)
          // 虚拟容器高度等于所有项总高度,内部项使用绝对定位偏移
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const flatNode = flatNodes[virtualItem.index];
              // 拖拽属性仅注入顶层(depth=0)文件节点,嵌套节点不参与拖拽排序
              const dragProps = flatNode.topLevelIndex >= 0
                ? getFileDragProps(flatNode.node, flatNode.topLevelIndex)
                : undefined;
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <FlatFileTreeNode
                    node={flatNode.node}
                    depth={flatNode.depth}
                    isExpanded={expandedPaths.has(flatNode.node.relative_path)}
                    onToggleExpand={handleToggleExpand}
                    selectedPath={selectedFile?.relative_path ?? null}
                    onSelect={handleFileSelect}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    onContextMenu={handleContextMenu}
                    t={t}
                    isManuscript={isManuscript}
                    isMultiSelected={multiSelectMode && selectedIds.has(flatNode.node.relative_path)}
                    dragProps={dragProps}
                    dirDropProps={getVolumeDropProps(flatNode.node)}
                  />
                </div>
              );
            })}
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

      {/* Task 5.2.2: 批量删除确认对话框 */}
      <ConfirmDialog
        open={batchDeleteOpen}
        type="danger"
        title={t("filelist.batch.deleteConfirmTitle")}
        message={t("filelist.batch.deleteConfirmMsg", { count: selectedIds.size })}
        confirmLabel={t("app.delete")}
        onConfirm={handleBatchDeleteConfirm}
        onCancel={() => setBatchDeleteOpen(false)}
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

      {/* 右键上下文菜单：文件列表节点右键触发 */}
      <ContextMenu
        open={ctxMenu.open}
        x={ctxMenu.x}
        y={ctxMenu.y}
        items={ctxMenuItems}
        onClose={closeContextMenu}
      />
    </div>
  );
}
