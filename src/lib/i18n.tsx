// 国际化 (i18n) 框架
//
// 功能概述：
// 提供轻量级国际化支持，基于 React Context 实现。
// 支持中/英文切换，文案集中管理，组件通过 useI18n() 获取翻译函数。
//
// 模块职责：
// 1. I18nProvider: 语言上下文提供者
// 2. useI18n: 获取翻译函数的 Hook
// 3. translations: 集中管理的翻译文案映射
// 4. useI18nInit: 从 localStorage 读取语言偏好并初始化

import { createContext, useContext, useState, useCallback, useEffect } from "react";

// 支持的语言
export type Locale = "zh-CN" | "en-US";

// 翻译字典类型
type TranslationDict = Record<string, string>;

// 中文翻译
const zhCN: TranslationDict = {
  // 通用
  "app.title": "NovelForge",
  "app.loading": "加载中...",
  "app.error": "发生错误",
  "app.retry": "重试",
  "app.cancel": "取消",
  "app.confirm": "确认",
  "app.save": "保存",
  "app.delete": "删除",
  "app.create": "创建",
  "app.rename": "重命名",
  "app.export": "导出",
  "app.search": "搜索",
  "app.refresh": "刷新",
  "app.empty": "暂无数据",
  "app.back": "返回",
  "app.close": "关闭",
  "app.browse": "浏览",
  "common.loading": "加载中...",

  // 启动器
  "launcher.title": "NovelForge",
  "launcher.subtitle": "沉浸式创作工坊",
  "launcher.newProject": "新建项目",
  "launcher.importProject": "导入项目",
  "launcher.recentProjects": "最近项目",
  "launcher.recentProjectsCount": "最近创作项目 ({count})",
  "launcher.noProjects": "暂无项目，点击上方按钮创建",
  "launcher.createNew": "创建全新项目",
  "launcher.scanDir": "扫描目录",
  "launcher.changeDir": "更改目录",
  "launcher.setScanDir": "设置项目扫描目录",
  "launcher.localReady": "本地环境就绪",
  "launcher.searchPlaceholder": "搜索项目名称...",
  "launcher.importLocal": "导入本地已存项目",
  "launcher.welcome": "欢迎使用 NovelForge",
  "launcher.welcomeHint": "点击左侧「创建全新项目」开始你的创作之旅",
  "launcher.importFailed": "导入失败: {error}",
  "launcher.scanFailed": "扫描项目失败: {error}",
  "launcher.scanDirPlaceholder": "选择或输入文件夹路径...",

  // 启动器 - 格式化
  "launcher.wanWords": "万字",
  "launcher.wordUnit": "字",
  "launcher.justNow": "刚刚",
  "launcher.minutesAgo": "{n}分钟前",
  "launcher.hoursAgo": "{n}小时前",
  "launcher.daysAgo": "{n}天前",
  "launcher.unknownTime": "未知",
  "launcher.chapterUnit": "章",
  "launcher.monthsAgo": "{n}个月前",
  "launcher.yearsAgo": "{n}年前",
  "launcher.createSuccess": "项目创建成功",
  "launcher.importSuccess": "项目导入成功: {name}",
  "launcher.scanSuccess": "扫描完成，找到 {count} 个项目",
  "launcher.noSearchResults": "未找到匹配「{query}」的项目",
  "launcher.clearSearch": "清除搜索",
  "launcher.continueWriting": "继续创作",
  "launcher.lastOpened": "上次打开",

  // 启动器 - 项目类型名称
  "launcher.typeEpic": "西幻史诗",
  "launcher.typeStandard": "标准长篇",
  "launcher.typeEssay": "散文随笔",
  "launcher.typeScript": "舞台剧本",
  "launcher.typeWuxia": "武侠江湖",
  "launcher.typeScifi": "科幻未来",
  "launcher.typeMystery": "悬疑推理",
  "launcher.typeRomance": "言情都市",

  // 工作台
  "workspace.newFile": "新建文件",
  "workspace.fileName": "文件名",
  "workspace.createIn": "将创建在 {dir} 目录下",
  "workspace.creating": "创建中...",
  "workspace.focusModeEnter": "已进入聚焦模式 (F11 退出)",
  "workspace.focusModeExit": "已退出聚焦模式",
  "workspace.fileCreated": "已创建文件: {name}",

  // 编辑器
  "editor.placeholder": "开始你的创作...",
  "editor.unsaved": "未保存",
  "editor.wordCount": "{count} 字",
  "editor.exportTxt": "导出为 TXT",
  "editor.bold": "加粗",
  "editor.italic": "斜体",
  "editor.heading1": "一级标题",
  "editor.heading2": "二级标题",
  "editor.bulletList": "无序列表",
  "editor.orderedList": "有序列表",
  "editor.blockquote": "引用",
  "editor.undo": "撤销",
  "editor.redo": "重做",
  "editor.poetryFormat": "诗歌排版 (Ctrl+Shift+P)",
  "editor.lyricsFormat": "歌词排版 (Ctrl+Shift+L)",
  "editor.conflictDetected": "文件已被外部修改，是否覆盖保存？",
  "editor.conflictCancelled": "已取消保存（文件被外部修改）",
  "editor.saved": "已保存",
  "editor.saveFailed": "保存失败: {error}",
  "editor.exported": "已导出: {name}",
  "editor.exportFailed": "导出失败: {error}",
  "editor.scriptMode": "剧本模式",
  "editor.essayMode": "散文模式",
  "editor.selectFile": "从左侧选择或创建一个文件开始编辑",
  "editor.charRosterHint": "在空行按 Tab 键呼出角色名选择（共 {count} 个角色）",
  "editor.essayHint": "已启用首行双字缩进",
  "editor.loadFailed": "加载文件失败: {error}",
  "editor.commandPaletteHint": "按 Ctrl+K 打开命令面板",
  "editor.editor": "编辑器",
  "editor.defaultExportName": "导出.txt",

  // 文件列表
  "filelist.empty": "此分类下暂无文件",
  "filelist.createFirst": "创建第一个文件",
  "filelist.gridView": "卡片视图",
  "filelist.listView": "列表视图",
  "filelist.confirmDelete": "确定删除 \"{name}\" 吗?",
  "filelist.renamePrompt": "输入新文件名:",
  "filelist.invalidChars": "文件名不能包含以下字符: < > : \" / \\ | ? *",
  "filelist.deleteFailed": "删除失败: {error}",
  "filelist.renameFailed": "重命名失败: {error}",
  "filelist.deleted": "已删除「{name}」",
  "filelist.renamed": "已重命名为「{name}」",
  "filelist.itemUnit": "项",
  "filelist.wordCount": "{count} 字",
  "filelist.unsupportedExt": "仅支持 .txt 文件",
  "filelist.autoMd": "不输入扩展名将自动添加 .txt",

  // 侧边栏
  "sidebar.characters": "角色",
  "sidebar.worldview": "世界观",
  "sidebar.glossary": "名词",
  "sidebar.timeline": "时间线",
  "sidebar.manuscript": "正文",
  "sidebar.outline": "大纲",
  "sidebar.materials": "素材",
  "sidebar.stats": "统计",
  "sidebar.search": "搜索",
  "sidebar.closeProject": "关闭项目",
  "sidebar.unnamedProject": "未命名项目",
  "sidebar.anonymousAuthor": "匿名作者",
  "sidebar.categorySection": "分类",
  "sidebar.recentSection": "最近",
  "sidebar.toolSection": "工具",
  "sidebar.extensionSection": "设定扩展",
  "sidebar.switchLight": "切换到亮色主题",
  "sidebar.switchDark": "切换到暗色主题",
  "sidebar.light": "亮色",
  "sidebar.dark": "暗色",
  "sidebar.newFile": "新建文件",

  // 写作统计
  "stats.title": "写作统计",
  "stats.totalWords": "总字数",
  "stats.chapters": "章节数",
  "stats.files": "文件数",
  "stats.days": "创作天数",
  "stats.dayUnit": "天",
  "stats.wordsDist": "字数分布",
  "stats.manuscript": "正文",
  "stats.settings": "设定",
  "stats.outline": "大纲",
  "stats.chapterRank": "章节字数排行",
  "stats.noChapters": "暂无章节数据",
  "stats.noData": "暂无统计数据",
  "stats.loadFailed": "加载统计数据失败: {error}",

  // 全局搜索
  "search.title": "全局搜索",
  "search.placeholder": "搜索项目内所有文件内容...",
  "search.caseSensitive": "区分大小写",
  "search.caseSensitiveOn": "区分大小写(已开启)",
  "search.caseSensitiveOff": "区分大小写(已关闭)",
  "search.results": "找到 {count} 条匹配结果",
  "search.resultsMax": "(仅显示前 200 条)",
  "search.noResults": "未找到匹配结果",
  "search.startSearch": "输入关键词开始搜索",
  "search.lineNum": "第 {line} 行",
  "search.failed": "搜索失败",

  // 时间线
  "timeline.title": "时间线",
  "timeline.empty": "暂无时间线事件",
  "timeline.addEvent": "新建事件",
  "timeline.sortByDate": "按日期排序",
  "timeline.mainBranch": "主线",
  "timeline.allBranches": "全部",
  "timeline.confirmDelete": "确定删除事件 \"{title}\" 吗?",
  "timeline.deleteEvent": "删除事件",
  "timeline.deleteFailed": "删除失败: {error}",
  "timeline.editEvent": "编辑事件",
  "timeline.newEvent": "新建事件",
  "timeline.eventTitle": "事件标题",
  "timeline.eventTitlePlaceholder": "输入事件标题",
  "timeline.eventTime": "时间",
  "timeline.eventTimePlaceholder": "如: 第一章 / 1000年",
  "timeline.eventBranch": "分支",
  "timeline.newBranch": "新分支(可选,留空使用上方选择)",
  "timeline.newBranchPlaceholder": "输入新分支名",
  "timeline.eventDescription": "事件描述",
  "timeline.eventDescriptionPlaceholder": "详细描述事件内容",
  "timeline.titleRequired": "请输入事件标题",
  "timeline.unnamedEvent": "未命名事件",
  "timeline.unknownTime": "未知时间",
  "timeline.loading": "加载中...",
  "timeline.deleted": "已删除事件「{title}」",

  // 卡片管理器
  "cardmanager.editorPlaceholder": "开始编辑卡片内容...",
  "cardmanager.backToList": "返回列表",
  "cardmanager.unsaved": "未保存",
  "cardmanager.saving": "保存中...",
  "cardmanager.newCard": "新建{category}",
  "cardmanager.emptyCard": "暂无{category}，点击右上角新建",
  "cardmanager.noContent": "暂无内容",
  "cardmanager.promptName": "输入{category}名称:",
  "cardmanager.createFailed": "创建失败: {error}",
  "cardmanager.confirmDelete": "确定删除 \"{name}\" 吗?",
  "cardmanager.deleteFailed": "删除失败: {error}",
  "cardmanager.saveFailed": "保存失败: {error}",
  "cardmanager.loadFailed": "加载失败: {error}",
  "cardmanager.loadFailedShort": "加载失败",
  "cardmanager.saved": "已保存",
  "cardmanager.save": "保存",
  "cardmanager.created": "已创建「{name}」",
  "cardmanager.deleted": "已删除「{name}」",

  // 项目对话框
  "project.createTitle": "创建新项目",
  "project.name": "项目名称",
  "project.namePlaceholder": "输入你的小说项目名称",
  "project.typeLabel": "创作题材",
  "project.author": "作者(可选)",
  "project.authorPlaceholder": "输入作者名",
  "project.description": "项目描述(可选)",
  "project.descriptionPlaceholder": "简要描述你的小说项目",
  "project.saveLocation": "保存位置",
  "project.saveLocationPlaceholder": "选择项目保存目录",
  "project.nameRequired": "请输入项目名称",
  "project.locationRequired": "请选择保存位置",
  "project.createFailed": "创建失败: {error}",
  "project.dirPickFailed": "选择目录失败: {error}",

  // 专注计时器
  "timer.pause": "暂停",
  "timer.start": "开始",
  "timer.reset": "重置",
  "timer.setDuration": "设置时长",
  "timer.minutes": "{d} 分钟",
  "timer.close": "关闭计时器",

  // 快捷键面板
  "shortcuts.title": "快捷键参考",
  "shortcuts.editor": "编辑器",
  "shortcuts.global": "全局",
  "shortcuts.sidebar": "侧边栏导航",
  "shortcuts.hint": "按 ? 随时打开此面板",
  "shortcuts.autoPopup": "此面板仅在首次使用时自动弹出，之后按 ? 打开",
  "shortcuts.closeAria": "关闭快捷键面板",

  // 大纲视图
  "outline.open": "打开大纲",
  "outline.collapse": "收起大纲",
  "outline.title": "大纲",
  "outline.noHeadings": "当前文档暂无标题",
  "outline.addHeadingsHint": "使用 Ctrl+1 / Ctrl+2 添加标题",

  // 错误边界
  "error.renderError": "页面渲染异常",
  "error.unknownError": "发生了未知错误",

  // 命令面板
  "command.placeholder": "输入命令... (分类导航 / 新建文件 / 切换主题)",
  "command.noMatch": "未找到匹配的命令",
  "command.navigate": "↑↓ 导航",
  "command.execute": "↵ 执行",
  "command.close": "esc 关闭",
  "command.categoryNav": "分类导航",
  "command.application": "应用",
  "command.help": "帮助",
  "command.shortcutsRef": "快捷键参考",
  "command.newFile": "新建文件",

  // 题材模板
  "template.selectTitle": "选择创作题材架构",

  // --- auto-added ---
  "app.creating": "创建中...",
  "command.categoryApp": "应用",
  "command.categoryHelp": "帮助",
  "command.categoryNewFile": "新建文件",
  "command.darkToLight": "暗→亮",
  "command.hintClose": "esc 关闭",
  "command.hintExecute": "↵ 执行",
  "command.hintNavigate": "↑↓ 导航",
  "command.lightToDark": "亮→暗",
  "command.searchLabel": "搜索命令",
  "command.toggleTheme": "切换主题 ({mode})",
  "error.retry": "重试",
  "filelist.create": "创建",
  "filelist.createFailed": "创建文件失败: {error}",
  "filelist.newFileName": "文件名（将创建在 {dirName} 目录下）",
  "filelist.newFilePlaceholder": "输入文件名",
  "filelist.newFileTitle": "新建文件",
  "outline.addHeadingHint": "使用 Ctrl+1 / Ctrl+2 添加标题",
  "projectcard.chapterUnit": "章",
  "projectcard.chapters": "正文章节数",
  "projectcard.lastUpdate": "最后更新",
  "projectcard.totalWords": "总字数",
  "search.hint": "输入关键词开始搜索",
  "search.resultsMaxHint": "(仅显示前 200 条)",
  "shortcuts.autoShowHint": "此面板仅在首次使用时自动弹出，之后按 ? 打开",
  "shortcuts.bold": "加粗",
  "shortcuts.close": "关闭面板/返回",
  "shortcuts.closePanel": "关闭快捷键面板",
  "shortcuts.commandPalette": "命令面板",
  "shortcuts.focusMode": "切换聚焦模式",
  "shortcuts.globalSearch": "全局搜索",
  "shortcuts.heading1": "一级标题",
  "shortcuts.heading2": "二级标题",
  "shortcuts.italic": "斜体",
  "shortcuts.lyricsFormat": "歌词排版",
  "shortcuts.navCharacters": "角色",
  "shortcuts.navGlossary": "名词",
  "shortcuts.navManuscript": "正文",
  "shortcuts.navMaterials": "素材",
  "shortcuts.navOutline": "大纲",
  "shortcuts.navStats": "统计",
  "shortcuts.navTimeline": "时间线",
  "shortcuts.navWorldview": "世界观",
  "shortcuts.poetryFormat": "诗歌排版",
  "shortcuts.pressQuestionHint": "按 ? 随时打开此面板",
  "shortcuts.redo": "重做",
  "shortcuts.save": "保存",
  "shortcuts.scriptMode": "剧本模式呼出角色",
  "shortcuts.sidebarNav": "侧边栏导航",
  "shortcuts.togglePanel": "打开/关闭快捷键面板",
  "shortcuts.underline": "下划线",
  "shortcuts.undo": "撤销",
  "skeleton.loading": "加载中",
  "skeleton.loadingFiles": "加载文件列表",
  "stats.chapterRanking": "章节字数排行",
  "stats.creationDays": "创作天数",
  "stats.distribution": "字数分布",
  "stats.noChapterData": "暂无章节数据",
  "stats.refresh": "刷新",
  "stats.setting": "设定",
  "stats.totalChapters": "章节数",
  "stats.totalFiles": "文件数",
  "stats.wordUnit": "字",
  "template.chooseArch": "选择创作题材架构",
  "timeline.dirName": "时间线",
  "timeline.newBranchLabel": "新分支(可选,留空使用上方选择)",
  "timeline.noEvents": "暂无时间线事件",
  "timeline.save": "保存",
  "timeline.saving": "保存中...",
};

