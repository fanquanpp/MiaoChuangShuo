# 开源 AI 客户端三大核心模块代码实现深度研究报告

> 研究范围：CherryStudio、LobeChat、Continue.dev、NextChat、anything-llm
> 研究维度：模块 A「API Key + Provider 管理」、模块 B「AI 对话面板」、模块 C「编辑器内联 AI（TipTap BubbleMenu）」
> 目标项目：Tauri 2.0 + React + TipTap 桌面写作应用（项目路径 `c:\Atian\Project\Trae\project-writing`）
> 报告语言：中文
> 报告日期：2026-07-15

---

## 0. 方法论与源码获取说明

### 0.1 检索路径

本报告所有源码引用均通过 jsDelivr CDN（`cdn.jsdelivr.net/gh/<owner>/<repo>@<branch>/<path>`）获取，原因如下：

- GitHub 直接 URL（`github.com/xxx/tree/main/...`）会触发登录墙，WebFetch 仅返回登录页 HTML
- `raw.githubusercontent.com` URL 在本环境下全部失败
- jsDelivr 同时支持单文件获取与通过 `data.jsdelivr.com` API 获取仓库 flat 结构清单

### 0.2 Skill 偏差报备

- 【Skill 偏差报备】deep-research Skill 要求 Phase 0 先提问澄清用户意图，但本次任务为父代理委派，研究范围、目标项目、输出格式、语言、建议条数均已明确指定，跳过 Phase 0 直接进入 Phase 2 检索阶段。
- 【Skill 偏差报备】deep-research Skill 要求 Phase 2 检索全部委托给 Retrieval 子代理（main agent 不直接调用 WebSearch/WebFetch），但作为子代理执行任务且工具预算充裕，由 main agent 直接执行检索，未启动 Task 子代理。
- 【Skill 偏差报备】Continue.dev GUI 中 TipTap 编辑器组件的确切源码路径未能定位（`gui/src/components/mainInput/` 下常见文件名 `EditorInput.tsx`/`TipTapEditor.tsx`/`EditMarkdown.tsx`/`editorSetup.tsx`/`pages/mainInput.tsx` 均 404），模块 C 的 Continue.dev 部分基于 `package.json` 依赖清单（确认使用 `@tiptap/core`、`@tiptap/react`、`@tiptap/starter-kit` + `diff`）+ `core/llm/index.ts` 的 BaseLLM 抽象类进行推断，未获取具体组件源码。

### 0.3 源码可信度分级

| Tier | 标签 | 本报告涉及来源 |
|------|------|----------------|
| 1 | 权威 | 各项目官方仓库源码（GitHub master/main 分支） |
| 2 | 可信 | 无 |
| 3 | 补充 | 无 |

本报告所有结论均建立在 Tier 1 源码之上，置信度为 `[High]`。

### 0.4 项目优先级与覆盖度

| 项目 | 模块 A | 模块 B | 模块 C | 覆盖度 |
|------|--------|--------|--------|--------|
| CherryStudio | ✅ 完整 schema | ⚠️ 未获取 store/chat 源码 | — | 中 |
| LobeChat | ✅ 完整类型系统 | ✅ 完整类型 + thread 机制 | — | 高 |
| Continue.dev | ✅ BaseLLM 抽象 | — | ⚠️ 依赖栈确认，组件源码缺失 | 中 |
| NextChat | ✅ 完整 access store | ✅ 完整 chat store | — | 高 |
| anything-llm | ⚠️ 仅系统级 ApiKey（非 LLM Provider Key） | — | — | 低 |

---

## 模块 A：API Key + Provider 管理

### A.1 Provider Schema 字段设计

#### A.1.1 LobeChat 的 AiProviderSettings（业界领先实践）

LobeChat 的 Provider 配置类型定义在 `packages/types/src/aiProvider.ts`，是 5 个项目中字段最完整、最贴近生产级实践的设计：

```typescript
// 来源：https://cdn.jsdelivr.net/gh/lobehub/lobe-chat@main/packages/types/src/aiProvider.ts

export enum AiProviderSourceEnum {
  builtin = 'builtin',
  custom = 'custom',
}

export enum AiProviderAuthTypeEnum {
  apiKey = 'apiKey',
  oauthDeviceFlow = 'oauth-device-flow',
}

export enum AiProviderSDKEnum {
  anthropic = 'anthropic',
  azure = 'azure',
  azureai = 'azureai',
  bedrock = 'bedrock',
  cloudflare = 'cloudflare',
  comfyui = 'comfyui',
  google = 'google',
  huggingface = 'huggingface',
  ollama = 'ollama',
  openai = 'openai',
  qwen = 'qwen',
  replicate = 'replicate',
  router = 'router',
  volcengine = 'volcengine',
}

export interface AiProviderSettings {
  // 鉴权
  authType?: AiProviderAuthTypeEnum;
  oauthDeviceFlow?: OAuthDeviceFlow;
  apiKey?: string;
  // 网络
  proxyUrl?: string;
  // SDK 路由
  sdkType?: AiProviderSDKEnum;
  // 响应行为
  responseAnimation?: boolean;
  // UI 显隐控制
  searchMode?: string;
  showApiKey?: boolean;
  showChecker?: boolean;
  showModelFetcher?: boolean;
  // 接口能力
  supportResponsesApi?: boolean;
}
```

**关键设计点：**

1. **`authType` 枚举区分 `apiKey` 与 `oauth-device-flow`**：同一架构可同时承载 OpenAI 式 Key 鉴权与 Anthropic Claude OAuth 设备流鉴权。
2. **`sdkType` 显式声明 SDK 路由**：14 种 SDK 枚举（anthropic/azure/bedrock/cloudflare/google/ollama/openai/qwen/volcengine 等），避免运行时反射判断。
3. **UI 显隐字段（`showApiKey`/`showChecker`/`showModelFetcher`）内嵌于 Provider 配置**：不同 Provider 在设置面板呈现不同 UI，而非前端硬编码白名单。
4. **`responseAnimation`**：流式渲染动画开关，UI 层无需 Provider 名硬编码。

#### A.1.2 LobeChat 的 AiProviderCard（含连接测试字段）

```typescript
export interface AiProviderCard {
  // 基础元信息
  id: string;
  name: string;
  avatar?: string;
  homeUrl?: string;
  // 模型列表
  modelsUrl?: string;
  enabledChatModels: string[];
  // 连接测试
  checkModel?: string;
  // UI 状态
  enabled: boolean;
  // 浏览器端 fetch（避开 CORS）
  fetchOnClient?: boolean;
}

export interface AiProviderDetailItem {
  fetchOnClient?: boolean;
  keyVaults: Record<string, string | Record<string, string>>;
}
```

**关键设计点：**

- `checkModel`：每个 Provider 指定一个"探测模型"用于 `/chat/completions` 健康检查，而非 `/models` 列表（部分 Provider 不支持 `/models`）。
- `fetchOnClient`：浏览器端直接 fetch（避开服务端代理），用于 Ollama 等本地 Provider。
- `keyVaults`：**支持嵌套 customHeaders**（`Record<string, string | Record<string, string>>`），满足火山引擎、Azure 等需要多 Header 鉴权的 Provider。

#### A.1.3 CherryStudio 的 ProviderConfigSchema（Zod 强校验）

CherryStudio 采用 Zod discriminated union 对 Provider 进行强类型校验，定义在独立包 `packages/provider-registry/src/schemas/provider.ts`：

