# 项目模块化重构与潜藏问题修复 Spec

**change-id**: `refactor-project-modularization`
**版本**: 26.7.28 → 26.8.0
**分析基线**: 2026-07-14 全项目深度洞察（前端 32 项 / 后端 23 项 / 全局 10 项问题）

---

## Why

妙创说（MiaoChuangShuo）项目经过长期迭代累积了大量技术债务，主要表现为：

1. **组件层债务**：15 个组件超过 500 行，其中 5 个超过 1000 行，NovelEditor.tsx 达到 1489 行承担 14+ 职责，可维护性严重下降。
2. **架构层债务**：缺少独立 Service 层（api.ts 兼任 Data+Service 双重职责，1052 行上帝文件）；timeline 与 characterGraph 两条业务线在 Store/API/Panel 三层均高度重复（约 90% 代码相同）。
3. **状态层债务**：store.ts 与 slice 间存在 type-only 循环依赖；settingsStore.ts 上帝 store（580 行）；类型文件混入业务函数；派生状态散落于组件内。
4. **后端债务**：fs_commands.rs 2161 行严重过胖混合 6 类职责；全项目使用 `Result<T, String>` 缺少统一错误类型；5 个 struct 缺失 `#[serde(rename_all = "camelCase")]` 违反硬约束；ProjectMeta 命名不一致导致前后端字段错位风险。
5. **工程化债务**：缺少桌面端 CI/CD（违反硬约束要求 MSI + NSIS + GitHub Release）；TipTap 包版本内部不一致；Tailwind 配置未覆盖 web/；13 处 UI 文案硬编码中文违反 i18n 硬约束。

本次重构旨在系统化消除上述债务，恢复项目的可维护性、可扩展性与硬约束合规性，为后续功能演进扫清障碍。

---

## What Changes

### 一、前端组件模块化拆分（P0）

- **拆分 NovelEditor.tsx**（1489 行）：抽取 `useEditorFileIO`、`useEditorAutoSave`、`useEditorMention`、`useEditorAiCommands` 4 个 hooks；独立 `EditorContextMenu`、`EditorHoverCard` 组件；提取 `useEntityHighlightAutomaton`。
- **拆分 SettingsDialog.tsx**（1217 行）：按分区拆分为 `GeneralSettingsSection`、`AiSettingsSection`、`AppearanceSettingsSection`、`AboutSettingsSection` 4 个子组件。
- **拆分 AiAssistantPanel.tsx**（1036 行）：抽取 `AiMessageList`、`AiInputBar`、`useAiStream`、`usePromptBuilder`、`AiMarkdownRenderer`。
- **拆分 Launcher.tsx**（1035 行）：抽取 `ProjectGrid`、`ProjectCreationPanel`、`useProjectScan`、`useVersionCheck`；格式化函数迁移到 `src/lib/formatters.ts`。
- **拆分 FileList.tsx**（1026 行）：抽取 `FileTreeNode`、`useFileDragSort`、`useFileContextMenu`、`useCodexSync`。
- **拆分 EditorToolbar.tsx**（955 行，7 个组件）：按组件拆分到 `src/components/editor-toolbar/` 目录。
- **拆分 TimelinePanel/CharacterGraphPanel**：提取通用 `GraphPanelShell` 高阶组件。

### 二、状态管理重构（P0/P1）

- **打破循环依赖**：将 `SidebarCategory` 类型定义迁移到 `src/lib/stores/types.ts`，store.ts 与各 slice 统一从 types.ts 导入。
- **拆分 settingsStore.ts**（580 行）：拆分为 `editorSettingsStore` 与 `appearanceStore`，DOM 应用逻辑独立为 effect。
- **迁移混入的业务函数**：`preferencesSlice.ts` 的 `getProjectConfig`/`setProjectConfig` 迁移到 `projectConfigApi.ts`；`characterGraphTypes.ts` 的 localStorage CRUD 迁移到 `customRelationStore.ts`。
- **抽象 graph store 工厂**：抽取 `createGraphStore` 工厂消除 characterGraphStore 与 timelineStore 的重复。
- **派生状态下沉**：将 NovelEditor 与 CodexPanel 内的派生计算下沉为 store selector 或独立 memo 工具。
- **修复模块级 saveTimer 单例风险**：将 saveTimer 移入 store state 或使用实例级闭包。

