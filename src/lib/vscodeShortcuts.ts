// VSCode 风格写作快捷键 TipTap 扩展
//
// 功能概述：
// 为小说编辑器提供 VSCode 风格的段落级操作快捷键，提升写作流畅度。
// 包含段落选择、删除、复制、移动、缩进等常用操作，让作者无需鼠标即可高效编辑。
//
// 模块职责：
// 1. Ctrl+L: 选中当前段落（快速选中整段文字）
// 2. Ctrl+Shift+K: 删除当前段落
// 3. Ctrl+Enter: 在下方插入空段落
// 4. Shift+Alt+Down: 向下复制当前段落
// 5. Alt+Up: 将当前段落上移
// 6. Alt+Down: 将当前段落下移
// 7. Ctrl+]: 增加缩进（插入全角空格）
// 8. Ctrl+[: 减少缩进（删除全角空格）
//
// 设计原则：
// - 所有操作基于 ProseMirror 段落节点，与 TipTap 数据模型兼容
// - 操作后保持光标在合理位置（通常在新段落起始处）
// - 不破坏编辑器的历史栈（支持 Ctrl+Z 撤销）

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Node, ResolvedPos } from "@tiptap/pm/model";

// 扩展配置接口
export interface VSShortcutsOptions {
  /** 是否启用 */
  enabled: boolean;
}

// 插件键
const vscodeShortcutsKey = new PluginKey("vscodeShortcuts");

/**
 * 获取当前光标所在的段落节点及其位置
 * 输入: $from 光标位置的 ResolvedPos
 * 输出: { node: Node, pos: number } 段落节点及其起始位置
 */
function getCurrentParagraph($from: ResolvedPos): { node: Node; pos: number } | null {
  // depth=1 表示段落层级（doc > paragraph）
  if ($from.depth < 1) return null;
  const paragraph = $from.parent;
  if (paragraph.type.name !== "paragraph") return null;
  const pos = $from.before($from.depth);
  return { node: paragraph, pos };
}

/**
 * 选中当前段落
 * 输入: view 编辑器视图
 * 输出: boolean 是否处理了该快捷键
 * 流程:
 *   1. 获取当前段落节点和位置
 *   2. 创建 NodeSelection 选中整个段落
 *   3. 分发事务
 */
function selectCurrentParagraph(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const para = getCurrentParagraph(selection.$from);
  if (!para) return false;

  // 使用 NodeSelection 选中整个段落节点（NodeSelection 已从顶部 import）
  const tr = state.tr.setSelection(NodeSelection.create(state.doc, para.pos));
  dispatch(tr);
  return true;
}

/**
 * 删除当前段落
 * 输入: view 编辑器视图
 * 输出: boolean 是否处理了该快捷键
 * 流程:
 *   1. 获取当前段落节点和位置
 *   2. 删除整个段落节点范围 [pos, pos + nodeSize]
 *   3. 若删除后文档为空，自动插入空段落
 */
function deleteCurrentParagraph(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const para = getCurrentParagraph(selection.$from);
  if (!para) return false;

  const tr = state.tr;
  const start = para.pos;
  const end = para.pos + para.node.nodeSize;
  tr.delete(start, end);

  // 若文档变空，插入一个空段落保证可编辑
  if (tr.doc.childCount === 0) {
    const { paragraph } = state.schema.nodes;
    tr.insert(start, paragraph.create());
  }

  // 将光标定位到删除位置
  const newPos = Math.min(start, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, newPos))));

  dispatch(tr);
  return true;
}

/**
 * 在当前段落下方插入空段落并移动光标
 * 输入: view 编辑器视图
 * 输出: boolean 是否处理了该快捷键
 * 流程:
 *   1. 获取当前段落位置
 *   2. 在段落末尾插入空段落
 *   3. 光标移至新段落起始处
 */
function insertParagraphBelow(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const para = getCurrentParagraph(selection.$from);
  if (!para) return false;

  const { paragraph } = state.schema.nodes;
  const newPara = paragraph.create();
  const insertPos = para.pos + para.node.nodeSize;
  const tr = state.tr.insert(insertPos, newPara);

  // 光标移至新段落内部
  const targetPos = insertPos + 1;
  tr.setSelection(TextSelection.near(tr.doc.resolve(targetPos)));

  dispatch(tr);
  return true;
}

/**
 * 向下复制当前段落
 * 输入: view 编辑器视图
 * 输出: boolean 是否处理了该快捷键
 * 流程:
 *   1. 获取当前段落节点
 *   2. 在段落下方插入该段落的副本
 *   3. 光标移至新段落起始处
 */
function duplicateParagraphDown(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const para = getCurrentParagraph(selection.$from);
  if (!para) return false;

  const insertPos = para.pos + para.node.nodeSize;
  const tr = state.tr.insert(insertPos, para.node.copy());

  // 光标移至新段落内部起始处
  const targetPos = insertPos + 1;
  tr.setSelection(TextSelection.near(tr.doc.resolve(targetPos)));

  dispatch(tr);
  return true;
}

/**
 * 将当前段落上移
 * 输入: view 编辑器视图
 * 输出: boolean 是否处理了该快捷键
 * 流程:
 *   1. 获取当前段落和前一个段落
 *   2. 交换两个段落的位置
 *   3. 光标移至原段落内容的新位置
 */
