// 大纲视图组件 — 纯文本解析版
//
// 从编辑器纯文本内容中提取章节标题，显示为可点击的大纲列表。
// 点击大纲项时滚动编辑器到对应行。

import { useState, useMemo } from "react";
import { ListTree, Hash, X } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { extractOutlineFromText, type OutlineHeading } from "../lib/outlineParser";

interface OutlineViewProps {
  htmlContent: string;
}

export default function OutlineView({ htmlContent }: OutlineViewProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);

  const headings: OutlineHeading[] = useMemo(
    () => extractOutlineFromText(htmlContent),
    [htmlContent]
  );

  const handleClick = (line: number) => {
    const editorEl = document.querySelector(".ProseMirror") as HTMLElement | null;
    if (!editorEl) return;

    // ProseMirror 内部按块级元素渲染，每个段落/文本块是一个子元素
    // 按行号查找对应块并滚动
    const blocks = editorEl.querySelectorAll("p, h1, h2, h3, div");
    if (line < blocks.length) {
      blocks[line]?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      // 回退：直接按像素估算滚动位置
      const lineHeight = 28;
      editorEl.scrollTop = line * lineHeight;
    }
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fandex-nav-blur absolute right-2 bottom-2 p-1.5 border border-nf-border-light bg-nf-bg-card hover:bg-nf-bg-hover transition-fast z-10"
        title={t("outline.open")}
      >
        <ListTree className="w-4 h-4 text-nf-text-tertiary" />
      </button>
    );
  }

  return (
    <div className="absolute right-2 top-2 bottom-2 w-52 bg-nf-bg-card border border-nf-border-light shadow-lg flex flex-col z-10 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-nf-border-light flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <ListTree className="w-3.5 h-3.5 text-fandex-primary" />
          <span className="text-xs font-medium font-display text-nf-text">{t("outline.title")}</span>
          <span className="text-[10px] text-nf-text-tertiary font-mono">
            {headings.length}
          </span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-nf-text-tertiary hover:text-nf-text transition-fast"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {headings.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-nf-text-tertiary">
            {t("outline.noHeadings")}
            <br />
            <span className="text-[10px]">{t("outline.addHeadingHint")}</span>
          </div>
        ) : (
          headings.map((h) => (
            <button
              key={`${h.line}-${h.text}`}
              onClick={() => handleClick(h.line)}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-left text-nf-text hover:bg-nf-bg-hover transition-fast truncate"
              style={{ paddingLeft: h.level === 1 ? "12px" : "24px" }}
              title={h.text}
            >
              <Hash className="w-3 h-3 text-nf-text-tertiary flex-shrink-0" />
              <span
                className={`truncate ${
                  h.level === 1 ? "font-medium text-nf-text" : "text-nf-text-secondary"
                }`}
              >
                {h.text}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
