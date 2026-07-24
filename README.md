<div align="center">

# 喵创说 (MiaoChuangShuo)

**长篇小说离线创作桌面工作站** · Tauri 2 + React 18 + Rust

</div>

> **停止维护通知**
> 本项目已停止更新与维护，不再接受新功能开发、问题修复与版本发布。仓库保留为只读归档状态，现有源码与历史 Release 仍可自由获取与使用。如有 fork 或二次开发需求，请遵循 MIT 许可证条款自行处理，作者不再对使用过程中的任何问题提供支持。

---

## 项目简介

喵创说是一款面向长篇创作场景的离线桌面工作站，将项目管理、大纲规划、章节写作、人物图谱、剧情时间线、设定库、全文搜索与 AI 助手集成于单一桌面应用，让创作者无需在多个软件之间切换即可完成从立意到连载的全流程作业。所有数据完全存储于本地，无需账号登录，不上传任何创作内容。

## 下载与访问

- **桌面安装包（MSI / NSIS）**：[GitHub Releases](https://github.com/fanquanpp/MiaoChuangShuo/releases)

## 核心特性

- **百万字级 TipTap 富文本编辑器**：ProseMirror Document Model 数据驱动渲染，长文档滚动保持流畅
- **人物关系图谱**：基于 @xyflow/react 受控模式构建，dagre 自动布局，消除遮挡
- **剧情时间线 DAG**：Rust 后端 DFS 三色标记法校验无环，受控拖拽 + 自动布局并存
- **智能设定库**：角色 / 世界观 / 术语 / 资料卡片结构化管理，AI 上下文召回的"世界观数据库"
- **双后端全文搜索**：精确匹配 + Tantivy 语义检索（Rust 原生 + jieba 中文分词）
- **AI 创作助手**：BYOK 模式，SSE 流式直连 LLM，多种任务类型与多层上下文组装
- **命令面板与写作统计**：`Ctrl+K` 命令面板，会话字数 / WPM / 字数目标追踪，F11 聚焦模式
- **数据主权完全本地化**：项目数据 100% 存储在用户选择目录，无需账号登录，不上传任何创作内容

## 快速开始

### 环境要求

- Node.js >= 20
- Rust (stable)
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
| 桌面框架 | Tauri 2.0 | Rust 后端 + 系统 WebView |
| 前端框架 | React 18 + Vite | 函数组件 + Hooks |
| 类型系统 | TypeScript (strict) | 全量 strict 类型 |
| 富文本引擎 | TipTap 2 (ProseMirror) | Document Model 数据驱动 |
| 状态管理 | Zustand + zundo | 无 Provider 轻量 store + 时间旅行式撤销 |
| 图谱引擎 | @xyflow/react + @dagrejs/dagre | 受控节点 / 边系统 + DAG 自动布局 |
| 命令面板 | cmdk | 模糊搜索 + 分组 + ARIA 无障碍 |
| 样式 | Tailwind CSS + 自定义命名空间 | 原子化 CSS |
| 全文搜索 | Tantivy + tantivy-jieba | Rust 原生搜索引擎 + 中文分词 |
| 后端语言 | Rust (stable) | 内存安全，原生级文件 IO 性能 |

## 许可证

本项目基于 [MIT 许可证](./LICENSE) 开源。任何个人或机构均可自由获取、使用、修改和分发本项目的全部内容，须保留原始版权声明与许可声明。

## 免责声明

- 本项目所有内容均由人工与人工智能技术协同编撰、搜集、整理与编排，可能存在遗漏、过时或错误之处，使用者应结合官方文档与权威资料进行独立验证
- 因使用或引用本项目内容所产生的一切直接或间接后果，均由使用者自行承担，本项目作者及维护者不承担任何形式的法律责任
- AI 助手功能需用户自带 OpenAI 兼容 API Key，调用 LLM 服务产生的费用由用户自行承担
- 用户创作内容完全存储在本地，建议定期备份项目数据，因硬件故障、误操作等导致的数据损失由用户自行承担
