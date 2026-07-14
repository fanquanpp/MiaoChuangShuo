# Checklist - 项目模块化重构与潜藏问题修复

> **change-id**: `refactor-project-modularization`
> **验证原则**: 每个 checkpoint 必须通过实际执行验证（命令运行、文件检查、功能测试），不可凭推断判定通过。

---

## 一、工程化硬约束验证

- [x] **C1.1**: `.github/workflows/release-desktop.yml` 文件存在，包含 `v*` tag 触发器与 `windows-latest` runner 配置
- [x] **C1.2**: release-desktop.yml 配置了 `npm run tauri build` 构建步骤
- [x] **C1.3**: release-desktop.yml 配置了 `softprops/action-gh-release` 上传 MSI 与 NSIS 产物
- [x] **C1.4**: README 第 9.3 节已补充桌面端发布流程说明
- [x] **C1.5**: `package.json` 中 `@tiptap/react` 版本为 `^2.27.2`（与其他 @tiptap 包一致）
- [x] **C1.6**: `package.json` 中 `@tiptap/extension-placeholder` 版本为 `^2.27.2`
- [ ] **C1.7**: `npm install` 执行无版本冲突警告 【需运行时验证】
- [x] **C1.8**: `tailwind.config.js` 的 `content` 字段包含 `"./web/**/*.{js,ts,jsx,tsx}"` 与 `"./web/index.html"`
- [x] **C1.9**: `.gitignore` 包含 `migration_backup_*/` 与 `**/migration_backup_*/` 规则

## 二、国际化完整性验证

- [x] **C2.1**: `src/lib/i18n.tsx` 中文 dict 与英文 dict 均包含以下 14 个新 key：
  - `edgeDrawer.customToggle`、`edgeDrawer.customPlaceholder`、`edgeDrawer.colorLabel`、`edgeDrawer.customAdd`、`edgeDrawer.customList`、`edgeDrawer.customAddTitle`、`edgeDrawer.customDeleteTitle`、`edgeDrawer.colorAria`
  - `timeline.clearGraphTitle`、`timeline.statusPlanned`、`timeline.statusWriting`、`timeline.statusDone`
  - `toast.ariaLabel`、`toast.closeAria`
  - `characterGraph.relationUnknown`
- [x] **C2.2**: `src/components/CharacterGraphEdgeDrawer.tsx` 全部硬编码中文已替换为 `t('...')` 调用
- [x] **C2.3**: `src/components/TimelinePanel.tsx` 已替换为 i18n 调用（行号偏差：spec 标注 :559，实际位于 :95 `clearTitle: "timeline.clearGraphTitle"`）
- [x] **C2.4**: `src/lib/toast.tsx` 已替换为 i18n 调用（行号偏差：spec 标注 :91/152，实际位于 :93/155）
- [x] **C2.5**: `src/lib/stores/characterGraphTypes.ts` 已替换为 i18n 调用（行号偏差：spec 标注 :298，实际位于 :142 返回 `"characterGraph.relationUnknown"`）
- [x] **C2.6**: `src/lib/stores/timelineTypes.ts:134-136` 已替换为 i18n 调用（`NODE_STATUS_MAP` 使用 i18n key 字符串）
- [ ] **C2.7**: 切换语言为英文，所有新增 key 显示正确英文文案 【需运行时验证】
- [ ] **C2.8**: 切换语言为中文，所有新增 key 显示正确中文文案 【需运行时验证】

## 三、Rust 错误处理验证

- [x] **C3.1**: `src-tauri/Cargo.toml` 包含 `thiserror = "1"` 依赖
- [x] **C3.2**: `src-tauri/src/error.rs` 文件存在，定义 `AppError` 枚举
- [x] **C3.3**: `AppError` 枚举包含 6 个变体（IoError、SerializeError、PathValidationError、IndexError、AiError、ConfigError）
- [x] **C3.4**: `AppError` 实现了 `From<std::io::Error>` 转换
- [x] **C3.5**: `AppError` 实现了 `From<serde_json::Error>` 转换
- [x] **C3.6**: `AppError` 实现了 `serde::Serialize`，输出包含 `kind`、`message`、`context` 字段
- [x] **C3.7**: `lib.rs` 引入了 `mod error;` 与 `pub use error::AppError;`
- [x] **C3.8**: `editor_preferences.rs` 全量使用 `Result<T, AppError>`，无 `Result<T, String>`
- [x] **C3.9**: `editor_preferences.rs` 无 `map_err(|e| format!(...))` 调用
- [x] **C3.10**: `cargo check` 通过，无错误
- [x] **C3.11**: `cargo test` 通过，无失败用例（32 passed; 0 failed）

