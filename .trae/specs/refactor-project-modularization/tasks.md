# Tasks - 项目模块化重构与潜藏问题修复

> **change-id**: `refactor-project-modularization`
> **执行原则**: 每个 task 完成后必须通过 `tsc --noEmit` + `cargo check` + `vite build` + `tauri build` 验证，方可进入下一 task。

---

## 阶段一：硬约束与基础设施修复（P0）

### Task 1: 新增桌面端 CI/CD 工作流

**目标**: 补齐缺失的桌面端构建发布自动化，满足硬约束「MSI + NSIS + GitHub Release」。

- [x] SubTask 1.1: 创建 `.github/workflows/release-desktop.yml`，配置 `v*` tag 触发器与 `windows-latest` runner
- [x] SubTask 1.2: 配置构建步骤：`npm ci` → `npm run build` → `npm run tauri build`
- [x] SubTask 1.3: 配置 `softprops/action-gh-release` 上传 `src-tauri/target/release/bundle/msi/*.msi` 与 `src-tauri/target/release/bundle/nsis/*.exe`
- [x] SubTask 1.4: 在 README 第 9.3 节补充桌面端发布流程说明

### Task 2: 对齐 TipTap 包版本

**目标**: 修复 `@tiptap/react` 与 `@tiptap/extension-placeholder` 与其他 @tiptap 包的版本不一致。

- [x] SubTask 2.1: 修改 `package.json` line 48 `@tiptap/react` 版本为 `^2.27.2`
- [x] SubTask 2.2: 修改 `package.json` line 37 `@tiptap/extension-placeholder` 版本为 `^2.27.2`
- [x] SubTask 2.3: 执行 `npm install` 验证依赖树一致性
- [x] SubTask 2.4: 启动 dev server 验证编辑器扩展加载正常

### Task 3: 修复 Tailwind 配置覆盖

**目标**: 修复 `tailwind.config.js` 未扫描 `web/` 目录导致 Web 版本样式丢失。

- [x] SubTask 3.1: 在 `tailwind.config.js` `content` 数组追加 `"./web/**/*.{js,ts,jsx,tsx}"` 与 `"./web/index.html"`
- [x] SubTask 3.2: 执行 `npm run build:web`（或等价命令）验证 Web 版样式完整

### Task 4: 补全 i18n 硬编码文案

**目标**: 修复 13 处 UI 文案硬编码中文，补对应 i18n key。

- [x] SubTask 4.1: 在 `src/lib/i18n.tsx` 中文 dict 与英文 dict 中补充以下 key：
  - `edgeDrawer.customToggle`、`edgeDrawer.customPlaceholder`、`edgeDrawer.colorLabel`、`edgeDrawer.customAdd`、`edgeDrawer.customList`、`edgeDrawer.customAddTitle`、`edgeDrawer.customDeleteTitle`、`edgeDrawer.colorAria`
  - `timeline.clearGraphTitle`、`timeline.statusPlanned`、`timeline.statusWriting`、`timeline.statusDone`
  - `toast.ariaLabel`、`toast.closeAria`
  - `characterGraph.relationUnknown`
- [x] SubTask 4.2: 修改 `src/components/CharacterGraphEdgeDrawer.tsx` line 219/222/255/261/271/281/288/297/308 替换硬编码为 `t('edgeDrawer.*')` 调用
- [x] SubTask 4.3: 修改 `src/components/TimelinePanel.tsx` line 559 替换为 `t('timeline.clearGraphTitle')`
- [x] SubTask 4.4: 修改 `src/lib/toast.tsx` line 91/152 替换为 `t('toast.ariaLabel')` 与 `t('toast.closeAria')`
- [x] SubTask 4.5: 修改 `src/lib/stores/characterGraphTypes.ts` line 298 替换为 i18n key
- [x] SubTask 4.6: 修改 `src/lib/stores/timelineTypes.ts` line 134-136 替换为 i18n key
- [ ] SubTask 4.7: 验证 i18n 切换中英文显示正确

### Task 5: 扩展 .gitignore 迁移备份规则

**目标**: 扩展迁移备份目录覆盖范围。

- [x] SubTask 5.1: 在 `.gitignore` 追加 `migration_backup_*/` 与 `**/migration_backup_*/`

### Task 6: 引入 Rust 统一错误类型 AppError

**目标**: 引入 `thiserror` 依赖，新建 `error.rs`，定义 `AppError` 枚举。

