import React from "react";
import { Clock, BarChart3 } from "lucide-react";

// 项目卡片属性接口
export interface ProjectData {
  id: string;
  name: string;
  type: string;
  typeColor: string;
  words: string;
  updated: string;
  gradient: string;
}

// 项目卡片组件 - FANDEX 美术风格
// 输入: project 项目数据对象
// 输出: 渲染单张项目卡片
// 流程: 渲染渐变头部、类型标签、项目名称、字数与更新时间
export default function ProjectCard({ project }: { project: ProjectData }) {
  return (
    <div className="group bg-nf-bg-card/40 border border-nf-border-light hover:border-fandex-primary/30 rounded-2xl overflow-hidden shadow-md hover:shadow-lg transition-base transform hover:-translate-y-1 cursor-pointer flex flex-col justify-between min-h-[180px]">
      {/* 渐变头部区域 - FANDEX 品牌色渐变 */}
      <div className={`h-12 bg-gradient-to-r ${project.gradient} opacity-70 group-hover:opacity-90 transition-base relative`}>
        <div className="absolute -bottom-3.5 left-4">
          <span className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full border ${project.typeColor} shadow-sm backdrop-blur-md`}>
            {project.type}
          </span>
        </div>
      </div>

      {/* 卡片主体 */}
      <div className="p-4 pt-6 flex-1 flex flex-col justify-between">
        <h3 className="text-base font-semibold text-nf-text group-hover:text-fandex-primary transition-fast tracking-tight line-clamp-1">
          {project.name}
        </h3>

        {/* 项目元数据底部栏 */}
        <div className="flex items-center justify-between text-xs text-nf-text-tertiary border-t border-nf-border-light pt-3 mt-4">
          <div className="flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5 text-nf-text-tertiary" />
            <span>{project.words}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-nf-text-tertiary" />
            <span>{project.updated}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
