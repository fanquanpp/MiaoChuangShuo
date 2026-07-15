# 喵创说综合优化 v26.8.0 Spec

## Why

项目当前存在**存储格式碎片化、数据孤岛严重、便捷操作缺失、导出功能薄弱、README/About 信息过时**五大核心痛点。前一轮 `refactor-project-modularization` 已完成代码结构层面的模块化,但数据结构层面仍是"硬编码 + 文件文档式存储",导致跨模块数据联动割裂、字数统计三处独立缓存、人物图谱 sourceFile 悬挂引用、伏笔功能 spec-only 未实现、自定义关系类型跨机器丢失等多项问题。本次目标是对项目进行全方位深度优化,统一存储架构、消除数据孤岛、增强便捷操作、完善导出功能、清理技术债务,并完成新版本构建与发布。

## What Changes

### 存储类型重构
- 统一 AppData 根目录为 `MiaoChuangShuo`(消除 `novelforge` 与 `MiaoChuangShuo` 双目录)
- 引入项目级 `manifest.json` 统一索引(位置:`<project>/.novelforge/manifest.json`),记录所有数据实体的 UUID 与 sourceFile 映射 + 反向索引
- 为每个数据实体分配 UUID v4(章节、大纲、设定库、图谱节点、时间线节点)
- 章节文件 front matter 注入 UUID/volumeId/outlineId/order 字段
- 大纲文件从 `.txt` 迁移到 `.pmd`(JSON front matter + ProseMirror JSON 正文)
- 引入 JSON Schema 定义(基于 `schemars` 自动生成),统一前后端类型一致性
- 持久化 WritingStats 到 `.novelforge/writing_stats.json`(消除每次全目录扫描)
- 自定义关系类型从 localStorage 迁移到后端持久化(`%APPDATA%\MiaoChuangShuo\custom_relation_types.json`)
- 引入 zustand persist 中间件统一 localStorage 管理(替代手工 read-modify-write)
- 分离 `editorSettingsStore` 与 `appearanceStore` 的共享 STORAGE_KEY
- 统一目录扫描配置到 `ProjectMeta.codexDirs/outlineDir/manuscriptDir/draftDir` 字段
- 实现 `schema_version` 迁移机制(为未来 schema 变更预留升级路径)

### 项目问题与漏洞修复
- **BREAKING**: 迁移 5 个后端模块 34 个函数从 `Result<T, String>` 到 `AppError`(snapshot_commands / character_graph_commands / timeline_commands / character_commands / template_schema)
- 修复 AI API Key Base64 回退存储(改用 Windows DPAPI 加密)
- 修复 `lib.rs:210` `.expect()` panic 风险(改用友好错误提示)
- 引入 `@tanstack/react-virtual` 虚拟化大列表(SnapshotHistory / FileList / GlobalSearch)
- 前端 `useAiStream` 引入 `AbortController` 自主中断请求
- 消除 xyflow 双重断言(12 处 `as unknown as`)
- 修复 `text_extractor.rs::detect_format` 误判 `.txt` 含 JSON 内容
- 修复 `SnapshotHistory.tsx::computeLineDiff` 算法缺陷(改用 LCS)
- 修复 `AiAssistantPanel.tsx::handleSendRef` 每次渲染赋值(改用 useEffect)
- 抽取魔法数字为命名常量
- 执行 i18n 中英文切换验证

### TXT 导出功能重构
- 新增 Rust 命令 `export_project_to_txt`(支持单章/多章合并/整项目/按分卷四种模式)
- 支持用户选择导出目录(通过 `tauri-plugin-dialog` 的 `pickDirectory`)
- 支持选项:包含章节标题行、UTF-8 BOM、CRLF 换行符、分卷分隔符
- 复用 `text_extractor::extract_plain_text` 统一文本提取
- 新增前端 API `exportProjectToTxt` + UI 入口(ProjectArchiveDialog 增加"导出为 TXT"模式)
- 重构单章导出为调用 Tauri dialog 选择保存目录(替代浏览器 Blob 下载)

