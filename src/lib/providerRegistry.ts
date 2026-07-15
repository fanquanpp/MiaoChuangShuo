// 供应商预设注册表
//
// 功能概述:
//   预置主流 OpenAI 兼容协议供应商配置模板, 用户可在设置面板一键选择并填充默认值,
//   避免手动查找 Base URL 与模型名称. 借鉴 CherryStudio 的 Provider 模板设计,
//   DeepSeek 作为推荐默认供应商.
//
// 模块职责:
//   1. 定义 ProviderPreset 接口 (供应商预设模板字段)
//   2. 预置 8 个主流供应商 (DeepSeek/SiliconFlow/Kimi/GLM/Qwen/OpenAI/Ollama/Custom)
//   3. 提供 getProviderById / getDefaultProvider / listBuiltinProviders 工具函数
//   4. 供 AiSettingsSection 渲染卡片式供应商列表使用
//
// 设计说明:
//   - 内置供应商不可删除 (isBuiltin=true), 用户可编辑其 API Key 与模型
//   - DeepSeek 标记为推荐 (isRecommended=true), 作为默认选中项
//   - supportsListModels 标识供应商是否支持 /v1/models 端点拉取模型列表
//   - color 用于卡片图标背景渐变, 提升视觉识别度
//   - 所有 baseUrl 已去除尾部斜杠, 与后端 ai_config.rs 拼接逻辑一致

/**
 * 供应商预设模板
 */
export interface ProviderPreset {
  /** 唯一标识 (deepseek/siliconflow/kimi/glm/qwen/openai/ollama/custom) */
  id: string;
  /** 显示名称 (中英文混合, 与品牌官方称呼一致) */
  name: string;
  /** 简介 (用于卡片副标题) */
  description: string;
  /** 默认 Base URL (OpenAI 兼容协议端点) */
  baseUrl: string;
  /** 默认模型名称 */
  defaultModel: string;
  /** 预置模型列表 (用户也可手动输入或通过 list_models 拉取) */
  models: string[];
  /** 官网地址 (用于"获取 API Key"链接) */
  website: string;
  /** 文档地址 (用于"查看接入文档"链接) */
  docsUrl: string;
  /** 获取 API Key 的直链 */
  apiKeyUrl: string;
  /** 品牌色 (用于卡片图标背景, Tailwind 渐变色类) */
  color: string;
  /** 品牌图标首字母 (用于卡片图标文字) */
  iconChar: string;
  /** 是否内置 (内置不可删除) */
  isBuiltin: boolean;
  /** 是否推荐 (DeepSeek 默认推荐) */
  isRecommended: boolean;
  /** 是否支持 /v1/models 端点拉取模型列表 */
  supportsListModels: boolean;
  /** 是否需要 API Key (Ollama 本地无需) */
  requiresApiKey: boolean;
}

/**
 * 内置供应商预设列表 (顺序即展示顺序)
 *
 * 设计依据:
 *   - DeepSeek 作为推荐默认 (国内可访问、性价比高、创作能力优秀)
 *   - 硅基流动聚合多模型, 适合多模型切换
 *   - Kimi/GLM/Qwen 为国内主流, OpenAI 为国际标准
 *   - Ollama 满足离线本地需求
 *   - Custom 兜底, 支持任意 OpenAI 兼容端点
 */
