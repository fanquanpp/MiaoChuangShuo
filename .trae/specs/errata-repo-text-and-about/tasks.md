# Tasks

## 阶段一：文档层勘误（无代码逻辑变更，可并行处理）

- [x] Task 1: README.md 勘误与补全
  - [x] SubTask 1.1: 修正 8.8 节「v26.8.0 起改用 DPAPI 加密」为「v26.7.32 起」
  - [x] SubTask 1.2: 修正 7.3 节版本号同步表格：将 `src/components/settings/SettingsDialog.tsx` 修正为 `src/components/settings/AboutSettingsSection.tsx`，补充 Launcher.tsx 经 useVersionCheck hook 派生 appVersion 的说明
  - [x] SubTask 1.3: 在「相关文档」区追加 docs/index.html（TRAE 报名页）的 GitHub 直链与 Pages 在线链接
  - [x] SubTask 1.4: 补充 8.10 节「Web 在线体验版与报名页」说明，明确 /MiaoChuangShuo/ 与 /MiaoChuangShuo/docs/ 两个 Pages 入口的用途差异
- [x] Task 2: LICENSE 版权署名补全
  - [x] SubTask 2.1: 在 LICENSE 文件第一行追加 `Copyright (c) 2026 fanquanpp`
  - [x] SubTask 2.2: 核对 CC-BY-NC-4.0 法律文本完整性未被破坏
- [x] Task 3: DISCLAIMER.md 时效性标注
  - [x] SubTask 3.1: 顶部追加「最后更新：2026 年 7 月」时间戳
  - [x] SubTask 3.2: 文末追加「当前适用版本：v26.7.32」标注
- [x] Task 4: SECURITY.md 时效性标注
  - [x] SubTask 4.1: 顶部追加「最后更新：2026 年 7 月」时间戳
  - [x] SubTask 4.2: AI Key 安全说明区追加「当前实现版本：v26.7.32」标注
- [x] Task 5: CONTRIBUTING.md 版本同步路径修正
  - [x] SubTask 5.1: 修正版本号同步表格第 7 行：`src/components/settings/SettingsDialog.tsx` → `src/components/settings/AboutSettingsSection.tsx`
  - [x] SubTask 5.2: 同步补充 Launcher.tsx 经 useVersionCheck hook 派生 appVersion 的说明
- [x] Task 6: bug_report.yml 占位版本号修正
  - [x] SubTask 6.1: 将 placeholder 从 `v26.8.0` 改为 `v26.7.32`
- [x] Task 7: PULL_REQUEST_TEMPLATE.md 同步位置描述修正
  - [x] SubTask 7.1: 将「涉及版本号变更已同步 6 处位置」改为「7 处位置」
  - [x] SubTask 7.2: 修正路径列表，将 SettingsDialog.tsx 改为 AboutSettingsSection.tsx

## 阶段二：TRAE 报名页勘误（docs/index.html）

- [x] Task 8: docs/index.html 路线图与核心功能勘误
  - [x] SubTask 8.1: 修正路线图：「26.8.x AI 辅助创作集成」状态从「进行中」改为「已完成」，版本描述改为「26.7.32 已完成」
  - [x] SubTask 8.2: 修正核心功能区「9 modules」为「8 modules」（与实际渲染 8 张卡片一致）
  - [x] SubTask 8.3: 修正「题材模板生成」卡片描述：从「内置标准长篇、散文随笔、舞台剧本、西幻史诗四种题材模板」改为「内置长篇小说（Novel）、剧本与脚本（Script）、散文与文章（Essay）3 种文体模板」
  - [x] SubTask 8.4: 页脚追加「免责声明」与「隐私政策」内部锚点链接（#value 区或独立 footer-links 扩展）

## 阶段三：AboutSettingsSection.tsx 完善（含 i18n 键）

