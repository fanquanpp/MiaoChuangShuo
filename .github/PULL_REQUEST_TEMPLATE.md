# Pull Request

## 变更说明

<!-- 简要描述这个 PR 做了什么，以及为什么需要 -->

## 变更类型

请勾选适用的类型：

- [ ] Bug 修复（fix）
- [ ] 新功能（feat）
- [ ] 重构 / 代码优化（refactor）
- [ ] 性能改进（perf）
- [ ] 文档更新（docs）
- [ ] 测试补充（test）
- [ ] 构建 / 工具链（build / chore）
- [ ] 国际化（i18n）
- [ ] 其他（请在下方说明）

## 关联 Issue

<!-- 关联的 Issue 编号，如 Closes #123 / Refs #456 -->

Closes #

## 验证清单

请确认已完成以下检查（勾选所有适用项）：

- [ ] 已通过 `npx tsc --noEmit`（exit 0）
- [ ] 已通过 `cargo check --manifest-path src-tauri/Cargo.toml`
- [ ] 已通过 `npm run build`
- [ ] 新增 / 修改的文案已添加中英文 i18n 键
- [ ] 涉及版本号变更已同步 7 处位置（package.json / Cargo.toml / Cargo.lock / tauri.conf.json / updateChecker.ts / AboutSettingsSection.tsx / Launcher.tsx）
- [ ] 未引入 `any` / `unknown` 类型（TypeScript 严格规则）
- [ ] 未硬编码 Token / 密钥 / 敏感信息
- [ ] 业务逻辑已添加中文工程级注释

## 截图 / 录屏

<!-- 如为 UI 变更，请附上 before / after 截图 -->

## 设计说明

<!-- 如为架构 / 接口变更，请说明设计决策与影响范围 -->
