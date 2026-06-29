// 项目卡片组件
//
// 功能概述：
// 渲染单张项目卡片，展示项目名称、类型、字数、章节数、更新时间。
// 采用 FANDEX 美术风格
//
// 模块职责：
// 1. 渲染渐变头部与类型标签
// 2. 显示项目名称与元数据
// 3. 悬浮动画效果
// 4. 点击触发打开项目

import { Clock, BarChart3, BookOpen } from "lucide-react";
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
}

export default function ProjectCard({ project, projectInfo }: ProjectCardProps) {
  const { currentProject } = useAppStore();
  const { handleSwitchProject } = useAutoSaveOnExit();
  const { t } = useI18n();

  const handleClick = () => {
    if (projectInfo) {
      // 如果当前已有项目打开，走保存→切换流程；否则直接打开
      if (currentProject) {
        handleSwitchProject(projectInfo);
      } else {
        useAppStore.getState().openProject(projectInfo);
      }
    }
  };

  return (
    <div
      onClick={handleClick}
      className="group bg-nf-bg hover:bg-nf-bg-hover border-r border-b border-nf-border-light hover:border-fandex-primary transition-fast cursor-pointer flex flex-col min-h-[168px] relative"
    >
      <div className={`h-1 bg-gradient-to-r ${project.gradient}`}></div>

      <div className="px-4 pt-4 pb-3 flex-1 flex flex-col">
        <span className={`inline-block self-start text-[10px] font-medium px-1.5 py-0.5 mb-2 ${project.typeColor}`}>
          {project.type}
        </span>

        <h3 className="fandex-bar-left text-base font-bold font-display text-nf-text group-hover:text-fandex-primary transition-fast tracking-tight line-clamp-1 mb-3">
          {project.name}
        </h3>

        <div className="mt-auto flex items-center justify-between text-xs text-nf-text-tertiary border-t border-nf-border-light pt-2.5">
          <div className="flex items-center gap-1" title={t("projectcard.totalWords")}>
            <BarChart3 className="w-3 h-3" />
            <span>{project.words}</span>
          </div>
          <div className="flex items-center gap-1" title={t("projectcard.chapters")}>
            <BookOpen className="w-3 h-3" />
            <span>{project.chapters} {t("projectcard.chapterUnit")}</span>
          </div>
          <div className="flex items-center gap-1" title={t("projectcard.lastUpdate")}>
            <Clock className="w-3 h-3" />
            <span>{project.updated}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
