// 智能选中缩进 TipTap 扩展
//
// 功能概述：
// 为小说编辑器提供 VSCode 风格的选中段落批量缩进能力。
// 当用户选中多段文本时，Tab 键为每段段首插入一个全角空格（增加缩进），
// Shift+Tab 删除每段段首的一个全角空格（减少缩进）。
// 无选区时，Tab 键由编辑器默认逻辑处理（焦点切换或插入字符）。
//
// 模块职责：
// 1. 监听 Tab 与 Shift+Tab 按键
// 2. 检测是否有非空选区
// 3. 遍历选区内的所有段落节点
// 4. 对每个段落批量插入或删除全角空格
// 5. 调整选区以保持选中范围
//
// 设计原则：
// - 与 IndentParagraph 扩展协同（首行缩进由 IndentParagraph 自动处理）
// - 本扩展仅处理多段落选中场景，单段落无选区时不干预
// - 操作通过事务分发，支持撤销

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";

// 扩展配置接口
export interface SmartTabOptions {
  /** 是否启用智能选中缩进 */
  enabled: boolean;
  /** 缩进字符（默认全角空格） */
  indentChar: string;
}

// 插件键
const smartTabKey = new PluginKey("smartTab");

// 全角空格常量
const FULLWIDTH_SPACE = "\u3000";

/**
 * 对选区内的所有段落批量增加缩进
 * 输入:
 *   view 编辑器视图
 *   indentChar 缩进字符
 * 输出:
 *   boolean 是否处理了该按键
 * 流程:
 *   1. 获取选区范围
 *   2. 遍历选区内所有段落节点
 *   3. 在每个段落的文本起始处插入缩进字符
 *   4. 调整选区保持原范围
 */
function indentSelectedParagraphs(view: EditorView, indentChar: string): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  if (selection.empty) return false;

  const { from, to } = selection;
  const tr = state.tr;
  let changed = false;

  // 遍历选区内的所有段落节点
  state.doc.nodesBetween(from, to, (node: Node, pos: number) => {
    if (node.type.name !== "paragraph") return true;
    // 计算段落文本起始位置（跳过段落节点本身的起始标记）
    const textStart = pos + 1;
    // 在段首插入缩进字符
    tr.insertText(indentChar, textStart);
    changed = true;
    return true;
  });

  if (!changed) return false;

  // 调整选区：扩大选区以包含新增的缩进字符
  const paragraphCount = countParagraphsInRange(state.doc, from, to);
  const newFrom = from + 1; // 起始段落增加1个字符
  const newTo = to + paragraphCount; // 每个段落都增加1个字符
  tr.setSelection(TextSelection.create(tr.doc, newFrom, newTo));

  dispatch(tr);
  return true;
}

/**
 * 对选区内的所有段落批量减少缩进
 * 输入:
 *   view 编辑器视图
 *   indentChar 缩进字符
 * 输出:
 *   boolean 是否处理了该按键
 * 流程:
 *   1. 获取选区范围
 *   2. 遍历选区内所有段落节点
 *   3. 检查段落是否以缩进字符开头
 *   4. 删除段首的一个缩进字符
 *   5. 调整选区保持原范围
 */
function outdentSelectedParagraphs(view: EditorView, indentChar: string): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  if (selection.empty) return false;

  const { from, to } = selection;
  const tr = state.tr;
  let deletedCount = 0;
  let changed = false;

  // 收集需要删除的位置（避免在遍历中修改文档导致位置错乱）
  const deletePositions: number[] = [];

  state.doc.nodesBetween(from, to, (node: Node, pos: number) => {
    if (node.type.name !== "paragraph") return true;
    // 检查段落是否以缩进字符开头
    const text = node.textContent;
    if (text.startsWith(indentChar)) {
      // 段落文本起始位置（pos + 1 跳过段落节点起始标记）
      deletePositions.push(pos + 1);
      deletedCount++;
      changed = true;
    }
    return true;
  });

  if (!changed) return false;

  // 从后向前删除，避免位置偏移
  deletePositions.sort((a, b) => b - a);
  for (const pos of deletePositions) {
    tr.delete(pos, pos + 1);
  }

  // 调整选区：缩小选区以反映删除的字符
  const newFrom = from + (deletePositions.includes(from + 1) ? -1 : 0);
  // 简化处理：选区起始位置不变，结束位置减少删除数量
  const newTo = to - deletedCount;
  // 确保选区起始不小于文档起始
  const safeFrom = Math.max(0, newFrom);
  const safeTo = Math.max(safeFrom, newTo);
  tr.setSelection(TextSelection.create(tr.doc, safeFrom, safeTo));

  dispatch(tr);
  return true;
}

/**
 * 统计选区内段落节点数量
 * 输入:
 *   doc 文档节点
 *   from 选区起始
 *   to 选区结束
 * 输出:
 *   number 段落数量
 */
function countParagraphsInRange(doc: Node, from: number, to: number): number {
  let count = 0;
  doc.nodesBetween(from, to, (node: Node) => {
    if (node.type.name === "paragraph") count++;
    return true;
  });
  return count;
}

// 智能选中缩进扩展
// 输入: enabled 是否启用, indentChar 缩进字符
// 输出: TipTap Extension 实例
// 流程:
//   1. 注册 ProseMirror 插件
//   2. 监听 Tab 键（无修饰键或仅 Shift）
//   3. 有选区时批量缩进/反缩进
//   4. 无选区时返回 false 让默认逻辑处理
export const SmartTab = Extension.create<SmartTabOptions>({
  name: "smartTab",

  addOptions() {
    return {
      enabled: true,
      indentChar: FULLWIDTH_SPACE,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: smartTabKey,
        props: {
          handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
            if (!options.enabled) return false;
            // 仅处理 Tab 键
            if (event.key !== "Tab") return false;
            // 忽略 Ctrl/Cmd 组合（交给浏览器处理焦点切换）
            if (event.ctrlKey || event.metaKey) return false;

            const shift = event.shiftKey;
            // 无选区时让默认逻辑处理（焦点切换）
            if (view.state.selection.empty) return false;

            event.preventDefault();
            if (shift) {
              return outdentSelectedParagraphs(view, options.indentChar);
            }
            return indentSelectedParagraphs(view, options.indentChar);
          },
        },
      }),
    ];
  },
});