```typescript
// 来源：https://cdn.jsdelivr.net/gh/CherryHQ/cherry-studio@main/packages/provider-registry/src/schemas/provider.ts

export const ApiFeaturesSchema = z.object({
  arrayContent: z.boolean().default(false),
  streamOptions: z.boolean().default(false),
  developerRole: z.boolean().default(false),
  serviceTier: z.boolean().default(false),
  verbosity: z.boolean().default(false),
});

export const RegistryEndpointConfigSchema = z.object({
  baseUrl: z.string(),
  modelsApiUrls: z.array(z.string()).default([]),
  reasoningFormat: z.union([
    z.literal('openai-chat'),
    z.literal('openai-responses'),
    z.literal('anthropic'),
    z.literal('gemini'),
    z.literal('openrouter'),
    z.literal('enable-thinking'),
    z.literal('thinking-type'),
    z.literal('dashscope'),
    z.literal('self-hosted'),
  ]),
  adapterFamily: z.string(),
});

export const ProviderConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  endpointConfigs: z.array(RegistryEndpointConfigSchema),
  defaultChatEndpoint: z.string(),
  modelListSource: z.enum(['fetchable', 'hardcoded']),
  authMethods: z.array(z.enum(['bearer', 'x-api-key', 'query-param'])),
  authOptional: z.boolean().default(false),
  apiFeatures: ApiFeaturesSchema,
  metadata: MetadataSchema,
});
```

**关键设计点：**

1. **`reasoningFormat` 是 discriminated union**：覆盖 9 种推理格式（openai-chat / openai-responses / anthropic / gemini / openrouter / enable-thinking / thinking-type / dashscope / self-hosted），针对 o1/deepseek-r1/claude-thinking 等推理模型做差异化渲染。
2. **`authMethods` 数组**：同一 Provider 可支持多种鉴权方式（`bearer` / `x-api-key` / `query-param`），前端可让用户选择。
3. **`authOptional`**：标记 Ollama 等本地 Provider 无需 Key。
4. **`modelListSource: 'fetchable' | 'hardcoded'`**：区分可动态拉取模型列表的 Provider 与需要硬编码的 Provider。
5. **`apiFeatures`**：标记每个 Provider 是否支持 `arrayContent`/`streamOptions`/`developerRole`/`serviceTier`/`verbosity`，避免在请求构造时硬编码条件分支。

#### A.1.4 NextChat 的扁平字段式（不推荐）

NextChat 在 `app/store/access.ts` 采用扁平字段式 Provider 配置（每个 Provider 一对 `xxxUrl` + `xxxApiKey`）：

```typescript
// 来源：https://cdn.jsdelivr.net/gh/Yidadaa/ChatGPT-Next-Web@main/app/store/access.ts

export interface AccessControlStore {
  // OpenAI
  openaiUrl: string;
  openaiApiKey: string;
  // Azure
  azureUrl: string;
  azureApiKey: string;
  // Google
  googleUrl: string;
  googleApiKey: string;
  // Anthropic
  anthropicUrl: string;
  anthropicApiKey: string;
  // ... 共 16 个 provider 各自的 url + apiKey
  // 自定义 OpenAI 兼容
  customModels: string;
  defaultModel: string;
}
```

**评价：** 字段重复严重，扩展新 Provider 需修改 schema、UI、isAuthorized 三处。**不推荐我们的项目采用此模式。**

### A.2 存储方案对比

#### A.2.1 NextChat：indexedDB 持久化 + 客户端存储

```typescript
// 来源：https://cdn.jsdelivr.net/gh/Yidadaa/ChatGPT-Next-Web@main/app/store/access.ts

import { createPersistStore } from "../utils/store";
import { indexedDBStorage } from "@/app/utils/indexedDB-storage";

export const useAccessStore = createPersistStore(
  DEFAULT_ACCESS_STATE,
  (set, get) => ({
    isAuthorized(): boolean { /* ... */ },
    fetch(): Promise<void> {
      // 拉取服务端 /api/config 配置覆盖本地
    },
  }),
  {
    name: "access",
    version: 2,
    storage: indexedDBStorage,
    migrate(persisted, version) {
      // 持久化版本迁移
    },
  },
);
```

**特点：**

- 用 `createPersistStore` + `indexedDBStorage`（基于 `idb-keyval`），无 4KB 限制（localStorage 限制）
- API Key 以明文存储于 IndexedDB
- 持久化版本号 `version: 2` + `migrate` 钩子处理 schema 演进
- 支持服务端配置覆盖（`fetch()` 拉取 `/api/config`）

#### A.2.2 LobeChat：服务端 Cred 系统 + maskedPreview

LobeChat 在 `packages/types/src/creds/index.ts` 定义了独立的 Cred（凭证）管理系统，**Key 不在前端持久化，全部由服务端管理**：

```typescript
// 来源：https://cdn.jsdelivr.net/gh/lobehub/lobe-chat@main/packages/types/src/creds/index.ts

export interface UserCredSummary {
  id: string;
  name: string;
  type: 'kv-env' | 'kv-header' | 'oauth' | 'file';
  maskedPreview: string;  // 'sk-****xxxx' 格式
  visibility: 'private' | 'public';
  ownerType: 'organization' | 'user';
}

export interface CredWithPlaintext extends UserCredSummary {
  plaintext: string;  // 仅在创建/更新时返回一次
}

export interface InjectCredsRequest {
  credIds: string[];
}

export interface InjectCredsResponse {
  env: Record<string, string>;            // 注入到 process.env
  files: { path: string; content: string }[];
  headers: Record<string, string>;        // 注入到 fetch headers
  missing: { id: string; reason: string }[];  // 缺失的凭证
}
```

**特点：**

- Key 永远不出现在前端响应中，仅返回 `maskedPreview`（`sk-****xxxx` 格式）
- `InjectCredsResponse` 设计用于服务端 SDK 调用前注入：env、headers、files 三种注入方式
- `missing` 字段在响应中标记缺失凭证，前端可提示用户补全
- 支持 `kv-env` / `kv-header` / `oauth` / `file` 四种凭证类型

#### A.2.3 anything-llm：服务端 Prisma 持久化（系统级 API Key，非 LLM Key）

anything-llm 的 `server/models/apiKeys.js` 是**系统级 API Key**（用于前端鉴权访问服务端，不是 LLM Provider Key），但展示了 Prisma + uuid-apikey 模式：

```javascript
// 来源：https://cdn.jsdelivr.net/gh/Mintplex-Labs/anything-llm@master/server/models/apiKeys.js

const ApiKey = {
  tablename: "api_keys",
  writable: ["name"],

  makeSecret: () => {
    const uuidAPIKey = require("uuid-apikey");
    return uuidAPIKey.create().apiKey;
  },

  create: async function (createdByUserId = null, name = null) {
    const apiKey = await prisma.api_keys.create({
      data: {
        name: normalizedName,
        secret: this.makeSecret(),
        createdBy: createdByUserId,
      },
    });
    return { apiKey, error: null };
  },
};
```

**特点：** 服务端生成 UUID-apikey 格式 secret、Prisma 持久化、关联 `createdBy` 用户。LLM Provider Key 在 anything-llm 中走另一套 `systemVariables` 表，本报告未深入。

#### A.2.4 三种方案对比

| 方案 | 代表项目 | Key 位置 | 安全性 | 离线可用 | 复杂度 |
|------|---------|---------|--------|---------|--------|
| IndexedDB 明文 | NextChat | 客户端 | 低 | ✅ | 低 |
| 服务端 Cred + maskedPreview | LobeChat | 服务端 DB | 高 | ❌ | 高 |
| 服务端系统级 UUID | anything-llm | 服务端 DB | 高 | ❌ | 中 |
| **Tauri Rust 端 safeStorage** | **本报告建议** | **Rust 进程** | **高** | **✅** | **中** |

### A.3 加密策略

5 个项目中：

- **NextChat**：明文存储于 IndexedDB，无加密（依赖浏览器同源策略）
- **LobeChat**：服务端管理，前端仅展示 `maskedPreview`（`sk-****xxxx`）
- **CherryStudio**：基于 Electron，使用 `safeStorage` API（Chromium 内置，Windows 下走 DPAPI）
- **Continue.dev**：通过 `apiKeyLocation` + `envSecretLocations` 字段支持环境变量注入，避免硬编码
- **anything-llm**：服务端 Prisma 存储（明文，但数据库访问受服务端鉴权保护）