### 数据孤岛与联动优化
- **BREAKING**: `CharacterGraphNodeData.sourceFile` 改为 `codexId`(UUID 关联),保留 sourceFile 用于显示
- `TimelineNodeData` 新增 `chapterId` 字段,实现时间线 → 章节跳转
- 章节删除时自动清理人物图谱 sourceFile 悬挂引用 + 时间线关联
- 设定库删除卡片时自动清理正文中 Mention 节点(替代 `scanInvalidMentions` 按需检测)
- 字数统计 SSOT 收敛(消除三处独立缓存:activeFileWordCount / WritingStats.stats / ProjectInfo.word_count)
- 项目总字数实时更新(章节保存时后端增量统计 + 通知前端)
- Codex 改名联动扩展到设定/大纲/草稿箱目录
- 人物图谱 Drawer 新增"跳转到设定库"按钮
- 大纲修改同步章节(基于 outlineId 双向关联)
- 命令面板新增跨模块跳转命令(跳转到图谱节点/时间线事件/伏笔)

### 便捷操作增强
- 新建伏笔模块(目录创建 + CRUD + Alt+8 面板 + 统计概览卡片 + 按状态分组列表)
- 批量操作:批量重命名章节、批量导出章节、批量删除设定库条目(多选)、批量移动章节到另一卷
- 章节列表支持拖拽到另一卷
- 设定库条目支持拖拽分组
- 章节内容修改增量索引(替代全量 buildProjectIndex)

### 废弃代码清理
- 删除 `prosemirror_parser.rs::extract_text_and_scene_id_from_nodes` + 对应测试
- 合并 `commands/mod.rs::is_supported_doc` 与 `is_indexable_file`
- 抽取 `prosemirror_parser` 与 `text_extractor` 的 `collect_text_from_node` 公共核心
- 迁移 `DEEP_RESEARCH_*.md` 到 `docs/research/`
- 清理 `commands/mod.rs::count_chinese_and_words` 包装函数(迁移调用点)

### 构建发布与版本同步
- 版本号统一升级到 `26.8.0`(5 处文件同步)
- `release-desktop.yml` 新增 `workflow_dispatch` 手动触发 + 预检 job(tsc --noEmit + cargo check)
- 新增产物 `sha256` 哈希校验文件
- 新增 `scripts/sync-version.mjs` 自动版本同步脚本
- 消除 `useVersionCheck.ts::DEFAULT_APP_VERSION` 重复硬编码(改为 import `FALLBACK_VERSION`)
- 构建 MSI + NSIS 双安装包并推送到 GitHub Release

### README 与 About 栏目升级
- README 修正版本号徽章与同步表
- README 首屏插入 4-6 张代表性截图(从 docs/images/ 引用)
- README 新增目录(Table of Contents)+ FAQ + Roadmap 章节
- README 修正代码结构树(commands/、codex/、ai_context/ 子模块)
- README 章节折叠统一(全部使用 `<details>`)
- About 栏目重构:新增应用图标/项目介绍/作者/开源协议/依赖库/技术栈
- About 栏目新增"复制版本号""打开日志目录"辅助功能
- 新增 LICENSE 文件(CC-BY-NC-4.0 署名-非商用)
- 新增 `.github/ISSUE_TEMPLATE/bug_report.yml` 与 `feature_request.yml`
- 新增 `.github/PULL_REQUEST_TEMPLATE.md`
- 新增 `CONTRIBUTING.md` 与 `SECURITY.md`

## Impact

### 受影响的 Specs
- `refactor-project-modularization`(代码结构层面已完成,本次为数据结构层面延续)
- 无其他依赖 spec