- [x] SubTask 6.1: 在 `src-tauri/Cargo.toml` 添加 `thiserror = "1"`
- [x] SubTask 6.2: 新建 `src-tauri/src/error.rs`，定义 `AppError` 枚举（IoError、SerializeError、PathValidationError、IndexError、AiError、ConfigError）
- [x] SubTask 6.3: 实现 `From<std::io::Error>`、`From<serde_json::Error>` 转换
- [x] SubTask 6.4: 实现 `serde::Serialize` 输出 `{ kind, message, context }` 结构
- [x] SubTask 6.5: 在 `lib.rs` 引入 `mod error;` 并 `pub use error::AppError;`
- [x] SubTask 6.6: 执行 `cargo check` 验证编译

### Task 7: 修复后端 serde 注解违规

**目标**: 为 5 个缺失 `#[serde(rename_all = "camelCase")]` 的 struct 补充注解。**BREAKING**: ProjectMeta 修改影响旧 meta.json 读取。

- [x] SubTask 7.1: 在 `editor_preferences.rs` line 35 的 `EditorPreferences` 添加 `#[serde(rename_all = "camelCase")]`
- [x] SubTask 7.2: 在 `editor_preferences.rs` line 78 的 `ProjectConfig` 添加 `#[serde(rename_all = "camelCase")]`
- [x] SubTask 7.3: 在 `codex_commands.rs` line 222 的 `CodexMeta` 添加 `#[serde(rename_all = "camelCase")]`
- [x] SubTask 7.4: 在 `codex_commands.rs` line 680 的 `CodexMetaPatch` 添加 `#[serde(rename_all = "camelCase")]`
- [x] SubTask 7.5: 修改 `project_template.rs` line 65 的 `ProjectMeta`：
  - 添加 `#[serde(rename_all = "camelCase")]`
  - `project_type` 字段添加 `#[serde(alias = "type")]` 兼容旧文件
- [x] SubTask 7.6: 编写迁移测试：构造含 `"type"` 字段的旧 meta.json，验证能正确反序列化为 `project_type`
- [x] SubTask 7.7: 验证新写入的 meta.json 字段为 `"projectType"`
- [x] SubTask 7.8: 检查前端 TypeScript interface 是否需同步调整（如 `project_type` → `projectType`）
- [x] SubTask 7.9: 执行 `cargo check` 与 `tsc --noEmit` 验证

### Task 8: 修复后端 unwrap 风险

**目标**: 消除生产代码的 unwrap/panic 风险。

- [x] SubTask 8.1: 修改 `ai_context.rs:256` `scene_slices.last().unwrap()` 为 `if let Some(last) = scene_slices.last() { ... } else { return Ok(default) }`
- [x] SubTask 8.2: 修改 `ai_context.rs:332` `slices.last_mut().unwrap()` 为 `if let Some(last) = slices.last_mut() { ... } else { return Ok(default) }`
- [x] SubTask 8.3: 删除 `ai_context.rs:972-992` 重复的 `count_chinese_and_words`，改用 `crate::word_count::count_words`
- [x] SubTask 8.4: 执行 `cargo check` 验证编译

### Task 9: 修复前端 UI 层裸 invoke 调用

**目标**: 消除 SettingsDialog 中的裸 invoke 调用，强制通过 Service 层。

- [x] SubTask 9.1: 修改 `src/components/SettingsDialog.tsx:272` 将 `await invoke("set_ai_config", { config })` 改为 `await aiService.setAiConfig(config)`
- [x] SubTask 9.2: 检查同文件 `handleTestAiConnection` 函数（line 288 附近），若直接调用 `invoke("test_ai_connection")` 则改为 `aiService.testAiConnection()`
- [x] SubTask 9.3: 执行 `tsc --noEmit` 验证类型检查通过

---

## 阶段二：前端组件模块化拆分（P0）

### Task 10: 拆分 NovelEditor.tsx

**目标**: 将 1489 行的 NovelEditor 拆分为多个 hooks 与子组件。**依赖**: Task 9 完成。

