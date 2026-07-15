# Tasks

本任务清单按 8 大阶段组织,每阶段含若干可验证工作项。任务间依赖关系见文末"Task Dependencies"。

## 阶段一:存储类型分析与重构

- [x] Task 1.1: 统一 AppData 根目录为 `MiaoChuangShuo`,迁移 `novelforge` 子目录下所有数据(preferences / templates / custom_relation_types)到新位置,更新 Rust 后端所有路径常量
  - [x] SubTask 1.1.1: 在 `ai_config.rs` / `editor_preferences.rs` / `custom_template_commands.rs` 中将 `novelforge` 路径常量改为 `MiaoChuangShuo`
  - [x] SubTask 1.1.2: 新增迁移函数 `migrate_appdata_directory()`,检测旧 `novelforge` 目录并迁移到 `MiaoChuangShuo`
  - [x] SubTask 1.1.3: 更新 `lib.rs` 在应用启动时调用迁移函数
  - [x] SubTask 1.1.4: 验证迁移后应用可正常读取偏好/模板/AI 配置

- [x] Task 1.2: 引入项目级 `manifest.json` 统一索引机制
  - [x] SubTask 1.2.1: 在 `src-tauri/src/` 新增 `manifest.rs` 模块,定义 `Manifest` / `ManifestEntity` / `ReverseIndex` 结构体(均带 `#[serde(rename_all = "camelCase")]`)
  - [x] SubTask 1.2.2: 实现 `load_manifest(project_path) -> Result<Manifest, AppError>` 与 `save_manifest(project_path, manifest) -> Result<(), AppError>`(原子写入)
  - [x] SubTask 1.2.3: 实现 `register_entity(project_path, entity_type, entity) -> Result<(), AppError>` 与 `unregister_entity(project_path, entity_type, entity_id) -> Result<(), AppError>`
  - [x] SubTask 1.2.4: 实现 `update_reverse_index(manifest, codex_id, action, target_type, target_id)` 维护反向索引
  - [x] SubTask 1.2.5: 在 `project_commands.rs::create_project` 中初始化空 manifest
  - [x] SubTask 1.2.6: 在 `file_io_commands.rs` 文件创建/删除/重命名命令中同步 manifest
  - [x] SubTask 1.2.7: 暴露 `get_manifest` / `update_manifest_entity` Tauri 命令,在 `lib.rs::invoke_handler` 注册

- [x] Task 1.3: 为数据实体分配 UUID 并注入 front matter
  - [x] SubTask 1.3.1: 在 `text_extractor.rs` 与 `prosemirror_parser.rs` 新增 `inject_front_matter(content, meta) -> String` 与 `extract_front_matter(content) -> Option<Meta>` 工具函数
  - [x] SubTask 1.3.2: 章节文件创建时在 `file_io_commands.rs::create_file` 中生成 UUID,写入 front matter
  - [x] SubTask 1.3.3: 大纲文件从 `.txt` 迁移到 `.pmd`,自动迁移函数 `migrate_outline_to_pmd(project_path) -> Result<(), AppError>`
  - [x] SubTask 1.3.4: 章节保存时更新 manifest 中的 wordCount 字段
  - [x] SubTask 1.3.5: 验证迁移不破坏旧项目数据(保留旧 `.txt` 文件为 `.bak`)

- [x] Task 1.4: 持久化 WritingStats
  - [x] SubTask 1.4.1: 新增 `writing_stats_commands.rs::WritingStatsSnapshot` 结构体(chapter_words / total_words / last_updated)
  - [x] SubTask 1.4.2: 实现 `load_writing_stats(project_path)` 与 `save_writing_stats(project_path, snapshot)` 命令(原子写入到 `.novelforge/writing_stats.json`)
  - [x] SubTask 1.4.3: `get_writing_stats` 命令优先读取持久化数据,文件 mtime 变化时增量更新
  - [x] SubTask 1.4.4: 章节保存时调用 `update_chapter_word_count(project_path, chapter_id, word_count)` 增量更新

