// 中英文字数统计工具
//
// 功能概述:
// 提供中英混合文本的字数统计能力。中文字符按字计数,
// 连续英文字母序列按单词计数。
// 与桌面版 wordCounter 逻辑保持一致, 但独立实现以避免引用桌面版。
//
// 模块职责:
// 1. countWords: 统计纯文本字数
// 2. countWordsFromProseMirror: 从 ProseMirror JSON 文档统计字数

import type { ProseMirrorNode } from "./types";

/**
 * 统计文本中的字数 (中文字符 + 英文单词)
 * 中文字符范围: U+4E00~U+9FFF, U+3400~U+4DBF, U+F900~U+FAFF (兼容汉字)
 * 英文单词: 连续英文字母序列计为一个单词
 *
 * @param text 待统计文本
 * @returns 字数
 */
export function countWords(text: string): number {
  if (!text) return 0;

  let count = 0;
  let inWord = false;

  for (const ch of text) {
    if (
      ("\u4E00" <= ch && ch <= "\u9FFF") ||
      ("\u3400" <= ch && ch <= "\u4DBF") ||
      ("\uF900" <= ch && ch <= "\uFAFF")
    ) {
      // 中文字符: 每字计 1
      count += 1;
      inWord = false;
    } else if (/[a-zA-Z]/.test(ch)) {
      // 英文字母: 连续字母序列计为 1 个单词
      if (!inWord) {
        count += 1;
        inWord = true;
      }
    } else {
      // 非中非英字符: 重置英文单词状态
      inWord = false;
    }
  }

  return count;
}

/**
 * 从 ProseMirror JSON 文档提取所有文本并统计字数
 *
 * @param doc ProseMirror 文档节点
 * @returns 字数
 */
export function countWordsFromProseMirror(doc: ProseMirrorNode): number {
  const text = extractTextFromNode(doc);
  return countWords(text);
}

/**
 * 递归提取 ProseMirror 节点中的所有纯文本
 *
 * @param node ProseMirror 节点
 * @returns 拼接后的纯文本
 */
function extractTextFromNode(node: ProseMirrorNode): string {
  // 文本节点: 直接返回 text 字段
  if (node.type === "text" && node.text) {
    return node.text;
  }
  // 容器节点: 递归拼接子节点文本
  if (node.content && node.content.length > 0) {
    return node.content.map((child) => extractTextFromNode(child)).join("");
  }
  return "";
}
