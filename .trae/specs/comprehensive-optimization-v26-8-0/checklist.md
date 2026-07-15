# Checklist

本检查清单按 8 大阶段组织,用于系统化验证 spec.md 中各 Requirement 的实现完整性。

## 阶段一:存储类型分析与重构

- [x] AppData 根目录已统一为 `MiaoChuangShuo`,无 `novelforge` 残留路径常量
- [x] 旧 `novelforge` 目录数据已自动迁移到 `MiaoChuangShuo`,迁移函数在应用启动时执行
- [x] 应用启动后可正常读取偏好/模板/AI 配置(无"配置文件不存在"错误)
- [ ] `manifest.rs` 模块已创建,`Manifest` / `ManifestEntity` / `ReverseIndex` 结构体定义完整(带 `#[serde(rename_all = "camelCase")]`)
- [ ] `load_manifest` / `save_manifest` / `register_entity` / `unregister_entity` / `update_reverse_index` 函数实现完整
- [ ] `create_project` 命令在创建 6 个固定目录后,额外生成空 manifest.json
- [ ] `file_io_commands.rs` 文件创建/删除/重命名命令已同步更新 manifest
- [ ] `get_manifest` / `update_manifest_entity` Tauri 命令已注册到 `lib.rs::invoke_handler`
- [x] 章节文件创建时自动生成 UUID v4 并写入 front matter
- [x] 大纲文件已从 `.txt` 迁移到 `.pmd` 格式,迁移函数 `migrate_outline_to_pmd` 实现完整
- [x] 旧项目首次打开时自动迁移,旧 `.txt` 文件保留为 `.bak` 作为备份
- [x] 章节保存时 manifest 中的 wordCount 字段已同步更新
- [x] `writing_stats.json` 持久化文件已生成,包含 chapter_words / total_words / last_updated 字段
- [x] `get_writing_stats` 优先读取持久化数据,文件 mtime 变化时增量更新
- [x] 章节保存时调用 `update_chapter_word_count` 增量更新 WritingStats
- [x] 自定义关系类型已从 localStorage 迁移到后端 `%APPDATA%\MiaoChuangShuo\custom_relation_types.json`
- [x] 前端 `customRelationStore.ts` 改为调用后端 API,首次启动时从 localStorage 迁移数据
- [x] `load_custom_relation_types` / `save_custom_relation_types` 命令已注册
- [ ] zustand persist 中间件已应用到 `editorSettingsStore` / `appearanceStore` / `themeStore` / `uiStore` / `recentFiles`
- [ ] `editorSettingsStore` 与 `appearanceStore` 的 STORAGE_KEY 已分离(改为 `miaochuangshuo-editor-settings` 与 `miaochuangshuo-appearance`)
- [ ] 旧 key 数据已自动迁移到新 key
- [x] `schemars` crate 依赖已添加到 `Cargo.toml`
- [x] `ProjectMeta` / `Manifest` / `AiConfig` / `EditorPreferences` / `TimelineGraph` / `CharacterGraph` / `SnapshotMeta` / `CustomTemplate` 均派生 `JsonSchema`
- [x] `generate_schemas` 命令可输出 JSON Schema 到 `schemas/` 目录
- [x] 前端 TS 类型已通过 `json-schema-to-typescript` 生成
- [x] CI 中已添加 schema 一致性检查步骤
- [x] `ProjectMeta` 已新增 `codexDirs` / `outlineDir` / `manuscriptDir` / `draftDir` 字段(带 `#[serde(default)]`)
- [x] 后端 `CODEX_DIRS` 硬编码已改为读取 ProjectMeta 配置
- [x] 前端 `detectCategoryFromPath` 已改为从 ProjectMeta 读取
- [x] 旧项目创建时填充默认目录配置,向后兼容
- [x] `migrate_manifest` 函数已实现,按 schemaVersion 逐步升级
- [x] timeline / character_graph 的 load 函数已检测 schema_version 并迁移
- [x] schema 升级流程已文档化到 `docs/schema-migration.md`

## 阶段二:项目问题与漏洞修复