### 受影响的核心代码
- **后端 Rust**:`ai_config.rs` / `ai_commands.rs` / `commands/*.rs` / `codex/*.rs` / `ai_context/*.rs` / `character_graph_commands.rs` / `timeline_commands.rs` / `snapshot_commands.rs` / `character_commands.rs` / `template_schema.rs` / `text_extractor.rs` / `prosemirror_parser.rs` / `project_template.rs` / `tantivy_indexer.rs` / `lib.rs`
- **前端 Store**:`store.ts` / `stores/*.ts` / `*Store.ts` / `preferencesSlice.ts` / `eventBusSlice.ts`
- **前端 API**:`api/*.ts` / `*Api.ts` / `aiService.ts`
- **前端组件**:`AiAssistantPanel.tsx` / `SnapshotHistory.tsx` / `FileList.tsx` / `GlobalSearch.tsx` / `NovelEditor.tsx` / `EditorToolbar.tsx` / `ProjectArchiveDialog.tsx` / `CharacterGraphDrawer.tsx` / `CharacterGraphContextMenu.tsx` / `TimelineDrawer.tsx` / `TimelinePanel.tsx` / `CommandPalette.tsx` / `Workspace.tsx` / `settings/AboutSettingsSection.tsx` / `settings/AiSettingsSection.tsx`
- **前端 Hook**:`useAiStream.ts` / `useEditorFileIO.ts` / `useCodexSync.ts` / `useEditorMention.ts`
- **前端 Lib**:`i18n.tsx` / `updateChecker.ts` / `useVersionCheck.ts` / `characterGraphTypes.ts` / `timelineTypes.ts` / `categoryRegistry.ts` / `recentFiles.ts` / `editorSettingsStore.ts` / `appearanceStore.ts`
- **构建配置**:`package.json` / `Cargo.toml` / `Cargo.lock` / `tauri.conf.json` / `.github/workflows/release-desktop.yml` / `.github/workflows/deploy-web.yml`
- **文档**: `README.md` / 新增 LICENSE / CONTRIBUTING.md / SECURITY.md / Issue 与 PR 模板

## ADDED Requirements

### Requirement: 项目级 manifest.json 统一索引
系统 SHALL 在项目创建时自动生成 `<project>/.novelforge/manifest.json`,记录所有数据实体的 UUID 与 sourceFile 映射,以及反向索引(codexId → graphNodeIds / codexId → chapterIds / chapterId → timelineNodeIds)。

#### Scenario: 创建新项目时生成 manifest
- **WHEN** 用户通过 CreateProjectDialog 创建新项目
- **THEN** 后端 `create_project` 命令在创建 6 个固定目录后,额外生成 `.novelforge/manifest.json`,内容为 `{schemaVersion:1, projectId:UUID, updatedAt:ISO8601, entities:{chapters:[], outlines:[], codex:[], graphNodes:[], timelineNodes:[], foreshadowings:[]}, reverseIndex:{}}`

#### Scenario: 创建章节文件时同步 manifest
- **WHEN** 用户在正文目录创建新章节 `.pmd` 文件
- **THEN** 后端在文件创建成功后,自动为该章节分配 UUID v4,写入文件 front matter,并在 manifest.entities.chapters 数组中追加 `{id, sourceFile, volumeId, outlineId, title, order, wordCount}` 记录

#### Scenario: 删除设定库卡片时清理反向引用
- **WHEN** 用户删除设定库中的某张卡片
- **THEN** 后端通过 manifest.reverseIndex 查找所有引用该 codexId 的图谱节点与章节,自动清理人物图谱 sourceFile 悬挂引用、正文中 Mention 节点、时间线 chapterId 关联

### Requirement: 伏笔模块
系统 SHALL 提供伏笔追踪功能,支持目录创建、CRUD、Alt+8 快捷键面板、统计概览卡片、按状态分组的可展开列表。

#### Scenario: 创建项目时自动创建伏笔目录
- **WHEN** 用户创建新项目
- **THEN** 后端自动创建 `伏笔/` 目录(与正文/设定/大纲/草稿箱/.novelforge 并列)

#### Scenario: 通过 Alt+8 打开伏笔追踪面板
- **WHEN** 用户在编辑器界面按下 Alt+8
- **THEN** 系统在右侧滑出伏笔追踪面板,显示统计概览卡片(总数/已埋设/已回收/已废弃)和按状态分组的可展开列表

### Requirement: TXT 导出功能
系统 SHALL 支持将用户书写的正文章节以 TXT 格式完整导出,支持用户选择导出目录,并提供四种导出模式(单章/多章合并/整项目/按分卷)。