- [x] Task 1.5: 自定义关系类型后端持久化
  - [x] SubTask 1.5.1: 在 `editor_preferences.rs` 新增 `load_custom_relation_types() -> Vec<CustomRelationType>` 与 `save_custom_relation_types(types)` 命令(存储到 `%APPDATA%\MiaoChuangShuo\custom_relation_types.json`)
  - [x] SubTask 1.5.2: 前端 `customRelationStore.ts` 改为调用后端 API,首次启动时从 localStorage 迁移数据
  - [x] SubTask 1.5.3: 在 `lib.rs::invoke_handler` 注册两个新命令

- [x] Task 1.6: 引入 zustand persist 中间件统一 localStorage
  - [x] SubTask 1.6.1: 在 `package.json` 添加 `zustand/middleware` 依赖(已内置,确认版本)
  - [x] SubTask 1.6.2: 重构 `editorSettingsStore.ts` / `appearanceStore.ts` / `themeStore.ts` / `uiStore.ts` / `recentFiles.ts` 使用 `persist` 中间件
  - [x] SubTask 1.6.3: 分离 `editorSettingsStore` 与 `appearanceStore` 的 STORAGE_KEY(改为 `miaochuangshuo-editor-settings` 与 `miaochuangshuo-appearance`)
  - [x] SubTask 1.6.4: 添加迁移逻辑,首次启动时从旧 key 读取数据并迁移到新 key

- [x] Task 1.7: 引入 JSON Schema 定义
  - [x] SubTask 1.7.1: 在 `Cargo.toml` 添加 `schemars` 依赖
  - [x] SubTask 1.7.2: 为 `ProjectMeta` / `Manifest` / `AiConfig` / `EditorPreferences` / `TimelineGraph` / `CharacterGraph` / `SnapshotMeta` / `CustomTemplate` 派生 `JsonSchema`
  - [x] SubTask 1.7.3: 新增 `generate_schemas` 命令,输出到 `schemas/` 目录
  - [x] SubTask 1.7.4: 添加 `json-schema-to-typescript` devDependency,生成前端 TS 类型
  - [x] SubTask 1.7.5: 在 CI 中添加 schema 一致性检查步骤

- [x] Task 1.8: 统一目录扫描配置
  - [x] SubTask 1.8.1: 在 `project_template.rs::ProjectMeta` 新增 `codex_dirs: Vec<String>` / `outline_dir: String` / `manuscript_dir: String` / `draft_dir: String` 字段(带 `#[serde(default)]`)
  - [x] SubTask 1.8.2: 后端 `codex/crud.rs::CODEX_DIRS` / `writing_stats_commands.rs` 硬编码目录改为读取 ProjectMeta 配置
  - [x] SubTask 1.8.3: 前端 `WritingStats.tsx::detectCategoryFromPath` / `GlobalSearch.tsx` 同类映射改为从 ProjectMeta 读取
  - [x] SubTask 1.8.4: 创建旧项目时填充默认目录配置,实现向后兼容

- [x] Task 1.9: 实现 schema_version 迁移机制
  - [x] SubTask 1.9.1: 在 `manifest.rs` 新增 `migrate_manifest(manifest) -> Manifest` 函数,按 schemaVersion 逐步升级
  - [x] SubTask 1.9.2: 在 `timeline_commands.rs` / `character_graph_commands.rs` 的 load 函数中检测 schema_version 并迁移
  - [x] SubTask 1.9.3: 文档化 schema 升级流程到 `docs/schema-migration.md`

## 阶段二:项目问题与漏洞修复

- [x] Task 2.1: 迁移 5 个后端模块到 AppError
  - [x] SubTask 2.1.1: `snapshot_commands.rs` 14 个函数迁移
  - [x] SubTask 2.1.2: `character_graph_commands.rs` 5 个函数迁移
  - [x] SubTask 2.1.3: `timeline_commands.rs` 5 个函数迁移
  - [x] SubTask 2.1.4: `character_commands.rs` 4 个函数迁移
  - [x] SubTask 2.1.5: `template_schema.rs` 6 个函数迁移
  - [x] SubTask 2.1.6: 验证前端 catch 块统一处理 `{kind, message, context}` 结构