export const BUILTIN_PROVIDERS: readonly ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "深度求索, 国内推荐, 性价比高, 创作能力强",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    website: "https://www.deepseek.com",
    docsUrl: "https://api-docs.deepseek.com",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    color: "from-blue-500 to-indigo-600",
    iconChar: "D",
    isBuiltin: true,
    isRecommended: true,
    supportsListModels: true,
    requiresApiKey: true,
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    description: "聚合多模型聚合站, 支持 Qwen / GLM / DeepSeek 等",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen2.5-72B-Instruct",
    models: [
      "Qwen/Qwen2.5-72B-Instruct",
      "Qwen/Qwen2.5-7B-Instruct",
      "deepseek-ai/DeepSeek-V2-Chat",
      "deepseek-ai/DeepSeek-R1",
      "THUDM/glm-4-9b-chat",
    ],
    website: "https://siliconflow.cn",
    docsUrl: "https://docs.siliconflow.cn",
    apiKeyUrl: "https://cloud.siliconflow.cn/account/ak",
    color: "from-cyan-500 to-blue-500",
    iconChar: "S",
    isBuiltin: true,
    isRecommended: false,
    supportsListModels: true,
    requiresApiKey: true,
  },
  {
    id: "kimi",
    name: "Moonshot Kimi",
    description: "月之暗面 Kimi, 长上下文支持 128K",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    website: "https://www.moonshot.cn",
    docsUrl: "https://platform.moonshot.cn/docs",
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
    color: "from-purple-500 to-pink-500",
    iconChar: "K",
    isBuiltin: true,
    isRecommended: false,
    supportsListModels: true,
    requiresApiKey: true,
  },
  {
    id: "glm",
    name: "智谱 GLM",
    description: "智谱 AI GLM-4 系列, 中文创作能力强",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    models: ["glm-4-flash", "glm-4", "glm-4-air", "glm-4-airx"],
    website: "https://www.zhipuai.cn",
    docsUrl: "https://open.bigmodel.cn/dev/api",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    color: "from-emerald-500 to-teal-600",
    iconChar: "G",
    isBuiltin: true,
    isRecommended: false,
    supportsListModels: true,
    requiresApiKey: true,
  },
  {
    id: "qwen",
    name: "通义千问",
    description: "阿里云通义千问, Qwen 系列多版本可选",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    models: ["qwen-plus", "qwen-max", "qwen-turbo", "qwen-long"],
    website: "https://tongyi.aliyun.com",
    docsUrl: "https://help.aliyun.com/zh/dashscope",
    apiKeyUrl: "https://dashscope.console.aliyun.com/apiKey",
    color: "from-orange-500 to-red-500",
    iconChar: "Q",
    isBuiltin: true,
    isRecommended: false,
    supportsListModels: true,
    requiresApiKey: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "国际标准, 需海外网络环境访问",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
    website: "https://openai.com",
    docsUrl: "https://platform.openai.com/docs",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    color: "from-green-500 to-emerald-600",
    iconChar: "O",
    isBuiltin: true,
    isRecommended: false,
    supportsListModels: true,
    requiresApiKey: true,
  },
  {
    id: "ollama",
    name: "Ollama (本地)",
    description: "本地离线推理, 无需 API Key, 需先安装 Ollama",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "qwen2.5:7b",
    models: ["qwen2.5:7b", "qwen2.5:14b", "llama3.2", "deepseek-r1:7b"],
    website: "https://ollama.com",
    docsUrl: "https://github.com/ollama/ollama",
    apiKeyUrl: "https://ollama.com/download",
    color: "from-zinc-600 to-zinc-800",
    iconChar: "L",
    isBuiltin: true,
    isRecommended: false,
    supportsListModels: true,
    requiresApiKey: false,
  },
  {
    id: "custom",
    name: "自定义",
    description: "任意 OpenAI 兼容端点, 自由配置 Base URL 与模型",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: [],
    website: "",
    docsUrl: "",
    apiKeyUrl: "",
    color: "from-slate-500 to-slate-700",
    iconChar: "C",
    isBuiltin: true,
    isRecommended: false,
    supportsListModels: false,
    requiresApiKey: true,
  },
] as const;

/**
 * 默认供应商 ID (DeepSeek)
 */
export const DEFAULT_PROVIDER_ID = "deepseek";

/**
 * 根据 ID 获取供应商预设
 *
 * 输入: id 供应商标识
 * 输出: ProviderPreset 供应商预设 (未找到时返回 custom)
 */
export function getProviderById(id: string): ProviderPreset {
  return BUILTIN_PROVIDERS.find((p) => p.id === id) ?? BUILTIN_PROVIDERS[BUILTIN_PROVIDERS.length - 1];
}

/**
 * 获取推荐供应商 (DeepSeek)
 *
 * 输出: ProviderPreset 推荐的供应商
 */
export function getDefaultProvider(): ProviderPreset {
  return BUILTIN_PROVIDERS.find((p) => p.isRecommended) ?? BUILTIN_PROVIDERS[0];
}

/**
 * 列出所有内置供应商
 *
 * 输出: ProviderPreset[] 内置供应商列表
 */
export function listBuiltinProviders(): ProviderPreset[] {
  return BUILTIN_PROVIDERS.filter((p) => p.isBuiltin);
}
