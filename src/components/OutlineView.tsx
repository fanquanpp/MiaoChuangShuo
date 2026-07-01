// 大纲视图组件 — ProseMirror 节点树实时提取版（Office 级）
//
// 功能概述：
// 直接遍历 TipTap / ProseMirror 文档节点树，提取所有 heading 节点（H1-H4）
// 作为大纲条目，实时响应编辑器内容更新（无需重新解析文本）。
// 点击大纲条目时通过 ProseMirror 位置 API 精确跳转到对应标题位置。
// 同时跟踪光标位置，高亮显示当前所在章节（类似 VSCode 大纲）。
//
// 模块职责：
// 1. 订阅编辑器 update 事件，实时刷新大纲
// 2. 订阅 selectionUpdate / transaction 事件，跟踪当前激活标题
// 3. 点击跳转：使用 setTextSelection + scrollIntoView 精确定位
// 4. 折叠/展开状态持久化（组件内 state）
// 5. 层级颜色编码：H1 主色 / H2 辅色 / H3 三色 / H4 次要文字色

import { useState, useEffect, useCallback } from "react";
import type { Editor } from "@tiptap/core";
import { ListTree, ChevronRight, Heading1, Heading2, Heading3, Heading4 } from "lucide-react";
import { useI18n } from "../lib/i18n";

// 大纲条目结构：基于 ProseMirror 文档位置
interface OutlineHeading {
  /** 标题层级 1-4 */
  level: 1 | 2 | 3 | 4;
  /** 标题文本内容 */
  text: string;
  /** ProseMirror 全局位置（节点起始位置） */
  pos: number;
  /** 节点大小（用于计算选区结束位置） */
  size: number;
  /** 唯一标识（用于 React key） */
  id: string;
}

interface OutlineViewProps {
  /** TipTap 编辑器实例 */
  editor: Editor;
}

/**
 * 大纲视图组件
 * 输入:
 *   editor TipTap 编辑器实例
 * 输出: JSX 浮动大纲面板
 * 流程:
 *   1. 提取所有 heading 节点（H1-H4）及其位置
 *   2. 订阅 editor update 事件实时刷新
 *   3. 订阅 selectionUpdate / transaction 跟踪当前激活标题
 *   4. 点击条目时跳转到对应标题位置并滚动
 */
