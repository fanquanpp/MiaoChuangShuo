// 打字机模式 TipTap 扩展
//
// 功能概述：
// 借鉴 iA Writer / FocusWriter 的打字机模式，让当前光标所在行始终保持在
// 编辑器可视区域的垂直中央，降低长时间码字的视觉疲劳。
// 与 ProseMirror 默认的 scrollIntoView 不同，本扩展主动将光标行滚动到容器中央。
//
// 模块职责：
// 1. 监听选区变化（光标移动、文本输入、程序跳转）
// 2. 定位光标所在行在视口中的坐标
// 3. 计算使光标行居中所需的滚动偏移量
// 4. 平滑滚动编辑器容器至目标位置
// 5. 支持禁用开关（用户设置控制）
//
// 设计原则：
// - 仅在选区或文档变化时触发，避免无效滚动
// - 使用 requestAnimationFrame 保证在 DOM 更新后执行
// - 尊重 prefers-reduced-motion 偏好
// - 不干扰 ProseMirror 自身的滚动逻辑（仅在需要时主动滚动）

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// 打字机模式配置选项
export interface TypewriterModeOptions {
  /** 是否启用打字机模式 */
  enabled: boolean;
  /**
   * 居中偏移比例（0-1）
   * 0.5 表示精确居中（默认），0.3 表示偏上居中
   */
  centerRatio: number;
}

// 插件键
const typewriterKey = new PluginKey("typewriterMode");

/**
 * 查找编辑器内容的滚动容器
 * 输入: dom 编辑器 DOM 根节点
 * 输出: HTMLElement | null 滚动容器元素
 * 流程: 从编辑器 DOM 向上查找最近的 overflow-auto/scroll 祖先
 */
function findScrollContainer(dom: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = dom;
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * 将光标所在行滚动到容器中央
 * 输入:
 *   view ProseMirror 编辑器视图
 *   centerRatio 居中比例（0-1）
 * 输出: 无
 * 流程:
 *   1. 获取滚动容器
 *   2. 获取光标在视口中的坐标
 *   3. 计算光标相对容器的偏移
 *   4. 计算使光标居中所需的目标 scrollTop
 *   5. 平滑滚动至目标位置
 */
function scrollCursorToCenter(view: EditorView, centerRatio: number): void {
  const container = findScrollContainer(view.dom);
  if (!container) return;

  // 尊重减少动画偏好：直接跳转而非平滑滚动
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  try {
    const coords = view.coordsAtPos(view.state.selection.head);
    const containerRect = container.getBoundingClientRect();

    // 光标中心相对容器顶部的偏移
    const cursorTop = coords.top - containerRect.top;
    const cursorHeight = coords.bottom - coords.top;
    const cursorCenter = cursorTop + cursorHeight / 2;

    // 计算使光标位于容器指定比例位置所需的 scrollTop
    const targetScrollTop = container.scrollTop + cursorCenter - container.clientHeight * centerRatio;

    // 若偏差小于 2px 则不滚动，避免抖动
    if (Math.abs(container.scrollTop - targetScrollTop) < 2) return;

    container.scrollTo({
      top: targetScrollTop,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  } catch {
    // coordsAtPos 在极端情况下可能抛错（如节点未渲染），安全跳过
  }
}

// 打字机模式扩展
// 输入: enabled 是否启用, centerRatio 居中比例
// 输出: TipTap Extension 实例
// 流程:
//   1. 注册 ProseMirror 插件，通过 view 生命周期获取编辑器视图引用
//   2. 在编辑器更新后（选区或文档变化），延迟一帧执行滚动居中
export const TypewriterMode = Extension.create<TypewriterModeOptions>({
  name: "typewriterMode",

  addOptions() {
    return {
      enabled: true,
      centerRatio: 0.45,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    // 保存编辑器视图引用，供 apply 中使用
    let editorView: EditorView | null = null;

    return [
      new Plugin({
        key: typewriterKey,
        view(view: EditorView) {
          editorView = view;
          return {
            update(updatedView: EditorView) {
              editorView = updatedView;
              if (!options.enabled) return;
              // 延迟到下一帧执行，确保 DOM 已更新
              requestAnimationFrame(() => {
                if (editorView) {
                  scrollCursorToCenter(editorView, options.centerRatio);
                }
              });
            },
          };
        },
      }),
    ];
  },
});