## 四、Rust serde 注解验证（硬约束）

- [x] **C4.1**: `editor_preferences.rs` 的 `EditorPreferences` struct 包含 `#[serde(rename_all = "camelCase")]`
- [x] **C4.2**: `editor_preferences.rs` 的 `ProjectConfig` struct 包含 `#[serde(rename_all = "camelCase")]`
- [x] **C4.3**: `codex/parser.rs` 的 `CodexMeta` struct 包含 `#[serde(rename_all = "camelCase")]`（路径偏差：spec 标注 codex_commands.rs，实际拆分为 codex/parser.rs）
- [x] **C4.4**: `codex/parser.rs` 的 `CodexMetaPatch` struct 包含 `#[serde(rename_all = "camelCase")]`（路径偏差同上）
- [x] **C4.5**: `project_template.rs` 的 `ProjectMeta` struct 包含 `#[serde(rename_all = "camelCase")]`
- [x] **C4.6**: `ProjectMeta` 的 `project_type` 字段包含 `#[serde(alias = "type")]`
- [x] **C4.7**: 迁移测试存在：构造含 `"type"` 字段的旧 meta.json，能正确反序列化为 `project_type`（`test_deserialize_old_meta_with_type_field` 通过）
- [x] **C4.8**: 新写入的 meta.json 字段名为 `"projectType"`（非 `"type"`，由 `test_serialize_new_meta_with_project_type_field` 验证）
- [x] **C4.9**: 前端 TypeScript interface 与后端 struct 字段名一致（如 `projectType` 而非 `project_type`）
- [x] **C4.10**: `cargo check` 通过

## 五、后端健壮性验证

- [x] **C5.1**: `ai_context/project.rs` 不再使用 `.unwrap()`（路径偏差：spec 标注 ai_context.rs，实际拆分为 ai_context/project.rs）
- [x] **C5.2**: `ai_context/project.rs` 不再使用 `.unwrap()`（同上）
- [x] **C5.3**: `ai_context` 模块下 `count_chinese_and_words` 函数已删除（grep 无匹配）
- [x] **C5.4**: `ai_context/project.rs` 调用 `crate::word_count::count_words` 替代原重复函数
- [x] **C5.5**: `character_commands.rs` 的 `read_character_summary` 兼容 `.pmd` 格式（`for target_ext in &["pmd", "txt"]`）
- [x] **C5.6**: `cargo check` 通过
- [x] **C5.7**: `cargo test` 通过

## 六、前端 UI 层分层验证

- [x] **C6.1**: `src/components/SettingsDialog.tsx` 不再使用 `invoke("set_ai_config", ...)`，改用 `aiService.setAiConfig`（SettingsDialog 仅 182 行外壳，无 `invoke(` 调用）
- [x] **C6.2**: `SettingsDialog.tsx` 的 `handleTestAiConnection` 不再使用裸 invoke，改用 `aiService.testAiConnection`（逻辑下沉至 settings/AiSettingsSection.tsx）
- [x] **C6.3**: Grep `invoke\(` 在 `src/components/` 目录下无直接调用（除通过 Service 层封装）
- [x] **C6.4**: `tsc --noEmit` 通过

## 七、前端组件拆分验证

