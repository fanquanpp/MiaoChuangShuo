// 散文类型自动首行缩进 TipTap 扩展
//
// 功能概述：
// 为散文类项目（标准长篇/短篇/日记/分卷/同世界观/诗歌等）提供段落首行自动缩进功能。
// 当用户在新段落起始位置输入文字时，自动在段首插入指定数量的全角空格作为缩进。
// 缩进宽度可通过 indentWidth 配置（1-4 个全角空格）。
//
// 模块职责：
// 1. 监听编辑器文本输入事务
// 2. 仅在"段落从空变为非空"的首次输入场景触发缩进
// 3. 自动插入全角空格缩进
// 4. 防止重复插入（段落已以全角空格开头则跳过）
// 5. 跳过空行分隔符（前一段落为空时不缩进，避免段落间空行被缩进）
// 6. 尊重用户顶格意图：一旦段落已有内容或曾存在缩进，不再自动插入
//
// 交互设计说明：
//   场景1 用户新建段落并输入首个字符 -> 自动缩进（符合散文排版习惯）
//   场景2 用户删除缩进但保留文字 -> 不再自动插入（尊重顶格意图）
//   场景3 用户在已有内容后继续输入 -> 不触发（段落非空）
//   场景4 用户删除全部内容后重新输入 -> 触发（视为重新开始新段落）
//   场景5 用户粘贴多段文本 -> 仅对其中"从空变为非空"的段落触发
//   场景6 用户按 Backspace 删除空格 -> 不触发（纯删除操作）

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node } from "@tiptap/pm/model";

// 散文缩进扩展配置
export interface IndentParagraphOptions {
  /** 是否启用缩进 */
  enabled: boolean;
  /** 缩进宽度（全角空格数，1-4） */
  indentWidth: number;
}

// 全角空格常量
const FULLWIDTH_SPACE = "\u3000";

// 根据宽度生成缩进文本（全角空格重复，限制在 1-4 之间）
function getIndentText(width: number): string {
  return FULLWIDTH_SPACE.repeat(Math.max(1, Math.min(4, width)));
}

/**
 * 检查事务集合是否包含实际文字插入操作
 * 输入:
 *   transactions 待检查的事务集合
 * 输出:
 *   boolean 是否包含非空白的文字插入
 * 流程:
 *   1. 遍历所有事务的所有步骤
 *   2. 仅关注 ReplaceStep 类型步骤
 *   3. 跳过纯删除操作（slice.size === 0）
 *   4. 检查插入内容是否包含非空白文本节点
 * 设计意图:
 *   纯删除操作（Backspace/Delete）不应触发自动缩进
 *   仅段落结构变更（Enter 创建空段落）也不触发
 *   只有用户实际输入文字时才触发
 */
function hasActualTextInsertion(
  transactions: readonly Transaction[]
): boolean {
  return transactions.some((tr) => {
    return tr.steps.some((step) => {
      if (!(step instanceof ReplaceStep)) return false;
      // 纯删除操作（slice 为空）不触发
      if (step.slice.size === 0) return false;
      // 检查插入的内容是否包含非空白文本节点
      let hasText = false;
      step.slice.content.descendants((node: Node) => {
        if (node.isText && node.text && node.text.trim() !== "") {
          hasText = true;
          return false;
        }
        return true;
      });
      return hasText;
    });
  });
}

/**
 * 安全获取指定状态中指定位置的段落节点文本
 * 输入:
 *   state 编辑器状态
 *   paragraphPos 段落节点位置
 * 输出:
 *   string 段落文本内容（位置无效或非段落时返回空字符串）
 * 流程:
 *   1. 尝试在指定状态文档中定位节点
 *   2. 校验节点类型是否为 paragraph
 *   3. 返回文本内容或空字符串
 */
