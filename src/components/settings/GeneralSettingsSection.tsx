// 常规设置分区组件
//
// 功能概述：
// 设置对话框「常规」分区，承载编辑器、章节标题、自动化、首行缩进、
// 编辑器功能开关、全文索引管理六大子分区的所有设置项。
//
// 模块职责：
// 1. 渲染编辑器字号与自动保存间隔设置
// 2. 渲染章节标题格式与自动填充选项
// 3. 渲染章节自动编号与模板自动填充开关
// 4. 渲染首行缩进开关与缩进宽度选择
// 5. 渲染编辑器功能开关集合（缩进、角色补全、诗歌排版等）
// 6. 嵌入全文索引管理面板
//
// 设计说明：
// - 全局状态通过 Zustand store 直接读取（settingsStore / preferencesStore）
// - UI 局部状态（缩进宽度输入缓存）使用 useState 管理
// - 所有设置变更即时写回 store 并持久化

import { useState, useEffect, useCallback } from "react";
import { Type, BookOpen, FileText, Zap } from "lucide-react";
import { useSettingsStore, type ChapterFormat } from "../../lib/settingsStore";
import { usePreferencesStore } from "../../lib/preferencesSlice";
import { useI18n } from "../../lib/i18n";
import IndexManagerPanel from "../IndexManagerPanel";

/**
 * 常规设置分区组件
 *
 * 输入: 无（通过 Zustand store 获取全局状态）
 * 输出: JSX 常规设置分区内容
 * 流程:
 *   1. 从 settingsStore 读取编辑器、章节、自动化、缩进相关设置
 *   2. 从 preferencesStore 读取编辑器功能开关
 *   3. 渲染六大子分区，每个设置项变更立即写回 store
 *   4. 缩进宽度自定义输入使用本地缓存，失焦或回车时提交
 */