#### Scenario: 整项目合并导出为单个 TXT
- **WHEN** 用户在 ProjectArchiveDialog 选择"导出为 TXT"模式,勾选"整项目合并",选择导出目录
- **THEN** 后端 `export_project_to_txt` 命令递归读取正文目录所有章节,按文件名字典序合并,每章前插入标题行,写入用户选择目录下的 `<项目名>.txt` 文件

#### Scenario: 按分卷导出
- **WHEN** 用户选择"按分卷导出"
- **THEN** 后端按正文目录下的子目录结构,每卷生成一个 TXT 文件,文件名为 `<卷名>.txt`

### Requirement: 统一存储格式
系统 SHALL 统一结构化数据为 JSON、章节正文为 ProseMirror JSON(.pmd)、模板为 TOML,废弃冗余的摘要 txt 文件。

#### Scenario: 大纲文件迁移到 .pmd 格式
- **WHEN** 系统首次打开使用旧版 `.txt` 大纲的项目
- **THEN** 后端自动迁移大纲 `.txt` 到 `.pmd` 格式,在 front matter 注入 outlineId UUID,正文保留 Markdown 风格文本

### Requirement: 版本号自动同步脚本
系统 SHALL 提供 `scripts/sync-version.mjs` 脚本,自动同步 6 处版本号文件。

#### Scenario: 执行版本号同步
- **WHEN** 开发者执行 `node scripts/sync-version.mjs 26.8.0`
- **THEN** 脚本自动更新 package.json / Cargo.toml / Cargo.lock / tauri.conf.json / updateChecker.ts / useVersionCheck.ts 中的版本号字段

## MODIFIED Requirements

### Requirement: AiConfig API Key 存储
原 Base64 回退存储改为 Windows DPAPI 加密(Windows)/ Keychain(macOS)/ Secret Service(Linux),keyring 不可用时拒绝存储 API Key 并提示用户解决钥匙串问题。

### Requirement: AppError 统一错误处理
扩展覆盖到 snapshot_commands / character_graph_commands / timeline_commands / character_commands / template_schema 共 5 个模块 34 个函数,前端 catch 统一处理 `{kind, message, context}` 结构。

### Requirement: 字数统计
原"按需拉取全目录扫描"改为"章节保存时后端增量统计 + 通知前端更新",消除 activeFileWordCount / WritingStats.stats / ProjectInfo.word_count 三处独立缓存,以 WritingStats 为唯一 SSOT。

### Requirement: CharacterGraphNodeData
`sourceFile: string` 字段保留用于显示,新增 `codexId: string` 字段(UUID 关联)作为主要引用方式。图谱节点创建时自动从设定库卡片获取 codexId。

### Requirement: TimelineNodeData
新增 `chapterId: string | null` 字段,关联章节 UUID,支持时间线 → 章节跳转。

### Requirement: ProjectMeta
新增 `codexDirs: Vec<String>` / `outlineDir: String` / `manuscriptDir: String` / `draftDir: String` 字段,统一目录扫描配置,消除后端硬编码 `CODEX_DIRS` 与前端 `detectCategoryFromPath`。

## REMOVED Requirements

### Requirement: 摘要 txt 文件双写
**Reason**: Timeline 与 CharacterGraph 的 `_剧情时间线摘要.txt` 与 `_人物关系图摘要.txt` 是冗余的人类可读摘要,与 JSON 主数据可能不同步,且可通过按需生成替代。
**Migration**: 删除写入摘要 txt 的逻辑,改为在用户请求时(如导出/打印)按需生成。

### Requirement: commands/mod.rs::count_chinese_and_words 包装函数
**Reason**: 重构残留包装函数,仅委托 `word_count::count_words`,注释说明"保留避免大量调用点改动"。
**Migration**: 迁移所有调用点到直接调用 `count_words`,删除该包装函数。

### Requirement: commands/mod.rs::is_supported_doc 与 is_indexable_file 重复函数
**Reason**: 两个函数判断逻辑完全相同,都匹配 `txt|pmd|html|htm`。
**Migration**: 合并为单一函数,另一处 alias 导出。

### Requirement: prosemirror_parser.rs::extract_text_and_scene_id_from_nodes
**Reason**: 标记 `#[allow(dead_code)]`,全项目无调用,仅测试用例引用。
**Migration**: 删除该函数与对应 3 个测试用例。
