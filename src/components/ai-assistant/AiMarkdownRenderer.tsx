// AI 消息 Markdown 渲染组件 (SubTask 12.5)
//
// 功能概述:
//   抽取自 AiAssistantPanel 的 renderMarkdown 实现, 作为独立组件承载 AI 回复的
//   富文本渲染. 仅支持常用 Markdown 语法, 不引入 react-markdown 等外部依赖,
//   避免增加打包体积与潜在的安全注入风险.
//
// 模块职责:
//   1. 解析代码块 (```...```) 与普通文本块
//   2. 解析粗体 (**text**) 与斜体 (*text* / _text_)
//   3. 解析无序列表项 (- / *) 与有序列表项 (1.)
//   4. 解析标题行 (# / ## / ###)
//   5. 输出 JSX 渲染节点
//
// 设计说明:
//   - 不依赖外部 markdown 库, 自实现 renderMarkdown 函数
//   - 流式输出已通过上游按 \n 分割, 此处仅做行内/块级语法处理
//   - 解析顺序: 代码块 -> 文本行 -> 行内强调/列表

import type { ReactNode } from "react";

/**
 * 代码块/文本块联合类型
 * - code:  ``` 包裹的代码内容
 * - text:  普通文本段 (含多行)
 */
interface MarkdownPart {
  type: "code" | "text";
  content: string;
}

/**
 * 行内文本片段
 * - bold:    粗体
 * - italic:  斜体
 * - plain:   普通文本
 */
interface InlineSegment {
  text: string;
  bold: boolean;
  italic: boolean;
}

/**
 * 简易 Markdown 渲染函数
 * 输入: text 待渲染的 Markdown 文本
 * 输出: ReactNode 渲染结果
 * 流程:
 *   1. 按 ``` 分割文本为 code / text 片段
 *   2. 代码块使用 <pre> 渲染
 *   3. 文本块按行处理: 标题 / 列表 / 行内强调
 *   4. 返回 JSX 数组
 */
export function renderMarkdown(text: string): ReactNode {
  if (!text) return null;

  // 步骤 1: 按代码块分割
  const parts = splitCodeBlocks(text);

  return parts.map((part, idx) => {
    if (part.type === "code") {
      return (
        <pre
          key={idx}
          className="my-2 p-3 bg-nf-bg border border-nf-border-light text-xs text-nf-text-secondary overflow-x-auto font-mono whitespace-pre-wrap"
        >
          {part.content}
        </pre>
      );
    }
    // 步骤 2: 文本块按行渲染
    return (
      <div key={idx} className="whitespace-pre-wrap break-words">
        {renderTextLines(part.content)}
      </div>
    );
  });
}

/**
 * 按代码块 (```) 分割文本
 * 输入: text 原始 Markdown 文本
 * 输出: MarkdownPart[] 代码块与文本块交替的数组
 * 流程: 使用正则匹配 ```...```, 交替产出 code/text 类型
 */
function splitCodeBlocks(text: string): MarkdownPart[] {
  const codeBlockRegex = /```([\s\S]*?)```/g;
  const parts: MarkdownPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "code", content: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex) });
  }
  return parts;
}

/**
 * 渲染文本块的多行内容
 * 输入: content 文本块内容 (含换行)
 * 输出: ReactNode[] 行渲染结果数组
 * 流程: 按行分割, 识别标题/列表/普通行, 分别处理行内强调
 */
function renderTextLines(content: string): ReactNode[] {
  const lines = content.split("\n");
  return lines.map((line, lineIdx) => {
    // 空行渲染为换行
    if (line === "") {
      return <div key={lineIdx} className="leading-relaxed"><br /></div>;
    }

    // 标题识别 (# / ## / ###)
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      const sizeClass =
        level === 1
          ? "text-base font-semibold"
          : level === 2
          ? "text-sm font-semibold"
          : "text-xs font-semibold";
      return (
        <div key={lineIdx} className={`leading-relaxed my-1 ${sizeClass} text-nf-text`}>
          {renderInline(headingText)}
        </div>
      );
    }

    // 列表项检测
    const isListItem = /^\s*[-*]\s+/.test(line);
    const isOrderedItem = /^\s*\d+\.\s+/.test(line);

    return (
      <div key={lineIdx} className="leading-relaxed">
        {isListItem && <span className="text-fandex-primary mr-1">•</span>}
        {isOrderedItem && (
          <span className="text-fandex-secondary mr-1 tabular-nums">
            {line.match(/^\s*(\d+)\./)?.[1]}.
          </span>
        )}
        {/* 行内强调渲染 (粗体/斜体) */}
        {renderInline(stripListMarker(line, isListItem, isOrderedItem))}
      </div>
    );
  });
}

/**
 * 移除列表项前缀标记, 保留正文
 * 输入:
 *   line - 原始行
 *   isListItem - 是否无序列表项
 *   isOrderedItem - 是否有序列表项
 * 输出: 移除前缀后的正文
 */
function stripListMarker(
  line: string,
  isListItem: boolean,
  isOrderedItem: boolean
): string {
  if (isListItem) {
    return line.replace(/^\s*[-*]\s+/, "");
  }
  if (isOrderedItem) {
    return line.replace(/^\s*\d+\.\s+/, "");
  }
  return line;
}

/**
 * 行内强调渲染 (粗体/斜体)
 * 输入: line 单行文本
 * 输出: ReactNode[] 行内片段数组
 * 流程:
 *   1. 使用正则匹配 **bold** 与 *italic* / _italic_
 *   2. 交替产出 plain/bold/italic 片段
 *   3. 粗体优先于斜体 (避免 ** 与 * 嵌套冲突)
 */
function renderInline(line: string): ReactNode[] {
  // 同时匹配粗体 (**text**) 与斜体 (*text* / _text_), 粗体优先
  const inlineRegex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_)/g;
  const segments: InlineSegment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(line)) !== null) {
    if (match.index > last) {
      segments.push({ text: line.slice(last, match.index), bold: false, italic: false });
    }
    if (match[2] !== undefined) {
      // **bold**
      segments.push({ text: match[2], bold: true, italic: false });
    } else if (match[3] !== undefined) {
      // *italic*
      segments.push({ text: match[3], bold: false, italic: true });
    } else if (match[4] !== undefined) {
      // _italic_
      segments.push({ text: match[4], bold: false, italic: true });
    }
    last = match.index + match[0].length;
  }
  if (last < line.length) {
    segments.push({ text: line.slice(last), bold: false, italic: false });
  }

  return segments.map((seg, segIdx) => {
    if (seg.bold) {
      return (
        <strong key={segIdx} className="font-semibold text-nf-text">
          {seg.text}
        </strong>
      );
    }
    if (seg.italic) {
      return (
        <em key={segIdx} className="italic">
          {seg.text}
        </em>
      );
    }
    return <span key={segIdx}>{seg.text}</span>;
  });
}

/**
 * AiMarkdownRenderer 组件
 * 输入:
 *   content - Markdown 文本内容
 * 输出: JSX 渲染结果
 * 流程: 直接委托 renderMarkdown 函数
 */
interface AiMarkdownRendererProps {
  content: string;
}

export default function AiMarkdownRenderer({ content }: AiMarkdownRendererProps) {
  return <>{renderMarkdown(content)}</>;
}