### 三、API 层与 Service 层重构（P0）

- **拆分 api.ts**（1052 行）：按领域拆分为 `projectApi.ts`、`fileApi.ts`、`searchApi.ts`、`snapshotApi.ts`、`indexApi.ts`、`aiContextApi.ts`。
- **抽象 graph API 工厂**：抽取 `createGraphApi` 工厂消除 characterGraphApi 与 timelineApi 的重复。
- **修复 UI 层裸 invoke**：SettingsDialog.tsx:272 改用 `aiService.setAiConfig`；检查并修复 `handleTestAiConnection`。
- **引入 Service 层封装**：为 Sidebar、Launcher、Workspace、NovelEditor、FileList 等组件的 API 调用补充 Service 层封装，强制 UI 层不直接访问 Data 层。
- **引入统一日志服务**：替代全项目散落的 24 处 `console.error/warn`。

### 四、工具函数与业务逻辑解耦（P0）

- **重构 characterMention.ts**（657 行）：将 picker 浮层从 DOM 构建逻辑提取为 React 组件 `CharacterMentionPicker.tsx`，通过 TipTap suggestion 插件渲染。
- **迁移 filterCollapsed 纯函数**：从 timelineStore.ts 迁移到 `src/lib/graphUtils.ts`。

### 五、后端 Rust 模块化拆分（P0）

- **拆分 fs_commands.rs**（2161 行）：按职责拆分为 `project_commands.rs`、`file_io_commands.rs`、`search_replace_commands.rs`、`writing_stats_commands.rs`、`custom_template_commands.rs`、`archive_commands.rs` 6 个模块；Tantivy 同步钩子迁移到 `index_sync.rs`。
- **拆分 ai_context.rs**（992 行）：拆分为 `ai_context/scene.rs`、`ai_context/character.rs`、`ai_context/project.rs` + `prosemirror_parser.rs` 公共模块。
- **拆分 codex_commands.rs**（985 行）：拆分为 `codex_parser.rs`、`codex_migration.rs`、`codex_crud.rs`、`codex_scan.rs`。
- **外置 template_schema.rs**（917 行）：将 10 个硬编码预设模板外置为 `templates/*.toml` 数据文件，代码仅保留加载器。
- **拆分 lib.rs invoke_handler**：在各业务模块新建 `register_commands(builder: &mut tauri::Builder)` 函数，lib.rs 依次调用聚合。

### 六、后端错误处理统一（P0）

- **引入 thiserror 依赖**：在 Cargo.toml 添加 `thiserror = "1"`。
- **新建 src-tauri/src/error.rs**：定义 `AppError` 枚举（IoError、SerializeError、PathValidationError、IndexError、AiError、ConfigError），实现 `From` 转换与 `serde::Serialize`。
- **迁移全项目错误类型**：将所有 `Result<T, String>` 替换为 `Result<T, AppError>`，试点迁移 `editor_preferences.rs`。

### 七、后端 serde 注解修复（P0，硬约束）

- 修复 `EditorPreferences`、`ProjectConfig`、`CodexMeta`、`CodexMetaPatch` 缺失 `#[serde(rename_all = "camelCase")]` 的违规。
- **修复 ProjectMeta 命名不一致**：使用 `#[serde(rename_all = "camelCase")]` + `#[serde(alias = "type")]` 兼容旧 meta.json 文件，新写入使用 `projectType`。**BREAKING**：旧 meta.json 的 `"type"` 字段需通过 alias 兼容读取，新写入为 `"projectType"`。

### 八、后端健壮性修复（P1）

