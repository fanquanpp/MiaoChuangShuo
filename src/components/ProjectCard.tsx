// 项目卡片组件
//
// 功能概述：
// 渲染单张项目卡片，展示项目名称、类型、字数、章节数、更新时间。
// 采用 FANDEX 美术风格：直角、1px 网格背景、左侧色条装饰。
// 点击卡片打开项目进入工作台。
//
// 模块职责：
// 1. 渲染渐变头部与类型标签
// 2. 显示项目名称与元数据
// 3. 悬浮动画效果
// 4. 点击触发打开项目

import { Clock, BarChart3, BookOpen } from "lucide-react";
import { useAppStore } from "../lib/store";
import type { ProjectInfo } from "../lib/api";

// 项目卡片数据接口(用于显示)
export interface ProjectData {
  id: string;
  name: string;
  type: string;
  typeColor: string;
  // 总字数(已格式化)
  words: string;
  // 正文章节总数
  chapters: number;
  updated: string;
  gradient: string;
}

// 后端项目信息(用于打开项目)
export interface ProjectCardProps {
  project: ProjectData;
  projectInfo?: ProjectInfo;
}

// 项目卡片组件
// 输入: project 显示数据, projectInfo 后端信息
// 输出: 渲染项目卡片
// 流程: 渲染卡片,点击时调用 openProject
export default function ProjectCard({ project, projectInfo }: ProjectCardProps) {
  const { openProject } = useAppStore();

  const handleClick = () => {
    if (projectInfo) {
      openProject(projectInfo);
    }
  };

  return (
    <div
      onClick={handleClick}
      className="group bg-nf-bg hover:bg-nf-bg-hover border-r border-b border-nf-border-light hover:border-fandex-primary transition-fast cursor-pointer flex flex-col min-h-[168px] relative"
    >
      {/* 渐变头部区域 - FANDEX 直角 */}
      <div className={`h-1 bg-gradient-to-r ${project.gradient}`}></div>

      {/* 卡片主体 */}
      <div className="px-4 pt-4 pb-3 flex-1 flex flex-col">
        {/* 类型标签 - FANDEX 直角小标签 */}
        <span className={`inline-block self-start text-[10px] font-medium px-1.5 py-0.5 mb-2 ${project.typeColor}`}>
          {project.type}
        </span>

        {/* 项目名称 - FANDEX 左侧色条装饰 */}
        <h3 className="fandex-bar-left text-base font-bold font-display text-nf-text group-hover:text-fandex-primary transition-fast tracking-tight line-clamp-1 mb-3">
          {project.name}
        </h3>

        {/* 项目元数据底部栏 - FANDEX 直角 */}
        <div className="mt-auto flex items-center justify-between text-xs text-nf-text-tertiary border-t border-nf-border-light pt-2.5">
          <div className="flex items-center gap-1" title="总字数">
            <BarChart3 className="w-3 h-3" />
            <span>{project.words}</span>
          </div>
          <div className="flex items-center gap-1" title="正文章节数">
            <BookOpen className="w-3 h-3" />
            <span>{project.chapters} 章</span>
          </div>
          <div className="flex items-center gap-1" title="最后更新">
            <Clock className="w-3 h-3" />
            <span>{project.updated}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
