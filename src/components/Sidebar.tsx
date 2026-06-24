// 工作台左侧导航栏组件
//
// 功能概述：
// 显示项目分类导航(角色/世界观/名词/时间线/正文/大纲/素材)，
// 类似 VS Code 的资源管理器。点击分类切换中间内容。
// 采用紧凑布局，宽度缩窄至 160px。
//
// 模块职责：
// 1. 渲染项目名称与返回按钮
// 2. 渲染分类导航列表
// 3. 高亮当前选中分类
// 4. 触发分类切换

import {
  Users,
  Globe,
  BookMarked,
  GitBranch,
  FileText,
  ListTree,
  FolderOpen,
  ChevronLeft,
  Plus,
  Sun,
  Moon,
} from "lucide-react";
import {
  useAppStore,
  CATEGORY_NAMES,
  type SidebarCategory,
} from "../lib/store";
import { useThemeStore } from "../lib/themeStore";

// 图标映射
const ICON_MAP: Record<SidebarCategory, React.ComponentType<{ className?: string }>> = {
  characters: Users,
  worldview: Globe,
  glossary: BookMarked,
  timeline: GitBranch,
  manuscript: FileText,
  outline: ListTree,
  materials: FolderOpen,
};

// 分类列表(按显示顺序)
const CATEGORIES: SidebarCategory[] = [
  "manuscript",
  "characters",
  "worldview",
  "glossary",
  "timeline",
  "outline",
  "materials",
];

// 左侧导航栏属性接口
interface SidebarProps {
  // 新建文件回调
  onCreateFile: () => void;
}

// 左侧导航栏组件
// 输入: onCreateFile 新建文件回调
// 输出: 渲染导航栏
// 流程:
//   1. 顶部显示项目名称与返回按钮
//   2. 中间显示分类列表
//   3. 底部显示主题切换与新建文件按钮
export default function Sidebar({ onCreateFile }: SidebarProps) {
  const { currentProject, activeCategory, setActiveCategory, closeProject } =
    useAppStore();
  const { theme, toggleTheme } = useThemeStore();

  return (
    <div className="w-40 min-w-[150px] border-r border-nf-border-light bg-nf-bg-sidebar flex flex-col">
      {/* 顶部: 项目名称与返回 */}
      <div className="px-3 py-3 border-b border-nf-border-light">
        <button
          onClick={closeProject}
          className="flex items-center gap-1 text-xs text-nf-text-tertiary hover:text-fandex-primary transition-fast mb-1.5"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          返回
        </button>
        <h1 className="text-sm font-semibold text-nf-text truncate" title={currentProject?.meta.name}>
          {currentProject?.meta.name || "未命名项目"}
        </h1>
        <div className="text-[11px] text-nf-text-tertiary mt-0.5 truncate">
          {currentProject?.meta.author || "匿名作者"}
        </div>
      </div>

      {/* 中间: 分类导航 */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-3 py-1 text-[10px] font-semibold text-nf-text-tertiary uppercase tracking-wider">
          分类
        </div>
        {CATEGORIES.map((cat) => {
          const Icon = ICON_MAP[cat];
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              title={CATEGORY_NAMES[cat]}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-fast ${
                isActive
                  ? "bg-fandex-primary/10 text-fandex-primary border-r-2 border-fandex-primary"
                  : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{CATEGORY_NAMES[cat]}</span>
            </button>
          );
        })}
      </div>

      {/* 底部: 主题切换与新建文件按钮 */}
      <div className="px-2 py-2 border-t border-nf-border-light space-y-1.5">
        <button
          onClick={toggleTheme}
          title={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-nf-text-secondary hover:text-fandex-tertiary border border-nf-border-light hover:border-fandex-tertiary/50 rounded-lg transition-fast"
        >
          {theme === "dark" ? (
            <Sun className="w-3.5 h-3.5" />
          ) : (
            <Moon className="w-3.5 h-3.5" />
          )}
          {theme === "dark" ? "亮色" : "暗色"}
        </button>
        <button
          onClick={onCreateFile}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-nf-text-secondary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/50 rounded-lg transition-fast"
        >
          <Plus className="w-3.5 h-3.5" />
          新建文件
        </button>
      </div>
    </div>
  );
}