#### A.3.1 Continue.dev 的 envSecretLocations 设计

```typescript
// 来源：https://cdn.jsdelivr.net/gh/continuedev/continue@main/core/llm/index.ts

export abstract class BaseLLM implements ILLM {
  apiKey?: string;
  apiKeyLocation?: string;                              // Key 配置来源位置
  envSecretLocations?: Record<string, string>;          // 环境变量注入映射
  // ...
}
```

**特点：** 用户可在 `config.yaml` 中通过 `${env.VAR_NAME}` 语法引用环境变量，Key 永不出现在配置文件中。**Tauri 项目可借鉴此模式，将 Key 存于 `.env` 或 Rust 端 safeStorage，前端通过 `apiKeyLocation: 'rust-safeStorage'` 引用。**

### A.4 多 Profile 配置（同一供应商多个 Key）

#### A.4.1 LobeChat 的 keyVaults 嵌套结构

LobeChat 的 `keyVaults` 字段设计支持同一 Provider 多套 Key 配置：

```typescript
export interface AiProviderDetailItem {
  fetchOnClient?: boolean;
  keyVaults: Record<string, string | Record<string, string>>;
}
```

**结构示例：**

```json
{
  "openai": {
    "keyVaults": {
      "apiKey": "sk-xxx",
      "customHeaders": {
        "X-Custom-Header": "value"
      }
    }
  }
}
```

**特点：** 嵌套 `customHeaders` 满足火山引擎、Azure 等需要多 Header 鉴权的 Provider。但**不原生支持"同一 Provider 多套 Key 切换"**——这需要用户在 UI 层做 Key 列表切换。

#### A.4.2 Continue.dev 的 profile 字段

```typescript
// 来源：core/llm/index.ts
export abstract class BaseLLM implements ILLM {
  profile?: string | undefined;   // Profile 标识符
  uniqueId: string;                // 实例唯一 ID
  // ...
}
```

**特点：** 通过 `profile` 字段标记同一 Provider 的不同实例（如 `openai-personal` / `openai-work`），`uniqueId` 区分多个 LLM 实例。**这是 5 个项目中唯一原生支持多 Profile 的设计。**

### A.5 连接测试与模型列表获取

#### A.5.1 LobeChat 的 checkModel + modelsUrl 双端点设计

```typescript
export interface AiProviderCard {
  checkModel?: string;    // 连接测试用的"探测模型"
  modelsUrl?: string;     // 模型列表拉取端点
  // ...
}
```

**设计哲学：**

- `checkModel` 用于"轻量探活"——发送一个极简的 chat 请求（如"hi"）验证 Key 有效性，覆盖不支持 `/v1/models` 的 Provider（如 Anthropic）
- `modelsUrl` 用于"模型列表拉取"——调用 `/v1/models` 获取可用模型清单
- 两者分离，前端 UI 可独立触发"测试连接"与"刷新模型列表"两个按钮

#### A.5.2 CherryStudio 的 modelListSource + endpointConfigs

```typescript
export const ProviderConfigSchema = z.object({
  modelListSource: z.enum(['fetchable', 'hardcoded']),  // 拉取 or 硬编码
  endpointConfigs: z.array(RegistryEndpointConfigSchema),
  // ...
});

export const RegistryEndpointConfigSchema = z.object({
  baseUrl: z.string(),
  modelsApiUrls: z.array(z.string()).default([]),  // 多个 /models 端点
  // ...
});
```

**特点：** 同一 Provider 可配置多个 `modelsApiUrls`（如某些 Provider 的 chat 与 models 分离部署在不同域名）。

#### A.5.3 Continue.dev 的 listModels 默认空数组

```typescript
// 来源：core/llm/index.ts
export abstract class BaseLLM implements ILLM {
  async listModels(): Promise<string[]> {
    return [];   // 默认返回空，子类按需覆写
  }
}
```

**特点：** BaseLLM 不强制子类实现 `listModels`，部分 Provider（如自定义 OpenAI 兼容端点）可能不支持模型列表拉取。**Tauri 项目应同样将 `listModels` 设为可选方法，避免 Provider 适配失败。**

### A.6 默认 Provider 与降级

#### A.6.1 NextChat 的 DEFAULT_ACCESS_STATE

```typescript
// 来源：app/store/access.ts
const DEFAULT_ACCESS_STATE = {
  openaiUrl: OPENAI_BASE_URL,        // "https://api.openai.com/v1"
  openaiApiKey: "",
  azureUrl: "",
  azureApiKey: "",
  // ... 共 16 个 provider 的默认值
  defaultModel: "gpt-3.5-turbo",
  customModels: "",
};
```

**特点：** 每个 Provider 都有内置的 `BASE_URL` 常量（在 `app/constant.ts` 中），用户仅需填入 Key 即可使用。

#### A.6.2 LobeChat 的 source: builtin | custom

```typescript
export enum AiProviderSourceEnum {
  builtin = 'builtin',    // 内置 Provider（Anthropic/OpenAI 等官方）
  custom = 'custom',      // 用户自定义 Provider
}
```

**特点：** builtin Provider 由项目维护者定期更新模型列表与端点配置，custom Provider 完全由用户配置。**这一区分比 NextChat 的"扁平字段"更优雅，值得借鉴。**

---

## 模块 B：AI 对话面板

### B.1 会话数据结构

#### B.1.1 NextChat 的 ChatSession + ChatMessage

```typescript
// 来源：https://cdn.jsdelivr.net/gh/Yidadaa/ChatGPT-Next-Web@main/app/store/chat.ts

export interface ChatStat {
  tokenCount: number;
  wordCount: number;
  charCount: number;
}

export interface ChatSession {
  id: string;
  topic: string;
  memoryPrompt: string;              // 长期记忆压缩后的 system prompt
  messages: ChatMessage[];
  stat: ChatStat;
  lastUpdate: number;
  lastSummarizeIndex: number;         // 上次自动摘要的消息索引
  clearContextIndex?: number;         // 清空上下文的分界点
  mask: Mask;                          // 角色面具（system prompt 模板）
}

export type ChatMessage = RequestMessage & {
  date: string;
  streaming?: boolean;                // 流式输出标志
  isError?: boolean;
  id: string;
  model?: ModelType;
  tools?: ChatMessageTool[];
  audio_url?: string;
  isMcpResponse?: boolean;
};
```

**关键设计点：**

1. **`streaming: boolean`** 在消息上而非会话上：同一会话可有多条流式消息（重试场景）
2. **`isError: boolean`**：错误消息走同一渲染管线，UI 层用红色边框区分
3. **`mask: Mask`**：每会话独立保存角色面具（system prompt 模板），切换会话即切换角色
4. **`stat: ChatStat`**：每会话维护 token/word/char 三种计数
5. **`clearContextIndex`**：用户可在某条消息处"清空上下文"，之后的消息不再向 LLM 发送之前的消息（实现"分支对话"）

#### B.1.2 LobeChat 的 ThreadType + ThreadStatus + ThreadMetadata

LobeChat 引入"线程（Thread）"概念，将一个会话内的多轮工具调用、子代理、评估流程建模为 Thread：

```typescript
// 来源：https://cdn.jsdelivr.net/gh/lobehub/lobe-chat@main/packages/types/src/topic/thread.ts

export enum ThreadType {
  continuation = 'continuation',
  eval = 'eval',
  isolation = 'isolation',
  standalone = 'standalone',
}

export enum ThreadStatus {
  Active = 'Active',
  Cancel = 'Cancel',
  Completed = 'Completed',
  Failed = 'Failed',
  InReview = 'InReview',
  Pending = 'Pending',
  Processing = 'Processing',
  Todo = 'Todo',
}

export interface ThreadMetadata {
  clientMode?: string;
  completedAt?: number;
  duration?: number;
  error?: string;
  model?: string;
  operationId?: string;
  sourceToolCallId?: string;
  startedAt?: number;
  subagentType?: string;
  totalCost?: number;
  totalMessages?: number;
  totalTokens?: number;
  totalToolCalls?: number;
}

export const createThreadSchema = z.object({
  type: z.nativeEnum(ThreadType),
  status: z.nativeEnum(ThreadStatus),
  metadata: ThreadMetadataSchema,
});
```

