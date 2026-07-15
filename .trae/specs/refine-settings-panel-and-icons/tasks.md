# Tasks

本任务清单按 3 大阶段组织:面板尺寸固定 / 图标简洁化 / 构建覆盖发布。

## 阶段一:设置面板尺寸固定

- [x] Task 1: 固定 SettingsDialog 面板尺寸
  - [x] SubTask 1.1: 在 `src/components/SettingsDialog.tsx` 将外壳容器从 `max-w-2xl max-h-[85vh]` 改为 `w-[680px] h-[560px]`,保留小屏自适应兜底 `max-w-[95vw] max-h-[90vh]`
  - [x] SubTask 1.2: 验证内容区 `flex-1 min-h-0 overflow-y-auto` 在固定高度下滚动正常
  - [x] SubTask 1.3: 验证四个分区(常规/AI/外观/关于)切换时面板尺寸零突变

## 阶段二:设置图标简洁化(移除渐变背景)

- [x] Task 2: AboutSettingsSection 图标简洁化
  - [x] SubTask 2.1: 移除 Logo 区渐变背景方块与装饰小点,Wand2 改为直接渲染 `w-10 h-10 text-fandex-primary`
  - [x] SubTask 2.2: 移除作者头像渐变背景,改为纯色背景 `bg-nf-bg-hover` + `text-fandex-primary`

- [x] Task 3: AiSettingsSection 图标简洁化
  - [x] SubTask 3.1: 移除供应商列表图标渐变背景,改为纯色背景 `bg-nf-bg-hover border border-nf-border-light`
  - [x] SubTask 3.2: 移除选中供应商信息条图标渐变背景,改为纯色背景

- [x] Task 4: 验证图标简洁化
  - [x] 4.1: `npx tsc --noEmit` 通过
  - [x] 4.2: 代码审查确认设置面板内 `bg-gradient-to-br` 出现 0 次

## 阶段三:构建覆盖发布(版本号不变)

- [x] Task 5: 本地构建安装包(版本号保持 26.7.32)
  - [x] 5.1: 运行 `npm run tauri build` 生成 MSI + NSIS
  - [x] 5.2: 生成 sha256 哈希文件(MSI: 98da4296..., NSIS: ec126bee...)
  - [x] 5.3: 验证安装包大小合理(MSI 10.4MB, NSIS 7.94MB)

- [ ] Task 6: Git 提交与推送(版本号不变,无需新 tag)
  - [ ] 6.1: `git add` 暂存变更文件
  - [ ] 6.2: `git commit` 提交(Conventional Commits 规范)
  - [ ] 6.3: `git push origin master` 推送提交

- [ ] Task 7: 覆盖 GitHub Release v26.7.32 资产
  - [ ] 7.1: 删除现有 Release v26.7.32 的 4 个旧资产
  - [ ] 7.2: 上传新构建的 4 个资产(MSI + NSIS + 2 个 sha256)到现有 Release v26.7.32
  - [ ] 7.3: 验证 Release v26.7.32 资产已被替换

# Task Dependencies
- [Task 2, Task 3] 可并行(文件无冲突)
- [Task 4] 依赖 [Task 2, Task 3]
- [Task 5] 依赖 [Task 1, Task 4]
- [Task 6] 依赖 [Task 5]
- [Task 7] 依赖 [Task 6]