function safeGetParagraphText(
  state: EditorState,
  paragraphPos: number
): string {
  try {
    const node = state.doc.nodeAt(paragraphPos);
    if (node && node.type.name === "paragraph") {
      return node.textContent;
    }
  } catch {
    // 位置在旧状态中可能无效（如刚创建的新段落），返回空字符串
  }
  return "";
}

// 散文首行缩进扩展
// 输入: enabled 是否启用, indentWidth 缩进宽度
// 输出: TipTap Extension 实例
// 流程:
//   1. 监听编辑器事务，过滤非文档变更事务
//   2. 检测事务是否包含实际文字插入（纯删除/仅段落结构变更不触发）
//   3. 定位光标所在段落
//   4. 对比 oldState 与 newState 中段落状态：
//      - oldState 段落必须为空（首次输入场景）
//      - oldState 段落不能以全角空格开头（防止删除缩进过程中触发）
//   5. 检查段落是否已有缩进（以全角空格开头则跳过）
//   6. 检查前一段落是否有内容（空行作为段落分隔符不缩进）
//   7. 插入指定宽度的全角空格缩进
export const IndentParagraph = Extension.create<IndentParagraphOptions>({
  name: "indentParagraph",

  addOptions() {
    return {
      enabled: true,
      indentWidth: 2,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const pluginKey = new PluginKey("indentParagraph");

    return [
      new Plugin({
        key: pluginKey,
        appendTransaction: (
          transactions: readonly Transaction[],
          oldState: EditorState,
          newState: EditorState
        ): Transaction | null => {
          if (!options.enabled) return null;

          // 检查是否有文档结构变化（覆盖键盘输入、Enter 分段、粘贴等所有文本变更场景）
          const docChanged = transactions.some((tr) => tr.docChanged);
          if (!docChanged) return null;

          // 仅在用户实际输入非空白文字时才触发自动缩进
          // 纯删除操作和仅段落结构变更都不触发
          if (!hasActualTextInsertion(transactions)) return null;

          const { selection } = newState;
          const $head = selection.$head;
          const paragraphPos = $head.before($head.depth);

          if (paragraphPos < 0) return null;

          const paragraphNode: Node | null = newState.doc.nodeAt(paragraphPos);
          if (!paragraphNode || paragraphNode.type.name !== "paragraph") {
            return null;
          }

          const newText = paragraphNode.textContent;

          // 检查段落是否已有缩进（以至少一个全角空格开头即视为已缩进）
          if (newText.startsWith(FULLWIDTH_SPACE)) return null;

          // 核心：对比 oldState 中同位置段落状态
          // 只有当 oldState 段落为空时才触发，确保是"首次输入"场景
          const oldText = safeGetParagraphText(oldState, paragraphPos);

          // oldState 段落非空：用户在已有内容上编辑，不触发（尊重顶格意图）
          if (oldText.length > 0) return null;

          // oldState 段落以全角空格开头：用户正在删除缩进过程中，不触发
          // 覆盖场景：用户删除缩进字符后段落仍以全角空格开头，此时不应插入
          if (oldText.startsWith(FULLWIDTH_SPACE)) return null;

          // 此时 oldState 段落为空且不以全角空格开头
          // newState 段落非空（用户刚输入了文字）
          // 属于"新段落首次输入"场景，触发自动缩进

          // 检查前一段落是否有内容
          // 若前一段落为空（段落间空行分隔符），则当前段落不缩进
          // 这样保持段落间空行的视觉整洁
          if (paragraphPos > 0) {
            const prevNode = newState.doc.nodeAt(paragraphPos - 1);
            if (prevNode && prevNode.type.name === "paragraph") {
              const prevText = prevNode.textContent;
              // 前一段落为空（空行分隔符），当前段落不缩进
              if (prevText.trim() === "") return null;
            }
          }

          // 根据配置生成缩进文本并插入到段首
          const indentText = getIndentText(options.indentWidth);
          const tr = newState.tr;
          tr.insertText(indentText, paragraphPos + 1);
          return tr;
        },
      }),
    ];
  },
});
