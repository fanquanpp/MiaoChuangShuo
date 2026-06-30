// 剧本角色名自动选择 TipTap 扩展
//
// 功能概述：
// 为舞台剧本/对话体类型项目提供台词前的角色名自动选择功能。
// 功能1: 在空行按 Tab 键弹出角色名选择浮层
// 功能2: 换行自动延续 —— 当上一行以"角色名: "开头时，新行自动填充相同角色名前缀
//
// 模块职责：
// 1. 监听编辑器输入，检测台词行起始位置
// 2. Tab 键弹出角色名选择浮层
// 3. 选中后自动插入角色名前缀
// 4. Enter 键自动延续角色名对话模式
// 5. 支持自定义角色名输入
// 6. 键盘导航（ArrowUp/ArrowDown/Enter/Escape）
// 7. ARIA 无障碍标注

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";

// 角色名选择扩展的配置选项
export interface CharacterMentionOptions {
  characters: string[];
  onSelect: (name: string) => void;
  labels?: {
    pickerAriaLabel?: string;
    listboxAriaLabel?: string;
    customInputAriaLabel?: string;
    customInputPlaceholder?: string;
    hintText?: string;
  };
}

/**
 * 从文本中提取开头的角色名（匹配 "角色名: " 或 "角色名： " 模式）
 * 返回匹配到的角色名，未匹配返回 null
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

export const CharacterMention = Extension.create<CharacterMentionOptions>({
  name: "characterMention",

  addOptions() {
    return {
      characters: [],
      onSelect: () => {},
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
          apply(tr, prev) {
            return prev;
          },
        },

        // 换行自动延续：检测新段落是否应自动填充角色名前缀
        appendTransaction: (
          transactions: readonly Transaction[],
          oldState: EditorState,
          newState: EditorState
        ): Transaction | null => {
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

          // 在新段落中自动插入角色名前缀
          const tr = newState.tr;
          const insertPos = paragraphPos + 1;
          tr.insertText(`${charName}: `, insertPos);
          return tr;
        },

        props: {
          handleKeyDown(view, event) {
            if (event.key === "Tab") {
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
            return false;
          },
        },
      }),
    ];
  },
});

/**
 * 获取当前浮层中的菜单项 DOM 列表与选中索引
 */
function getPickerItems(picker: HTMLElement): { items: HTMLElement[]; index: number } {
  const items = Array.from(picker.querySelectorAll<HTMLElement>('[role="option"]'));
  const activeItem = picker.querySelector<HTMLElement>('[aria-selected="true"]');
  const index = activeItem ? items.indexOf(activeItem) : -1;
  return { items, index: index >= 0 ? index : 0 };
}

/**
 * 更新选中项并触发 aria-selected
 */
function setSelectedItem(picker: HTMLElement, items: HTMLElement[], newIndex: number) {
  items.forEach((it, i) => {
    it.setAttribute("aria-selected", i === newIndex ? "true" : "false");
    if (i === newIndex) {
      it.style.background = "var(--fandex-bg-hover, #282828)";
      it.style.color = "var(--fandex-primary, #6ea8fe)";
    } else {
      it.style.background = "transparent";
      it.style.color = "var(--fandex-text, #ebebeb)";
    }
  });
  // 更新 aria-activedescendant
  const listbox = picker.querySelector<HTMLElement>('[role="listbox"]');
  if (listbox) {
    listbox.setAttribute("aria-activedescendant", items[newIndex]?.id || "");
  }
}