- [x] Task 2.2: 修复 AI API Key Base64 回退存储安全问题
  - [x] SubTask 2.2.1: 在 `Cargo.toml` 添加 `windows` crate(仅 Windows target)依赖,启用 `Win32_Security_Cryptography` feature
  - [x] SubTask 2.2.2: 新增 `ai_config.rs::encrypt_with_dpapi(plaintext) -> Result<String, AppError>` 与 `decrypt_with_dpapi(ciphertext) -> Result<String, AppError>`
  - [x] SubTask 2.2.3: macOS/Linux 平台保持 keyring-only 策略,keyring 不可用时返回错误
  - [x] SubTask 2.2.4: Base64 回退模式改为 DPAPI 加密,旧 Base64 数据自动迁移解密后重新加密
  - [x] SubTask 2.2.5: 测试加密/解密往返一致性

- [x] Task 2.3: 修复 `lib.rs:210` `.expect()` panic 风险
  - [x] SubTask 2.3.1: 改为 `match .run(tauri::generate_context!()) { Err(e) => { eprintln!("..."); show_error_dialog("启动失败", &e.to_string()); std::process::exit(1); } Ok(_) => {} }`
  - [x] SubTask 2.3.2: 使用 `tauri::window::WindowBuilder` 或 Windows MessageBox API 显示友好错误

- [x] Task 2.4: 引入 `@tanstack/react-virtual` 虚拟化大列表
  - [x] SubTask 2.4.1: `npm install @tanstack/react-virtual`
  - [x] SubTask 2.4.2: `SnapshotHistory.tsx` 改造为虚拟列表(预估 100+ 快照时受益)
  - [x] SubTask 2.4.3: `FileList.tsx` 文件树节点虚拟化(预估 500+ 文件时受益)
  - [x] SubTask 2.4.4: `GlobalSearch.tsx` 搜索结果虚拟化(预估 1000+ 结果时受益)
  - [x] SubTask 2.4.5: 验证虚拟列表滚动性能与无障碍访问

- [x] Task 2.5: 前端 `useAiStream` 引入 AbortController
  - [x] SubTask 2.5.1: 在 `useAiStream.ts` 新增 `abortControllerRef: useRef<AbortController | null>(null)`
  - [x] SubTask 2.5.2: `startStream` 中创建新 AbortController,传入 fetch signal
  - [x] SubTask 2.5.3: `cancelStream` 同时调用 `abortControllerRef.current?.abort()` 与后端 `cancel_chat_completion`
  - [x] SubTask 2.5.4: 验证取消后 fetch 立即抛出 AbortError,UI 正确恢复

- [x] Task 2.6: 消除 xyflow 双重断言
  - [x] SubTask 2.6.1: 为 `@xyflow/react` 的 `Node` / `Edge` 传入正确泛型参数(如 `Node<TimelineNodeData>` / `Edge<TimelineEdgeData>`)
  - [x] SubTask 2.6.2: 移除 `graphStoreFactory.ts:321-322/337-338` / `GraphPanelShell.tsx:779-780` / `TimelineNode.tsx:61` / `entityHighlightWorker.ts:350` 共 12 处 `as unknown as`
  - [x] SubTask 2.6.3: 验证 tsc --noEmit 通过

- [x] Task 2.7: 修复 `text_extractor.rs::detect_format` 误判 `.txt` 含 JSON 内容
  - [x] SubTask 2.7.1: 在 `.txt` 分支增加 JSON 探测:若首字符为 `{` 且能解析为 JSON 含 `type` 字段,则按 `PmdJson` 处理
  - [x] SubTask 2.7.2: 添加单元测试覆盖 4 种格式检测
  - [x] SubTask 2.7.3: 验证字数统计不再将 JSON 结构字符计入