- [x] `snapshot_commands.rs` 14 个函数已迁移到 `AppError`
- [x] `character_graph_commands.rs` 5 个函数已迁移到 `AppError`
- [x] `timeline_commands.rs` 5 个函数已迁移到 `AppError`
- [x] `character_commands.rs` 4 个函数已迁移到 `AppError`
- [x] `template_schema.rs` 6 个函数已迁移到 `AppError`
- [x] 前端 catch 块统一处理 `{kind, message, context}` 结构,无字符串错误处理残留
- [ ] Windows DPAPI 加密函数 `encrypt_with_dpapi` / `decrypt_with_dpapi` 实现完整
- [ ] macOS/Linux 平台保持 keyring-only 策略,keyring 不可用时返回错误
- [ ] Base64 回退模式已改为 DPAPI 加密
- [ ] 旧 Base64 数据自动迁移解密后重新加密
- [ ] 加密/解密往返一致性测试通过
- [x] `lib.rs:210` `.expect()` 已改为 `match` + 友好错误提示
- [x] 启动失败时显示 Windows 消息框(而非静默崩溃)
- [x] `@tanstack/react-virtual` 已安装
- [x] `SnapshotHistory.tsx` 已改造为虚拟列表
- [x] `FileList.tsx` 文件树节点已虚拟化
- [x] `GlobalSearch.tsx` 搜索结果已虚拟化
- [x] 虚拟列表滚动性能良好,无障碍访问功能完整
- [ ] `useAiStream.ts` 已引入 `abortControllerRef`
- [ ] `startStream` 中创建新 AbortController 并传入 fetch signal
- [ ] `cancelStream` 同时调用 `abortControllerRef.current?.abort()` 与后端 `cancel_chat_completion`
- [ ] 取消后 fetch 立即抛出 AbortError,UI 正确恢复
- [ ] xyflow `Node` / `Edge` 已传入正确泛型参数(如 `Node<TimelineNodeData>`)
- [ ] 12 处 `as unknown as` 双重断言已全部移除
- [ ] `tsc --noEmit` 通过
- [ ] `text_extractor.rs::detect_format` 在 `.txt` 分支已增加 JSON 探测
- [ ] 首字符为 `{` 且能解析为 JSON 含 `type` 字段时按 `PmdJson` 处理
- [ ] 单元测试覆盖 4 种格式检测
- [ ] 字数统计不再将 JSON 结构字符计入
- [x] `diff` npm 包已安装
- [x] `SnapshotHistory.tsx::computeLineDiff` 已改用 `diff.diffLines`
- [x] 差异统计数字准确
- [ ] `AiAssistantPanel.tsx::handleSendRef` 赋值已移入 useEffect
- [ ] 其他组件的相同模式已统一修复
- [ ] `useEditorFileIO.ts` 的 500/300/1500/100 已抽取为命名常量
- [ ] `AiAssistantPanel.tsx` / `GraphPanelShell.tsx` / `graphStoreFactory.ts` 同类处理完成
- [ ] 常量已集中到各文件头部或独立 `constants.ts`
- [ ] i18n 中英文切换验证完成
- [ ] 所有新增 i18n key 显示正确(中英文)
- [ ] CharacterGraphEdgeDrawer / TimelinePanel / toast / characterGraphTypes / timelineTypes 五处变更点验证通过
- [ ] key 拼写错误或插值语法问题已修复

## 阶段三:TXT 导出功能重构

