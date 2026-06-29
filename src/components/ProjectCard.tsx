// 项目卡片组件
//
// 功能概述：
// 渲染单张项目卡片，展示项目名称、类型、字数、章节数、更新时间。
// 采用 FANDEX 美术风格，优化视觉层次与信息密度。
// 支持键盘导航和删除操作。

import { memo, useCallback, useMemo } from "react";
import { Clock, BarChart3, BookOpen, Trash2, Sparkles } from "lucide-react";
import { useAppStore } from "../lib/store";
import type { ProjectInfo } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useAutoSaveOnExit } from "../hooks/useAutoSaveOnExit";

export interface ProjectData {
  id: string;
  name: string;
  type: string;
  typeColor: string;
  words: string;
  chapters: number;
  updated: string;
  gradient: string;
}

export interface ProjectCardProps {
  project: ProjectData;
  projectInfo?: ProjectInfo;
  onDelete?: (project: ProjectInfo) => void;
}

function ProjectCardImpl({ project, projectInfo, onDelete }: ProjectCardProps) {
  const { handleSwitchProject } = useAutoSaveOnExit();
  const { t } = useI18n();

  const handleClick = useCallback(() => {
    if (!projectInfo) return;
    const currentProject = useAppStore.getState().currentProject;
    if (currentProject) {
      handleSwitchProject(projectInfo);
    } else {
      useAppStore.getState().openProject(projectInfo);
    }
  }, [handleSwitchProject, projectInfo]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick]
  );

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (projectInfo && onDelete) {
        onDelete(projectInfo);
      }
    },
    [projectInfo, onDelete]
  );

  const handleDeleteKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        if (projectInfo && onDelete) {
          onDelete(projectInfo);
        }
      }
    },
    [projectInfo, onDelete]
  );

  // 生成基于项目名称的伪随机装饰图案
  const patternSeed = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < project.name.length; i++) {
      hash = ((hash << 5) - hash) + project.name.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % 360;
  }, [project.name]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t("projectcard.openProject") + ": " + project.name}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="group relative bg-nf-bg-card border border-nf-border-light hover:border-fandex-primary/50 transition-all duration-300 cursor-pointer flex flex-col overflow-hidden focus:outline-none focus:ring-1 focus:ring-fandex-primary focus:ring-inset hover:shadow-xl hover:shadow-black/30 hover:-translate-y-0.5"
    >
      {/* 顶部渐变封面区 - 增加高度和视觉层次 */}
      <div className={`relative h-24 bg-gradient-to-br ${project.gradient} overflow-hidden`}>
        {/* 动态装饰图案 - 基于项目名生成 */}
        <div 
          className="absolute inset-0 opacity-15"
          style={{
            backgroundImage: `
              radial-gradient(circle at 20% 30%, rgba(255,255,255,0.3) 0%, transparent 40%),
              radial-gradient(circle at 80% 70%, rgba(0,0,0,0.2) 0%, transparent 50%),
              repeating-linear-gradient(${patternSeed}deg, transparent, transparent 12px, rgba(255,255,255,0.08) 12px, rgba(255,255,255,0.08) 13px)
            `,
          }}
        />
        
        {/* 装饰图标 - 右下角 */}
        <div className="absolute bottom-3 right-3 opacity-20 group-hover:opacity-30 transition-opacity duration-300">
          <Sparkles className="w-8 h-8 text-white" strokeWidth={1.5} />
        </div>

        {/* 类型标签 - 左上角悬浮 */}
        <span className={`absolute top-3 left-3 text-[10px] font-semibold px-2.5 py-1 backdrop-blur-md border ${project.typeColor} shadow-sm`}>
          {project.type}
        </span>

        {/* 删除按钮 - 右上角，hover 显示 */}
        {onDelete && projectInfo && (
          <button
            onClick={handleDeleteClick}
            onKeyDown={handleDeleteKeyDown}
            title={t("projectcard.deleteTooltip")}
            aria-label={t("projectcard.deleteProject") + ": " + project.name}
            className="absolute top-2 right-2 z-10 p-1.5 bg-black/40 backdrop-blur-md border border-white/20 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto text-white/80 hover:text-red-300 hover:border-red-400/50 hover:bg-red-500/20 transition-all duration-200"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}

        {/* 底部渐变过渡 */}
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-nf-bg-card to-transparent" />
      </div>

      {/* 内容区 - 优化信息层次 */}
      <div className="px-4 pt-3 pb-4 flex-1 flex flex-col">
        {/* 项目名称 - 主标题 */}
        <h3 className="text-base font-bold font-display text-nf-text group-hover:text-fandex-primary transition-colors duration-200 tracking-tight line-clamp-2 mb-2 leading-snug">
          {project.name}
        </h3>

        {/* 统计信息 - 横向分布 */}
        <div className="mt-auto grid grid-cols-3 gap-2 pt-3 border-t border-nf-border-light/50">
          <div className="flex items-center gap-1.5 text-xs text-nf-text-tertiary" title={t("projectcard.totalWords")}>
            <BarChart3 className="w-3 h-3 text-fandex-primary/70" />
            <span className="truncate">{project.words}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-nf-text-tertiary" title={t("projectcard.chapters")}>
            <BookOpen className="w-3 h-3 text-fandex-secondary/70" />
            <span className="truncate">{project.chapters} {t("projectcard.chapterUnit")}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-nf-text-tertiary" title={t("projectcard.lastUpdate")}>
            <Clock className="w-3 h-3 text-fandex-tertiary/70" />
            <span className="truncate">{project.updated}</span>
          </div>
        </div>
      </div>

      {/* 底部进度条装饰 - hover 时展开 */}
      <div className="h-0.5 w-full bg-gradient-to-r from-fandex-primary via-fandex-secondary to-fandex-tertiary opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
    </div>
  );
}

const ProjectCard = memo(ProjectCardImpl);
export default ProjectCard;
