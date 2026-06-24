import React from "react";
import { BookOpen, Feather, Clapperboard, Swords, Rocket, Eye, Heart } from "lucide-react";

// 模板类型定义
interface Template {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
  color: string;
  barClass: string;
}

// 创作题材模板列表 - FANDEX 三色系(8 种模板)
const TEMPLATES: Template[] = [
  {
    id: "epic",
    name: "西幻史诗",
    icon: Swords,
    desc: "集成世界观宏观体系、势力编年史工具。",
    color: "text-fandex-tertiary",
    barClass: "fandex-bar-left-tertiary",
  },
  {
    id: "standard",
    name: "标准长篇",
    icon: BookOpen,
    desc: "常规网文/大纲流架构，多卷轴深度目录。",
    color: "text-fandex-primary",
    barClass: "fandex-bar-left",
  },
  {
    id: "essay",
    name: "散文随笔",
    icon: Feather,
    desc: "侧重视觉留白，支持全自动双字首行缩进。",
    color: "text-fandex-secondary",
    barClass: "fandex-bar-left-secondary",
  },
  {
    id: "script",
    name: "舞台剧本",
    icon: Clapperboard,
    desc: "台词智能排版，人名预设一键浮动呼出。",
    color: "text-fandex-primary",
    barClass: "fandex-bar-left",
  },
  {
    id: "wuxia",
    name: "武侠江湖",
    icon: Swords,
    desc: "门派势力体系、武学总纲、兵器谱排名。",
    color: "text-fandex-tertiary",
    barClass: "fandex-bar-left-tertiary",
  },
  {
    id: "scifi",
    name: "科幻未来",
    icon: Rocket,
    desc: "科技树、星际航路、文明等级分级体系。",
    color: "text-fandex-secondary",
    barClass: "fandex-bar-left-secondary",
  },
  {
    id: "mystery",
    name: "悬疑推理",
    icon: Eye,
    desc: "案件档案、线索追踪、诡计设计与推理链。",
    color: "text-fandex-primary",
    barClass: "fandex-bar-left",
  },
  {
    id: "romance",
    name: "言情都市",
    icon: Heart,
    desc: "情感脉络图、人物关系网、情感节点追踪。",
    color: "text-fandex-tertiary",
    barClass: "fandex-bar-left-tertiary",
  },
];

// 模板选择器组件 - FANDEX 美术风格
// 输入: onSelect 回调(可选)
// 输出: 模板卡片列表
// 流程: 遍历模板数据渲染卡片，点击时触发回调
export default function TemplateSelector({ onSelect }: { onSelect?: (id: string) => void }) {
  return (
    <div className="space-y-1 mt-4 max-h-[60vh] overflow-y-auto pr-1">
      <div className="text-[10px] font-semibold text-nf-text-tertiary uppercase tracking-wider px-1 mb-2">
        选择创作题材架构
      </div>
      {TEMPLATES.map((tpl) => {
        const IconComponent = tpl.icon;
        return (
          <div
            key={tpl.id}
            onClick={() => onSelect?.(tpl.id)}
            className={`fandex-bar-left ${tpl.barClass} flex items-start gap-3 p-3 bg-nf-bg-card border border-nf-border-light hover:border-fandex-primary hover:bg-nf-bg-hover transition-fast cursor-pointer group`}
          >
            <div className={`${tpl.color} mt-0.5`}>
              <IconComponent className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium font-display text-nf-text group-hover:text-fandex-primary transition-fast">
                {tpl.name}
              </div>
              <div className="text-xs text-nf-text-tertiary line-clamp-2 mt-0.5 leading-relaxed">
                {tpl.desc}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