- [x] Task 2.8: 修复 `SnapshotHistory.tsx::computeLineDiff` 算法缺陷
  - [x] SubTask 2.8.1: `npm install diff @types/diff`
  - [x] SubTask 2.8.2: 改用 `diff.diffLines(oldText, newText)` 替代 Set 比较
  - [x] SubTask 2.8.3: 验证差异统计数字准确

- [x] Task 2.9: 修复 `AiAssistantPanel.tsx::handleSendRef` 每次渲染赋值
  - [x] SubTask 2.9.1: 将 `handleSendRef.current = handleSend` 移入 `useEffect(() => { handleSendRef.current = handleSend; })` 无依赖数组
  - [x] SubTask 2.9.2: 审查其他组件是否有相同模式,统一修复

- [x] Task 2.10: 抽取魔法数字为命名常量
  - [x] SubTask 2.10.1: `useEditorFileIO.ts` 的 500/300/1500/100 抽取为 `INDEX_UPDATE_DEBOUNCE_MS` / `HIGHLIGHT_TRANSITION_MS` / `HIGHLIGHT_BG_MS` / `PENDING_SAVE_DELAY_MS`
  - [x] SubTask 2.10.2: `AiAssistantPanel.tsx` / `GraphPanelShell.tsx` / `graphStoreFactory.ts` 同类处理
  - [x] SubTask 2.10.3: 集中到各文件头部常量区或独立 `constants.ts`

- [x] Task 2.11: 执行 i18n 中英文切换验证
  - [x] SubTask 2.11.1: 手动切换语言为英文,验证所有新增 i18n key 显示正确
  - [x] SubTask 2.11.2: 覆盖 CharacterGraphEdgeDrawer / TimelinePanel / toast / characterGraphTypes / timelineTypes 五处变更点
  - [x] SubTask 2.11.3: 修复发现的 key 拼写错误或插值语法问题

## 阶段三:TXT 导出功能重构

- [x] Task 3.1: 修复 `text_extractor.rs::detect_format` 前置 BUG(已在 Task 2.7 完成,标记依赖)

- [x] Task 3.2: 新增 Rust 命令 `export_project_to_txt`
  - [x] SubTask 3.2.1: 在 `src-tauri/src/commands/` 新增 `export_commands.rs` 模块
  - [x] SubTask 3.2.2: 定义 `TxtExportOptions` 结构体(mode: single/merged/per_chapter/per_volume / includeChapterTitle: bool / bom: bool / crlf: bool / outputPath: String)
  - [x] SubTask 3.2.3: 实现 `export_project_to_txt(project_path, options) -> Result<ExportResult, AppError>` 命令
  - [x] SubTask 3.2.4: 递归遍历正文目录,按文件名字典序排序,调用 `text_extractor::extract_plain_text` 提取纯文本
  - [x] SubTask 3.2.5: 按选项拼接(分卷分隔符 / 章节标题 / 换行符 / BOM)
  - [x] SubTask 3.2.6: 写入用户选择目录(通过 `pickDirectory` 获取)
  - [x] SubTask 3.2.7: 在 `lib.rs::invoke_handler` 注册命令

- [x] Task 3.3: 前端 API 与 UI 入口
  - [x] SubTask 3.3.1: 在 `src/lib/api/projectApi.ts` 新增 `exportProjectToTxt(projectPath, options)` 函数
  - [x] SubTask 3.3.2: 重构 `ProjectArchiveDialog.tsx` 新增 `mode="export-txt"` 模式,展示导出选项(模式/标题/BOM/CRLF)
  - [x] SubTask 3.3.3: 在 `Workspace.tsx` 新增"导出为 TXT"按钮(与"导出项目归档"并列)
  - [x] SubTask 3.3.4: 重构单章导出 `NovelEditor.tsx::handleExportTxt` 为调用 Tauri dialog 选择保存目录
  - [x] SubTask 3.3.5: 在 `CommandPalette.tsx` 新增"导出为 TXT"命令

- [x] Task 3.4: i18n 翻译键
  - [x] SubTask 3.4.1: 在 `i18n.tsx` 新增 `export.*` 系列翻译键(mode/selectDir/includeTitle/bom/crlf/processing/success/failed 等约 15 个)
  - [x] SubTask 3.4.2: 验证中英文切换显示正确

