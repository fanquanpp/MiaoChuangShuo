# 深度研究报告：国内外大厂 AI 编辑器/智能体「用户自主添加 AI API Key」交互逻辑与功能设计

> 生成日期：2026-07-15 | 研究深度：standard | 来源数：30+ | 报告语言：中文
> 目标读者：Tauri 桌面 AI 写作应用的产品/研发团队

---

## TL;DR

开源桌面客户端（CherryStudio、LobeChat、NextChat、ChatBox）在「用户自主添加 API Key」的交互成熟度上已显著领先闭源大厂编辑器（Cursor、Windsurf、JetBrains AI Assistant、GitHub Copilot）。开源阵营普遍采用「Provider 列表 + Key + BaseURL + 模型列表 + 连通性检查 + 启用开关」的六件套范式，并支持多 Key 轮询、OpenAI 兼容协议、本地加密存储；而闭源大厂多将 BYOK（Bring Your Own Key）作为订阅制的补充，甚至（如 GitHub Copilot）官方明确表示"可预见的未来不会开放"自定义端点给个人版。对于我们的 Tauri 桌面写作应用，应直接借鉴 CherryStudio / LobeChat 的 Provider 体系，配合 Tauri 的 `tauri_plugin_secure_storage`（或 Electron 的 `safeStorage`）做系统级钥匙串存储，并将 DeepSeek、硅基流动、Moonshot 等国内供应商作为默认推荐模板预置。

---

## Executive Summary

本研究系统检索了 10 类产品（含 4 款闭源大厂编辑器、5 款开源客户端/插件、1 类企业协作 AI）的 API Key 管理设计文档与社区实践，得出以下核心结论：

1. **OpenAI 兼容协议已成为事实标准**：几乎所有支持 BYOK 的产品都以「OpenAI 兼容 `/v1/chat/completions`」作为最低门槛，DeepSeek、Moonshot、SiliconFlow、Ollama、OpenRouter 均原生兼容。CherryStudio 进一步区分了 OpenAI / Anthropic / Gemini / Bedrock / Azure / 本地推理 / 特殊网关七类协议。
2. **「连通性检查（Test Connection）」是开源客户端的标配**：CherryStudio、LobeChat 均在 Key 输入框旁提供检查按钮；闭源编辑器（Cursor、Windsurf）则无显式测试按钮，依赖首次调用失败反馈。
3. **多 Key 轮询是国产客户端的差异化能力**：CherryStudio 支持单服务商多 Key 英文逗号分隔、从前到后循环轮询，这对写作类应用应对配额限制极具参考价值。
4. **本地存储方式分化明显**：Tauri 阵营推荐 `tauri_plugin_secure_storage`（调用系统 Keychain/Credential Manager），Electron 阵营用 `safeStorage`（Windows DPAPI / macOS Keychain / Linux libsecret），NextChat Tauri 版在 v2.15.4 起改用 Tauri 原生 fetch 以避免 Key 暴露到 WebView。
5. **国内供应商（尤其 DeepSeek、硅基流动）已被预置为默认推荐**：CherryStudio 内置 60+ Provider 模板，DeepSeek、硅基流动、阿里云百炼、火山引擎、PPIO、无问芯穹等国产供应商均在内置列表中，开箱即用。
6. **企业协作 AI（飞书 Aily、Notion AI、钉钉 AI）BYOK 受限**：飞书 Aily 支持企业自定义模型接入（必须 OpenAI 兼容），但需企业管理员操作；Notion AI / 钉钉 AI 主要依赖官方模型池，个人用户无法自主添加 Key。

---

## 1. Cursor 编辑器 [置信度：High]

### 1.1 API Key 添加/编辑/删除 UI 流程
Cursor 的 BYOK 入口固定位于 `Settings → Models` 面板，采用「开关 + 输入框」的扁平结构，不支持多 Profile 并存，仅支持单一 OpenAI 兼容端点覆盖。

操作流程（基于实际配置教程）：
1. 打开右上角齿轮 → `Cursor Settings` → `Models`
2. 找到 `OpenAI API Key`，点击右侧开关启用
3. 粘贴 API Key
4. 开启 `Override OpenAI Base URL` 开关
5. 填入兼容端点（如 `https://api.deepseek.com`、`https://api.openrouter.com/v1`）
6. 点击 `Add Model` 手动添加模型名（如 `deepseek-chat`、`deepseek-reasoner`）