- **修复 unwrap 风险**：`ai_context.rs:256`、`:332` 改为 `if let Some(...)` 模式。
- **删除重复字数统计**：`ai_context.rs` 的 `count_chinese_and_words` 删除，复用 `word_count.rs::count_words`。
- **Tantivy IndexHandle 缓存**：引入 `static INDEX_CACHE` 缓存打开的索引，避免重复 open_or_create。
- **Tantivy 并发 IndexWriter 串行化**：在 IndexHandle 中以 `Mutex<IndexWriter>` 串行化写入。
- **实现 scene_id 字段**：从 ProseMirror sceneBreak 节点提取 scene_id 写入索引。
- **修复 character_commands.rs**：`read_character_summary` 兼容 `.pmd` 格式。

### 九、工程化修复（P0/P1，硬约束）

- **新增桌面端 CI/CD 工作流**：创建 `.github/workflows/release-desktop.yml`，在 `v*` tag 推送时触发 Windows runner 执行 `npm run tauri build`，通过 `softprops/action-gh-release` 上传 MSI + NSIS 产物。
- **对齐 TipTap 包版本**：将 `@tiptap/react` 与 `@tiptap/extension-placeholder` 同步至 `^2.27.2`。
- **修复 Tailwind 配置**：在 `content` 中追加 `"./web/**/*.{js,ts,jsx,tsx}"` 与 `"./web/index.html"`。
- **补全 i18n 硬编码**：为 13 处 UI 文案补 key（CharacterGraphEdgeDrawer 8 处、TimelinePanel 1 处、toast 2 处、characterGraphTypes 1 处、timelineTypes 3 处）。
- **扩展 .gitignore**：追加 `migration_backup_*/` 与 `**/migration_backup_*/` 覆盖更广迁移备份目录。

### 十、类型安全与代码异味修复（P2）

- **修复定时器未清理**：NovelEditor.tsx:909、AiAssistantPanel.tsx:720 等保存 timer 引用并在卸载时 clearTimeout。
- **补全 async 函数 try-catch**：全项目扫描 async 函数并验证 try-catch 覆盖率。
- **修复 App.tsx:52 未处理 rejection**：添加 `.catch` 静默处理。
- **补充 store action 返回类型注解**：全项目 store 文件补充显式返回类型注解。
- **归档 generate_icon.py**：迁移到 `scripts/` 目录或归档（与 `npx tauri icon` 官方流程二选一）。

---

## Impact

### 受影响的 spec 能力

- **编辑器能力**：NovelEditor 拆分影响所有编辑场景
- **AI 助手能力**：AiAssistantPanel 拆分影响续写/对话/一致性检查
- **项目管理能力**：Launcher/FileList 拆分影响项目创建与文件管理
- **设定库能力**：CodexPanel 重构影响设定卡片管理
- **时间线/人物关系图能力**：Graph 工厂抽象影响两条业务线
- **搜索能力**：Tantivy IndexHandle 重构影响全项目索引
- **配置能力**：SettingsDialog 拆分影响所有设置项
- **版本发布能力**：CI/CD 工作流新增影响发布流程

### 受影响的关键代码

**前端**：
- `src/components/NovelEditor.tsx`（拆分）
- `src/components/SettingsDialog.tsx`（拆分）
- `src/components/AiAssistantPanel.tsx`（拆分）
- `src/components/Launcher.tsx`（拆分）
- `src/components/FileList.tsx`（拆分）
- `src/components/EditorToolbar.tsx`（拆分）
- `src/components/TimelinePanel.tsx`、`CharacterGraphPanel.tsx`（Graph 抽象）
- `src/lib/api.ts`（拆分）
- `src/lib/store.ts`、`viewSlice.ts`、`categorySlice.ts`、`types.ts`（循环依赖修复）
- `src/lib/settingsStore.ts`（拆分）
- `src/lib/characterMention.ts`（picker 重构）
- `src/lib/characterGraphApi.ts`、`timelineApi.ts`（工厂抽象）
- `src/lib/stores/characterGraphStore.ts`、`timelineStore.ts`（工厂抽象）
- `src/lib/characterGraphTypes.ts`（业务函数迁移）

