// 字数统计工具
//
// 功能概述：
// 提供中英混合文本的字数统计能力。中文字符按字计数，
// 连续英文字母序列按单词计数。
//
// 模块职责：
// 1. countWords: 统计文本字数

/**
 * 统计文本中的字数（中文字符 + 英文单词）
 * 中文字符范围: U+4E00~U+9FFF, U+3400~U+4DBF
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
      count += 1;
      inWord = false;
    } else if (/[a-zA-Z]/.test(ch)) {
      if (!inWord) {
        count += 1;
        inWord = true;
      }
    } else {
      inWord = false;
    }
  }

  return count;
}