> 来源：[CSDN - Cursor 接入 DeepSeek 完整教程](https://blog.csdn.net/weixin_40970718/article/details/160418856)｜[掘金 - Cursor 接入 DeepSeek-V3](https://juejin.cn/post/7460322919504150591)｜[CSDN - 多模型配置指南](https://blog.csdn.net/an845410111/article/details/159882730)

### 1.2 连接测试（Test Connection）
**不提供显式测试按钮**。用户需通过发起一次 Chat 或 Composer 请求，由请求成功/失败反向验证。错误信息常见为 `Invalid OpenAI API Key`（400 状态码），多因模型名拼写错误或 Base URL 与 Key 不匹配。

> 来源：[CSDN文库 - cursor添加deepseek报错invalid openai key](https://wenku.csdn.net/answer/4i1v35thx1)

### 1.3 Key 本地存储方式
Cursor 官方文档未公开 Key 的本地存储细节。已知 Cursor 通过 SOC 2 Type II 审计，提供 Privacy Mode（零数据保留）模式，并支持 SSO/SCIM 2.0 与 MDM 部署。BYOK 模式下 Key 仅在本地使用、不发送到 Cursor 云端（与默认订阅模型池路由不同）。

> 来源：[头条 - Cursor 安全漏洞与审计机制](http://m.toutiao.com/group/7662617395571327522/)

### 1.4 BaseURL 自定义
**支持**，通过 `Override OpenAI Base URL` 开关。这是国内用户接入 DeepSeek、Moonshot、SiliconFlow、OpenRouter 的核心通道。

### 1.5 默认推荐供应商呈现
Cursor 默认推荐其自有模型池（Claude 4.6 Opus/Sonnet、Composer 2、Gemini 3.1 Pro、GPT-5.3 Codex、GPT-5.4、Grok 4.20），BYOK 入口位于次要位置，DeepSeek 等国产模型不在默认列表，需用户手动添加。

> 来源：[Cursor 官方文档](https://cursor.com/cn/docs)

### 1.6 多供应商切换 UI
默认模型池通过下拉选择；BYOK 模式下不支持多个自定义端点并存，用户若需在多个第三方供应商间切换，需手动修改 Base URL 与 Key。

### 1.7 模型选择联动
**无联动**。用户在 `Add Model` 中手动填写模型名，Cursor 不会从供应商拉取模型列表。

### 1.8 错误处理与重试
错误以 Toast/状态栏形式提示，常见文案 `Invalid OpenAI API Key`、`400 Bad Request`。无自动重试机制。

### 1.9 余额/配额查询
**不支持**。

### 1.10 Function Calling / Tool Use
通过 Cursor 的 Composer/Agent 模式原生支持工具调用，但 BYOK 模型是否支持 Tool Use 取决于供应商模型本身（如 DeepSeek-Chat 支持 Function Calling）。

### 1.11 安全提示文案
启用 `Override OpenAI Base URL` 时有底部提示，提醒 Key 仅本地使用、不会发送到 Cursor 云端。

### 1.12 导出/导入配置
**不支持**通过 UI 导出/导入 Key 配置。

---

## 2. Windsurf Editor [置信度：Medium]

### 2.1 API Key 添加 UI 流程
Windsurf 由 Codeium 团队开发，定位为 AI 原生 IDE。其设置入口位于右下角 `Windsurf Settings`，主要提供「全局 AI 规则」与「工作区 AI 规则」两项配置。

> 来源：[飞书文档 - Windsurf 再更新](https://my.feishu.cn/wiki/UlHuwUYjCijwnIkXjhecmTlenHe)｜[CSDN - Windsurf AI IDE 完全使用指南](https://blog.csdn.net/m0_73774439/article/details/155094401)

### 2.2 BYOK 支持程度
Windsurf 主要依赖订阅制，内置 Claude/GPT/Gemini 等 100+ 模型。BYOK（自定义 API Key）支持较弱，社区主要将其作为"模型代理转发"的 API 源（即将 Windsurf 当作后端 API 给其他工具调用），而非让用户在 Windsurf 内填入自有 Key。

> 来源：[头条 - 把Windsurf的100+模型变成免费API](http://m.toutiao.com/group/7662333699689660943/)

### 2.3 其他要点
- **BaseURL 自定义**：官方未提供显式 BYOK 入口
- **连接测试**：无
- **模型选择联动**：内置模型池下拉
- **余额查询**：无
- **安全存储**：依赖 Codeium 账号体系
- **默认推荐**：自有模型池，无国产模型预置

> 来源：[Windsurf 官网](https://cxgn.cn/windsurf-editor)

---

## 3. VSCode GitHub Copilot [置信度：High]

### 3.1 自定义端点的官方立场
GitHub Copilot 官方**明确不支持**个人版自定义 OpenAI 兼容端点。社区 Issue 已被官方关闭并回复："实际上，这个功能在可预见的未来只面向企业版"。

> 来源：[CSDN - VSCode Github Copilot使用OpenAI兼容的自定义模型方法](https://blog.csdn.net/johnny0316/article/details/152900115)

### 3.2 OAI Compatible Provider（仅企业版）
Copilot 的 `OAI Compatible Provider` 功能作用是：将 Copilot/Copilot Chat 发出的"类似 OpenAI API 的请求"转发到指定的 OpenAI-Compatible 服务端（如 ModelScope、Azure OpenAI 等），但**仅面向企业版**。

> 来源：[CSDN - GitHub Copilot 调用第三方模型API](https://blog.csdn.net/honmy18/article/details/157544634)

### 3.3 社区绕过方案
社区通过编写"转发器"将第三方 API 伪装为本地 Ollama 服务（Ollama 已实现 OpenAI 兼容，Copilot 调用此兼容端点），从而绕过官方限制。这属于非官方 hack，不在产品原生功能范围内。

> 来源：[B站 - VSCode Github Copilot接入OpenAI兼容模型](https://www.bilibili.com/opus/1131646122156097536)｜[CSDN - 让 Copilot 连接任何 OpenAI](https://blog.csdn.net/qq_42945182/article/details/160058350)

### 3.4 设计启示
GitHub Copilot 是"封闭模型池 + 订阅制"的典型反面教材。对于我们的写作应用，**不应**效仿此模式——它会迫使技术用户编写中间件绕过，损害体验。

---

## 4. Continue.dev [置信度：High]

### 4.1 配置文件体系（YAML 优先）
Continue.dev 从 `config.json` 迁移到 `config.yaml`，迁移原因为可读性、灵活性与现代配置标准。配置文件位置：
- macOS/Linux：`~/.continue/config.yaml`
- Windows：`%USERPROFILE%\.continue\config.yaml`

> 来源：[Continue.dev 官方文档 - Configuration](https://docs.continue.dev/customize/deep-dives/configuration)｜[CSDN - Continue 配置自定义提示词模板](https://blog.csdn.net/qq_33763827/article/details/148086702)

### 4.2 多供应商并存与模型角色分配
Continue.dev 通过 `models` 数组实现多供应商并存，每个模型独立配置 `provider`、`model`、`apiKey`、`apiBase`、`roles`，是真正意义上的"多 Profile 多供应商"。

配置示例：
```yaml
models:
  - name: DeepSeek-R1
    provider: openai
    model: DeepSeek-R1
    apiKey: Your_API_key
    roles:
      - chat
      - edit
      - apply
  - name: AutoComplete AI
    provider: openai
    model: deepseek-coder
    apiBase: https://api.deepseek.com
  - name: gpt-4o
    provider: openai
    capabilities: [tool_use, image_input]
```

> 来源：[CSDN - 7个Continue插件实战策略](https://blog.csdn.net/gitblog_00842/article/details/159724144)｜[头条 - Continue 多模型配置示例](http://m.toutiao.com/group/7652978866071290404/)｜[CSDN - Continue 重新定义AI辅助编程](https://blog.csdn.net/gitblog_01191/article/details/151596725)

### 4.3 关键设计要点
| 维度 | Continue.dev 实现 |
|---|---|
| BaseURL 自定义 | 支持（`apiBase` 字段） |
| 多供应商并存 | 支持（`models` 数组） |
| 模型选择联动 | 通过 `roles`（chat/edit/apply）分配，不同场景用不同模型 |
| Function Calling | 通过 `capabilities: [tool_use, image_input]` 声明 |
| 连接测试 | 通过实际 chat 请求验证，无显式按钮 |
| 工作区配置 | `.continuerc.json` 支持 `merge`/`overwrite` 两种合并策略 |
| 高级配置 | `config.ts` 可编程修改配置（导出 `modifyConfig` 函数） |
| 安全存储 | Key 明文存于 YAML 文件，依赖文件系统权限 |
| 导入/导出 | 配置文件本身就是可分享的 YAML/JSON |

### 4.4 工作区级配置（值得借鉴）
`.continuerc.json` 与 `config.json` 格式相同，额外增加 `mergeBehavior` 字段（`merge` 或 `overwrite`）。这允许团队将模型配置纳入 Git 仓库管理，但 Key 仍需用户本地填写。

---

## 5. JetBrains AI Assistant [置信度：Medium]

### 5.1 BYOK 支持现状
JetBrains AI Assistant 默认采用订阅制，中国版接入阿里云通义大模型。插件默认未启用，需在 `Settings → Plugins → Marketplace` 安装 AI Assistant 插件。

> 来源：[OpenI - JetBrains AI Assistant](https://openi.cn/285323.html)｜[JetBrains 官方文档 - AI Assistant](https://www.jetbrains.com.cn/en-us/help/idea/generate-documentation.html)

### 5.2 ACP 自定义 Agent 接入
2025 年底，JetBrains 给 AI Assistant 插件更新了"自定义 ACP（Agent Client Protocol）配置"功能，可将任何支持 ACP 的 Agent 接入 AI Assistant。这是 JetBrains 走向开放的关键一步，但仍非传统意义上的"填 API Key"。

> 来源：[头条 - IDEA 里终于能爽用 Claude Code了](http://m.toutiao.com/group/7600407886539326003/)

### 5.3 其他要点
- **BaseURL 自定义**：不直接支持（依赖 ACP 协议接入）
- **连接测试**：无
- **多供应商并存**：通过不同 ACP Agent 实现
- **默认推荐**：通义大模型（中国版）/ OpenAI（国际版）
- **安全存储**：依赖 JetBrains 账号体系
- **导出/导入**：无

---

## 6. Notion AI / 飞书 AI / 钉钉 AI 助理 [置信度：High（飞书 Aily）/ Low（Notion/钉钉）]

### 6.1 飞书 Aily（重点）
飞书 Aily 是企业级 AI 平台，支持企业自定义模型接入，**必须兼容 OpenAI 协议**。

配置入口：`企业管理后台 → 模型管理 → 接入模型 → 自定义模型`

配置字段（完整列表）：
- 模型名称（对应 OpenAI `model` 字段）
- 模型能力（文生文必选）
- 展示名称、模型描述
- 上下文长度（输入 + 输出 token 总和）
- 模型请求地址
- 代理集群（用于企业内网模型）
- 模型请求方法（POST）
- 模型请求头（按实际情况填写）
- RPM（Requests Per Minute）
- TPM（Tokens Per Minute）

关键限制：
- 默认模型无法配置 Key，只能管理可用性
- 配置自己的 Key 需按"接入模型"指南操作
- 接入前要求用户本地 curl 验证
- Aily 平台使用非流式请求做接入测试

> 来源：[飞书 Aily 官方文档 - 接入自定义模型](https://aily.feishu.cn/hc/1u7kleqg/3dezs4wl)

### 6.2 Notion AI / 钉钉 AI 助理
Notion AI 与钉钉 AI 助理均以官方模型池为核心，**不支持个人用户自主添加 API Key**。企业集成需通过第三方无代码平台（如集简云）做 webhook 联动，不属于产品原生 BYOK 能力。

> 来源：[集简云 - 飞书与钉钉AI集成](https://www.jijyun.cn/apps/apps/257_408)｜[集简云 - Notion + 飞书AI](https://www.jijyun.cn/apps/apps/396_184)

---

## 7. CherryStudio [置信度：High]

CherryStudio 是本研究中**最值得借鉴的开源桌面客户端**，其 Provider 体系设计成熟度极高。

### 7.1 Provider 体系（60+ 内置模板）
CherryStudio 内置 60+ Provider 模板，按协议分为七类：

| 类型 | 兼容协议 | 典型代表 |
|---|---|---|
| OpenAI 兼容 | `/v1/chat/completions` | OpenAI、DeepSeek、硅基流动、OpenRouter |
| Anthropic 兼容 | `/v1/messages` | Anthropic、CherryIN（Cherry Agent 需要） |
| Gemini | Google AI Studio / Vertex | Google Gemini、Vertex AI |
| Bedrock | AWS Bedrock SDK | AWS Bedrock |
| Azure OpenAI | Azure OpenAI Service | Azure OpenAI |
| 本地推理 | 本地 HTTP 服务 | Ollama、LM Studio、GPUStack、OpenVINO |
| 特殊网关 | 厂商私有协议 | NewAPI、OneAPI、AiHubMix、DMXAPI |

国内厂商预置：阿里云百炼、硅基流动、火山引擎（豆包）、华为云、无问芯穹、PPIO 派欧云、ModelScope。

> 来源：[CherryStudio 官方文档 - 模型服务](https://docs.cherry-ai.com/pre-basic/providers.md)｜[CherryStudio GitHub](https://github.com/CherryHQ/cherry-studio)

### 7.2 添加 Provider 的通用步骤
1. 打开 `设置 → 模型服务`
2. 在内置 Provider 列表中找到目标 Provider，点击进入详情页
3. 填写 **API 密钥**（必填），按需修改 **API 地址**（默认是官方地址）
4. 点击 **获取模型列表**，按需添加对话/嵌入/视觉模型
5. （可选）点击 **检测**，用任一对话模型验证连接是否成功

> 来源：[CherryStudio 官方文档 - 模型服务设置](https://docs.cherry-ai.com/pre-basic/settings/providers)

### 7.3 多 Key 轮询（差异化能力）
单个服务商支持多 Key 轮询，轮询方式为从前到后列表循环。多 Key 用**英文逗号**隔开：
```
sk-xxxx1,sk-xxxx2,sk-xxxx3,sk-xxxx4
```

### 7.4 API 地址的高级用法
- 默认：用户填根地址（如 `https://xxx.xxx.com`），CherryStudio 自动拼接 `/v1/chat/completions`
- 特殊：若服务商路由不是常规 `/v1/chat/completions`，可填**完整 API 地址**并以 `#` 结尾，此时不执行拼接

### 7.5 连通性检查
点击 API 秘钥输入框后的检查按钮即可测试配置。检查时默认使用模型列表已添加模型的最后一个对话模型。

### 7.6 启用开关（关键设计）
配置成功后必须打开右上角的开关，否则该服务商仍处于未启用状态，无法在模型列表中找到对应模型。这一设计避免了"配置即启用"的误操作。

### 7.7 模型选择联动
点击服务商配置页面最左下角的 `管理` 按钮会自动获取该服务商所有支持调用的模型，从获取列表中点击 `+` 号添加到模型列表。

### 7.8 其他要点
| 维度 | CherryStudio 实现 |
|---|---|
| BaseURL 自定义 | 支持，且有 `#` 结尾固定路径高级用法 |
| 连接测试 | 支持，输入框旁检查按钮 |
| 多供应商并存 | 60+ 内置 + 自定义服务商 |
| 模型选择联动 | 自动获取模型列表 |
| Key 存储 | 本地存储（基于 Electron） |
| Function Calling | 支持（Cherry Agent 需 Anthropic 兼容类型） |
| MCP Server | 支持 |
| 安全提示 | 提示本地存储 |
| 多平台 | Windows/Mac/Linux |
| 企业版 | 集中模型管理、员工权限、知识库、私有部署 |

### 7.9 企业版的启示
CherryStudio 企业版提供"集中模型管理"——员工无需个人配置 Key，开箱即用。这对我们的写作应用未来做团队版有参考价值。

> 来源：[CherryStudio GitHub README](https://github.com/CherryHQ/cherry-studio)

---

## 8. LobeChat [置信度：High]

### 8.1 Provider 配置体系
LobeChat 设置路径：`Settings → Language Model`，支持数十个 Provider（OpenAI、Claude、Gemini、Ollama、LM Studio、通义千问等）。

每个 Provider 配置字段：
- API Proxy Address（API 代理地址）
- API Key
- 模型列表（可勾选启用）

> 来源：[便携AI - LobeChat使用教程](https://bianxieai.com/lobechat-openai-claude-and-gemini-api-tutorial.html)｜[CSDN - LobeChat 内容生成秘籍](https://blog.csdn.net/RubyWolf84/article/details/157042611)｜[CSDN - OpenAI 兼容 API 接入实战](https://blog.csdn.net/weixin_41961749/article/details/156259618)

### 8.2 关键设计要点
| 维度 | LobeChat 实现 |
|---|---|
| 连接测试 | 支持（"测试连接是否成功"按钮） |
| 多供应商并存 | 支持，数十个 Provider |
| BaseURL 自定义 | 支持（API Proxy Address） |
| 模型选择联动 | Provider 启用后勾选模型 |
| 本地化桌面客户端 | 支持 Windows/Mac/Linux |
| 插件系统 | 完善的插件体系 |
| 默认推荐 | OpenAI 为首，国产 Provider 在列表中 |
| 安全存储 | 浏览器/本地存储 |

### 8.3 桌面客户端能力
LobeChat 提供媲美甚至超越 ChatGPT 官方客户端的桌面体验，无缝连接和管理数十个 AI 模型。

> 来源：[腾讯云 - LobeChat 本地化 AI 聊天的终极桌面客户端](https://cloud.tencent.com/developer/article/2622150)

---

## 9. ChatGPT-Next-Web (NextChat) [置信度：High]

### 9.1 双层配置：环境变量 + 用户界面
NextChat 采用"部署方环境变量 + 终端用户 UI"双层配置，是开源 ChatGPT Web 客户端的代表。

**部署方环境变量**（部分）：
| 变量 | 用途 |
|---|---|
| `CODE` | 访问密码（逗号分隔多个） |
| `OPENAI_API_KEY` | 必填，OpenAI Key（逗号分隔多 Key） |
| `BASE_URL` | 自定义 OpenAI 端点（默认 `https://api.openai.com`） |
| `OPENAI_ORG_ID` | OpenAI 组织 ID |
| `AZURE_URL` / `AZURE_API_KEY` / `AZURE_API_VERSION` | Azure OpenAI |
| `GOOGLE_API_KEY` / `GOOGLE_URL` | Google Gemini |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_API_VERSION` / `ANTHROPIC_URL` | Anthropic Claude |
| `BAIDU_API_KEY` / `BAIDU_SECRET_KEY` | 百度文心 |

> 来源：[NextChat GitHub README](https://github.com/ChatGPTNextWeb/NextChat)

### 9.2 终端用户 UI 配置
用户在左下角设置按钮中：
1. 启用 `Custom Endpoint` 开关
2. 填入 `OpenAI Endpoint`（如 `https://api.bianxie.ai`）
3. 填入 `OpenAI API Key`

> 来源：[便携AI - NextChat 使用教程](https://bianxieai.com/nextchat-chatgpt-next-web-openai-api-tutorial.html)

### 9.3 Tauri 桌面客户端的安全演进
NextChat v2.15.4 起支持使用 Tauri fetch LLM API，**标注为 MORE SECURITY**。这意味着 Key 不再暴露给 WebView，而是通过 Rust 后端代理请求，是 Tauri 桌面 AI 应用安全的关键实践。

> 来源：[NextChat GitHub README - What's New](https://github.com/ChatGPTNextWeb/NextChat)

### 9.4 其他要点
| 维度 | NextChat 实现 |
|---|---|
| 隐私 | 所有数据本地存储（浏览器） |
| 多 Key | 支持（逗号分隔） |
| 访问密码 | `CODE` 环境变量 |
| 多模型供应商 | 通过环境变量配置多供应商 |
| 桌面 App | Tauri 跨平台（~5MB） |
| 插件 | v2.15.0 起支持 |
| Artifacts | v2.14.0 起支持 |
| Realtime Chat | v2.15.8 起支持 |
| 兼容性 | RWKV-Runner、LocalAI、Ollama 等本地模型 |

### 9.5 启示
NextChat 的"Tauri fetch 代理"模式值得我们的 Tauri 写作应用直接采用——所有 LLM 请求经 Rust 后端发出，Key 不进入前端 WebView 上下文。

---

## 10. Tauri / Electron 桌面 AI 应用安全存储实践 [置信度：High]

### 10.1 Tauri 阵营：`tauri_plugin_secure_storage`
Tauri 推荐使用 `tauri_plugin_secure_storage` 插件将 API 密钥存储到系统安全存储。示例代码（来自 OpenAI Translator 数据加密实践）：

```rust
use tauri_plugin_secure_storage::secure_storage;

// 存储 API 密钥到系统安全存储
pub fn store_api_key(app: &AppHandle, key: &str) -> Result<(), Box<dyn std::error::Error>> {
    // ...
}
```

> 来源：[CSDN - OpenAI Translator 数据加密](https://blog.csdn.net/gitblog_00952/article/details/151248330)

### 10.2 Electron 阵营：`safeStorage`
Electron 内置 `safeStorage` API，底层调用：
- Windows：DPAPI（Data Protection API）
- macOS：Keychain
- Linux：libsecret / KWallet

### 10.3 跨平台 Node.js：`keytar`
`keytar` 是跨平台 Node.js 模块，统一调用 Keychain / Credential Manager / KWallet。鸿蒙系统也有模拟 keytar API 的实践（基于 `@ohos.security.storage`）。

> 来源：[CSDN - 鸿蒙 Electron 全攻略 - 模拟 keytar](https://blog.csdn.net/donk1314/article/details/155245974)

### 10.4 Tauri vs Electron 安全对比
Tauri 的安全模型优于 Electron：
- Tauri 必须显式暴露 Rust 函数给前端，攻击面更小
- Electron 可完全访问 Node API，黑客可利用强大的 Node API 进行攻击
- Tauri 使用系统 WebView，安装包体积减少 80%、内存占用极低、安全沙箱更强

> 来源：[CSDN - Tauri vs Electron 真实项目比较](https://blog.csdn.net/duninet/article/details/126953511)｜[CSDN - Tauri vs Electron 完整性能对比](https://blog.csdn.net/LIU_CAN/article/details/162624909)

### 10.5 NextChat Tauri 版的安全实践
NextChat v2.15.4 改用 Tauri fetch LLM API，避免 Key 暴露到 WebView。这是 Tauri 桌面 AI 应用安全的关键模式——**前端只负责 UI，所有涉及 Key 的网络请求由 Rust 后端代理**。

---

## 11. ChatBox AI（补充产品）[置信度：Medium]

ChatBox AI 是另一款值得参考的开源 AI 桌面客户端，由开发者 Bin-Huang 创建。

### 11.1 关键设计
- 多平台：Windows/Mac/Linux/Android/iOS/Web
- 支持模型：GPT、Claude、Gemini、Llama 等
- 设置：`Settings 面板 → API Provider（Custom 或 OpenAI）→ Base URL + API Key`
- 数据安全：本地存储

> 来源：[打工人Ai工具箱 - Chatbox AI官网](https://www.dgrai.com/sites/89314.html)｜[CSDN - Chatbox 终极指南](https://blog.csdn.net/weixin_45793591/article/details/160404824)｜[CSDN - 全平台接入指南](https://blog.csdn.net/weixin_45793591/article/details/160404824)

---

## 横向对比表

| 产品 | BYOK | 多供应商并存 | BaseURL 自定义 | 连接测试 | 多 Key 轮询 | 模型列表自动获取 | 本地安全存储 | 默认推荐国内供应商 | 导出/导入配置 |
|---|---|---|---|---|---|---|---|---|---|
| Cursor | ✅ 单端点 | ❌ | ✅ | ❌ | ❌ | ❌ | 隐私模式 | ❌ | ❌ |
| Windsurf | ❌ 弱 | ❌ | ❌ | ❌ | ❌ | ❌ | 账号体系 | ❌ | ❌ |
| GitHub Copilot | ❌ 企业版 | ❌ | ❌ 企业版 | ❌ | ❌ | ❌ | 账号体系 | ❌ | ❌ |
| Continue.dev | ✅ | ✅ YAML 数组 | ✅ apiBase | ❌ | ❌ | ❌ | 明文 YAML | ❌ | ✅ 文件即配置 |
| JetBrains AI | ⚠️ ACP | ⚠️ ACP Agent | ❌ | ❌ | ❌ | ❌ | 账号体系 | ⚠️ 通义 | ❌ |
| 飞书 Aily | ✅ 企业 | ✅ | ✅ | ✅ 非流式 | ❌ | ❌ | 企业后台 | ❌ | ❌ |
| CherryStudio | ✅ | ✅ 60+ 模板 | ✅ 含 `#` 高级 | ✅ | ✅ 逗号分隔 | ✅ 获取模型 | 本地 | ✅ DeepSeek/硅基等 | ⚠️ |
| LobeChat | ✅ | ✅ 数十个 | ✅ Proxy Address | ✅ | ❌ | ⚠️ 勾选 | 本地 | ⚠️ 列表中 | ⚠️ |
| NextChat | ✅ | ✅ 环境变量 | ✅ BASE_URL | ❌ | ✅ 逗号分隔 | ❌ | 本地浏览器 | ❌ | ✅ 文件即配置 |
| ChatBox AI | ✅ | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | 本地 | ⚠️ | ⚠️ |

---

## 借鉴清单（可直接复用到 Tauri 桌面写作应用）

### 1. 采用 CherryStudio 的「Provider 模板 + 七类协议分类」体系
预置 60+ Provider 模板，按协议分类（OpenAI 兼容、Anthropic 兼容、Gemini、本地推理等）。用户选择 Provider 后自动填充默认 Base URL、请求路径、模型列表，仅需填入 Key。**这是降低用户认知负担的最关键设计**。
> 来源：[CherryStudio 文档 - 模型服务](https://docs.cherry-ai.com/pre-basic/providers.md)

### 2. 预置国内供应商为默认推荐（DeepSeek、硅基流动、Moonshot、阿里云百炼、火山引擎）
CherryStudio 已验证此模式的可行性。对于写作应用，DeepSeek-V3、DeepSeek-R1、Qwen-Max、Moonshot Kimi 均是高性价比选择，应作为"开箱推荐"卡片首屏呈现，而非埋在列表深处。
> 来源：[CherryStudio 国内厂商预置列表](https://docs.cherry-ai.com/pre-basic/providers.md)

### 3. 复刻 CherryStudio 的「连通性检查 + 启用开关」双保险
- API Key 输入框旁设置 `检查` 按钮，使用模型列表最后一个对话模型做实际请求验证
- 右上角设置启用开关，**配置成功不等于启用**，避免误操作
> 来源：[CherryStudio 文档 - 连通性检查](https://docs.cherry-ai.com/pre-basic/settings/providers)

### 4. 引入 CherryStudio 的「多 Key 轮询」能力
单服务商支持多 Key 用英文逗号分隔，从前到后循环轮询。对写作应用应对单 Key 配额限制、降低用户因余额不足中断写作的概率，价值极高。
> 来源：[CherryStudio 文档 - API 秘钥](https://docs.cherry-ai.com/pre-basic/settings/providers)

### 5. 采纳 CherryStudio 的 `#` 结尾固定路径高级用法
默认自动拼接 `/v1/chat/completions`；当服务商路由特殊时，允许用户填完整地址并以 `#` 结尾跳过拼接。这一设计兼顾"小白用户开箱即用"与"高级用户灵活定制"。
> 来源：[CherryStudio 文档 - API 地址](https://docs.cherry-ai.com/pre-basic/settings/providers)

### 6. 复刻 Continue.dev 的「模型角色分配」机制
通过 `roles`（chat/edit/apply）为不同场景分配不同模型。写作应用可扩展为 `roles: [draft, rewrite, polish, translate, summarize]`，让用户为不同写作任务配置不同模型（如初稿用 DeepSeek-Chat，润色用 Claude）。
> 来源：[Continue.dev 多模型配置示例](http://m.toutiao.com/group/7652978866071290404/)

### 7. 采用 NextChat 的「Tauri fetch 代理」安全模式
**所有 LLM 请求经 Rust 后端发出，Key 不进入前端 WebView 上下文**。这是 Tauri 桌面 AI 应用的安全最佳实践，NextChat v2.15.4 已验证（标注为 MORE SECURITY）。
> 来源：[NextChat GitHub README - v2.15.4](https://github.com/ChatGPTNextWeb/NextChat)

### 8. 使用 `tauri_plugin_secure_storage` 做系统级钥匙串存储
API Key 不应明文存于配置文件（Continue.dev 的 YAML 明文存储是反面案例）。应调用系统 Keychain（macOS）/ Credential Manager（Windows）/ libsecret（Linux），与 OpenAI Translator 的实践一致。
> 来源：[CSDN - OpenAI Translator 数据加密](https://blog.csdn.net/gitblog_00952/article/details/151248330)

### 9. 借鉴飞书 Aily 的「接入前 curl 验证」与「RPM/TPM 限流」字段
- 在用户配置自定义模型时，提供"接入前请本地 curl 验证"的引导提示
- 暴露 RPM（Requests Per Minute）、TPM（Tokens Per Minute）字段，让高级用户精细控制速率
- 使用非流式请求做接入测试（更稳定的验证方式）
> 来源：[飞书 Aily 文档 - 接入自定义模型](https://aily.feishu.cn/hc/1u7kleqg/3dezs4wl)

### 10. 提供 NextChat 式的「访问密码 CODE」与配置导入/导出
- 桌面写作应用应支持设置应用启动密码（类似 NextChat 的 `CODE`），保护本地 Key 不被他人随意打开应用获取
- 支持配置文件导出/导入（Continue.dev 的 YAML 文件本身就是可分享配置），便于用户在多设备同步模型设置（但 Key 应单独加密导出，或导出时清空 Key）

> 来源：[NextChat GitHub README - CODE](https://github.com/ChatGPTNextWeb/NextChat)｜[Continue.dev 文档 - 配置文件](https://docs.continue.dev/customize/deep-dives/configuration)

---

## Open Questions & Caveats

1. **Cursor / Windsurf 的 Key 本地存储细节未公开**：官方文档未明确说明 BYOK 模式下 Key 是否使用系统钥匙串，仅知有 Privacy Mode 与 SOC 2 审计。需进一步联系官方或逆向验证。
2. **Notion AI / 钉钉 AI 助理的 BYOK 能力研究不充分**：本研究主要依赖第三方集成平台文档，未获取到官方 BYOK 政策的权威说明。若需深入，建议直接查阅 Notion / 钉钉官方 API 文档。
3. **JetBrains AI Assistant 的 ACP 协议**：2025 年底的 ACP 自定义 Agent 接入是新功能，社区文档有限，其与传统 BYOK 的差异需进一步验证。
4. **LobeChat 的 Key 存储方式**：LobeChat 文档页面 WebFetch 返回不完整，Key 是明文本地存储还是加密存储未完全确认。
5. **余额/配额查询能力普遍缺失**：所有研究产品均不原生支持余额查询，需用户自行到供应商后台查询。这是行业普遍痛点，也是我们写作应用可差异化的机会点（通过调用供应商的 `/dashboard/billing/usage` 等接口实现）。
6. **Function Calling 配置在 BYOK 场景下的体验**：Continue.dev 通过 `capabilities: [tool_use, image_input]` 声明，CherryStudio 通过协议类型（Anthropic 兼容）区分，但均未提供"自动检测模型是否支持 Tool Use"的能力。

---

## Methodology

### 研究深度
standard（标准模式）

### 检索策略
- 共执行 15 次 WebSearch + 9 次 WebFetch
- 搜索语言：中文为主，英文为辅
- 搜索词涵盖产品名 + "API Key" + "配置" + "BYOK" + "自定义端点" + "OpenAI 兼容" + "安全存储"等关键词组合
- WebFetch 优先抓取官方文档（docs.cherry-ai.com、docs.continue.dev、cursor.com、aily.feishu.cn、github.com）

### 来源分层
- **Tier 1（权威）**：官方文档（CherryStudio docs、Continue.dev docs、Cursor docs、飞书 Aily docs、NextChat README、CherryStudio README、LobeChat GitHub）
- **Tier 2（可信）**：CSDN/掘金/腾讯云等技术社区深度教程
- **Tier 3（补充）**：头条号、B站等社区讨论

### 局限性
1. 部分 WebFetch 因页面动态渲染/反爬返回不完整（如 LobeChat 文档、CherryStudio 部分 URL 404），改用 WebSearch snippet 补充
2. 闭源产品（Cursor、Windsurf、JetBrains）的内部存储实现依赖社区推测，非官方确认
3. 未对每个产品做实际安装验证，UI 流程描述基于文档与教程

### 偏差报备
- 【Skill 偏差报备】deep-research skill 要求 Phase 0 先向用户澄清问题，但本任务作为 sub-agent 执行，且用户需求已非常明确（产品清单、要点、输出格式均已指定），故跳过 Phase 0 直接进入检索，依据为任务描述的明确性。
- 【Skill 偏差报备】deep-research skill 要求使用 Task 工具派生子代理做并行检索，但本环境未提供 Task 工具，故改用主代理直接并行调用 WebSearch/WebFetch（每次 3-5 个并行），依据为工具可用性约束。

---

## Bibliography（参考文献）

### 官方文档（Tier 1）
[1] CherryStudio - 模型服务设置 - https://docs.cherry-ai.com/pre-basic/settings/providers - 访问 2026-07-15
[2] CherryStudio - 模型服务（Provider 列表）- https://docs.cherry-ai.com/pre-basic/providers.md - 访问 2026-07-15
[3] CherryStudio GitHub README - https://github.com/CherryHQ/cherry-studio - 访问 2026-07-15
[4] Continue.dev - How to Configure Continue - https://docs.continue.dev/customize/deep-dives/configuration - 访问 2026-07-15
[5] Cursor 官方文档 - https://cursor.com/cn/docs - 访问 2026-07-15
[6] 飞书 Aily - 接入自定义模型 - https://aily.feishu.cn/hc/1u7kleqg/3dezs4wl - 访问 2026-07-15
[7] NextChat GitHub README - https://github.com/ChatGPTNextWeb/NextChat - 访问 2026-07-15
[8] LobeChat GitHub - https://github.com/lobehub/lobe-chat - 访问 2026-07-15
[9] JetBrains AI Assistant 文档 - https://www.jetbrains.com.cn/en-us/help/idea/generate-documentation.html - 访问 2026-07-15
[10] Windsurf 官网 - https://cxgn.cn/windsurf-editor - 访问 2026-07-15

### 技术社区深度教程（Tier 2）
[11] CSDN - Cursor 国内可以购买哪些API - https://blog.csdn.net/weixin_40970718/article/details/160418856
[12] 掘金 - 两种方式在Cursor中接入DeepSeek-V3 - https://juejin.cn/post/7460322919504150591
[13] CSDN - 多模型配置指南（Cursor Override Base URL）- https://blog.csdn.net/an845410111/article/details/159882730
[14] CSDN文库 - cursor添加deepseek报错invalid openai key - https://wenku.csdn.net/answer/4i1v35thx1
[15] CSDN - GitHub Copilot 调用第三方模型API - https://blog.csdn.net/honmy18/article/details/157544634
[16] CSDN - VSCode Github Copilot使用OpenAI兼容的自定义模型方法 - https://blog.csdn.net/johnny0316/article/details/152900115
[17] CSDN - 让 Copilot 连接任何 OpenAI - https://blog.csdn.net/qq_42945182/article/details/160058350
[18] B站 - VSCode Github Copilot接入OpenAI兼容模型 - https://www.bilibili.com/opus/1131646122156097536
[19] CSDN - 7个Continue插件实战策略 - https://blog.csdn.net/gitblog_00842/article/details/159724144
[20] CSDN - Continue 配置自定义提示词模板及规则 - https://blog.csdn.net/qq_33763827/article/details/148086702
[21] 头条 - Continue 多模型配置示例 - http://m.toutiao.com/group/7652978866071290404/
[22] CSDN - Continue 重新定义AI辅助编程 - https://blog.csdn.net/gitblog_01191/article/details/151596725
[23] 便携AI - LobeChat 使用教程 - https://bianxieai.com/lobechat-openai-claude-and-gemini-api-tutorial.html
[24] CSDN - LobeChat 内容生成秘籍 - https://blog.csdn.net/RubyWolf84/article/details/157042611
[25] CSDN - OpenAI 兼容 API 接入实战（LobeChat）- https://blog.csdn.net/weixin_41961749/article/details/156259618
[26] 腾讯云 - LobeChat 本地化桌面客户端 - https://cloud.tencent.com/developer/article/2622150
[27] 便携AI - NextChat 使用教程 - https://bianxieai.com/nextchat-chatgpt-next-web-openai-api-tutorial.html
[28] OpenI - JetBrains AI Assistant - https://openi.cn/285323.html
[29] 头条 - IDEA 里终于能爽用 Claude Code（ACP）- http://m.toutiao.com/group/7600407886539326003/
[30] 飞书文档 - Windsurf 再更新 - https://my.feishu.cn/wiki/UlHuwUYjCijwnIkXjhecmTlenHe
[31] CSDN - Windsurf AI IDE 完全使用指南 - https://blog.csdn.net/m0_73774439/article/details/155094401
[32] 头条 - 把Windsurf的100+模型变成免费API - http://m.toutiao.com/group/7662333699689660943/

### 安全存储实践（Tier 2）
[33] CSDN - OpenAI Translator 数据加密（tauri_plugin_secure_storage）- https://blog.csdn.net/gitblog_00952/article/details/151248330
[34] CSDN - Tauri vs Electron 真实项目比较 - https://blog.csdn.net/duninet/article/details/126953511
[35] CSDN - 鸿蒙 Electron 全攻略（模拟 keytar）- https://blog.csdn.net/donk1314/article/details/155245974
[36] CSDN - Tauri vs Electron 完整性能对比 - https://blog.csdn.net/LIU_CAN/article/details/162624909

### 补充产品（Tier 2-3）
[37] 打工人Ai工具箱 - Chatbox AI 官网 - https://www.dgrai.com/sites/89314.html
[38] CSDN - Chatbox 终极指南 - https://blog.csdn.net/weixin_45793591/article/details/160404824
[39] 集简云 - 飞书与钉钉AI集成 - https://www.jijyun.cn/apps/apps/257_408
[40] 集简云 - Notion + 飞书AI - https://www.jijyun.cn/apps/apps/396_184

### 安全与审计（Tier 2-3）
[41] 头条 - Cursor 安全漏洞与审计机制 - http://m.toutiao.com/group/7662617395571327522/
[42] 头条 - Cursor 配置指南（UniVibe）- https://juejin.cn/post/7595466990111342632

---

*报告结束。所有信息均基于实际检索到的资料，来源 URL 已在 Bibliography 与正文中标注。如需进一步验证某产品的具体实现，建议直接访问对应官方文档或安装产品实测。*
