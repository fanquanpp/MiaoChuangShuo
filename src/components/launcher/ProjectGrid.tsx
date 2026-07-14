// 项目卡片网格组件
//
// 功能概述：
// 启动器右侧主区域的项目卡片网格,负责响应式布局、进入动画、空状态、加载状态、
// 搜索无结果状态的统一展示。卡片本体复用 ProjectCard 组件,网格层用 Framer Motion
// 实现错峰进入动画,提升首屏视觉节奏感。
//
// 模块职责:
// 1. 响应式 grid 布局(minmax(280px,1fr) 自动填充)
// 2. Framer Motion 实现卡片错峰进入动画
// 3. 加载/空状态/搜索无结果的状态分支渲染
// 4. 空白区域背景装饰图案(不影响文本布局)

import { motion, type Variants } from "framer-motion";
import { BookOpen, Search } from "lucide-react";
import ProjectCard, { type ProjectData } from "../ProjectCard";
import { ProjectGridSkeleton } from "../SkeletonComponents";
import type { ProjectInfo } from "../../lib/api";
import { useI18n } from "../../lib/i18n";

/** ProjectGrid 组件属性 */
export interface ProjectGridProps {
  /** 已排序过滤后的项目列表 */
  projects: ProjectInfo[];
  /** 是否正在加载(扫描中) */
  loading: boolean;
  /** 当前搜索关键词(用于无结果提示) */
  searchQuery: string;
  /** 是否存在任何项目(用于区分首次空状态与搜索空状态) */
  hasProjects: boolean;
  /** 是否处于搜索中状态 */
  isSearching: boolean;
  /** 搜索是否有结果 */
  hasSearchResults: boolean;
  /** ProjectInfo 转换为 ProjectData 的转换函数 */
  toProjectData: (p: ProjectInfo) => ProjectData;
  /** 删除项目回调 */
  onDelete: (p: ProjectInfo) => void;
  /** 编辑项目设定回调 */
  onEdit: (p: ProjectInfo) => void;
}

/**
 * 卡片进入动画变体
 * 使用 custom 索引实现错峰进入,前 9 张卡片按 40ms 间隔依次淡入上滑
 * 超过 9 张后立即显示,避免长列表等待时间过长
 */
const cardVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: Math.min(i, 8) * 0.04,
      duration: 0.3,
      ease: "easeOut",
    },
  }),
};

/**
 * 项目卡片网格组件
 * 输入:
 *   - projects: 已排序过滤后的项目列表
 *   - loading: 是否正在加载
 *   - searchQuery: 当前搜索关键词
 *   - hasProjects: 是否存在任何项目
 *   - isSearching: 是否处于搜索中
 *   - hasSearchResults: 搜索是否有结果
 *   - toProjectData: ProjectInfo 转换函数
 *   - onDelete: 删除项目回调
 *   - onEdit: 编辑项目回调
 * 输出: JSX 网格元素(含状态分支)
 * 流程:
 *   1. loading 时渲染骨架屏
 *   2. 无项目且非搜索时渲染首次空状态
 *   3. 搜索无结果时渲染搜索空状态
 *   4. 正常时渲染响应式 grid + 卡片错峰进入动画
 */
export default function ProjectGrid({
  projects,
  loading,
  searchQuery,
  hasProjects,
  isSearching,
  hasSearchResults,
  toProjectData,
  onDelete,
  onEdit,
}: ProjectGridProps) {
  const { t } = useI18n();

  // 加载中状态:渲染骨架屏
  if (loading) {
    return <ProjectGridSkeleton count={6} />;
  }

  // 首次空状态:从未扫描到任何项目,引导用户使用左侧创建按钮
  if (!hasProjects && !isSearching) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in">
        <div className="w-20 h-20 mb-5 bg-nf-bg-card border border-nf-border-light flex items-center justify-center">
          <BookOpen className="w-9 h-9 text-nf-border" />
        </div>
        <p className="text-nf-text-secondary font-medium text-base mb-2">
          {t("launcher.noProjects")}
        </p>
        {/* 文本提示:引导用户使用左侧创建按钮,不再放置冗余按钮 */}
        <p className="text-sm text-nf-text-tertiary max-w-sm">
          {t("launcher.welcomeHint")}
        </p>
      </div>
    );
  }

  // 搜索无结果状态:已扫描到项目但搜索词不匹配
  if (isSearching && !hasSearchResults) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in">
        <div className="w-20 h-20 mb-5 bg-nf-bg-card border border-nf-border-light flex items-center justify-center">
          <Search className="w-9 h-9 text-nf-border" />
        </div>
        <p className="text-nf-text-secondary font-medium text-base mb-2">
          {t("launcher.noSearchResults", { query: searchQuery })}
        </p>
      </div>
    );
  }

  // 正常渲染:响应式 grid + Framer Motion 错峰进入动画
  return (
    <section className="animate-slide-up">
      <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text mb-6">
        {t("launcher.recentProjectsCount", { count: projects.length })}
      </h3>
      {/* 响应式 grid:280px 最小列宽,自动填充,适配不同屏幕宽度 */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {projects.map((p, idx) => (
          <motion.div
            key={p.path}
            custom={idx}
            initial="hidden"
            animate="visible"
            variants={cardVariants}
          >
            <ProjectCard
              project={toProjectData(p)}
              projectInfo={p}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          </motion.div>
        ))}
      </div>
    </section>
  );
}
