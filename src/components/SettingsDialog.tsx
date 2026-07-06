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

import { useCallback, useState, useEffect, useRef } from "react";
import { X, Type, BookOpen, FileText, Palette, Zap, Droplet, Info, RefreshCw, ExternalLink, CheckCircle, Layers, Sparkles, Loader2, KeyRound, Wifi } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore, BACKGROUND_PRESETS, type ChapterFormat, type TextureMode } from "../lib/settingsStore";
import { usePreferencesStore } from "../lib/preferencesSlice";
import { useThemeStore } from "../lib/themeStore";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { checkForUpdates, getCurrentVersion, openExternalUrl, RELEASES_PAGE_URL, type ReleaseInfo } from "../lib/updateChecker";
import UpdateNoticeDialog from "./UpdateNoticeDialog";
import IndexManagerPanel from "./IndexManagerPanel";

// 设置分区类型：用于 initialSection 属性指定打开时定位的分区
export type SettingsSection =
  | "editor"
  | "chapter"
  | "automation"
  | "indent"
  | "features"
  | "appearance"
  | "ai"
  | "index"
  | "about";

/**
 * AI 配置接口（与后端 ai_config.rs AiConfig 结构体字段对齐）
 * BYOK 模式：用户自带 API Key，配置持久化到 %APPDATA%\MiaoChuangShuo\ai_config.json
 */
interface AiConfig {
  /** Base64 编码的 API Key（前端使用 btoa 编码后传入） */
  apiKey: string;
  /** LLM API 基础地址（OpenAI 兼容协议） */
  baseUrl: string;
  /** 模型名称 */
  modelName: string;
  /** AI 功能总开关 */
  enabled: boolean;
  /** 采样温度（0.0-2.0） */
  temperature: number;
  /** 单次生成最大 Token 数 */
  maxTokens: number;
}

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** 打开时自动滚动定位到的分区，未指定时默认显示顶部 */
  initialSection?: SettingsSection;
}

/**
 * 设置对话框组件
 * 输入:
 *   - open: 对话框显示状态
 *   - onClose: 关闭回调
 *   - initialSection: 打开时自动定位到的分区（可选）
 * 输出: JSX 模态框（open=false 时返回 null）
 * 流程:
 *   1. 从 settingsStore 读取所有配置项
 *   2. 渲染六大设置分区：编辑器、章节、自动化、首行缩进、外观、关于与更新
 *   3. 每个设置项变更立即写回 store 并持久化到 localStorage
 *   4. 若传入 initialSection，打开时自动滚动到对应分区
 *   5. 点击遮罩或关闭按钮触发 onClose
 */
