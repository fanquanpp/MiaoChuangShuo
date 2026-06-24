// 中间文件列表组件
//
// 功能概述：
// 显示当前分类下的文件列表，支持卡片视图与列表视图切换。
// 点击文件项打开编辑器。支持新建、删除文件操作。
//
// 模块职责：
// 1. 从项目目录树中过滤当前分类的文件
// 2. 渲染卡片网格或列表
// 3. 处理文件选择与删除
// 4. 空状态提示

import { useState, useMemo } from "react";
import { FileText, Trash2, Grid, List, FilePlus } from "lucide-react";
import { useAppStore, CATEGORY_DIRS, type SidebarCategory } from "../lib/store";
import type { FileNode } from "../lib/api";

// 文件列表属性接口
interface FileListProps {
  // 新建文件回调
  onCreateFile: () => void;
}

// 中间文件列表组件
// 输入: onCreateFile 新建文件回调
// 输出: 渲染文件列表或卡片网格
// 流程:
//   1. 从 projectTree 过滤当前分类目录下的文件
//   2. 根据视图模式渲染卡片或列表
//   3. 点击文件触发选中
export default function FileList({ onCreateFile }: FileListProps) {
  const { projectTree, activeCategory, selectedFile, setSelectedFile } =
    useAppStore();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // 获取当前分类对应的目录名
  const dirName = CATEGORY_DIRS[activeCategory as SidebarCategory];

  // 从目录树中查找当前分类目录的子节点
  // 输入: 无
  // 输出: FileNode[] 当前分类下的文件列表
  // 流程: 遍历 projectTree 查找匹配的目录
  const files = useMemo(() => {
    const findDir = (nodes: FileNode[], target: string): FileNode | null => {
      for (const node of nodes) {
        if (node.name === target && node.is_dir) {
          return node;
        }
        if (node.is_dir && node.children.length > 0) {
          const found = findDir(node.children, target);
          if (found) return found;
        }
      }
      return null;
    };

    const dir = findDir(projectTree, dirName);
    return dir?.children || [];
  }, [projectTree, dirName]);

  // 格式化文件大小
  // 输入: bytes 字节数
  // 输出: 格式化字符串
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // 处理文件删除
  // 输入: node 文件节点, e 事件
  // 输出: 无
  // 流程: 确认后调用 deletePath 并刷新
  const handleDelete = (node: FileNode, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`确定删除 "${node.name}" 吗?`)) {
      // 此处需要完整路径,由父组件传入 projectPath
      // 简化处理: 通过 store 获取
      const { currentProject } = useAppStore.getState();
      if (!currentProject) return;
      const fullPath = `${currentProject.path}\\${node.relative_path}`;
      import("../lib/api").then(({ deletePath }) => {
        deletePath(fullPath)
          .then(() => {
            // 刷新目录树
            import("../lib/api").then(({ readProjectTree }) => {
              readProjectTree(currentProject.path).then((tree) => {
                useAppStore.getState().setProjectTree(tree);
              });
            });
          })
          .catch((e) => alert(`删除失败: ${e}`));
      });
    }
  };

  return (
    <div className="w-72 min-w-[260px] border-l border-nf-border-light bg-nf-bg flex flex-col">
      {/* 顶部: 标题与视图切换 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-nf-border-light">
        <h2 className="text-sm font-semibold text-nf-text">{dirName}</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode("grid")}
            className={`p-1.5 rounded transition-fast ${
              viewMode === "grid"
                ? "text-fandex-primary bg-fandex-primary/10"
                : "text-nf-text-tertiary hover:text-nf-text"
            }`}
            title="卡片视图"
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-1.5 rounded transition-fast ${
              viewMode === "list"
                ? "text-fandex-primary bg-fandex-primary/10"
                : "text-nf-text-tertiary hover:text-nf-text"
            }`}
            title="列表视图"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 文件列表区域 */}
      <div className="flex-1 overflow-y-auto p-3">
        {files.length === 0 ? (
          /* 空状态 */
          <div className="flex flex-col items-center justify-center h-full text-center">
            <FileText className="w-12 h-12 text-nf-border mb-3" />
            <p className="text-sm text-nf-text-tertiary mb-3">
              此分类下暂无文件
            </p>
            <button
              onClick={onCreateFile}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-fandex-primary border border-fandex-primary/30 rounded-lg hover:bg-fandex-primary/10 transition-fast"
            >
              <FilePlus className="w-4 h-4" />
              创建第一个文件
            </button>
          </div>
        ) : viewMode === "grid" ? (
          /* 卡片视图 */
          <div className="grid grid-cols-2 gap-2">
            {files.map((file) => (
              <div
                key={file.relative_path}
                onClick={() => setSelectedFile(file)}
                className={`group relative p-3 rounded-lg border cursor-pointer transition-fast ${
                  selectedFile?.relative_path === file.relative_path
                    ? "border-fandex-primary bg-fandex-primary/10"
                    : "border-nf-border-light bg-nf-bg-card hover:border-nf-border"
                }`}
              >
                <FileText className="w-5 h-5 text-fandex-primary mb-2" />
                <div className="text-xs font-medium text-nf-text truncate">
                  {file.name}
                </div>
                <div className="text-[10px] text-nf-text-tertiary mt-1">
                  {formatSize(file.size)}
                </div>
                {/* 删除按钮 */}
                <button
                  onClick={(e) => handleDelete(file, e)}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded text-nf-text-tertiary hover:text-red-400 transition-fast"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          /* 列表视图 */
          <div className="space-y-1">
            {files.map((file) => (
              <div
                key={file.relative_path}
                onClick={() => setSelectedFile(file)}
                className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-fast ${
                  selectedFile?.relative_path === file.relative_path
                    ? "bg-fandex-primary/10 text-fandex-primary"
                    : "text-nf-text-secondary hover:bg-nf-bg-hover hover:text-nf-text"
                }`}
              >
                <FileText className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 text-sm truncate">{file.name}</span>
                <span className="text-xs text-nf-text-tertiary">
                  {formatSize(file.size)}
                </span>
                <button
                  onClick={(e) => handleDelete(file, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-nf-text-tertiary hover:text-red-400 transition-fast"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