### NovelEditor 拆分
- [x] **C7.1**: `src/hooks/useEditorFileIO.ts` 存在，封装文件加载与保存逻辑
- [x] **C7.2**: `src/hooks/useEditorAutoSave.ts` 存在，封装自动保存与防抖逻辑
- [x] **C7.3**: `src/hooks/useEditorMention.ts` 存在，封装角色提及与悬停卡片逻辑
- [x] **C7.4**: `src/hooks/useEditorAiCommands.ts` 存在，封装 AI 命令逻辑
- [x] **C7.5**: `src/hooks/useEntityHighlightAutomaton.ts` 存在，封装实体高亮逻辑
- [x] **C7.6**: `src/components/editor/EditorContextMenu.tsx` 存在
- [ ] **C7.7**: `NovelEditor.tsx` 行数 < 500（不含类型定义与注释）【未通过：实际 568 行，超出 500 行限制 68 行】
- [ ] **C7.8**: 编辑器加载 .pmd 文件正常 【需运行时验证】
- [ ] **C7.9**: 编辑器加载 HTML 文件正常 【需运行时验证】
- [ ] **C7.10**: 编辑器加载纯文本文件正常 【需运行时验证】
- [ ] **C7.11**: 编辑器自动保存触发正常 【需运行时验证】
- [ ] **C7.12**: 角色提及浮层显示正常 【需运行时验证】
- [ ] **C7.13**: 角色悬停卡片显示正常 【需运行时验证】
- [ ] **C7.14**: 右键菜单功能正常 【需运行时验证】
- [ ] **C7.15**: AI 润色/扩写/缩写/一致性检查功能正常 【需运行时验证】
- [ ] **C7.16**: TXT 导出功能正常 【需运行时验证】

### SettingsDialog 拆分
- [x] **C7.17**: `src/components/settings/GeneralSettingsSection.tsx` 存在
- [x] **C7.18**: `src/components/settings/AiSettingsSection.tsx` 存在
- [x] **C7.19**: `src/components/settings/AppearanceSettingsSection.tsx` 存在
- [x] **C7.20**: `src/components/settings/AboutSettingsSection.tsx` 存在
- [x] **C7.21**: `SettingsDialog.tsx` 行数 < 500（实际 182 行）
- [ ] **C7.22**: 通用设置读写正常 【需运行时验证】
- [ ] **C7.23**: AI 配置读写与连接测试正常 【需运行时验证】
- [ ] **C7.24**: 外观/背景/质感设置正常 【需运行时验证】
- [ ] **C7.25**: 版本检查功能正常 【需运行时验证】

### AiAssistantPanel 拆分
- [x] **C7.26**: `src/components/ai-assistant/AiMessageList.tsx` 存在
- [x] **C7.27**: `src/components/ai-assistant/AiInputBar.tsx` 存在
- [x] **C7.28**: `src/hooks/useAiStream.ts` 存在
- [x] **C7.29**: `src/hooks/usePromptBuilder.ts` 存在
- [x] **C7.30**: `src/components/ai-assistant/AiMarkdownRenderer.tsx` 存在
- [x] **C7.31**: `AiAssistantPanel.tsx` 行数 < 500（实际 494 行）
- [ ] **C7.32**: AI 续写功能正常 【需运行时验证】
- [ ] **C7.33**: AI 对话功能正常 【需运行时验证】
- [ ] **C7.34**: AI 一致性检查功能正常 【需运行时验证】
- [ ] **C7.35**: AI 剧情推演功能正常 【需运行时验证】
- [ ] **C7.36**: AI 大纲生成功能正常 【需运行时验证】
- [ ] **C7.37**: 流式中断（Esc 键）功能正常 【需运行时验证】

### Launcher 拆分
- [x] **C7.38**: `src/hooks/useProjectScan.ts` 存在
- [x] **C7.39**: `src/hooks/useVersionCheck.ts` 存在
- [x] **C7.40**: `src/components/launcher/ProjectGrid.tsx` 存在
- [x] **C7.41**: `src/components/launcher/ProjectCreationPanel.tsx` 存在
- [x] **C7.42**: `src/lib/formatters.ts` 存在，包含 `formatWordCount`、`formatTimeAgo`、`formatCreatedDate`
- [ ] **C7.43**: `Launcher.tsx` 行数 < 500 【未通过：实际 575 行，超出 500 行限制 75 行】
- [ ] **C7.44**: 项目扫描正常 【需运行时验证】
- [ ] **C7.45**: 项目创建正常 【需运行时验证】
- [ ] **C7.46**: 项目编辑正常 【需运行时验证】
- [ ] **C7.47**: 项目删除正常 【需运行时验证】

