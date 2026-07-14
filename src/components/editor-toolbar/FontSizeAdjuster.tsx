// 字号调整组件
//
// 功能概述：
// 提供 A- / 当前字号 / A+ / 重置 四个按钮，实时调整编辑器字体显示大小。
// 通过 useSettingsStore 调整 --fandex-editor-font-size CSS 变量，字号范围由 settingsStore.setFontSize 钳制（12-28px）。
//
// 模块职责：
// 仅负责字号增减与重置交互，不持有字号状态（读写均通过 settingsStore）。

import { ZoomIn, ZoomOut } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../lib/settingsStore";

// 默认字号（与 settingsStore DEFAULT_SETTINGS.fontSize 一致）
const DEFAULT_SIZE = 17;

/**
 * 字号调整按钮组
 *
 * 输入参数: 无（直接读写 settingsStore）
 * 返回值: JSX 按钮组（缩小 / 当前字号 / 放大 / 重置）
 * 核心流程:
 *   1. 从 settingsStore 读取当前 fontSize
 *   2. 点击 A- 调用 setFontSize(size - 1)，下限 12 时禁用
 *   3. 点击 A+ 调用 setFontSize(size + 1)，上限 28 时禁用
 *   4. 点击当前字号数字重置为默认 17px
 */
export function FontSizeAdjuster() {
  const { t } = useI18n();
  const fontSize = useSettingsStore((s) => s.fontSize);
  const setFontSize = useSettingsStore((s) => s.setFontSize);

  return (
    <div className="flex items-center h-8 border border-nf-border-light/30 bg-nf-bg-card/40">
      {/* 缩小字号 */}
      <button
        type="button"
        onClick={() => setFontSize(fontSize - 1)}
        onMouseDown={(e) => e.preventDefault()}
        disabled={fontSize <= 12}
        title={t("shortcuts.fontSizeDecrease")}
        tabIndex={-1}
        className="nf-tool-btn h-8 w-8 flex items-center justify-center text-nf-text-tertiary hover:text-nf-text transition-colors duration-fast disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ZoomOut className="w-4 h-4" />
      </button>
      {/* 当前字号（点击重置为默认） */}
      <button
        type="button"
        onClick={() => setFontSize(DEFAULT_SIZE)}
        onMouseDown={(e) => e.preventDefault()}
        title={t("shortcuts.fontSizeReset")}
        tabIndex={-1}
        className="nf-tool-btn h-8 px-1.5 text-[11px] tabular-nums text-nf-text-secondary hover:text-fandex-primary transition-colors duration-fast min-w-[32px] text-center flex items-center justify-center border-x border-nf-border-light/30"
      >
        {fontSize}
      </button>
      {/* 放大字号 */}
      <button
        type="button"
        onClick={() => setFontSize(fontSize + 1)}
        onMouseDown={(e) => e.preventDefault()}
        disabled={fontSize >= 28}
        title={t("shortcuts.fontSizeIncrease")}
        tabIndex={-1}
        className="nf-tool-btn h-8 w-8 flex items-center justify-center text-nf-text-tertiary hover:text-nf-text transition-colors duration-fast disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ZoomIn className="w-4 h-4" />
      </button>
    </div>
  );
}

export default FontSizeAdjuster;
