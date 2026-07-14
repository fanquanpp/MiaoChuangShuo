// AI 配置设置分区组件
//
// 功能概述：
// 设置对话框「AI 配置」分区，提供 BYOK（Bring Your Own Key）模式下的
// LLM API 连接配置，包括 API Key、Base URL、模型名称、采样温度、
// 最大 Token 数等参数，以及连通性测试与配置保存功能。
//
// 模块职责：
// 1. 从后端加载 AI 配置并填充到编辑表单
// 2. 提供 API Key / Base URL / 模型名称 / 温度 / maxTokens 编辑界面
// 3. 提供测试连通性按钮，实时显示测试结果
// 4. 提供保存配置按钮，持久化到后端 ai_config.json
//
// 设计说明：
// - API Key 在前端使用明文编辑，保存时编码为 Base64 传输到后端
// - 通过 aiService 封装层调用后端 Tauri 命令，UI 层不直接接触 invoke
// - 组件挂载时自动加载配置（通过条件渲染控制挂载时机）

import { useState, useEffect, useCallback } from "react";
import { Sparkles, Loader2, KeyRound, Wifi, ExternalLink, CheckCircle, Layers } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { logger } from "../../lib/logger";
import * as aiService from "../../lib/aiService";
import type { AiConfig } from "../../lib/aiService";

/**
 * AI 配置设置分区组件
 *
 * 输入: 无（组件挂载时从后端加载配置）
 * 输出: JSX AI 配置分区内容
 * 流程:
 *   1. 组件挂载时调用 aiService.getAiConfig 加载配置
 *   2. 将 Base64 编码的 API Key 解码为明文填充编辑框
 *   3. 用户编辑各字段后可点击「测试连接」或「保存」
 *   4. 测试连接: 组装配置调用 testAiConnection，显示结果
 *   5. 保存: 将明文 API Key 编码为 Base64，调用 setAiConfig 持久化
 */
export default function AiSettingsSection() {
  const { t } = useI18n();
  const { showToast } = useToast();

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
   *   1. 调用 aiService.getAiConfig 读取配置
   *   2. 将 Base64 编码的 API Key 解码为明文（用于编辑框显示）
   *   3. 填充各状态字段
   *   4. 失败时静默处理，使用默认值（不阻塞设置面板）
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
    } catch (err) {
      // 加载失败时静默处理，使用默认值
      logger.error("加载 AI 配置失败:", err instanceof Error ? err : String(err));
    }
  }, []);

  // 组件挂载时加载 AI 配置
  useEffect(() => {
    loadAiConfig();
  }, [loadAiConfig]);

  /**
   * 保存 AI 配置到后端
   * 流程:
   *   1. 将明文 API Key 编码为 Base64
   *   2. 组装 AiConfig 对象
   *   3. 调用 aiService.setAiConfig 持久化
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
      await aiService.setAiConfig(config);
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
   *   2. 调用 aiService.testAiConnection 发送测试请求
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
      const result = await aiService.testAiConnection(config);
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

  return (
    <section>
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
  );
}