### FileList 拆分
- [x] **C7.48**: `src/components/file-list/FileTreeNode.tsx` 存在
- [x] **C7.49**: `src/hooks/useFileDragSort.ts` 存在
- [x] **C7.50**: `src/hooks/useFileContextMenu.ts` 存在
- [x] **C7.51**: `src/hooks/useCodexSync.ts` 存在
- [x] **C7.52**: `FileList.tsx` 行数 < 500（实际 307 行）
- [ ] **C7.53**: 文件树渲染正常 【需运行时验证】
- [ ] **C7.54**: 拖拽排序正常 【需运行时验证】
- [ ] **C7.55**: 右键菜单（重命名/删除/复制/复制路径）正常 【需运行时验证】
- [ ] **C7.56**: 设定库索引同步正常 【需运行时验证】

### EditorToolbar 拆分
- [x] **C7.57**: `src/components/editor-toolbar/` 目录存在
- [x] **C7.58**: 目录下包含 6 个独立组件文件（ToolbarButton、Divider、HeadingDropdown、ColorPicker、TableMenu、SessionStats）（实际 8 个，超额完成）
- [x] **C7.59**: `EditorToolbar.tsx` 仅作为容器组合子组件（实际 195 行，纯容器）
- [ ] **C7.60**: 工具栏所有按钮功能正常 【需运行时验证】

## 八、API 层重构验证

- [x] **C8.1**: `src/lib/api/projectApi.ts` 存在，包含项目 CRUD 函数
- [x] **C8.2**: `src/lib/api/fileApi.ts` 存在，包含文件操作函数
- [x] **C8.3**: `src/lib/api/searchApi.ts` 存在，包含搜索替换函数
- [x] **C8.4**: `src/lib/api/snapshotApi.ts` 存在，包含快照函数
- [x] **C8.5**: `src/lib/api/indexApi.ts` 存在，包含索引函数
- [x] **C8.6**: `src/lib/api/aiContextApi.ts` 存在，包含 AI 上下文函数
- [ ] **C8.7**: 每个 API 文件行数 < 300 【未通过：projectApi.ts 实际 366 行，超出 300 行限制 66 行；graphApiFactory.ts 210 行通过】
- [x] **C8.8**: `src/lib/api.ts` 仅作为 re-export 入口（向后兼容，实际 23 行）
- [x] **C8.9**: `src/lib/api/graphApiFactory.ts` 存在，定义 `createGraphApi` 工厂（第 108 行）
- [x] **C8.10**: `characterGraphApi.ts` 使用 `createGraphApi` 工厂生成
- [x] **C8.11**: `timelineApi.ts` 使用 `createGraphApi` 工厂生成
- [x] **C8.12**: `src/lib/logger.ts` 存在，提供 debug/info/warn/error 方法（实际 225 行）
- [x] **C8.13**: Grep `console.error` 与 `console.warn` 在 `src/` 目录下无匹配（已全部替换为 logger 调用，仅 logger.ts 内部 5 处作为最终输出通道保留）
- [ ] **C8.14**: 生产构建日志级别正确降级（仅 error+）【需运行时验证】
- [x] **C8.15**: `tsc --noEmit` 通过

## 九、状态管理重构验证

