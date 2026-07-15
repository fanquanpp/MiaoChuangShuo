# Checklist

## 阶段一：文档层勘误

### README.md
- [x] 8.8 节「v26.8.0 起改用 DPAPI 加密」已修正为「v26.7.32 起」
- [x] 7.3 节版本号同步表格第 7 行已从 `src/components/settings/SettingsDialog.tsx` 修正为 `src/components/settings/AboutSettingsSection.tsx`
- [x] 7.3 节已补充 Launcher.tsx 经 useVersionCheck hook 派生 appVersion 的说明
- [x] 「相关文档」区已追加 docs/index.html 的 GitHub 直链与 Pages 在线链接
- [x] 已补充 8.10 节「Web 在线体验版与报名页」说明，明确 /MiaoChuangShuo/ 与 /MiaoChuangShuo/docs/ 用途差异

### LICENSE
- [x] 文件第一行已追加 `Copyright (c) 2026 fanquanpp`
- [x] CC-BY-NC-4.0 法律文本完整性未被破坏（行数与原版一致）

### DISCLAIMER.md
- [x] 顶部已追加「最后更新：2026 年 7 月」时间戳
- [x] 文末已追加「当前适用版本：v26.7.32」标注

### SECURITY.md
- [x] 顶部已追加「最后更新：2026 年 7 月」时间戳
- [x] AI Key 安全说明区已追加「当前实现版本：v26.7.32」标注

### CONTRIBUTING.md
- [x] 版本号同步表格第 7 行已从 `src/components/settings/SettingsDialog.tsx` 修正为 `src/components/settings/AboutSettingsSection.tsx`
- [x] 已补充 Launcher.tsx 经 useVersionCheck hook 派生 appVersion 的说明

### bug_report.yml
- [x] placeholder 已从 `v26.8.0` 改为 `v26.7.32`

### PULL_REQUEST_TEMPLATE.md
- [x] 「涉及版本号变更已同步 6 处位置」已改为「7 处位置」
- [x] 路径列表已修正，将 SettingsDialog.tsx 改为 AboutSettingsSection.tsx

## 阶段二：TRAE 报名页勘误（docs/index.html）

- [x] 路线图「26.8.x AI 辅助创作集成」状态已从「进行中」改为「已完成」
- [x] 路线图版本描述已改为反映 v26.7.32 已完成状态
- [x] 核心功能区「9 modules」已改为「8 modules」
- [x] 「题材模板生成」卡片描述已改为「3 种文体模板：长篇小说 / 剧本与脚本 / 散文与文章」
- [x] 页脚已追加「免责声明」与「隐私政策」内部锚点链接

## 阶段三：AboutSettingsSection.tsx 完善

### 致谢列表补全
- [x] acknowledgments 数组已追加 `@xyflow/react` 条目（name / url / desc 三字段完整）
- [x] 已追加 `cmdk` 条目
- [x] 已追加 `zundo` 条目
- [x] 已追加 `framer-motion` 条目
- [x] 已追加 `@dagrejs/dagre` 条目
- [x] 致谢列表总数达 13 项

### 免责声明区跳转
- [x] 免责声明区文字下方已追加「查看完整免责声明」按钮
- [x] 按钮通过 openExternalUrl 跳转至 `https://github.com/fanquanpp/MiaoChuangShuo/blob/master/DISCLAIMER.md`
- [x] i18n.tsx 已追加 `about.viewDisclaimer` 键（中: "查看完整免责声明", 英: "View full disclaimer"）

### 项目主页区
- [x] 作者信息区下方已新增「项目主页」卡片（bg-zinc-900/40 + rounded-lg + p-4 + border border-white/5）
- [x] 卡片包含 4 个外链按钮：Web 在线体验版 / TRAE 报名展示页 / GitHub 仓库 / GitHub Releases
- [x] 4 个按钮均通过 openExternalUrl 调用
- [x] i18n.tsx 已追加 `about.projectHome` / `about.webDemo` / `about.trafeShowcase` 键（中英双语）

### 开源协议区辅助链接
- [x] 「查看完整协议文本」按钮下方已追加「查看安全政策」按钮
- [x] 「查看安全政策」跳转至 `https://github.com/fanquanpp/MiaoChuangShuo/blob/master/SECURITY.md`
- [x] 已追加「查看贡献指南」按钮
- [x] 「查看贡献指南」跳转至 `https://github.com/fanquanpp/MiaoChuangShuo/blob/master/CONTRIBUTING.md`
- [x] i18n.tsx 已追加 `about.viewSecurity` / `about.viewContributing` 键（中英双语）

## 阶段四：校验与构建

### TypeScript 类型检查
- [x] `npx tsc --noEmit` 退出码为 0
- [x] 无新增 TypeScript 错误

### Vite 构建
- [x] `npm run build` 构建成功
- [x] 无构建警告或错误

### 文档链接核对
- [x] README 中所有 fanquanpp.github.io / github.com/fanquanpp/MiaoChuangShuo 链接可访问
- [x] AboutSettingsSection 中新增按钮 URL 与 README 项目主页区 URL 完全一致
- [x] docs/index.html 修正后的路线图与 README Roadmap 区状态一致
- [x] bug_report.yml 占位版本号与 package.json version 字段一致（均为 26.7.32）

## 阶段五：跨文档一致性核对

- [x] 所有文档对当前版本的引用统一为 `v26.7.32`（历史 changelog 与 Roadmap「已完成」区中标注历史版本号的情况除外）
- [x] LICENSE 版权署名 `Copyright (c) 2026 fanquanpp` 与 tauri.conf.json `bundle.copyright` 一致
- [x] README 7.3 节同步表格与 CONTRIBUTING.md 同步表格内容一致（均为 7 行，路径描述一致）
- [x] AboutSettingsSection 致谢列表覆盖 README 1.6 节 AI 创作助手与 5.1-5.6 节核心模块涉及的全部核心依赖
- [x] docs/index.html 题材模板描述与 README 1.5 节完全一致
- [x] 所有 GitHub 链接均使用 `blob/master/` 路径（仓库默认分支为 master）
