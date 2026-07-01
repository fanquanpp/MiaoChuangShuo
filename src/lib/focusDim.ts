// 焦点暗化 TipTap 扩展（iA Writer 风格）
//
// 功能概述：
// 借鉴 iA Writer 的 Sentence / Paragraph Focus 功能，将非当前段落（可选当前句）
// 的不透明度降低，使作者视觉焦点自然集中在正在书写的内容上。
// 与 lineHighlight 的"当前段落高亮"互补：lineHighlight 加亮当前，focusDim 暗化其余。
//
// 模块职责：
// 1. 监听选区变化（光标移动）
// 2. 定位当前段落的范围
// 3. 为所有非当前段落添加 dim 装饰（降低 opacity）
// 4. 选区跨段落时，仅高亮起始段落
//
// 设计原则：
// - 使用 Decoration.node 为段落添加 style 属性，不影响文档数据
// - 装饰集合在选区变化时重建，性能可控
// - 暗化程度可通过配置调节，默认 0.35
// - 支持"段落焦点"与"句子焦点"两种模式（当前仅实现段落焦点）

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// 焦点暗化配置选项
export interface FocusDimOptions {
  /** 是否启用焦点暗化 */
  enabled: boolean;
  /** 非焦点段落的透明度（0-1，建议 0.25-0.5） */
  dimOpacity: number;
  /** 焦点范围：paragraph=当前段落, sentence=当前句子 */
  scope: "paragraph" | "sentence";
}

// 插件键
const focusDimKey = new PluginKey("focusDim");

/**
 * 构建焦点暗化装饰集合
 * 输入:
 *   state 编辑器状态
 *   dimOpacity 暗化透明度
 * 输出:
 *   DecorationSet 装饰集合（为所有非当前段落添加 opacity 样式）
 * 流程:
 *   1. 定位当前光标所在段落
 *   2. 遍历文档所有顶层段落节点
 *   3. 对非当前段落添加 style 装饰（opacity）
 *   4. 返回装饰集合
 */
function buildFocusDimDecorations(
  state: EditorState,
  dimOpacity: number
): DecorationSet {
  const { doc, selection } = state;
  const $head = selection.$head;

  // 当前段落的起始位置
  const currentParaStart = $head.depth >= 1 ? $head.before($head.depth) : -1;

  const decorations: Decoration[] = [];

  // 遍历文档顶层节点（段落）
  doc.forEach((node, offset) => {
    // 跳过非段落节点（如标题、代码块）
    if (node.type.name !== "paragraph") return;
    // 跳过当前段落
    if (offset === currentParaStart) return;

    // 为非当前段落添加透明度装饰
    decorations.push(
      Decoration.node(offset, offset + node.nodeSize, {
        style: `opacity: ${dimOpacity}; transition: opacity 0.2s ease-out;`,
      })
    );
  });

  // 当前段落也添加一个过渡装饰，使焦点切换更平滑
  if (currentParaStart >= 0) {
    decorations.push(
      Decoration.node(currentParaStart, currentParaStart + ($head.parent.nodeSize || 0), {
        style: `transition: opacity 0.2s ease-out;`,
      })
    );
  }

  return DecorationSet.create(doc, decorations);
}

// 焦点暗化扩展
// 输入: enabled 是否启用, dimOpacity 暗化透明度, scope 焦点范围
// 输出: TipTap Extension 实例
// 流程:
//   1. 注册 ProseMirror 插件
//   2. 初始化时构建装饰集合
//   3. 选区变化时重建装饰集合
//   4. 编辑器失焦时清除暗化装饰,恢复正常亮度,避免切换界面后文字变浅
export const FocusDim = Extension.create<FocusDimOptions>({
  name: "focusDim",

  addOptions() {
    return {
      enabled: false,
      dimOpacity: 0.35,
      scope: "paragraph",
    };
  },

  // 编辑器失焦时:清除暗化装饰,让所有文字恢复正常亮度
  // 解决"切换界面后文字变浅"问题:失焦后不应保持暗化状态
  onBlur() {
    if (this.editor.isDestroyed) return;
    this.editor.view.dispatch(
      this.editor.view.state.tr.setMeta(focusDimKey, { blurred: true })
    );
  },

  // 编辑器聚焦时:重建暗化装饰,恢复焦点效果
  onFocus() {
    if (this.editor.isDestroyed) return;
    this.editor.view.dispatch(
      this.editor.view.state.tr.setMeta(focusDimKey, { blurred: false })
    );
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin<DecorationSet>({
        key: focusDimKey,
        state: {
          init(_, state): DecorationSet {
            if (!options.enabled) return DecorationSet.empty;
            return buildFocusDimDecorations(state, options.dimOpacity);
          },
          apply(tr, oldState, _oldState2, newState): DecorationSet {
            if (!options.enabled) return DecorationSet.empty;
            // 失焦标记:清除暗化装饰,恢复正常亮度
            const blurred = tr.getMeta(focusDimKey)?.blurred;
            if (blurred === true) return DecorationSet.empty;
            // 聚焦标记:重建暗化装饰
            if (blurred === false) return buildFocusDimDecorations(newState, options.dimOpacity);
            // 仅在选区或文档变化时重建
            if (!tr.docChanged && !tr.selectionSet) {
              return oldState;
            }
            return buildFocusDimDecorations(newState, options.dimOpacity);
          },
        },
        props: {
          decorations(state: EditorState): DecorationSet {
            return this.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