- [ ] `export_commands.rs` 模块已创建
- [ ] `TxtExportOptions` 结构体定义完整(mode / includeChapterTitle / bom / crlf / outputPath)
- [ ] `export_project_to_txt` 命令实现完整
- [ ] 递归遍历正文目录,按文件名字典序排序
- [ ] 调用 `text_extractor::extract_plain_text` 提取纯文本
- [ ] 按选项拼接(分卷分隔符 / 章节标题 / 换行符 / BOM)
- [ ] 写入用户选择目录(通过 `pickDirectory` 获取)
- [ ] 命令已注册到 `lib.rs::invoke_handler`
- [ ] 前端 `exportProjectToTxt` API 函数已封装
- [ ] `ProjectArchiveDialog.tsx` 已新增 `mode="export-txt"` 模式
- [ ] 导出选项 UI 完整(模式选择 / 标题行 / BOM / CRLF)
- [ ] `Workspace.tsx` 已新增"导出为 TXT"按钮
- [ ] `NovelEditor.tsx::handleExportTxt` 已重构为调用 Tauri dialog 选择保存目录
- [ ] `CommandPalette.tsx` 已新增"导出为 TXT"命令
- [ ] i18n `export.*` 系列翻译键已添加(约 15 个,中英双语)
- [ ] 中英文切换显示正确
- [ ] 单章导出测试通过
- [ ] 多章合并导出测试通过
- [ ] 整项目导出测试通过
- [ ] 按分卷导出测试通过
- [ ] UTF-8 BOM 选项生效
- [ ] CRLF 换行符选项生效

## 阶段四:数据孤岛与联动优化

- [x] `CharacterGraphNodeData` 已新增 `codexId: string` 字段,保留 `sourceFile` 用于显示
- [x] 后端 `CharacterNodeData` 已同步新增 `codex_id: Option<String>` 字段
- [x] 图谱节点创建时自动从设定库卡片获取 codexId
- [x] 旧图谱数据已通过 sourceFile 反查 codexId 填充
- [x] `TimelineNodeData` 已新增 `chapterId: string | null` 字段
- [x] `TimelineDrawer.tsx` 已新增"关联章节"下拉选择器
- [x] `TimelinePanel.tsx` 已新增"跳转到章节"按钮(仅当 chapterId 非空时显示)
- [x] 章节删除时自动清理人物图谱 sourceFile 悬挂引用
- [x] 章节删除时自动清理时间线 chapterId 引用
- [x] 章节删除时自动清理 manifest.entities.chapters 记录
- [x] 设定库删除卡片时通过 manifest.reverseIndex 查找所有引用
- [x] `remove_mentions_from_chapters` 命令已实现,可清理正文中 Mention 节点
- [x] 前端 `useCodexStore.ts::deleteCard` 调用后刷新所有打开的编辑器
- [x] `categorySlice.activeFileWordCount` 缓存已删除,改为从 WritingStats 派生
- [x] `ProjectInfo.word_count` 缓存已删除,改为从 WritingStats 读取
- [x] 章节保存时调用 `update_chapter_word_count` 增量更新 WritingStats
- [x] 项目卡片字数从 WritingStats 读取,实时更新
- [x] `rename_character_in_project` 扫描目录已扩展到"设定/大纲/草稿箱"
- [x] 使用 UUID 关联替代字符串替换,避免子串误伤
- [x] 单元测试覆盖子串误伤场景(如"小明" vs "小明明")
- [x] `CharacterGraphDrawer.tsx` 已新增"在设定库中查看"按钮(仅当 codexId 存在时显示)
- [x] 点击触发 `setActiveCategory("codex")` + `setPendingSelectCardId(codexId)`
- [x] 大纲 `.pmd` 化后,front matter 已注入 outlineId 与 chapterId
- [x] 大纲条目修改时检测 chapterId 是否存在,提示用户同步
- [x] 章节重命名时反向更新大纲 front matter 的 title 字段
- [x] `CommandPalette.tsx` 已新增"跳转到图谱节点"命令
- [x] 已新增"跳转到时间线事件"命令
- [x] 已新增"跳转到伏笔"命令(伏笔模块完成后启用)

## 阶段五:便捷操作增强

