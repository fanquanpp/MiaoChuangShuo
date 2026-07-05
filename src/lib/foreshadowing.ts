// 伏笔标记 TipTap Mark 扩展
//
// 功能概述：
// 在正文中标记伏笔文本片段，关联伏笔条目（位于"伏笔"目录下的 .txt 文件）。
// 支持 3 种状态（埋设/回收/废弃），不同状态对应不同视觉样式：
//   - pending（埋设）: 蓝色虚线下划线，提示此处埋有伏笔
//   - resolved（回收）: 绿色实线下划线，提示伏笔已回收
//   - abandoned（废弃）: 灰色删除线，提示伏笔废弃
//
// 模块职责：
// 1. 定义 foreshadowing Mark（inline，excludes 限制）
// 2. attrs.foreshadowingId 关联伏笔条目 UUID
// 3. attrs.status 持久化伏笔状态
// 4. 提供 toggleForeshadowing 命令（带状态参数）
// 5. 提供 updateForeshadowingStatus 命令（伏笔面板状态变更时批量更新）
// 6. parseHTML 兼容旧版 .html 中的 <span class="foreshadowing"> 标记
//
// 设计说明：
// 不直接继承 @tiptap/extension-highlight，因为 Highlight 的 multicolor 模型
// 仅支持 color 属性，无法承载 foreshadowingId + status 双属性。
// 改为基于 Mark.create 独立实现，复用 Highlight 的视觉范式（下划线/背景色）
// 但扩展 attrs 以支持伏笔追踪所需的元数据。

import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * 伏笔状态枚举
 * - pending: 埋设中，伏笔已埋下但未回收
 * - resolved: 已回收，伏笔在后续章节被回收
 * - abandoned: 废弃，伏笔因剧情调整被废弃
 */
export type ForeshadowingStatus = "pending" | "resolved" | "abandoned";

/**
 * 伏笔 Mark 配置
 */
export interface ForeshadowingOptions {
  /**
   * HTMLAttributes 合并到渲染节点
   */
  HTMLAttributes: Record<string, string>;
  /**
   * 是否允许多个伏笔标记重叠（默认 false，避免视觉混乱）
   */
  inclusive: boolean;
}

/**
 * 校验字符串是否为合法的 ForeshadowingStatus
 * 输入: raw 待校验字符串
 * 输出: 合法则返回原值，否则返回 "pending" 默认值
 * 流程: 与 3 种枚举值比对，命中返回原值，未命中返回默认
 */
function normalizeStatus(raw: string | null | undefined): ForeshadowingStatus {
  if (raw === "pending" || raw === "resolved" || raw === "abandoned") {
    return raw;
  }
  return "pending";
}

/**
 * 伏笔状态到 CSS 类名映射
 * 每种状态对应一个独立的 nf-foreshadowing--{status} 类，由 Tailwind/FANDEX 主题提供视觉
 */
const FORESHADOWING_CLASS: Record<ForeshadowingStatus, string> = {
  pending: "nf-foreshadowing--pending",
  resolved: "nf-foreshadowing--resolved",
  abandoned: "nf-foreshadowing--abandoned",
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    foreshadowing: {
      /**
       * 切换伏笔标记（选区有标记则移除，无标记则添加）
       * 输入:
       *   foreshadowingId - 伏笔条目 UUID
       *   status - 伏笔状态（默认 pending）
       * 流程:
       *   1. 校验 foreshadowingId 非空
       *   2. 当前选区为空时返回 false
       *   3. 选区内已有相同 foreshadowingId 的标记时移除
       *   4. 否则在选区上添加 foreshadowing Mark
       */
      toggleForeshadowing: (foreshadowingId: string, status?: ForeshadowingStatus) => ReturnType;
      /**
       * 批量更新伏笔标记状态（伏笔面板状态变更时调用）
       * 输入:
       *   foreshadowingId - 目标伏笔 UUID
       *   newStatus - 新状态
       * 流程: 遍历文档所有匹配 foreshadowingId 的 Mark，更新其 status attrs
       */
      updateForeshadowingStatus: (foreshadowingId: string, newStatus: ForeshadowingStatus) => ReturnType;
      /**
       * 移除文档中所有指定伏笔的标记（伏笔条目删除时调用）
       * 输入: foreshadowingId - 目标伏笔 UUID
       * 流程: 遍历文档，移除所有匹配 foreshadowingId 的 Mark
       */
      removeForeshadowing: (foreshadowingId: string) => ReturnType;
    };
  }
}

/**
 * Foreshadowing Mark 扩展
 *
 * 渲染为 span.nf-foreshadowing[data-foreshadowing-id][data-status]
 * 视觉由 CSS 提供：pending 虚线下划线、resolved 实线下划线、abandoned 删除线
 */