**后端**：
- `src-tauri/src/fs_commands.rs`（拆分）
- `src-tauri/src/ai_context.rs`（拆分）
- `src-tauri/src/codex_commands.rs`（拆分）
- `src-tauri/src/template_schema.rs`（外置数据）
- `src-tauri/src/lib.rs`（invoke_handler 拆分）
- `src-tauri/src/editor_preferences.rs`（serde 修复 + 错误类型迁移试点）
- `src-tauri/src/codex_commands.rs`（serde 修复）
- `src-tauri/src/project_template.rs`（ProjectMeta serde 修复，**BREAKING**）
- `src-tauri/src/tantivy_indexer.rs`、`tantivy_search.rs`（IndexHandle 缓存）
- `src-tauri/src/ai_commands.rs`（取消令牌优化）
- `src-tauri/Cargo.toml`（添加 thiserror）

**工程化**：
- `.github/workflows/release-desktop.yml`（新增）
- `package.json`（TipTap 版本对齐）
- `tailwind.config.js`（content 补全）
- `src/lib/i18n.tsx`（补 13 个 key）
- `.gitignore`（扩展迁移备份规则）

---

## ADDED Requirements

### Requirement: 统一错误类型 AppError

系统 SHALL 在 `src-tauri/src/error.rs` 中定义统一的 `AppError` 枚举，覆盖 IO、序列化、路径校验、索引、AI 调用、配置六类错误，实现 `From` 转换与 `serde::Serialize`，输出 `{ kind, message, context }` 结构供前端消费。

#### Scenario: 错误返回前端
- **WHEN** Rust 命令执行失败
- **THEN** 前端 invoke 捕获的结构化错误对象包含 `kind`、`message`、`context` 字段
- **AND** 错误信息支持 i18n 本地化（前端根据 kind 映射到 i18n key）

### Requirement: 桌面端 CI/CD 自动发布

系统 SHALL 在 `v*` tag 推送时触发 GitHub Actions 工作流，于 `windows-latest` runner 上执行 `npm run tauri build`，并通过 `softprops/action-gh-release` 自动创建 GitHub Release 并上传 MSI 与 NSIS 安装包。

#### Scenario: 发布新版本
- **WHEN** 维护者推送 `v26.8.0` tag
- **THEN** GitHub Actions 自动执行构建
- **AND** 构建产物 `MiaoChuangShuo_26.8.0_x64.msi` 与 `MiaoChuangShuo_26.8.0_x64-setup.exe` 自动上传至 GitHub Release
- **AND** Release 名称与 tag 一致，包含 changelog

### Requirement: Graph 业务线工厂抽象

系统 SHALL 提供 `createGraphStore` 与 `createGraphApi` 工厂函数，消除时间线与人物关系图两条业务线在 Store/API/Panel 三层的代码重复。

#### Scenario: 新增第三种图业务
- **WHEN** 未来需要新增「势力关系图」等新业务
- **THEN** 通过工厂配置即可生成完整 Store/API/Panel 三层实现
- **AND** 新业务自动获得撤销重做、拖拽保存、自动布局等能力

### Requirement: 统一日志服务

系统 SHALL 提供统一 logger 服务替代散落的 `console.error/warn`，支持日志级别（debug/info/warn/error）与生产环境静默。

#### Scenario: 生产环境日志降级
- **WHEN** 应用构建为生产版本
- **THEN** logger 默认仅输出 error 级别日志
- **AND** 开发环境可通过环境变量调整日志级别

---

## MODIFIED Requirements

### Requirement: 前端组件结构

所有超过 500 行的组件 SHALL 拆分为单一职责的子组件与 hooks，单组件文件不得超过 500 行（不含类型定义与注释）。`NovelEditor`、`SettingsDialog`、`AiAssistantPanel`、`Launcher`、`FileList`、`EditorToolbar` 等过胖组件 MUST 按职责拆分。

### Requirement: 状态管理分层

Store 文件 SHALL 仅包含状态定义与 action，禁止混入 API 调用函数（应迁移到 Service 层）或 localStorage CRUD 业务函数（应迁移到独立 service）。`SidebarCategory` 类型定义 SHALL 统一位于 `src/lib/stores/types.ts`，store.ts 与各 slice 从该文件导入，消除循环依赖。

### Requirement: API 层职责