function moveParagraphUp(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const para = getCurrentParagraph(selection.$from);
  if (!para) return false;

  // 获取前一个兄弟节点（段落）
  const docStart = 0;
  if (para.pos <= docStart) return false;

  // 查找前一个段落
  const $paraPos = state.doc.resolve(para.pos);
  const index = $paraPos.index($paraPos.depth - 1);
  if (index === 0) return false; // 已是第一个段落

  const parent = $paraPos.node($paraPos.depth - 1);
  const prevNode = parent.child(index - 1);
  const prevPos = para.pos - prevNode.nodeSize;

  // 交换：删除当前段落，在前一个段落前插入当前段落
  const tr = state.tr;
  const { paragraph } = state.schema.nodes;

  // 删除当前段落
  tr.delete(para.pos, para.pos + para.node.nodeSize);
  // 在前一个段落位置插入当前段落
  const newPara = paragraph.create(null, para.node.content);
  tr.insert(prevPos, newPara);

  // 光标移至新位置
  const targetPos = prevPos + 1;
  tr.setSelection(TextSelection.near(tr.doc.resolve(targetPos)));

  dispatch(tr);
  return true;
}

/**
 * 将当前段落下移
 * 输入: view 编辑器视图
 * 输出: boolean 是否处理了该快捷键
 * 流程:
 *   1. 获取当前段落和后一个段落
 *   2. 交换两个段落的位置
 *   3. 光标移至原段落内容的新位置
 */
function moveParagraphDown(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const para = getCurrentParagraph(selection.$from);
  if (!para) return false;

  const $paraPos = state.doc.resolve(para.pos);
  const index = $paraPos.index($paraPos.depth - 1);
  const parent = $paraPos.node($paraPos.depth - 1);

  if (index >= parent.childCount - 1) return false; // 已是最后一个段落

  const nextPos = para.pos + para.node.nodeSize;

  // 交换：删除当前段落，在下一个段落后插入当前段落
  const tr = state.tr;
  const { paragraph } = state.schema.nodes;

  // 先保存当前段落内容
  const currentContent = para.node.content;

  // 删除当前段落
  tr.delete(para.pos, para.pos + para.node.nodeSize);

  // 在下一个段落后插入当前段落
  const insertPos = nextPos; // nextPos 不变，因为删除的是前面的节点
  const newPara = paragraph.create(null, currentContent);
  tr.insert(insertPos, newPara);

  // 光标移至新位置
  const targetPos = insertPos + 1;
  tr.setSelection(TextSelection.near(tr.doc.resolve(targetPos)));

  dispatch(tr);
  return true;
}

/**
 * 增加缩进（在段首插入全角空格）
 * 输入: view 编辑器视图
 * 输出: boolean 是否处理了该快捷键
 * 流程:
 *   1. 获取当前段落起始位置
 *   2. 在段首插入一个全角空格
 */
function increaseIndent(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const para = getCurrentParagraph(selection.$from);
  if (!para) return false;

  // 在段落内容起始处插入全角空格
  const insertPos = para.pos + 1;
  const tr = state.tr.insertText("\u3000", insertPos);

  // 光标移至插入位置之后
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));

  dispatch(tr);
  return true;
}

/**
 * 减少缩进（删除段首的全角空格）
 * 输入: view 编辑器视图
 * 输出: boolean 是否处理了该快捷键
 * 流程:
 *   1. 获取当前段落文本内容
 *   2. 若以全角空格开头，删除一个
 *   3. 若不以全角空格开头，无操作
 */
function decreaseIndent(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const para = getCurrentParagraph(selection.$from);
  if (!para) return false;

  const text = para.node.textContent;
  if (!text.startsWith("\u3000")) return false;

  // 删除段首的全角空格
  const deletePos = para.pos + 1;
  const tr = state.tr.delete(deletePos, deletePos + 1);

  dispatch(tr);
  return true;
}

// VSCode 风格快捷键扩展
// 输入: enabled 是否启用
// 输出: TipTap Extension 实例
// 流程:
//   1. 注册 ProseMirror 插件，监听 handleKeyDown
//   2. 根据按键组合分发到对应的处理函数
//   3. 所有操作返回 true 以阻止浏览器默认行为
export const VSShortcuts = Extension.create<VSShortcutsOptions>({
  name: "vscodeShortcuts",

  addOptions() {
    return {
      enabled: true,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: vscodeShortcutsKey,
        props: {
          handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
            if (!options.enabled) return false;

            const ctrl = event.ctrlKey || event.metaKey;
            const shift = event.shiftKey;
            const alt = event.altKey;
            const key = event.key.toLowerCase();

            // Ctrl+L: 选中当前段落
            if (ctrl && !shift && !alt && key === "l") {
              event.preventDefault();
              return selectCurrentParagraph(view);
            }

            // Ctrl+Shift+K: 删除当前段落
            if (ctrl && shift && !alt && key === "k") {
              event.preventDefault();
              return deleteCurrentParagraph(view);
            }

            // Ctrl+Enter: 在下方插入空段落
            if (ctrl && !shift && !alt && key === "enter") {
              event.preventDefault();
              return insertParagraphBelow(view);
            }

            // Shift+Alt+Down: 向下复制当前段落
            if (shift && alt && !ctrl && key === "arrowdown") {
              event.preventDefault();
              return duplicateParagraphDown(view);
            }

            // Alt+Up: 段落上移
            if (!ctrl && !shift && alt && key === "arrowup") {
              event.preventDefault();
              return moveParagraphUp(view);
            }

            // Alt+Down: 段落下移
            if (!ctrl && !shift && alt && key === "arrowdown") {
              event.preventDefault();
              return moveParagraphDown(view);
            }

            // Ctrl+]: 增加缩进
            if (ctrl && !shift && !alt && key === "]") {
              event.preventDefault();
              return increaseIndent(view);
            }

            // Ctrl+[: 减少缩进
            if (ctrl && !shift && !alt && key === "[") {
              event.preventDefault();
              return decreaseIndent(view);
            }

            return false;
          },
        },
      }),
    ];
  },
});
