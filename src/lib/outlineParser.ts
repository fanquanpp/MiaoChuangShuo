// 大纲解析器 — 从纯文本中提取章节/小节标题
//
// 功能概述：
// 从 TipTap editor.getText() 输出的纯文本中，按约定规则提取大纲条目。
// 支持中文网文常见的章节标记格式，点击可跳转到对应行号。
//
// 模块职责：
// 1. 按行扫描文本，匹配章节标题模式
// 2. 返回带行号的大纲条目列表

export interface OutlineHeading {
  level: 1 | 2;
  text: string;
  line: number;
}

// 章节标题正则规则数组（可扩展）
const LEVEL1_PATTERNS: RegExp[] = [
  /^第[一二三四五六七八九十百千万零\d]+[章节回卷集部篇](\s.*)?$/, // 第X章/节/回/卷...
  /^Chapter\s+\d+/i, // Chapter 1
  /^卷[一二三四五六七八九十\d]+(\s.*)?$/, // 卷一
  /^\d+[、.．]\s*.+/, // 1、xxx / 1. xxx
];

const LEVEL2_PATTERNS: RegExp[] = [
  /^【.+】$/, // 【xxx】 括号标记
  /^\[[^\]]+\]$/, // [xxx] 方括号标记
  /^◇\s*.+/, // ◆◇标记
];

// 过滤条件：太短或太长的行不可能是标题
const MIN_HEADING_LEN = 2;
const MAX_HEADING_LEN = 50;

/**
 * 从纯文本中提取大纲条目
 * @param text 编辑器纯文本内容
 * @returns 大纲条目数组（按出现顺序）
 */
export function extractOutlineFromText(text: string): OutlineHeading[] {
  if (!text) return [];

  const lines = text.split("\n");
  const headings: OutlineHeading[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.length < MIN_HEADING_LEN || trimmed.length > MAX_HEADING_LEN) {
      continue;
    }

    // 优先匹配 level 1（章节标题）
    if (LEVEL1_PATTERNS.some((re) => re.test(trimmed))) {
      headings.push({ level: 1, text: trimmed, line: i });
      continue;
    }

    // 再匹配 level 2（小节标记）
    if (LEVEL2_PATTERNS.some((re) => re.test(trimmed))) {
      headings.push({ level: 2, text: trimmed, line: i });
    }
  }

  return headings;
}