- [x] **C9.1**: `src/lib/stores/types.ts` 包含 `SidebarCategory` 类型定义
- [x] **C9.2**: `store.ts` 从 `types.ts` 导入 `SidebarCategory`（第 25 行 import，第 26 行 re-export）
- [x] **C9.3**: `viewSlice.ts` 从 `types.ts` 导入 `SidebarCategory`
- [x] **C9.4**: `categorySlice.ts` 从 `types.ts` 导入 `SidebarCategory`
- [x] **C9.5**: `stores/types.ts` 不再 re-export from `store.ts`（文件仅含 SidebarCategory 类型定义，无 re-export）
- [x] **C9.6**: `src/lib/editorSettingsStore.ts` 存在（路径偏差：原 spec 为 `src/lib/stores/`，实际与 settingsStore.ts 同级放于 `src/lib/`）
- [x] **C9.7**: `src/lib/appearanceStore.ts` 存在（路径偏差：原 spec 为 `src/lib/stores/`，实际与 settingsStore.ts 同级放于 `src/lib/`）
- [x] **C9.8**: `settingsStore.ts` 仅作为 re-export 入口（41 行，组合 hook 保持向后兼容）
- [x] **C9.9**: `src/lib/api/projectConfigApi.ts` 存在，包含 `getProjectConfig`/`setProjectConfig`（50 行，函数定义已迁移至此）
- [x] **C9.10**: `preferencesSlice.ts` 不再包含 `getProjectConfig`/`setProjectConfig` 函数定义（仅保留 re-export 用于向后兼容，实际定义在 projectConfigApi.ts）
- [x] **C9.11**: `src/lib/stores/customRelationStore.ts` 存在，包含 localStorage CRUD 函数
- [x] **C9.12**: `characterGraphTypes.ts` 不再包含 localStorage CRUD 业务函数（grep `localStorage.getItem/setItem/removeItem` 无匹配，仅 import 自 customRelationStore）
- [x] **C9.13**: `src/lib/graphUtils.ts` 存在，包含 `filterCollapsed` 函数
- [x] **C9.14**: `timelineStore.ts` 不再包含 `filterCollapsed` 函数（改为 re-export from "../graphUtils"）
- [x] **C9.15**: `src/lib/stores/graphStoreFactory.ts` 存在，定义 `createGraphStore` 工厂（第 198 行 `export function createGraphStore`）
- [x] **C9.16**: `characterGraphStore.ts` 使用 `createGraphStore` 工厂生成（第 25 行 import，第 92 行 `export const useCharacterGraphStore = createGraphStore<`）
- [x] **C9.17**: `timelineStore.ts` 使用 `createGraphStore` 工厂生成（第 25 行 import，第 94 行 `export const useTimelineStore = createGraphStore<`）
- [x] **C9.18**: `saveTimer` 移入 store state，不再使用模块级单例（graphStoreFactory.ts 第 98 行 `saveTimer: ReturnType<typeof setTimeout> | null` 作为 GraphStoreBaseState 字段）
- [ ] **C9.19**: 时间线撤销重做功能正常 【需运行时验证】
- [ ] **C9.20**: 人物关系图撤销重做功能正常 【需运行时验证】
- [ ] **C9.21**: 时间线拖拽保存功能正常 【需运行时验证】
- [ ] **C9.22**: 人物关系图拖拽保存功能正常 【需运行时验证】
- [x] **C9.23**: `tsc --noEmit` 通过

## 十、工具函数与业务逻辑解耦验证

- [x] **C10.1**: `src/components/CharacterMentionPicker.tsx` 存在，为 React 组件
- [x] **C10.2**: `characterMention.ts` 的 DOM 构建逻辑已移除（原 283-453 行 DOM 构建已替换为 createRoot 渲染 React 组件，仅保留最小容器 div 创建）
- [x] **C10.3**: `characterMention.ts` 通过 TipTap suggestion 插件渲染 React 组件（第 30 行 import，第 298 行 createElement 渲染）
- [x] **C10.4**: `characterMention.ts` 的事件监听在卸载时显式移除（第 256 行注释：事件监听清理由 React useEffect cleanup 自动完成）
- [ ] **C10.5**: 角色提及浮层显示、键盘导航、选择全流程正常 【需运行时验证】
- [x] **C10.6**: `src/components/graph/GraphPanelShell.tsx` 存在
- [x] **C10.7**: `TimelinePanel.tsx` 使用 `GraphPanelShell`（第 53 行 import，第 346 行使用）
- [x] **C10.8**: `CharacterGraphPanel.tsx` 使用 `GraphPanelShell`（第 49 行 import，第 372 行使用）
- [ ] **C10.9**: 时间线画布交互（拖拽、缩放、平移）正常 【需运行时验证】
- [ ] **C10.10**: 人物关系图画布交互正常 【需运行时验证】
- [ ] **C10.11**: 两个面板的右键菜单功能正常 【需运行时验证】
- [ ] **C10.12**: 两个面板的自动布局功能正常 【需运行时验证】

## 十一、后端模块拆分验证

