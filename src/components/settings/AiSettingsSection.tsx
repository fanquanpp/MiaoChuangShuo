// AI 配置设置分区组件 (卡片式供应商选择版)
//
// 功能概述:
//   设置对话框「AI 配置」分区, 提供卡片式供应商选择 + 详细参数配置.
//   借鉴 CherryStudio 的 Provider 模板设计, 预置 8 个主流供应商,
//   DeepSeek 作为推荐默认. 用户可一键选择供应商并填充默认值,
//   也可手动编辑 Base URL / 模型名称.
//
// 模块职责:
//   1. 渲染供应商卡片网格 (8 个内置供应商, 点击切换)
//   2. 渲染当前选中供应商的详细配置面板
//     - API Key 输入框 (含显示/隐藏切换 + 获取 Key 链接)
//     - Base URL 输入框 (可编辑)
//     - 模型选择 (下拉 + 自定义输入 + 拉取模型按钮)
//     - 采样温度滑块
//     - 最大 Token 数
//     - 安全存储开关 (钥匙串)
//   3. 测试连通性 (返回延迟与模型响应)
//   4. 拉取模型列表 (调用 /v1/models 端点)
//   5. 保存配置 (持久化到后端, API Key 优先存入钥匙串)
//
// 设计说明:
//   - 卡片切换使用 Framer Motion 淡入动画 (duration 0.2)
//   - API Key 在前端明文编辑, 保存时编码为 Base64 传输后端
//   - 后端透明处理钥匙串存储, 前端通过 useSecureStorage 开关控制
//   - 测试连通性按钮显示延迟 (ms) 与模型响应片段
//   - 拉取模型按钮在模型选择右侧, 成功后填充下拉列表

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Loader2,
  KeyRound,
  ExternalLink,
  CheckCircle,
  Eye,
  EyeOff,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Star,
  Zap,
  Clock,
  Cpu,
  Layers,
} from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { logger } from "../../lib/logger";
import * as aiService from "../../lib/aiService";
import type { AiConfig, ConnectionTestResult, ModelInfo } from "../../lib/aiService";
import {
  BUILTIN_PROVIDERS,
  getProviderById,
  type ProviderPreset,
} from "../../lib/providerRegistry";

/**
 * AI 配置设置分区组件
 *
 * 输入: 无 (组件挂载时从后端加载配置)
 * 输出: JSX AI 配置分区内容 (卡片式供应商选择 + 详细参数)
 */