## 阶段四:数据孤岛与联动优化

- [x] Task 4.1: 修改 `CharacterGraphNodeData` 引用方式
  - [x] SubTask 4.1.1: 在 `characterGraphTypes.ts` 新增 `codexId: string` 字段,保留 `sourceFile` 用于显示
  - [x] SubTask 4.1.2: 在后端 `character_graph_commands.rs::CharacterNodeData` 同步新增 `codex_id: Option<String>` 字段
  - [x] SubTask 4.1.3: 图谱节点创建时从设定库卡片自动获取 codexId
  - [x] SubTask 4.1.4: 迁移旧图谱数据,通过 sourceFile 反查 codexId 填充

- [x] Task 4.2: 修改 `TimelineNodeData` 关联章节
  - [x] SubTask 4.2.1: 在 `timelineTypes.ts` 新增 `chapterId: string | null` 字段
  - [x] SubTask 4.2.2: 在 `TimelineDrawer.tsx` 新增"关联章节"下拉选择器
  - [x] SubTask 4.2.3: 在 `TimelinePanel.tsx` 新增"跳转到章节"按钮(仅当 chapterId 非空时显示)

- [x] Task 4.3: 章节删除时自动清理悬挂引用
  - [x] SubTask 4.3.1: 在 `useCodexSync.ts::syncOnDelete` 扩展清理人物图谱 sourceFile 引用
  - [x] SubTask 4.3.2: 扩展清理时间线 chapterId 引用
  - [x] SubTask 4.3.3: 扩展清理 manifest.entities.chapters 记录

- [x] Task 4.4: 设定库删除卡片时自动清理 Mention
  - [x] SubTask 4.4.1: 在 `codex/crud.rs::delete_codex_entity` 中,通过 manifest.reverseIndex 找到所有引用该 codexId 的章节
  - [x] SubTask 4.4.2: 调用新命令 `remove_mentions_from_chapters(chapter_paths, codex_id)` 清理正文中 Mention 节点
  - [x] SubTask 4.4.3: 前端 `useCodexStore.ts::deleteCard` 调用后刷新所有打开的编辑器

- [x] Task 4.5: 字数统计 SSOT 收敛
  - [x] SubTask 4.5.1: 删除 `categorySlice.activeFileWordCount` 缓存,改为从 WritingStats 派生
  - [x] SubTask 4.5.2: 删除 `ProjectInfo.word_count` 缓存,改为从 WritingStats 读取
  - [x] SubTask 4.5.3: 章节保存时调用 `update_chapter_word_count` 增量更新 WritingStats
  - [x] SubTask 4.5.4: 项目卡片字数从 WritingStats 读取,实时更新

- [x] Task 4.6: Codex 改名联动扩展
  - [x] SubTask 4.6.1: `character_commands.rs::rename_character_in_project` 扫描目录从仅"正文"扩展到"设定/大纲/草稿箱"
  - [x] SubTask 4.6.2: 使用 UUID 关联替代字符串替换,避免子串误伤
  - [x] SubTask 4.6.3: 添加单元测试覆盖子串误伤场景(如"小明" vs "小明明")

- [x] Task 4.7: 人物图谱 Drawer 新增"跳转到设定库"
  - [x] SubTask 4.7.1: 在 `CharacterGraphDrawer.tsx` 底部新增"在设定库中查看"按钮(仅当 codexId 存在时显示)
  - [x] SubTask 4.7.2: 点击触发 `setActiveCategory("codex")` + `setPendingSelectCardId(codexId)`

- [x] Task 4.8: 大纲修改同步章节
  - [x] SubTask 4.8.1: 大纲 `.pmd` 化后,front matter 注入 outlineId 与 chapterId
  - [x] SubTask 4.8.2: 大纲条目修改时检测 chapterId 是否存在,提示用户同步
  - [x] SubTask 4.8.3: 章节重命名时反向更新大纲 front matter 的 title 字段

