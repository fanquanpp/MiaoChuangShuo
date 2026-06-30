// 当前段落高亮 TipTap 扩展
//
// 功能概述：
// 为小说编辑器提供 VSCode 风格的当前行高亮效果。
// 由于小说以段落为基本单位，本扩展将"当前行"高亮升级为"当前段落"高亮，
// 光标所在段落会获得淡色背景与左侧色条，帮助作者快速定位编辑位置。
//
// 模块职责：
// 1. 监听选区变化（包括光标移动与文本选择）
// 2. 定位光标所在段落的位置范围
// 3. 使用 ProseMirror Decoration.node 为该段落添加 class
// 4. 选区跨段落时，仅高亮起始段落
//
// 设计原则：
// - 使用 Decoration.node 而非 Decoration.inline，避免段落内多处装饰
// - 装饰不参与文档数据（不影响保存内容）
// - 性能考虑：仅在选区变化时重算装饰集合

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { ResolvedPos } from "@tiptap/pm/model";

// 扩展配置接口
export interface LineHighlightOptions {
  /** 是否启用当前段落高亮 */
  enabled: boolean;
  /** 高亮段落使用的 class 名称 */
  className: string;
}

// 插件键
const lineHighlightKey = new PluginKey("lineHighlight");

/**
 * 根据编辑器状态构建装饰集合
 * 输入:
 *   state 编辑器状态
 *   className 高亮 class 名
 * 输出:
 *   DecorationSet 装饰集合（仅含当前段落装饰）
 * 流程:
 *   1. 解析选区位置
 *   2. 定位光标所在段落
 *   3. 创建节点级装饰（添加 class）
 *   4. 返回装饰集合
 */
function buildDecorations(state: EditorState, className: string): DecorationSet {
  const { selection } = state;
  const $from: ResolvedPos = selection.$from;

  // 深度 < 1 表示不在段落内（如文档根节点）
  if ($from.depth < 1) return DecorationSet.empty;

  const paragraph = $from.parent;
  // 仅对段落节点应用高亮
  if (paragraph.type.name !== "paragraph") return DecorationSet.empty;

  // 获取段落在文档中的起始位置
  const start = $from.before($from.depth);
  // 节点装饰：为整个段落节点添加 class
  const decoration = Decoration.node(start, start + paragraph.nodeSize, {
    class: className,
  });

  return DecorationSet.create(state.doc, [decoration]);
}

// 当前段落高亮扩展
// 输入: enabled 是否启用, className 高亮 class 名
// 输出: TipTap Extension 实例
// 流程:
//   1. 注册 ProseMirror 插件
//   2. 初始化时构建装饰集合
//   3. 应用事务时重建装饰集合（基于新状态）
export const LineHighlight = Extension.create<LineHighlightOptions>({
  name: "lineHighlight",

  addOptions() {
    return {
      enabled: true,
      className: "current-paragraph",
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin<DecorationSet>({
        key: lineHighlightKey,
        state: {
          // 初始化装饰集合
          init(_, state): DecorationSet {
            if (!options.enabled) return DecorationSet.empty;
            return buildDecorations(state, options.className);
          },
          // 应用事务时重建装饰集合
          apply(tr, _oldState, _oldState2, newState): DecorationSet {
            if (!options.enabled) return DecorationSet.empty;
            // 文档或选区未变化时，保持原装饰集合
            if (!tr.docChanged && !tr.selectionSet) {
              return _oldState;
            }
            return buildDecorations(newState, options.className);
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
