# NovelForge v1.5.0

离线小说创作工作站 — 模板系统完善与首页改版

## 新增功能

### 项目预设模板系统
- 项目类型从 4 种扩展至 8 种：西幻史诗、标准长篇、散文随笔、舞台剧本、武侠江湖、科幻未来、悬疑推理、言情都市
- 每种类型生成 3-6 个专属子目录与预设文件（如武侠的「门派设定」「兵器谱」，科幻的「科技树」「星际地图」）
- 侧边栏动态展示当前项目类型的专属目录（「设定扩展」分组）
- 命令面板（Ctrl+K）支持搜索跳转至类型专属目录
- `templateRegistry.ts` 前端镜像 Rust 后端目录定义，保持同步

### 首页交互优化
- 扫描目录持久化到 localStorage，启动时自动恢复并扫描
- 新建项目后自动导入真实元数据并打开项目（修复硬编码 type:"standard" 的 bug）
- 新建/导入/扫描操作均有成功 Toast 反馈
- 搜索框新增清除按钮，支持「无搜索结果」与「无项目」两种空状态
- 时间显示从「未知」改为「N个月前」「N年前」

## 功能修复

### 关键 Bug 修复
- 修复 Zustand 状态重置竞态：`setActiveCategory` 覆盖 `selectedFile` 导致文件丢失，新增 `navigateToFile` 合并操作
- 修复 TipTap `setContent` 数据损坏：字符串中的 `< > &` 被解析为 HTML，改用 ProseMirror JSON 文档结构
- 修复 Rust `search_in_file` UTF-8 切片崩溃：中文字符多字节边界用 `is_char_boundary()` 安全处理
- 修复 Rust `validate_path_in_project` 对新文件失败：`canonicalize()` 改为先 canonicalize 父目录再拼接文件名
- 修复文件重命名未强制 `.txt` 扩展名
- 修复删除当前选中文件后未清除 `selectedFile` 状态
- 修复命令面板新建文件忽略分类参数
- 修复快捷键面板列出不支持的快捷键（Ctrl+U 下划线、Ctrl+1/2 标题、Ctrl+Shift+F）

### i18n 修复
- 修复 `search.lineNum` 参数名不匹配（num → line）
- 修复 `search.resultsMax` 模板变量错误
- 修复 `timer.minutes` 参数名不匹配
- 修复 `stats.dayUnit` 单位显示格式
- 补充缺失的 `timeline.deleteEvent` 翻译键

## 性能优化

- 9 个组件从 `useAppStore()` 全量订阅改为独立选择器：NovelEditor、CardManager、TimelineManager、Launcher、FileList、Sidebar、Workspace、CommandPalette、ProjectCard
- `ProjectCard` 包裹 `React.memo` 并改为点击时读取 `currentProject`，避免每次 store 变化重渲染
- `toProjectData`、`formatWordCount`、`formatTimeAgo` 包裹 `useCallback`
- `getCategoryDir()` / `getCategoryName()` 为动态分类提供 O(1) 回退查找

## 无障碍改进

- 修复暗色主题 `--fandex-text-tertiary` 对比度：4.27:1 → 5.23:1（WCAG AA 标准 4.5:1）
- 修复亮色主题 `--fandex-text-tertiary` 对比度：3.78:1 → 6.02:1
- `ConfirmDialog`、`ShortcutPanel` 添加 `role="dialog"` / `aria-modal` / `aria-labelledby`
- `FileList` 操作按钮添加 `group-focus-within` 键盘可访问性

## 代码清理

- 删除孤儿组件 `StatusComponents.tsx`（已由 SkeletonComponents 替代）
- 清理 2.5G Rust 构建缓存、Vite 缓存等旧版残留

## 技术栈
- Tauri 2.0 + React 18 + TypeScript 5.5
- TipTap 2.5 + Zustand 4.5 + Tailwind CSS 3.4
- Rust 后端（chrono / serde / tokio）

## 系统要求
- Windows 10/11 x64
- WebView2 Runtime（Windows 11 已内置）
