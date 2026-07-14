// 角色名提及 TipTap 扩展（双形态）
//
// 功能概述：
// 本模块提供两种角色名相关扩展，按文体场景独立注册：
//
// 1. CharacterMention（Extension，段落级前缀补全）
//    用于舞台剧本/对话体，在台词行前自动填充"角色名: "前缀。
//    - Tab 键弹出角色名选择浮层
//    - 换行自动轮换（A→B→A→B）
//    - Ctrl+Shift+N 在选中段落前插入角色名
//
// 2. CharacterMentionNode（Node，行内 Inline Node）
//    用于小说/散文中的角色提及，将角色名渲染为可点击的 inline node。
//    - attrs.characterId 关联设定库 CodexMeta.id（UUID v4）
//    - attrs.name 显示名（与设定库 CodexMeta.name 同步）
//    - 渲染为 span.nf-character-mention，支持点击跳转设定库
//    - 用于阶段 5 实体高亮、悬停卡片的统一锚点
//
// 模块职责：
// 1. CharacterMention: 段落级前缀补全（剧本模式）
// 2. CharacterMentionNode: 行内 inline node（小说模式）
// 3. 两者共享 picker UI，但触发方式与数据形态不同
// 4. CharacterMentionNode 的 characterId 是阶段 1 设定库 UUID 的下游消费者

import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import CharacterMentionPicker, { type CharacterMentionPickerLabels } from "../components/CharacterMentionPicker";

// 角色名选择扩展的配置选项
export interface CharacterMentionOptions {
  characters: string[];
  onSelect: (name: string) => void;
  /** 功能开关：false 时 Tab 键不拦截，交还默认缩进行为（默认 true） */
  enabled: boolean;
  /** 浮层显示文案标签（由父组件通过 useI18n 翻译后传入） */
  labels?: CharacterMentionPickerLabels;
}

/**
 * 从文本中提取开头的角色名（匹配 "角色名: " 或 "角色名： " 模式）
 * 输入: text 行文本, characters 角色名列表
 * 输出: 匹配到的角色名，未匹配返回 null
 * 流程: 遍历角色名列表，检查文本是否以"角色名:"或"角色名："开头
 */
function extractCharacterPrefix(text: string, characters: string[]): string | null {
  for (const name of characters) {
    if (text.startsWith(`${name}: `) || text.startsWith(`${name}： `) ||
        text.startsWith(`${name}:`) || text.startsWith(`${name}：`)) {
      return name;
    }
  }
  return null;
}

/**
 * 获取下一个角色名（基于角色列表顺序循环轮换）
 * 输入: currentName 当前角色名, characters 角色名列表
 * 输出: 下一个角色名
 * 流程:
 *   1. 在角色列表中查找当前角色名的位置
 *   2. 返回下一个角色名（循环到列表末尾时回到第一个）
 *   3. 若当前角色名不在列表中，返回列表第一个角色名
 */
function getNextCharacterName(currentName: string, characters: string[]): string {
  const idx = characters.indexOf(currentName);
  if (idx < 0) {
    // 当前角色名不在列表中，默认返回第一个
    return characters[0];
  }
  // 循环轮换：末尾的下一个是开头
  const nextIdx = (idx + 1) % characters.length;
  return characters[nextIdx];
}