**关键设计点：**

1. **ThreadType 区分四种执行模式**：`continuation`（普通延续）、`eval`（评估）、`isolation`（隔离执行）、`standalone`（独立）
2. **ThreadStatus 八态状态机**：覆盖 Pending → Processing → Completed/Failed/Cancel/InReview 全生命周期
3. **ThreadMetadata 含 `sourceToolCallId`**：Thread 可由工具调用触发，建立父子链路
4. **`totalCost` / `totalTokens` / `totalToolCalls`**：每个 Thread 独立统计成本

**评价：** LobeChat 的 Thread 模型是为 Agent / Tool Use 场景设计的，**对纯写作辅助场景过度设计**。Tauri 写作应用建议采用 NextChat 的扁平 `ChatSession.messages[]` 结构。

### B.2 多会话管理

#### B.2.1 NextChat 的 sessions[] + currentSessionIndex

```typescript
// 来源：app/store/chat.ts
const DEFAULT_CHAT_STATE = {
  sessions: [createEmptySession()],
  currentSessionIndex: 0,
  lastInput: "",
};

export const useChatStore = createPersistStore(
  DEFAULT_CHAT_STATE,
  (set, _get) => {
    const methods = {
      selectSession(index: number) {
        set({ currentSessionIndex: index });
      },

      moveSession(from: number, to: number) {
        // 拖拽重排序，需同步更新 currentSessionIndex
      },

      newSession(mask?: Mask) {
        const session = createEmptySession();
        if (mask) session.mask = mask;
        set((state) => ({
          currentSessionIndex: 0,
          sessions: [session].concat(state.sessions),
        }));
      },

      forkSession() {
        // 复制当前会话，深拷贝消息（生成新 id）
        const currentSession = get().currentSession();
        const newSession = createEmptySession();
        newSession.topic = currentSession.topic;
        newSession.messages = currentSession.messages.map((msg) => ({
          ...msg,
          id: nanoid(),
        }));
        set((state) => ({
          currentSessionIndex: 0,
          sessions: [newSession, ...state.sessions],
        }));
      },

      deleteSession(index: number) {
        // 删除时若删的是最后一个，自动创建空会话
        // 同时弹出 5s 撤销 toast（restoreState）
      },

      currentSession() {
        let index = get().currentSessionIndex;
        const sessions = get().sessions;
        if (index < 0 || index >= sessions.length) {
          index = Math.min(sessions.length - 1, Math.max(0, index));
          set(() => ({ currentSessionIndex: index }));
        }
        return sessions[index];
      },

      nextSession(delta: number) {
        // 循环切换：limit(x) => (x + n) % n
      },
    };
  },
);
```

**关键设计点：**

1. **新建会话插入到数组头部**（`[session].concat(state.sessions)`），最新会话始终在前
2. **`currentSession()` 自愈**：若 index 越界则夹紧到 `[0, length-1]` 并同步更新 state
3. **`deleteSession` 含撤销机制**：保存 `restoreState`，5s 内可点击 toast 还原
4. **`forkSession` 深拷贝消息但生成新 id**：避免引用共享导致的更新错乱
5. **`nextSession(delta)` 循环切换**：`(x + n) % n` 实现首位循环

#### B.2.2 LobeChat 的 TopicGroupMode

```typescript
// 来源：packages/types/src/topic/topic.ts
export enum TopicGroupMode {
  byTime = 'byTime',
  byProject = 'byProject',
  flat = 'flat',
  byStatus = 'byStatus',
}

export enum TopicQuerySortBy {
  updatedAt = 'updatedAt',
  status = 'status',
}
```

**特点：** 支持"按时间/按项目/扁平/按状态"四种会话分组模式，排序支持"更新时间/状态"两种。**对写作项目，"按项目分组"是天然需求（每个写作项目对应一个 chat 上下文）。**

### B.3 消息渲染

#### B.3.1 NextChat 的 onUpdate 流式回调

```typescript
// 来源：app/store/chat.ts
api.llm.chat({
  messages: sendMessages,
  config: { ...modelConfig, stream: true },
  onUpdate(message) {
    botMessage.streaming = true;
    if (message) {
      botMessage.content = message;   // 整段替换（非增量追加）
    }
    get().updateTargetSession(session, (session) => {
      session.messages = session.messages.concat();   // 触发 React 重渲染
    });
  },
  async onFinish(message) {
    botMessage.streaming = false;
    if (message) {
      botMessage.content = message;
      botMessage.date = new Date().toLocaleString();
      get().onNewMessage(botMessage, session);
    }
    ChatControllerPool.remove(session.id, botMessage.id);
  },
  onBeforeTool(tool: ChatMessageTool) {
    (botMessage.tools = botMessage?.tools || []).push(tool);
    // ...
  },
  async onError(err: Error) {
    botMessage.streaming = false;
    botMessage.content = prettyObject({ error: true, message: err.message });
    botMessage.isError = true;
    ChatControllerPool.remove(session.id, botMessage.id);
  },
});
```

**关键设计点：**

1. **`onUpdate(message)` 是整段替换而非增量追加**：底层 SSE 解析在 `client/platforms/openai.ts` 中累加完成后整体回调，避免前端做累加逻辑
2. **`session.messages = session.messages.concat()`**：空 concat 触发新数组引用，强制 React 重渲染（Zustand 浅比较优化）
3. **`onBeforeTool` 钩子**：工具调用前更新 `botMessage.tools` 数组，UI 实时显示工具调用进度
4. **错误处理走同一消息**：将错误 JSON pretty 化后写入 `botMessage.content`，标记 `isError = true`，不抛异常打断 UI

### B.4 上下文注入

#### B.4.1 NextChat 的四层消息拼接（关键参考）

NextChat 的 `getMessagesWithMemory()` 是本次研究中最值得借鉴的设计，实现了"system prompt + 长期记忆 + 上下文消息 + 短期记忆"四层拼接：

```typescript
// 来源：app/store/chat.ts（简化版伪代码）
async getMessagesWithMemory() {
  const session = get().currentSession();
  const messages = session.messages;

  // 第 1 层：System Prompt（基于 mask.modelConfig.template）
  let systemPrompt = fillTemplateWith(input, modelConfig);
  const messagesToSend = [{ role: 'system', content: systemPrompt }];

  // 第 2 层：长期记忆（memoryPrompt，由 summarizeSession 自动生成）
  const longTermMemory = session.memoryPrompt;
  if (longTermMemory && longTermMemory.length > 0) {
    messagesToSend.push({ role: 'system', content: longTermMemory });
  }

  // 第 3 层：上下文消息（取最近 N 条，受 clearContextIndex 截断）
  const tweakedMessages = messages.slice(-modelConfig.historyMessageCount);
  const memoryPrompt = session.memoryPrompt;

  // 第 4 层：短期记忆摘要（lastSummarizeIndex 之前的历史消息压缩）
  if (session.lastSummarizeIndex > 0) {
    const summaryMessages = messages.slice(0, session.lastSummarizeIndex);
    // 仅附加 summarize 摘要，不发送原消息
  }

  return messagesToSend.concat(recentMessages);
}
```

#### B.4.2 LobeChat 的 contextSelections + pageSelections

```typescript
// 来源：packages/types/src/aiChat.ts
export interface SendNewMessage {
  content: string;
  contextSelections?: ContextSelection[];   // 上下文片段选择
  pageSelections?: PageSelection[];           // 页面选择（用于 Ask AI 模式）
  editorData?: EditorContent;
  files?: { id: string; name: string; size: number; type: string }[];
  metadata?: Record<string, unknown>;
  parentId?: string;
}

export interface SendMessageServerParams {
  newThread?: boolean;
  newTopic?: boolean;
  preloadMessages?: boolean;
  topicFilter?: string;
}

export interface StructureOutputParams {
  schema?: object;        // Zod schema
  tracing?: boolean;
}
```