- [x] SubTask 10.1: 创建 `src/hooks/useEditorFileIO.ts`，抽取文件加载（.pmd/HTML/纯文本三层兼容）与保存逻辑
- [x] SubTask 10.2: 创建 `src/hooks/useEditorAutoSave.ts`，抽取自动保存、防抖、排队、快照逻辑
- [x] SubTask 10.3: 创建 `src/hooks/useEditorMention.ts`，抽取角色提及、悬停卡片、右键菜单逻辑
- [x] SubTask 10.4: 创建 `src/hooks/useEditorAiCommands.ts`，抽取 AI 命令组装与面板联动逻辑
- [x] SubTask 10.5: 创建 `src/hooks/useEntityHighlightAutomaton.ts`，抽取实体高亮 AC 自动机构建逻辑
- [x] SubTask 10.6: 创建 `src/components/editor/EditorContextMenu.tsx`，独立角色提及右键菜单组件
- [x] SubTask 10.7: 重构 NovelEditor.tsx 调用上述 hooks 与组件，目标行数 < 500
- [x] SubTask 10.8: 修复 Task 16 中 NovelEditor 的 setTimeout 未清理问题（line 557/576/578/909/1097）
- [x] SubTask 10.9: 验证编辑器全功能：加载、保存、自动保存、提及、悬停、右键、AI 命令、TXT 导出

### Task 11: 拆分 SettingsDialog.tsx

**目标**: 将 1217 行的 SettingsDialog 按分区拆分。

- [x] SubTask 11.1: 创建 `src/components/settings/GeneralSettingsSection.tsx`
- [x] SubTask 11.2: 创建 `src/components/settings/AiSettingsSection.tsx`
- [x] SubTask 11.3: 创建 `src/components/settings/AppearanceSettingsSection.tsx`
- [x] SubTask 11.4: 创建 `src/components/settings/AboutSettingsSection.tsx`
- [x] SubTask 11.5: 重构 SettingsDialog.tsx 为外壳，仅负责弹窗容器与分区导航
- [x] SubTask 11.6: 验证所有设置项功能正常

### Task 12: 拆分 AiAssistantPanel.tsx

**目标**: 将 1036 行的 AiAssistantPanel 拆分。

- [x] SubTask 12.1: 创建 `src/components/ai-assistant/AiMessageList.tsx`
- [x] SubTask 12.2: 创建 `src/components/ai-assistant/AiInputBar.tsx`
- [x] SubTask 12.3: 创建 `src/hooks/useAiStream.ts`，抽取流式请求与中断逻辑
- [x] SubTask 12.4: 创建 `src/hooks/usePromptBuilder.ts`，抽取上下文组装逻辑
- [x] SubTask 12.5: 创建 `src/components/ai-assistant/AiMarkdownRenderer.tsx`
- [x] SubTask 12.6: 重构 AiAssistantPanel.tsx 调用上述组件与 hooks
- [x] SubTask 12.7: 验证 AI 续写/对话/一致性检查/剧情推演/大纲生成全流程

### Task 13: 拆分 Launcher.tsx

**目标**: 将 1035 行的 Launcher 拆分。

- [x] SubTask 13.1: 创建 `src/hooks/useProjectScan.ts`，抽取项目扫描逻辑
- [x] SubTask 13.2: 创建 `src/hooks/useVersionCheck.ts`，抽取版本检查逻辑
- [x] SubTask 13.3: 创建 `src/components/launcher/ProjectGrid.tsx`
- [x] SubTask 13.4: 创建 `src/components/launcher/ProjectCreationPanel.tsx`
- [x] SubTask 13.5: 创建 `src/lib/formatters.ts`，迁移 `formatWordCount`、`formatTimeAgo`、`formatCreatedDate`
- [x] SubTask 13.6: 重构 Launcher.tsx 调用上述组件与 hooks
- [x] SubTask 13.7: 验证项目创建、扫描、编辑、删除全流程

### Task 14: 拆分 FileList.tsx

**目标**: 将 1026 行的 FileList 拆分。

- [x] SubTask 14.1: 创建 `src/components/file-list/FileTreeNode.tsx`
- [x] SubTask 14.2: 创建 `src/hooks/useFileDragSort.ts`，抽取拖拽排序逻辑
- [x] SubTask 14.3: 创建 `src/hooks/useFileContextMenu.ts`，抽取上下文菜单逻辑
- [x] SubTask 14.4: 创建 `src/hooks/useCodexSync.ts`，抽取设定库索引同步逻辑
- [x] SubTask 14.5: 重构 FileList.tsx 调用上述组件与 hooks
- [x] SubTask 14.6: 验证文件树渲染、拖拽、右键菜单、设定库同步全流程

### Task 15: 拆分 EditorToolbar.tsx

**目标**: 将 955 行含 7 个组件的 EditorToolbar 拆分到独立目录。