export default function AiSettingsSection() {
  const { t } = useI18n();
  const { showToast } = useToast();

  // ===== 供应商选择状态 =====
  const [selectedProviderId, setSelectedProviderId] = useState("deepseek");

  // ===== AI 模型配置状态 (BYOK 模式) =====
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("https://api.deepseek.com/v1");
  const [aiModelName, setAiModelName] = useState("deepseek-chat");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiTemperature, setAiTemperature] = useState(0.7);
  const [aiMaxTokens, setAiMaxTokens] = useState(2000);
  const [useSecureStorage, setUseSecureStorage] = useState(true);

  // ===== UI 状态 =====
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [aiSaving, setAiSaving] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<ModelInfo[]>([]);

  // ===== 当前选中供应商 (派生值) =====
  const selectedProvider: ProviderPreset = useMemo(
    () => getProviderById(selectedProviderId),
    [selectedProviderId]
  );

  /**
   * 从后端加载 AI 配置
   * 流程:
   *   1. 调用 aiService.getAiConfig 读取配置
   *   2. Base64 解码 API Key 为明文 (用于编辑框显示)
   *   3. 填充各状态字段
   *   4. 失败时静默处理, 使用默认值 (不阻塞设置面板)
   */
  const loadAiConfig = useCallback(async () => {
    try {
      const config = await aiService.getAiConfig();
      setAiApiKey(config.apiKey ? atob(config.apiKey) : "");
      setAiBaseUrl(config.baseUrl);
      setAiModelName(config.modelName);
      setAiEnabled(config.enabled);
      setAiTemperature(config.temperature);
      setAiMaxTokens(config.maxTokens);
      setUseSecureStorage(config.useSecureStorage);
      setSelectedProviderId(config.providerId || "deepseek");
    } catch (err) {
      logger.error("加载 AI 配置失败:", err instanceof Error ? err : String(err));
    }
  }, []);

  // 组件挂载时加载 AI 配置
  useEffect(() => {
    loadAiConfig();
  }, [loadAiConfig]);

  /**
   * 切换供应商时填充默认值
   * 流程:
   *   1. 更新 selectedProviderId
   *   2. 填充该供应商的默认 baseUrl 与 defaultModel
   *   3. 清空已拉取的模型列表与测试结果
   *   4. 保留 API Key (用户可能在不同供应商间复用)
   */
  const handleSelectProvider = useCallback((provider: ProviderPreset) => {
    setSelectedProviderId(provider.id);
    setAiBaseUrl(provider.baseUrl);
    setAiModelName(provider.defaultModel);
    setFetchedModels([]);
    setTestResult(null);
  }, []);

  /**
   * 组装当前 AiConfig 对象 (供测试与保存共用)
   * 输出: AiConfig (apiKey 字段为 Base64 编码)
   */
  const buildConfig = useCallback((): AiConfig => {
    return {
      apiKey: aiApiKey ? btoa(aiApiKey) : "",
      baseUrl: aiBaseUrl,
      modelName: aiModelName,
      enabled: aiEnabled,
      temperature: aiTemperature,
      maxTokens: aiMaxTokens,
      providerId: selectedProviderId,
      useSecureStorage,
    };
  }, [
    aiApiKey,
    aiBaseUrl,
    aiModelName,
    aiEnabled,
    aiTemperature,
    aiMaxTokens,
    selectedProviderId,
    useSecureStorage,
  ]);

  /**
   * 保存 AI 配置到后端
   * 流程:
   *   1. 组装 AiConfig (Base64 编码 API Key)
   *   2. 调用 aiService.setAiConfig 持久化
   *   3. 后端透明处理钥匙串存储 (useSecureStorage=true 时写入系统钥匙串)
   *   4. 成功/失败显示 toast 提示
   */
  const handleSaveAiConfig = useCallback(async () => {
    setAiSaving(true);
    try {
      const config = buildConfig();
      await aiService.setAiConfig(config);
      showToast("success", t("settings.ai.saveSuccess"));
    } catch (err) {
      showToast("error", `${t("settings.ai.saveFailed")}: ${err}`);
    } finally {
      setAiSaving(false);
    }
  }, [buildConfig, showToast, t]);

  /**
   * 测试 AI 连通性 (增强版, 返回延迟与模型响应)
   * 流程:
   *   1. 组装 AiConfig
   *   2. 调用 aiService.testAiConnection
   *   3. 显示测试结果 (success/message/latencyMs/modelResponse)
   */
  const handleTestAiConnection = useCallback(async () => {
    setAiTesting(true);
    setTestResult(null);
    try {
      const config = buildConfig();
      const result = await aiService.testAiConnection(config);
      setTestResult(result);
      if (result.success) {
        showToast("success", t("settings.ai.testSuccess"));
      } else {
        showToast("error", `${t("settings.ai.testFailed")}: ${result.message}`);
      }
    } catch (err) {
      const errMsg = String(err);
      setTestResult({
        success: false,
        message: errMsg,
        latencyMs: 0,
        modelResponse: null,
      });
      showToast("error", `${t("settings.ai.testFailed")}: ${errMsg}`);
    } finally {
      setAiTesting(false);
    }
  }, [buildConfig, showToast, t]);

  /**
   * 拉取可用模型列表
   * 流程:
   *   1. 组装 AiConfig
   *   2. 调用 aiService.listModels (GET /v1/models)
   *   3. 成功: 填充 fetchedModels, 自动选中第一个模型
   *   4. 失败: 显示错误 toast
   */
  const handleFetchModels = useCallback(async () => {
    setFetchingModels(true);
    try {
      const config = buildConfig();
      const models = await aiService.listModels(config);
      setFetchedModels(models);
      if (models.length > 0) {
        setAiModelName(models[0].id);
        showToast("success", t("settings.ai.fetchModelsSuccess", { count: models.length }));
      } else {
        showToast("warning", t("settings.ai.fetchModelsEmpty"));
      }
    } catch (err) {
      showToast("error", `${t("settings.ai.fetchModelsFailed")}: ${err}`);
    } finally {
      setFetchingModels(false);
    }
  }, [buildConfig, showToast, t]);

  // ===== 模型选项列表 (预置 + 已拉取合并去重) =====
  const modelOptions = useMemo(() => {
    const preset = selectedProvider.models;
    const fetched = fetchedModels.map((m) => m.id);
    const merged = Array.from(new Set([...preset, ...fetched]));
    return merged.sort();
  }, [selectedProvider, fetchedModels]);

  return (
    <section className="bg-zinc-900/40 rounded-lg p-4 border border-white/5">
      {/* 标题 */}
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-fandex-primary" />
        <h3 className="text-sm font-medium text-nf-text">
          {t("settings.ai.section")}
        </h3>
      </div>

      <div className="space-y-4">
        {/* BYOK 说明 + AI 总开关 */}
        <div className="p-2.5 border border-nf-border-light bg-nf-bg-hover/30">
          <p className="text-[11px] text-nf-text-tertiary leading-relaxed mb-2">
            {t("settings.ai.byokHint")}
          </p>
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
        </div>

        {/* 供应商卡片网格 (2 列响应式) */}
        <div>
          <div className="flex items-center gap-1.5 text-xs text-nf-text-secondary mb-2">
            <Cpu className="w-3 h-3" />
            {t("settings.ai.selectProvider")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {BUILTIN_PROVIDERS.map((provider) => {
              const isSelected = provider.id === selectedProviderId;
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => handleSelectProvider(provider)}
                  className={`relative flex items-start gap-2 p-2.5 border text-left transition-all duration-200 ${
                    isSelected
                      ? "border-fandex-primary bg-fandex-primary/10 shadow-[0_0_0_1px_rgba(110,168,254,0.3)]"
                      : "border-nf-border-light bg-nf-bg hover:bg-nf-bg-hover hover:border-nf-border"
                  }`}
                >
                  {/* 供应商图标 (纯色背景 + 首字母) */}
                  <div
                    className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-nf-text text-xs font-bold bg-nf-bg-hover border border-nf-border-light"
                  >
                    {provider.iconChar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold text-nf-text truncate">
                        {provider.name}
                      </span>
                      {provider.isRecommended && (
                        <span className="flex items-center gap-0.5 px-1 py-0.5 bg-fandex-secondary/15 text-fandex-secondary text-[9px] font-medium leading-none">
                          <Star className="w-2 h-2 fill-current" />
                          {t("settings.ai.recommended")}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-nf-text-tertiary mt-0.5 line-clamp-2 leading-tight">
                      {provider.description}
                    </p>
                  </div>
                  {/* 选中态指示器 */}
                  {isSelected && (
                    <CheckCircle className="absolute top-1.5 right-1.5 w-3 h-3 text-fandex-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 详细配置面板 (AnimatePresence 切换动画) */}
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedProviderId}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="space-y-3 pt-2 border-t border-nf-border-light"
          >
            {/* 当前供应商信息条 */}
            <div className="flex items-center justify-between p-2 bg-nf-bg-hover/50 border border-nf-border-light">
              <div className="flex items-center gap-2">
                <div
                  className="w-5 h-5 flex items-center justify-center text-nf-text text-[10px] font-bold bg-nf-bg-hover border border-nf-border-light"
                >
                  {selectedProvider.iconChar}
                </div>
                <span className="text-xs font-medium text-nf-text">
                  {selectedProvider.name}
                </span>
              </div>
              {selectedProvider.website && (
                <a
                  href={selectedProvider.apiKeyUrl || selectedProvider.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] text-fandex-primary hover:text-fandex-secondary transition-colors"
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                  {t("settings.ai.getApiKey")}
                </a>
              )}
            </div>

            {/* API Key 输入框 */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-nf-text-secondary mb-1.5">
                <KeyRound className="w-3 h-3" />
                {t("settings.ai.apiKey")}
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                  placeholder={selectedProvider.requiresApiKey ? "sk-..." : t("settings.ai.apiKeyOptional")}
                  className="w-full px-3 py-2 pr-9 text-xs font-mono bg-nf-bg border border-nf-border-light text-nf-text placeholder:text-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  title={showApiKey ? t("settings.ai.hideKey") : t("settings.ai.showKey")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-nf-text-tertiary hover:text-nf-text transition-colors"
                >
                  {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
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
                placeholder="https://api.deepseek.com/v1"
                className="w-full px-3 py-2 text-xs font-mono bg-nf-bg border border-nf-border-light text-nf-text placeholder:text-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
              />
            </div>

            {/* 模型选择 (下拉 + 拉取按钮) */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-nf-text-secondary mb-1.5">
                <Layers className="w-3 h-3" />
                {t("settings.ai.model")}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  list="ai-model-options"
                  value={aiModelName}
                  onChange={(e) => setAiModelName(e.target.value)}
                  placeholder="deepseek-chat"
                  className="flex-1 px-3 py-2 text-xs font-mono bg-nf-bg border border-nf-border-light text-nf-text placeholder:text-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
                />
                <datalist id="ai-model-options">
                  {modelOptions.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
                {selectedProvider.supportsListModels && (
                  <button
                    type="button"
                    onClick={handleFetchModels}
                    disabled={fetchingModels || !aiApiKey}
                    title={t("settings.ai.fetchModelsHint")}
                    className="flex items-center gap-1 px-2 py-2 text-xs bg-fandex-tertiary/10 hover:bg-fandex-tertiary/20 border border-fandex-tertiary/40 text-fandex-tertiary transition duration-fast disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {fetchingModels ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
              {fetchedModels.length > 0 && (
                <p className="text-[10px] text-fandex-tertiary mt-1">
                  {t("settings.ai.fetchedModelsCount", { count: fetchedModels.length })}
                </p>
              )}
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

            {/* 安全存储开关 */}
            <label className="flex items-start gap-3 cursor-pointer group p-2 border border-nf-border-light bg-nf-bg-hover/30">
              <input
                type="checkbox"
                checked={useSecureStorage}
                onChange={(e) => setUseSecureStorage(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-fandex-primary cursor-pointer"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  {useSecureStorage ? (
                    <ShieldCheck className="w-3 h-3 text-fandex-secondary" />
                  ) : (
                    <ShieldAlert className="w-3 h-3 text-fandex-tertiary" />
                  )}
                  <span className="text-xs text-nf-text-secondary group-hover:text-nf-text transition-colors">
                    {t("settings.ai.secureStorage")}
                  </span>
                </div>
                <p className="text-[10px] text-nf-text-tertiary mt-0.5 leading-relaxed">
                  {t("settings.ai.secureStorageHint")}
                </p>
              </div>
            </label>
          </motion.div>
        </AnimatePresence>

        {/* 测试连通性结果 */}
        {testResult && (
          <div
            className={`p-2.5 border text-[11px] leading-relaxed ${
              testResult.success
                ? "border-fandex-secondary/40 bg-fandex-secondary/10 text-fandex-secondary"
                : "border-red-500/40 bg-red-500/10 text-red-400"
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              {testResult.success ? (
                <CheckCircle className="w-3 h-3" />
              ) : (
                <ShieldAlert className="w-3 h-3" />
              )}
              <span className="font-medium">{testResult.message}</span>
            </div>
            {testResult.success && testResult.latencyMs > 0 && (
              <div className="flex items-center gap-3 text-[10px] opacity-80">
                <span className="flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" />
                  {testResult.latencyMs}ms
                </span>
                {testResult.modelResponse && (
                  <span className="flex items-center gap-0.5">
                    <Zap className="w-2.5 h-2.5" />
                    {t("settings.ai.modelSaid")}: {testResult.modelResponse.slice(0, 30)}
                  </span>
                )}
              </div>
            )}
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
              <Zap className="w-3.5 h-3.5" />
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
  );
}
