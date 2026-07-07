// 全局命令面板 (Cmd+K / Ctrl+K)
//
// 功能概述：
// 提供全局命令面板，支持模糊搜索与快速导航。
// 命令涵盖：分类切换、新建文件、全局搜索、导出、切换主题、
// 写作目标设定、自动保存、模板设置、专注模式等。
//
// 模块职责：
// 1. 命令注册与模糊搜索（由 cmdk 内置 fuzzy 算法驱动，匹配 label 与 keywords）
// 2. 键盘上下导航 + 回车执行 + Escape 关闭（cmdk 内置，支持 loop 环绕）
// 3. 最近使用记录（localStorage 持久化前 5 条，空查询时置顶展示）
// 4. 命令图标可视化展示
// 5. 快捷键提示展示
//
// 重构说明（v26.7.16）：
//   原 450 行手写模糊匹配（.includes()）与键盘导航逻辑已由 cmdk 接管。
//   cmdk 提供更精准的 fuzzy 匹配、分组过滤、键盘环绕导航与 ARIA 无障碍支持。
//   保留 FANDEX 暗色主题样式与最近使用记录功能。

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Command as CommandPrimitive } from "cmdk";
import {
  Search,
  ArrowRight,
  FileText,
  ListTree,
  Library,
  BarChart3,
  Search as SearchIcon,
  Sun,
  Moon,
  Keyboard,
  Save,
  RotateCcw,
  History,
  Download,
  type LucideIcon,
} from "lucide-react";
import { useAppStore, CATEGORY_NAMES, type SidebarCategory } from "../lib/store";
import { useThemeStore } from "../lib/themeStore";
import { useSettingsStore } from "../lib/settingsStore";
import { useI18n } from "../lib/i18n";

// 命令接口定义
interface Command {
  /** 唯一 ID */
  id: string;
  /** 显示标签 */
  label: string;
  /** 所属分类（用于分组展示） */
  category: string;
  /** 搜索关键词 */
  keywords: string[];
  /** 执行函数 */
  action: () => void;
  /** 图标 */
  icon?: LucideIcon;
  /** 快捷键提示（可选） */
  shortcut?: string;
}

interface CommandPaletteProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 新建文件回调（按分类触发） */
  onCreateFile?: (category: SidebarCategory) => void;
  /** 切换分类回调（带保存检查） */
  onSwitchCategory?: (category: SidebarCategory) => void;
  /** 导出项目回调 */
  onExportProject?: () => void;
}

// 最近使用记录的 localStorage 键
const RECENT_COMMANDS_KEY = "novelforge-recent-commands";
// 最近使用记录上限
const MAX_RECENT = 5;

/**
 * 加载最近使用命令 ID 列表
 * 输出: string[] 命令 ID 列表
 */
function loadRecentCommands(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const stored = localStorage.getItem(RECENT_COMMANDS_KEY);
    if (stored) {
      const arr = JSON.parse(stored);
      return Array.isArray(arr) ? arr.slice(0, MAX_RECENT) : [];
    }
  } catch {
    // JSON 解析失败，返回空数组
  }
  return [];
}

/**
 * 保存最近使用命令 ID
 * 输入: id 命令 ID
 */
function saveRecentCommand(id: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const current = loadRecentCommands();
    // 去重并前置
    const filtered = current.filter((c) => c !== id);
    const updated = [id, ...filtered].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(updated));
  } catch {
    // 写入失败静默处理
  }
}

/**
 * 全局命令面板组件（cmdk 驱动）
 * 输入:
 *   open 是否打开
 *   onClose 关闭回调
 *   onCreateFile 新建文件回调（按分类触发）
 *   onSwitchCategory 切换分类回调（带保存检查）
 * 输出: JSX 浮层面板（未打开时返回 null）
 * 流程:
 *   1. 构建命令列表：分类切换、新建文件、全局搜索、导出、主题切换、写作目标等
 *   2. cmdk 内置 fuzzy 搜索自动匹配 label 与 keywords
 *   3. 无查询时优先展示最近使用记录分组（置顶）
 *   4. 键盘导航由 cmdk 内置：↑↓ 选择（loop 环绕）、Enter 执行、Escape 关闭
 *   5. 执行命令后记录到最近使用列表并自动关闭
 */
