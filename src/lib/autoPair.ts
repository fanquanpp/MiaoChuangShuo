// VSCode 风格自动配对括号引号 TipTap 扩展
//
// 功能概述：
// 为小说编辑器提供 VSCode 风格的自动配对功能，覆盖中文写作常见场景。
// 输入左括号/引号时自动插入匹配的右括号/引号，并将光标置于配对之间。
// 选中文本后输入括号/引号时，自动用配对字符包围选区。
// 光标位于右括号/引号前时，输入相同字符将跳过而非重复插入。
// Backspace 删除左括号/引号时，同时删除配对的右括号/引号。
//
// 模块职责：
// 1. 半角配对：() [] {} ` 以及中文引号 " '
// 2. 全角配对：（）【】「」『』
// 3. 中文引号智能识别：根据上下文判断 " 和 ' 是开引号还是闭引号
// 4. 跳过右字符：光标在右括号/引号前时按相同字符直接跳过
// 5. 包围选区：选中文本后输入配对字符自动包围
// 6. 删除配对：Backspace 删除左字符时同步删除右字符
//
// 设计原则：
// - 不破坏编辑器历史栈（所有操作通过事务分发）
// - 中文引号处理参考 Word/WPS 的中文排版习惯
// - 与 VSShortcuts 扩展协同工作，不冲突
// - handleTextInput 处理字符输入，handleKeyDown 仅处理 Backspace

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// 扩展配置接口
export interface AutoPairOptions {
  /** 是否启用自动配对 */
  enabled: boolean;
}

// 插件键
const autoPairKey = new PluginKey("autoPair");

// 半角配对映射表：左字符 -> 右字符
const PAIR_MAP: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "`": "`",
};

// 全角配对映射表：左字符 -> 右字符
const FULLWIDTH_PAIR_MAP: Record<string, string> = {
  "（": "）",
  "【": "】",
  "「": "」",
  "『": "』",
};

// 可跳过的右字符集合（输入这些字符时若光标前方就是该字符，则跳过）
const SKIP_CHARS = new Set<string>([
  ")",
  "]",
  "}",
  "）",
  "】",
  "」",
  "』",
  "`",
]);

// 中文引号字符常量
const CN_DOUBLE_QUOTE_OPEN = "\u201c"; // "
const CN_DOUBLE_QUOTE_CLOSE = "\u201d"; // "
const CN_SINGLE_QUOTE_OPEN = "\u2018"; // '
const CN_SINGLE_QUOTE_CLOSE = "\u2019"; // '

// 所有配对映射的合并表（供 Backspace 删除时查找）
const ALL_PAIRS: Record<string, string> = {
  ...PAIR_MAP,
  ...FULLWIDTH_PAIR_MAP,
  [CN_DOUBLE_QUOTE_OPEN]: CN_DOUBLE_QUOTE_CLOSE,
  [CN_SINGLE_QUOTE_OPEN]: CN_SINGLE_QUOTE_CLOSE,
};

/**
 * 判断中文双引号应作为开引号还是闭引号
 * 输入:
 *   textBefore 光标前的文本
 * 输出:
 *   boolean true 表示应作为开引号（"），false 表示应作为闭引号（"）
 * 流程:
 *   1. 若前方无文本或仅空白，作为开引号
 *   2. 若前一个字符为开引号、左括号、空白等分隔符，作为开引号
 *   3. 若前一个字符为普通字符（汉字/字母/数字），作为闭引号
 */
function isOpenQuote(textBefore: string): boolean {
  if (textBefore.length === 0) return true;
  const lastChar = textBefore[textBefore.length - 1];
  // 前字符为空白或分隔符时，视为开引号
  if (/\s/.test(lastChar)) return true;
  // 前字符为左括号或开引号时，视为开引号
  const openChars = new Set<string>([
    "(",
    "[",
    "{",
    "（",
    "【",
    "「",
    "『",
    CN_DOUBLE_QUOTE_OPEN,
    CN_SINGLE_QUOTE_OPEN,
  ]);
  if (openChars.has(lastChar)) return true;
  // 前字符为标点（逗号、句号、冒号、分号等）时，视为开引号
  if (/[，。、；：,.;:!?！？]/.test(lastChar)) return true;
  // 其他情况（前字符为汉字/字母/数字）视为闭引号
  return false;
}