### fs_commands 拆分
- [x] **C11.1**: `src-tauri/src/commands/project_commands.rs` 存在
- [x] **C11.2**: `src-tauri/src/commands/file_io_commands.rs` 存在
- [x] **C11.3**: `src-tauri/src/commands/search_replace_commands.rs` 存在
- [x] **C11.4**: `src-tauri/src/commands/writing_stats_commands.rs` 存在
- [x] **C11.5**: `src-tauri/src/commands/custom_template_commands.rs` 存在
- [x] **C11.6**: `src-tauri/src/commands/archive_commands.rs` 存在
- [x] **C11.7**: `src-tauri/src/index_sync.rs` 存在
- [x] **C11.8**: `fs_commands.rs` 已删除或仅作为 re-export（src/ 目录无 fs_commands.rs，仅 commands/ 目录）
- [x] **C11.9**: 拆分后所有模块使用 `Result<T, AppError>`
- [x] **C11.10**: `cargo check` 通过
- [x] **C11.11**: `cargo test` 通过（32 passed; 0 failed）

### ai_context 拆分
- [x] **C11.12**: `src-tauri/src/ai_context/mod.rs` 存在
- [x] **C11.13**: `src-tauri/src/ai_context/scene.rs` 存在
- [x] **C11.14**: `src-tauri/src/ai_context/character.rs` 存在
- [x] **C11.15**: `src-tauri/src/ai_context/project.rs` 存在
- [x] **C11.16**: `src-tauri/src/prosemirror_parser.rs` 存在
- [x] **C11.17**: `ai_context.rs` 已删除或仅作为 re-export（src/ 目录无 ai_context.rs，仅 ai_context/ 目录）
- [x] **C11.18**: `cargo check` 通过
- [x] **C11.19**: `cargo test` 通过

### codex_commands 拆分
- [x] **C11.20**: `src-tauri/src/codex/parser.rs` 存在
- [x] **C11.21**: `src-tauri/src/codex/migration.rs` 存在
- [x] **C11.22**: `src-tauri/src/codex/crud.rs` 存在
- [x] **C11.23**: `src-tauri/src/codex/scan.rs` 存在
- [x] **C11.24**: `codex_commands.rs` 已删除或仅作为 re-export（src/ 目录无 codex_commands.rs，仅 codex/ 目录）
- [x] **C11.25**: `cargo check` 通过
- [x] **C11.26**: `cargo test` 通过

### template_schema 外置
- [x] **C11.27**: `src-tauri/templates/` 目录存在
- [x] **C11.28**: 目录下包含 10 个 .toml 模板数据文件（character_fantasy/character_mystery/character_romance/character_scifi/character_standard/glossary_standard/outline_chapter/outline_standard/worldview_fantasy/worldview_standard）
- [x] **C11.29**: `template_schema.rs` 仅保留加载器与 schema 定义（struct FieldDef/TemplateModule/TemplateSchema + get_all_templates/get_templates 等加载函数）
- [x] **C11.30**: 加载器首次运行时验证文件完整性逻辑存在（`test_verify_template_integrity_pass` 测试通过，include_str! 编译时嵌入 + 运行时解析验证）
- [x] **C11.31**: `cargo check` 通过
- [x] **C11.32**: `cargo test` 通过（template_schema 模块 8 项测试全通过）

### lib.rs invoke_handler 拆分
- [ ] **C11.33**: 每个业务模块包含 `register_commands` 函数 【未通过：业务模块未实现 register_commands 函数，受 Tauri 2.0 框架限制（invoke_handler 采用 builder 模式，多次调用会覆盖前一次设置），改为在 lib.rs 单一 generate_handler! 宏内按模块分组注册】
- [ ] **C11.34**: `lib.rs::run()` 依次调用各模块的 `register_commands` 【未通过：同 C11.33 原因，lib.rs::run() 使用单一 generate_handler! 宏集中注册 65 项命令，按 16 个业务模块分节注释组织】
- [ ] **C11.35**: `lib.rs` 不再包含单一 `generate_handler!` 宏调用 【未通过：lib.rs 仍包含单一 generate_handler! 宏调用（第 55-203 行），受 Tauri 2.0 框架限制无法拆分为多次 invoke_handler 调用】
- [x] **C11.36**: `cargo check` 通过
- [ ] **C11.37**: 启动应用验证所有 invoke 命令可调用 【需运行时验证】