export default function GeneralSettingsSection() {
  const { t } = useI18n();
  const {
    fontSize,
    autoSaveInterval,
    chapterFormat,
    autoFillBookTitle,
    autoOutlineSkeleton,
    autoNumbering,
    autoTemplateFill,
    indentEnabled,
    indentWidth,
    setFontSize,
    setAutoSaveInterval,
    setChapterFormat,
    setAutoFillBookTitle,
    setAutoOutlineSkeleton,
    setAutoNumbering,
    setAutoTemplateFill,
    setIndentEnabled,
    setIndentWidth,
  } = useSettingsStore();

  // 编辑器功能开关（用户级偏好，跨项目共享）
  const preferences = usePreferencesStore((s) => s.preferences);
  const updatePreference = usePreferencesStore((s) => s.updatePreference);

  // 缩进宽度自定义输入：本地缓存输入文本，失焦或回车时提交到 store
  // 避免受控 input 在输入过程中被钳制导致体验问题（如输入"12"时中途被截为1）
  const [indentInput, setIndentInput] = useState(String(indentWidth));
  useEffect(() => {
    setIndentInput(String(indentWidth));
  }, [indentWidth]);

  /**
   * 提交缩进宽度输入
   * 流程:
   *   1. 解析输入文本为整数
   *   2. 校验范围 1-8，有效则写入 store
   *   3. 无效输入回退为当前 store 值
   */
  const commitIndentInput = useCallback(() => {
    const v = parseInt(indentInput, 10);
    if (!isNaN(v) && v >= 1 && v <= 8) {
      setIndentWidth(v);
    } else {
      setIndentInput(String(indentWidth));
    }
  }, [indentInput, indentWidth, setIndentWidth]);

  return (
    <div className="space-y-4">
      {/* ===== 编辑器设置 ===== */}
      <section className="bg-zinc-900/40 rounded-lg p-4 border border-white/5">
        <div className="flex items-center gap-2 mb-3">
          <Type className="w-4 h-4 text-fandex-primary" />
          <h3 className="text-sm font-medium text-nf-text">
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

      {/* ===== 章节标题设置 ===== */}
      <section className="bg-zinc-900/40 rounded-lg p-4 border border-white/5">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="w-4 h-4 text-fandex-secondary" />
          <h3 className="text-sm font-medium text-nf-text">
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

      {/* ===== 自动化设置 ===== */}
      <section className="bg-zinc-900/40 rounded-lg p-4 border border-white/5">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-yellow-500" />
          <h3 className="text-sm font-medium text-nf-text">
            {t("settings.automationSection")}
          </h3>
        </div>

        <div className="space-y-3">
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

      {/* ===== 首行缩进设置 ===== */}
      <section className="bg-zinc-900/40 rounded-lg p-4 border border-white/5">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-4 h-4 text-green-500" />
          <h3 className="text-sm font-medium text-nf-text">
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
            {/* 自定义缩进宽度：允许 1-8 任意值，补充快捷按钮无法覆盖的更宽缩进 */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-nf-text-tertiary">{t("settings.indentCustom")}</span>
              <input
                type="number"
                min={1}
                max={8}
                value={indentInput}
                onChange={(e) => setIndentInput(e.target.value)}
                onBlur={commitIndentInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitIndentInput();
                }}
                className="w-16 px-2 py-1 text-xs bg-nf-bg-input border border-nf-border-light text-nf-text focus:outline-none focus:border-fandex-primary transition-colors"
              />
              <span className="text-[10px] text-nf-text-tertiary">1-8</span>
            </div>
          </div>
        </div>
      </section>

      {/* ===== 编辑器功能开关设置 ===== */}
      <section className="bg-zinc-900/40 rounded-lg p-4 border border-white/5">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-fandex-tertiary" />
          <h3 className="text-sm font-medium text-nf-text">
            {t("settings.featuresSection")}
          </h3>
        </div>

        <div className="space-y-3">
          {/* 首行缩进开关 */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={preferences.enableAutoIndent}
              onChange={(e) => updatePreference("enableAutoIndent", e.target.checked)}
              className="w-4 h-4 accent-fandex-primary cursor-pointer"
            />
            <div>
              <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                {t("settings.featureAutoIndent")}
              </span>
              <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                {t("settings.featureAutoIndentHint")}
              </p>
            </div>
          </label>

          {/* 角色名补全开关 */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={preferences.enableCharacterMentionPicker}
              onChange={(e) => updatePreference("enableCharacterMentionPicker", e.target.checked)}
              className="w-4 h-4 accent-fandex-primary cursor-pointer"
            />
            <div>
              <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                {t("settings.featureCharMention")}
              </span>
              <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                {t("settings.featureCharMentionHint")}
              </p>
            </div>
          </label>

          {/* 诗歌排版开关 */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={preferences.enablePoetryFormat}
              onChange={(e) => updatePreference("enablePoetryFormat", e.target.checked)}
              className="w-4 h-4 accent-fandex-primary cursor-pointer"
            />
            <div>
              <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                {t("settings.featurePoetryFormat")}
              </span>
              <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                {t("settings.featurePoetryFormatHint")}
              </p>
            </div>
          </label>

          {/* 智能引号配对开关 */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={preferences.enableSmartQuotes}
              onChange={(e) => updatePreference("enableSmartQuotes", e.target.checked)}
              className="w-4 h-4 accent-fandex-primary cursor-pointer"
            />
            <div>
              <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                {t("settings.featureSmartQuotes")}
              </span>
              <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                {t("settings.featureSmartQuotesHint")}
              </p>
            </div>
          </label>

          {/* 场景分隔辅助开关 */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={preferences.enableSceneBreakHelper}
              onChange={(e) => updatePreference("enableSceneBreakHelper", e.target.checked)}
              className="w-4 h-4 accent-fandex-primary cursor-pointer"
            />
            <div>
              <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                {t("settings.featureSceneBreak")}
              </span>
              <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                {t("settings.featureSceneBreakHint")}
              </p>
            </div>
          </label>

          {/* 实体高亮开关 */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={preferences.enableEntityHighlight}
              onChange={(e) => updatePreference("enableEntityHighlight", e.target.checked)}
              className="w-4 h-4 accent-fandex-primary cursor-pointer"
            />
            <div>
              <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                {t("settings.featureEntityHighlight")}
              </span>
              <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                {t("settings.featureEntityHighlightHint")}
              </p>
            </div>
          </label>
        </div>
      </section>

      {/* ===== 全文索引管理 ===== */}
      <section className="bg-zinc-900/40 rounded-lg p-4 border border-white/5">
        <IndexManagerPanel />
      </section>
    </div>
  );
}
