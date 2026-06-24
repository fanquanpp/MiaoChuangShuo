// 项目卡片组件
//
// 功能概述：
// 渲染单张项目卡片，展示项目名称、类型、字数、更新时间。
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

  // 处理卡片点击
  // 输入: 无
  // 输出: 无
  // 流程: 如果有 projectInfo 则打开项目
  const handleClick = () => {
    if (projectInfo) {
      openProject(projectInfo);
    }
  };

  return (
    <div
      onClick={handleClick}
      className="group bg-nf-bg-card/40 border border-nf-border-light hover:border-fandex-primary/30 rounded-2xl overflow-hidden shadow-md hover:shadow-lg transition-base transform hover:-translate-y-1 cursor-pointer flex flex-col min-h-[168px]"
    >
      {/* 渐变头部区域 */}
      <div className={`h-10 bg-gradient-to-r ${project.gradient} opacity-70 group-hover:opacity-90 transition-base relative`}>
        <div className="absolute -bottom-3 left-4">
          <span className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full border ${project.typeColor} shadow-sm backdrop-blur-md`}>
            {project.type}
          </span>
        </div>
      </div>

      {/* 卡片主体 */}
      <div className="px-4 pt-5 pb-3 flex-1 flex flex-col">
        <h3 className="text-base font-semibold text-nf-text group-hover:text-fandex-primary transition-fast tracking-tight line-clamp-1 mb-3">
          {project.name}
        </h3>

        {/* 项目元数据底部栏 */}
        <div className="mt-auto flex items-center justify-between text-xs text-nf-text-tertiary border-t border-nf-border-light pt-2.5">
          <div className="flex items-center gap-1" title="总字数">
            <BarChart3 className="w-3 h-3 text-nf-text-tertiary" />
            <span>{project.words}</span>
          </div>
          <div className="flex items-center gap-1" title="正文章节数">
            <BookOpen className="w-3 h-3 text-nf-text-tertiary" />
            <span>{project.chapters} 章</span>
          </div>
          <div className="flex items-center gap-1" title="最后更新">
            <Clock className="w-3 h-3 text-nf-text-tertiary" />
            <span>{project.updated}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