- [x] Task 4.9: 命令面板跨模块跳转命令
  - [x] SubTask 4.9.1: 在 `CommandPalette.tsx` 新增"跳转到图谱节点"命令(展示节点列表)
  - [x] SubTask 4.9.2: 新增"跳转到时间线事件"命令
  - [x] SubTask 4.9.3: 新增"跳转到伏笔"命令(伏笔模块完成后启用)

## 阶段五:便捷操作增强

- [x] Task 5.1: 新建伏笔模块
  - [x] SubTask 5.1.1: 后端新增 `foreshadowing_commands.rs` 模块,定义 `Foreshadowing` 结构体(id / title / status / setupChapterId / resolutionChapterId / importance / note / createdAt / updatedAt)
  - [x] SubTask 5.1.2: 实现 CRUD 命令(list / create / update / delete),持久化到 `<project>/伏笔/foreshadowings.json`
  - [x] SubTask 5.1.3: 在 `project_template.rs::create_project` 中自动创建 `伏笔/` 目录
  - [x] SubTask 5.1.4: 前端新增 `src/lib/foreshadowingApi.ts` API 封装
  - [x] SubTask 5.1.5: 前端新增 `src/lib/stores/useForeshadowingStore.ts` Zustand store
  - [x] SubTask 5.1.6: 前端新增 `src/components/ForeshadowingPanel.tsx` 面板组件(统计概览卡片 + 按状态分组可展开列表)
  - [x] SubTask 5.1.7: 在 `Workspace.tsx` 注册 Alt+8 快捷键切换伏笔面板
  - [x] SubTask 5.1.8: 在 `categoryRegistry.ts` 注册"伏笔"分类(图标: Eye / 颜色: 橙色)
  - [x] SubTask 5.1.9: 在 `i18n.tsx` 新增 `foreshadowing.*` 系列翻译键(约 20 个)

- [x] Task 5.2: 批量操作
  - [x] SubTask 5.2.1: `FileList.tsx` 章节列表新增多选模式(Ctrl+Click / Shift+Click)
  - [x] SubTask 5.2.2: 多选状态下显示批量操作工具栏(重命名 / 导出 / 删除 / 移动到卷)
  - [x] SubTask 5.2.3: `CodexPanel.tsx` 设定库条目新增多选模式
  - [x] SubTask 5.2.4: 批量删除设定库条目时循环调用单条删除并清理 Mention

- [x] Task 5.3: 章节列表拖拽到另一卷
  - [x] SubTask 5.3.1: 在 `useFileDragSort.ts` 扩展支持跨目录拖拽
  - [x] SubTask 5.3.2: 拖拽到另一卷时调用 `move_file` 命令,更新 manifest.volumeId

- [x] Task 5.4: 设定库条目拖拽分组
  - [x] SubTask 5.4.1: 在 `CodexPanel.tsx` 启用 HTML5 拖拽 API
  - [x] SubTask 5.4.2: 拖拽条目到另一分组时调用 `move_file` 命令

- [x] Task 5.5: 章节内容修改增量索引
  - [x] SubTask 5.5.1: 在 `useEditorAutoSave.ts` 保存成功后调用 `update_file_index` 而非 `build_project_index`
  - [x] SubTask 5.5.2: 验证索引更新延迟在 500ms 内

## 阶段六:废弃代码清理

- [x] Task 6.1: 删除死代码
  - [x] SubTask 6.1.1: 删除 `prosemirror_parser.rs::extract_text_and_scene_id_from_nodes` + 3 个测试
  - [x] SubTask 6.1.2: 迁移 `commands/mod.rs::count_chinese_and_words` 调用点到 `word_count::count_words`,删除包装函数
  - [x] SubTask 6.1.3: 合并 `is_supported_doc` 与 `is_indexable_file` 为单一函数

- [x] Task 6.2: 抽取重复代码
  - [x] SubTask 6.2.1: 在 `prosemirror_parser.rs` 抽出 `collect_text_from_node_core` 公共递归核心
  - [x] SubTask 6.2.2: `text_extractor.rs::collect_text_from_node` 改为调用核心函数并丢弃 scene_id

