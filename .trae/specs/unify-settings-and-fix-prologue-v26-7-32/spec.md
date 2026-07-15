# 序章语义化修复与设置页面统一化 Spec

## Why

项目在 v26.8.0 综合优化后,遗留两个问题:

1. **序章文件语义化数据化错误**:用户通过「首次创建：序章」按钮创建的序章文件使用 `.txt` 格式（`workspace.defaultIntroFileName = "序章.txt"`），与阶段一 Task 1.3 建立的章节文件 `.pmd` 格式（UUID front matter 注入）不一致。导致序章无 UUID、不被 manifest 索引、字数统计走 .txt 分支、与正文其他章节格式割裂，形成新的数据孤岛。

2. **设置页面风格不统一**:4 个设置分区（General / Ai / Appearance / About）的悬浮卡片在大小、宽度、高度、padding、排版样式上存在差异，UIUX 风格未统一，影响项目整体视觉一致性。

## What Changes

### 序章语义化修复
- 将 `workspace.defaultIntroFileName` 从 `"序章.txt"` 改为 `"序章.pmd"`（中英双语同步）
- 将 `workspace.defaultIntroContent` 改为符合 `.pmd` 格式的初始内容（ProseMirror JSON 文档结构或带 front matter 的纯文本）
- 验证 `createFile` 命令对 `.pmd` 文件的 UUID front matter 注入逻辑覆盖序章创建路径
- 验证序章创建后被 manifest 索引识别为章节实体
- 验证字数统计对序章 `.pmd` 文件正确计算

### 设置页面统一化
- 统一 4 个设置分区卡片样式：`bg-zinc-900/40 + rounded-lg + p-4`（若已统一则仅清理差异）
- 统一卡片宽度、高度、内边距、外边距
- 统一标题、描述、图标排版样式
- 统一交互元素（按钮、开关、输入框）的尺寸与间距
- 统一分区间的垂直间距
- 允许「留空」：卡片内容不足时保持最小高度，不强制填充

### 版本发布
- 版本号同步到 `26.7.32`（6 处文件）
- 本地构建 MSI + NSIS 安装包
- 推送 git commit + tag `v26.7.32`
- 创建 GitHub Release 并上传安装包 + sha256

### 历史版本清理（**BREAKING** / 高风险）
- 删除过往所有 GitHub Release（v26.7.28 / v26.7.29 / v26.7.30 / v26.8.0 等）
- 删除过往所有 git tag
- **风险说明**:此操作不可逆,会永久丢失历史版本记录。仅保留 v26.7.32 作为唯一存在版本。

## Impact

- Affected specs: comprehensive-optimization-v26-8-0（序章修复延续阶段一 Task 1.3）
- Affected code:
  - `src/lib/i18n.tsx`（defaultIntroFileName / defaultIntroContent 翻译键）
  - `src/components/Workspace.tsx`（handleCreatePrologue 调用路径）
  - `src/components/settings/*.tsx`（4 个设置分区组件样式统一）
  - `src/components/SettingsDialog.tsx`（外壳容器样式）
  - 版本号 6 处文件
  - GitHub Release / tag

## ADDED Requirements

### Requirement: 序章 .pmd 格式化
系统 SHALL 在用户通过「首次创建：序章」按钮创建序章时,生成 `.pmd` 格式文件,并自动注入 UUID front matter,使其与其他章节文件格式一致,被 manifest 索引识别。

#### Scenario: 序章创建成功
- **WHEN** 用户在空正文目录下点击「序章」按钮
- **THEN** 系统创建 `正文/序章.pmd` 文件
- **AND** 文件包含 UUID front matter（`---\nid: <uuid>\n---`）
- **AND** manifest 索引记录该章节实体
- **AND** 字数统计正确计算序章字数

### Requirement: 设置页面卡片样式统一
系统 SHALL 在所有设置分区（General / Ai / Appearance / About）使用统一的卡片样式规范,包括宽度、高度、内边距、排版与交互元素尺寸。

#### Scenario: 设置页面视觉一致
- **WHEN** 用户在设置对话框中切换不同分区
- **THEN** 所有分区的卡片使用相同的 `bg-zinc-900/40 + rounded-lg + p-4` 样式
- **AND** 卡片间距统一（垂直间距一致）
- **AND** 标题、描述、图标排版风格一致
- **AND** 交互元素（按钮、开关、输入框）尺寸与间距统一
- **AND** 内容不足的卡片保持最小高度,不强制填充

## MODIFIED Requirements

### Requirement: 版本号唯一性
项目版本号 SHALL 同步到 `26.7.32`,作为唯一存在版本。过往版本（v26.7.28 / v26.7.29 / v26.7.30 / v26.8.0）及其 GitHub Release / tag 记录 SHALL 被删除。

## REMOVED Requirements

### Requirement: 历史版本记录
**Reason**: 用户要求 v26.7.32 作为唯一存在版本,删除过往版本及其记录。
**Migration**: 无需迁移,仅清理远程仓库的历史 Release 与 tag。本地 git 历史保留（不重写）,仅删除远程 tag 与 Release。
