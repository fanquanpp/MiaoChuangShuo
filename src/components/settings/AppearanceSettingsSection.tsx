// 外观设置分区组件
//
// 功能概述：
// 设置对话框「外观」分区，提供主题切换、背景预设色板、面板质感模式、
// 自定义背景色选择器、毛玻璃透明度调节等外观相关设置。
//
// 模块职责：
// 1. 渲染亮/暗主题切换按钮
// 2. 渲染背景预设色板（按当前主题筛选显示）
// 3. 渲染面板质感模式选择器（纯色/磨砂/纸质/模糊）
// 4. 渲染自定义背景色选择器（仅 custom 预设时显示）
// 5. 渲染毛玻璃透明度滑块与效果预览
//
// 设计说明：
// - 全局状态通过 settingsStore 与 themeStore 直接读取
// - 背景预设按主题模式筛选，主题切换时自动联动
// - 毛玻璃透明度变更实时应用到 DOM（通过 store 副作用）

import { Palette, Droplet, Layers } from "lucide-react";
import {
  useSettingsStore,
  BACKGROUND_PRESETS,
  type TextureMode,
} from "../../lib/settingsStore";
import { useThemeStore } from "../../lib/themeStore";
import { useI18n } from "../../lib/i18n";

/**
 * 外观设置分区组件
 *
 * 输入: 无（通过 Zustand store 获取全局状态）
 * 输出: JSX 外观设置分区内容
 * 流程:
 *   1. 从 themeStore 读取当前主题模式
 *   2. 从 settingsStore 读取背景预设、质感模式、透明度等设置
 *   3. 渲染各项设置控件，变更立即写回 store
 *   4. 背景预设色板按当前主题筛选显示
 */
