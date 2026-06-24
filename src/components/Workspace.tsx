// 工作台主容器组件
//
// 功能概述：
// NovelForge 的工作台界面，三栏布局: 左侧导航 + 中间内容区 + 右侧文件列表。
// FileList 作为常驻右侧面板，显示当前分类的文件列表。
// 根据当前分类切换中间内容: 正文用 TipTap 编辑器,角色/世界观/名词用卡片管理,
// 时间线用专用时间线管理器。
//
// 模块职责：
// 1. 加载项目目录树
// 2. 渲染三栏布局(左导航 + 中内容 + 右文件列表)
// 3. 根据分类切换中间内容面板
// 4. 管理新建文件对话框

import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import FileList from "./FileList";
import NovelEditor from "./NovelEditor";
import CardManager from "./CardManager";
import TimelineManager from "./TimelineManager";
import WritingStats from "./WritingStats";
import GlobalSearch from "./GlobalSearch";
import { useAppStore, CATEGORY_DIRS, CATEGORY_NAMES } from "../lib/store";
import { readProjectTree, createFile } from "../lib/api";
import { X, FilePlus } from "lucide-react";

// 工作台主容器组件
// 输入: 无
// 输出: 渲染三栏工作台界面
// 流程:
//   1. 打开项目时加载目录树
//   2. 渲染 Sidebar + 中间面板 + 右侧 FileList
//   3. 根据分类切换中间内容
export default function Workspace() {
  const {
    currentProject,
    selectedFile,
    activeCategory,
    setProjectTree,
    setLoading,
  } = useAppStore();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [creating, setCreating] = useState(false);

  // 加载项目目录树
  // 输入: 无
  // 输出: 无
  // 流程: 调用 readProjectTree 并更新 store
  useEffect(() => {
    if (!currentProject) return;
    setLoading(true);
    readProjectTree(currentProject.path)
      .then((tree) => {
        setProjectTree(tree);
      })
      .catch((e) => {
        console.error("加载目录树失败:", e);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [currentProject, setProjectTree, setLoading]);

  // 计算选中文件的完整路径
  // 输入: 无
  // 输出: 文件完整路径或 null
  const selectedFilePath =
    selectedFile && currentProject
      ? `${currentProject.path}\\${selectedFile.relative_path}`
      : null;

  // 处理新建文件
  // 输入: 无
  // 输出: 无
  // 流程: 在当前分类目录下创建新文件
  const handleCreateFile = async () => {
    if (!currentProject || !newFileName.trim()) return;
    setCreating(true);
    try {
      const dirName = CATEGORY_DIRS[activeCategory];
      let fileName = newFileName.trim();
      if (!fileName.endsWith(".md") && !fileName.endsWith(".txt")) {
        fileName += ".md";
      }
      const relativePath = `${dirName}/${fileName}`;
      await createFile(currentProject.path, relativePath, "");
      // 刷新目录树
      const tree = await readProjectTree(currentProject.path);
      setProjectTree(tree);
      setCreateDialogOpen(false);
      setNewFileName("");
    } catch (e) {
      alert(`创建文件失败: ${e}`);
    } finally {
      setCreating(false);
    }
  };

  if (!currentProject) {
    return null;
  }

  // 渲染中间内容面板
  // 输入: 无
  // 输出: 根据分类返回对应组件
  // 流程: 时间线/统计/搜索用专用组件,角色/世界观/名词用卡片管理,其他用编辑器
  const renderMiddlePanel = () => {
    if (activeCategory === "timeline") {
      return <TimelineManager />;
    }
    if (activeCategory === "stats") {
      return <WritingStats />;
    }
    if (activeCategory === "search") {
      return <GlobalSearch />;
    }
    if (
      activeCategory === "characters" ||
      activeCategory === "worldview" ||
      activeCategory === "glossary"
    ) {
      return (
        <CardManager categoryLabel={CATEGORY_NAMES[activeCategory]} />
      );
    }
    // 正文/大纲/素材使用 TipTap 编辑器
    return <NovelEditor filePath={selectedFilePath} />;
  };

  // 时间线/统计/搜索分类: 中间面板扩展到右侧(不显示 FileList)
  // 其他分类: 右侧常驻 FileList
  const showFileList =
    activeCategory !== "timeline" &&
    activeCategory !== "stats" &&
    activeCategory !== "search";

  return (
    <div className="h-screen w-screen flex bg-nf-bg overflow-hidden">
      {/* 左侧: 导航栏(缩窄) */}
      <Sidebar onCreateFile={() => setCreateDialogOpen(true)} />

      {/* 中间: 内容面板 */}
      <div className="flex-1 flex min-w-0">{renderMiddlePanel()}</div>

      {/* 右侧: 文件列表(常驻,时间线分类隐藏) */}
      {showFileList && <FileList onCreateFile={() => setCreateDialogOpen(true)} />}

      {/* 新建文件对话框 - FANDEX 直角 */}
      {createDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-nf-bg-card border border-nf-border-light shadow-lg overflow-hidden">
            {/* 头部 */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-nf-border-light">
              <div className="flex items-center gap-2">
                <FilePlus className="w-4 h-4 text-fandex-primary" />
                <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text">新建文件</h3>
              </div>
              <button
                onClick={() => setCreateDialogOpen(false)}
                className="p-1 hover:bg-nf-bg-hover text-nf-text-tertiary transition-fast"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 内容 */}
            <div className="px-5 py-4">
              <label className="block text-xs text-nf-text-secondary mb-1.5">
                文件名(将创建在 {CATEGORY_DIRS[activeCategory]} 目录下)
              </label>
              <input
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFile();
                }}
                placeholder="输入文件名"
                autoFocus
                className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition-fast"
              />
              <p className="text-xs text-nf-text-tertiary mt-2">
                不输入扩展名将自动添加 .md
              </p>
            </div>

            {/* 底部按钮 */}
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-nf-border-light">
              <button
                onClick={() => setCreateDialogOpen(false)}
                className="px-3 py-1.5 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition-fast"
              >
                取消
              </button>
              <button
                onClick={handleCreateFile}
                disabled={!newFileName.trim() || creating}
                className="px-3 py-1.5 bg-fandex-primary hover:bg-fandex-primary-hover text-sm font-medium text-nf-text-inverse transition-fast disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? "创建中..." : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