## 十二、Tantivy 索引管理验证

- [x] **C12.1**: `tantivy_indexer.rs` 定义 `IndexHandle` 结构，包含 `Index`、`IndexReader`、`Mutex<IndexWriter>`（第 72-79 行）
- [x] **C12.2**: `tantivy_indexer.rs` 引入 `static INDEX_CACHE` 缓存（第 91 行 `static INDEX_CACHE: OnceLock<Mutex<HashMap<PathBuf, Arc<IndexHandle>>>>`）
- [x] **C12.3**: `open_or_create_index` 优先从缓存读取（第 237-241 行缓存命中检查）
- [x] **C12.4**: `tantivy_search.rs` 所有命令使用 `IndexHandle`（delete_file_from_index 等通过缓存获取 IndexHandle）
- [x] **C12.5**: `delete_file_from_index` 返回类型一致（`Result<(), AppError>`，第 275/278/284 行）
- [x] **C12.6**: `split_into_chunks` 函数接受 `scene_id: Option<String>` 参数（第 311 行）
- [x] **C12.7**: `collect_text_from_node` 识别 sceneBreak 节点并提取 `attrs.id`（prosemirror_parser.rs 第 161-165 行 match "sceneBreak" 提取 attrs.id）
- [x] **C12.8**: 索引写入时 `scene_id` 字段为真实值（非空字符串，第 409 行 `scene_id_str = chunk.scene_id.as_deref().unwrap_or("")`，.pmd 文件提取真实 scene_id）
- [x] **C12.9**: `cargo check` 通过
- [x] **C12.10**: `cargo test` 通过（tantivy_indexer 模块 7 项测试全通过）

## 十三、AI 流式取消优化验证

- [x] **C13.1**: `ai_commands.rs` 引入 `Mutex<HashMap<String, CancelToken>>`（类型偏差：spec 标注 `Arc<Mutex<HashMap<Uuid, CancellationToken>>>`，实际为 `&'static Mutex<HashMap<String, Arc<AtomicBool>>>` 通过 OnceLock 访问，功能等价——按 request_id 粒度管理取消令牌）
- [x] **C13.2**: `chat_completion_stream` 接受 `request_id` 参数（第 146-151 行 `request_id: String`）
- [x] **C13.3**: `cancel_chat_completion` 接受 `request_id` 参数精准取消（第 321 行 `request_id: String`，函数名偏差：spec 标注 cancel_stream_completion，实际为 cancel_chat_completion）
- [x] **C13.4**: SSE 解析实现 chunk 边界缓冲区拼接（第 219-296 行 `buffer: String` + `drain` 拼接不完整 SSE 事件）
- [x] **C13.5**: `cargo check` 通过
- [x] **C13.6**: `cargo test` 通过

## 十四、类型安全与代码异味验证

- [x] **C14.1**: `NovelEditor.tsx` 所有 setTimeout 保存引用到 ref，卸载时 clearTimeout（useEditorAutoSave hook 内 savingRef 管理）
- [x] **C14.2**: `AiAssistantPanel.tsx` 的 setTimeout 保存引用，卸载时清理（行号偏差：spec 标注 :720，实际位于 :166-168/:326-330/:355-356，通过 registerTimeout/clearTrackedTimeout 机制跟踪）
- [x] **C14.3**: `App.tsx` 的 `.then()` 添加了 `.catch` 处理（行号偏差：spec 标注 :52，实际位于 :54-63，unlisten?.then().catch() 链式调用）
- [x] **C14.4**: Grep `: any` 与 `as any` 在 `src/` 目录下零匹配（保持）
- [x] **C14.5**: store action 方法补充显式返回类型注解（characterGraphStore.ts 第 38/41/111/137 行 `: void` 显式返回类型）
- [x] **C14.6**: `NovelEditor.tsx` 的 characters 派生下沉为 useCodexStore selector（第 125-129 行 `getCodexByType("character")` selector 派生）
- [x] **C14.7**: `CodexPanel.tsx` 的派生计算下沉为 store selector（useCodexStore 的 getFilteredCards/getGroupedCards/getAllCards selector）
- [x] **C14.8**: `generate_icon.py` 已按方案迁移或文档已更新（已归档至 scripts/archive/generate_icon.py）
- [x] **C14.9**: `tsc --noEmit` 通过