function showCharacterPicker(
  rect: DOMRect,
  characters: string[],
  callback: (name: string) => void,
  labels: {
    pickerAriaLabel?: string;
    listboxAriaLabel?: string;
    customInputAriaLabel?: string;
    customInputPlaceholder?: string;
    hintText?: string;
  } = {}
) {
  const existing = document.getElementById("character-picker");
  if (existing) existing.remove();

  const pickerAria = labels.pickerAriaLabel || "角色名选择";
  const listboxAria = labels.listboxAriaLabel || "可选角色名";
  const inputAria = labels.customInputAriaLabel || "自定义角色名输入";
  const inputPlaceholder = labels.customInputPlaceholder || "自定义角色名…";
  const hintLabel = labels.hintText || "Tab 选择 | ↑↓ 导航 | Esc 关闭";

  const picker = document.createElement("div");
  picker.id = "character-picker";
  picker.setAttribute("role", "dialog");
  picker.setAttribute("aria-label", pickerAria);
  picker.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    top: ${rect.bottom + 4}px;
    z-index: 9999;
    background: var(--fandex-bg-card, #181818);
    border: 1px solid var(--fandex-border-light, #383838);
    border-radius: 8px;
    box-shadow: 0 10px 15px rgba(0, 0, 0, 0.4);
    padding: 4px;
    min-width: 160px;
    max-height: 240px;
    overflow-y: auto;
    font-family: 'Noto Sans SC', sans-serif;
  `;

  // 角色列表容器
  const listbox = document.createElement("div");
  listbox.setAttribute("role", "listbox");
  listbox.setAttribute("aria-label", listboxAria);
  picker.appendChild(listbox);

  characters.forEach((name, i) => {
    const item = document.createElement("div");
    item.textContent = name;
    item.setAttribute("role", "option");
    item.id = `character-picker-item-${i}`;
    item.setAttribute("aria-selected", "false");
    item.style.cssText = `
      padding: 6px 12px;
      font-size: 13px;
      color: var(--fandex-text, #ebebeb);
      cursor: pointer;
      border-radius: 4px;
      transition: background 0.12s;
    `;
    item.onmouseenter = () => {
      const { items } = getPickerItems(picker);
      setSelectedItem(picker, items, i);
    };
    item.onmouseleave = () => {
      // Check if focus is on the custom input (by checking active element tag)
      const activeEl = document.activeElement;
      if (activeEl && activeEl.tagName === 'INPUT' && picker.contains(activeEl)) return;
      item.style.background = "transparent";
      item.style.color = "var(--fandex-text, #ebebeb)";
      item.setAttribute("aria-selected", "false");
    };
    item.onclick = () => {
      callback(name);
      picker.remove();
    };
    listbox.appendChild(item);
  });

  // 分隔线
  const divider = document.createElement("div");
  divider.style.cssText = `height: 1px; background: var(--fandex-border-light, #383838); margin: 4px 0;`;
  picker.appendChild(divider);

  // 自定义输入框
  const customInput = document.createElement("input");
  customInput.type = "text";
  customInput.placeholder = inputPlaceholder;
  customInput.setAttribute("aria-label", inputAria);
  customInput.style.cssText = `
    width: 100%;
    box-sizing: border-box;
    padding: 6px 12px;
    font-size: 13px;
    background: var(--fandex-bg, #0d0d0d);
    border: 1px solid var(--fandex-border-light, #383838);
    border-radius: 4px;
    color: var(--fandex-text, #ebebeb);
    outline: none;
  `;

  const submitCustom = () => {
    const customName = customInput.value.trim();
    if (customName) {
      callback(customName);
      picker.remove();
    }
  };

  // 键盘导航：ArrowUp/ArrowDown 在菜单项间移动
  const navigateItems = (direction: 1 | -1) => {
    const { items, index } = getPickerItems(picker);
    if (items.length === 0) return;
    const nextIdx = ((index + direction) % items.length + items.length) % items.length;
    setSelectedItem(picker, items, nextIdx);
    items[nextIdx]?.scrollIntoView({ block: "nearest" });
  };

  customInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitCustom();
    } else if (e.key === "Escape") {
      picker.remove();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      navigateItems(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      navigateItems(1);
    }
  };
  picker.appendChild(customInput);

  // 菜单项也可通过 picker 层键盘事件导航
  picker.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      navigateItems(-1);
      customInput.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      navigateItems(1);
      customInput.focus();
    } else if (e.key === "Enter") {
      const { items, index } = getPickerItems(picker);
      if (items[index]) {
        e.preventDefault();
        const name = items[index].textContent || "";
        callback(name);
        picker.remove();
      }
    }
  });

  // 底部提示
  const hint = document.createElement("div");
  hint.textContent = hintLabel;
  hint.setAttribute("aria-hidden", "true");
  hint.style.cssText = `padding: 4px 12px; font-size: 11px; color: var(--fandex-text-tertiary, #8a8a8a);`;
  picker.appendChild(hint);

  document.body.appendChild(picker);

  // 默认选中第一项
  requestAnimationFrame(() => {
    const { items } = getPickerItems(picker);
    if (items.length > 0) setSelectedItem(picker, items, 0);
    customInput.focus();
  });

  // 点击外部关闭
  setTimeout(() => {
    const handler = (e: MouseEvent) => {
      if (!picker.contains(e.target as Node)) {
        picker.remove();
        document.removeEventListener("mousedown", handler);
      }
    };
    document.addEventListener("mousedown", handler);
  }, 100);
}