- [x] Task 6.3: 迁移文档文件
  - [x] SubTask 6.3.1: 创建 `docs/research/` 目录
  - [x] SubTask 6.3.2: 移动 `DEEP_RESEARCH_AI_API_KEY_UX.md` → `docs/research/ai-api-key-ux.md`
  - [x] SubTask 6.3.3: 移动 `DEEP_RESEARCH_AI_CLIENT_MODULES.md` → `docs/research/ai-client-modules.md`

- [x] Task 6.4: 废弃摘要 txt 双写
  - [x] SubTask 6.4.1: 删除 `timeline_commands.rs` 中写入 `_剧情时间线摘要.txt` 的逻辑
  - [x] SubTask 6.4.2: 删除 `character_graph_commands.rs` 中写入 `_人物关系图摘要.txt` 的逻辑
  - [x] SubTask 6.4.3: 添加按需生成摘要的命令 `generate_graph_summary(graph_type) -> String`

## 阶段七:构建发布与版本同步

- [x] Task 7.1: 版本号同步到 `26.8.0`
  - [x] SubTask 7.1.1: 更新 `package.json` / `Cargo.toml` / `Cargo.lock` / `tauri.conf.json` / `updateChecker.ts` / `useVersionCheck.ts` 6 处版本号
  - [x] SubTask 7.1.2: 消除 `useVersionCheck.ts::DEFAULT_APP_VERSION`,改为 `import { FALLBACK_VERSION } from "../lib/updateChecker"`

- [x] Task 7.2: 新增 `scripts/sync-version.mjs` 自动版本同步脚本
  - [x] SubTask 7.2.1: 接受版本号参数,自动更新 6 处文件
  - [x] SubTask 7.2.2: 添加版本号格式校验(YY.MM.修改序号)
  - [x] SubTask 7.2.3: 在 `package.json` 添加 `"sync-version": "node scripts/sync-version.mjs"` script

- [x] Task 7.3: 优化 `release-desktop.yml`
  - [x] SubTask 7.3.1: 新增 `workflow_dispatch` 手动触发
  - [x] SubTask 7.3.2: 新增预检 job(`tsc --noEmit` + `cargo check`)
  - [x] SubTask 7.3.3: 构建后生成 `sha256` 哈希文件并上传
  - [x] SubTask 7.3.4: 版本号一致性校验步骤

- [x] Task 7.4: 统一两个 workflow 的 Actions 版本
  - [x] SubTask 7.4.1: `deploy-web.yml` 的 `actions/checkout@v7` → `@v4`,`setup-node@v6` → `@v4`
  - [x] SubTask 7.4.2: 统一 Node 版本为 20
  - [x] SubTask 7.4.3: `package.json` 新增 `engines: { node: ">=20" }` 字段

- [ ] Task 7.5: 构建与发布
  - [ ] SubTask 7.5.1: 执行 `npm run tauri build` 生成 MSI + NSIS 安装包
  - [ ] SubTask 7.5.2: 验证安装包大小合理(MSI ~10MB / NSIS ~8MB)
  - [ ] SubTask 7.5.3: 提交所有变更到 git,推送 `v26.8.0` tag 触发 GitHub Release
  - [ ] SubTask 7.5.4: 在 GitHub Release 上传 MSI + NSIS + sha256 文件

## 阶段八:README 与 About 栏目升级

- [x] Task 8.1: README.md 修正与完善
  - [x] SubTask 8.1.1: 修正版本号徽章 `26.7.28` → 动态 shields.io 从 Release 拉取
  - [x] SubTask 8.1.2: 修正版本号同步表(7→6 处,删 SettingsDialog,保留 Launcher.tsx appVersion,增 Cargo.lock)
  - [x] SubTask 8.1.3: 修正代码结构树(commands/、codex/、ai_context/ 子模块)
  - [x] SubTask 8.1.4: 首屏插入 4-6 张代表性截图(创作界面 / 人物关系图谱 / 剧情图谱 / 写作统计)
  - [x] SubTask 8.1.5: 新增目录(Table of Contents)
  - [x] SubTask 8.1.6: 新增 FAQ 章节(HVCI / 杀软拦截 / AI Key 配置 / 数据存储位置 / 升级)
  - [x] SubTask 8.1.7: 新增 Roadmap 章节
  - [x] SubTask 8.1.8: 章节折叠统一(全部使用 `<details>`)