export default function CommandPalette({
  open,
  onClose,
  onCreateFile,
  onSwitchCategory,
  onExportProject,
}: CommandPaletteProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const setActiveCategory = useAppStore((s) => s.setActiveCategory);
  const { toggleTheme, theme } = useThemeStore();
  const settings = useSettingsStore();

  // 分类切换：优先使用外部传入的保存后切换回调
  const switchTo = onSwitchCategory || setActiveCategory;

  // 分类导航命令（带图标）
  const categoryCommands: Command[] = useMemo(
    () => [
      { id: "cat-manuscript", label: CATEGORY_NAMES["manuscript"], category: t("command.categoryNav"), keywords: ["正文", "manuscript", "章节"], action: () => switchTo("manuscript"), icon: FileText },
      { id: "cat-outline", label: CATEGORY_NAMES["outline"], category: t("command.categoryNav"), keywords: ["大纲", "outline"], action: () => switchTo("outline"), icon: ListTree },
      { id: "cat-codex", label: CATEGORY_NAMES["codex"], category: t("command.categoryNav"), keywords: ["设定", "设定库", "角色", "世界观", "术语", "codex"], action: () => switchTo("codex"), icon: Library },
      { id: "cat-stats", label: CATEGORY_NAMES["stats"], category: t("command.categoryNav"), keywords: ["统计", "stats", "字数"], action: () => switchTo("stats"), icon: BarChart3 },
      { id: "cat-search", label: CATEGORY_NAMES["search"], category: t("command.categoryNav"), keywords: ["搜索", "search", "查找"], action: () => switchTo("search"), icon: SearchIcon },
    ],
    [switchTo, t]
  );

  // 应用操作命令（带图标与快捷键提示）
  const appCommands: Command[] = useMemo(
    () => [
      {
        id: "theme",
        label: t("command.toggleTheme", { mode: theme === "dark" ? t("command.darkToLight") : t("command.lightToDark") }),
        category: t("command.categoryApp"),
        keywords: ["主题", "theme", "暗色", "亮色", "dark", "light"],
        action: () => toggleTheme(),
        icon: theme === "dark" ? Sun : Moon,
      },
      {
        id: "shortcuts",
        label: t("command.shortcutsRef"),
        category: t("command.categoryHelp"),
        keywords: ["快捷键", "shortcuts", "键盘"],
        action: () => { onClose(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" })); },
        icon: Keyboard,
      },
      {
        id: "toggle-autosave",
        label: settings.autoSaveInterval > 0 ? t("command.disableAutosave") : t("command.enableAutosave"),
        category: t("command.categoryEditor"),
        keywords: ["自动保存", "autosave", "保存"],
        action: () => settings.setAutoSaveInterval(settings.autoSaveInterval > 0 ? 0 : 30),
        icon: Save,
      },
      {
        id: "toggle-snapshot",
        label: settings.snapshotEnabled ? t("command.disableSnapshot") : t("command.enableSnapshot"),
        category: t("command.categoryEditor"),
        keywords: ["快照", "snapshot", "版本", "历史"],
        action: () => settings.setSnapshotEnabled(!settings.snapshotEnabled),
        icon: History,
      },
      {
        id: "reset-session",
        label: t("command.resetSession"),
        category: t("command.categoryEditor"),
        keywords: ["重置", "会话", "session", "字数"],
        action: () => {
          settings.setSessionWordTarget(0);
        },
        icon: RotateCcw,
      },
      ...(onExportProject ? [{
        id: "export-project",
        label: t("archive.exportTitle"),
        category: t("command.categoryApp"),
        keywords: ["导出", "备份", "归档", "export", "archive", "novelforge"],
        action: () => { onClose(); onExportProject(); },
        icon: Download as LucideIcon,
      }] : []),
    ],
    [toggleTheme, theme, onClose, t, settings, onExportProject]
  );

  // 新建文件命令（按分类动态生成）
  const createFileCommands: Command[] = useMemo(() => {
    if (!onCreateFile) return [];
    const categories: SidebarCategory[] = ["manuscript", "outline", "codex"];
    return categories.map((cat) => ({
      id: `new-file-${cat}`,
      label: t("command.newFile", { category: CATEGORY_NAMES[cat] }),
      category: t("command.categoryNewFile"),
      keywords: ["新建", "创建", "文件", cat],
      action: () => { onClose(); onCreateFile(cat); },
      icon: FileText,
    }));
  }, [onCreateFile, onClose, t]);

  // 所有命令汇总
  const allCommands = useMemo(
    () => [...categoryCommands, ...appCommands, ...createFileCommands],
    [categoryCommands, appCommands, createFileCommands]
  );

  // 最近使用记录
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setRecentIds(loadRecentCommands());
    }
  }, [open]);

  // 最近使用命令列表（仅在无搜索词时展示）
  const recentCommands = useMemo(() => {
    return recentIds
      .map((id) => allCommands.find((c) => c.id === id))
      .filter((c): c is Command => c !== undefined);
  }, [recentIds, allCommands]);

  // 通过受控 search state 判断是否展示「最近使用」分组（空查询时置顶）
  // 注意：不能使用 cmdk 的 useCommandState 钩子，该钩子必须在 <Command> 子树内调用，
  // 在组件函数体顶层调用会导致 store 为 null 抛错，触发 ErrorBoundary 渲染异常。
  const showRecent = !search.trim() && recentCommands.length > 0;

  // 最近使用命令的 ID 集合（用于从常规分组中排除）
  const recentIdSet = useMemo(() => new Set(recentCommands.map((c) => c.id)), [recentCommands]);

  // 常规命令（排除最近使用项，避免 value 重复）
  const regularCommands = useMemo(() => {
    if (showRecent) {
      return allCommands.filter((c) => !recentIdSet.has(c.id));
    }
    return allCommands;
  }, [allCommands, showRecent, recentIdSet]);

  // 重置搜索词
  useEffect(() => {
    if (!open) {
      setSearch("");
    }
  }, [open]);

  /**
   * 执行命令并记录到最近使用
   * 输入: cmd 命令对象
   */
  const executeCommand = useCallback(
    (cmd: Command) => {
      cmd.action();
      saveRecentCommand(cmd.id);
      setRecentIds(loadRecentCommands());
      onClose();
    },
    [onClose]
  );

  if (!open) return null;

  /**
   * 渲染单个命令项
   * 输入: cmd 命令对象
   * 输出: Command.Item JSX
   * 说明:
   *   - value 使用 cmd.label 供 cmdk 文本匹配
   *   - keywords 传递给 cmdk 扩展匹配范围
   *   - onSelect 通过闭包捕获 cmd 对象，忽略 value 参数
   */
  const renderItem = (cmd: Command) => {
    const Icon = cmd.icon;
    return (
      <CommandPrimitive.Item
        key={cmd.id}
        value={cmd.label}
        keywords={cmd.keywords}
        onSelect={() => executeCommand(cmd)}
        className="nf-cmdk-item"
      >
        {Icon && <Icon className="w-4 h-4 flex-shrink-0 text-nf-text-tertiary" data-cmdk-icon />}
        <span className="flex-1 truncate">{cmd.label}</span>
        {cmd.shortcut && (
          <kbd className="px-1.5 py-0.5 bg-nf-bg-hover border border-nf-border-light text-[10px] font-mono text-nf-text-tertiary flex-shrink-0">
            {cmd.shortcut}
          </kbd>
        )}
        <ArrowRight className="w-3.5 h-3.5 text-fandex-primary flex-shrink-0 nf-cmdk-arrow" />
      </CommandPrimitive.Item>
    );
  };

  /**
   * 按分类分组渲染命令
   * 输入: commands 命令列表
   * 输出: 多个 Command.Group JSX
   */
  const renderGroups = (commands: Command[]) => {
    const groups: Record<string, Command[]> = {};
    for (const cmd of commands) {
      if (!groups[cmd.category]) groups[cmd.category] = [];
      groups[cmd.category].push(cmd);
    }
    return Object.entries(groups).map(([groupName, cmds]) => (
      <CommandPrimitive.Group key={groupName} heading={groupName} className="nf-cmdk-group">
        {cmds.map(renderItem)}
      </CommandPrimitive.Group>
    ));
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[20vh] bg-black/40 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="nf-glass-panel w-full max-w-lg border border-nf-border-light shadow-2xl overflow-hidden">
        <CommandPrimitive
          label={t("command.searchLabel")}
          loop
          className="flex flex-col"
        >
          {/* 搜索框 */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-nf-border-light">
            <Search className="w-4 h-4 text-nf-text-tertiary flex-shrink-0" />
            <CommandPrimitive.Input
              ref={inputRef}
              value={search}
              onValueChange={setSearch}
              placeholder={t("command.placeholder")}
              className="flex-1 bg-transparent text-sm text-nf-text placeholder-nf-text-tertiary outline-none"
              aria-label={t("command.searchLabel")}
            />
            <kbd className="px-1.5 py-0.5 bg-nf-bg-hover border border-nf-border-light text-[10px] font-mono text-nf-text-tertiary flex-shrink-0">
              ESC
            </kbd>
          </div>

          {/* 命令列表（cmdk 自动过滤与排序） */}
          <CommandPrimitive.List className="max-h-[340px] overflow-y-auto py-1">
            <CommandPrimitive.Empty className="px-4 py-8 text-center text-sm text-nf-text-tertiary">
              {t("command.noMatch")}
            </CommandPrimitive.Empty>

            {/* 最近使用分组（仅无搜索词时置顶展示） */}
            {showRecent && (
              <CommandPrimitive.Group heading={t("command.recent")} className="nf-cmdk-group nf-cmdk-group-recent">
                {recentCommands.map(renderItem)}
              </CommandPrimitive.Group>
            )}

            {/* 常规分组 */}
            {renderGroups(regularCommands)}
          </CommandPrimitive.List>
        </CommandPrimitive>

        {/* 底部提示 */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-nf-border-light text-[10px] text-nf-text-tertiary">
          <span>{t("command.hintNavigate")}</span>
          <span>{t("command.hintExecute")}</span>
          <span>{t("command.hintClose")}</span>
        </div>
      </div>
    </div>
  );
}
