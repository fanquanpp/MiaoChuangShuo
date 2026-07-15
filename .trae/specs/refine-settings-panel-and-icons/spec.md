# 设置面板尺寸固定与图标简洁化 Spec

## Why
当前设置对话框的面板高度随分区内容变化而突变(仅设 `max-h-[85vh]` 上限,非固定值),切换常规/AI/外观/关于四个页签时产生视觉跳动。同时关于与 AI 分区存在 4 处渐变背景色装饰的图标容器,与主页 lucide-react 图标简洁直渲染的风格不一致,破坏全项目视觉统一性。

## What Changes
- 设置对话框面板尺寸从「上限约束」改为「固定值」,消除切换分区时的尺寸突变
- 移除设置面板内 4 处 `bg-gradient-to-br` 渐变背景装饰,改为与主页一致的简洁图标样式
- 重新构建安装包并覆盖现有 v26.7.32 Release 资产(版本号不变)

## Impact
- Affected specs: `unify-settings-and-fix-prologue-v26-7-32`(样式统一化延续)
- Affected code:
  - `src/components/SettingsDialog.tsx`(面板尺寸固定)
  - `src/components/settings/AboutSettingsSection.tsx`(Logo 渐变背景 + 作者头像渐变背景)
  - `src/components/settings/AiSettingsSection.tsx`(供应商图标渐变背景 × 2)
  - GitHub Release v26.7.32 资产覆盖

## ADDED Requirements

### Requirement: 设置面板固定尺寸
设置对话框 SHALL 采用固定宽度与固定高度,在四个分区(常规/AI/外观/关于)之间切换时面板尺寸保持恒定,内容区通过滚动条承载超出部分。

#### Scenario: 切换分区无尺寸突变
- **WHEN** 用户在设置对话框中从「常规」切换到「关于」分区
- **THEN** 对话框的宽度和高度保持不变,仅内容区滚动条状态变化

#### Scenario: 小屏自适应
- **WHEN** 视口尺寸小于固定面板尺寸
- **THEN** 面板尺寸回退为视口安全比例(如 max-w-[95vw] / max-h-[90vh]),不溢出屏幕

### Requirement: 设置图标简洁化
设置面板内的所有图标容器 SHALL 移除渐变背景装饰(`bg-gradient-to-br` / `bg-gradient-to-r`),改为与主页一致的简洁风格:图标直接渲染,颜色通过 `text-*` 类名控制,背景使用纯色或透明。

#### Scenario: 关于分区 Logo 简洁化
- **WHEN** 用户打开设置 → 关于分区
- **THEN** 应用 Logo(Wand2)渲染为简洁图标,无渐变背景方块,无装饰小点,与主页 Logo 风格一致

#### Scenario: 作者头像简洁化
- **WHEN** 用户查看关于分区的作者信息区
- **THEN** 作者头像使用纯色背景 + 首字母,无渐变

#### Scenario: AI 供应商图标简洁化
- **WHEN** 用户打开设置 → AI 分区查看供应商列表与选中信息条
- **THEN** 供应商图标使用纯色背景 + 首字母,无渐变

### Requirement: 覆盖现有安装包
构建完成后 SHALL 覆盖现有 GitHub Release v26.7.32 的资产,版本号保持 26.7.32 不变。

#### Scenario: Release 资产覆盖
- **WHEN** 构建完成并推送后
- **THEN** GitHub Release v26.7.32 的 4 个资产(MSI / NSIS / 2 个 sha256)被新构建的文件替换,版本号标签不变

## MODIFIED Requirements

### Requirement: 设置对话框尺寸约束
原约束:`max-w-2xl` + `max-h-[85vh]`(上限约束,高度随内容变化)
修改为:固定宽度 + 固定高度,内容区 `overflow-y-auto` 承载滚动,确保四分区切换零突变。
