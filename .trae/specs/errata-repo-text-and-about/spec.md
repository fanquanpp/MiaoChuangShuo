# 仓库全量文本信息勘误与补全 Spec

## Why

MiaoChuangShuo 仓库在长期迭代中累积了多处文本信息失同步、链接缺失、版本号错位、页面状态过期等问题，主要表现为：
1. README 中存在版本号错位（8.8 节提及 `v26.8.0` 但当前实际版本为 `v26.7.32`）、版本同步清单与实际代码结构不符（仍引用不存在的 `src/components/settings/SettingsDialog.tsx` 路径与已迁移至 `AboutSettingsSection.tsx` 的 `currentVersion`）
2. LICENSE 文件缺少版权署名行，与 `tauri.conf.json` 中已声明的 `Copyright (c) 2026 fanquanpp` 不一致
3. DISCLAIMER.md 缺少「最后更新」时间戳，无法判断条款时效性
4. CONTRIBUTING.md 与 PR 模板的「版本号同步位置」描述自相矛盾（前者 7 处、后者 6 处），且均引用了已失效的 `SettingsDialog.tsx` 路径
5. AboutSettingsSection.tsx 致谢列表不完整（缺 cmdk / zundo / framer-motion / @dagrejs/dagre 等核心依赖），「免责声明」区仅展示文字、未提供跳转 GitHub 原文链接，「项目主页」区缺失 Web 在线体验版与 TRAE 报名网页入口
6. bug_report.yml 占位版本号 `v26.8.0` 与当前 `v26.7.32` 不符
7. docs/index.html（TRAE 报名页）路线图状态严重过期：AI 辅助创作集成仍标为「进行中」实际已完成；核心功能模块计数 "9 modules" 与实际渲染 8 张卡片不符；题材模板描述「四种题材」与 README「3 种文体模板」冲突
8. README「项目主页」区与 AboutSettingsSection 的链接资源未对齐，Web 在线体验版 / 报名网页入口仅在 README 出现，About 栏未曝光

本任务旨在一次性勘误补全仓库所有文本信息，统一版本号引用、补齐缺失链接、修正过期状态、对齐各文档互引，使 README / LICENSE / DISCLAIMER / SECURITY / CONTRIBUTING / About 栏 / Issue 模板 / 报名页 全部保持一致并反映当前 `v26.7.32` 真实状态。

## What Changes

### 文档层勘误（无代码逻辑变更）

- **README.md**:
  - 修正 8.8 节「v26.8.0 起改用 DPAPI 加密」为「v26.7.32 起」（与当前版本对齐，DPAPI 实际在 v26.7.32 已落地）
  - 修正 7.3 节「版本号同步机制」表格：将 `src/components/settings/SettingsDialog.tsx` 修正为 `src/components/settings/AboutSettingsSection.tsx`（字段 `currentVersion` useState 初始值），并补充说明 `Launcher.tsx` 的 `appVersion` 经 `useVersionCheck` hook 间接依赖 `FALLBACK_VERSION`，明确 5 处硬编码位置 + 2 处 hook 派生位置共 7 处需保持一致
  - 补充 8.10 节「Web 在线体验版与报名页」说明，明确 https://fanquanpp.github.io/MiaoChuangShuo/ 与 /docs/ 两个 Pages 入口的用途差异
  - 在「相关文档」区追加 docs/index.html（TRAE 报名页）的 GitHub 直链与在线 Pages 链接
- **LICENSE**:
  - 顶部追加版权署名行：`Copyright (c) 2026 fanquanpp`
  - 保留 CC-BY-NC-4.0 完整法律文本不动，仅追加版权头
- **DISCLAIMER.md**:
  - 顶部追加「最后更新：2026 年 7 月」时间戳
  - 文末追加「当前适用版本：v26.7.32」标注
- **CONTRIBUTING.md**:
  - 修正「版本号同步」表格：将 `src/components/settings/SettingsDialog.tsx` 修正为 `src/components/settings/AboutSettingsSection.tsx`
  - 同步说明 Launcher.tsx 通过 useVersionCheck hook 派生 appVersion 的机制
