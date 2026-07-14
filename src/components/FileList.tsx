// 右侧文件列表组件（容器）
// 组合 FileTreeNode 子组件与 useFileDragSort/useFileContextMenu/useCodexSync
// 三个 hooks，提供完整的文件管理交互。支持卡片/列表视图切换、子文件夹展开/折叠。

import { useState, useMemo } from "react";
import { FileText, Grid, List, FilePlus, ListTree } from "lucide-react";
import { useAppStore, getCategoryDir } from "../lib/store";
import type { FileNode } from "../lib/api";
import { deletePath, readProjectTree, renamePath } from "../lib/api";
import { findDirByName, isValidFileName, extractChapterNumber } from "../lib/fileTreeUtils";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { useUILayoutStore } from "../lib/uiStore";
import ConfirmDialog from "./ConfirmDialog";
import OutlineToChapters from "./OutlineToChapters";
import ContextMenu from "./ContextMenu";
import { TreeNodeList, TreeNodeGrid } from "./file-list/FileTreeNode";
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
  // 大纲生成章节对话框状态（仅正文分类有效）
  const [showOutlineToChapters, setShowOutlineToChapters] = useState(false);

  // 文件选择：优先使用外部传入的保存后切换回调
  const handleFileSelect = onSelectFile || setSelectedFile;

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

  // 拖拽排序 hook：注入到 FileTreeNode 实现正文分类拖拽排序
  const { getFileDragProps } = useFileDragSort(children, isManuscript);
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