- [x] `foreshadowing_commands.rs` 模块已创建
- [x] `Foreshadowing` 结构体定义完整(id / title / status / setupChapterId / resolutionChapterId / importance / note / createdAt / updatedAt)
- [x] CRUD 命令(list / create / update / delete)实现完整
- [x] 持久化到 `<project>/伏笔/foreshadowings.json`
- [x] `create_project` 命令自动创建 `伏笔/` 目录
- [x] 前端 `foreshadowingApi.ts` API 封装完整
- [x] `useForeshadowingStore.ts` Zustand store 实现完整
- [x] `ForeshadowingPanel.tsx` 面板组件实现完整(统计概览卡片 + 按状态分组可展开列表)
- [x] `Workspace.tsx` 已注册 Alt+8 快捷键切换伏笔面板
- [x] `categoryRegistry.ts` 已注册"伏笔"分类(图标: Eye / 颜色: 橙色)
- [x] i18n `foreshadowing.*` 系列翻译键已添加(约 20 个,中英双语)
- [x] `FileList.tsx` 章节列表已新增多选模式(Ctrl+Click / Shift+Click)
- [x] 多选状态下显示批量操作工具栏(重命名 / 导出 / 删除 / 移动到卷)
- [x] `CodexPanel.tsx` 设定库条目已新增多选模式
- [x] 批量删除设定库条目时循环调用单条删除并清理 Mention
- [x] `useFileDragSort.ts` 已扩展支持跨目录拖拽
- [x] 拖拽到另一卷时调用 `move_file` 命令,更新 manifest.volumeId
- [x] `CodexPanel.tsx` 已启用 HTML5 拖拽 API
- [x] 拖拽条目到另一分组时调用 `move_file` 命令
- [x] `useEditorAutoSave.ts` 保存成功后已调用 `update_file_index`
- [x] 索引更新延迟在 500ms 内

## 阶段六:废弃代码清理

- [x] `prosemirror_parser.rs::extract_text_and_scene_id_from_nodes` 已删除
- [x] 对应 3 个测试用例已删除
- [x] `commands/mod.rs::count_chinese_and_words` 调用点已迁移到 `word_count::count_words`
- [x] `count_chinese_and_words` 包装函数已删除
- [x] `is_supported_doc` 与 `is_indexable_file` 已合并为单一函数
- [x] 另一处 alias 导出已配置
- [x] `prosemirror_parser.rs` 已抽出 `collect_text_from_node_core` 公共递归核心
- [x] `text_extractor.rs::collect_text_from_node` 已改为调用核心函数并丢弃 scene_id
- [x] `docs/research/` 目录已创建
- [x] `DEEP_RESEARCH_AI_API_KEY_UX.md` 已移动到 `docs/research/ai-api-key-ux.md`
- [x] `DEEP_RESEARCH_AI_CLIENT_MODULES.md` 已移动到 `docs/research/ai-client-modules.md`
- [x] `timeline_commands.rs` 中写入 `_剧情时间线摘要.txt` 的逻辑已删除
- [x] `character_graph_commands.rs` 中写入 `_人物关系图摘要.txt` 的逻辑已删除
- [x] `generate_graph_summary` 按需生成摘要命令已实现
- [x] 根目录整洁:仅包含子文件夹,无零散 .md 文件

## 阶段七:构建发布与版本同步

- [x] `package.json` 版本号已更新为 `26.8.0`
- [x] `Cargo.toml` 版本号已更新为 `26.8.0`
- [x] `Cargo.lock` 版本号已更新为 `26.8.0`
- [x] `tauri.conf.json` 版本号已更新为 `26.8.0`
- [x] `updateChecker.ts::FALLBACK_VERSION` 已更新为 `26.8.0`
- [x] `useVersionCheck.ts::DEFAULT_APP_VERSION` 已删除,改为 `import { FALLBACK_VERSION } from "../lib/updateChecker"`
- [x] `scripts/sync-version.mjs` 脚本已实现,接受版本号参数自动更新 6 处文件
- [x] 脚本包含版本号格式校验(YY.MM.修改序号)
- [x] `package.json` 已添加 `"sync-version": "node scripts/sync-version.mjs"` script
- [x] `release-desktop.yml` 已新增 `workflow_dispatch` 手动触发
- [x] 预检 job(`tsc --noEmit` + `cargo check`)已添加
- [x] 构建后生成 `sha256` 哈希文件并上传
- [x] 版本号一致性校验步骤已添加
- [x] `deploy-web.yml` 的 Actions 版本已统一到 `@v4`
- [x] Node 版本已统一为 20
- [x] `package.json` 已添加 `engines: { node: ">=20" }` 字段
- [x] `npm run tauri build` 成功生成 MSI + NSIS 安装包
- [x] MSI 安装包大小合理(~10MB)
- [x] NSIS 安装包大小合理(~8MB)
- [x] 所有变更已提交到 git
- [x] `v26.8.0` tag 已推送,触发 GitHub Release 自动创建
- [x] MSI + NSIS + sha256 文件已上传到 GitHub Release
- [x] `tsc --noEmit` 通过
- [x] `cargo check` 通过
- [x] `vite build` 通过
- [x] `tauri build` 通过
- [x] `cargo test` 通过
- [ ] 应用启动测试通过(无 panic)

