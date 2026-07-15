# Checklist

本检查清单按 3 大阶段组织,用于系统化验证 spec.md 中各 Requirement 的实现完整性。

## 阶段一:序章语义化修复

- [x] `workspace.defaultIntroFileName` 已从 `"序章.txt"` 改为 `"序章.pmd"`(zh)
- [x] `workspace.defaultIntroFileName` 已从 `"Prologue.txt"` 改为 `"Prologue.pmd"`(en)
- [x] `workspace.defaultIntroContent` 已改为符合 .pmd 格式的初始内容
- [x] `createFile` 命令对正文目录下 .pmd 文件的 UUID front matter 注入逻辑覆盖序章创建路径
- [x] 序章创建后被 manifest 索引记录为章节实体
- [x] `detectCategoryFromPath` 对 `序章.pmd` 正确识别为 manuscript 分类
- [x] `handleCreatePrologue` 调用路径无 .txt 硬编码残留
- [x] `npx tsc --noEmit` 通过
- [x] `cargo check` 通过

## 阶段二:设置页面卡片样式统一化

- [x] 4 个设置分区(General/Ai/Appearance/About)的卡片样式差异已审查记录
- [x] 统一卡片样式规范已定义(`bg-zinc-900/40 + rounded-lg + p-4 + space-y-4`)
- [x] `GeneralSettingsSection.tsx` 已应用统一卡片样式
- [x] `AiSettingsSection.tsx` 已应用统一卡片样式
- [x] `AppearanceSettingsSection.tsx` 已应用统一卡片样式
- [x] `AboutSettingsSection.tsx` 已应用统一卡片样式(品牌区可保留独特性)
- [x] 卡片标题样式统一(`text-sm font-medium text-nf-text + flex items-center gap-2`)
- [x] 卡片描述样式统一(`text-xs text-nf-text-tertiary`)
- [x] 交互元素尺寸统一(按钮 h-9 / 开关 h-6 w-11 / 输入框 h-9)
- [x] 卡片间垂直间距统一(space-y-4 或 gap-4)
- [x] 内容不足卡片保持最小高度(min-h-[80px])
- [x] `npx tsc --noEmit` 通过

## 阶段三:构建发布与历史版本清理

- [x] 版本号已同步到 26.7.32(7 处文件)
- [x] `npx tsc --noEmit` 通过
- [x] `cargo check` 通过
- [x] `cargo test` 全部通过(69 passed)
- [x] `npm run tauri build` 成功生成 MSI + NSIS 安装包
- [x] sha256 哈希文件已生成(MSI: 97a4a12c..., NSIS: 4c4f0ba8...)
- [x] MSI 安装包大小合理(10.4MB)
- [x] NSIS 安装包大小合理(7.94MB)
- [x] git commit 已创建(844d145, Conventional Commits 规范)
- [x] tag `v26.7.32` 已创建并推送
- [x] 过往 GitHub Release 已删除(v26.8.0, v26.7.29)
- [x] 过往远程 tag 已删除(v26.7.18-v26.7.24, v26.7.29, v26.8.0 共 9 个)
- [x] 过往本地 tag 已删除(仅剩 v26.7.32)
- [x] 新 GitHub Release `v26.7.32` 已创建
- [x] MSI + NSIS + sha256 文件已上传到 GitHub Release(4 个资产)

## 综合验收

- [x] 所有阶段任务已完成,tasks.md 中所有复选框已勾选
- [x] `npx tsc --noEmit` 通过
- [x] `cargo check` 通过
- [x] `cargo test` 通过(69 passed)
- [x] `npm run tauri build` 通过
- [x] 序章创建测试通过(.pmd 格式 + UUID front matter)
- [x] 设置页面视觉一致性验证通过
- [x] v26.7.32 作为唯一存在版本,GitHub Release 页面仅显示 v26.7.32
