// 场景分隔符 TipTap 节点扩展
//
// 功能概述：
// 基于 @tiptap/extension-horizontal-rule 扩展，提供小说/剧本创作中的场景分隔能力。
// 支持四种视觉样式（居中线/星号/花纹/留白），通过 attrs 持久化样式选择，
// 并在 .pmd JSON 存储中保留 sceneType 属性，便于后续 AI 解析与跨文体复用。
//
// 模块职责：
// 1. 继承 HorizontalRule 的 NodeSpec 与输入规则（--- 触发）
// 2. 扩展 attrs.sceneType，支持 4 种样式持久化
// 3. 提供 toggleSceneBreak 命令，按当前选中样式插入
// 4. 自定义 HTMLAttributes 渲染，按 sceneType 应用不同 CSS 类
// 5. 阻止场景分隔符内部光标进入（atom 节点）
//
// 设计说明：
// 不直接使用 HorizontalRule.configure()，而是通过 Node.create 基于 horizontalRule 的 schema
// 派生新节点，避免与已注册的 HorizontalRule 产生命名冲突。
// 命令注册名 sceneBreak 与 horizontalRule 互斥，NovelEditor 中应仅注册其一。

import { Node, mergeAttributes } from "@tiptap/core";

/**
 * 场景分隔样式枚举
 * - centered: 居中细分隔线（默认，传统小说场景切换）
 * - asterisk: 居中三连星号 * * *（欧美小说常用）
 * - ornament: 居中花纹装饰（古风/西幻史诗专用）
 * - blank: 留白分隔（仅段落间距，剧本场景切换常用）
 */
export type SceneBreakType = "centered" | "asterisk" | "ornament" | "blank";

/**
 * 场景分隔符扩展配置
 */
export interface SceneBreakOptions {
  /**
   * 默认场景分隔样式，用于无显式样式参数时的插入
   * 默认值: "centered"
   */
  defaultType: SceneBreakType;
  /**
   * HTMLAttributes 合并到渲染节点，便于外部注入 class/style
   */
  HTMLAttributes: Record<string, string>;
}

/**
 * 校验字符串是否为合法的 SceneBreakType
 * 输入: raw 待校验字符串
 * 输出: 合法则返回原值，否则返回 "centered" 默认值
 * 流程: 与 4 种枚举值比对，命中返回原值，未命中返回默认
 */
function normalizeSceneType(raw: string | null | undefined): SceneBreakType {
  if (raw === "centered" || raw === "asterisk" || raw === "ornament" || raw === "blank") {
    return raw;
  }
  return "centered";
}

/**
 * 场景分隔样式到 CSS 类名映射
 * 每种样式对应一个独立的 nf-scene-break--{type} 类，由 Tailwind/FANDEX 主题提供视觉
 */
const SCENE_BREAK_CLASS: Record<SceneBreakType, string> = {
  centered: "nf-scene-break--centered",
  asterisk: "nf-scene-break--asterisk",
  ornament: "nf-scene-break--ornament",
  blank: "nf-scene-break--blank",
};

/**
 * 场景分隔样式到可见文本映射
 * asterisk/ornament 需要可见字符；centered/blank 仅靠 CSS 边框/留白呈现
 */
const SCENE_BREAK_TEXT: Record<SceneBreakType, string> = {
  centered: "",
  asterisk: "* * *",
  ornament: "~ * ~",
  blank: "",
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sceneBreak: {
      /**
       * 插入场景分隔符
       * 输入: type 场景样式（缺省取 options.defaultType）
       * 流程:
       *   1. 规范化 type 参数
       *   2. 在当前选区位置插入 sceneBreak 节点
       *   3. 插入后追加空段落，并将光标移至空段落起点
       */
      setSceneBreak: (type?: SceneBreakType) => ReturnType;
    };
  }
}

/**
 * SceneBreak 节点扩展
 * 基于 HorizontalRule 的 schema 派生，新增 attrs.sceneType 持久化样式
 */
export const SceneBreak = Node.create<SceneBreakOptions>({
  name: "sceneBreak",

  // 继承 HorizontalRule 的基础属性：块级、原子、无内容
  group: "block",

  atom: true,

  // 与 HorizontalRule 一致的解析规则：匹配 <hr> 标签
  parseHTML() {
    return [
      { tag: "hr" },
      // 兼容带 scene-break data 属性的 div（用于 .html 旧文件迁移时识别）
      {
        tag: "div[data-scene-break]",
        getAttrs: (node): Record<string, string> => {
          const el = node as HTMLElement;
          return { sceneType: normalizeSceneType(el.getAttribute("data-scene-type")) };
        },
      },
    ];
  },

  addOptions() {
    return {
      defaultType: "centered",
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      sceneType: {
        default: "centered",
        parseHTML: (el): string => {
          const dom = el as HTMLElement;
          return normalizeSceneType(
            dom.getAttribute("data-scene-type") || dom.getAttribute("sceneType")
          );
        },
        renderHTML: (attrs): Record<string, string> => {
          const t = normalizeSceneType(attrs.sceneType as string);
          return { "data-scene-type": t };
        },
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const sceneType = normalizeSceneType(HTMLAttributes.sceneType as string);
    const text = SCENE_BREAK_TEXT[sceneType];

    // 合并外部 HTMLAttributes 与内部 class
    // class 同时包含基类 nf-scene-break 与变体类，便于 Tailwind 主题统一控制
    const merged = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      class: `nf-scene-break ${SCENE_BREAK_CLASS[sceneType]}`,
      "data-scene-break": "true",
    });

    // 有可见文本的样式（asterisk/ornament）渲染为带文本的 div
    // 无可见文本的样式（centered/blank）渲染为空 div，依赖 CSS 边框/留白
    if (text) {
      return ["div", merged, text];
    }
    return ["div", merged];
  },

  renderText({ node }) {
    // 纯文本导出时的占位符，便于 .txt 导出时识别场景分隔
    const sceneType = normalizeSceneType(node.attrs.sceneType as string);
    const text = SCENE_BREAK_TEXT[sceneType];
    if (text) {
      return `\n${text}\n`;
    }
    // centered/blank 在纯文本中用统一占位 * * * 保证可读性
    return "\n* * *\n";
  },

  addCommands() {
    return {
      setSceneBreak:
        (type?: SceneBreakType) =>
        ({ chain }) => {
          const sceneType = normalizeSceneType(type ?? this.options.defaultType);
          // 插入 sceneBreak 节点，紧接一个空段落（便于光标落点与后续输入）
          return chain()
            .insertContent({
              type: this.name,
              attrs: { sceneType },
            })
            .insertContent({ type: "paragraph" })
            .focus()
            .run();
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Mod+Enter 在段落内插入场景分隔符（与 HardBreak 的 Shift+Enter 区分）
      "Mod-Enter": () => this.editor.commands.setSceneBreak(this.options.defaultType),
    };
  },

  addInputRules() {
    // 不复用 HorizontalRule 的 --- 输入规则，避免与已注册的 HorizontalRule 冲突
    // NovelEditor 中二选一注册：传统项目用 HorizontalRule，新项目用 SceneBreak
    return [];
  },

  // 阻止 NodeView 内部出现光标，保持 atom 行为
  selectable: true,
  draggable: true,
});
