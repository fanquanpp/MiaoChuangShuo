// 诗歌/歌词特殊排版 TipTap 扩展
//
// 功能概述：
// 为诗歌/歌词类型内容提供特殊排版功能，包括：
// 1. 诗歌块（居中、行间距加大）
// 2. 歌词块（带前缀符号、节与节之间分隔）
// 3. 自动识别诗歌格式并应用样式
//
// 模块职责：
// 1. 通过 addGlobalAttributes 为段落节点添加诗歌/歌词自定义属性
// 2. 提供 togglePoetry / toggleLyrics 命令供工具栏和快捷键调用
// 3. 监听 Ctrl+Shift+P / Ctrl+Shift+L 快捷键

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

// ===== 类型扩展：为 TipTap Commands 添加自定义命令声明 =====
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    poetryFormat: {
      /** 切换当前段落的诗歌排版样式 */
      togglePoetry: () => ReturnType;
      /** 切换当前段落的歌词排版样式 */
      toggleLyrics: () => ReturnType;
    };
  }
}

// 诗歌排版扩展配置
export interface PoetryFormatOptions {
  /** 是否启用诗歌排版 */
  enabled: boolean;
}

// ===== 核心样式切换逻辑 =====

/** 切换诗歌样式（供命令和快捷键共用） */
function togglePoetryInDoc(
  doc: PMNode,
  from: number,
  to: number,
  tr: ReturnType<ReturnType<typeof Object.prototype.valueOf> extends infer U ? () => U : never> extends never ? any : any,
): boolean {
  let changed = false;
  doc.nodesBetween(from, to, (node: PMNode, pos: number) => {
    if (node.type.name === "paragraph") {
      const attrs: Record<string, unknown> = { ...node.attrs };
      const isPoetry = attrs["data-poetry"] === "true";

      if (isPoetry) {
        attrs.class = null;
        attrs["data-poetry"] = null;
      } else {
        attrs.class = "poetry-block";
        attrs["data-poetry"] = "true";
        attrs["data-lyrics"] = null;
      }

      tr.setNodeMarkup(pos, undefined, attrs);
      changed = true;
    }
    return true;
  });
  return changed;
}

/** 切换歌词样式（供命令和快捷键共用） */
function toggleLyricsInDoc(
  doc: PMNode,
  from: number,
  to: number,
  tr: any,
): boolean {
  let changed = false;
  doc.nodesBetween(from, to, (node: PMNode, pos: number) => {
    if (node.type.name === "paragraph") {
      const attrs: Record<string, unknown> = { ...node.attrs };
      const isLyrics = attrs["data-lyrics"] === "true";

      if (isLyrics) {
        attrs.class = null;
        attrs["data-lyrics"] = null;
      } else {
        attrs.class = "lyrics-block";
        attrs["data-lyrics"] = "true";
        attrs["data-poetry"] = null;
      }

      tr.setNodeMarkup(pos, undefined, attrs);
      changed = true;
    }
    return true;
  });
  return changed;
}

// 诗歌排版扩展
export const PoetryFormat = Extension.create<PoetryFormatOptions>({
  name: "poetryFormat",

  addOptions() {
    return {
      enabled: true,
    };
  },

  // 为段落节点注册自定义属性，使其能被 ProseMirror schema 持久化
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          class: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute("class") || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.class) return {};
              return { class: attributes.class };
            },
          },
          "data-poetry": {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute("data-poetry"),
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes["data-poetry"] !== "true") return {};
              return { "data-poetry": "true" };
            },
          },
          "data-lyrics": {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute("data-lyrics"),
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes["data-lyrics"] !== "true") return {};
              return { "data-lyrics": "true" };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      togglePoetry:
        () =>
        ({ state, dispatch }) => {
          const { from, to } = state.selection;
          const tr = state.tr;
          const changed = togglePoetryInDoc(state.doc, from, to, tr);
          if (dispatch && changed) {
            dispatch(tr);
          }
          return changed;
        },

      toggleLyrics:
        () =>
        ({ state, dispatch }) => {
          const { from, to } = state.selection;
          const tr = state.tr;
          const changed = toggleLyricsInDoc(state.doc, from, to, tr);
          if (dispatch && changed) {
            dispatch(tr);
          }
          return changed;
        },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const pluginKey = new PluginKey("poetryFormat");

    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleKeyDown(view: EditorView, event: KeyboardEvent) {
            if (!options.enabled) return false;
            // Ctrl+Shift+P 切换诗歌模式
            if (
              (event.ctrlKey || event.metaKey) &&
              event.shiftKey &&
              (event.key === "P" || event.key === "p")
            ) {
              applyPoetryStyle(view);
              event.preventDefault();
              return true;
            }
            // Ctrl+Shift+L 切换歌词模式
            if (
              (event.ctrlKey || event.metaKey) &&
              event.shiftKey &&
              (event.key === "L" || event.key === "l")
            ) {
              applyLyricsStyle(view);
              event.preventDefault();
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

// ===== 快捷键处理器（供 ProseMirror 插件调用） =====

function applyPoetryStyle(view: EditorView): void {
  const { state } = view;
  const { from, to } = state.selection;
  const tr = state.tr;
  const changed = togglePoetryInDoc(state.doc, from, to, tr);
  if (changed) {
    view.dispatch(tr);
  }
}

function applyLyricsStyle(view: EditorView): void {
  const { state } = view;
  const { from, to } = state.selection;
  const tr = state.tr;
  const changed = toggleLyricsInDoc(state.doc, from, to, tr);
  if (changed) {
    view.dispatch(tr);
  }
}

// 诗歌与歌词 CSS 样式位于 src/styles.css（.poetry-block / .lyrics-block）