- [x] Task 8.2: AboutSettingsSection.tsx 重构
  - [x] SubTask 8.2.1: 顶部新增应用图标(Wand2 64x64 蓝紫渐变 + 装饰点)+ 应用名 + slogan
  - [x] SubTask 8.2.2: 新增项目介绍区(2-3 句话简介 + 三大原则)
  - [x] SubTask 8.2.3: 新增核心特性列表(5 大模块图标列表)
  - [x] SubTask 8.2.4: 新增技术栈展示(Tauri / React / Rust / TypeScript / TipTap / React Flow / Tantivy)
  - [x] SubTask 8.2.5: 新增作者信息区(fanquanpp + GitHub 仓库 + Issue + Release 链接)
  - [x] SubTask 8.2.6: 新增致谢区(折叠,列出核心依赖库)
  - [x] SubTask 8.2.7: 新增开源协议区(链接到 LICENSE 文件)
  - [x] SubTask 8.2.8: 新增"复制版本号""打开日志目录"辅助按钮
  - [x] SubTask 8.2.9: 美化:分区卡片化、链接按钮化、版本号大字展示

- [x] Task 8.3: 新增仓库治理文件
  - [x] SubTask 8.3.1: 新增 `LICENSE` 文件(CC-BY-NC-4.0 署名-非商用)
  - [x] SubTask 8.3.2: 新增 `.github/ISSUE_TEMPLATE/bug_report.yml`
  - [x] SubTask 8.3.3: 新增 `.github/ISSUE_TEMPLATE/feature_request.yml`
  - [x] SubTask 8.3.4: 新增 `.github/PULL_REQUEST_TEMPLATE.md`
  - [x] SubTask 8.3.5: 新增 `CONTRIBUTING.md`(开发环境 / 代码规范 / 提交规范 / 图标生成)
  - [x] SubTask 8.3.6: 新增 `SECURITY.md`(安全漏洞报告流程 + AI Key 安全说明)

- [x] Task 8.4: i18n 翻译键
  - [x] SubTask 8.4.1: 在 `i18n.tsx` 新增 `about.*` 系列翻译键(约 35 个,中英双语)

## Task Dependencies

- Task 1.2(manifest.json)是 Task 4.3 / 4.4 / 4.5 / 4.6 的前置依赖
- Task 1.3(章节 front matter UUID)是 Task 4.8(大纲同步章节)的前置依赖
- Task 1.6(persist 中间件)与 Task 1.5(自定义关系类型后端化)可并行
- Task 2.1(AppError 迁移)是 Task 3.2(export_project_to_txt 命令)的前置依赖
- Task 2.7(detect_format 修复)是 Task 3.1 的前置依赖,Task 3.1 是 Task 3.2 的前置依赖
- Task 5.1(伏笔模块)是 Task 4.9.3(跳转到伏笔命令)的前置依赖
- Task 7.1(版本同步)应在所有代码变更完成后执行
- Task 7.5(构建发布)依赖 Task 7.1 / 7.2 / 7.3 / 7.4 完成
- Task 8.1(README)应在所有功能完成后更新,以确保信息准确
- Task 8.2(About)与 Task 8.4(i18n)可并行,但 Task 8.2 依赖 Task 8.4 完成
- 阶段一(存储重构)与阶段二(问题修复)的 Task 2.1-2.11 可与阶段一的 Task 1.6-1.9 并行
- 阶段四(数据孤岛)的多数任务依赖阶段一的 manifest.json 与 UUID 体系
- 阶段六(废弃清理)可与其他阶段并行,但 Task 6.1.3(合并 is_supported_doc)应在 Task 1.8.2(目录扫描配置)之后
