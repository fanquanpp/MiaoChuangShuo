// 工作台主容器组件
//
// 功能概述：
// NovelForge 的工作台界面，三栏布局: 左侧导航 + 中间内容区 + 右侧文件列表。
// 支持聚焦模式(F11)隐藏侧边栏和文件列表，专注模式计时器。
// 集成命令面板(Ctrl+K)和全局快捷键(?)。
//
// 模块职责：
// 1. 加载项目目录树
// 2. 渲染三栏布局(左导航 + 中内容 + 右文件列表)
// 3. 根据分类切换中间内容面板
// 4. 管理新建文件对话框、命令面板、聚焦模式、专注计时器

import { useEffect, useState, useCallback, useMemo } from "react";
import Sidebar from "./Sidebar";
import FileList from "./FileList";
import NovelEditor from "./NovelEditor";
import CardManager from "./CardManager";
import TimelineManager from "./TimelineManager";
import WritingStats from "./WritingStats";
import GlobalSearch from "./GlobalSearch";
import KnowledgeGraph from "./KnowledgeGraph";
import VolumeManager from "./VolumeManager";
import SettingsDialog from "./SettingsDialog";
import CreateFileDialog from "./CreateFileDialog";
import CommandPalette from "./CommandPalette";
import { FocusTimer } from "./FocusTimer";
import { useAppStore, getCategoryDir, getCategoryName, type SidebarCategory } from "../lib/store";
import { readProjectTree, createFile } from "../lib/api";
import type { FileNode } from "../lib/api";
import { getCategoryConfig } from "../lib/categoryRegistry";
import { useSettingsStore, formatChapterHeading, getNextChapterNum } from "../lib/settingsStore";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import { findDirByName } from "../lib/fileTreeUtils";

/** Alt+数字键 → 侧边栏分类映射 */
const ALT_CATEGORY_MAP: Record<string, SidebarCategory> = {
  "1": "manuscript",
  "2": "outline",
  "3": "characters",
  "4": "worldview",
  "5": "glossary",
  "6": "materials",
  "7": "timeline",
  "8": "stats",
};