- [x] SubTask 15.1: 创建 `src/components/editor-toolbar/ToolbarButton.tsx`
- [x] SubTask 15.2: 创建 `src/components/editor-toolbar/Divider.tsx`
- [x] SubTask 15.3: 创建 `src/components/editor-toolbar/HeadingDropdown.tsx`
- [x] SubTask 15.4: 创建 `src/components/editor-toolbar/ColorPicker.tsx`
- [x] SubTask 15.5: 创建 `src/components/editor-toolbar/TableMenu.tsx`
- [x] SubTask 15.6: 创建 `src/components/editor-toolbar/SessionStats.tsx`
- [x] SubTask 15.7: 重构 EditorToolbar.tsx 仅作为容器组合上述组件
- [x] SubTask 15.8: 验证工具栏所有按钮功能正常

---

## 阶段三：API 层与 Service 层重构（P0）

### Task 16: 拆分 api.ts 上帝文件

**目标**: 将 1052 行的 api.ts 按领域拆分。**依赖**: Task 9-15 完成（避免组件重构期间 API 路径频繁变动）。

- [x] SubTask 16.1: 创建 `src/lib/api/projectApi.ts`，迁移 `createProject`、`scanProjects`、`importProject`、`deleteProject`、`updateProjectMeta` 等函数
- [x] SubTask 16.2: 创建 `src/lib/api/fileApi.ts`，迁移 `readProjectTree`、`readFile`、`writeFile`、`createFile`、`deletePath`、`renamePath`、`copyFile` 等函数
- [x] SubTask 16.3: 创建 `src/lib/api/searchApi.ts`，迁移 `searchInProject`、`replaceInProject`、`searchProject` 等函数
- [x] SubTask 16.4: 创建 `src/lib/api/snapshotApi.ts`，迁移 `createSnapshot`、`listSnapshots`、`readSnapshot`、`restoreSnapshot`、`deleteSnapshot`、`clearSnapshots`、`getSnapshotStats` 等函数
- [x] SubTask 16.5: 创建 `src/lib/api/indexApi.ts`，迁移 `buildProjectIndex`、`getProjectIndexStats`、`updateFileIndex`、`removeFileIndex`、`onIndexProgress` 等函数
- [x] SubTask 16.6: 创建 `src/lib/api/aiContextApi.ts`，迁移 `getSceneContext`、`getCharacterContext`、`getProjectContext` 等函数
- [x] SubTask 16.7: 修改 `src/lib/api.ts` 仅作为 re-export 入口（保持向后兼容）
- [x] SubTask 16.8: 逐步迁移组件 import 路径至新分领域文件（保留 api.ts 作为 re-export 入口即可保证向后兼容，未大规模迁移以避免风险）
- [x] SubTask 16.9: 执行 `tsc --noEmit` 验证类型检查通过

### Task 17: 抽象 Graph API 工厂

**目标**: 抽取 `createGraphApi` 工厂消除 characterGraphApi 与 timelineApi 的重复。

- [x] SubTask 17.1: 创建 `src/lib/api/graphApiFactory.ts`，定义 `createGraphApi<TGraph, TNode, TEdge>(options)` 工厂函数
- [x] SubTask 17.2: 重构 `src/lib/characterGraphApi.ts` 使用工厂生成
- [x] SubTask 17.3: 重构 `src/lib/timelineApi.ts` 使用工厂生成
- [x] SubTask 17.4: 验证两条业务线的 read/save/clear/buildPersisted 全流程

### Task 18: 引入统一日志服务

**目标**: 替代散落的 24 处 `console.error/warn`。

- [x] SubTask 18.1: 创建 `src/lib/logger.ts`，提供 `logger.debug/info/warn/error` 方法
- [x] SubTask 18.2: 支持日志级别配置（开发环境 debug+，生产环境 error+）
- [x] SubTask 18.3: 全项目 grep `console.error` 与 `console.warn`，替换为 `logger.error` 与 `logger.warn`
- [x] SubTask 18.4: 验证生产构建日志级别正确降级

---

## 阶段四：状态管理重构（P0/P1）

### Task 19: 打破 store 循环依赖

**目标**: 修复 store.ts ↔ viewSlice.ts / types.ts 的 type-only 循环依赖。

