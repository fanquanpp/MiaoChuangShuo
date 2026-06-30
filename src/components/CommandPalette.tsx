// 全局命令面板 (Cmd+K / Ctrl+K)
//
// 功能概述：
// 提供全局命令面板，支持模糊搜索与快速导航。
// 命令涵盖：分类切换、新建文件、全局搜索、导出、切换主题、
// 写作目标设定、自动保存、模板设置、专注模式等。
//
// 模块职责：
// 1. 命令注册与模糊搜索（含 label、keywords、category 三维匹配）
// 2. 键盘上下导航 + 回车执行 + Escape 关闭
// 3. 最近使用记录（localStorage 持久化前 5 条）
// 4. 命令图标可视化展示
// 5. 快捷键提示展示

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Search,
  ArrowRight,
  FileText,
  ListTree,
  Users,
  Globe,
  BookOpen,
  Calendar,
  BarChart3,
  Search as SearchIcon,
  Sun,
  Moon,
  Keyboard,
  Target,
  Save,
  Sparkles,
  BookCopy,
  RotateCcw,
  History,
  type LucideIcon,
} from "lucide-react";
import { useAppStore, CATEGORY_NAMES, type SidebarCategory } from "../lib/store";
import { getTypeSpecificDirs } from "../lib/templateRegistry";
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
 * 全局命令面板组件
 * 输入:
 *   open 是否打开
 *   onClose 关闭回调
 *   onCreateFile 新建文件回调（按分类触发）
 *   onSwitchCategory 切换分类回调（带保存检查）
 * 输出: JSX 浮层面板（未打开时返回 null）
 * 流程:
 *   1. 构建命令列表：分类切换、新建文件、全局搜索、导出、主题切换、写作目标等
 *   2. 根据用户输入进行模糊搜索（匹配 label、keywords、category）
 *   3. 无查询时优先展示最近使用记录
 *   4. 键盘导航：↑↓ 选择、Enter 执行、Escape 关闭
 *   5. 执行命令后记录到最近使用列表并自动关闭
 */