- [x] Task 9: 致谢列表补全 5 项核心依赖
  - [x] SubTask 9.1: 在 acknowledgments 数组追加 `@xyflow/react`（url: https://github.com/xyflow/xyflow, desc: React Flow 官方 npm 包, 受控节点/边系统）
  - [x] SubTask 9.2: 追加 `cmdk`（url: https://cmdk.paco.me/, desc: 命令面板引擎, 提供类 VS Code 的 Ctrl+K 体验）
  - [x] SubTask 9.3: 追加 `zundo`（url: https://github.com/charkour/zundo, desc: Zustand 时间旅行中间件, 撤销/重做历史管理）
  - [x] SubTask 9.4: 追加 `framer-motion`（url: https://www.framer.com/motion/, desc: 弹簧物理动画库, 模板展开与卡片悬停动画）
  - [x] SubTask 9.5: 追加 `@dagrejs/dagre`（url: https://github.com/dagrejs/dagre, desc: DAG 自动布局算法, 图谱节点分层排列）
- [x] Task 10: 免责声明区追加跳转链接
  - [x] SubTask 10.1: 在免责声明区文字下方追加「查看完整免责声明」按钮
  - [x] SubTask 10.2: 按钮跳转至 `https://github.com/fanquanpp/MiaoChuangShuo/blob/master/DISCLAIMER.md`，通过 openExternalUrl 调用
  - [x] SubTask 10.3: 在 i18n.tsx 追加 `about.viewDisclaimer` 键（中: "查看完整免责声明", 英: "View full disclaimer"）
- [x] Task 11: 新增「项目主页」区
  - [x] SubTask 11.1: 在作者信息区下方新增「项目主页」卡片（bg-zinc-900/40 + rounded-lg + p-4 + border border-white/5）
  - [x] SubTask 11.2: 卡片包含 4 个外链按钮：Web 在线体验版 / TRAE 报名展示页 / GitHub 仓库 / GitHub Releases
  - [x] SubTask 11.3: 4 个按钮均通过 openExternalUrl 在系统默认浏览器打开
  - [x] SubTask 11.4: 在 i18n.tsx 追加 `about.projectHome` / `about.webDemo` / `about.trafeShowcase` 键（中英双语）
- [x] Task 12: 开源协议区追加 SECURITY.md 与 CONTRIBUTING.md 链接
  - [x] SubTask 12.1: 在开源协议区「查看完整协议文本」按钮下方追加「查看安全政策」按钮，跳转 `https://github.com/fanquanpp/MiaoChuangShuo/blob/master/SECURITY.md`
  - [x] SubTask 12.2: 追加「查看贡献指南」按钮，跳转 `https://github.com/fanquanpp/MiaoChuangShuo/blob/master/CONTRIBUTING.md`
  - [x] SubTask 12.3: 在 i18n.tsx 追加 `about.viewSecurity` / `about.viewContributing` 键（中英双语）

## 阶段四：校验与构建（最终验证）

- [x] Task 13: TypeScript 类型检查与构建验证
  - [x] SubTask 13.1: 执行 `npx tsc --noEmit` 验证 0 错误
  - [x] SubTask 13.2: 执行 `npm run build` 验证 Vite 构建成功
- [x] Task 14: 文档链接人工核对
  - [x] SubTask 14.1: 核对 README 中所有 fanquanpp.github.io / github.com/fanquanpp/MiaoChuangShuo 链接可访问
  - [x] SubTask 14.2: 核对 AboutSettingsSection 中新增按钮 URL 与 README 项目主页区 URL 完全一致
  - [x] SubTask 14.3: 核对 docs/index.html 修正后的路线图与 README Roadmap 区状态一致（注：docs 为高层级里程碑、README 为细粒度任务清单，结构不同属设计差异；AI 辅助创作集成状态在 docs 中为「已完成 v26.7.32」正确）
  - [x] SubTask 14.4: 核对 bug_report.yml 占位版本号与 package.json version 字段一致

# Task Dependencies

- Task 1-7（文档层勘误）相互独立，可并行处理
- Task 8（TRAE 报名页）独立于其他任务，可并行
- Task 9-12（AboutSettingsSection 与 i18n）存在顺序依赖：
  - Task 10 / 11 / 12 均依赖 Task 9 完成致谢列表补全后再统一修改（避免冲突）
  - Task 10 / 11 / 12 之间可并行修改不同区块
- Task 13 依赖 Task 9-12 全部完成（TypeScript 检查需所有代码改动落定）
- Task 14 依赖 Task 1-12 全部完成（需最终态核对链接）