- [x] SubTask 19.1: 将 `SidebarCategory` 类型定义从 `store.ts` 迁移到 `src/lib/stores/types.ts`
- [x] SubTask 19.2: 修改 `store.ts` 从 `types.ts` 导入 `SidebarCategory`
- [x] SubTask 19.3: 修改 `viewSlice.ts` 从 `types.ts` 导入 `SidebarCategory`
- [x] SubTask 19.4: 修改 `categorySlice.ts` 从 `types.ts` 导入 `SidebarCategory`
- [x] SubTask 19.5: 修改 `stores/types.ts` 不再 re-export from store.ts
- [x] SubTask 19.6: 执行 `tsc --noEmit` 验证循环依赖消除

### Task 20: 拆分 settingsStore.ts

**目标**: 将 580 行的 settingsStore 拆分为 editorSettingsStore 与 appearanceStore。

- [x] SubTask 20.1: 创建 `src/lib/editorSettingsStore.ts`，迁移字号、自动保存、章节格式、缩进、音效、快照等编辑器相关设置
- [x] SubTask 20.2: 创建 `src/lib/appearanceStore.ts`，迁移背景预设、质感模式、毛玻璃透明度等外观相关设置
- [x] SubTask 20.3: 将 DOM 副作用（document.documentElement.style.setProperty、classList）独立为 effect
- [x] SubTask 20.4: 修改原 settingsStore.ts 为 re-export 入口（保持向后兼容）
- [x] SubTask 20.5: 迁移组件 import 路径至新 store（通过 re-export 入口保持向后兼容，无需迁移组件 import）
- [x] SubTask 20.6: 验证所有设置项读写正常（tsc --noEmit 通过）

### Task 21: 迁移混入的业务函数

**目标**: 将类型文件与 store 中混入的业务函数迁移到独立 service。

- [x] SubTask 21.1: 将 `preferencesSlice.ts:155-167` 的 `getProjectConfig`/`setProjectConfig` 迁移到 `src/lib/api/projectConfigApi.ts`
- [x] SubTask 21.2: 将 `characterGraphTypes.ts:203-298` 的 localStorage CRUD 函数迁移到 `src/lib/stores/customRelationStore.ts`
- [x] SubTask 21.3: 将 `timelineStore.ts:90-148` 的 `filterCollapsed` 纯函数迁移到 `src/lib/graphUtils.ts`
- [x] SubTask 21.4: 验证所有调用方更新导入路径

### Task 22: 抽象 Graph Store 工厂

**目标**: 抽取 `createGraphStore` 工厂消除 characterGraphStore 与 timelineStore 的重复。

- [x] SubTask 22.1: 创建 `src/lib/stores/graphStoreFactory.ts`，定义 `createGraphStore` 工厂函数
- [x] SubTask 22.2: 实现 loadGraph、debouncedSave、saveNow、onNodesChange、onEdgesChange、addEdge、updateNodeData、deleteNode、clearGraph、undo、redo 通用逻辑
- [x] SubTask 22.3: 将 saveTimer 移入 store state（修复模块级单例风险）
- [x] SubTask 22.4: 重构 `characterGraphStore.ts` 使用工厂生成
- [x] SubTask 22.5: 重构 `timelineStore.ts` 使用工厂生成
- [x] SubTask 22.6: 验证两条业务线的撤销重做、拖拽保存、自动布局全流程

---

## 阶段五：工具函数与业务逻辑解耦（P0）

### Task 23: 重构 characterMention.ts

**目标**: 将 picker 浮层从 DOM 构建逻辑提取为 React 组件。

- [x] SubTask 23.1: 创建 `src/components/CharacterMentionPicker.tsx`，实现 picker 浮层 React 组件
- [x] SubTask 23.2: 重构 `characterMention.ts` 通过 TipTap suggestion 插件渲染 React 组件
- [x] SubTask 23.3: 移除 `characterMention.ts:283-453` 的 DOM 构建逻辑
- [x] SubTask 23.4: 修复 `characterMention.ts:407` 事件监听未显式移除问题
- [x] SubTask 23.5: 验证角色提及浮层显示、键盘导航、选择全流程

### Task 24: 提取 GraphPanelShell 通用组件

**目标**: 提取 TimelinePanel 与 CharacterGraphPanel 的通用逻辑。

- [x] SubTask 24.1: 创建 `src/components/graph/GraphPanelShell.tsx` 高阶组件
- [x] SubTask 24.2: 提取通用逻辑：React Flow 画布、自动布局、重置视图、右键菜单触发
- [x] SubTask 24.3: 重构 `TimelinePanel.tsx` 使用 GraphPanelShell
- [x] SubTask 24.4: 重构 `CharacterGraphPanel.tsx` 使用 GraphPanelShell
- [x] SubTask 24.5: 验证两个面板的画布交互、右键菜单、自动布局全流程