export const CharacterMention = Extension.create<CharacterMentionOptions>({
  name: "characterMention",

  addOptions() {
    return {
      characters: [],
      onSelect: () => {},
      enabled: true,
      labels: {},
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const pluginKey = new PluginKey("characterMention");

    return [
      new Plugin({
        key: pluginKey,
        state: {
          init() {
            return { active: false, query: "", selectedIndex: 0, rect: null as DOMRect | null };
          },
          apply(_tr, prev) {
            return prev;
          },
        },

        // 换行自动轮换：检测新段落是否应自动填充下一个角色名前缀
        // 当上一行以"角色名: "开头时，新行自动填充角色列表中的下一个角色名
        // 实现两人对话的自动交替（A→B→A→B）或多角色循环（A→B→C→A→B→C）
        appendTransaction: (
          transactions: readonly Transaction[],
          _oldState: EditorState,
          newState: EditorState
        ): Transaction | null => {
          // 全局开关检查：关闭时不执行换行轮换
          if (!options.enabled) return null;
          if (!options.characters.length) return null;

          const docChanged = transactions.some((tr) => tr.docChanged);
          if (!docChanged) return null;

          // 仅处理文本输入（Enter 键会产生 insertText 事务）
          const hasTextInput = transactions.some(
            (tr) =>
              tr.getMeta("inputType") === "insertText" ||
              tr.getMeta("paste") === true
          );
          if (!hasTextInput) return null;

          const { selection } = newState;
          const $head = selection.$head;

          // 当前段落必须是空段落（刚按 Enter 产生的新行）
          const currentText = $head.parent.textContent;
          if (currentText.trim() !== "") return null;

          const paragraphPos = $head.before($head.depth);
          if (paragraphPos <= 0) return null;

          // 查找上一个段落
          const prevPos = newState.doc.resolve(paragraphPos - 1);
          const prevNode = prevPos.nodeAfter || newState.doc.nodeAt(prevPos.before(prevPos.depth));
          if (!prevNode || prevNode.type.name !== "paragraph") return null;

          const prevText = prevNode.textContent;
          const charName = extractCharacterPrefix(prevText, options.characters);
          if (!charName) return null;

          // 轮换到下一个角色名（非延续同一角色名）
          const nextName = getNextCharacterName(charName, options.characters);

          // 在新段落中自动插入下一个角色名前缀
          const tr = newState.tr;
          const insertPos = paragraphPos + 1;
          tr.insertText(`${nextName}: `, insertPos);
          return tr;
        },

        props: {
          handleKeyDown(view, event) {
            // Tab 键：在空行或行首弹出角色名选择浮层
            if (event.key === "Tab") {
              // 全局开关检查：开关关闭时不拦截，Tab 交还默认缩进行为
              // 此设计实现"功能全局开关化"——所有文体全量注册扩展，
              // 由 enabled 开关控制行为，消除文体守卫导致的功能孤岛
              if (!options.enabled) return false;

              // 空列表防御：角色列表为空时不拦截 Tab，避免 picker 弹空层
              // 且 preventDefault 导致 Tab 键被吞掉的卡死问题
              if (!options.characters.length) return false;

              const { state } = view;
              const { selection } = state;
              const $pos = selection.$head;

              const lineStart = $pos.start($pos.depth);
              const isLineStart = selection.from === lineStart;
              const textBefore = $pos.parent.textContent.slice(0, $pos.parentOffset);
              const isEmptyLine = textBefore.trim() === "";

              if (isLineStart || isEmptyLine) {
                const coords = view.coordsAtPos(selection.from);
                const rect = new DOMRect(
                  coords.left,
                  coords.top,
                  0,
                  coords.bottom - coords.top
                );
                showCharacterPicker(rect, options.characters, (name) => {
                  const tr = view.state.tr.insertText(`${name}: `, selection.from);
                  view.dispatch(tr);
                  options.onSelect(name);
                }, options.labels || {});
                event.preventDefault();
                return true;
              }
            }

            // Ctrl+Shift+N：选中文本后，在选中段落最前端弹出角色名选择器
            // 用于在已写好的对话前快速补充角色名前缀
            if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === "n" || event.key === "N")) {
              const { state } = view;
              const { selection } = state;
              // 仅在有选中文本时触发
              if (selection.empty) return false;
              if (!options.characters.length) return false;

              // 定位选中区域的起始位置
              const start = selection.$from;
              const paragraphPos = start.before(start.depth);
              if (paragraphPos < 0) return false;

              // 在选中段落起始位置弹出角色名选择器
              const coords = view.coordsAtPos(paragraphPos + 1);
              const rect = new DOMRect(
                coords.left,
                coords.top,
                0,
                coords.bottom - coords.top
              );
              showCharacterPicker(rect, options.characters, (name) => {
                // 在段落起始处插入角色名前缀
                const tr = view.state.tr.insertText(`${name}: `, paragraphPos + 1);
                view.dispatch(tr);
                options.onSelect(name);
              }, options.labels || {});
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

/**
 * 当前挂载的 React Root（用于在下次打开时先卸载旧浮层，避免重复浮层）
 */
let currentPickerRoot: ReturnType<typeof createRoot> | null = null;

/**
 * 显示角色名选择浮层
 * 输入:
 *   - rect: 浮层定位锚点（光标坐标）
 *   - characters: 角色名列表
 *   - callback: 选择角色名后的回调
 *   - labels: 浮层显示文案（由父组件通过 useI18n 翻译后传入）
 * 输出: 无（将浮层挂载到 document.body）
 * 流程:
 *   1. 卸载已存在的浮层（避免重复浮层）
 *   2. 创建容器 div 并挂载到 document.body
 *   3. 通过 createRoot 渲染 CharacterMentionPicker React 组件
 *   4. onSelect/onClose 回调中卸载 React Root 并移除容器
 *   5. 事件监听的清理由 React useEffect cleanup 自动完成，杜绝内存泄漏
 */
function showCharacterPicker(
  rect: DOMRect,
  characters: string[],
  callback: (name: string) => void,
  labels: CharacterMentionPickerLabels = {}
) {
  // 卸载已存在的浮层（避免重复浮层）
  if (currentPickerRoot) {
    currentPickerRoot.unmount();
    currentPickerRoot = null;
  }
  const existing = document.getElementById("character-picker");
  if (existing) existing.remove();

  // 创建容器并挂载到 body
  const container = document.createElement("div");
  container.id = "character-picker";
  document.body.appendChild(container);

  // 创建 React Root
  const root = createRoot(container);
  currentPickerRoot = root;

  /**
   * 清理函数：卸载 React Root 并移除容器
   * 在选择角色名或关闭浮层时调用
   */
  const cleanup = () => {
    root.unmount();
    if (currentPickerRoot === root) {
      currentPickerRoot = null;
    }
    if (container.parentNode) {
      container.remove();
    }
  };

  // 渲染角色名选择浮层 React 组件
  // 使用 createElement 而非 JSX，因为本文件为 .ts（非 .tsx）
  root.render(
    createElement(CharacterMentionPicker, {
      rect,
      characters,
      labels,
      onSelect: (name: string) => {
        callback(name);
        cleanup();
      },
      onClose: cleanup,
    })
  );
}

// ===== CharacterMentionNode: 行内 Inline Node（小说模式） =====
//
// 设计说明：
// 阶段 3 重构新增，用于在小说/散文正文中插入可点击的角色名 inline node。
// 与 CharacterMention Extension（段落级前缀补全）互不冲突，两者按文体独立注册：
//   - 剧本/对话体: 注册 CharacterMention Extension
//   - 小说/散文: 注册 CharacterMentionNode Node
//   - 混合文体: 两者同时注册（CharacterMentionNode 处理 @ 触发，CharacterMention 处理 Tab）
//
// characterId 关联设定库 CodexMeta.id（UUID v4），由阶段 1 list_codex_entities 提供。
// 当设定库实体被重命名时，可通过 characterId 反向查找并更新 inline node 的 name attrs。

/**
 * CharacterMentionNode 配置
 */
export interface CharacterMentionNodeOptions {
  /**
   * HTMLAttributes 合并到渲染节点
   */
  HTMLAttributes: Record<string, string>;
  /**
   * 是否允许编辑角色名（双击进入编辑模式）
   * 默认 false：双击跳转设定库而非编辑
   */
  editable: boolean;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    characterMentionNode: {
      /**
       * 插入角色提及 inline node
       * 输入:
       *   characterId - 设定库实体 UUID
       *   name - 显示名（与设定库 CodexMeta.name 同步）
       * 流程:
       *   1. 校验 characterId 非空
       *   2. 在当前选区插入 characterMentionNode
       *   3. 插入后光标移至节点后
       */
      insertCharacterMention: (characterId: string, name: string) => ReturnType;
      /**
       * 更新已有角色提及节点的显示名（设定库重命名时批量调用）
       * 输入:
       *   characterId - 目标实体 UUID
       *   newName - 新显示名
       * 流程: 遍历文档所有 characterMentionNode，匹配 characterId 并更新 name
       */
      updateCharacterMentionName: (characterId: string, newName: string) => ReturnType;
    };
  }
}

/**
 * CharacterMentionNode 行内 inline node
 *
 * 渲染为 span.nf-character-mention[data-character-id][data-character-name]
 * 点击时由 NovelEditor 的 ReactNodeView 或事件委托捕获，触发跳转设定库
 */
export const CharacterMentionNode = Node.create<CharacterMentionNodeOptions>({
  name: "characterMentionNode",

  group: "inline",

  inline: true,

  atom: true,

  selectable: true,

  draggable: false,

  addOptions() {
    return {
      HTMLAttributes: {},
      editable: false,
    };
  },

  addAttributes() {
    return {
      /**
       * 角色实体 UUID，关联设定库 CodexMeta.id
       * 设定库重命名/删除时，通过此 ID 反向定位文档中的提及节点
       */
      characterId: {
        default: "",
        parseHTML: (el): string => (el as HTMLElement).getAttribute("data-character-id") || "",
        renderHTML: (attrs): Record<string, string> => ({
          "data-character-id": String(attrs.characterId || ""),
        }),
      },
      /**
       * 显示名，与设定库 CodexMeta.name 同步
       * 设定库重命名时通过 updateCharacterMentionName 命令批量更新
       */
      name: {
        default: "",
        parseHTML: (el): string => (el as HTMLElement).getAttribute("data-character-name") || "",
        renderHTML: (attrs): Record<string, string> => ({
          "data-character-name": String(attrs.name || ""),
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-character-id]",
      },
      // 兼容旧版 .html 中的 <a class="character-mention"> 格式
      {
        tag: "a.character-mention",
        getAttrs: (node): Record<string, string> => {
          const el = node as HTMLElement;
          return {
            characterId: el.getAttribute("data-character-id") || "",
            name: el.textContent || "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // 合并外部 HTMLAttributes 与内部 class
    // class 包含 nf-character-mention 基类，由 Tailwind/FANDEX 主题提供视觉
    const merged = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      class: "nf-character-mention",
      // role="button" 提示可点击，tabindex 由主题控制
      role: "button",
      tabindex: "0",
    });
    // 渲染为带 name 文本的 span（atom 节点，内容来自 attrs.name 而非子节点）
    return ["span", merged, HTMLAttributes.name || ""];
  },

  renderText({ node }) {
    // 纯文本导出时仅保留 name，不带 characterId（避免污染 .txt 导出）
    return node.attrs.name || "";
  },

  addCommands() {
    return {
      insertCharacterMention:
        (characterId: string, name: string) =>
        ({ commands }) => {
          // 校验 characterId 非空（空 ID 的提及节点无设定库关联，无意义）
          if (!characterId) {
            return false;
          }
          return commands.insertContent({
            type: this.name,
            attrs: { characterId, name },
          });
        },
      updateCharacterMentionName:
        (characterId: string, newName: string) =>
        ({ tr, state }) => {
          // 遍历文档，查找所有匹配 characterId 的 characterMentionNode
          let modified = false;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== this.name) {
              return true;
            }
            if (node.attrs.characterId === characterId && node.attrs.name !== newName) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                name: newName,
              });
              modified = true;
            }
            return false;
          });
          return modified;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Backspace 在节点前删除整个节点（而非进入内部）
      Backspace: () => {
        const { state } = this.editor;
        const { selection } = state;
        // 选区正好选中一个 characterMentionNode 时删除
        if (
          selection.empty &&
          selection.$from.nodeBefore?.type.name === this.name
        ) {
          // TipTap v2 deleteRange 接受 Range 对象 {from, to}，非两个数字参数
          return this.editor.commands.deleteRange({
            from: selection.from - 1,
            to: selection.from,
          });
        }
        return false;
      },
    };
  },
});
