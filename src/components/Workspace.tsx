// 工作台主容器组件
//
// 功能概述：
// 喵创说 的工作台界面，三栏布局: 左侧导航 + 中间内容区 + 右侧文件列表。
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
import WritingStats from "./WritingStats";
import GlobalSearch from "./GlobalSearch";
import SettingsDialog, { type SettingsSection } from "./SettingsDialog";
import CreateFileDialog from "./CreateFileDialog";
import CreateFileWizard from "./CreateFileWizard";
import CommandPalette from "./CommandPalette";
import ProjectArchiveDialog from "./ProjectArchiveDialog";
import ErrorBoundary from "./ErrorBoundary";
import { FocusTimer } from "./FocusTimer";
import { useAppStore, getCategoryDir, type SidebarCategory } from "../lib/store";
import { getEditorSaveFn } from "../lib/stores/viewSlice";
import { readProjectTree, createFile, getProjectIndexStats, buildProjectIndex } from "../lib/api";
import type { FileNode } from "../lib/api";
import { getCategoryConfig } from "../lib/categoryRegistry";
import { useSettingsStore, formatChapterHeading, getNextChapterNum } from "../lib/settingsStore";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import { logger } from "../lib/logger";
import { isTemplateSupported, getTemplateCategory } from "../lib/templateSchema";
import { findDirByName } from "../lib/fileTreeUtils";
import { isNovelType } from "../lib/projectType";
import CodexPanel from "./CodexPanel";
import TimelinePanel from "./TimelinePanel";
import CharacterGraphPanel from "./CharacterGraphPanel";

/** Alt+数字键 → 侧边栏分类映射 */
const ALT_CATEGORY_MAP: Record<string, SidebarCategory> = {
  "1": "manuscript",
  "2": "outline",
  "3": "codex",
  "4": "stats",
  "5": "search",
  "6": "characterGraph",
  "7": "timeline",
};

/**
 * 工作台主容器组件
 * 输入: 无（通过 useAppStore 获取当前项目状态）
 * 输出: JSX 三栏布局界面
 * 流程:
 *   1. 从全局 store 读取当前项目与选中文件
 *   2. 加载项目目录树（含失败重试与空状态处理）
 *   3. 渲染三栏布局：左侧 Sidebar + 中间内容区 + 右侧 FileList
 *   4. 根据 activeCategory 切换中间内容（编辑器/设定库/统计/搜索/图谱）
 *   5. 管理对话框层：新建文件、命令面板、设置、聚焦模式、专注计时器
 *   6. 注册全局快捷键：Alt+数字切换分类、Ctrl+K 命令面板、? 快捷键参考、F11 聚焦
 */
