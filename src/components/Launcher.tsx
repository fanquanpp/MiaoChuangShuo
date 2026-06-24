// 启动器主组件
//
// 功能概述：
// NovelForge 应用的启动界面，负责项目创建、导入与历史项目展示。
// 采用 FANDEX 美术风格：直角按钮、左侧色条装饰、1px 网格间距、毛玻璃面板。
//
// 模块职责：
// 1. 左侧面板: Logo + 新建项目按钮 + 模板列表
// 2. 右侧面板: 搜索框 + 项目卡片网格 + 导入入口
// 3. 管理创建项目对话框的显示状态
// 4. 扫描本地项目并展示

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wand2, Plus, Search, FolderPlus } from "lucide-react";
import TemplateSelector from "./TemplateSelector";
import ProjectCard, { type ProjectData } from "./ProjectCard";
import CreateProjectDialog from "./CreateProjectDialog";
import {
  scanProjects,
  importProject,
  pickDirectory,
  type ProjectInfo,
  type ProjectType,
} from "../lib/api";
import { useAppStore } from "../lib/store";

// 启动器主组件
// 输入: 无
// 输出: 左右分栏的启动器界面
// 流程:
//   1. 左侧(30%): Logo + 新建项目按钮 + 模板展开列表
//   2. 右侧(70%): 搜索框 + 项目卡片网格 + 导入项目卡片
//   3. 点击模板打开创建对话框
//   4. 创建成功后打开项目
export default function Launcher() {
  const [showTemplates, setShowTemplates] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<ProjectType>("standard");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [scanDir, setScanDir] = useState<string>("");
  const { openProject } = useAppStore();

  // 初始化: 尝试从 localStorage 读取上次扫描目录
  useEffect(() => {
    const savedDir = localStorage.getItem("novelforge_last_dir");
    if (savedDir) {
      setScanDir(savedDir);
      loadProjects(savedDir);
    }
  }, []);

  const loadProjects = async (dir: string) => {
    try {
      const list = await scanProjects(dir);
      setProjects(list);
    } catch (e) {
      console.error("扫描项目失败:", e);
    }
  };

  const handleSelectTemplate = (typeId: string) => {
    setSelectedType(typeId as ProjectType);
    setDialogOpen(true);
    setShowTemplates(false);
  };

  const handleCreateSuccess = async (projectPath: string) => {
    setDialogOpen(false);
    const parentDir = projectPath.substring(0, projectPath.lastIndexOf("\\"));
    setScanDir(parentDir);
    localStorage.setItem("novelforge_last_dir", parentDir);
    try {
      const list = await scanProjects(parentDir);
      setProjects(list);
      const newProject = list.find((p) => p.path === projectPath);
      if (newProject) {
        openProject(newProject);
      }
    } catch (e) {
      console.error("刷新项目列表失败:", e);
    }
  };

  const handleImport = async () => {
    try {
      const dir = await pickDirectory();
      if (!dir) return;
      const info = await importProject(dir);
      const parentDir = dir.substring(0, dir.lastIndexOf("\\"));
      setScanDir(parentDir);
      localStorage.setItem("novelforge_last_dir", parentDir);
      loadProjects(parentDir);
      console.log("导入成功:", info);
    } catch (e) {
      console.error("导入失败:", e);
      alert(`导入失败: ${e}`);
    }
  };

  const handlePickScanDir = async () => {
    const dir = await pickDirectory();
    if (dir) {
      setScanDir(dir);
      localStorage.setItem("novelforge_last_dir", dir);
      loadProjects(dir);
    }
  };

  // 将后端 ProjectInfo 转换为前端 ProjectData
  const toCardData = (info: ProjectInfo): ProjectData => {
    const typeMap: Record<string, { color: string; gradient: string }> = {
      epic: {
        color: "text-fandex-tertiary bg-fandex-tertiary/10 border-fandex-tertiary/30",
        gradient: "from-fandex-tertiary to-fandex-primary",
      },
      standard: {
        color: "text-fandex-primary bg-fandex-primary/10 border-fandex-primary/30",
        gradient: "from-fandex-primary to-fandex-secondary",
      },
      essay: {
        color: "text-fandex-secondary bg-fandex-secondary/10 border-fandex-secondary/30",
        gradient: "from-fandex-secondary to-fandex-primary",
      },
      script: {
        color: "text-fandex-primary bg-fandex-primary/10 border-fandex-primary/30",
        gradient: "from-fandex-primary to-fandex-tertiary",
      },
    };
    const typeKey = info.meta.type.toLowerCase();
    const typeStyle = typeMap[typeKey] || typeMap.standard;
    return {
      id: info.path,
      name: info.meta.name,
      type: info.meta.type,
      typeColor: typeStyle.color,
      words: formatWordCount(info.word_count),
      chapters: info.chapter_count,
      updated: formatTimeAgo(info.meta.updated_at),
      gradient: typeStyle.gradient,
    };
  };

  const filteredProjects = projects.filter((p) =>
    p.meta.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-screen w-screen flex bg-nf-bg text-nf-text font-sans select-none overflow-hidden">
      {/* 左侧面板: 30% 宽度 - FANDEX 毛玻璃 + 左侧色条 */}
      <div className="w-[30%] min-w-[320px] max-w-[400px] border-r border-nf-border-light bg-nf-bg-sidebar p-6 flex flex-col justify-between">
        <div className="space-y-6">
          {/* Logo 区域 - FANDEX 方块标记风格 */}
          <div className="flex items-center gap-3 py-2">
            <div className="w-8 h-8 bg-fandex-primary flex items-center justify-center font-display font-extrabold text-nf-bg text-lg">
              N
            </div>
            <span className="text-2xl font-bold font-display tracking-wide text-nf-text">
              NovelForge
            </span>
          </div>

          {/* 新建项目按钮 - FANDEX 直角主色按钮 */}
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="w-full py-3 px-4 bg-fandex-primary hover:bg-fandex-primary-hover font-medium flex items-center justify-center gap-2 transition-fast transform active:scale-[0.98] text-nf-text-inverse"
          >
            <Plus className={`w-5 h-5 transition-fast ${showTemplates ? "rotate-45" : ""}`} />
            创建全新项目
          </button>

          {/* 模板展开动画 */}
          <AnimatePresence>
            {showTemplates && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
                className="overflow-hidden"
              >
                <TemplateSelector onSelect={handleSelectTemplate} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* 扫描目录选择 - FANDEX 左侧色条装饰 */}
          {scanDir && (
            <div className="fandex-bar-left text-xs text-nf-text-tertiary">
              <div className="mb-1 text-nf-text-secondary">扫描目录</div>
              <div className="truncate text-nf-text">{scanDir}</div>
              <button
                onClick={handlePickScanDir}
                className="mt-1 text-fandex-primary hover:text-fandex-primary-hover transition-fast"
              >
                更改目录
              </button>
            </div>
          )}
          {!scanDir && (
            <button
              onClick={handlePickScanDir}
              className="fandex-bar-left text-xs text-fandex-primary hover:text-fandex-primary-hover transition-fast"
            >
              设置项目扫描目录
            </button>
          )}
        </div>

        {/* 底部版本与状态 */}
        <div className="text-xs text-nf-text-tertiary flex justify-between items-center border-t border-nf-border-light pt-4">
          <span>v1.0.0</span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-fandex-secondary"></span>
            本地环境就绪
          </span>
        </div>
      </div>

      {/* 右侧面板: 70% 宽度 */}
      <div className="flex-1 flex flex-col bg-nf-bg p-8 overflow-y-auto">
        {/* 搜索区域 - FANDEX 左侧色条标题 */}
        <div className="flex justify-between items-center mb-8 gap-4">
          <h2 className="fandex-bar-left text-xl font-bold font-display tracking-tight text-nf-text">
            {projects.length > 0 ? `最近创作项目 (${projects.length})` : "最近创作项目"}
          </h2>
          <div className="relative w-72 group">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-nf-text-tertiary group-focus-within:text-fandex-primary transition-fast" />
            <input
              type="text"
              placeholder="搜索项目名称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-nf-bg-card border border-nf-border-light pl-10 pr-4 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary transition-fast"
            />
          </div>
        </div>

        {/* 项目卡片网格 - FANDEX 1px 间距网格 */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-1 bg-nf-border-light border border-nf-border-light">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.path}
              project={toCardData(project)}
              projectInfo={project}
            />
          ))}

          {/* 导入本地项目卡片 */}
          <div
            onClick={handleImport}
            className="border-2 border-dashed border-nf-border-light hover:border-fandex-primary bg-nf-bg p-6 flex flex-col justify-center items-center gap-3 text-nf-text-tertiary hover:text-fandex-primary transition-fast cursor-pointer min-h-[168px] group"
          >
            <div className="p-3 bg-nf-bg-card group-hover:bg-nf-bg-hover border border-nf-border-light group-hover:border-fandex-primary transition-fast">
              <FolderPlus className="w-6 h-6 text-nf-text-tertiary group-hover:text-fandex-primary transition-fast" />
            </div>
            <span className="text-sm font-medium">导入本地已存项目</span>
          </div>
        </div>

        {/* 空状态提示 */}
        {projects.length === 0 && !scanDir && (
          <div className="flex-1 flex items-center justify-center text-center py-20">
            <div>
              <Wand2 className="w-16 h-16 text-nf-border mx-auto mb-4" />
              <h3 className="fandex-bar-left inline-block text-lg font-medium font-display text-nf-text-secondary mb-2">
                欢迎使用 NovelForge
              </h3>
              <p className="text-sm text-nf-text-tertiary">
                点击左侧"创建全新项目"开始你的创作之旅
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 创建项目对话框 */}
      <AnimatePresence>
        {dialogOpen && (
          <CreateProjectDialog
            defaultType={selectedType}
            onClose={() => setDialogOpen(false)}
            onSuccess={handleCreateSuccess}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// 格式化字数显示
function formatWordCount(count: number): string {
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)} 万字`;
  }
  return `${count} 字`;
}

// 格式化时间为"多久前"
function formatTimeAgo(isoTime: string): string {
  try {
    const time = new Date(isoTime);
    const now = new Date();
    const diff = now.getTime() - time.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 30) return `${days} 天前`;
    return time.toLocaleDateString("zh-CN");
  } catch {
    return "未知";
  }
}
