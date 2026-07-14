// settingsStore.ts - 向后兼容 re-export 入口
// 编辑器设置→editorSettingsStore，外观设置→appearanceStore，保持现有 import 路径不变

export type { ChapterFormat } from "./editorSettingsStore";
export type { TextureMode, BackgroundPreset } from "./appearanceStore";
export { toChineseNumber, formatChapterHeading, extractChapterNum, getNextChapterNum } from "./editorSettingsStore";
export { BACKGROUND_PRESETS, DARK_DEFAULT_PRESET, LIGHT_DEFAULT_PRESET, getDefaultPresetByMode } from "./appearanceStore";

import { useEditorSettingsStore, type EditorSettingsState } from "./editorSettingsStore";
import { useAppearanceSettingsStore, type AppearanceSettingsState } from "./appearanceStore";

// 组合状态：编辑器设置 + 外观设置 + 统一初始化函数
type CombinedState = EditorSettingsState & AppearanceSettingsState & { initSettings: () => void };

// 统一初始化：同时初始化编辑器与外观设置，保证 DOM 副作用完整应用
function initSettings(): void {
  useEditorSettingsStore.getState().initEditorSettings();
  useAppearanceSettingsStore.getState().initAppearanceSettings();
}

// 向后兼容组合 hook：无参返回完整状态，selector 返回提取值，getState 用于非 React 上下文
export const useSettingsStore = Object.assign(
  (selector?: (s: CombinedState) => unknown) => {
    const editor = useEditorSettingsStore();
    const appearance = useAppearanceSettingsStore();
    const combined: CombinedState = { ...editor, ...appearance, initSettings };
    return selector ? selector(combined) : combined;
  },
  {
    getState: (): CombinedState => ({
      ...useEditorSettingsStore.getState(),
      ...useAppearanceSettingsStore.getState(),
      initSettings,
    }),
  }
) as {
  (): CombinedState;
  <T>(selector: (s: CombinedState) => T): T;
  getState: () => CombinedState;
};