/**
 * 判断当前光标是否位于指定右字符之前
 * 输入:
 *   view 编辑器视图
 *   expectedChar 期望的右字符
 * 输出:
 *   boolean 是否可跳过
 */
function canSkipRightChar(view: EditorView, expectedChar: string): boolean {
  const { state } = view;
  const { selection } = state;
  if (!selection.empty) return false;
  const pos = selection.$from.pos;
  if (pos >= state.doc.content.size) return false;
  const afterText = state.doc.textBetween(pos, pos + 1, "\n");
  return afterText === expectedChar;
}

/**
 * 处理选中文本时的包围逻辑
 * 输入:
 *   view 编辑器视图
 *   leftChar 左配对字符
 *   rightChar 右配对字符
 * 输出:
 *   boolean 是否处理了该输入
 * 流程:
 *   1. 获取选区范围与选中文本
 *   2. 删除原选区并插入 左字符 + 内容 + 右字符
 *   3. 选区调整为仅包含原内容（不含包围字符）
 */
function wrapSelection(
  view: EditorView,
  leftChar: string,
  rightChar: string,
): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  if (selection.empty) return false;
  const { from } = selection;
  const selectedText = state.doc.textBetween(from, selection.to, "\n");
  const tr = state.tr;
  // 替换选区为 左字符 + 内容 + 右字符
  tr.deleteSelection();
  tr.insertText(leftChar + selectedText + rightChar, from);
  // 选区调整为原内容范围（不含包围字符）
  const newFrom = from + 1;
  const newTo = from + 1 + selectedText.length;
  tr.setSelection(TextSelection.create(tr.doc, newFrom, newTo));
  dispatch(tr);
  return true;
}

/**
 * 处理输入左配对字符的逻辑
 * 输入:
 *   view 编辑器视图
 *   leftChar 左配对字符
 *   rightChar 右配对字符
 * 输出:
 *   boolean 是否处理了该输入
 * 流程:
 *   1. 若有选区，调用 wrapSelection 包围
 *   2. 无选区时，插入左字符 + 右字符，光标置于中间
 */
function insertPair(
  view: EditorView,
  leftChar: string,
  rightChar: string,
): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  // 有选区时执行包围
  if (!selection.empty) {
    return wrapSelection(view, leftChar, rightChar);
  }
  // 无选区时插入配对字符，光标置于中间
  const from = selection.from;
  const tr = state.tr.insertText(leftChar + rightChar, from);
  // 光标移至左字符之后
  tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1), -1));
  dispatch(tr);
  return true;
}

/**
 * 处理中文引号的智能输入
 * 输入:
 *   view 编辑器视图
 *   textBefore 光标前文本
 *   openChar 开引号字符
 *   closeChar 闭引号字符
 * 输出:
 *   boolean 是否处理了该输入
 * 流程:
 *   1. 根据上下文判断开/闭引号
 *   2. 开引号：插入配对，光标置于中间
 *   3. 闭引号：返回 false 由默认逻辑处理
 */
function insertChineseQuote(
  view: EditorView,
  textBefore: string,
  openChar: string,
  closeChar: string,
): boolean {
  const { state, dispatch } = view;
  const { selection } = state;

  // 有选区时智能包围（使用开闭引号配对）
  if (!selection.empty) {
    return wrapSelection(view, openChar, closeChar);
  }

  const isOpen = isOpenQuote(textBefore);
  if (isOpen) {
    // 开引号：插入配对，光标置于中间
    const from = selection.from;
    const tr = state.tr.insertText(openChar + closeChar, from);
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1), -1));
    dispatch(tr);
    return true;
  }
  // 闭引号：仅插入闭引号，由默认逻辑处理
  return false;
}

/**
 * 处理跳过右字符的逻辑
 * 输入:
 *   view 编辑器视图
 *   char 输入的右字符
 * 输出:
 *   boolean 是否处理了该输入
 * 流程:
 *   1. 验证光标前方是否为该右字符
 *   2. 光标后移一位跳过该字符
 */