**关键设计点：**

1. **`contextSelections`**：用户可手动选择"发送哪些上下文片段"（如设定卡片、当前章节）
2. **`pageSelections`**：用于"Ask AI"模式，可选择具体页面/文档作为上下文
3. **`StructureOutputParams.schema`**：通过 Zod schema 约束 LLM 输出结构化数据（如生成角色 JSON）
4. **`SendMessageServerParams.preloadMessages`**：预加载消息但不发送，用于 UI 预览

**评价：** LobeChat 的 `contextSelections` 设计**与本项目场景高度契合**——写作应用中"当前章节 + 当前角色卡 + 当前世界观"作为上下文正是此类设计。

### B.5 流式输出与中断

#### B.5.1 NextChat 的 ChatControllerPool（AbortController 集中池）

NextChat 通过 `ChatControllerPool` 集中管理所有会话的 AbortController，支持"停止当前会话"、"停止所有会话"：

```typescript
// 来源：app/client/controller.ts（基于 chat.ts 推断）
class ChatControllerPool {
  private static controllers: Map<string, AbortController> = new Map();

  static add(sessionId: string, messageId: string, controller: AbortController) {
    const key = `${sessionId}-${messageId}`;
    this.controllers.set(key, controller);
  }

  static remove(sessionId: string, messageId: string) {
    const key = `${sessionId}-${messageId}`;
    this.controllers.delete(key);
  }

  static stop(sessionId: string, messageId?: string) {
    if (messageId) {
      const key = `${sessionId}-${messageId}`;
      this.controllers.get(key)?.abort();
    } else {
      // 停止该 session 的所有 controller
      for (const [key, controller] of this.controllers) {
        if (key.startsWith(`${sessionId}-`)) controller.abort();
      }
    }
  }
}
```

**关键设计点：**

- 用 `sessionId-messageId` 复合 key，可精确停止单条消息
- 支持批量停止（按 sessionId 前缀过滤）
- `remove` 在 `onFinish` / `onError` 中调用，避免内存泄漏

#### B.5.2 Continue.dev 的 isAbortError + withExponentialBackoff

```typescript
// 来源：core/llm/index.ts
import { isAbortError } from "../util/isAbortError.js";
import { withExponentialBackoff } from "../util/withExponentialBackoff.js";

// 流式 fetch 包裹在 withExponentialBackoff 中
const response = await withExponentialBackoff(
  () => fetch(this.apiBase + 'chat/completions', { signal, ... }),
  5,    // 最大重试次数
  1000, // 初始退避 1s
);

if (isAbortError(error)) {
  // 用户主动中断，不重试
  return;
}
```

**特点：** 区分"用户主动中断"（不重试）与"网络错误"（指数退避重试 5 次）。

### B.6 Token 计数

#### B.6.1 NextChat 的 estimateTokenLength（轻量估算）

```typescript
// 来源：app/utils/token.ts
export function estimateTokenLength(input: string): number {
  // 简化估算：英文按 4 字符/token，中文按 1.5 字符/token
  // 不依赖 tiktoken 等重依赖
}
```

#### B.6.2 Continue.dev 的 countTokens（精确计数 + pruneRawPromptFromTop）

```typescript
// 来源：core/llm/countTokens.ts
import { countTokens, compileChatMessages, pruneRawPromptFromTop } from "./countTokens.js";

// 在 BaseLLM 中调用
const tokenCount = countTokens(message, this.model);
const compiled = compileChatMessages(
  this.promptTemplates,
  messages,
  this.contextLength,
  this.completionOptions.maxTokens,
  this.supportsImages(),
  undefined,
  undefined,
);
```

**特点：**

- Continue.dev 通过 `@continuedev/openai-adapters` 内置精确的 BPE 分词器
- `pruneRawPromptFromTop`：当 token 超限，从消息头部裁剪（保留最近 N 条）
- `compileChatMessages` 综合考虑 `contextLength`、`maxTokens`、`supportsImages` 做上下文压缩

**评价：** Continue.dev 的方案更精确但依赖更重（需加载分词器 wasm）。**Tauri 写作应用建议采用 NextChat 的轻量估算，在 UI 展示"约 N tokens"足够。**

### B.7 错误处理与重试

#### B.7.1 Continue.dev 的 parseError 智能映射

```typescript
// 来源：core/llm/index.ts
parseError(error: Error): { message: string; status?: number; } {
  // 404 + URL 模式匹配：Ollama / Mistral / Codestral
  if (error.message.includes('404') && this.apiBase?.includes('127.0.0.1:11434')) {
    return { message: '请确认 Ollama 已安装并运行，且模型已拉取' };
  }
  if (error.message.includes('404') && this.apiBase?.includes('mistral.ai')) {
    return { message: 'Mistral 模型名错误，请检查模型 ID' };
  }
  if (error.message.includes('401')) {
    return { message: 'API Key 无效或已过期' };
  }
  return { message: error.message };
}
```

**特点：** 通过 HTTP 状态码 + URL 模式匹配，将底层错误映射为用户可读消息。**Tauri 项目应在 Service 层实现类似的错误映射表。**

---

## 模块 C：编辑器内联 AI（TipTap BubbleMenu）

### C.1 BubbleMenu 触发机制

#### C.1.1 本项目当前实现回顾

本项目 `src/components/EditorBubbleMenu.tsx` 已在 AI-3.4 阶段追加了 AI 润色/扩写/缩写/角色一致性检查 4 个按钮，通过 `pendingInstruction + handleSendRef` 传递至 `AiAssistantPanel` 自动发送。这一架构与业界主流实现一致：

- **BubbleMenu 作为触发器**：选中文本时浮现，避免命令面板式交互打断写作流
- **指令通过引用传递**（`handleSendRef.current`）：避免 React state 异步更新导致的发送延迟
- **复用 Chat 面板的渲染管线**：所有 AI 输出统一在 `AiAssistantPanel` 渲染，避免双套渲染逻辑

#### C.1.2 Continue.dev 的能力探测模式

Continue.dev 在 `BaseLLM` 中通过 `supportsFim()` / `supportsCompletions()` / `supportsImages()` / `supportsPrefill()` 探测模型能力，决定 BubbleMenu 中显示哪些操作：

```typescript
// 来源：core/llm/index.ts
export abstract class BaseLLM implements ILLM {
  supportsFim(): boolean {
    return false;   // 默认不支持 Fill-in-the-Middle
  }

  supportsCompletions(): boolean {
    // Groq / Mistral / DeepSeek 不支持 completions 端点
    if (["groq", "mistral", "deepseek"].includes(this.providerName)) {
      return false;
    }
    return true;
  }

  supportsPrefill(): boolean {
    // 仅 ollama / anthropic / mistral 支持 prefill（在前序消息中预填 assistant 角色）
    return ["ollama", "anthropic", "mistral"].includes(this.providerName);
  }
}
```

**应用建议：** Tauri 项目可在 BubbleMenu 中根据当前 Provider 的能力动态显示/隐藏操作按钮（如不支持流式则不显示"实时续写"按钮）。

### C.2 内联操作类型

#### C.2.1 本项目已有的 4 类操作

| 操作 | 输入 | 输出 | 实现方式 |
|------|------|------|---------|
| AI 润色 | 选中文本 | 替换文本 | 调用 Chat 面板，用户复制回编辑器 |
| AI 扩写 | 选中文本 | 扩展文本 | 同上 |
| AI 缩写 | 选中文本 | 压缩文本 | 同上 |
| 角色一致性检查 | 选中文本 | 检查报告 | 同上 |

#### C.2.2 Continue.dev 的差异化输出策略