export default function CommandPalette({
  open,
  onClose,
  onCreateFile,
  onSwitchCategory,
}: CommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const setActiveCategory = useAppStore((s) => s.setActiveCategory);
  const currentProject = useAppStore((s) => s.currentProject);
  const { toggleTheme, theme } = useThemeStore();
  const settings = useSettingsStore();

  // 分类切换：优先使用外部传入的保存后切换回调
  const switchTo = onSwitchCategory || setActiveCategory;

  // 类型专属目录导航命令（动态生成）
  const typeSpecificCommands: Command[] = useMemo(() => {
    if (!currentProject) return [];
    const dirs = getTypeSpecificDirs(currentProject.meta.type);
    return dirs.map((dirName) => ({
      id: `cat-tpl-${dirName}`,
      label: dirName,
      category: t("command.categoryNav"),
      keywords: [dirName, "设定", "扩展"],
      action: () => switchTo(dirName as SidebarCategory),
      icon: BookOpen,
    }));
  }, [currentProject, switchTo, t]);

  // 分类导航命令（带图标）
  const categoryCommands: Command[] = useMemo(
    () => [
      { id: "cat-manuscript", label: CATEGORY_NAMES["manuscript"], category: t("command.categoryNav"), keywords: ["正文", "manuscript", "章节"], action: () => switchTo("manuscript"), icon: FileText },
      { id: "cat-outline", label: CATEGORY_NAMES["outline"], category: t("command.categoryNav"), keywords: ["大纲", "outline"], action: () => switchTo("outline"), icon: ListTree },
      { id: "cat-characters", label: CATEGORY_NAMES["characters"], category: t("command.categoryNav"), keywords: ["角色", "人物", "characters"], action: () => switchTo("characters"), icon: Users },
      { id: "cat-worldview", label: CATEGORY_NAMES["worldview"], category: t("command.categoryNav"), keywords: ["世界观", "设定", "worldview"], action: () => switchTo("worldview"), icon: Globe },
      { id: "cat-glossary", label: CATEGORY_NAMES["glossary"], category: t("command.categoryNav"), keywords: ["名词", "术语", "glossary"], action: () => switchTo("glossary"), icon: BookOpen },
      { id: "cat-materials", label: CATEGORY_NAMES["materials"], category: t("command.categoryNav"), keywords: ["素材", "资料", "materials"], action: () => switchTo("materials"), icon: BookOpen },
      { id: "cat-timeline", label: CATEGORY_NAMES["timeline"], category: t("command.categoryNav"), keywords: ["时间线", "timeline"], action: () => switchTo("timeline"), icon: Calendar },
      { id: "cat-stats", label: CATEGORY_NAMES["stats"], category: t("command.categoryNav"), keywords: ["统计", "stats", "字数"], action: () => switchTo("stats"), icon: BarChart3 },
      { id: "cat-search", label: CATEGORY_NAMES["search"], category: t("command.categoryNav"), keywords: ["搜索", "search", "查找"], action: () => switchTo("search"), icon: SearchIcon },
      ...typeSpecificCommands,
    ],
    [switchTo, t, typeSpecificCommands]
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
        id: "toggle-typewriter",
        label: settings.typewriterMode ? t("command.disableTypewriter") : t("command.enableTypewriter"),
        category: t("command.categoryEditor"),
        keywords: ["打字机", "typewriter", "居中", "专注"],
        action: () => settings.setTypewriterMode(!settings.typewriterMode),
        icon: Target,
      },
      {
        id: "toggle-focus-dim",
        label: settings.focusDim ? t("command.disableFocusDim") : t("command.enableFocusDim"),
        category: t("command.categoryEditor"),
        keywords: ["昏暗", "专注", "focus", "dim"],
        action: () => settings.setFocusDim(!settings.focusDim),
        icon: Sparkles,
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
    ],
    [toggleTheme, theme, onClose, t, settings]
  );

  // 新建文件命令（按分类动态生成）
  const createFileCommands: Command[] = useMemo(() => {
    if (!onCreateFile) return [];
    const categories: SidebarCategory[] = ["manuscript", "outline", "characters", "worldview", "glossary", "materials", "timeline"];
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

  // 最近使用命令列表
  const recentCommands = useMemo(() => {
    if (query.trim()) return [];
    return recentIds
      .map((id) => allCommands.find((c) => c.id === id))
      .filter((c): c is Command => c !== undefined);
  }, [recentIds, allCommands, query]);

  // 搜索过滤结果
  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return allCommands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.keywords.some((k) => k.toLowerCase().includes(q)) ||
        cmd.category.toLowerCase().includes(q)
    );
  }, [query, allCommands]);

  // 当前展示列表：无查询时显示最近使用 + 全部命令；有查询时仅显示过滤结果
  const displayList = query.trim() ? filtered : (recentCommands.length > 0 ? recentCommands : allCommands);

  // 重置选择与查询
  useEffect(() => {
    setSelectedIndex(0);
    setQuery("");
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Clamp selectedIndex when results shrink
  useEffect(() => {
    if (selectedIndex >= displayList.length && displayList.length > 0) {
      setSelectedIndex(0);
    }
  }, [displayList.length, selectedIndex]);

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

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, displayList.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (displayList[selectedIndex]) {
          executeCommand(displayList[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [displayList, selectedIndex, onClose, executeCommand]
  );

  // 按分类分组展示
  const grouped = useMemo(() => {
    const groups: Record<string, Command[]> = {};
    for (const cmd of displayList) {
      if (!groups[cmd.category]) groups[cmd.category] = [];
      groups[cmd.category].push(cmd);
    }
    return groups;
  }, [displayList]);

  // 扁平化用于键盘索引
  const flatList: Command[] = displayList;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[20vh] bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-nf-bg-card border border-nf-border-light shadow-2xl overflow-hidden">
        {/* 搜索框 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-nf-border-light">
          <Search className="w-4 h-4 text-nf-text-tertiary flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t("command.placeholder")}
            className="flex-1 bg-transparent text-sm text-nf-text placeholder-nf-text-tertiary outline-none"
            aria-label={t("command.searchLabel")}
          />
          <kbd className="px-1.5 py-0.5 bg-nf-bg-hover border border-nf-border-light text-[10px] font-mono text-nf-text-tertiary flex-shrink-0">
            ESC
          </kbd>
        </div>

        {/* 命令列表（分组展示） */}
        <div className="max-h-[340px] overflow-y-auto py-1">
          {!query.trim() && recentCommands.length > 0 && (
            <div className="px-4 py-1 text-[10px] font-medium text-fandex-secondary uppercase tracking-wider">
              {t("command.recent")}
            </div>
          )}
          {displayList.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-nf-text-tertiary">
              {t("command.noMatch")}
            </div>
          ) : (
            Object.entries(grouped).map(([groupName, cmds]) => (
              <div key={groupName}>
                <div className="px-4 py-1 text-[10px] font-medium text-nf-text-tertiary uppercase tracking-wider">
                  {groupName}
                </div>
                {cmds.map((cmd) => {
                  // 计算在 flatList 中的索引
                  const flatIdx = flatList.findIndex((c) => c.id === cmd.id);
                  const Icon = cmd.icon;
                  return (
                    <button
                      key={cmd.id}
                      ref={(el) => { if (flatIdx === selectedIndex && el) el.scrollIntoView({ block: "nearest" }); }}
                      onClick={() => executeCommand(cmd)}
                      onMouseEnter={() => setSelectedIndex(flatIdx)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition duration-fast ${
                        flatIdx === selectedIndex
                          ? "bg-fandex-primary/10 text-fandex-primary"
                          : "text-nf-text hover:bg-nf-bg-hover"
                      }`}
                    >
                      {Icon && (
                        <Icon className={`w-4 h-4 flex-shrink-0 ${flatIdx === selectedIndex ? "text-fandex-primary" : "text-nf-text-tertiary"}`} />
                      )}
                      <span className="flex-1 truncate">{cmd.label}</span>
                      {cmd.shortcut && (
                        <kbd className="px-1.5 py-0.5 bg-nf-bg-hover border border-nf-border-light text-[10px] font-mono text-nf-text-tertiary flex-shrink-0">
                          {cmd.shortcut}
                        </kbd>
                      )}
                      {flatIdx === selectedIndex && (
                        <ArrowRight className="w-3.5 h-3.5 text-fandex-primary flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

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