export default function Workspace() {
  const currentProject = useAppStore((s) => s.currentProject);
  const selectedFile = useAppStore((s) => s.selectedFile);
  const activeCategory = useAppStore((s) => s.activeCategory);
  const setProjectTree = useAppStore((s) => s.setProjectTree);
  const setLoading = useAppStore((s) => s.setLoading);
  const setActiveCategory = useAppStore((s) => s.setActiveCategory);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [showFocusTimer, setShowFocusTimer] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { showToast } = useToast();
  const { t } = useI18n();
  const projectTree = useAppStore((s) => s.projectTree);
  const chapterFormat = useSettingsStore((s) => s.chapterFormat);
  const autoFillBookTitle = useSettingsStore((s) => s.autoFillBookTitle);
  const autoOutlineSkeleton = useSettingsStore((s) => s.autoOutlineSkeleton);
  const bookTitle = currentProject?.meta?.name || "";

  // 是否为分卷类型
  const isVolumeType = useMemo(() => {
    const type = currentProject?.meta?.type;
    return type === "multi_volume" || type === "standard" || type === "shared_world";
  }, [currentProject]);

  // 加载项目目录树
  useEffect(() => {
    if (!currentProject) return;
    setLoading(true);
    readProjectTree(currentProject.path)
      .then((tree) => setProjectTree(tree))
      .catch((e) => {
        console.error("加载目录树失败:", e);
        showToast("error", t("cardmanager.loadFailedShort"));
      })
      .finally(() => setLoading(false));
  }, [currentProject, setProjectTree, setLoading, showToast, t]);

  // 全局快捷键监听
  const handleGlobalKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // 命令面板 Ctrl+K / Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        return;
      }
      // 聚焦模式 F11
      if (e.key === "F11") {
        e.preventDefault();
        setFocusMode((prev) => {
          const next = !prev;
          showToast("info", next ? t("workspace.focusModeEnter") : t("workspace.focusModeExit"));
          return next;
        });
        return;
      }
      // 专注计时器 Ctrl+Shift+T
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "T") {
        e.preventDefault();
        setShowFocusTimer((prev) => !prev);
        return;
      }
      // Alt+数字键 侧边栏分类切换
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const cat = ALT_CATEGORY_MAP[e.key];
        if (cat) {
          e.preventDefault();
          setActiveCategory(cat);
          setCommandPaletteOpen(false);
          return;
        }
      }
      // Escape 关闭命令面板
      if (e.key === "Escape") {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else if (focusMode) {
          setFocusMode(false);
        }
      }
    },
    [commandPaletteOpen, focusMode, showToast, setActiveCategory, t]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  // 计算选中文件的完整路径
  const selectedFilePath =
    selectedFile && currentProject
      ? `${currentProject.path}/${selectedFile.relative_path}`
      : null;

  // 根据分类和设置生成文件初始内容（含自动章节编号）
  const getFileTemplate = useCallback(
    (fileName: string, category: SidebarCategory): string => {
      const title = fileName.replace(/\.txt$/i, "").trim();
      switch (category) {
        case "manuscript": {
          // 从现有章节推算下一章序号
          const manuscriptDir = findDirByName(projectTree, getCategoryDir("manuscript"));
          const existingFiles = manuscriptDir?.children.filter((f) => !f.is_dir) || [];
          const nextNum = getNextChapterNum(existingFiles);
          const heading = formatChapterHeading(nextNum, bookTitle, chapterFormat, autoFillBookTitle);
          return `${heading}\n\n`;
        }
        case "outline":
          if (autoOutlineSkeleton) {
            return `${title}\n\n一、\n二、\n三、\n四、\n五、\n\n`;
          }
          return `${title}\n\n`;
        case "materials":
          return `${title}\n\n`;
        default:
          return `${title}\n\n`;
      }
    },
    [projectTree, bookTitle, chapterFormat, autoFillBookTitle, autoOutlineSkeleton]
  );

  // 处理新建文件确认
  const handleCreateFile = useCallback(async (fileName: string) => {
    if (!currentProject) throw new Error("无当前项目");
    const dirName = getCategoryDir(activeCategory);
    const relativePath = `${dirName}/${fileName}`;
    const templateContent = getFileTemplate(fileName, activeCategory);
    await createFile(currentProject.path, relativePath, templateContent);
    const tree = await readProjectTree(currentProject.path);
    setProjectTree(tree);
    showToast("success", t("workspace.fileCreated", { name: fileName }));
  }, [currentProject, activeCategory, getFileTemplate, setProjectTree, showToast, t]);

  // 命令面板中触发新建文件
  const handleCommandCreateFile = useCallback((category: SidebarCategory) => {
    setActiveCategory(category);
    setCreateDialogOpen(true);
  }, [setActiveCategory]);

  if (!currentProject) return null;

  const renderMiddlePanel = () => {
    const cfg = getCategoryConfig(activeCategory);
    switch (cfg.panelType) {
      case "timeline":
        return <TimelineManager />;
      case "stats":
        return <WritingStats />;
      case "search":
        return <GlobalSearch />;
      case "knowledge":
        return <KnowledgeGraph />;
      case "volume":
        return <VolumeManager />;
      case "card-manager":
        return <CardManager categoryLabel={getCategoryName(activeCategory)} />;
      default:
        return (
          <NovelEditor
            filePath={selectedFilePath}
            focusMode={focusMode}
          />
        );
    }
  };

  const showFileList = getCategoryConfig(activeCategory).showFileList;

  return (
    <div className="h-screen w-screen flex bg-nf-bg overflow-hidden">
      {/* 聚焦模式下隐藏侧边栏 */}
      {!focusMode && (
        <Sidebar onCreateFile={() => setCreateDialogOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* 专注模式计时器条 */}
        {showFocusTimer && (
          <FocusTimer onClose={() => setShowFocusTimer(false)} />
        )}
        <div className="flex-1 flex min-h-0">{renderMiddlePanel()}</div>
      </div>

      {/* 聚焦模式下隐藏文件列表 */}
      {!focusMode && showFileList && (
        <FileList onCreateFile={() => setCreateDialogOpen(true)} />
      )}

      <CreateFileDialog
        open={createDialogOpen}
        dirName={getCategoryDir(activeCategory)}
        onClose={() => setCreateDialogOpen(false)}
        onConfirm={handleCreateFile}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onCreateFile={handleCommandCreateFile}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
