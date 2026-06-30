// 全局命令面板 (Cmd+K / Ctrl+K)
//
// 功能概述：
// 提供全局命令面板，支持模糊搜索与快速导航。
// 命令涵盖：分类切换、新建文件、全局搜索、导出、切换主题等。
//
// 模块职责：
// 1. 命令注册与模糊搜索
// 2. 键盘上下导航
// 3. 回车执行命令
// 4. Escape 关闭

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Search, ArrowRight } from "lucide-react";
import { useAppStore, CATEGORY_NAMES, type SidebarCategory } from "../lib/store";
import { getTypeSpecificDirs } from "../lib/templateRegistry";
import { useThemeStore } from "../lib/themeStore";
import { useI18n } from "../lib/i18n";

interface Command {
  id: string;
  label: string;
  category: string;
  keywords: string[];
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onCreateFile?: (category: SidebarCategory) => void;
  onSwitchCategory?: (category: SidebarCategory) => void;
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
 *   1. 构建命令列表：分类切换、新建文件、全局搜索、导出、主题切换
 *   2. 根据用户输入进行模糊搜索（匹配 label 与 keywords）
 *   3. 键盘导航：↑↓ 选择、Enter 执行、Escape 关闭
 *   4. 执行命令后自动关闭面板并清空查询
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
    }));
  }, [currentProject, switchTo, t]);

  const commands: Command[] = useMemo(
    () => [
      { id: "cat-manuscript", label: CATEGORY_NAMES["manuscript"], category: t("command.categoryNav"), keywords: ["正文", "manuscript", "章节"], action: () => switchTo("manuscript") },
      { id: "cat-outline", label: CATEGORY_NAMES["outline"], category: t("command.categoryNav"), keywords: ["大纲", "outline"], action: () => switchTo("outline") },
      { id: "cat-characters", label: CATEGORY_NAMES["characters"], category: t("command.categoryNav"), keywords: ["角色", "人物", "characters"], action: () => switchTo("characters") },
      { id: "cat-worldview", label: CATEGORY_NAMES["worldview"], category: t("command.categoryNav"), keywords: ["世界观", "设定", "worldview"], action: () => switchTo("worldview") },
      { id: "cat-glossary", label: CATEGORY_NAMES["glossary"], category: t("command.categoryNav"), keywords: ["名词", "术语", "glossary"], action: () => switchTo("glossary") },
      { id: "cat-materials", label: CATEGORY_NAMES["materials"], category: t("command.categoryNav"), keywords: ["素材", "资料", "materials"], action: () => switchTo("materials") },
      { id: "cat-timeline", label: CATEGORY_NAMES["timeline"], category: t("command.categoryNav"), keywords: ["时间线", "timeline"], action: () => switchTo("timeline") },
      { id: "cat-stats", label: CATEGORY_NAMES["stats"], category: t("command.categoryNav"), keywords: ["统计", "stats", "字数"], action: () => switchTo("stats") },
      { id: "cat-search", label: CATEGORY_NAMES["search"], category: t("command.categoryNav"), keywords: ["搜索", "search", "查找"], action: () => switchTo("search") },
      ...typeSpecificCommands,
      { id: "theme", label: t("command.toggleTheme", { mode: theme === "dark" ? t("command.darkToLight") : t("command.lightToDark") }), category: t("command.categoryApp"), keywords: ["主题", "theme", "暗色", "亮色"], action: () => toggleTheme() },
      { id: "shortcuts", label: t("command.shortcutsRef"), category: t("command.categoryHelp"), keywords: ["快捷键", "shortcuts", "键盘"], action: () => { onClose(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" })); } },
    ],
    [switchTo, toggleTheme, theme, onClose, t, typeSpecificCommands]
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
    }));
  }, [onCreateFile, onClose, t]);

  const allCommands = useMemo(() => [...commands, ...createFileCommands], [commands, createFileCommands]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allCommands;
    const q = query.toLowerCase();
    return allCommands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.keywords.some((k) => k.toLowerCase().includes(q)) ||
        cmd.category.toLowerCase().includes(q)
    );
  }, [query, allCommands]);

  // 重置选择
  useEffect(() => {
    setSelectedIndex(0);
    setQuery("");
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Clamp selectedIndex when filtered results shrink
  useEffect(() => {
    if (selectedIndex >= filtered.length && filtered.length > 0) {
      setSelectedIndex(0);
    }
  }, [filtered.length, selectedIndex]);

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].action();
          onClose();
        }
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [filtered, selectedIndex, onClose]
  );

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

        {/* 命令列表 */}
        <div className="max-h-[340px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-nf-text-tertiary">
              {t("command.noMatch")}
            </div>
          ) : (
            filtered.map((cmd, idx) => (
              <button
                key={cmd.id}
                ref={(el) => { if (idx === selectedIndex && el) el.scrollIntoView({ block: "nearest" }); }}
                onClick={() => { cmd.action(); onClose(); }}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition duration-fast ${
                  idx === selectedIndex
                    ? "bg-fandex-primary/10 text-fandex-primary"
                    : "text-nf-text hover:bg-nf-bg-hover"
                }`}
              >
                <span className="flex-1 truncate">{cmd.label}</span>
                <span className="text-xs text-nf-text-tertiary flex-shrink-0">
                  {cmd.category}
                </span>
                {idx === selectedIndex && (
                  <ArrowRight className="w-3.5 h-3.5 text-fandex-primary flex-shrink-0" />
                )}
              </button>
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
