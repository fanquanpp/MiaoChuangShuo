// 字体大小快捷键 TipTap 扩展
//
// 功能概述：
// 在编辑器内注册 Ctrl+= / Ctrl+- / Ctrl+0 快捷键,实现正文字号的快速调节。
// 字号实际由 useSettingsStore 管理,本扩展仅负责拦截按键并调用 store action。
// 字号变更后通过 settingsStore.applyFontSize 写入 CSS 变量,编辑器实时生效。
//
// 模块职责：
// 1. 拦截 Ctrl+= / Ctrl++ 放大字号(+1px)
// 2. 拦截 Ctrl+- 缩小字号(-1px)
// 3. 拦截 Ctrl+0 重置默认字号(17px)
// 4. 阻止浏览器默认缩放行为,确保快捷键由编辑器接管
//
// 设计原则：
// - 通过 Zustand 的 getState() 在扩展内部读写全局 store,无需 React 上下文
// - 字号范围由 settingsStore.setFontSize 统一钳制(12-28px)
// - 返回 true 表示已处理,阻止 ProseMirror 与浏览器的默认行为

import { Extension } from "@tiptap/core";
import { useSettingsStore } from "./settingsStore";

// 默认编辑器字号(与 settingsStore DEFAULT_SETTINGS.fontSize 保持一致)
// 修改此处时需同步 settingsStore,避免重置值不一致
const DEFAULT_FONT_SIZE = 17;

// 快捷键扩展配置选项
export interface FontSizeShortcutOptions {
  /** 是否启用字号快捷键 */
  enabled: boolean;
}

/**
 * 字体大小快捷键扩展
 * 输入: enabled 是否启用
 * 输出: TipTap Extension 实例
 * 流程:
 *   1. 注册 Ctrl+= / Ctrl+Shift+= (即 Ctrl++) 放大字号
 *   2. 注册 Ctrl+- 缩小字号
 *   3. 注册 Ctrl+0 重置默认字号
 *   4. 通过 useSettingsStore.getState() 读写全局字号设置
 */
export const FontSizeShortcut = Extension.create<FontSizeShortcutOptions>({
  name: "fontSizeShortcut",

  addOptions() {
    return { enabled: true };
  },

  addKeyboardShortcuts() {
    // 放大字号:Ctrl+= 或 Ctrl++(Ctrl+Shift+=)
    const increase = (): boolean => {
      const store = useSettingsStore.getState();
      store.setFontSize(store.fontSize + 1);
      return true;
    };

    // 缩小字号:Ctrl+-
    const decrease = (): boolean => {
      const store = useSettingsStore.getState();
      store.setFontSize(store.fontSize - 1);
      return true;
    };

    // 重置默认字号:Ctrl+0
    const reset = (): boolean => {
      useSettingsStore.getState().setFontSize(DEFAULT_FONT_SIZE);
      return true;
    };

    return {
      // Ctrl+= (主快捷键,与 VSCode 放大一致)
      "Mod-equal": increase,
      // Ctrl++ (Ctrl+Shift+=,兼容浏览器放大习惯)
      "Mod-Shift-equal": increase,
      // Ctrl+- 缩小
      "Mod-minus": decrease,
      // Ctrl+0 重置
      "Mod-0": reset,
    };
  },
});
