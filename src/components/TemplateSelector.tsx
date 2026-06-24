import React from "react";
import { BookOpen, Feather, Clapperboard, Swords } from "lucide-react";

// 模板类型定义
interface Template {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
  color: string;
}

// 创作题材模板列表 - FANDEX 三色系
// 输入: 无
// 输出: 模板卡片列表 UI
// 流程: 渲染 4 种创作题材模板供用户选择
const TEMPLATES: Template[] = [
  { id: "epic", name: "西幻史诗", icon: Swords, desc: "集成世界观宏观体系、势力编年史工具。", color: "text-fandex-tertiary" },
  { id: "standard", name: "标准长篇", icon: BookOpen, desc: "常规网文/大纲流架构，多卷轴深度目录。", color: "text-fandex-primary" },
  { id: "essay", name: "散文随笔", icon: Feather, desc: "侧重视觉留白，支持全自动双字首行缩进。", color: "text-fandex-secondary" },
  { id: "script", name: "舞台剧本", icon: Clapperboard, desc: "台词智能排版，人名预设一键浮动呼出。", color: "text-fandex-primary" },
];

// 模板选择器组件 - FANDEX 美术风格
// 输入: onSelect 回调(可选)
// 输出: 模板卡片列表
// 流程: 遍历模板数据渲染卡片，点击时触发回调
export default function TemplateSelector({ onSelect }: { onSelect?: (id: string) => void }) {
  return (
    <div className="space-y-2 mt-4 max-h-[60vh] overflow-y-auto pr-1">
      <div className="text-xs font-semibold text-text-tertiary uppercase tracking-wider px-1 mb-2">
        选择创作题材架构
      </div>
      {TEMPLATES.map((tpl) => {
        const IconComponent = tpl.icon;
        return (
          <div
            key={tpl.id}
            onClick={() => onSelect?.(tpl.id)}
            className="flex items-start gap-3 p-3 rounded-xl bg-bg-card/60 border border-border-light hover:border-border hover:bg-bg-hover/40 transition-fast cursor-pointer group"
          >
            <div className={`p-2 rounded-lg bg-bg border border-border-light group-hover:border-border transition-fast mt-0.5 ${tpl.color}`}>
              <IconComponent className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text group-hover:text-fandex-primary transition-fast">
                {tpl.name}
              </div>
              <div className="text-xs text-text-tertiary line-clamp-2 mt-0.5 leading-relaxed">
                {tpl.desc}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