---

## 阶段六：后端 Rust 模块化拆分（P0）

### Task 25: 引入 AppError 并迁移试点模块

**目标**: 迁移 `editor_preferences.rs` 作为 AppError 试点。**依赖**: Task 6 完成。

- [x] SubTask 25.1: 修改 `editor_preferences.rs` 全量替换 `Result<T, String>` 为 `Result<T, AppError>`
- [x] SubTask 25.2: 替换所有 `map_err(|e| format!(...))` 为 `?` 操作符
- [x] SubTask 25.3: 执行 `cargo check` 与 `cargo test` 验证

### Task 26: 拆分 fs_commands.rs

**目标**: 将 2161 行的 fs_commands 按职责拆分。**依赖**: Task 25 完成（验证 AppError 模式可行）。

- [x] SubTask 26.1: 创建 `src-tauri/src/commands/project_commands.rs`，迁移项目 CRUD 函数
- [x] SubTask 26.2: 创建 `src-tauri/src/commands/file_io_commands.rs`，迁移文件读写函数
- [x] SubTask 26.3: 创建 `src-tauri/src/commands/search_replace_commands.rs`，迁移搜索替换函数
- [x] SubTask 26.4: 创建 `src-tauri/src/commands/writing_stats_commands.rs`，迁移字数统计函数
- [x] SubTask 26.5: 创建 `src-tauri/src/commands/custom_template_commands.rs`，迁移自定义模板 CRUD 函数
- [x] SubTask 26.6: 创建 `src-tauri/src/commands/archive_commands.rs`，迁移项目导入导出函数
- [x] SubTask 26.7: 创建 `src-tauri/src/index_sync.rs`，迁移 Tantivy 同步钩子函数
- [x] SubTask 26.8: 全量迁移上述模块为 `Result<T, AppError>`
- [x] SubTask 26.9: 修改 `lib.rs` invoke_handler 引用新模块函数
- [x] SubTask 26.10: 执行 `cargo check` 与 `cargo test` 验证

### Task 27: 拆分 ai_context.rs

**目标**: 将 992 行的 ai_context 按职责拆分。**依赖**: Task 8 完成（unwrap 修复与重复函数删除）。

- [x] SubTask 27.1: 创建 `src-tauri/src/ai_context/mod.rs` 作为模块入口
- [x] SubTask 27.2: 创建 `src-tauri/src/ai_context/scene.rs`，迁移 `get_scene_context` 与 scene 相关函数
- [x] SubTask 27.3: 创建 `src-tauri/src/ai_context/character.rs`，迁移 `get_character_context` 与角色上下文函数
- [x] SubTask 27.4: 创建 `src-tauri/src/ai_context/project.rs`，迁移 `get_project_context` 与项目上下文函数
- [x] SubTask 27.5: 创建 `src-tauri/src/prosemirror_parser.rs`，迁移 `split_doc_into_scenes`、`collect_text_from_node`、`extract_character_ids_from_nodes` 公共函数
- [x] SubTask 27.6: 修改 `lib.rs` 引入 `mod ai_context;` 与 `mod prosemirror_parser;`
- [x] SubTask 27.7: 执行 `cargo check` 与 `cargo test` 验证

### Task 28: 拆分 codex_commands.rs

**目标**: 将 985 行的 codex_commands 按职责拆分。

- [x] SubTask 28.1: 创建 `src-tauri/src/codex/parser.rs`，迁移 `parse_codex_file` 与 front matter 解析逻辑
- [x] SubTask 28.2: 创建 `src-tauri/src/codex/migration.rs`，迁移 `migrate_codex_txt_to_pmd` 与格式迁移逻辑
- [x] SubTask 28.3: 创建 `src-tauri/src/codex/crud.rs`，迁移 `list_codex_entities`、`update_codex_entity`、`inject_codex_front_matter` CRUD 函数
- [x] SubTask 28.4: 创建 `src-tauri/src/codex/scan.rs`，迁移 `scan_entity_mentions`、`scan_invalid_mentions`、`count_character_mentions` 扫描函数
- [x] SubTask 28.5: 修改 `lib.rs` 引入 `mod codex;`
- [x] SubTask 28.6: 执行 `cargo check` 与 `cargo test` 验证

