// 剧本角色名自动选择 TipTap 扩展
//
// 功能概述：
// 为舞台剧本类型项目提供台词前的角色名自动选择功能。
// 当用户在空行输入或按 Tab 键时，弹出角色名选择浮层，
// 用户可从预设角色名中选择，也可自定义输入。
//
// 模块职责：
// 1. 监听编辑器输入，检测台词行起始位置
// 2. 弹出角色名选择浮层
// 3. 选中后自动插入角色名前缀
// 4. 支持自定义角色名输入
// 5. 键盘导航（ArrowUp/ArrowDown/Enter/Escape）
// 6. ARIA 无障碍标注

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

// 角色名选择扩展的配置选项
export interface CharacterMentionOptions {
  characters: string[];
  onSelect: (name: string) => void;
}

export const CharacterMention = Extension.create<CharacterMentionOptions>({
  name: "characterMention",

  addOptions() {
    return {
      characters: [],
      onSelect: () => {},
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
                });
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
  callback: (name: string) => void
) {
  const existing = document.getElementById("character-picker");
  if (existing) existing.remove();

  const picker = document.createElement("div");
  picker.id = "character-picker";
  picker.setAttribute("role", "dialog");
  picker.setAttribute("aria-label", "角色名选择");
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
  listbox.setAttribute("aria-label", "可选角色名");
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
      if (document.activeElement === customInput) return;
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
  customInput.placeholder = "自定义角色名...";
  customInput.setAttribute("aria-label", "自定义角色名输入");
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
  hint.textContent = "Tab 选择 | ↑↓ 导航 | Esc 关闭";
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
