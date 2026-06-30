// 散文类型自动首行缩进 TipTap 扩展
//
// 功能概述：
// 为散文类项目（标准长篇/短篇/日记/分卷/同世界观/诗歌等）提供段落首行自动缩进功能。
// 当用户在新段落起始位置输入文字时，自动在段首插入指定数量的全角空格作为缩进。
// 缩进宽度可通过 indentWidth 配置（1-4 个全角空格）。
//
// 模块职责：
// 1. 监听编辑器文本输入事务
// 2. 检测光标是否位于段首附近
// 3. 自动插入全角空格缩进
// 4. 防止重复插入（段落已以全角空格开头则跳过）
// 5. 跳过空行分隔符（前一段落为空时不缩进，避免段落间空行被缩进）

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node } from "@tiptap/pm/model";

// 散文缩进扩展配置
export interface IndentParagraphOptions {
  /** 是否启用缩进 */
  enabled: boolean;
  /** 缩进宽度（全角空格数，1-4） */
  indentWidth: number;
}

// 根据宽度生成缩进文本（全角空格重复，限制在 1-4 之间）
function getIndentText(width: number): string {
  return "\u3000".repeat(Math.max(1, Math.min(4, width)));
}

// 散文首行缩进扩展
// 输入: enabled 是否启用, indentWidth 缩进宽度
// 输出: TipTap Extension 实例
// 流程:
//   1. 监听编辑器事务，过滤非文本输入事务
//   2. 定位光标所在段落
//   3. 检查段落是否已有缩进（以全角空格开头则跳过）
//   4. 检查光标是否在段首附近（偏移量 <= 缩进宽度 + 容差）
//   5. 检查前一段落是否有内容（空行作为段落分隔符不缩进）
//   6. 插入指定宽度的全角空格缩进
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
          _oldState: EditorState,
          newState: EditorState
        ): Transaction | null => {
          if (!options.enabled) return null;

          // 检查是否有文档结构变化
          const docChanged = transactions.some((tr) => tr.docChanged);
          if (!docChanged) return null;

          // 检查是否有文本输入事务（insertText 或 paste）
          // 注：ProseMirror 的 Enter 键产生 splitBlock，不会触发此分支
          const hasTextInput = transactions.some(
            (tr) =>
              tr.getMeta("inputType") === "insertText" ||
              tr.getMeta("paste") === true
          );
          if (!hasTextInput) return null;

          const { selection } = newState;
          const $head = selection.$head;
          const paragraphPos = $head.before($head.depth);

          if (paragraphPos < 0) return null;

          const paragraphNode: Node | null = newState.doc.nodeAt(paragraphPos);
          if (!paragraphNode || paragraphNode.type.name !== "paragraph") {
            return null;
          }

          const text = paragraphNode.textContent;

          // 检查段落是否已有缩进（以至少一个全角空格开头即视为已缩进）
          if (text.startsWith("\u3000")) return null;

          // 检查光标是否在段首附近（偏移量 <= 缩进宽度 + 2 容差）
          // 容差用于支持用户快速输入少量字符后仍能触发缩进
          const offsetInParagraph = $head.parentOffset;
          const tolerance = options.indentWidth + 2;
          if (offsetInParagraph > tolerance) return null;

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