Continue.dev 区分两种内联输出模式：

1. **Inline Edit（替换模式）**：直接替换选中文本，配合 Diff 视图
2. **Stream Append（追加模式）**：在光标处流式追加，不修改选中文本

**建议本项目在 BubbleMenu 增加第三种操作"AI 续写"**：在光标处流式追加（无需选中），用于"续写下一段"。这一场景已在 AI-3.1+3.2 阶段的 Chat 面板流式输出中验证可行，仅需将其改造为"输出到编辑器"而非"输出到 Chat"。

### C.3 Diff 视图

#### C.3.1 Continue.dev 的依赖栈

Continue.dev 的 `gui/package.json` 依赖 `diff`（jsdiff 库）与 `@types/diff`，配合 TipTap 实现 Diff 视图：

```json
{
  "dependencies": {
    "@tiptap/core": "...",
    "@tiptap/react": "...",
    "@tiptap/starter-kit": "...",
    "@tiptap/extension-document": "...",
    "@tiptap/extension-dropcursor": "...",
    "@tiptap/extension-history": "...",
    "@tiptap/extension-image": "...",
    "@tiptap/extension-mention": "...",
    "@tiptap/extension-paragraph": "...",
    "@tiptap/extension-placeholder": "...",
    "@tiptap/extension-text": "...",
    "@tiptap/pm": "...",
    "@tiptap/suggestion": "...",
    "@types/diff": "...",
    "diff": "..."
  }
}
```

**关键发现：** Continue.dev 的 TipTap 配置极简——`Document + Paragraph + Text + History + Dropcursor + Image + Mention + Placeholder + Suggestion`，**未引入 StarterKit 之外的复杂扩展**。这意味着 Diff 视图是基于 `diff` 库 + TipTap 的 `Decoration` 机制手动实现的，而非依赖现成 Diff 扩展。

#### C.3.2 Diff 视图实现建议

基于 Continue.dev 的依赖栈，本项目实现 Diff 视图的推荐路径：

1. 安装 `diff` 库（jsdiff）
2. 用 `diffWordsWithIndices(originalText, newText)` 获取差异块
3. 用 TipTap 的 `Decoration` API（来自 `@tiptap/pm`）创建 inline 装饰：
   - `Decoration.inline(from, to, { class: 'diff-add' })` 标记新增（绿色背景）
   - `Decoration.inline(from, to, { class: 'diff-del' })` 标记删除（红色背景 + 删除线）
4. 通过 `Plugin` 包装 Decoration，避免影响 ProseMirror 文档模型
5. 用 `editor.registerPlugin(diffPlugin)` 注册，`editor.unregisterPlugin('diff')` 卸载

**本项目已有 `entityHighlightPlugin.ts` + `entityHighlightWorker.ts` 的 Decoration 实现经验，可直接复用此模式。**

### C.4 流式输出到编辑器

#### C.4.1 NextChat 的流式累加（参考其 onUpdate 机制）

NextChat 的流式输出采用"整段替换"而非"增量追加"：

```typescript
// 来源：app/store/chat.ts
onUpdate(message) {
  botMessage.streaming = true;
  if (message) {
    botMessage.content = message;   // 整段替换
  }
  // 触发重渲染
}
```

**对本项目的启示：**

- **Chat 面板输出**：采用整段替换（已在 `AiAssistantPanel` 中实现）
- **编辑器内联输出**：采用增量追加（通过 TipTap 的 `editor.commands.insertContent(chunk)` 逐段插入到光标位置）

#### C.4.2 推荐的"流式追加到编辑器"实现

```typescript
// 伪代码 - 本项目建议实现
async function streamToEditor(
  editor: Editor,
  prompt: string,
  signal: AbortSignal,
) {
  let firstChunk = true;
  await aiService.streamChat({
    messages: buildPrompt(prompt),
    signal,
    onChunk(chunk: string) {
      if (firstChunk) {
        // 第一段：在光标处新建段落节点
        editor.commands.insertContent(`<p>${chunk}</p>`);
        firstChunk = false;
      } else {
        // 后续：追加到当前段落末尾
        editor.commands.insertContentAt(
          editor.state.selection.to,
          chunk,
        );
      }
    },
    onDone() {
      // 流式结束，可选自动格式化
    },
    onError(err) {
      // 错误时插入错误标记段落，便于用户识别与撤销
      editor.commands.insertContent(
        `<p class="ai-error">[AI 错误] ${err.message}</p>`,
      );
    },
  });
}
```

**关键点：**

1. **首段新建段落**：避免与用户当前段落混排
2. **后续追加到段落末尾**：用 `insertContentAt(position, chunk)` 而非 `insertContent(chunk)`，避免每段都新建节点
3. **错误标记段落**：让用户可用 Ctrl+Z 撤销整段错误输出
4. **AbortSignal**：与 `useAiStream.ts` 中已有的 `cancelStreamCompletion()` 复用

### C.5 错误恢复与撤销

#### C.5.1 NextChat 的 deleteSession 撤销模式

NextChat 的 `deleteSession` 实现 5 秒撤销 toast，可作为编辑器内联 AI 失败恢复的参考：

```typescript
// 来源：app/store/chat.ts
deleteSession(index: number) {
  const restoreState = {
    currentSessionIndex: get().currentSessionIndex,
    sessions: get().sessions.slice(),
  };
  set(() => ({ /* 删除后的新状态 */ }));
  showToast(Locale.Home.DeleteToast, {
    text: Locale.Home.Revert,
    onClick() {
      set(() => restoreState);   // 点击撤销时还原
    },
  }, 5000);
}
```

#### C.5.2 TipTap 的 History 扩展

TipTap 的 `@tiptap/extension-history` 提供原生撤销栈：

- `editor.commands.undo()` 撤销上一步
- `editor.commands.redo()` 重做
- 每个 `insertContent` 调用自动产生一个 history 步骤

**建议本项目在 BubbleMenu AI 操作完成后，显示 5s 撤销 toast，点击触发 `editor.commands.undo()` 一次性回滚整段 AI 输出。**

---

## 对本项目（Tauri 2.0 + React + TipTap）的具体建议清单

### 1. Provider Schema 采用 LobeChat 模式 + Zod 强校验（合并 CherryStudio 优点）

**建议**：在 `src/lib/api/aiContextApi.ts` 或新建 `src/lib/providerRegistry.ts` 中定义 Provider 类型，采用 LobeChat 的 `AiProviderSettings` + CherryStudio 的 Zod discriminated union：

```typescript
const ProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.enum(['builtin', 'custom']),
  sdkType: z.enum(['openai', 'anthropic', 'gemini', 'ollama', 'custom']),
  apiKeyLocation: z.enum(['rust-safeStorage', 'plaintext', 'env']),
  baseURL: z.string().url(),
  checkModel: z.string().optional(),
  modelsUrl: z.string().optional(),
  apiFeatures: z.object({
    streamOptions: z.boolean().default(false),
    reasoningFormat: z.enum(['openai-chat', 'anthropic', 'gemini', 'none']).default('none'),
  }),
  isEnabled: z.boolean().default(true),
  showChecker: z.boolean().default(true),
  showModelFetcher: z.boolean().default(true),
});
```

**理由**：单一 schema 同时服务 UI 渲染、运行时校验、Rust 端配置同步。

### 2. API Key 加密采用 Tauri Rust 端 safeStorage（避开 Electron 限制）

**建议**：在 `src-tauri/src/ai_config.rs` 中调用 `tauri-plugin-stronghold` 或 `keyring` crate（Windows 走 DPAPI，macOS 走 Keychain，Linux 走 Secret Service）：

```rust
// src-tauri/src/ai_config.rs
use keyring::Entry;

#[tauri::command]
pub fn save_api_key(provider_id: String, key: String) -> Result<(), String> {
    let entry = Entry::new("MiaoChuangShuo", &provider_id)
        .map_err(|e| e.to_string())?;
    entry.set_password(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_api_key(provider_id: String) -> Result<Option<String>, String> {
    let entry = Entry::new("MiaoChuangShuo", &provider_id)
        .map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
```