## 十五、版本号同步验证

- [x] **C15.1**: `package.json` version 同步至新版本（`26.7.28`）
- [x] **C15.2**: `src-tauri/Cargo.toml` version 同步（`26.7.28`）
- [x] **C15.3**: `src-tauri/tauri.conf.json` version 同步（`26.7.28`）
- [x] **C15.4**: `src/lib/updateChecker.ts` 的 `FALLBACK_VERSION` 同步（`26.7.28`，第 27 行）
- [x] **C15.5**: `src/components/Launcher.tsx` 的 `appVersion` 同步（通过 useVersionCheck hook 获取，间接使用 FALLBACK_VERSION）
- [x] **C15.6**: `src/components/SettingsDialog.tsx` 的 `currentVersion` 同步（通过 Launcher 传入 appVersion prop）
- [x] **C15.7**: `src-tauri/Cargo.lock` 中 `miaochuangshuo` 包 version 同步（`26.7.28`，第 2174-2175 行）

## 十六、最终构建验证

- [x] **C16.1**: `tsc --noEmit` 通过，无类型错误
- [x] **C16.2**: `cargo check` 通过，无编译错误
- [x] **C16.3**: `cargo test` 通过，所有测试用例通过（32 passed; 0 failed）
- [ ] **C16.4**: `vite build` 通过，前端构建成功 【需运行时验证】
- [ ] **C16.5**: `tauri build` 通过，生成 MSI 与 NSIS 安装包 【需运行时验证】
- [ ] **C16.6**: MSI 安装包路径存在：`src-tauri/target/release/bundle/msi/*.msi` 【需运行时验证】
- [ ] **C16.7**: NSIS 安装包路径存在：`src-tauri/target/release/bundle/nsis/*.exe` 【需运行时验证】
- [ ] **C16.8**: 应用启动正常，无控制台错误 【需运行时验证】
- [ ] **C16.9**: 完整功能回归测试通过（编辑器、AI、项目管理、设定库、时间线、人物关系图、搜索、快照、设置）【需运行时验证】

---

## 验证统计

| 类别 | 数量 |
|------|------|
| 总检查点 | 237 |
| 通过（已勾选 `- [x]`） | 183 |
| 未通过（保留 `- [ ]` 并记录原因） | 6 |
| 需运行时验证（保留 `- [ ]` 并标注） | 48 |

### 未通过项明细

1. **C7.7**: `NovelEditor.tsx` 实际 568 行，超出 500 行限制 68 行
2. **C7.43**: `Launcher.tsx` 实际 575 行，超出 500 行限制 75 行
3. **C8.7**: `projectApi.ts` 实际 366 行，超出 300 行限制 66 行
4. **C11.33**: 业务模块未实现 `register_commands` 函数（Tauri 2.0 框架限制）
5. **C11.34**: `lib.rs::run()` 未调用各模块 `register_commands`（Tauri 2.0 框架限制）
6. **C11.35**: `lib.rs` 仍包含单一 `generate_handler!` 宏调用（Tauri 2.0 框架限制：invoke_handler 采用 builder 模式，多次调用会覆盖前一次设置）

### 路径/行号偏差项（已通过，标注偏差）

- C2.3/C2.4/C2.5: 行号偏差（i18n 调用已替换，实际行号与 spec 标注不一致）
- C4.3/C4.4: 路径偏差（codex_commands.rs 拆分为 codex/parser.rs）
- C5.1/C5.2: 路径偏差（ai_context.rs 拆分为 ai_context/project.rs）
- C9.6/C9.7: 路径偏差（stores/ 目录调整为 src/lib/ 同级）
- C13.1: 类型偏差（`Arc<Mutex<HashMap<Uuid, CancellationToken>>>` 实际为 `&'static Mutex<HashMap<String, Arc<AtomicBool>>>`，功能等价）
- C13.3: 函数名偏差（`cancel_stream_completion` 实际为 `cancel_chat_completion`）
- C14.2/C14.3: 行号偏差（spec 标注行号与实际行号不一致，逻辑已实现）
