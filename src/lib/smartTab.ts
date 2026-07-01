// 智能缩进 TipTap 扩展（写作场景专用）
//
// 功能概述：
// 为小说编辑器提供写作场景下的 Tab 键语义化行为，彻底避免 Tab 跳出编辑器焦点。
// 写作时 Tab 键的核心语义是"缩进"，而非"切换焦点"。
// - 有选区：Tab 为每段段首插入全角空格（批量缩进），Shift+Tab 反向缩进
// - 无选区：Tab 在光标处插入全角空格（缩进），Shift+Tab 删除行首全角空格
// - 在列表/代码块内：交由 TipTap 默认逻辑处理（增加缩进层级）
//
// 模块职责：
// 1. 拦截 Tab/Shift+Tab，阻止浏览器默认焦点切换行为
// 2. 普通段落：插入/删除全角空格
// 3. 多段选区：批量插入/删除全角空格
// 4. 列表/任务列表/代码块：放行给 TipTap 默认处理
//
// 设计原则：
// - 写作场景下 Tab 必须留在编辑器内，绝不允许跳到工具栏按钮
// - 与 IndentParagraph 协同（首行缩进由其自动处理，本扩展处理手动缩进）
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

/**
 * 判断当前光标是否处于需要 TipTap 默认 Tab 行为的节点中
 * 输入: view 编辑器视图
 * 输出: boolean 是否处于列表/任务列表/代码块中
 * 流程:
 *   1. 获取当前选区的父节点
 *   2. 检查节点类型是否为 listItem/taskItem/codeBlock
 *   3. 是则返回 true（让 TipTap 处理缩进层级），否则 false
 */
function isInTabbableNode(view: EditorView): boolean {
  const { selection } = view.state;
  const { $from } = selection;
  // 从当前节点向上查找，检查是否处于列表/任务列表/代码块中
  for (let depth = $from.depth; depth > 0; depth--) {
    const nodeName = $from.node(depth).type.name;
    if (
      nodeName === "listItem" ||
      nodeName === "taskItem" ||
      nodeName === "codeBlock"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 无选区时在光标处插入缩进字符
 * 输入:
 *   view 编辑器视图
 *   indentChar 缩进字符
 * 输出: boolean 是否处理了该按键
 * 流程:
 *   1. 在当前光标位置插入缩进字符
 *   2. 光标移动到插入字符之后
 */
function insertIndentAtCursor(view: EditorView, indentChar: string): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const { from } = selection;
  const tr = state.tr.insertText(indentChar, from);
  // 光标移至插入字符之后
  tr.setSelection(TextSelection.near(tr.doc.resolve(from + indentChar.length)));
  dispatch(tr);
  return true;
}

/**
 * 无选区时删除当前段落首的全角空格
 * 输入:
 *   view 编辑器视图
 *   indentChar 缩进字符
 * 输出: boolean 是否处理了该按键
 * 流程:
 *   1. 获取当前段落节点
 *   2. 检查段首是否以缩进字符开头
 *   3. 是则删除一个，否则无操作（返回 true 阻止焦点切换）
 */
function outdentAtCursor(view: EditorView, indentChar: string): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const $from = selection.$from;
  if ($from.depth < 1) return true; // 阻止焦点切换
  const para = $from.parent;
  if (para.type.name !== "paragraph") return true;
  const text = para.textContent;
  if (text.startsWith(indentChar)) {
    const paraPos = $from.before($from.depth);
    const deletePos = paraPos + 1;
    const tr = state.tr.delete(deletePos, deletePos + 1);
    dispatch(tr);
  }
  // 即使没有删除也返回 true，阻止焦点跳出编辑器
  return true;
}

// 智能缩进扩展（写作场景专用）
// 输入: enabled 是否启用, indentChar 缩进字符
// 输出: TipTap Extension 实例
// 流程:
//   1. 注册 ProseMirror 插件
//   2. 监听 Tab 键（无修饰键或仅 Shift）
//   3. 列表/任务列表/代码块内：放行给 TipTap 默认处理
//   4. 有选区时批量缩进/反缩进
//   5. 无选区时在光标处插入缩进/删除行首缩进
//   6. 始终阻止浏览器默认焦点切换行为
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

            // 列表/任务列表/代码块内：放行给 TipTap 默认处理（缩进层级）
            if (isInTabbableNode(view)) return false;

            event.preventDefault();

            // 有选区：批量缩进/反缩进
            if (!view.state.selection.empty) {
              if (shift) {
                return outdentSelectedParagraphs(view, options.indentChar);
              }
              return indentSelectedParagraphs(view, options.indentChar);
            }

            // 无选区：在光标处插入缩进/删除行首缩进
            // 关键：返回 true 阻止浏览器默认 Tab 焦点切换行为
            if (shift) {
              return outdentAtCursor(view, options.indentChar);
            }
            return insertIndentAtCursor(view, options.indentChar);
          },
        },
      }),
    ];
  },
});