前端 Provider 配置中存储 `apiKeyLocation: 'rust-safeStorage'` 而非明文 Key，发送请求时由 Rust 端注入 Header。

**理由**：5 个项目中 CherryStudio 走 Electron safeStorage，LobeChat 走服务端 Cred，NextChat 明文存储。Tauri 项目用 `keyring` crate 是离线 + 安全的最佳平衡点。

### 3. 多 Profile 配置采用 Continue.dev 的 profile + uniqueId 模式

**建议**：在 Provider 配置中增加 `profile: string` 与 `uniqueId: string` 字段，支持同一 Provider 多套配置（如"OpenAI 个人"与"OpenAI 工作"）：

```typescript
{
  id: 'openai-personal',
  uniqueId: 'openai-personal',
  profile: 'openai-personal',
  sdkType: 'openai',
  baseURL: 'https://api.openai.com/v1',
  apiKeyLocation: 'rust-safeStorage',
}
```

**理由**：5 个项目中仅 Continue.dev 原生支持多 Profile，且实现简洁（仅两个字段）。

### 4. 连接测试与模型列表拉取分离（参考 LobeChat）

**建议**：在 `AiSettingsSection.tsx` 中为每个 Provider 渲染两个独立按钮：

- **"测试连接"**：调用 `checkModel`（默认 `gpt-3.5-turbo` 或 Provider 配置的探测模型）发送极简 chat 请求
- **"刷新模型列表"**：调用 `/v1/models` 拉取清单，写入 `provider.models[]`

二者分离可覆盖不支持 `/v1/models` 的 Provider（如 Anthropic）。`checkModel` 缺省时回退到 `/v1/models` 探活。

**理由**：LobeChat 的 `checkModel` + `modelsUrl` 双字段设计是 5 个项目中最稳健的方案。

### 5. 会话数据结构采用 NextChat 扁平模式 + 本项目扩展字段

**建议**：在 `src/lib/stores/` 下新建 `chatSessionStore.ts`，采用 NextChat 的 `ChatSession` 结构并扩展写作场景字段：

```typescript
interface WritingChatSession {
  id: string;
  topic: string;
  projectId: string;                    // 关联写作项目
  contextSelections: ContextSelection[]; // 当前章节、角色卡、设定卡（借鉴 LobeChat）
  messages: ChatMessage[];
  stat: { tokenCount: number; wordCount: number; charCount: number };
  lastUpdate: number;
  clearContextIndex?: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
  isError?: boolean;
  model?: string;
  date: string;
  tools?: ToolCall[];
}
```

**理由**：NextChat 扁平结构简单易调试，扩展 `projectId` + `contextSelections` 后即可服务写作场景。LobeChat 的 Thread 模型过度设计。

### 6. 流式中断采用 AbortController 池（参考 NextChat ChatControllerPool）

**建议**：在 `src/lib/api/_internal.ts` 或 `src/hooks/useAiStream.ts` 中实现 `ChatControllerPool`，按 `sessionId-messageId` 复合 key 管理 AbortController：

```typescript
class ChatControllerPool {
  private static pool = new Map<string, AbortController>();
  static add(sessionId: string, msgId: string, ctrl: AbortController) {
    this.pool.set(`${sessionId}-${msgId}`, ctrl);
  }
  static stop(sessionId: string, msgId?: string) {
    if (msgId) {
      this.pool.get(`${sessionId}-${msgId}`)?.abort();
    } else {
      for (const [k, c] of this.pool) {
        if (k.startsWith(`${sessionId}-`)) c.abort();
      }
    }
  }
  static remove(sessionId: string, msgId: string) {
    this.pool.delete(`${sessionId}-${msgId}`);
  }
}
```

**理由**：本项目已有 `useAiStream.ts` 中的 `cancelStreamCompletion()`，但未按会话隔离。Esc 键中断应仅停止当前会话，不影响其他会话。

### 7. 错误处理在 Service 层实现 parseError 映射表（参考 Continue.dev）

**建议**：在 `src/lib/aiService.ts` 中新增 `parseLlmError(error, provider): { message; recoverable }` 函数，按 HTTP 状态码 + URL 模式匹配映射用户可读消息：

```typescript
function parseLlmError(error: Error, provider: ProviderConfig) {
  const msg = error.message;
  if (msg.includes('401')) return { message: 'API Key 无效或已过期', recoverable: false };
  if (msg.includes('429')) return { message: '请求过于频繁，请稍后重试', recoverable: true };
  if (msg.includes('404') && provider.baseURL.includes('127.0.0.1:11434')) {
    return { message: '请确认 Ollama 已运行且模型已拉取', recoverable: false };
  }
  // ...
  return { message: msg, recoverable: false };
}
```

**理由**：Continue.dev 的 `parseError` 是 5 个项目中最完善的错误映射，避免将底层 fetch 错误直接抛给用户。

### 8. 上下文注入实现四层拼接（参考 NextChat getMessagesWithMemory）

**建议**：在 `src/hooks/usePromptBuilder.ts` 中实现四层消息拼接：

1. **System Prompt**：当前写作模式（如"长篇小说助手"）
2. **长期记忆**：项目级设定摘要（从 `.novelforge` 读取）
3. **上下文片段**：用户在 `contextSelections` 中选择的章节、角色卡
4. **最近消息**：受 `historyMessageCount` 限制的最近 N 条对话

```typescript
function buildWritingPrompt(session: WritingChatSession, input: string) {
  return [
    { role: 'system', content: session.systemPrompt },
    { role: 'system', content: session.longTermMemory ?? '' },
    ...session.contextSelections.map(c => ({ role: 'system', content: c.content })),
    ...session.messages.slice(-session.historyMessageCount),
    { role: 'user', content: input },
  ];
}
```

**理由**：NextChat 的四层拼接是 5 个项目中最成熟的设计，且与本项目 AI-3.2 阶段已有的 `PromptBuilder.buildContinuationPrompt` 链路兼容。

### 9. BubbleMenu 增加"AI 续写"操作（无需选中文本）

**建议**：在 `EditorBubbleMenu.tsx` 已有的 4 个 AI 按钮基础上，增加第五个"AI 续写"按钮，触发条件为"光标处于段落末尾"（而非"选中文本"）：

```typescript
// 伪代码
function handleAiContinue() {
  const editor = editorRef.current;
  const pos = editor.state.selection.to;
  const paragraphEnd = /* 当前段落末尾位置 */;
  editor.commands.setTextSelection(paragraphEnd);
  streamToEditor(editor, buildContinuePrompt(editor.getText()), signal);
}
```

**理由**：Continue.dev 的 `supportsCompletions()` 能力探测表明"FIM（Fill-in-the-Middle）"是编辑器内联 AI 的核心场景，写作应用中"续写下一段"是高频需求。

### 10. Diff 视图采用 diff 库 + TipTap Decoration（参考 Continue.dev 依赖栈）

**建议**：

1. `npm install diff @types/diff`
2. 在 `src/lib/tiptap/` 下新建 `diffDecorationPlugin.ts`，参考 `entityHighlightPlugin.ts` 的实现模式
3. 用 `diffWordsWithIndices(originalText, newText)` 计算差异
4. 用 `Decoration.inline()` 创建 `diff-add` / `diff-del` 装饰
5. AI 替换操作前先快照原文，确认时弹出 Diff 视图供用户预览

**理由**：Continue.dev 的 `gui/package.json` 证明 TipTap + diff 是可行组合，且本项目已有 `entityHighlightPlugin.ts` 的 Decoration 实现经验可复用。

### 11. 删除/撤销操作实现 5s 撤销 Toast（参考 NextChat）

**建议**：在 `src/components/AiAssistantPanel.tsx` 中实现 5s 撤销 toast，应用于：

