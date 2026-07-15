# 贡献指南

感谢你对喵创说（MiaoChuangShuo）项目的关注！本文档说明如何参与开发与提交贡献。

## 项目简介

喵创说是一款面向独立与业余长篇创作者的离线写作工作站，技术栈为 Tauri 2.0 + React 18 + Rust + TypeScript + TipTap + React Flow + Tantivy。在开始贡献前，建议先阅读 [README.md](./README.md) 了解整体架构与设计原则。

## 开发环境

### 系统要求

- Windows 10 / 11 x64（本项目主要面向 Windows 平台）
- Node.js >= 18（推荐 20）
- Rust stable（通过 [rustup](https://rustup.rs/) 安装）
- Git

### 本地启动

```bash
# 1. 克隆仓库
git clone https://github.com/fanquanpp/MiaoChuangShuo.git
cd MiaoChuangShuo

# 2. 安装前端依赖
npm install

# 3. 启动开发服务器（Tauri 会自动编译 Rust 后端）
npm run tauri dev
```

首次启动会编译 Rust 后端，耗时较长（5-15 分钟），后续启动会复用缓存。

### 构建生产安装包

```bash
npm run tauri build
# 产物位于 src-tauri/target/release/bundle/
```

## 代码规范

### TypeScript（前端）

- **strict 模式全量启用**：禁用 `any` / `unknown` 类型，所有函数参数与返回值必须显式标注
- **三层架构**：UI 层（components/） / Service 层（lib/api） / Data 层（lib/store），UI 层禁止直接发起 API 请求
- **状态管理**：使用 Zustand + persist 中间件，禁用 Redux / Context 大范围状态
- **命名空间**：Tailwind 自定义颜色使用 `nf-*` / `fandex-*` 命名空间，避免与内置工具冲突
- **i18n**：所有用户可见文案必须通过 `useI18n().t()` 获取，禁止硬编码中文字符串
- **注释**：所有业务逻辑与函数必须配备中文工程级注释，说明输入参数、返回值、核心执行流程

### Rust（后端）

- `cargo check` 强制零警告
- 文件 IO 必须采用临时文件 + rename 原子写入策略
- 与前端通信的结构体必须标注 `#[serde(rename_all = "camelCase")]`
- 错误统一使用 `AppError` 类型，禁止 `expect()` / `unwrap()` 在生产路径出现

### 设计令牌

FANDEX 设计令牌集成于 Tailwind 配置：

| 语义 | CSS 变量 | 颜色 | 用途 |
|------|---------|------|------|
| 主色 | `--fandex-primary` | `#6EA8FE` | 主线 / 师徒关系 / 主操作 |
| 次色 | `--fandex-secondary` | `#55EFC4` | 分支 / 亲属关系 / 成功 |
| 三色 | `--fandex-tertiary` | `#F09070` | 事件 / 同门关系 / 警告 |

辅以灰色系（`zinc-*` / `nf-*`）构建暗色主题。

## 提交规范

### Conventional Commits

Commit Message 必须遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <subject>

<body>

<footer>
```

#### Type 取值

| Type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 重构（不改变外部行为） |
| `perf` | 性能改进 |
| `docs` | 文档更新 |
| `test` | 测试补充 |
| `build` | 构建系统 / 依赖变更 |
| `chore` | 杂项（不修改 src 或 test） |
| `ci` | CI 配置变更 |
| `i18n` | 国际化文案变更 |

#### 示例

```
feat(editor): 新增 Ctrl+Shift+G 跳转到指定行功能

- 在 NovelEditor 注册快捷键监听
- CommandPalette 新增「跳转到行」命令
- i18n 添加中英文翻译键

Closes #123
```

### 提交前校验

每次提交前必须通过以下三项校验：

```bash
# 1. TypeScript 类型检查
npx tsc --noEmit

# 2. Rust 后端编译检查
cargo check --manifest-path src-tauri/Cargo.toml

# 3. 前端构建
npm run build
```

### 版本号同步

如提交涉及版本号变更，必须同步以下 7 处位置：

| 文件 | 字段 |
|------|------|
| `package.json` | `version` |
| `src-tauri/Cargo.toml` | `version` |
| `src-tauri/Cargo.lock` | `version`（miaochuangshuo 包条目） |
| `src-tauri/tauri.conf.json` | `version` |
| `src/lib/updateChecker.ts` | `FALLBACK_VERSION` |
| `src/components/Launcher.tsx` | `appVersion` useState 初始值 |
| `src/components/settings/SettingsDialog.tsx` | `currentVersion` useState 初始值 |

版本号格式：`YY.MM.修改序号`（如 `26.7.32`）。

可使用 `scripts/sync-version.mjs` 自动同步版本号：

```bash
node scripts/sync-version.mjs 26.7.32
```

## 图标生成

应用图标统一通过 Tauri 官方工具生成，**禁止**通过其他脚本生成：

```bash
# 准备源图（推荐 1024x1024 PNG 或 SVG）
# 源图位置: src-tauri/icons/icon_source.svg

# 执行 Tauri 官方图标生成命令
npx tauri icon src-tauri/icons/icon_source.svg

# 命令将自动生成全平台图标：
# - src-tauri/icons/icon.png            (512x512)
# - src-tauri/icons/128x128.png
# - src-tauri/icons/128x128@2x.png
# - src-tauri/icons/32x32.png
# - src-tauri/icons/icon.ico            (Windows)
# - src-tauri/icons/icon.icns           (macOS)
# 以及 iOS / Android 各尺寸图标
```

历史脚本 `scripts/archive/generate_icon.py` 已归档，仅作为设计参考，不再用于正式图标生成。

## Pull Request 流程

1. Fork 仓库并创建特性分支：`git checkout -b feat/your-feature`
2. 完成开发并确保通过提交前校验
3. 提交 PR，按 [PR 模板](./.github/PULL_REQUEST_TEMPLATE.md) 填写变更说明
4. 等待维护者 review，根据反馈迭代
5. 合并后由维护者统一发版

## 行为准则

请保持友善、专业、尊重的沟通态度。本项目坚持公益属性，禁止任何形式的商业推广或恶意行为。

## 许可协议

提交的贡献将同样以 [CC-BY-NC-4.0](./LICENSE) 协议授权。
