<div align="center">

# 喵创说 (MiaoChuangShuo)

**长篇小说离线创作桌面工作站** · Tauri 2 + React 18 + Rust

将项目管理、大纲规划、章节写作、人物图谱、剧情时间线、设定库、全文搜索与 AI 助手集成于单一桌面应用，让长篇创作者无需在多个软件之间切换即可完成从立意到连载的全流程作业。

[![Version](https://img.shields.io/github/v/release/fanquanpp/MiaoChuangShuo?style=flat-square&label=version&color=6EA8FE)](https://github.com/fanquanpp/MiaoChuangShuo/releases)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?style=flat-square&logo=tauri)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react)](https://react.dev/)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?style=flat-square&logo=rust)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078d7?style=flat-square)](https://github.com/fanquanpp/MiaoChuangShuo/releases)

</div>

---

## 下载与访问

- **桌面安装包（MSI / NSIS，完整功能）**：[GitHub Releases](https://github.com/fanquanpp/MiaoChuangShuo/releases)
- **Web 在线体验版（核心编辑功能，IndexedDB 持久化）**：[https://fanquanpp.github.io/MiaoChuangShuo/](https://fanquanpp.github.io/MiaoChuangShuo/)
- **项目展示页（特性与界面预览）**：[https://fanquanpp.github.io/MiaoChuangShuo/docs/](https://fanquanpp.github.io/MiaoChuangShuo/docs/)

> 桌面版提供完整功能（全文搜索、AI 助手、人物图谱、时间线、设定库、版本快照、Tantivy 索引等）；Web 版用于快速试用核心创作体验。

## 核心特性

- **百万字级 TipTap 富文本编辑器**：基于 ProseMirror Document Model 数据驱动渲染，仅更新变更片段，长文档滚动保持 60fps
- **人物关系图谱**：基于 `@xyflow/react` 受控模式构建，dagre LR 自动布局 + 孤立节点网格化排列，消除遮挡
- **剧情时间线 DAG**：Rust 后端 DFS 三色标记法校验无环，受控拖拽 + 自动布局并存
- **智能设定库**：角色 / 世界观 / 术语 / 资料卡片结构化管理，YAML front matter 结构化，AI 上下文召回的“世界观数据库”
- **双后端全文搜索**：精确匹配 + Tantivy 语义检索（Rust 原生 + jieba 中文分词），按“场景”切分 Chunk
- **AI 创作助手**：BYOK 模式，SSE 流式直连 LLM，5 种任务类型（续写 / 对话 / 一致性校验 / 剧情推演 / 大纲生成），4 层上下文组装
- **命令面板与写作统计**：`Ctrl+K` cmdk 命令面板，会话字数 / WPM / 字数目标追踪，F11 聚焦模式
- **数据主权完全本地化**：项目数据 100% 存储在用户选择目录，无需账号登录，不上传任何创作内容

## 创作工作流

工作台采用三栏布局，左侧导航通过 `Alt+1` ~ `Alt+7` 在七个创作场景间切换，中间内容区随分类切换为对应面板，右侧为文件列表。

| 快捷键 | 场景 | 模块 | 说明 |
|--------|------|------|------|
| Alt+1 | 正文 | NovelEditor | 章节写作主战场，百万字级 TipTap 文档 |
| Alt+2 | 大纲 | OutlineToChapters | 大纲写完后一键批量生成章节文件 |
| Alt+3 | 设定 | CodexPanel | 角色 / 世界观 / 术语 / 资料卡片库 |
| Alt+4 | 统计 | WritingStats | 会话字数 / WPM / 字数目标 |
| Alt+5 | 搜索 | GlobalSearch | 精确匹配 + Tantivy 语义检索双后端 |
| Alt+6 | 人图 | CharacterGraphPanel | 人物关系网 |
| Alt+7 | 时间线 | TimelinePanel | 剧情节点 DAG，DFS 三色校验无环 |

**跨场景能力**：`Ctrl+K` 命令面板 · `Ctrl+Shift+A` AI 助手侧边栏 · `Ctrl+F` / `Ctrl+H` 查找替换 · `F11` 聚焦模式 + 专注计时器 · `SnapshotHistory` 版本快照回溯

## 快速开始

### 环境要求

- Node.js >= 20
- Rust (stable，需安装 rustup)
- Windows 10/11 x64

### 启动开发服务器

```bash
npm install
npm run tauri dev
```

### 构建生产安装包

```bash
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`，包含 MSI 与 NSIS 两种安装包。

## 技术栈

| 层级 | 选型 | 用途 |
|------|------|------|
| 桌面框架 | Tauri 2.0 | Rust 后端 + 系统 WebView，替代 Electron |
| 前端框架 | React 18 + Vite 8 | 函数组件 + Hooks，毫秒级 HMR |
| 类型系统 | TypeScript 6 (strict) | 全量 strict，禁用 `any` / `unknown` 索引签名 |
| 富文本引擎 | TipTap 2 (ProseMirror) | Document Model 数据驱动，自定义节点扩展 |
| 状态管理 | Zustand 5 + zundo 2 | 无 Provider 轻量 store + 时间旅行式撤销 |
| 图谱引擎 | @xyflow/react 12 + @dagrejs/dagre 1 | 受控节点 / 边系统 + LR 方向 DAG 自动布局 |
| 命令面板 | cmdk 1 | 模糊搜索 + 分组 + ARIA 无障碍 |
| 样式 | Tailwind CSS 3 + 自定义 `nf-*` 命名空间 | 原子化 CSS，零运行时开销 |
| 全文搜索 | Tantivy 0.22 + tantivy-jieba 0.11 | Rust 原生搜索引擎 + 中文分词 |
| 多模式匹配 | Aho-Corasick (Web Worker) | O(N+K) 实体名称匹配 |
| 后端语言 | Rust (stable) | 内存安全，原生级文件 IO 性能 |

## 数据主权与性能

### 完全本地化

- 项目数据 100% 存储在用户创建项目时选择的目录，与应用安装路径分离
- 应用级配置存储在 `%APPDATA%\MiaoChuangShuo\`，安装包升级不会清除
- 无需账号登录，不收集任何用户数据，不上传任何创作内容
- 仅“版本检查”（访问 GitHub API）与“AI 助手”（直连用户配置的 LLM 服务）需要联网，均可在设置中关闭

### 原子写入防损坏

Rust 后端所有文件写入操作采用“临时文件 + rename”原子策略：写入 `.tmp` 临时文件 → 写入完成后 rename 替换目标文件 → 写入前清理上次崩溃可能遗留的 `.tmp` 残留。保证即使在写入过程中崩溃或断电，目标文件要么是完整的旧版本，要么是完整的新版本。

### .pmd 存储格式

正文文件采用 `.pmd` 扩展名存储 ProseMirror JSON 文档，替代传统 `.txt` 纯文本：YAML front matter（含 `id` / `title` / `chapterId` 字段）+ ProseMirror JSON 正文，加载时剥离 front matter 仅注入正文，保存时重新注入保证元数据不丢失。

## 许可证

本项目基于 [MIT 许可证](./LICENSE) 开源。

任何个人或机构均可自由获取、使用、修改和分发本项目的全部内容，包括但不限于学习、研究、修改、分发及商业用途，无需获得作者授权，但须保留原始版权声明与许可声明。

## 免责声明

- 本项目所有内容均由人工与人工智能技术协同编撰、搜集、整理与编排。受限于编撰方式及知识更新周期，内容可能存在遗漏、过时或错误之处。使用者应结合官方文档与权威资料进行独立验证与核实
- 因使用或引用本项目内容所产生的一切直接或间接后果，均由使用者自行承担。本项目作者及维护者不对使用后果承担任何形式的法律责任或连带责任
- 本项目不保证内容的准确性、完整性、时效性或适用性。在任何情况下，本项目作者及维护者均不对因使用本项目内容而导致的任何损失或损害承担责任
- AI 助手功能需用户自带 OpenAI 兼容 API Key，调用 LLM 服务产生的费用由用户自行承担
- 用户创作内容完全存储在本地，建议定期备份项目数据，因硬件故障、误操作等导致的数据损失由用户自行承担