- **SECURITY.md**:
  - 顶部追加「最后更新：2026 年 7 月」时间戳
  - AI Key 安全说明区追加「当前实现版本：v26.7.32」标注
- **.github/ISSUE_TEMPLATE/bug_report.yml**:
  - 占位版本号从 `v26.8.0` 改为 `v26.7.32`
- **.github/PULL_REQUEST_TEMPLATE.md**:
  - 修正「涉及版本号变更已同步 6 处位置」为「7 处位置」
  - 同步修正路径列表，将 SettingsDialog.tsx 改为 AboutSettingsSection.tsx
- **docs/index.html（TRAE 报名页）**:
  - 修正路线图：「26.8.x AI 辅助创作集成」状态从「进行中」改为「已完成」，版本号改为「26.7.32 已完成」
  - 修正核心功能区「9 modules」为「8 modules」（与实际渲染卡片数一致）
  - 修正「题材模板生成」卡片描述：将「内置标准长篇、散文随笔、舞台剧本、西幻史诗四种题材模板」改为「内置长篇小说（Novel）、剧本与脚本（Script）、散文与文章（Essay）3 种文体模板」（与 README 1.5 节一致）
  - 页脚追加「免责声明」与「隐私政策」内部锚点链接，对齐 FANDEX-web 报名页结构

### AboutSettingsSection.tsx 完善（UI 文本与链接扩展）

- **致谢列表补全**：在现有 8 项基础上追加 5 项核心依赖，使总数达 13 项：
  - `@xyflow/react`（图谱引擎，注：React Flow 已在列表，追加官方包名以区分库与组件）
  - `cmdk`（命令面板引擎）
  - `zundo`（Zustand 时间旅行中间件）
  - `framer-motion`（弹簧物理动画）
  - `@dagrejs/dagre`（DAG 自动布局算法）
  - **注意**：为避免与 React Flow 重复，将现有 "React Flow" 条目保留，新追加的 @xyflow/react 作为官方 npm 包名独立列出，描述侧重「受控节点/边系统」与 React Flow 条目「可定制化图谱/节点编辑器 React 库」形成互补
- **免责声明区补全跳转链接**：在现有文字描述下方追加「查看完整免责声明」按钮，跳转至 `https://github.com/fanquanpp/MiaoChuangShuo/blob/master/DISCLAIMER.md`
- **新增「项目主页」区**：在作者信息区下方新增一个卡片，包含 4 个外链按钮：
  - Web 在线体验版 → `https://fanquanpp.github.io/MiaoChuangShuo/`
  - TRAE 报名展示页 → `https://fanquanpp.github.io/MiaoChuangShuo/docs/`
  - GitHub 仓库 → `https://github.com/fanquanpp/MiaoChuangShuo`（与作者信息区按钮形成主页/资源双入口）
  - GitHub Releases → `https://github.com/fanquanpp/MiaoChuangShuo/releases`（同上）
- **开源协议区追加 SECURITY.md 与 CONTRIBUTING.md 链接**：在现有「查看完整协议文本」按钮下方追加两个辅助链接：
  - 查看安全政策 → `https://github.com/fanquanpp/MiaoChuangShuo/blob/master/SECURITY.md`
  - 查看贡献指南 → `https://github.com/fanquanpp/MiaoChuangShuo/blob/master/CONTRIBUTING.md`

### i18n.tsx 配套键补全

- 在 `about.*` 命名空间下新增以下键（中/英双语）：
  - `about.projectHome` / `about.projectHomeDesc`
  - `about.webDemo` / `about.trafeShowcase`
  - `about.viewDisclaimer` / `about.viewSecurity` / `about.viewContributing`
  - `about.acknowledgment.@xyflowReact` / `about.acknowledgment.cmdk` / `about.acknowledgment.zundo` / `about.acknowledgment.framerMotion` / `about.acknowledgment.dagre`（若采用描述式键名，则直接在 acknowledgments 数组中追加 desc 文案，无需新增 i18n 键）