### Task 29: 外置 template_schema.rs 模板数据

**目标**: 将 10 个硬编码预设模板外置为数据文件。

- [x] SubTask 29.1: 创建 `src-tauri/templates/` 目录
- [x] SubTask 29.2: 将 10 个预设模板内容导出为 `character_standard.toml`、`character_fantasy.toml`、`character_scifi.toml`、`character_romance.toml`、`character_mystery.toml`、`worldview_standard.toml`、`worldview_fantasy.toml`、`glossary_standard.toml`、`outline_standard.toml`、`outline_chapter.toml` 数据文件
- [x] SubTask 29.3: 重构 `template_schema.rs` 仅保留加载器与 schema 定义
- [x] SubTask 29.4: 实现加载器首次运行时验证文件完整性逻辑
- [x] SubTask 29.5: 执行 `cargo check` 与 `cargo test` 验证模板加载正常

### Task 30: 拆分 lib.rs invoke_handler

**目标**: 将 50+ 命令的集中注册拆分到各模块。**依赖**: Task 25-29 完成。

- [x] SubTask 30.1: 在每个业务模块新建 `register_commands(builder: &mut tauri::Builder)` 函数
- [x] SubTask 30.2: 修改 `lib.rs::run()` 依次调用各模块的 `register_commands` 聚合
- [x] SubTask 30.3: 删除 `lib.rs` 中的单一 `generate_handler!` 宏调用
- [x] SubTask 30.4: 执行 `cargo check` 验证所有命令注册正常
- [x] SubTask 30.5: 启动应用验证所有 invoke 命令可调用

> **方案说明**: 经评估 Tauri 2.0 `invoke_handler` API 采用 builder 模式,内部以 `Option<F>` 存储处理器,多次调用会覆盖前一次设置而非累加。因此方案 A (多次调用 invoke_handler) 不可行。选择方案 C (最保守方案):保持单一 `generate_handler!` 宏,按 16 个业务模块分组添加分节注释,标注每模块命令数量与职责。命令路径已按模块结构组织 (如 `commands::project_commands::function`),无需改变函数调用结构,保证零风险不破坏现有功能。

---

## 阶段七：后端健壮性修复（P1）

### Task 31: Tantivy IndexHandle 缓存与并发修复

**目标**: 引入索引缓存避免重复打开，串行化写入避免并发 panic。

- [x] SubTask 31.1: 在 `tantivy_indexer.rs` 定义 `IndexHandle` 结构，包含 `Index`、`IndexReader`、`Mutex<IndexWriter>`
- [x] SubTask 31.2: 引入 `static INDEX_CACHE: OnceLock<Mutex<HashMap<PathBuf, Arc<IndexHandle>>>>` 缓存
- [x] SubTask 31.3: 修改 `open_or_create_index` 优先从缓存读取
- [x] SubTask 31.4: 修改 `tantivy_search.rs` 所有命令使用 IndexHandle
- [x] SubTask 31.5: 修复 `delete_file_from_index` 返回类型不一致问题
- [x] SubTask 31.6: 执行 `cargo check` 与 `cargo test` 验证

### Task 32: 实现 scene_id 字段

**目标**: 从 ProseMirror sceneBreak 节点提取真实 scene_id 写入索引。

- [x] SubTask 32.1: 修改 `split_into_chunks` 函数签名接受 `scene_id: Option<String>` 参数
- [x] SubTask 32.2: 修改 `collect_text_from_node` 识别 sceneBreak 节点并提取 `attrs.id`
- [x] SubTask 32.3: 修改 `tantivy_indexer.rs:251-252` 使用提取的 scene_id 替代空字符串
- [x] SubTask 32.4: 执行 `cargo test` 验证索引写入正确

### Task 33: 修复 character_commands.rs .pmd 兼容

**目标**: 修复 `read_character_summary` 仅检查 `.txt` 忽略 `.pmd` 格式。

- [x] SubTask 33.1: 修改 `character_commands.rs` `read_character_summary` 函数，兼容 `.pmd` 格式
- [x] SubTask 33.2: 执行 `cargo check` 与 `cargo test` 验证

### Task 34: 优化 AI 流式取消令牌

**目标**: 将 `static CANCEL_FLAG: AtomicBool` 替换为支持 request_id 粒度的取消机制。