export default function SettingsDialog({ open, onClose, initialSection }: SettingsDialogProps) {
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
    backgroundPreset,
    customBackgroundColor,
    glassOpacity,
    textureMode,
    checkUpdateOnStartup,
    lastUpdateCheckTime,
    skipUpdateVersion,
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
    setBackgroundPreset,
    setCustomBackgroundColor,
    setGlassOpacity,
    setTextureMode,
    setCheckUpdateOnStartup,
    setLastUpdateCheckTime,
    setSkipUpdateVersion,
  } = useSettingsStore();
  const { theme, toggleTheme } = useThemeStore();
  const { showToast } = useToast();

  // ===== 版本更新检测状态 =====
  // 当前应用版本号（组件挂载时异步获取）
  const [currentVersion, setCurrentVersion] = useState("26.7.25");
  // 检查中状态（控制按钮 loading 动画）
  const [checking, setChecking] = useState(false);
  // 检测到的新版本信息（null=未检测到或未检查）
  const [latestRelease, setLatestRelease] = useState<ReleaseInfo | null>(null);
  // 更新提示弹窗显示状态
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);

  // 组件挂载时获取当前版本号
  useEffect(() => {
    if (!open) return;
    let mounted = true;
    (async () => {
      const v = await getCurrentVersion();
      if (mounted) setCurrentVersion(v);
    })();
    return () => {
      mounted = false;
    };
  }, [open]);

  /**
   * 手动触发检查更新
   * 流程:
   *   1. 设置 checking 状态
   *   2. 调用 checkForUpdates 获取结果
   *   3. 有新版本:弹出 UpdateNoticeDialog
   *   4. 无新版本:toast 提示"已是最新"
   *   5. 失败:toast 提示错误信息
   *   6. 更新 lastUpdateCheckTime
   */
  const handleCheckUpdate = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      const result = await checkForUpdates();
      setLastUpdateCheckTime(Date.now());

      if (result.hasUpdate) {
        // 检查用户是否已跳过此版本
        if (skipUpdateVersion === result.latest.version) {
          showToast("info", t("update.upToDateDesc", { version: result.current }), 4000);
        } else {
          setLatestRelease(result.latest);
          setUpdateDialogOpen(true);
        }
      } else {
        showToast("success", t("update.upToDateDesc", { version: result.current }), 4000);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("error", t("update.checkFailed", { error: msg }), 5000);
    } finally {
      setChecking(false);
    }
  }, [checking, setLastUpdateCheckTime, skipUpdateVersion, showToast, t]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  // 缩进宽度自定义输入:本地缓存输入文本,失焦或回车时提交到 store
  // 避免受控 input 在输入过程中被钳制导致体验问题(如输入"12"时中途被截为1)
  const [indentInput, setIndentInput] = useState(String(indentWidth));
  useEffect(() => {
    setIndentInput(String(indentWidth));
  }, [indentWidth]);
  const commitIndentInput = useCallback(() => {
    const v = parseInt(indentInput, 10);
    if (!isNaN(v) && v >= 1 && v <= 8) {
      setIndentWidth(v);
    } else {
      // 无效输入回退为当前 store 值
      setIndentInput(String(indentWidth));
    }
  }, [indentInput, indentWidth, setIndentWidth]);

  // 各分区 ref 引用:用于 initialSection 滚动定位
  const sectionRefs = {
    editor: useRef<HTMLElement>(null),
    chapter: useRef<HTMLElement>(null),
    automation: useRef<HTMLElement>(null),
    indent: useRef<HTMLElement>(null),
    features: useRef<HTMLElement>(null),
    appearance: useRef<HTMLElement>(null),
    ai: useRef<HTMLElement>(null),
    index: useRef<HTMLElement>(null),
    about: useRef<HTMLElement>(null),
  };

  // ===== AI 模型配置状态（BYOK 模式） =====
  // AI 配置字段（与后端 ai_config.rs AiConfig 对齐）
  const [aiApiKey, setAiApiKey] = useState("");           // 明文 API Key（用户编辑用，保存时编码为 Base64）
  const [aiBaseUrl, setAiBaseUrl] = useState("https://api.openai.com/v1");
  const [aiModelName, setAiModelName] = useState("gpt-4o-mini");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiTemperature, setAiTemperature] = useState(0.7);
  const [aiMaxTokens, setAiMaxTokens] = useState(2000);
  // 测试连通性状态
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<string | null>(null);
  // 保存状态
  const [aiSaving, setAiSaving] = useState(false);

  /**
   * 从后端加载 AI 配置
   * 流程:
   *   1. 调用 get_ai_config 命令读取配置
   *   2. 将 Base64 编码的 API Key 解码为明文（用于编辑框显示）
   *   3. 填充各状态字段
   *   4. 失败时静默处理，使用默认值（不阻塞设置面板）
   */
  const loadAiConfig = useCallback(async () => {
    try {
      const config = await invoke<AiConfig>("get_ai_config");
      setAiApiKey(config.apiKey ? atob(config.apiKey) : "");
      setAiBaseUrl(config.baseUrl);
      setAiModelName(config.modelName);
      setAiEnabled(config.enabled);
      setAiTemperature(config.temperature);
      setAiMaxTokens(config.maxTokens);
    } catch (err) {
      // 加载失败时静默处理，使用默认值
      console.error("加载 AI 配置失败:", err);
    }
  }, []);

  // 打开设置面板时加载 AI 配置
  useEffect(() => {
    if (!open) return;
    loadAiConfig();
  }, [open, loadAiConfig]);

  /**
   * 保存 AI 配置到后端
   * 流程:
   *   1. 将明文 API Key 编码为 Base64
   *   2. 组装 AiConfig 对象
   *   3. 调用 set_ai_config 命令持久化
   *   4. 成功/失败显示 toast 提示
   */
  const handleSaveAiConfig = useCallback(async () => {
    setAiSaving(true);
    try {
      const config: AiConfig = {
        apiKey: aiApiKey ? btoa(aiApiKey) : "",
        baseUrl: aiBaseUrl,
        modelName: aiModelName,
        enabled: aiEnabled,
        temperature: aiTemperature,
        maxTokens: aiMaxTokens,
      };
      await invoke("set_ai_config", { config });
      showToast("success", t("settings.ai.saveSuccess"));
    } catch (err) {
      showToast("error", `${t("settings.ai.saveFailed")}: ${err}`);
    } finally {
      setAiSaving(false);
    }
  }, [aiApiKey, aiBaseUrl, aiModelName, aiEnabled, aiTemperature, aiMaxTokens, showToast, t]);

  /**
   * 测试 AI 连通性
   * 流程:
   *   1. 组装 AiConfig 对象（含 Base64 编码的 API Key）
   *   2. 调用 test_ai_connection 命令发送测试请求
   *   3. 显示测试结果（成功/失败详情）
   */
  const handleTestAiConnection = useCallback(async () => {
    setAiTesting(true);
    setAiTestResult(null);
    try {
      const config: AiConfig = {
        apiKey: aiApiKey ? btoa(aiApiKey) : "",
        baseUrl: aiBaseUrl,
        modelName: aiModelName,
        enabled: aiEnabled,
        temperature: aiTemperature,
        maxTokens: aiMaxTokens,
      };
      const result = await invoke<string>("test_ai_connection", { config });
      setAiTestResult(result);
      showToast("success", t("settings.ai.testSuccess"));
    } catch (err) {
      const errMsg = String(err);
      setAiTestResult(errMsg);
      showToast("error", `${t("settings.ai.testFailed")}: ${errMsg}`);
    } finally {
      setAiTesting(false);
    }
  }, [aiApiKey, aiBaseUrl, aiModelName, aiEnabled, aiTemperature, aiMaxTokens, showToast, t]);

  // 编辑器功能开关（用户级偏好，跨项目共享）
  // 所有扩展全量注册，行为由这些开关控制，消除文体守卫导致的功能孤岛
  const preferences = usePreferencesStore((s) => s.preferences);
  const updatePreference = usePreferencesStore((s) => s.updatePreference);

  // 打开时若指定 initialSection,自动滚动到对应分区
  useEffect(() => {
    if (!open || !initialSection) return;
    const timer = setTimeout(() => {
      const targetRef = sectionRefs[initialSection];
      if (targetRef.current) {
        targetRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 80);
    return () => clearTimeout(timer);
    // 仅在 open 与 initialSection 变化时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSection]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={handleOverlayClick}
    >
      <div className="nf-glass-panel w-full max-w-lg bg-nf-bg-card border border-nf-border-light shadow-2xl max-h-[85vh] flex flex-col">
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

        {/* 内容区
            注:min-h-0 必须保留。flex 列布局下子元素默认 min-height:auto,
            会导致内容过多时撑破 max-h-[85vh] 约束,把底部确认按钮推出视口。
            设置 min-h-0 后 overflow-y-auto 才能正确触发滚动,底部按钮固定可见。 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-6">
          {/* 编辑器设置 */}
          <section ref={sectionRefs.editor}>
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
          <section ref={sectionRefs.chapter}>
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
          <section ref={sectionRefs.automation}>
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
          <section ref={sectionRefs.indent}>
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
                {/* 自定义缩进宽度:允许 1-8 任意值,补充快捷按钮无法覆盖的更宽缩进 */}
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

          {/* 编辑器功能开关设置 */}
          <section ref={sectionRefs.features}>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-fandex-tertiary" />
              <h3 className="text-sm font-bold font-display text-nf-text">
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

              {/* 伏笔标记开关 */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={preferences.enableForeshadowMark}
                  onChange={(e) => updatePreference("enableForeshadowMark", e.target.checked)}
                  className="w-4 h-4 accent-fandex-primary cursor-pointer"
                />
                <div>
                  <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                    {t("settings.featureForeshadowMark")}
                  </span>
                  <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                    {t("settings.featureForeshadowMarkHint")}
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

          {/* 外观设置 */}
          <section ref={sectionRefs.appearance}>
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

          {/* AI 模型配置（BYOK 模式） */}
          <section ref={sectionRefs.ai}>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-fandex-primary" />
              <h3 className="text-sm font-bold font-display text-nf-text">
                {t("settings.ai.section")}
              </h3>
            </div>

            <div className="space-y-3">
              {/* BYOK 说明 */}
              <div className="p-2.5 border border-nf-border-light bg-nf-bg-hover/30">
                <p className="text-[11px] text-nf-text-tertiary leading-relaxed">
                  {t("settings.ai.byokHint")}
                </p>
              </div>

              {/* AI 功能总开关 */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  onChange={(e) => setAiEnabled(e.target.checked)}
                  className="w-4 h-4 accent-fandex-primary cursor-pointer"
                />
                <div>
                  <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                    {t("settings.ai.enableAi")}
                  </span>
                  <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                    {t("settings.ai.enableAiHint")}
                  </p>
                </div>
              </label>

              {/* API Key 输入框 */}
              <div>
                <label className="flex items-center gap-1.5 text-xs text-nf-text-secondary mb-1.5">
                  <KeyRound className="w-3 h-3" />
                  {t("settings.ai.apiKey")}
                </label>
                <input
                  type="password"
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                  placeholder={t("settings.ai.apiKeyPlaceholder")}
                  className="w-full px-3 py-2 text-xs font-mono bg-nf-bg border border-nf-border-light text-nf-text placeholder:text-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
                />
              </div>

              {/* Base URL 输入框 */}
              <div>
                <label className="flex items-center gap-1.5 text-xs text-nf-text-secondary mb-1.5">
                  <ExternalLink className="w-3 h-3" />
                  {t("settings.ai.baseUrl")}
                </label>
                <input
                  type="text"
                  value={aiBaseUrl}
                  onChange={(e) => setAiBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="w-full px-3 py-2 text-xs font-mono bg-nf-bg border border-nf-border-light text-nf-text placeholder:text-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
                />
                <p className="text-[10px] text-nf-text-tertiary mt-1">
                  {t("settings.ai.baseUrlHint")}
                </p>
              </div>

              {/* 模型名称输入框 */}
              <div>
                <label className="flex items-center gap-1.5 text-xs text-nf-text-secondary mb-1.5">
                  <Layers className="w-3 h-3" />
                  {t("settings.ai.model")}
                </label>
                <input
                  type="text"
                  value={aiModelName}
                  onChange={(e) => setAiModelName(e.target.value)}
                  placeholder="gpt-4o-mini"
                  className="w-full px-3 py-2 text-xs font-mono bg-nf-bg border border-nf-border-light text-nf-text placeholder:text-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
                />
              </div>

              {/* 采样温度滑块 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-nf-text-secondary">
                    {t("settings.ai.temperature")}
                  </label>
                  <span className="text-xs font-mono text-fandex-primary">
                    {aiTemperature.toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={aiTemperature}
                  onChange={(e) => setAiTemperature(parseFloat(e.target.value))}
                  className="w-full accent-fandex-primary cursor-pointer"
                />
                <p className="text-[10px] text-nf-text-tertiary mt-1">
                  {t("settings.ai.temperatureHint")}
                </p>
              </div>

              {/* 最大 Token 数 */}
              <div>
                <label className="text-xs text-nf-text-secondary mb-1.5 block">
                  {t("settings.ai.maxTokens")}
                </label>
                <input
                  type="number"
                  min="100"
                  max="32000"
                  step="100"
                  value={aiMaxTokens}
                  onChange={(e) => setAiMaxTokens(parseInt(e.target.value) || 2000)}
                  className="w-full px-3 py-2 text-xs font-mono bg-nf-bg border border-nf-border-light text-nf-text focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
                />
              </div>

              {/* 测试连通性结果 */}
              {aiTestResult && (
                <div className={`p-2.5 border text-[11px] leading-relaxed ${
                  aiTestResult.includes("连接成功")
                    ? "border-fandex-secondary/40 bg-fandex-secondary/10 text-fandex-secondary"
                    : "border-red-500/40 bg-red-500/10 text-red-400"
                }`}>
                  {aiTestResult}
                </div>
              )}

              {/* 操作按钮组 */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleTestAiConnection}
                  disabled={aiTesting || !aiApiKey}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs bg-fandex-secondary/10 hover:bg-fandex-secondary/20 border border-fandex-secondary/40 text-fandex-secondary transition duration-fast disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {aiTesting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Wifi className="w-3.5 h-3.5" />
                  )}
                  {aiTesting ? t("settings.ai.testing") : t("settings.ai.testConnection")}
                </button>
                <button
                  onClick={handleSaveAiConfig}
                  disabled={aiSaving}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs bg-fandex-primary/10 hover:bg-fandex-primary/20 border border-fandex-primary/40 text-fandex-primary transition duration-fast disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {aiSaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle className="w-3.5 h-3.5" />
                  )}
                  {aiSaving ? t("settings.ai.saving") : t("settings.ai.save")}
                </button>
              </div>
            </div>
          </section>

          {/* 全文索引管理设置（Sprint 4 任务 4.2） */}
          <section ref={sectionRefs.index}>
            <IndexManagerPanel />
          </section>

          {/* 关于与更新设置 */}
          <section ref={sectionRefs.about}>
            <div className="flex items-center gap-2 mb-3">
              <Info className="w-4 h-4 text-fandex-primary" />
              <h3 className="text-sm font-bold font-display text-nf-text">
                {t("update.section")}
              </h3>
            </div>

            <div className="space-y-3">
              {/* 当前版本号 + 检查更新按钮 */}
              <div className="flex items-center justify-between p-3 border border-nf-border-light bg-nf-bg">
                <div>
                  <div className="text-xs text-nf-text-secondary mb-0.5">
                    {t("update.currentVersion")}
                  </div>
                  <div className="text-sm font-mono font-bold text-nf-text">
                    v{currentVersion}
                  </div>
                </div>
                <button
                  onClick={handleCheckUpdate}
                  disabled={checking}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs bg-fandex-primary/10 hover:bg-fandex-primary/20 border border-fandex-primary/40 text-fandex-primary transition duration-fast disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} />
                  {checking ? t("update.checking") : t("update.checkNow")}
                </button>
              </div>

              {/* 上次检查时间 */}
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-nf-text-tertiary">{t("update.lastCheck")}</span>
                <span className="text-nf-text-secondary font-mono">
                  {lastUpdateCheckTime > 0
                    ? new Date(lastUpdateCheckTime).toLocaleString("zh-CN", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : t("update.neverChecked")}
                </span>
              </div>

              {/* 启动时自动检查更新 */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={checkUpdateOnStartup}
                  onChange={(e) => setCheckUpdateOnStartup(e.target.checked)}
                  className="w-4 h-4 accent-fandex-primary cursor-pointer"
                />
                <div>
                  <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                    {t("update.autoCheck")}
                  </span>
                  <p className="text-[10px] text-nf-text-tertiary mt-0.5">
                    {t("update.autoCheckHint")}
                  </p>
                </div>
              </label>

              {/* 已跳过版本显示（仅当用户跳过过版本时显示） */}
              {skipUpdateVersion && (
                <div className="flex items-center justify-between p-2 border border-nf-border-light bg-nf-bg-hover/50">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="w-3 h-3 text-nf-text-tertiary" />
                    <span className="text-[11px] text-nf-text-tertiary">
                      {t("update.skipVersion")}: v{skipUpdateVersion}
                    </span>
                  </div>
                  <button
                    onClick={() => setSkipUpdateVersion("")}
                    className="text-[10px] text-fandex-primary hover:text-fandex-primary-hover transition duration-fast"
                  >
                    {t("app.cancel")}
                  </button>
                </div>
              )}

              {/* 查看发布页面链接 */}
              <button
                onClick={() => openExternalUrl(RELEASES_PAGE_URL)}
                className="flex items-center gap-1.5 text-[11px] text-nf-text-tertiary hover:text-fandex-primary transition duration-fast"
              >
                <ExternalLink className="w-3 h-3" />
                {t("update.viewReleases")}
              </button>
            </div>
          </section>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end px-6 py-3 border-t border-nf-border-light flex-shrink-0">
          <button
            onClick={onClose}
            className="h-8 px-4 text-sm flex items-center justify-center gap-1.5 bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast"
          >
            {t("app.confirm")}
          </button>
        </div>
      </div>

      {/* 更新提示弹窗（检测到新版本时显示） */}
      <UpdateNoticeDialog
        open={updateDialogOpen}
        onClose={() => setUpdateDialogOpen(false)}
        currentVersion={currentVersion}
        release={latestRelease}
        onSkip={(version) => setSkipUpdateVersion(version)}
      />
    </div>
  );
}