export const Foreshadowing = Mark.create<ForeshadowingOptions>({
  name: "foreshadowing",

  inclusive: false,

  excludes: "",

  addOptions() {
    return {
      HTMLAttributes: {},
      inclusive: false,
    };
  },

  addAttributes() {
    return {
      /**
       * 伏笔条目 UUID，关联"伏笔"目录下的伏笔文件
       * 伏笔面板状态变更时，通过此 ID 反向定位文档中的标记并更新 status
       */
      foreshadowingId: {
        default: "",
        parseHTML: (el): string => (el as HTMLElement).getAttribute("data-foreshadowing-id") || "",
        renderHTML: (attrs): Record<string, string> => ({
          "data-foreshadowing-id": String(attrs.foreshadowingId || ""),
        }),
      },
      /**
       * 伏笔状态：pending/resolved/abandoned
       * 决定视觉样式（虚线/实线/删除线）
       */
      status: {
        default: "pending",
        parseHTML: (el): string => normalizeStatus((el as HTMLElement).getAttribute("data-status")),
        renderHTML: (attrs): Record<string, string> => ({
          "data-status": normalizeStatus(attrs.status as string),
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-foreshadowing-id]",
      },
      // 兼容旧版 .html 中的 <span class="foreshadowing"> 格式
      {
        tag: "span.foreshadowing",
        getAttrs: (node): Record<string, string> => {
          const el = node as HTMLElement;
          return {
            foreshadowingId: el.getAttribute("data-foreshadowing-id") || "",
            status: normalizeStatus(el.getAttribute("data-status") || el.getAttribute("data-state")),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const status = normalizeStatus(HTMLAttributes.status as string);
    // 合并外部 HTMLAttributes 与内部 class
    // class 包含 nf-foreshadowing 基类与状态变体类
    const merged = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      class: `nf-foreshadowing ${FORESHADOWING_CLASS[status]}`,
    });
    return ["span", merged];
  },

  addCommands() {
    return {
      toggleForeshadowing:
        (foreshadowingId: string, status: ForeshadowingStatus = "pending") =>
        ({ commands, state, tr }) => {
          // 校验 foreshadowingId 非空（空 ID 的伏笔标记无关联条目，无意义）
          if (!foreshadowingId) {
            return false;
          }
          // 当前选区为空时无法添加 Mark
          if (state.selection.empty) {
            return false;
          }
          // 检查选区内是否已有相同 foreshadowingId 的标记
          const { from, to } = state.selection;
          let hasExisting = false;
          state.doc.nodesBetween(from, to, (node) => {
            if (node.marks.some((m) => m.type.name === this.name && m.attrs.foreshadowingId === foreshadowingId)) {
              hasExisting = true;
              return false;
            }
            return true;
          });
          // 已有相同 ID 的标记时移除，否则添加
          // TipTap v2 SingleCommands 无 removeMark，改用 tr.removeMark 直接操作事务
          if (hasExisting) {
            tr.removeMark(from, to, this.type);
            return true;
          }
          return commands.setMark(this.name, { foreshadowingId, status });
        },
      updateForeshadowingStatus:
        (foreshadowingId: string, newStatus: ForeshadowingStatus) =>
        ({ tr, state }) => {
          let modified = false;
          // 遍历文档所有节点，查找包含目标 foreshadowingId 的 Mark 并更新 status
          state.doc.descendants((node, pos) => {
            const marks = node.marks.filter(
              (m) => m.type.name === this.name && m.attrs.foreshadowingId === foreshadowingId
            );
            if (marks.length === 0) {
              return true;
            }
            for (const oldMark of marks) {
              if (oldMark.attrs.status !== newStatus) {
                // 从节点 pos 开始，移除旧 Mark 并添加新 status 的 Mark
                // removeMark 第三参数需为 MarkType，this.name 是字符串会类型报错
                tr.removeMark(pos, pos + node.nodeSize, this.type);
                tr.addMark(
                  pos,
                  pos + node.nodeSize,
                  this.type.create({
                    foreshadowingId,
                    status: newStatus,
                  })
                );
                modified = true;
              }
            }
            return false;
          });
          return modified;
        },
      removeForeshadowing:
        (foreshadowingId: string) =>
        ({ tr, state }) => {
          let modified = false;
          // 遍历文档，移除所有匹配 foreshadowingId 的 Mark
          state.doc.descendants((node, pos) => {
            const hasMark = node.marks.some(
              (m) => m.type.name === this.name && m.attrs.foreshadowingId === foreshadowingId
            );
            if (hasMark) {
              tr.removeMark(pos, pos + node.nodeSize, this.type);
              modified = true;
              return false;
            }
            return true;
          });
          return modified;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Alt+Shift+F: 在选区上快速标记伏笔（使用默认 pending 状态）
      // 注意：避开 Alt+7（人物图）和 Alt+8（伏笔面板）的快捷键冲突
      "Alt-Shift-f": () => {
        const { state } = this.editor;
        if (state.selection.empty) {
          return false;
        }
        // 无 foreshadowingId 时无法标记，需通过伏笔面板触发
        // 此快捷键仅作为已有 foreshadowingId 时的快速重标记入口
        return false;
      },
    };
  },
});
