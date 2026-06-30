// 项目卡片组件（低宽型布局）
//
// 功能概述：
// 渲染单张项目卡片，采用低宽型设计减少垂直空白，增加信息密度。
// 左侧渐变色条 + 右侧信息区的横向布局。
// 支持键盘导航和删除操作。

import { memo, useCallback, useMemo } from "react";
import { Clock, BarChart3, BookOpen, Trash2 } from "lucide-react";
import { useAppStore } from "../lib/store";
import type { ProjectInfo } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useAutoSaveOnExit } from "../hooks/useAutoSaveOnExit";

/** 项目卡片展示数据（由上层从 ProjectInfo 转换而来） */
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

/** ProjectCard 组件属性 */
export interface ProjectCardProps {
  project: ProjectData;
  projectInfo?: ProjectInfo;
  onDelete?: (project: ProjectInfo) => void;
}

/**
 * 项目卡片实现组件
 * 输入:
 *   - project: 卡片展示数据（名称、类型、字数等）
 *   - projectInfo: 原始项目信息（用于打开/删除操作）
 *   - onDelete: 删除回调（可选）
 * 输出: JSX 卡片元素
 * 流程:
 *   1. 点击卡片时，若当前已有打开项目则走切换流程，否则直接打开
 *   2. 支持键盘 Enter/Space 触发点击（无障碍）
 *   3. 删除按钮悬浮显示，阻止事件冒泡避免触发卡片点击
 */
function ProjectCardImpl({ project, projectInfo, onDelete }: ProjectCardProps) {
  const { handleSwitchProject } = useAutoSaveOnExit();
  const { t } = useI18n();

  /** 卡片点击：打开项目或切换项目 */
  const handleClick = useCallback(() => {
    if (!projectInfo) return;
    const currentProject = useAppStore.getState().currentProject;
    if (currentProject) {
      handleSwitchProject(projectInfo);
    } else {
      useAppStore.getState().openProject(projectInfo);
    }
  }, [handleSwitchProject, projectInfo]);

  /** 键盘事件：Enter/Space 触发点击 */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick]
  );

  /** 删除按钮点击：阻止冒泡并触发 onDelete 回调 */
  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (projectInfo && onDelete) {
        onDelete(projectInfo);
      }
    },
    [projectInfo, onDelete]
  );

  /** 删除按钮键盘事件：Enter/Space 触发删除 */
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

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t("projectcard.openProject") + ": " + project.name}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="group relative bg-nf-bg-card backdrop-blur-none border border-nf-border-light hover:border-fandex-primary/50 transition-all duration-300 cursor-pointer flex overflow-hidden focus:outline-none focus:ring-1 focus:ring-fandex-primary focus:ring-inset hover:shadow-lg hover:shadow-black/20"
      style={{ backgroundColor: 'var(--fandex-bg-card)' }}
    >
      {/* 左侧渐变色条 */}
      <div className={`w-1.5 flex-shrink-0 bg-gradient-to-b ${project.gradient}`} />

      {/* 主内容区 */}
      <div className="flex-1 min-w-0 px-4 py-3 flex flex-col gap-2">
        {/* 顶部行：项目名 + 类型标签 + 删除按钮 */}
        <div className="flex items-start gap-2">
          <h3 className="flex-1 min-w-0 text-sm font-bold font-display text-nf-text group-hover:text-fandex-primary transition-colors duration-200 truncate leading-snug">
            《{project.name}》
          </h3>
          <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 border ${project.typeColor}`}>
            {project.type}
          </span>
          {onDelete && projectInfo && (
            <button
              onClick={handleDeleteClick}
              onKeyDown={handleDeleteKeyDown}
              title={t("projectcard.deleteTooltip")}
              aria-label={t("projectcard.deleteProject") + ": " + project.name}
              className="flex-shrink-0 p-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto text-nf-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 底部行：统计信息 */}
        <div className="flex items-center gap-4 text-xs text-nf-text-tertiary">
          <div className="flex items-center gap-1" title={t("projectcard.totalWords")}>
            <BarChart3 className="w-3 h-3 text-fandex-primary/70" />
            <span className="tabular-nums">{project.words}</span>
          </div>
          <div className="flex items-center gap-1" title={t("projectcard.chapters")}>
            <BookOpen className="w-3 h-3 text-fandex-secondary/70" />
            <span className="tabular-nums">{project.chapters} {t("projectcard.chapterUnit")}</span>
          </div>
          <div className="flex items-center gap-1 ml-auto" title={t("projectcard.lastUpdate")}>
            <Clock className="w-3 h-3 text-fandex-tertiary/70" />
            <span className="truncate">{project.updated}</span>
          </div>
        </div>
      </div>

      {/* 底部进度条装饰 */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-fandex-primary via-fandex-secondary to-fandex-tertiary opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
    </div>
  );
}

const ProjectCard = memo(ProjectCardImpl);
export default ProjectCard;