export default function OutlineView({ editor }: OutlineViewProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);
  // 当前激活标题索引（光标所在章节）-1 表示无激活
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  /**
   * 从 ProseMirror 文档节点树提取所有标题
   * 输入: editor.state.doc 文档节点
   * 输出: OutlineHeading[] 标题数组（按文档顺序）
   * 流程:
   *   1. 遍历 doc.descendants()
   *   2. 命中 heading 节点时记录 pos/level/text/size
   *   3. 跳过空标题（无文本内容）
   */
  const extractHeadings = useCallback((): OutlineHeading[] => {
    const result: OutlineHeading[] = [];
    const doc = editor.state.doc;
    doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        const level = (node.attrs.level as number || 1) as 1 | 2 | 3 | 4;
        const text = node.textContent.trim();
        if (text) {
          result.push({
            level,
            text,
            pos,
            size: node.nodeSize,
            id: `${pos}-${text.slice(0, 24)}`,
          });
        }
        // 不进入 heading 内部遍历（heading 内通常只有 text 节点）
        return false;
      }
      return true;
    });
    return result;
  }, [editor]);

  // 订阅编辑器更新事件，实时刷新大纲
  useEffect(() => {
    const refresh = () => {
      setHeadings(extractHeadings());
    };
    // 初始提取一次
    refresh();
    editor.on("update", refresh);
    return () => {
      editor.off("update", refresh);
    };
  }, [editor, extractHeadings]);

  // 跟踪光标位置，高亮当前所在章节
  useEffect(() => {
    const updateActive = () => {
      const { from } = editor.state.selection;
      // 找到最后一个 pos <= from 的标题索引
      let active = -1;
      for (let i = 0; i < headings.length; i++) {
        if (headings[i].pos <= from) {
          active = i;
        } else {
          break;
        }
      }
      setActiveIndex(active);
    };
    updateActive();
    editor.on("selectionUpdate", updateActive);
    editor.on("transaction", updateActive);
    return () => {
      editor.off("selectionUpdate", updateActive);
      editor.off("transaction", updateActive);
    };
  }, [editor, headings]);

  /**
   * 点击大纲条目跳转到对应标题位置
   * 输入: heading 目标标题条目
   * 输出: void
   * 流程:
   *   1. 计算标题内容区间 [pos+1, pos+size-1]
   *   2. 选中标题文本（便于后续操作）
   *   3. scrollIntoView 滚动到视口
   *   4. 聚焦编辑器
   */
  const handleJump = useCallback((heading: OutlineHeading) => {
    // pos 为节点起始位置（节点之前），pos+1 为内容起始，pos+size-1 为内容结束
    const from = heading.pos + 1;
    const to = heading.pos + heading.size - 1;
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .scrollIntoView()
      .run();
  }, [editor]);

  // 折叠态：仅显示一个圆形按钮
  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fandex-nav-blur absolute right-2 bottom-2 p-1.5 border border-nf-border-light bg-nf-bg-card hover:bg-nf-bg-hover transition duration-fast z-10"
        title={t("outline.open")}
      >
        <ListTree className="w-4 h-4 text-nf-text-tertiary" />
      </button>
    );
  }

  // 层级图标与颜色映射
  const levelMeta: Record<1 | 2 | 3 | 4, { icon: React.ReactNode; color: string; pad: string }> = {
    1: { icon: <Heading1 className="w-3 h-3" />, color: "text-fandex-primary", pad: "8px" },
    2: { icon: <Heading2 className="w-3 h-3" />, color: "text-fandex-secondary", pad: "20px" },
    3: { icon: <Heading3 className="w-3 h-3" />, color: "text-fandex-tertiary", pad: "32px" },
    4: { icon: <Heading4 className="w-3 h-3" />, color: "text-nf-text-secondary", pad: "44px" },
  };

  return (
    <div className="absolute right-2 top-2 bottom-2 w-56 bg-nf-bg-card border border-nf-border-light shadow-lg flex flex-col z-10 overflow-hidden">
      {/* 头部：标题 + 计数 + 折叠按钮 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-nf-border-light flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <ListTree className="w-3.5 h-3.5 text-fandex-primary" />
          <span className="text-xs font-medium font-display text-nf-text">{t("outline.title")}</span>
          <span className="text-[10px] text-nf-text-tertiary font-mono tabular-nums">
            {headings.length}
          </span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-nf-text-tertiary hover:text-nf-text transition duration-fast"
          title={t("outline.collapse")}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 大纲列表 */}
      <div className="flex-1 overflow-y-auto py-1">
        {headings.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-nf-text-tertiary">
            {t("outline.noHeadings")}
            <br />
            <span className="text-[10px]">{t("outline.addHeadingHint")}</span>
          </div>
        ) : (
          headings.map((h, idx) => {
            const meta = levelMeta[h.level];
            const isActive = idx === activeIndex;
            return (
              <button
                key={h.id}
                onClick={() => handleJump(h)}
                className={`w-full flex items-center gap-1.5 pr-3 py-1.5 text-xs text-left transition duration-fast truncate group ${
                  isActive
                    ? "bg-fandex-primary/10 border-l-2 border-fandex-primary"
                    : "border-l-2 border-transparent hover:bg-nf-bg-hover"
                }`}
                style={{ paddingLeft: meta.pad }}
                title={h.text}
              >
                <span className={`${meta.color} flex-shrink-0`}>{meta.icon}</span>
                <span
                  className={`truncate ${
                    h.level === 1
                      ? "font-medium text-nf-text"
                      : h.level === 2
                        ? "text-nf-text"
                        : "text-nf-text-secondary"
                  } ${isActive ? "text-fandex-primary" : ""}`}
                >
                  {h.text}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