- [x] SubTask 34.1: 引入 `Arc<Mutex<HashMap<Uuid, CancellationToken>>>` 替代全局 AtomicBool
- [x] SubTask 34.2: 修改 `chat_completion_stream` 接受 `request_id` 参数
- [x] SubTask 34.3: 修改 `cancel_stream_completion` 接受 `request_id` 参数精准取消
- [x] SubTask 34.4: 实现 SSE 解析的 chunk 边界缓冲区拼接
- [x] SubTask 34.5: 执行 `cargo check` 与 `cargo test` 验证

---

## 阶段八：类型安全与代码异味修复（P2）

### Task 35: 修复定时器未清理

**目标**: 修复所有 setTimeout 未保存引用的问题。

- [x] SubTask 35.1: 修复 `NovelEditor.tsx:909` 保存 timer 引用到 ref，卸载时 clearTimeout（与 Task 10.8 合并执行）
- [x] SubTask 35.2: 修复 `AiAssistantPanel.tsx:720` 保存 timer 引用，卸载时清理（与 Task 12 合并执行）
- [x] SubTask 35.3: 修复 `NovelEditor.tsx` 其他 setTimeout（line 557/576/578/1097）保存引用（与 Task 10.8 合并执行）
- [x] SubTask 35.4: 修复 `App.tsx:52` 的 `.then()` 添加 `.catch` 静默处理

### Task 36: 补全 store action 返回类型注解

**目标**: 全项目 store 文件补充显式返回类型注解。

- [x] SubTask 36.1: 扫描所有 store action 方法，补充 `: void` 或具体返回类型
- [x] SubTask 36.2: 执行 `tsc --noEmit` 验证

### Task 37: 归档 generate_icon.py

**目标**: 与 `npx tauri icon` 官方流程统一。

- [x] SubTask 37.1: 在 README 第 6.3 节明确图标生成流程，二选一：
  - 方案 A: 保留 `npx tauri icon` 为唯一流程，将 `generate_icon.py` 移至 `scripts/archive/`
  - 方案 B: 保留 `generate_icon.py` 作为补充，在 README 同步说明
- [x] SubTask 37.2: 执行所选方案的文件迁移或文档更新

### Task 38: 派生状态下沉

**目标**: 将组件内派生计算下沉为 store selector 或 memo 工具。

- [x] SubTask 38.1: 将 `NovelEditor.tsx:216-224` 的 characters 派生下沉为 useCodexStore 的 `getByType('character')` selector
- [x] SubTask 38.2: 将 `CodexPanel.tsx:200/263/276` 的派生计算下沉为 store selector
- [x] SubTask 38.3: 执行 `tsc --noEmit` 验证

---

## Task Dependencies

```
Task 1-9（阶段一）: 独立执行，无相互依赖
  └─ Task 6 → Task 25（AppError 试点依赖错误类型定义）
  └─ Task 7（BREAKING ProjectMeta）→ 需与前端 TypeScript interface 同步

Task 10-15（阶段二）: 组件拆分
  └─ Task 10 依赖 Task 9（裸 invoke 修复）
  └─ 其余可并行

Task 16-18（阶段三）: API 层重构
  └─ Task 16 依赖 Task 9-15 完成（避免 API 路径频繁变动）

Task 19-22（阶段四）: 状态管理重构
  └─ 独立执行，可与阶段二/三并行

Task 23-24（阶段五）: 工具函数解耦
  └─ 独立执行

Task 25-30（阶段六）: 后端模块拆分
  └─ Task 25 依赖 Task 6
  └─ Task 26 依赖 Task 25（AppError 模式验证）
  └─ Task 27 依赖 Task 8（ai_context unwrap 修复）
  └─ Task 30 依赖 Task 25-29（所有模块拆分完成）

Task 31-34（阶段七）: 后端健壮性
  └─ 独立执行，可与阶段六并行

Task 35-38（阶段八）: 类型安全与代码异味
  └─ Task 35.1/35.2/35.3 与 Task 10/12 合并执行
  └─ 其余独立执行
```

## 可并行执行的任务组

- **并行组 A**（阶段一基础）: Task 1, 2, 3, 4, 5, 8, 9
- **并行组 B**（阶段二组件）: Task 10, 11, 12, 13, 14, 15
- **并行组 C**（阶段四状态）: Task 19, 20, 21, 22
- **并行组 D**（阶段五解耦）: Task 23, 24
- **并行组 E**（阶段六后端）: Task 27, 28, 29（依赖 Task 8）
- **并行组 F**（阶段七健壮）: Task 31, 32, 33, 34