## Impact

- **Affected specs**: 无（本次为文本勘误，不修改任何现有 spec 的功能契约）
- **Affected code**:
  - `README.md`（勘误 + 补全）
  - `LICENSE`（追加版权头）
  - `DISCLAIMER.md`（追加时间戳与版本标注）
  - `CONTRIBUTING.md`（修正版本同步路径）
  - `SECURITY.md`（追加时间戳与版本标注）
  - `.github/ISSUE_TEMPLATE/bug_report.yml`（修正占位版本号）
  - `.github/PULL_REQUEST_TEMPLATE.md`（修正同步位置描述）
  - `docs/index.html`（修正路线图状态、模块计数、题材模板描述、页脚链接）
  - `src/components/settings/AboutSettingsSection.tsx`（致谢补全、免责声明跳转、项目主页区、协议区辅助链接）
  - `src/lib/i18n.tsx`（如采用 i18n 键方案则追加键，否则仅扩展 acknowledgments 数组）
- **不受影响**:
  - Rust 后端代码（无逻辑变更）
  - 前端业务逻辑（仅扩展静态数据与 UI 元素）
  - 构建产物结构（不新增/删除文件）
  - 版本号本身（仍保持 v26.7.32，仅修正文档对版本号的引用错误）

## ADDED Requirements

### Requirement: About 栏「项目主页」区

AboutSettingsSection SHALL 在作者信息区下方新增「项目主页」区，提供 4 个外链按钮（Web 在线体验版 / TRAE 报名展示页 / GitHub 仓库 / GitHub Releases），与 README「项目主页」区保持链接一致。

#### Scenario: 用户从 About 栏访问在线体验版
- **WHEN** 用户在设置对话框打开「关于」分区
- **THEN** 应在作者信息区下方看到「项目主页」区
- **AND** 该区应包含 4 个按钮，分别指向 fanquanpp.github.io/MiaoChuangShuo/ 、/docs/ 子路径、GitHub 仓库主页、GitHub Releases 页
- **AND** 点击任一按钮应通过 `openExternalUrl` 在系统默认浏览器打开

### Requirement: About 栏致谢列表完整覆盖核心依赖

AboutSettingsSection 的 acknowledgments 数组 SHALL 至少包含 13 项核心依赖，覆盖 Tauri / React / TipTap / React Flow / Tantivy / Zustand / lucide-react / Tailwind CSS / @xyflow/react / cmdk / zundo / framer-motion / @dagrejs/dagre。

#### Scenario: 致谢列表完整展示
- **WHEN** 用户展开致谢折叠区
- **THEN** 应看到至少 13 个依赖条目
- **AND** 每个条目应包含 name / url / desc 三字段
- **AND** 点击条目名称应跳转至对应官方仓库或官网

### Requirement: About 栏免责声明跳转

AboutSettingsSection 的免责声明区 SHALL 在文字描述下方提供「查看完整免责声明」按钮，跳转至 GitHub 仓库 master 分支的 DISCLAIMER.md 原文。

#### Scenario: 跳转完整免责声明
- **WHEN** 用户点击「查看完整免责声明」按钮
- **THEN** 应通过 `openExternalUrl` 打开 `https://github.com/fanquanpp/MiaoChuangShuo/blob/master/DISCLAIMER.md`

## MODIFIED Requirements

### Requirement: 仓库文本信息版本一致性

所有仓库可见文本（README / LICENSE / DISCLAIMER / SECURITY / CONTRIBUTING / Issue 模板 / PR 模板 / About 栏 / TRAE 报名页）SHALL 对版本号的引用保持一致，统一为 `v26.7.32`，禁止出现 `v26.8.0` 或其他过期版本号（历史 changelog 与 Roadmap「已完成」区中标注历史版本号的情况除外）。

#### Scenario: 文档版本号统一
- **WHEN** 用户浏览任一仓库文档
- **THEN** 当前状态描述中的版本号应为 `v26.7.32`
- **AND** bug_report.yml 占位符应为 `v26.7.32`
- **AND** README 8.8 节 DPAPI 起始版本应为 `v26.7.32`
- **AND** TRAE 报名页 AI 辅助创作集成状态应为「已完成」