export default function AppearanceSettingsSection() {
  const { t } = useI18n();
  const {
    backgroundPreset,
    customBackgroundColor,
    glassOpacity,
    textureMode,
    setBackgroundPreset,
    setCustomBackgroundColor,
    setGlassOpacity,
    setTextureMode,
  } = useSettingsStore();
  const { theme, toggleTheme } = useThemeStore();

  return (
    <section className="bg-zinc-900/40 rounded-lg p-4 border border-white/5">
      <div className="flex items-center gap-2 mb-3">
        <Palette className="w-4 h-4 text-fandex-tertiary" />
        <h3 className="text-sm font-medium text-nf-text">
          {t("settings.appearanceSection")}
        </h3>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs text-nf-text-secondary">{t("settings.theme")}</span>
          <p className="text-[10px] text-nf-text-tertiary mt-0.5">
            {theme === "dark" ? t("settings.themeDark") : t("settings.themeLight")}
          </p>
        </div>
        <button
          onClick={toggleTheme}
          className="h-7 px-2 text-xs flex items-center justify-center gap-1.5 border border-nf-border-light hover:border-fandex-tertiary/60 text-nf-text-secondary hover:text-fandex-tertiary transition-all duration-fast"
        >
          {theme === "dark" ? t("settings.switchLight") : t("settings.switchDark")}
        </button>
      </div>

      {/* 背景预设色板（按当前主题筛选） */}
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-nf-text-secondary">{t("settings.backgroundPreset")}</label>
          <span className="text-[10px] text-nf-text-tertiary">
            {theme === "dark" ? t("settings.themePresetGroupDark") : t("settings.themePresetGroupLight")}
          </span>
        </div>
        <div className="grid grid-cols-6 gap-2">
          {BACKGROUND_PRESETS.filter((p) => p.mode === theme).map((preset) => {
            const isActive = backgroundPreset === preset.id;
            const labelKey = `settings.preset${preset.id.charAt(0).toUpperCase()}${preset.id.slice(1)}`;
            // 亮色预设使用深色文字，暗色预设使用浅色文字
            const isLightPreset = preset.mode === "light";
            return (
              <button
                key={preset.id}
                onClick={() => setBackgroundPreset(preset.id)}
                title={t(labelKey)}
                className={`relative h-10 border transition-all duration-fast flex items-end justify-center pb-1 ${
                  isActive
                    ? "border-fandex-primary ring-1 ring-fandex-primary/40"
                    : "border-nf-border-light hover:border-nf-border"
                }`}
                style={{ background: preset.bg }}
              >
                <span
                  className="text-[9px] font-medium leading-none"
                  style={{ color: isLightPreset ? "rgba(30, 30, 46, 0.85)" : "rgba(232, 232, 240, 0.85)" }}
                >
                  {t(labelKey)}
                </span>
                {isActive && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-fandex-primary" />
                )}
              </button>
            );
          })}
          {/* 自定义预设按钮 */}
          <button
            onClick={() => setBackgroundPreset("custom")}
            title={t("settings.presetCustom")}
            className={`relative h-10 border transition-all duration-fast flex items-end justify-center pb-1 ${
              backgroundPreset === "custom"
                ? "border-fandex-primary ring-1 ring-fandex-primary/40"
                : "border-nf-border-light hover:border-nf-border"
            }`}
            style={{
              background:
                backgroundPreset === "custom"
                  ? customBackgroundColor
                  : "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
            }}
          >
            <span
              className="text-[9px] font-medium leading-none"
              style={{ color: "rgba(232, 232, 240, 0.85)" }}
            >
              {t("settings.presetCustom")}
            </span>
            {backgroundPreset === "custom" && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-fandex-primary" />
            )}
          </button>
        </div>
      </div>

      {/* 面板质感模式选择器 */}
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-nf-text-secondary">{t("settings.textureMode")}</label>
          <span className="text-[10px] text-nf-text-tertiary">{t("settings.textureModeHint")}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: "solid" as TextureMode, label: t("settings.textureSolid"), desc: t("settings.textureSolidDesc") },
            { value: "frosted" as TextureMode, label: t("settings.textureFrosted"), desc: t("settings.textureFrostedDesc") },
            { value: "paper" as TextureMode, label: t("settings.texturePaper"), desc: t("settings.texturePaperDesc") },
            { value: "blur" as TextureMode, label: t("settings.textureBlur"), desc: t("settings.textureBlurDesc") },
          ]).map((opt) => {
            const isActive = textureMode === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setTextureMode(opt.value)}
                className={`p-2.5 text-left border transition-all duration-fast ${
                  isActive
                    ? "bg-fandex-primary/10 border-fandex-primary/40"
                    : "border-nf-border-light hover:border-nf-border"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Layers className={`w-3 h-3 ${isActive ? "text-fandex-primary" : "text-nf-text-tertiary"}`} />
                  <span className={`text-xs font-medium ${isActive ? "text-fandex-primary" : "text-nf-text-secondary"}`}>
                    {opt.label}
                  </span>
                </div>
                <p className="text-[10px] text-nf-text-tertiary leading-relaxed">{opt.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 自定义颜色选择器（仅 custom 预设时显示） */}
      {backgroundPreset === "custom" && (
        <div className="mt-3 p-3 border border-nf-border-light bg-nf-bg/40 space-y-2">
          <div className="flex items-center gap-2">
            <Droplet className="w-3.5 h-3.5 text-fandex-secondary flex-shrink-0" />
            <label className="text-xs text-nf-text-secondary">{t("settings.customColor")}</label>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={customBackgroundColor}
              onChange={(e) => setCustomBackgroundColor(e.target.value)}
              className="w-12 h-8 bg-transparent border border-nf-border-light cursor-pointer p-0"
            />
            <input
              type="text"
              value={customBackgroundColor}
              onChange={(e) => setCustomBackgroundColor(e.target.value)}
              className="flex-1 px-2 py-1 text-xs font-mono bg-nf-bg border border-nf-border-light text-nf-text focus:outline-none focus:border-fandex-primary transition-colors"
              placeholder="#0c0d14"
            />
          </div>
          <p className="text-[10px] text-nf-text-tertiary leading-relaxed">
            {t("settings.customColorHint")}
          </p>
        </div>
      )}

      {/* 毛玻璃透明度滑块 */}
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-nf-text-secondary">{t("settings.glassOpacity")}</label>
          <span className="text-xs text-nf-text-tertiary font-mono">
            {(glassOpacity * 100).toFixed(0)}%
          </span>
        </div>
        <input
          type="range"
          min={0.3}
          max={1}
          step={0.05}
          value={glassOpacity}
          onChange={(e) => setGlassOpacity(Number(e.target.value))}
          className="w-full h-1.5 bg-nf-bg-hover accent-fandex-tertiary cursor-pointer"
        />
        <div className="flex justify-between text-[10px] text-nf-text-tertiary">
          <span>{t("settings.glassOpacityTransparent")}</span>
          <span>{t("settings.glassOpacityFull")}</span>
        </div>
        {/* 毛玻璃效果预览 */}
        <div className="relative h-12 overflow-hidden border border-nf-border-light">
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, rgba(124,158,255,0.3) 0%, rgba(78,230,176,0.25) 50%, rgba(255,158,122,0.2) 100%)",
            }}
          />
          <div
            className="absolute inset-0 flex items-center justify-center backdrop-blur-[8px]"
            style={{
              background: `rgba(var(--nf-bg-rgb, 12, 13, 20), ${glassOpacity})`,
            }}
          >
            <span className="text-[10px] text-nf-text-secondary">
              {t("settings.glassOpacityHint")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
