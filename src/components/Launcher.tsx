import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wand2, Plus, Search, FolderPlus } from "lucide-react";
import TemplateSelector from "./TemplateSelector";
import ProjectCard, { type ProjectData } from "./ProjectCard";

// Mock 历史项目数据(后续接入 Tauri 文件系统后替换)
const MOCK_PROJECTS: ProjectData[] = [
  { id: "1", name: "阿瓦隆的第七纪元", type: "西幻史诗", typeColor: "text-fandex-tertiary bg-fandex-tertiary/10 border-fandex-tertiary/20", words: "12.4 万字", updated: "2 小时前", gradient: "from-fandex-tertiary to-fandex-primary" },
  { id: "2", name: "第十三个雨季", type: "散文随笔", typeColor: "text-fandex-secondary bg-fandex-secondary/10 border-fandex-secondary/20", words: "8,500 字", updated: "昨天", gradient: "from-fandex-secondary to-fandex-primary" },
  { id: "3", name: "告别赛博朋克深渊", type: "舞台剧本", typeColor: "text-fandex-primary bg-fandex-primary/10 border-fandex-primary/20", words: "4.2 万字", updated: "3 天前", gradient: "from-fandex-primary to-fandex-secondary" },
];

// 启动器主组件 - FANDEX 暗黑美术风格
// 输入: 无
// 输出: 左右分栏的启动器界面
// 流程:
//   1. 左侧(30%): Logo + 新建项目按钮 + 模板展开列表
//   2. 右侧(70%): 搜索框 + 项目卡片网格 + 导入项目卡片
export default function Launcher() {
  const [showTemplates, setShowTemplates] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // 按搜索关键词过滤项目
  const filteredProjects = MOCK_PROJECTS.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-screen w-screen flex bg-bg text-text font-sans select-none overflow-hidden">
      {/* 左侧面板: 30% 宽度 - FANDEX 侧边栏配色 */}
      <div className="w-[30%] min-w-[320px] max-w-[400px] border-r border-border-light bg-bg-sidebar p-6 flex flex-col justify-between backdrop-blur-md">
        <div className="space-y-6">
          {/* Logo 区域 - FANDEX 品牌色渐变 */}
          <div className="flex items-center gap-3 py-2">
            <Wand2 className="w-8 h-8 text-fandex-primary animate-pulse" />
            <span className="text-2xl font-bold bg-gradient-to-r from-fandex-primary via-fandex-secondary to-fandex-tertiary bg-clip-text text-transparent tracking-wide">
              NovelForge
            </span>
          </div>

          {/* 新建项目按钮 - FANDEX 主品牌色 */}
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="w-full py-3.5 px-4 bg-fandex-primary hover:bg-fandex-primary-hover rounded-xl font-medium shadow-md flex items-center justify-center gap-2 transition-base transform active:scale-[0.98] group border border-fandex-primary/20"
          >
            <Plus className={`w-5 h-5 transition-base ${showTemplates ? "rotate-45" : ""}`} />
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
                <TemplateSelector onSelect={(id) => console.log(`创建模板: ${id}`)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 底部版本与状态 - FANDEX 三级文字色 */}
        <div className="text-xs text-text-tertiary flex justify-between items-center border-t border-border-light pt-4">
          <span>v1.0.0 (Beta Edition)</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-fandex-secondary shadow-sm"></span>
            本地环境就绪
          </span>
        </div>
      </div>

      {/* 右侧面板: 70% 宽度 - FANDEX 主背景 */}
      <div className="flex-1 flex flex-col bg-bg p-8 overflow-y-auto">
        {/* 搜索区域 */}
        <div className="flex justify-between items-center mb-8 gap-4">
          <h2 className="text-xl font-semibold tracking-tight text-text">最近创作项目</h2>
          <div className="relative w-72 group">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-fandex-primary transition-fast" />
            <input
              type="text"
              placeholder="搜索项目名称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-bg-card border border-border-light rounded-xl pl-10 pr-4 py-2 text-sm text-text placeholder-text-tertiary focus:outline-none focus:border-fandex-primary/50 focus:bg-bg-hover transition-fast"
            />
          </div>
        </div>

        {/* 项目卡片网格 - 自适应栅格 */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
          {filteredProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}

          {/* 导入本地项目卡片(虚线框) */}
          <div className="border-2 border-dashed border-border-light hover:border-border rounded-2xl p-6 flex flex-col justify-center items-center gap-3 text-text-tertiary hover:text-text-secondary transition-base cursor-pointer min-h-[180px] bg-bg-card/10 hover:bg-bg-hover/30 group">
            <div className="p-3 rounded-xl bg-bg-card group-hover:bg-bg-hover border border-border-light group-hover:border-border transition-fast">
              <FolderPlus className="w-6 h-6 text-text-tertiary group-hover:text-fandex-primary transition-fast" />
            </div>
            <span className="text-sm font-medium">导入本地已存项目</span>
          </div>
        </div>
      </div>
    </div>
  );
}
