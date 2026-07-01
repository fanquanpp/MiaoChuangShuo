// 设置对话框组件
//
// 功能概述：
// 提供应用级设置的统一配置入口，包括编辑器字号、自动保存间隔、
// 章节标题格式、主题切换等。采用 FANDEX 暗色主题模态框风格。
//
// 模块职责：
// 1. 渲染设置面板（分区展示各设置项）
// 2. 实时预览设置变更
// 3. 持久化到 localStorage

import { useCallback } from "react";
import { X, Type, BookOpen, FileText, Palette, Zap } from "lucide-react";
import { useSettingsStore, type ChapterFormat } from "../lib/settingsStore";
import { useThemeStore } from "../lib/themeStore";
import { useI18n } from "../lib/i18n";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 设置对话框组件
 * 输入:
 *   - open: 对话框显示状态
 *   - onClose: 关闭回调
 * 输出: JSX 模态框（open=false 时返回 null）
 * 流程:
 *   1. 从 settingsStore 读取所有配置项
 *   2. 渲染五大设置分区：编辑器、章节、自动化、首行缩进、主题
 *   3. 每个设置项变更立即写回 store 并持久化到 localStorage
 *   4. 点击遮罩或关闭按钮触发 onClose
 */
export default function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t } = useI18n();
  const {
    fontSize,
    autoSaveInterval,
    chapterFormat,
    autoFillBookTitle,
    autoOutlineSkeleton,
    diaryAutoDate,
    weatherAutoFill,
    autoNumbering,
    autoTemplateFill,
    indentEnabled,
    indentWidth,
    setFontSize,
    setAutoSaveInterval,
    setChapterFormat,
    setAutoFillBookTitle,
    setAutoOutlineSkeleton,
    setDiaryAutoDate,
    setWeatherAutoFill,
    setAutoNumbering,
    setAutoTemplateFill,
    setIndentEnabled,
    setIndentWidth,
  } = useSettingsStore();
  const { theme, toggleTheme } = useThemeStore();

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      <div className="w-full max-w-lg bg-nf-bg-card border border-nf-border-light shadow-2xl max-h-[85vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light flex-shrink-0">
          <h2 className="fandex-bar-left text-base font-bold font-display text-nf-text">
            {t("settings.title")}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
            title={t("app.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* 编辑器设置 */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Type className="w-4 h-4 text-fandex-primary" />
              <h3 className="text-sm font-bold font-display text-nf-text">
                {t("settings.editorSection")}
              </h3>
            </div>

            {/* 字号 */}
            <div className="space-y-2 mb-4">
              <div className="flex items-center justify-between">
                <label className="text-xs text-nf-text-secondary">{t("settings.fontSize")}</label>
                <span className="text-xs text-nf-text-tertiary font-mono">{fontSize}px</span>
              </div>
              <input
                type="range"
                min={12}
                max={28}
                step={1}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-full h-1.5 bg-nf-bg-hover accent-fandex-primary cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-nf-text-tertiary">
                <span>12px</span>
                <span>28px</span>
              </div>
              {/* 预览 */}
              <div
                className="p-3 bg-nf-bg border border-nf-border-light text-nf-text-secondary leading-relaxed"
                style={{ fontSize: `${fontSize}px` }}
              >
                {t("settings.fontPreview")}
              </div>
            </div>

            {/* 自动保存间隔 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-nf-text-secondary">{t("settings.autoSave")}</label>
                <span className="text-xs text-nf-text-tertiary font-mono">
                  {autoSaveInterval === 0
                    ? t("settings.autoSaveOff")
                    : `${autoSaveInterval}${t("settings.secondsUnit")}`}
                </span>
              </div>
              <div className="flex gap-2">
                {[0, 15, 30, 60, 120].map((val) => (
                  <button
                    key={val}
                    onClick={() => setAutoSaveInterval(val)}
                    className={`flex-1 py-1.5 text-xs border transition-all duration-fast ${
                      autoSaveInterval === val
                        ? "bg-fandex-primary/10 border-fandex-primary/40 text-fandex-primary"
                        : "border-nf-border-light text-nf-text-tertiary hover:border-nf-border hover:text-nf-text-secondary"
                    }`}
                  >
                    {val === 0 ? t("settings.off") : `${val}s`}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* 章节标题设置 */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-4 h-4 text-fandex-secondary" />
              <h3 className="text-sm font-bold font-display text-nf-text">
                {t("settings.chapterSection")}
              </h3>
            </div>

            {/* 章节格式 */}
            <div className="space-y-2 mb-4">
              <label className="text-xs text-nf-text-secondary">{t("settings.chapterFormat")}</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: "chinese" as ChapterFormat, label: t("settings.formatChinese"), preview: t("settings.previewChapterChinese") },
                  { value: "arabic" as ChapterFormat, label: t("settings.formatArabic"), preview: t("settings.previewChapterArabic") },
                  { value: "english" as ChapterFormat, label: t("settings.formatEnglish"), preview: t("settings.previewChapterEnglish") },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setChapterFormat(opt.value)}
                    className={`p-2.5 text-left border transition-all duration-fast ${
                      chapterFormat === opt.value
                        ? "bg-fandex-secondary/10 border-fandex-secondary/40"
                        : "border-nf-border-light hover:border-nf-border"
                    }`}
                  >
                    <div className={`text-xs font-medium mb-1 ${
                      chapterFormat === opt.value ? "text-fandex-secondary" : "text-nf-text-secondary"
                    }`}>
                      {opt.label}
                    </div>
                    <div className="text-[10px] text-nf-text-tertiary font-mono">{opt.preview}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 自动填充书名 */}
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={autoFillBookTitle}
                onChange={(e) => setAutoFillBookTitle(e.target.checked)}
                className="w-4 h-4 accent-fandex-primary cursor-pointer"
              />
              <div>
                <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                  {t("settings.autoFillTitle")}
                </span>
                <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                  {t("settings.autoFillTitleHint")}
                </p>
              </div>
            </label>

            {/* 大纲自动生成骨架 */}
            <label className="flex items-center gap-3 cursor-pointer group mt-3">
              <input
                type="checkbox"
                checked={autoOutlineSkeleton}
                onChange={(e) => setAutoOutlineSkeleton(e.target.checked)}
                className="w-4 h-4 accent-fandex-primary cursor-pointer"
              />
              <div>
                <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                  {t("settings.autoOutline")}
                </span>
                <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                  {t("settings.autoOutlineHint")}
                </p>
              </div>
            </label>
          </section>

          {/* 自动化设置 */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-yellow-500" />
              <h3 className="text-sm font-bold font-display text-nf-text">
                {t("settings.automationSection")}
              </h3>
            </div>

            <div className="space-y-3">
              {/* 日记自动添加日期 */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={diaryAutoDate}
                  onChange={(e) => setDiaryAutoDate(e.target.checked)}
                  className="w-4 h-4 accent-fandex-primary cursor-pointer"
                />
                <div>
                  <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                    {t("settings.diaryAutoDate")}
                  </span>
                  <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                    {t("settings.diaryAutoDateDesc")}
                  </p>
                </div>
              </label>

              {/* 天气自动填充 */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={weatherAutoFill}
                  onChange={(e) => setWeatherAutoFill(e.target.checked)}
                  className="w-4 h-4 accent-fandex-primary cursor-pointer"
                />
                <div>
                  <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                    {t("settings.weatherAutoFill")}
                  </span>
                  <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                    {t("settings.weatherAutoFillDesc")}
                  </p>
                </div>
              </label>

              {/* 章节自动编号 */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={autoNumbering}
                  onChange={(e) => setAutoNumbering(e.target.checked)}
                  className="w-4 h-4 accent-fandex-primary cursor-pointer"
                />
                <div>
                  <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                    {t("settings.chapterAutoNumber")}
                  </span>
                  <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                    {t("settings.chapterAutoNumberDesc")}
                  </p>
                </div>
              </label>

              {/* 模板自动填充 */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={autoTemplateFill}
                  onChange={(e) => setAutoTemplateFill(e.target.checked)}
                  className="w-4 h-4 accent-fandex-primary cursor-pointer"
                />
                <div>
                  <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                    {t("settings.templateAutoFill")}
                  </span>
                  <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                    {t("settings.templateAutoFillDesc")}
                  </p>
                </div>
              </label>
            </div>
          </section>

          {/* 首行缩进设置 */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-green-500" />
              <h3 className="text-sm font-bold font-display text-nf-text">
                {t("settings.indentSection")}
              </h3>
            </div>

            <div className="space-y-3">
              {/* 启用缩进 */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={indentEnabled}
                  onChange={(e) => setIndentEnabled(e.target.checked)}
                  className="w-4 h-4 accent-fandex-primary cursor-pointer"
                />
                <div>
                  <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                    {t("settings.indentEnabled")}
                  </span>
                  <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                    {t("settings.indentEnabledHint")}
                  </p>
                </div>
              </label>

              {/* 缩进宽度 */}
              <div className="space-y-2">
                <label className="text-xs text-nf-text-secondary">{t("settings.indentWidth")}</label>
                <div className="flex gap-2">
                  {([1, 2, 3, 4] as const).map((val) => (
                    <button
                      key={val}
                      onClick={() => setIndentWidth(val)}
                      className={`flex-1 py-1.5 text-xs border transition-all duration-fast ${
                        indentWidth === val
                          ? "bg-green-500/10 border-green-500/40 text-green-500"
                          : "border-nf-border-light text-nf-text-tertiary hover:border-nf-border hover:text-nf-text-secondary"
                      }`}
                    >
                      {t(`settings.indentWidth${val}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* 外观设置 */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Palette className="w-4 h-4 text-fandex-tertiary" />
              <h3 className="text-sm font-bold font-display text-nf-text">
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
                className="px-3 py-1.5 text-xs border border-nf-border-light hover:border-fandex-tertiary/60 text-nf-text-secondary hover:text-fandex-tertiary transition-all duration-fast"
              >
                {theme === "dark" ? t("settings.switchLight") : t("settings.switchDark")}
              </button>
            </div>
          </section>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end px-6 py-3 border-t border-nf-border-light flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast"
          >
            {t("app.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
