# Checklist

本检查清单按 3 大阶段组织,用于系统化验证 spec.md 中各 Requirement 的实现完整性。

## 阶段一:设置面板尺寸固定

- [x] `SettingsDialog.tsx` 外壳容器已改为固定宽度 + 固定高度(w-[680px] h-[560px])
- [x] 小屏自适应兜底保留(`max-w-[95vw] max-h-[90vh]`)
- [x] 内容区 `overflow-y-auto` 在固定高度下滚动正常
- [x] 四个分区切换时面板尺寸零突变

## 阶段二:设置图标简洁化

- [x] AboutSettingsSection Logo 渐变背景方块已移除
- [x] AboutSettingsSection 装饰小点已移除
- [x] AboutSettingsSection 作者头像渐变背景已改为纯色(bg-nf-bg-hover)
- [x] AiSettingsSection 供应商列表图标渐变背景已移除
- [x] AiSettingsSection 选中供应商信息条图标渐变背景已移除
- [x] 设置面板内 `bg-gradient-to-br` 出现 0 次
- [x] `npx tsc --noEmit` 通过

## 阶段三:构建覆盖发布

- [x] `npm run tauri build` 成功生成 MSI + NSIS
- [x] sha256 哈希文件已生成(MSI: 98da4296..., NSIS: ec126bee...)
- [x] MSI 安装包大小合理(10.4MB)
- [x] NSIS 安装包大小合理(7.94MB)
- [x] 版本号保持 26.7.32 不变
- [x] git commit 已创建(6e0234f, Conventional Commits 规范)
- [x] git push origin master 成功(457de38..6e0234f)
- [x] 现有 Release v26.7.32 旧资产已通过 --clobber 覆盖
- [x] 新构建的 4 个资产已上传到 Release v26.7.32
- [x] Release v26.7.32 资产已被替换(版本号标签不变)

## 综合验收

- [x] 所有阶段任务已完成,tasks.md 中所有复选框已勾选
- [x] `npx tsc --noEmit` 通过
- [x] `npm run tauri build` 通过
- [x] 设置面板四分区切换零尺寸突变
- [x] 设置面板内无渐变背景装饰图标
- [x] Release v26.7.32 资产已覆盖,版本号不变