// 英文翻译
const enUS: TranslationDict = {
  // Common
  "app.title": "NovelForge",
  "app.loading": "Loading...",
  "app.error": "An error occurred",
  "app.retry": "Retry",
  "app.cancel": "Cancel",
  "app.confirm": "Confirm",
  "app.save": "Save",
  "app.delete": "Delete",
  "app.create": "Create",
  "app.rename": "Rename",
  "app.export": "Export",
  "app.search": "Search",
  "app.refresh": "Refresh",
  "app.empty": "No data",
  "app.back": "Back",
  "app.close": "Close",
  "app.browse": "Browse",
  "common.loading": "Loading...",

  // Launcher
  "launcher.title": "NovelForge",
  "launcher.subtitle": "Immersive Writing Studio",
  "launcher.newProject": "New Project",
  "launcher.importProject": "Import Project",
  "launcher.recentProjects": "Recent Projects",
  "launcher.recentProjectsCount": "Recent Projects ({count})",
  "launcher.noProjects": "No projects yet. Create one above.",
  "launcher.createNew": "Create New Project",
  "launcher.scanDir": "Scan Directory",
  "launcher.changeDir": "Change Directory",
  "launcher.setScanDir": "Set project scan directory",
  "launcher.localReady": "Local environment ready",
  "launcher.searchPlaceholder": "Search projects...",
  "launcher.importLocal": "Import existing project",
  "launcher.welcome": "Welcome to NovelForge",
  "launcher.welcomeHint": 'Click "Create New Project" to start your journey',
  "launcher.importFailed": "Import failed: {error}",
  "launcher.scanFailed": "Failed to scan projects: {error}",
  "launcher.scanDirPlaceholder": "Select or enter a folder path...",

  // Launcher - formatting
  "launcher.wanWords": "0k words",
  "launcher.wordUnit": "words",
  "launcher.justNow": "Just now",
  "launcher.minutesAgo": "{n} minutes ago",
  "launcher.hoursAgo": "{n} hours ago",
  "launcher.daysAgo": "{n} days ago",
  "launcher.unknownTime": "Unknown",
  "launcher.chapterUnit": "ch",
  "launcher.monthsAgo": "{n} months ago",
  "launcher.yearsAgo": "{n} years ago",
  "launcher.createSuccess": "Project created successfully",
  "launcher.importSuccess": "Project imported: {name}",
  "launcher.scanSuccess": "Scan complete, found {count} projects",
  "launcher.noSearchResults": "No projects found matching \"{query}\"",
  "launcher.clearSearch": "Clear search",
  "launcher.continueWriting": "Continue Writing",
  "launcher.lastOpened": "Last opened",

  // Launcher - Project type names
  "launcher.typeEpic": "Epic Fantasy",
  "launcher.typeStandard": "Standard Novel",
  "launcher.typeEssay": "Essay/Prose",
  "launcher.typeScript": "Stage Script",
  "launcher.typeWuxia": "Martial Arts",
  "launcher.typeScifi": "Sci-Fi",
  "launcher.typeMystery": "Mystery",
  "launcher.typeRomance": "Romance",

  // Workspace
  "workspace.newFile": "New File",
  "workspace.fileName": "File Name",
  "workspace.createIn": "Will be created in {dir}",
  "workspace.creating": "Creating...",
  "workspace.focusModeEnter": "Focus mode entered (F11 to exit)",
  "workspace.focusModeExit": "Focus mode exited",
  "workspace.fileCreated": "File created: {name}",

  // Editor
  "editor.placeholder": "Start writing...",
  "editor.unsaved": "Unsaved",
  "editor.wordCount": "{count} words",
  "editor.exportTxt": "Export TXT",
  "editor.bold": "Bold",
  "editor.italic": "Italic",
  "editor.heading1": "Heading 1",
  "editor.heading2": "Heading 2",
  "editor.bulletList": "Bullet List",
  "editor.orderedList": "Ordered List",
  "editor.blockquote": "Blockquote",
  "editor.undo": "Undo",
  "editor.redo": "Redo",
  "editor.poetryFormat": "Poetry Format (Ctrl+Shift+P)",
  "editor.lyricsFormat": "Lyrics Format (Ctrl+Shift+L)",
  "editor.conflictDetected":
    "File has been modified externally. Overwrite?",
  "editor.conflictCancelled": "Save cancelled (file modified externally)",
  "editor.saved": "Saved",
  "editor.saveFailed": "Save failed: {error}",
  "editor.exported": "Exported: {name}",
  "editor.exportFailed": "Export failed: {error}",
  "editor.scriptMode": "Script Mode",
  "editor.essayMode": "Essay Mode",
  "editor.selectFile": "Select or create a file from the sidebar",
  "editor.charRosterHint":
    "Press Tab on empty line for character selection ({count} characters)",
  "editor.essayHint": "Double-character indent enabled",
  "editor.loadFailed": "Failed to load file: {error}",
  "editor.commandPaletteHint": "Press Ctrl+K to open command palette",
  "editor.editor": "Editor",
  "editor.defaultExportName": "export.txt",

  // File List
  "filelist.empty": "No files in this category",
  "filelist.createFirst": "Create first file",
  "filelist.gridView": "Grid View",
  "filelist.listView": "List View",
  "filelist.confirmDelete": 'Delete "{name}"?',
  "filelist.renamePrompt": "Enter new file name:",
  "filelist.invalidChars": 'File name cannot contain: < > : " / \\ | ? *',
  "filelist.deleteFailed": "Delete failed: {error}",
  "filelist.renameFailed": "Rename failed: {error}",
  "filelist.deleted": "Deleted \"{name}\"",
  "filelist.renamed": "Renamed to \"{name}\"",
  "filelist.itemUnit": "items",
  "filelist.wordCount": "{count} words",
  "filelist.unsupportedExt": "Only .txt files supported",
  "filelist.autoMd": ".txt extension added automatically",

  // Sidebar
  "sidebar.characters": "Characters",
  "sidebar.worldview": "Worldview",
  "sidebar.glossary": "Glossary",
  "sidebar.timeline": "Timeline",
  "sidebar.manuscript": "Manuscript",
  "sidebar.outline": "Outline",
  "sidebar.materials": "Materials",
  "sidebar.stats": "Stats",
  "sidebar.search": "Search",
  "sidebar.closeProject": "Close Project",
  "sidebar.unnamedProject": "Untitled Project",
  "sidebar.anonymousAuthor": "Anonymous",
  "sidebar.categorySection": "Categories",
  "sidebar.recentSection": "Recent",
  "sidebar.toolSection": "Tools",
  "sidebar.extensionSection": "Extensions",
  "sidebar.switchLight": "Switch to Light",
  "sidebar.switchDark": "Switch to Dark",
  "sidebar.light": "Light",
  "sidebar.dark": "Dark",
  "sidebar.newFile": "New File",

  // Writing Stats
  "stats.title": "Writing Stats",
  "stats.totalWords": "Total Words",
  "stats.chapters": "Chapters",
  "stats.files": "Files",
  "stats.days": "Days",
  "stats.dayUnit": "days",
  "stats.wordsDist": "Word Distribution",
  "stats.manuscript": "Manuscript",
  "stats.settings": "Settings",
  "stats.outline": "Outline",
  "stats.chapterRank": "Chapter Ranking",
  "stats.noChapters": "No chapter data",
  "stats.noData": "No stats available",
  "stats.loadFailed": "Failed to load stats: {error}",

  // Global Search
  "search.title": "Global Search",
  "search.placeholder": "Search all project files...",
  "search.caseSensitive": "Case Sensitive",
  "search.caseSensitiveOn": "Case Sensitive (ON)",
  "search.caseSensitiveOff": "Case Sensitive (OFF)",
  "search.results": "Found {count} results",
  "search.resultsMax": "(showing first 200)",
  "search.noResults": "No results found",
  "search.startSearch": "Enter keywords to search",
  "search.lineNum": "Line {line}",
  "search.failed": "Search failed",

  // Timeline
  "timeline.title": "Timeline",
  "timeline.empty": "No timeline events",
  "timeline.addEvent": "Add Event",
  "timeline.sortByDate": "Sort by Date",
  "timeline.mainBranch": "Main",
  "timeline.allBranches": "All",
  "timeline.confirmDelete": 'Delete event "{title}"?',
  "timeline.deleteEvent": "Delete event",
  "timeline.deleteFailed": "Delete failed: {error}",
  "timeline.editEvent": "Edit Event",
  "timeline.newEvent": "New Event",
  "timeline.eventTitle": "Event Title",
  "timeline.eventTitlePlaceholder": "Enter event title",
  "timeline.eventTime": "Time",
  "timeline.eventTimePlaceholder": "e.g. Chapter 1 / Year 1000",
  "timeline.eventBranch": "Branch",
  "timeline.newBranch": "New branch (optional, leave blank to use above)",
  "timeline.newBranchPlaceholder": "Enter new branch name",
  "timeline.eventDescription": "Description",
  "timeline.eventDescriptionPlaceholder": "Describe the event in detail",
  "timeline.titleRequired": "Please enter an event title",
  "timeline.unnamedEvent": "Unnamed Event",
  "timeline.unknownTime": "Unknown time",
  "timeline.loading": "Loading...",
  "timeline.deleted": "Deleted event \"{title}\"",

  // Card Manager
  "cardmanager.editorPlaceholder": "Start editing card content...",
  "cardmanager.backToList": "Back to list",
  "cardmanager.unsaved": "Unsaved",
  "cardmanager.saving": "Saving...",
  "cardmanager.newCard": "New {category}",
  "cardmanager.emptyCard": "No {category}. Click + to create.",
  "cardmanager.noContent": "No content",
  "cardmanager.promptName": "Enter {category} name:",
  "cardmanager.createFailed": "Create failed: {error}",
  "cardmanager.confirmDelete": 'Delete "{name}"?',
  "cardmanager.deleteFailed": "Delete failed: {error}",
  "cardmanager.saveFailed": "Save failed: {error}",
  "cardmanager.loadFailed": "Load failed: {error}",
  "cardmanager.loadFailedShort": "Load failed",
  "cardmanager.saved": "Saved",
  "cardmanager.save": "Save",
  "cardmanager.created": "Created \"{name}\"",
  "cardmanager.deleted": "Deleted \"{name}\"",

  // Project Dialog
  "project.createTitle": "New Project",
  "project.name": "Project Name",
  "project.namePlaceholder": "Enter your novel project name",
  "project.typeLabel": "Genre",
  "project.author": "Author (optional)",
  "project.authorPlaceholder": "Enter author name",
  "project.description": "Description (optional)",
  "project.descriptionPlaceholder": "Briefly describe your novel project",
  "project.saveLocation": "Save Location",
  "project.saveLocationPlaceholder": "Select project save directory",
  "project.nameRequired": "Please enter a project name",
  "project.locationRequired": "Please select a save location",
  "project.createFailed": "Create failed: {error}",
  "project.dirPickFailed": "Failed to pick directory: {error}",

  // Focus Timer
  "timer.pause": "Pause",
  "timer.start": "Start",
  "timer.reset": "Reset",
  "timer.setDuration": "Set duration",
  "timer.minutes": "{d} min",
  "timer.close": "Close timer",

  // Shortcut Panel
  "shortcuts.editor": "Editor",
  "shortcuts.global": "Global",
  "shortcuts.sidebar": "Sidebar Navigation",
  "shortcuts.hint": "Press ? anytime to open this panel",
  "shortcuts.autoPopup": "This panel auto-shows on first visit. Press ? to open later.",
  "shortcuts.closeAria": "Close shortcut panel",

  // Outline View
  "outline.open": "Open outline",
  "outline.collapse": "Collapse outline",
  "outline.title": "Outline",
  "outline.noHeadings": "No headings in current document",
  "outline.addHeadingsHint": "Use Ctrl+1 / Ctrl+2 to add headings",

  // Error Boundary
  "error.renderError": "Rendering Error",
  "error.unknownError": "An unknown error occurred",

  // Command Palette
  "command.placeholder": "Type a command... (Navigate / New File / Theme)",
  "command.noMatch": "No matching commands",
  "command.navigate": "↑↓ Navigate",
  "command.execute": "↵ Execute",
  "command.close": "esc Close",
  "command.categoryNav": "Navigation",
  "command.application": "Application",
  "command.help": "Help",
  "command.shortcutsRef": "Keyboard Shortcuts",

  // Template Selector
  "template.selectTitle": "Choose a genre framework",

  // --- auto-added ---
  "app.creating": "Creating...",
  "command.categoryApp": "Application",
  "command.categoryHelp": "Help",
  "command.categoryNewFile": "New File",
  "command.darkToLight": "Dark → Light",
  "command.hintClose": "esc Close",
  "command.hintExecute": "↵ Execute",
  "command.hintNavigate": "↑↓ Navigate",
  "command.lightToDark": "Light → Dark",
  "command.searchLabel": "Search commands",
  "command.toggleTheme": "Toggle Theme ({mode})",
  "error.retry": "Retry",
  "filelist.create": "Create",
  "filelist.createFailed": "Failed to create file: {error}",
  "filelist.newFileName": "File Name (will be created under {dirName})",
  "filelist.newFilePlaceholder": "Enter file name",
  "filelist.newFileTitle": "New File",
  "outline.addHeadingHint": "Use Ctrl+1 / Ctrl+2 to add headings",
  "projectcard.chapterUnit": "ch",
  "projectcard.chapters": "Chapters",
  "projectcard.lastUpdate": "Last Update",
  "projectcard.totalWords": "Total Words",
  "search.hint": "Enter keywords to search",
  "search.resultsMaxHint": "(showing first 200)",
  "shortcuts.autoShowHint": "This panel auto-shows on first visit. Press ? to open later",
  "shortcuts.bold": "Bold",
  "shortcuts.close": "Close panel / Back",
  "shortcuts.closePanel": "Close shortcut panel",
  "shortcuts.commandPalette": "Command palette",
  "shortcuts.focusMode": "Toggle focus mode",
  "shortcuts.globalSearch": "Global search",
  "shortcuts.heading1": "Heading 1",
  "shortcuts.heading2": "Heading 2",
  "shortcuts.italic": "Italic",
  "shortcuts.lyricsFormat": "Lyrics Format",
  "shortcuts.navCharacters": "Characters",
  "shortcuts.navGlossary": "Glossary",
  "shortcuts.navManuscript": "Manuscript",
  "shortcuts.navMaterials": "Materials",
  "shortcuts.navOutline": "Outline",
  "shortcuts.navStats": "Stats",
  "shortcuts.navTimeline": "Timeline",
  "shortcuts.navWorldview": "Worldview",
  "shortcuts.poetryFormat": "Poetry Format",
  "shortcuts.pressQuestionHint": "Press ? to open this panel anytime",
  "shortcuts.redo": "Redo",
  "shortcuts.save": "Save",
  "shortcuts.scriptMode": "Script mode - trigger characters",
  "shortcuts.sidebarNav": "Sidebar Navigation",
  "shortcuts.togglePanel": "Toggle shortcut panel",
  "shortcuts.underline": "Underline",
  "shortcuts.undo": "Undo",
  "skeleton.loading": "Loading",
  "skeleton.loadingFiles": "Loading file list",
  "stats.chapterRanking": "Chapter Ranking",
  "stats.creationDays": "Days",
  "stats.distribution": "Word Distribution",
  "stats.noChapterData": "No chapter data",
  "stats.refresh": "Refresh",
  "stats.setting": "Settings",
  "stats.totalChapters": "Chapters",
  "stats.totalFiles": "Files",
  "stats.wordUnit": "words",
  "template.chooseArch": "Choose a genre framework",
  "timeline.dirName": "Timeline",
  "timeline.newBranchLabel": "New branch (optional, leave blank to use above)",
  "timeline.noEvents": "No timeline events",
  "timeline.save": "Save",
  "timeline.saving": "Saving...",
};

const translations: Record<Locale, TranslationDict> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

// 翻译函数类型
type TFunction = (key: string, params?: Record<string, string | number>) => string;

// i18n 上下文值
interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "zh-CN",
  setLocale: () => {},
  t: (key) => key,
});

const STORAGE_KEY = "novelforge-locale";

// 从 localStorage 读取语言偏好
function loadLocale(): Locale {
  if (typeof localStorage === "undefined") return "zh-CN";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "zh-CN" || stored === "en-US") return stored;
  return "zh-CN";
}

// 保存语言偏好
function saveLocale(locale: Locale): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, locale);
}

// i18n Provider 组件
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(loadLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    saveLocale(newLocale);
    setLocaleState(newLocale);
  }, []);

  const t: TFunction = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const dict = translations[locale];
      let text = dict[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(`{${k}}`, String(v));
        }
      }
      return text;
    },
    [locale]
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

// 获取翻译函数
export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

// 初始化 i18n（在 App 挂载时调用）
export function useI18nInit(): Locale {
  const [locale] = useState<Locale>(loadLocale);
  useEffect(() => {
    saveLocale(locale);
  }, [locale]);
  return locale;
}