export default function Workspace() {
  const currentProject = useAppStore((s) => s.currentProject);
  const selectedFile = useAppStore((s) => s.selectedFile);
  const activeCategory = useAppStore((s) => s.activeCategory);
  const setProjectTree = useAppStore((s) => s.setProjectTree);
  const setLoading = useAppStore((s) => s.setLoading);
  const setActiveCategory = useAppStore((s) => s.setActiveCategory);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  // 模块化模板向导打开状态（角色/世界观/术语/大纲 分类使用）
  const [wizardOpen, setWizardOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [showFocusTimer, setShowFocusTimer] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 设置对话框打开时定位的分区:外观入口按钮传入 appearance,普通设置入口为 undefined
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection | undefined>(undefined);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  // TXT 导出对话框打开状态（Task 3.3.3，与"导出项目归档"并列）
  const [txtExportDialogOpen, setTxtExportDialogOpen] = useState(false);
  const { showToast } = useToast();
  const { t } = useI18n();
  const projectTree = useAppStore((s) => s.projectTree);
  const chapterFormat = useSettingsStore((s) => s.chapterFormat);
  const autoOutlineSkeleton = useSettingsStore((s) => s.autoOutlineSkeleton);
  const autoNumbering = useSettingsStore((s) => s.autoNumbering);

  // 切换前自动保存编辑器脏内容，防止数据丢失
  const saveBeforeSwitch = useCallback(async () => {
    const state = useAppStore.getState();
    if (state.editorDirty) {
      const saveFn = getEditorSaveFn();
      if (saveFn) {
        try { await saveFn(); } catch { /* 保存失败也继续切换 */ }
      }
    }
  }, []);

  // 切换分类前先保存（侧边栏、快捷键、命令面板统一入口）
  const handleSwitchCategory = useCallback(
    async (cat: SidebarCategory) => {
      await saveBeforeSwitch();
      setActiveCategory(cat);
    },
    [saveBeforeSwitch, setActiveCategory]
  );

  // 切换文件前先保存（文件列表入口）
  const handleSelectFile = useCallback(
    async (file: FileNode) => {
      await saveBeforeSwitch();
      useAppStore.getState().setSelectedFile(file);
    },
    [saveBeforeSwitch]
  );

  // 加载项目目录树
  useEffect(() => {
    if (!currentProject) return;
    let cancelled = false;
    setLoading(true);
    readProjectTree(currentProject.path)
      .then((tree) => {
        if (cancelled) return;
        setProjectTree(tree);
      })
      .catch((e) => {
        logger.error("加载目录树失败:", e instanceof Error ? e : String(e));
        if (cancelled) return;
        showToast("error", t("cardmanager.loadFailedShort"));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [currentProject, setProjectTree, setLoading, showToast, t]);

  // Sprint 4 任务 4.5：项目打开时检查 Tantivy 索引状态，首次打开自动后台构建
  // 设计依据：
  //   - 索引不存在（doc_count=0 且 last_built_at 为空）时静默触发全量构建
  //   - 构建过程通过 index-progress 事件推送进度，不在主界面显示（不干扰用户）
  //   - 构建失败仅 logger.error，不弹 toast（避免首次打开项目时干扰）
  //   - 已有索引的项目不触发重建，避免重复开销
  useEffect(() => {
    if (!currentProject) return;
    let cancelled = false;
    const checkAndBuildIndex = async () => {
      try {
        const stats = await getProjectIndexStats(currentProject.path);
        if (cancelled) return;
        // 索引不存在或为空时触发后台构建
        if (stats.doc_count === 0 && !stats.last_built_at) {
          // 静默构建，不等待完成（后台执行）
          buildProjectIndex(currentProject.path).catch((err) => {
            logger.error("后台构建索引失败:", err instanceof Error ? err : String(err));
          });
        }
      } catch (err) {
        // 索引检查失败不影响项目打开，仅记录日志
        logger.error("检查索引状态失败:", err instanceof Error ? err : String(err));
      }
    };
    checkAndBuildIndex();
    return () => { cancelled = true; };
  }, [currentProject]);

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
          handleSwitchCategory(cat);
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
    [commandPaletteOpen, focusMode, showToast, handleSwitchCategory, t]
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

  // 判断正文目录是否为空（用于首次创建判断）
  const isManuscriptEmpty = useMemo(() => {
    if (activeCategory !== "manuscript") return false;
    const manuscriptDir = findDirByName(projectTree, getCategoryDir("manuscript"));
    const existingFiles = manuscriptDir?.children.filter((f) => !f.is_dir) || [];
    return existingFiles.length === 0;
  }, [activeCategory, projectTree]);

  // 首次创建文件对话框状态
  const [showFirstFileDialog, setShowFirstFileDialog] = useState(false);

  // 根据分类和设置生成文件初始内容
  // 修复要点：
  //   1. 尊重 autoNumbering 设置，关闭时不生成章节号前缀和标题
  //   2. 章节标题使用空格分隔（行业通用格式），不再使用全角冒号
  //   3. 移除书名后缀（非标准做法，书名应保留在项目元数据中）
  //   4. 非小说类型不再生成 N. 前缀文件名
  const getFileTemplate = useCallback(
    (fileName: string, category: SidebarCategory, chapterNum?: number): string => {
      // 清洗文件名得到纯标题：去除 .txt 扩展名与可能的前导编号前缀
      const title = fileName.replace(/\.txt$/i, "").replace(/^\d+[._\-\s]*/, "").trim();
      switch (category) {
        case "manuscript": {
          const projectType = currentProject?.meta?.projectType;
          // 通过统一兼容层判定小说族文体（novel/script/essay 3 标准文体）
          // 非小说类型不生成章节号
          const novelType = isNovelType(projectType);
          // 同时满足：小说类文体 + 开启自动编号 + 已计算章节号
          if (chapterNum !== undefined && novelType && autoNumbering) {
            // 生成章节标题（第N章 / 01 / Chapter N），不追加书名
            const heading = formatChapterHeading(chapterNum, "", chapterFormat, false);
            // 用空格连接章节号与章节名（番茄/起点通行格式）
            const line = title ? `${heading} ${title}` : heading;
            return `${line}\n\n`;
          }
          // 非小说类型或关闭自动编号时，仅使用标题作为正文首行
          return `${title}\n\n`;
        }
        case "outline":
          if (autoOutlineSkeleton) {
            return `${title}\n\n一、\n二、\n三、\n四、\n五、\n\n`;
          }
          return `${title}\n\n`;
        default:
          return `${title}\n\n`;
      }
    },
    [autoOutlineSkeleton, chapterFormat, autoNumbering, currentProject]
  );

  // 处理新建文件确认（正文自动编号）
  // 修复要点：
  //   1. 仅对小说类文体 + 开启自动编号时才添加 N. 前缀
  //   2. 非小说类型或关闭自动编号时，文件名即为用户输入（补 .txt）
  //   3. 避免文件名与正文标题不一致的问题
  const handleCreateFile = useCallback(async (fileName: string) => {
    if (!currentProject) throw new Error(t("error.noCurrentProject"));
    const dirName = getCategoryDir(activeCategory);
    const projectType = currentProject.meta.projectType;
    // 通过统一兼容层判定小说族文体（与 getFileTemplate 保持一致）
    const novelType = isNovelType(projectType);

    let finalFileName = fileName;
    let chapterNum: number | undefined;
    if (activeCategory === "manuscript" && novelType && autoNumbering) {
      // 仅小说类文体 + 开启自动编号时才推算章节号并添加前缀
      const manuscriptDir = findDirByName(projectTree, getCategoryDir("manuscript"));
      const existingFiles = manuscriptDir?.children.filter((f) => !f.is_dir) || [];
      const nextNum = getNextChapterNum(existingFiles);
      chapterNum = nextNum;
      // 去掉用户可能输入的编号前缀，避免重复
      const cleanName = fileName.replace(/^\d+[._\-\s]*/, "").trim();
      finalFileName = `${nextNum}.${cleanName}`;
      if (!finalFileName.endsWith(".txt")) finalFileName += ".txt";
    } else {
      // 非小说类型或关闭自动编号：直接使用用户输入的文件名
      if (!finalFileName.endsWith(".txt")) finalFileName += ".txt";
    }

    const relativePath = `${dirName}/${finalFileName}`;
    const templateContent = getFileTemplate(finalFileName, activeCategory, chapterNum);
    await createFile(currentProject.path, relativePath, templateContent);
    const tree = await readProjectTree(currentProject.path);
    setProjectTree(tree);
    showToast("success", t("workspace.fileCreated", { name: finalFileName }));
  }, [currentProject, activeCategory, projectTree, autoNumbering, getFileTemplate, setProjectTree, showToast, t]);

  // 处理向导新建文件确认（接收已渲染的模板内容）
  // 用于角色/世界观/术语/大纲等模板化分类，内容由向导通过后端 render_template 生成
  const handleCreateFileWithContent = useCallback(async (fileName: string, content: string) => {
    if (!currentProject) throw new Error(t("error.noCurrentProject"));
    const dirName = getCategoryDir(activeCategory);
    const relativePath = `${dirName}/${fileName}`;
    await createFile(currentProject.path, relativePath, content);
    const tree = await readProjectTree(currentProject.path);
    setProjectTree(tree);
    showToast("success", t("workspace.fileCreated", { name: fileName }));
  }, [currentProject, activeCategory, setProjectTree, showToast, t]);

  // 首次创建：序章
  const handleCreatePrologue = useCallback(async () => {
    setShowFirstFileDialog(false);
    if (!currentProject) return;
    const dirName = getCategoryDir("manuscript");
    const fileName = t("workspace.defaultIntroFileName");
    const templateContent = `${t("workspace.defaultIntroContent")}\n\n`;
    const relativePath = `${dirName}/${fileName}`;

    await createFile(currentProject.path, relativePath, templateContent);
    const tree = await readProjectTree(currentProject.path);
    setProjectTree(tree);
    showToast("success", t("workspace.fileCreated", { name: fileName }));
  }, [currentProject, setProjectTree, showToast, t]);

  // 首次创建：第一章
  const handleCreateFirstChapter = useCallback(async () => {
    setShowFirstFileDialog(false);
    setCreateDialogOpen(true);
  }, []);

  // 命令面板中触发新建文件
  // 支持模板化分类（角色/世界观/术语/大纲）走向导，其他分类走原对话框
  const handleCommandCreateFile = useCallback(async (category: SidebarCategory) => {
    await handleSwitchCategory(category);
    if (isTemplateSupported(category)) {
      setWizardOpen(true);
    } else {
      setCreateDialogOpen(true);
    }
  }, [handleSwitchCategory]);

  // 新建文件入口：正文首次创建时显示选择对话框
  // 支持模板化分类（角色/世界观/术语/大纲）走向导，其他分类走原对话框
  const handleNewFileRequest = useCallback(() => {
    if (activeCategory === "manuscript" && isManuscriptEmpty) {
      setShowFirstFileDialog(true);
    } else if (isTemplateSupported(activeCategory)) {
      setWizardOpen(true);
    } else {
      setCreateDialogOpen(true);
    }
  }, [activeCategory, isManuscriptEmpty]);

  if (!currentProject) return null;

  const renderMiddlePanel = () => {
    const cfg = getCategoryConfig(activeCategory);
    switch (cfg.panelType) {
      case "stats":
        return <WritingStats />;
      case "search":
        return <GlobalSearch />;
      case "codex":
        return <CodexPanel />;
      case "timeline":
        return <TimelinePanel />;
      case "characterGraph":
        return <CharacterGraphPanel />;
      default:
        return (
          <NovelEditor
            filePath={selectedFilePath}
            focusMode={focusMode}
          />
        );
    }
  };

  return (
    <div className="h-screen w-screen flex bg-nf-bg overflow-hidden relative">
      {/* 全局舒缓柔光背景层:弱化纯色压抑感 */}
      <div className="nf-ambient-bg" />

      {/* 聚焦模式下隐藏侧边栏 */}
      {!focusMode && (
        <Sidebar
          onCreateFile={handleNewFileRequest}
          onOpenSettings={() => { setSettingsInitialSection(undefined); setSettingsOpen(true); }}
          onOpenAppearance={() => { setSettingsInitialSection("appearance"); setSettingsOpen(true); }}
          onSwitchCategory={handleSwitchCategory}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* 专注模式计时器条 */}
        {showFocusTimer && (
          <FocusTimer onClose={() => setShowFocusTimer(false)} />
        )}
        <div className="flex-1 flex min-h-0">
          {/* P2-9 撕裂点修复: key={activeCategory} 确保切换分类时 ErrorBoundary 重置错误状态,
              避免上一个面板的错误 UI 粘连到新面板 */}
          <ErrorBoundary key={activeCategory}>{renderMiddlePanel()}</ErrorBoundary>
        </div>
      </div>

      {/* 右侧文件列表：常驻固定面板，不再随聚焦模式或分类切换隐藏，
          保证布局稳定，避免"活动状态"导致的布局抖动。
          显示规则由 categoryRegistry.showFileList 统一控制：
          - codex：CodexPanel 自身已内嵌右侧实体列表，避免双栏堆叠
          - timeline：画布需独占中右栏以呈现完整图谱
          - stats/search：统计与搜索需全屏展示，不显示文件列表
          P2-9 撕裂点修复: 改为 CSS 隐藏(display:none)而非条件渲染,
          保留 FileList 内部状态(目录展开/滚动位置/选中高亮),避免布局抖动 */}
      {!focusMode && (
        <div
          className={`relative z-10 flex flex-shrink-0 ${
            getCategoryConfig(activeCategory).showFileList ? "" : "hidden"
          }`}
        >
          <FileList onCreateFile={handleNewFileRequest} onSelectFile={handleSelectFile} />
        </div>
      )}

      <CreateFileDialog
        open={createDialogOpen}
        dirName={getCategoryDir(activeCategory)}
        onClose={() => setCreateDialogOpen(false)}
        onConfirm={handleCreateFile}
      />

      {/* 模块化模板向导（角色/世界观/术语/大纲分类使用） */}
      <CreateFileWizard
        open={wizardOpen}
        dirName={getCategoryDir(activeCategory)}
        templateCategory={getTemplateCategory(activeCategory) ?? ""}
        onClose={() => setWizardOpen(false)}
        onConfirm={handleCreateFileWithContent}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onCreateFile={handleCommandCreateFile}
        onSwitchCategory={handleSwitchCategory}
        onExportProject={() => setExportDialogOpen(true)}
        onExportTxt={() => setTxtExportDialogOpen(true)}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialSection={settingsInitialSection}
      />

      {/* 项目导出对话框（归档模式） */}
      <ProjectArchiveDialog
        open={exportDialogOpen}
        mode="export"
        projectPath={currentProject?.path}
        projectName={currentProject?.meta?.name}
        onClose={() => setExportDialogOpen(false)}
      />

      {/* 项目导出对话框（TXT 模式，Task 3.3.3） */}
      <ProjectArchiveDialog
        open={txtExportDialogOpen}
        mode="export-txt"
        projectPath={currentProject?.path}
        projectName={currentProject?.meta?.name}
        onClose={() => setTxtExportDialogOpen(false)}
      />

      {/* 首次创建文件选择对话框 */}
      {showFirstFileDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
          onClick={(e) => { if (e.target === e.currentTarget) setShowFirstFileDialog(false); }}
        >
          <div className="nf-glass-panel w-full max-w-sm bg-nf-bg-card border border-nf-border-light shadow-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-nf-border-light">
              <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text">
                {t("workspace.firstFileTitle")}
              </h3>
              <p className="text-xs text-nf-text-tertiary mt-1">
                {t("workspace.firstFileHint")}
              </p>
            </div>
            <div className="px-5 py-4 space-y-2">
              <button
                onClick={handleCreatePrologue}
                className="w-full flex items-center gap-3 px-4 py-3 text-left border border-nf-border-light hover:border-fandex-primary/50 hover:bg-fandex-primary/5 transition-all duration-fast group"
              >
                <div className="w-8 h-8 flex items-center justify-center bg-fandex-secondary/10 text-fandex-secondary text-sm font-bold">
                  {t("workspace.introBadge")}
                </div>
                <div>
                  <div className="text-sm font-medium text-nf-text group-hover:text-fandex-primary transition-colors">
                    {t("workspace.createPrologue")}
                  </div>
                  <div className="text-xs text-nf-text-tertiary">
                    {t("workspace.prologueHint")}
                  </div>
                </div>
              </button>
              <button
                onClick={handleCreateFirstChapter}
                className="w-full flex items-center gap-3 px-4 py-3 text-left border border-nf-border-light hover:border-fandex-primary/50 hover:bg-fandex-primary/5 transition-all duration-fast group"
              >
                <div className="w-8 h-8 flex items-center justify-center bg-fandex-primary/10 text-fandex-primary text-sm font-bold">
                  1
                </div>
                <div>
                  <div className="text-sm font-medium text-nf-text group-hover:text-fandex-primary transition-colors">
                    {t("workspace.createFirstChapter")}
                  </div>
                  <div className="text-xs text-nf-text-tertiary">
                    {t("workspace.firstChapterHint")}
                  </div>
                </div>
              </button>
            </div>
            <div className="flex justify-end px-5 py-3 border-t border-nf-border-light">
              <button
                onClick={() => setShowFirstFileDialog(false)}
                className="h-8 px-4 text-sm flex items-center justify-center gap-1.5 border border-nf-border-light text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
              >
                {t("app.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