function skipRightChar(view: EditorView, char: string): boolean {
  if (!canSkipRightChar(view, char)) return false;
  const { state, dispatch } = view;
  const pos = state.selection.from;
  const tr = state.tr;
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1), 1));
  dispatch(tr);
  return true;
}

/**
 * 处理字符输入的统一入口
 * 输入:
 *   view 编辑器视图
 *   text 输入的字符
 * 输出:
 *   boolean 是否处理了该输入
 * 流程:
 *   1. 半角配对字符：插入配对
 *   2. 全角配对字符：插入配对
 *   3. 中文双引号/单引号：智能识别开闭
 *   4. 跳过右字符：光标后移
 */
function handleTextInputChar(view: EditorView, from: number, text: string): boolean {
  const { state } = view;
  // 获取光标前的文本用于中文引号上下文判断
  const textBefore = state.doc.textBetween(Math.max(0, from - 1), from, "\n");

  // 1. 处理半角配对字符
  if (PAIR_MAP[text]) {
    return insertPair(view, text, PAIR_MAP[text]);
  }

  // 2. 处理全角配对字符
  if (FULLWIDTH_PAIR_MAP[text]) {
    return insertPair(view, text, FULLWIDTH_PAIR_MAP[text]);
  }

  // 3. 处理中文双引号
  if (text === '"') {
    return insertChineseQuote(view, textBefore, CN_DOUBLE_QUOTE_OPEN, CN_DOUBLE_QUOTE_CLOSE);
  }

  // 4. 处理中文单引号
  if (text === "'") {
    return insertChineseQuote(view, textBefore, CN_SINGLE_QUOTE_OPEN, CN_SINGLE_QUOTE_CLOSE);
  }

  // 5. 处理跳过右字符（光标在右括号/引号前时按相同字符跳过）
  if (SKIP_CHARS.has(text)) {
    return skipRightChar(view, text);
  }

  return false;
}

/**
 * 处理 Backspace 删除配对的逻辑
 * 输入:
 *   view 编辑器视图
 * 输出:
 *   boolean 是否处理了该按键
 * 流程:
 *   1. 验证为空选区状态
 *   2. 获取光标前后字符
 *   3. 判断是否构成配对
 *   4. 同时删除前后字符
 */
function handleBackspacePair(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  if (!selection.empty) return false;
  const $pos = selection.$from;
  if ($pos.pos < 2) return false;

  const beforePos = $pos.pos - 1;
  const afterPos = $pos.pos;
  if (afterPos >= state.doc.content.size) return false;
  const beforeText = state.doc.textBetween(beforePos, $pos.pos, "\n");
  const afterText = state.doc.textBetween(afterPos, afterPos + 1, "\n");

  const expectedRight = ALL_PAIRS[beforeText];
  if (expectedRight && afterText === expectedRight) {
    // 同时删除前后字符
    const tr = state.tr.delete(beforePos, afterPos + 1);
    dispatch(tr);
    return true;
  }
  return false;
}

// 自动配对扩展
// 输入: enabled 是否启用
// 输出: TipTap Extension 实例
// 流程:
//   1. 注册 ProseMirror 插件
//   2. handleTextInput 处理字符输入（配对/跳过/包围）
//   3. handleKeyDown 仅处理 Backspace 删除配对
export const AutoPair = Extension.create<AutoPairOptions>({
  name: "autoPair",

  addOptions() {
    return {
      enabled: true,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: autoPairKey,
        props: {
          // 处理文本输入：覆盖字符输入逻辑（IME 与普通字符均走此入口）
          handleTextInput(view: EditorView, from: number, _to: number, text: string): boolean {
            if (!options.enabled) return false;
            return handleTextInputChar(view, from, text);
          },

          // 处理按键输入：仅处理 Backspace 删除配对
          // 注意：字符输入走 handleTextInput，此处不重复处理可见字符
          handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
            if (!options.enabled) return false;
            if (event.key !== "Backspace") return false;
            const handled = handleBackspacePair(view);
            if (handled) {
              event.preventDefault();
            }
            return handled;
          },
        },
      }),
    ];
  },
});