`api.ts` SHALL 按领域拆分为 `projectApi.ts`、`fileApi.ts`、`searchApi.ts`、`snapshotApi.ts`、`indexApi.ts`、`aiContextApi.ts`，单一 API 文件不得超过 300 行。UI 层 SHALL 通过 Service 层调用 API，禁止直接调用 `invoke` 或直接导入 `api.ts` 函数。

### Requirement: 后端模块结构

后端 Rust 模块 SHALL 按单一职责拆分，单一 `.rs` 文件不得超过 600 行（不含测试代码）。`fs_commands.rs`、`ai_context.rs`、`codex_commands.rs`、`template_schema.rs` 等过胖模块 MUST 拆分。`lib.rs` 的 `invoke_handler` SHALL 通过各模块的 `register_commands` 函数聚合注册。

### Requirement: Rust 错误处理

所有 Tauri 命令 SHALL 返回 `Result<T, AppError>` 而非 `Result<T, String>`。生产代码 SHALL 禁止使用 `unwrap`/`expect`/`panic`（除应用启动入口），改用 `if let Some(...)` 或 `?` 操作符。

### Requirement: Rust 序列化一致性

所有传递到前端的 Rust struct SHALL 添加 `#[serde(rename_all = "camelCase")]`。`ProjectMeta` struct 的 `project_type` 字段 SHALL 序列化为 `projectType`，同时通过 `#[serde(alias = "type")]` 兼容旧 `meta.json` 文件反序列化。

### Requirement: Tantivy 索引管理

系统 SHALL 通过 `IndexHandle` 缓存打开的索引，避免每次命令重复 `open_or_create_index`。`IndexWriter` SHALL 通过 `Mutex` 串行化写入，避免并发 panic。`scene_id` 字段 SHALL 从 ProseMirror sceneBreak 节点提取真实值写入索引。

### Requirement: 国际化完整性

所有 UI 文案 SHALL 通过 i18n key 引用，禁止硬编码中文。`CharacterGraphEdgeDrawer`、`TimelinePanel`、`toast`、`characterGraphTypes`、`timelineTypes` 中遗漏的 13 处硬编码 SHALL 补充对应 i18n key。

### Requirement: CI/CD 完整性

GitHub Actions SHALL 同时维护 Web 部署（`deploy-web.yml`）与桌面端发布（`release-desktop.yml`）两个工作流。桌面端工作流 SHALL 在 tag 推送时触发，生成 MSI + NSIS 安装包并创建 GitHub Release。

### Requirement: 依赖版本一致性

同一生态的 npm 包 SHALL 使用一致的版本号。`@tiptap/react`、`@tiptap/extension-placeholder` SHALL 与其他 `@tiptap/extension-*` 包保持版本同步（`^2.27.2`）。

### Requirement: Tailwind 配置覆盖

`tailwind.config.js` 的 `content` 字段 SHALL 覆盖所有使用 Tailwind 类名的源码目录，包括 `./src/**`、`./web/**`、`./index.html`、`./web/index.html`。

---

## REMOVED Requirements

### Requirement: 字符串错误类型

**Reason**: `Result<T, String>` 无法承载结构化错误信息，前端无法区分错误类型进行差异化处理，且字符串拼接容易产生格式不一致。
**Migration**: 全项目迁移至 `Result<T, AppError>`，前端通过 `error.kind` 字段判断错误类型，i18n key 前缀统一为 `error.{kind}`。

### Requirement: 硬编码预设模板

**Reason**: `template_schema.rs` 中 10 个硬编码预设模板函数使模板内容与代码耦合，新增/修改模板需重新编译，违反开闭原则。
**Migration**: 模板内容外置为 `src-tauri/templates/*.toml` 数据文件，`template_schema.rs` 仅保留加载器与 schema 定义。旧模板内容完整迁移至数据文件，加载器首次运行时验证文件完整性。

### Requirement: 模块级 saveTimer 单例

**Reason**: `characterGraphStore` 与 `timelineStore` 使用模块级 `saveTimer` 变量，多实例场景下防抖定时器会互相干扰。
**Migration**: 将 `saveTimer` 移入 store state 或使用实例级闭包，确保每个 store 实例拥有独立的防抖定时器。