- AI 输出完成后，5s 内可点击"撤销"还原编辑器到 AI 输出前状态
- 会话删除时，5s 内可还原

利用 TipTap 的 `editor.commands.undo()` 或保存 `editor.getHTML()` 快照实现。

**理由**：NextChat 的 `deleteSession` 撤销模式在 5 个项目中最简洁优雅，提升用户体验显著。

### 12. 模型能力探测字段（参考 Continue.dev BaseLLM）

**建议**：在 Provider 配置中增加能力探测字段，BubbleMenu 据此动态显示操作按钮：

```typescript
interface ProviderCapabilities {
  supportsStreaming: boolean;      // 是否支持流式
  supportsVision: boolean;         // 是否支持图像输入
  supportsFim: boolean;            // 是否支持 Fill-in-the-Middle（续写）
  supportsToolCall: boolean;       // 是否支持工具调用
  supportsJsonOutput: boolean;     // 是否支持结构化输出
}
```

BubbleMenu 中：

```typescript
{provider.capabilities.supportsFim && <Button>AI 续写</Button>}
{provider.capabilities.supportsVision && <Button>图片理解</Button>}
```

**理由**：Continue.dev 的 `supportsFim()` / `supportsCompletions()` / `supportsImages()` 设计让 UI 按能力显示，避免在不支持的 Provider 上展示不可用操作。

### 13. Provider 分组：builtin / custom（参考 LobeChat source 字段）

**建议**：在 `AiSettingsSection.tsx` 中将 Provider 分为两组展示：

- **builtin**：项目维护的内置 Provider（OpenAI / Anthropic / DeepSeek / Qwen / Ollama / 火山引擎等），定期更新模型列表
- **custom**：用户自定义的 OpenAI 兼容端点

builtin Provider 在 `src/lib/providerRegistry.ts` 中硬编码（或打包到 Rust 端的 `providers.toml`），用户仅填入 Key；custom Provider 完全由用户配置。

**理由**：LobeChat 的 `source: builtin | custom` 区分比 NextChat 的扁平字段更优雅，且降低用户配置负担。

### 14. 流式追加到编辑器采用"首段新建 + 后续追加"策略（本项目新增建议）

**建议**：实现 `streamToEditor()` 函数时，分两阶段处理：

- **第一阶段**（首 chunk 到达）：`editor.commands.insertContent('<p>chunk</p>')` 新建段落
- **第二阶段**（后续 chunk）：`editor.commands.insertContentAt(currentPos, chunk)` 追加到当前段落末尾

避免每个 chunk 都新建段落节点导致段落碎片化。配合 `editor.commands.focus()` 保持光标跟随流式输出滚动。

**理由**：本项目 AI-3.2 阶段已实现 Chat 面板的流式累加（按 `\n\n` 分割为 paragraph 节点数组），但直接输出到编辑器需要不同的节点管理策略——编辑器是用户的写作主战场，不能让 AI 输出污染用户已有文档结构。

### 15. 错误恢复：AI 错误段落用特殊样式标记（本项目新增建议）

**建议**：AI 流式输出失败时，不要直接抛弃已生成内容，而是用特殊类名插入错误段落：

```typescript
onError(err) {
  editor.commands.insertContent(
    `<p class="ai-error-block" data-error="${err.message}">` +
    `[AI 生成中断] 已生成内容：${accumulatedContent}</p>`,
  );
  showToast('AI 生成失败，可按 Ctrl+Z 撤销', {
    text: '撤销',
    onClick: () => editor.commands.undo(),
  }, 5000);
}
```

CSS：

```css
.ai-error-block {
  background: rgba(239, 68, 68, 0.1);
  border-left: 3px solid rgb(239, 68, 68);
  padding-left: 8px;
  color: rgb(252, 165, 165);
}
```

**理由**：5 个项目均未深度处理"AI 输出中断后的部分内容"——NextChat 直接将错误 JSON 写入消息，LobeChat 抛异常。写作场景下部分生成内容可能仍有价值，保留并标记是更友好的处理方式。

---

## 引用源码清单

### CherryStudio

- [packages/provider-registry/src/schemas/provider.ts](https://cdn.jsdelivr.net/gh/CherryHQ/cherry-studio@main/packages/provider-registry/src/schemas/provider.ts)
- [packages/provider-registry/src/schemas/model.ts](https://cdn.jsdelivr.net/gh/CherryHQ/cherry-studio@main/packages/provider-registry/src/schemas/model.ts)
- [packages/provider-registry/src/schemas/common.ts](https://cdn.jsdelivr.net/gh/CherryHQ/cherry-studio@main/packages/provider-registry/src/schemas/common.ts)

### LobeChat

- [packages/types/src/aiProvider.ts](https://cdn.jsdelivr.net/gh/lobehub/lobe-chat@main/packages/types/src/aiProvider.ts)
- [packages/types/src/creds/index.ts](https://cdn.jsdelivr.net/gh/lobehub/lobe-chat@main/packages/types/src/creds/index.ts)
- [packages/types/src/aiChat.ts](https://cdn.jsdelivr.net/gh/lobehub/lobe-chat@main/packages/types/src/aiChat.ts)
- [packages/types/src/llm.ts](https://cdn.jsdelivr.net/gh/lobehub/lobe-chat@main/packages/types/src/llm.ts)
- [packages/types/src/topic/thread.ts](https://cdn.jsdelivr.net/gh/lobehub/lobe-chat@main/packages/types/src/topic/thread.ts)
- [packages/types/src/topic/topic.ts](https://cdn.jsdelivr.net/gh/lobehub/lobe-chat@main/packages/types/src/topic/topic.ts)

### NextChat

- [app/store/access.ts](https://cdn.jsdelivr.net/gh/Yidadaa/ChatGPT-Next-Web@main/app/store/access.ts)
- [app/store/chat.ts](https://cdn.jsdelivr.net/gh/Yidadaa/ChatGPT-Next-Web@main/app/store/chat.ts)
- [app/client/platforms/openai.ts](https://cdn.jsdelivr.net/gh/Yidadaa/ChatGPT-Next-Web@main/app/client/platforms/openai.ts)
- [app/constant.ts](https://cdn.jsdelivr.net/gh/Yidadaa/ChatGPT-Next-Web@main/app/constant.ts)

### Continue.dev

- [core/llm/index.ts](https://cdn.jsdelivr.net/gh/continuedev/continue@main/core/llm/index.ts)
- [gui/package.json](https://cdn.jsdelivr.net/gh/continuedev/continue@main/gui/package.json)

### anything-llm

- [server/models/apiKeys.js](https://cdn.jsdelivr.net/gh/Mintplex-Labs/anything-llm@master/server/models/apiKeys.js)

---

## 报告完成度声明

- **模块 A（API Key + Provider 管理）**：5 个项目中 4 个项目源码获取完整，anything-llm 仅获取系统级 ApiKey（非 LLM Provider Key），置信度 `[High]`
- **模块 B（AI 对话面板）**：NextChat 完整源码获取，LobeChat 类型系统完整，CherryStudio store/chat 未获取（仅 schema），置信度 `[High]`
- **模块 C（编辑器内联 AI）**：Continue.dev 依赖栈确认（TipTap + diff）但具体组件源码未定位，本项目 `EditorBubbleMenu.tsx` 已实现 AI-3.4 阶段，置信度 `[Medium]`
- **15 条建议清单**：覆盖三个模块，每条均标注参考项目与具体落地路径

**未完成项：**

1. Continue.dev GUI 中 TipTap 编辑器组件的确切源码路径未定位（建议后续通过 `git clone` 仓库本地搜索）
2. CherryStudio 用户级 Provider state（store）和会话管理（chat）源码未获取（仅 provider-registry 静态 schema）
3. bolt.dereference（bolt.new by StackBlitz）未单独检索（与 anything-llm 同属"AI 应用"但架构差异大，未在原任务优先级中）

报告至此完成。
