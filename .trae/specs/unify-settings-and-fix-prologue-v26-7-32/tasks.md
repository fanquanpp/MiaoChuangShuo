# Tasks

本任务清单按 3 大阶段组织:序章修复 / 设置统一化 / 构建发布与历史清理。

## 阶段一:序章语义化修复

- [x] Task 1: 修复序章文件格式从 .txt 到 .pmd
  - [x] SubTask 1.1: 在 `src/lib/i18n.tsx` 将 `workspace.defaultIntroFileName` 从 `"序章.txt"` 改为 `"序章.pmd"`(zh),`"Prologue.txt"` 改为 `"Prologue.pmd"`(en)
  - [x] SubTask 1.2: 在 `src/lib/i18n.tsx` 将 `workspace.defaultIntroContent` 改为符合 .pmd 格式的初始内容(纯文本正文即可,createFile 会自动注入 front matter)
  - [x] SubTask 1.3: 验证 `src-tauri/src/commands/file_io_commands.rs::create_file` 对正文目录下 .pmd 文件的 UUID front matter 注入逻辑覆盖序章创建路径(序章通过 createFile 创建)
  - [x] SubTask 1.4: 验证序章创建后 manifest 索引记录该章节实体(file_io_commands.rs 中 create_file 同步 manifest 逻辑)
  - [x] SubTask 1.5: 验证 `src/lib/fileTreeUtils.ts` 中 `detectCategoryFromPath` 对 `序章.pmd` 正确识别为 manuscript 分类
  - [x] SubTask 1.6: 验证 `src/components/Workspace.tsx::handleCreatePrologue` 调用路径无 .txt 硬编码残留

## 阶段二:设置页面卡片样式统一化

- [x] Task 2: 审查 4 个设置分区当前样式差异
  - [x] SubTask 2.1: 读取 `src/components/settings/GeneralSettingsSection.tsx`、`AiSettingsSection.tsx`、`AppearanceSettingsSection.tsx`、`AboutSettingsSection.tsx` 的卡片样式类名
  - [x] SubTask 2.2: 记录各分区卡片样式差异(padding / margin / rounded / bg / gap / 标题样式 / 描述样式 / 图标尺寸)

- [x] Task 3: 统一卡片样式规范
  - [x] SubTask 3.1: 定义统一卡片样式规范:`bg-zinc-900/40 + rounded-lg + p-4 + space-y-4`
  - [x] SubTask 3.2: 统一卡片标题样式:`text-sm font-medium text-nf-text + flex items-center gap-2`
  - [x] SubTask 3.3: 统一卡片描述样式:`text-xs text-nf-text-tertiary`
  - [x] SubTask 3.4: 统一交互元素尺寸:按钮 `h-9`、开关 `h-6 w-11`、输入框 `h-9`
  - [x] SubTask 3.5: 统一卡片间垂直间距:`space-y-4` 或 `gap-4`
  - [x] SubTask 3.6: 内容不足的卡片保持 `min-h-[80px]` 最小高度,不强制填充

- [x] Task 4: 应用统一样式到 4 个设置分区
  - [x] SubTask 4.1: 修改 `GeneralSettingsSection.tsx` 应用统一卡片样式
  - [x] SubTask 4.2: 修改 `AiSettingsSection.tsx` 应用统一卡片样式
  - [x] 4.3: 修改 `AppearanceSettingsSection.tsx` 应用统一卡片样式
  - [x] 4.4: 修改 `AboutSettingsSection.tsx` 应用统一卡片样式(若已有独立设计则保持品牌区独特性,仅统一功能区卡片)
  - [x] 4.5: 检查 `SettingsDialog.tsx` 外壳容器样式是否需要调整(右侧内容区 padding / scroll)

- [x] Task 5: 验证设置页面视觉一致性
  - [x] 5.1: `npx tsc --noEmit` 通过
  - [x] 5.2: 代码审查确认 4 个分区卡片样式类名一致

## 阶段三:构建发布与历史版本清理

- [x] Task 6: 版本号同步到 26.7.32
  - [x] 6.1: 运行 `node scripts/sync-version.mjs 26.7.32` 同步 7 处文件(package.json/package-lock.json/Cargo.toml/Cargo.lock/tauri.conf.json/updateChecker.ts)
  - [x] 6.2: 验证 `npx tsc --noEmit` 通过
  - [x] 6.3: 验证 `cargo check` 通过
  - [x] 6.4: 运行 `cargo test` 全部通过(69 passed)

- [x] Task 7: 本地构建安装包
  - [x] 7.1: 运行 `npm run tauri build` 生成 MSI + NSIS
  - [x] 7.2: 生成 sha256 哈希文件(MSI: 97a4a12c..., NSIS: 4c4f0ba8...)
  - [x] 7.3: 验证安装包大小合理(MSI 10.4MB, NSIS 7.94MB)

- [x] Task 8: Git 提交与推送
  - [x] 8.1: `git add` 暂存所有变更(15 个修改文件 + spec 目录)
  - [x] 8.2: `git commit` 提交(844d145, Conventional Commits 规范)
  - [x] 8.3: 创建 annotated tag `v26.7.32`
  - [x] 8.4: `git push origin master` 推送提交(20097a5..844d145)
  - [x] 8.5: `git push origin v26.7.32` 推送 tag(new tag)

- [x] Task 9: 删除历史版本与创建新 Release
  - [x] 9.1: 使用 `gh release delete --cleanup-tag` 删除过往 GitHub Release(v26.8.0, v26.7.29)
  - [x] 9.2: 使用 `git push origin --delete` 删除过往远程 tag(v26.7.18-v26.7.24 共 7 个 + v26.8.0/v26.7.29 通过 --cleanup-tag 删除)
  - [x] 9.3: 本地 tag 已清理(仅剩 v26.7.32)
  - [x] 9.4: 使用 `gh release create v26.7.32` 创建新 Release 并上传 MSI + NSIS + sha256(4 个资产)

# Task Dependencies
- [Task 2] 依赖 [Task 1](可并行,文件无冲突)
- [Task 3] 依赖 [Task 2]
- [Task 4] 依赖 [Task 3]
- [Task 5] 依赖 [Task 4]
- [Task 6] 依赖 [Task 1, Task 5]
- [Task 7] 依赖 [Task 6]
- [Task 8] 依赖 [Task 7]
- [Task 9] 依赖 [Task 8]