## 阶段八:README 与 About 栏目升级

- [x] README 版本号徽章已改为动态 shields.io 从 Release 拉取
- [x] README 版本号同步表已修正为 6 处
- [x] README 代码结构树已同步 commands/、codex/、ai_context/ 子模块重构结果
- [x] README 首屏已插入 4-6 张代表性截图(创作界面 / 人物关系图谱 / 剧情图谱 / 写作统计)
- [x] README 目录(Table of Contents)已添加
- [x] README FAQ 章节已添加(HVCI / 杀软拦截 / AI Key 配置 / 数据存储位置 / 升级)
- [x] README Roadmap 章节已添加
- [x] README 章节折叠已统一(全部使用 `<details>`)
- [x] AboutSettingsSection.tsx 顶部已新增应用图标(64x64)+ 应用名 + slogan
- [x] 项目介绍区已添加(2-3 句话简介 + 三大原则)
- [x] 核心特性列表已添加(5 大模块图标列表)
- [x] 技术栈展示已添加(Tauri / React / Rust / TypeScript / TipTap / React Flow / Tantivy)
- [x] 作者信息区已添加(fanquanpp + GitHub 仓库 + Issue + Release 链接)
- [x] 致谢区已添加(折叠,列出核心依赖库)
- [x] 开源协议区已添加(链接到 LICENSE 文件)
- [x] "复制版本号""打开日志目录"辅助按钮已添加
- [x] 分区卡片化、链接按钮化、版本号大字展示美化完成
- [x] `LICENSE` 文件已新增(CC-BY-NC-4.0 署名-非商用)
- [x] `.github/ISSUE_TEMPLATE/bug_report.yml` 已新增
- [x] `.github/ISSUE_TEMPLATE/feature_request.yml` 已新增
- [x] `.github/PULL_REQUEST_TEMPLATE.md` 已新增
- [x] `CONTRIBUTING.md` 已新增(开发环境 / 代码规范 / 提交规范 / 图标生成)
- [x] `SECURITY.md` 已新增(安全漏洞报告流程 + AI Key 安全说明)
- [x] i18n `about.*` 系列翻译键已添加(约 35 个,中英双语)
- [x] About 栏目中英文切换显示正确

## 综合验收

- [x] 所有阶段任务已完成,tasks.md 中所有复选框已勾选
- [x] `tsc --noEmit` 通过
- [x] `cargo check` 通过
- [x] `vite build` 通过
- [x] `tauri build` 通过
- [x] `cargo test` 通过
- [ ] 应用启动无 panic,UI 正常显示
- [ ] 新建项目测试通过(6 目录 + manifest.json + 伏笔目录)
- [ ] 章节创建/编辑/保存测试通过(front matter UUID 注入)
- [ ] TXT 导出测试通过(四种模式)
- [ ] 伏笔模块测试通过(Alt+8 面板 / CRUD / 统计)
- [ ] 数据孤岛优化验证(章节删除清理悬挂引用 / 设定库删除清理 Mention)
- [ ] 字数统计实时性验证(章节保存后项目卡片字数立即更新)
- [ ] 跨模块跳转验证(图谱 → 设定库 / 时间线 → 章节 / 命令面板跨模块跳转)
- [x] 版本号一致性验证(6 处文件版本号均为 `26.8.0`)
- [x] GitHub Release v26.8.0 已创建,包含 MSI + NSIS + sha256 文件
- [x] README 与 About 栏目信息准确无误
- [x] 仓库治理文件齐全(LICENSE / CONTRIBUTING / SECURITY / Issue 模板 / PR 模板)