### Requirement: 版本号同步位置描述准确

README 7.3 节与 CONTRIBUTING.md 的版本号同步表格 SHALL 准确反映当前代码结构：
- 5 处硬编码位置：`package.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json` / `src/lib/updateChecker.ts`（FALLBACK_VERSION）
- 2 处 hook 派生位置：`src/components/Launcher.tsx`（appVersion 经 useVersionCheck 派生自 FALLBACK_VERSION）/ `src/components/settings/AboutSettingsSection.tsx`（currentVersion 经 useState(FALLBACK_VERSION) 派生）
- 禁止引用不存在的 `src/components/settings/SettingsDialog.tsx` 路径

#### Scenario: 同步表格准确
- **WHEN** 维护者阅读 README 7.3 节或 CONTRIBUTING.md 同步表格
- **THEN** 表格应列出 7 行
- **AND** 第 6 行应为 `src/components/Launcher.tsx` `appVersion`（经 useVersionCheck hook 派生）
- **AND** 第 7 行应为 `src/components/settings/AboutSettingsSection.tsx` `currentVersion` useState 初始值
- **AND** 不应出现 `src/components/settings/SettingsDialog.tsx` 路径

### Requirement: LICENSE 版权署名

LICENSE 文件 SHALL 在 CC-BY-NC-4.0 法律文本顶部追加版权署名行 `Copyright (c) 2026 fanquanpp`，与 `tauri.conf.json` 中 `bundle.copyright` 字段保持一致。

#### Scenario: LICENSE 版权头存在
- **WHEN** 用户打开 LICENSE 文件
- **THEN** 第一行应为 `Copyright (c) 2026 fanquanpp`
- **AND** 后续应为 CC-BY-NC-4.0 标准法律文本

### Requirement: 文档时效性标注

DISCLAIMER.md 与 SECURITY.md SHALL 在文件顶部标注「最后更新：2026 年 7 月」时间戳，并在合适位置标注「当前适用版本：v26.7.32」，使用户能快速判断条款时效。

#### Scenario: 时效性标注可见
- **WHEN** 用户打开 DISCLAIMER.md 或 SECURITY.md
- **THEN** 顶部应看到「最后更新：2026 年 7 月」
- **AND** 文末或合适位置应看到「当前适用版本：v26.7.32」

### Requirement: TRAE 报名页路线图状态准确

docs/index.html 的路线图 SHALL 反映当前 v26.7.32 实际状态：
- 「26.7.1 - 26.7.20 核心工作站搭建」状态保持「已完成」
- 「26.8.x AI 辅助创作集成」状态从「进行中」改为「已完成」（实际已在 v26.7.32 落地 BYOK + 4 层上下文 + 5 任务类型）
- 「26.9.x 跨平台扩展」保持「规划中」
- 「26.10.x 移动端创作同步」保持「规划中」

#### Scenario: 路线图状态准确
- **WHEN** 用户访问 TRAE 报名页路线图区
- **THEN** AI 辅助创作集成条目应标注「已完成」
- **AND** 版本号描述应反映 v26.7.32 已完成状态

### Requirement: TRAE 报名页核心功能描述与 README 一致

docs/index.html 的核心功能区 SHALL 与 README 1.5 节「项目管理」描述保持一致：
- 模块计数从 "9 modules" 改为 "8 modules"
- 「题材模板生成」卡片描述从「四种题材模板」改为「3 种文体模板：长篇小说 / 剧本与脚本 / 散文与文章」

#### Scenario: 题材模板描述一致
- **WHEN** 用户阅读 TRAE 报名页核心功能区的「题材模板生成」卡片
- **THEN** 描述应与 README 1.5 节一致
- **AND** 模块计数应与实际渲染卡片数一致

## REMOVED Requirements

无。本次任务为勘误与补全，不删除任何现有功能或文档。
