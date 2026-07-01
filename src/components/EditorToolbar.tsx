// 编辑器工具栏组件（Office 级富文本模式）
//
// 功能概述：
// 提供 TipTap 编辑器的完整富文本工具栏，参考 Office / 番茄小说作家助手设计。
// 包含基础格式（粗体/斜体/下划线/删除线/代码/上下标）、标题层级（H1-H4）、
// 列表（无序/有序/任务）、文本对齐（左/中/右/两端）、字体颜色、高亮标记、
// 链接、表格、水平分割线、引用块、诗歌/歌词排版、撤销/重做、
// 大纲视图、版本快照、查找替换等完整工具组。
// 采用 FANDEX 直角按钮 + 毛玻璃风格。
// 集成写作会话统计（本次字数、时长、WPM、目标进度）与专注模式快捷切换。
//
// 模块职责：
// 1. ToolbarButton: 通用工具栏按钮
// 2. Divider: 分隔符
// 3. HeadingDropdown: 标题层级下拉菜单（H1-H4 + 正文）
// 4. ColorPicker: 颜色选择器（字体颜色 / 高亮颜色）
// 5. TableMenu: 表格操作下拉菜单（插入/添加行列/删除）
// 6. SessionStats: 写作会话统计小组件
// 7. EditorToolbar: 完整的工具栏组件

import type { Editor } from "@tiptap/core";
import { useState, useRef, useEffect } from "react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code as CodeIcon,
  Quote,
  Undo,
  Redo,
  Save,
  Loader2,
  Download,
  Music,
  Pilcrow,
  ListTree,
  Square,
  Eye,
  Pause,
  Play,
  Target,
  History,
  RotateCcw,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  List,
  ListOrdered,
  ListChecks,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Palette,
  Highlighter,
  Link as LinkIcon,
  Table as TableIcon,
  Minus,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Search,
  ChevronDown,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useI18n } from "../lib/i18n";

// 工具栏按钮属性
interface ToolbarButtonProps {
  onClick: () => void;
  active: boolean;
  title: string;
  children: React.ReactNode;
}

// 工具栏按钮 - FANDEX 直角风格（增强版）
export function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`relative p-1.5 transition-all duration-base ease-fandex border group ${
        active
          ? "bg-fandex-primary/10 text-fandex-primary border-fandex-primary/40"
          : "text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-hover border-transparent hover:border-nf-border-light"
      }`}
    >
      <span className="transition-transform duration-fast group-hover:scale-110 group-active:scale-95 block">
        {children}
      </span>
      {/* 激活态底部指示线 */}
      {active && (
        <span className="absolute bottom-0 left-1/4 right-1/4 h-[2px] bg-fandex-primary" />
      )}
    </button>
  );
}

// 分隔符
export function Divider() {
  return <div className="w-px h-4 bg-nf-border-light/60 mx-1.5" />;
}

// 预设颜色板（FANDEX 风格 + 经典 Office 色）
const COLOR_PRESETS: string[] = [
  "#7c9eff", "#4ee6b0", "#ff9e7a", "#ffd166", "#ef476f",
  "#06d6a0", "#118ab2", "#073b4c", "#e8e8f0", "#6e6e82",
  "#ff5252", "#ffab40", "#69f0ae", "#40c4ff", "#b388ff",
  "#ea80fc", "#ff8a80", "#ff80ab", "#8c9eff", "#80d8ff",
];

// 高亮预设色（柔和背景色，适合长篇阅读）
const HIGHLIGHT_PRESETS: string[] = [
  "#fff59d", "#ffe082", "#ffcc80", "#ef9a9a", "#ce93d8",
  "#b39ddb", "#9fa8da", "#90caf9", "#80deea", "#a5d6a7",
  "#c5e1a5", "#e6ee9c", "#fff9c4", "#d7ccc8", "#bcaaa4",
  "#ffffff", "#f5f5f5", "#eeeeee", "#e0e0e0", "#bdbdbd",
];

// 下拉菜单通用属性
interface DropdownProps {
  /** 触发按钮内容 */
  trigger: React.ReactNode;
  /** 下拉面板内容 */
  children: React.ReactNode;
  /** 面板宽度 */
  panelWidth?: string;
  /** 是否激活态 */
  active?: boolean;
  /** 标题（tooltip） */
  title?: string;
}

/**
 * 通用下拉菜单组件（点击外部自动关闭）
 * 输入: trigger 触发按钮 / children 面板内容 / panelWidth 面板宽度
 * 输出: JSX 下拉菜单
 * 流程:
 *   1. 点击 trigger 切换 open 状态
 *   2. open 时渲染面板，监听 document 点击事件
 *   3. 点击面板外部时关闭
 */
function Dropdown({ trigger, children, panelWidth = "w-56", active = false, title }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        title={title}
        className={`relative p-1.5 transition-all duration-base ease-fandex border flex items-center gap-0.5 ${
          active || open
            ? "bg-fandex-primary/10 text-fandex-primary border-fandex-primary/40"
            : "text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-hover border-transparent hover:border-nf-border-light"
        }`}
      >
        {trigger}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <div
          className={`absolute top-full left-0 mt-1 ${panelWidth} bg-nf-bg-card border border-nf-border-light shadow-lg z-50 max-h-96 overflow-y-auto`}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// 标题下拉属性
interface HeadingDropdownProps {
  editor: Editor | null;
}

/**
 * 标题层级下拉菜单（H1/H2/H3/H4 + 正文）
 * 输入: editor TipTap 编辑器实例
 * 输出: JSX 下拉菜单
 * 流程:
 *   1. 显示当前段落类型（正文/H1-H4）
 *   2. 点击选项切换段落为对应标题层级
 *   3. 选择"正文"时 toggleHeading 清除标题
 */
function HeadingDropdown({ editor }: HeadingDropdownProps) {
  const { t } = useI18n();
  if (!editor) return null;

  // 检测当前激活的标题层级
  const getCurrentLevel = (): string => {
    if (editor.isActive("heading", { level: 1 })) return "H1";
    if (editor.isActive("heading", { level: 2 })) return "H2";
    if (editor.isActive("heading", { level: 3 })) return "H3";
    if (editor.isActive("heading", { level: 4 })) return "H4";
    return t("editor.paragraph");
  };

  const currentLabel = getCurrentLevel();
  const isActive = editor.isActive("heading");

  // TipTap Heading 扩展的 Level 类型为 1|2|3|4|5|6，此处使用 1-4
  type HeadingLevel = 1 | 2 | 3 | 4;
  const options: Array<{ level: HeadingLevel | null; label: string; icon: React.ReactNode; className: string }> = [
    { level: null, label: t("editor.paragraph"), icon: <Pilcrow className="w-4 h-4" />, className: "text-nf-text" },
    { level: 1, label: t("editor.heading1"), icon: <Heading1 className="w-4 h-4" />, className: "text-fandex-primary" },
    { level: 2, label: t("editor.heading2"), icon: <Heading2 className="w-4 h-4" />, className: "text-fandex-secondary" },
    { level: 3, label: t("editor.heading3"), icon: <Heading3 className="w-4 h-4" />, className: "text-fandex-tertiary" },
    { level: 4, label: t("editor.heading4"), icon: <Heading4 className="w-4 h-4" />, className: "text-nf-text-secondary" },
  ];

  return (
    <Dropdown
      trigger={<span className="text-xs font-medium min-w-[40px] text-left">{currentLabel}</span>}
      active={isActive}
      title={t("editor.headingLevel")}
      panelWidth="w-44"
    >
      <div className="py-1">
        {options.map((opt) => {
          const isActiveOpt = opt.level === null
            ? !editor.isActive("heading")
            : editor.isActive("heading", { level: opt.level });
          return (
            <button
              key={opt.label}
              onClick={() => {
                if (opt.level === null) {
                  editor.chain().focus().setParagraph().run();
                } else {
                  editor.chain().focus().toggleHeading({ level: opt.level }).run();
                }
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition duration-fast ${
                isActiveOpt
                  ? "bg-fandex-primary/10 text-fandex-primary"
                  : "text-nf-text hover:bg-nf-bg-hover"
              }`}
            >
              <span className={opt.className}>{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    </Dropdown>
  );
}

// 颜色选择器属性
interface ColorPickerProps {
  editor: Editor | null;
  /** 颜色类型：text 字体颜色 / highlight 高亮颜色 */
  type: "text" | "highlight";
}

/**
 * 颜色选择器（字体颜色 / 高亮颜色）
 * 输入: editor 编辑器实例 / type 颜色类型
 * 输出: JSX 颜色选择下拉
 * 流程:
 *   1. 显示当前颜色（无颜色时显示默认图标）
 *   2. 点击色块应用颜色到选中文本
 *   3. 点击"清除颜色"移除颜色标记
 */
function ColorPicker({ editor, type }: ColorPickerProps) {
  const { t } = useI18n();
  if (!editor) return null;

  const presets = type === "text" ? COLOR_PRESETS : HIGHLIGHT_PRESETS;
  const currentColor = type === "text"
    ? (editor.getAttributes("textStyle").color as string | undefined)
    : (editor.getAttributes("highlight").color as string | undefined);
  const isActive = !!currentColor;
  const title = type === "text" ? t("editor.textColor") : t("editor.highlightColor");

  const applyColor = (color: string) => {
    if (type === "text") {
      editor.chain().focus().setColor(color).run();
    } else {
      editor.chain().focus().toggleHighlight({ color }).run();
    }
  };

  const clearColor = () => {
    if (type === "text") {
      editor.chain().focus().unsetColor().run();
    } else {
      editor.chain().focus().unsetHighlight().run();
    }
  };

  return (
    <Dropdown
      trigger={
        type === "text" ? (
          <div className="flex flex-col items-center gap-0.5">
            <Palette className="w-3.5 h-3.5" />
            <span
              className="w-3.5 h-0.5"
              style={{ background: currentColor || "currentColor" }}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            <Highlighter className="w-3.5 h-3.5" />
            <span
              className="w-3.5 h-0.5"
              style={{ background: currentColor || "currentColor" }}
            />
          </div>
        )
      }
      active={isActive}
      title={title}
      panelWidth="w-56"
    >
      <div className="p-2">
        <div className="text-[10px] text-nf-text-tertiary mb-1.5 px-1">
          {type === "text" ? t("editor.textColor") : t("editor.highlightColor")}
        </div>
        <div className="grid grid-cols-10 gap-1">
          {presets.map((color) => (
            <button
              key={color}
              onClick={() => applyColor(color)}
              title={color}
              className="w-4 h-4 border border-nf-border-light hover:scale-110 hover:border-fandex-primary transition duration-fast"
              style={{ background: color }}
            />
          ))}
        </div>
        <div className="mt-2 pt-2 border-t border-nf-border-light">
          <button
            onClick={clearColor}
            className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-nf-text-tertiary hover:text-fandex-tertiary hover:bg-nf-bg-hover transition duration-fast"
          >
            <X className="w-3 h-3" />
            {t("editor.clearColor")}
          </button>
        </div>
      </div>
    </Dropdown>
  );
}

// 表格菜单属性
interface TableMenuProps {
  editor: Editor | null;
}

/**
 * 表格操作下拉菜单（插入表格/添加行列/删除表格）
 * 输入: editor 编辑器实例
 * 输出: JSX 表格操作下拉
 * 流程:
 *   1. 不在表格内时仅显示"插入表格"
 *   2. 在表格内时显示添加行/列、删除行/列、删除表格
 */
function TableMenu({ editor }: TableMenuProps) {
  const { t } = useI18n();
  if (!editor) return null;

  const isInTable = editor.isActive("table");

  const handleInsertTable = () => {
    // 插入 3x3 默认表格
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  const menuItems: Array<{ label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }> = [
    { label: t("editor.insertTable"), icon: <TableIcon className="w-3.5 h-3.5" />, onClick: handleInsertTable },
    { label: t("editor.addRowAfter"), icon: <Plus className="w-3.5 h-3.5" />, onClick: () => editor.chain().focus().addRowAfter().run(), disabled: !isInTable },
    { label: t("editor.addColumnAfter"), icon: <Plus className="w-3.5 h-3.5" />, onClick: () => editor.chain().focus().addColumnAfter().run(), disabled: !isInTable },
    { label: t("editor.deleteRow"), icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => editor.chain().focus().deleteRow().run(), disabled: !isInTable, danger: true },
    { label: t("editor.deleteColumn"), icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => editor.chain().focus().deleteColumn().run(), disabled: !isInTable, danger: true },
    { label: t("editor.deleteTable"), icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => editor.chain().focus().deleteTable().run(), disabled: !isInTable, danger: true },
  ];

  return (
    <Dropdown
      trigger={<TableIcon className="w-4 h-4" />}
      active={isInTable}
      title={t("editor.table")}
      panelWidth="w-48"
    >
      <div className="py-1">
        {menuItems.map((item) => (
          <button
            key={item.label}
            onClick={item.onClick}
            disabled={item.disabled}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition duration-fast disabled:opacity-30 disabled:cursor-not-allowed ${
              item.danger
                ? "text-fandex-tertiary hover:bg-fandex-tertiary/10"
                : "text-nf-text hover:bg-nf-bg-hover"
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </Dropdown>
  );
}

/**
 * 插入链接对话框（简易版：使用 prompt）
 * 输入: editor 编辑器实例
 * 输出: void
 * 流程:
 *   1. 获取选中文本
 *   2. 弹出输入框获取 URL
 *   3. 应用 link 标记到选中文本
 */
function handleInsertLink(editor: Editor | null) {
  if (!editor) return;
  const url = window.prompt("URL:", "https://");
  if (url === null) return;
  if (url.trim() === "") {
    editor.chain().focus().unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
}

// 会话统计属性
interface SessionStatsProps {
  /** 本次会话净增字数 */
  sessionWords: number;
  /** 会话时长（秒） */
  sessionDuration: number;
  /** 每分钟字数 */
  wpm: number;
  /** 字数目标（0=未设定） */
  wordTarget: number;
  /** 目标完成进度（0-1） */
  progress: number;
  /** 是否暂停 */
  paused: boolean;
  /** 会话开始时间（ISO） */
  startedAt?: string;
  /** 暂停/恢复回调 */
  onTogglePause: () => void;
  /** 设定目标回调 */
  onSetTarget: (target: number) => void;
  /** 重置会话回调 */
  onResetSession?: () => void;
}

/**
 * 格式化时长为 mm:ss 或 hh:mm:ss
 * 输入: seconds 秒数
 * 输出: 格式化字符串
 */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

// 写作会话统计小组件
// 显示本次会话字数、时长、WPM 与目标进度条
// 点击 Target 图标弹出目标设定对话框，长按可重置会话
function SessionStats({
  sessionWords,
  sessionDuration,
  wpm,
  wordTarget,
  progress,
  paused,
  startedAt,
  onTogglePause,
  onSetTarget,
  onResetSession,
}: SessionStatsProps) {
  const { t } = useI18n();
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  const [inputTarget, setInputTarget] = useState<string>(String(wordTarget || ""));

  // 净增字数着色：正数绿色，负数红色，零灰色
  const wordsColor =
    sessionWords > 0
      ? "text-fandex-secondary"
      : sessionWords < 0
        ? "text-fandex-tertiary"
        : "text-nf-text-tertiary";

  // 打开对话框时同步当前目标值
  const handleOpenDialog = () => {
    setInputTarget(String(wordTarget || ""));
    setTargetDialogOpen(true);
  };

  // 确认设定目标
  const handleConfirmTarget = () => {
    const n = parseInt(inputTarget, 10);
    if (!isNaN(n) && n >= 0) {
      onSetTarget(n);
    }
    setTargetDialogOpen(false);
  };

  // 清除目标
  const handleClearTarget = () => {
    onSetTarget(0);
    setTargetDialogOpen(false);
  };

  // 常用目标快捷设定
  const quickTargets = [500, 1000, 2000, 5000];

  return (
    <div className="flex items-center gap-2 text-xs">
      {/* 暂停/恢复按钮 */}
      <button
        onClick={onTogglePause}
        title={paused ? t("editor.sessionReset") : "暂停会话"}
        className={`p-1 transition-all duration-base ease-fandex border ${
          paused
            ? "bg-fandex-tertiary/10 text-fandex-tertiary border-fandex-tertiary/40"
            : "text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-hover border-transparent hover:border-nf-border-light"
        }`}
      >
        {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
      </button>
      {/* 会话字数 */}
      <span className={`tabular-nums font-medium ${wordsColor}`}>
        {sessionWords > 0 ? "+" : ""}{sessionWords}
      </span>
      {/* 会话时长 */}
      <span className="tabular-nums text-nf-text-tertiary">
        {formatDuration(sessionDuration)}
      </span>
      {/* WPM */}
      {wpm > 0 && (
        <span className="tabular-nums text-nf-text-tertiary">
          {wpm} <span className="text-nf-text-tertiary/60">wpm</span>
        </span>
      )}
      {/* 目标进度条（点击可设定/修改目标） */}
      <button
        onClick={handleOpenDialog}
        title={t("editor.setTarget")}
        className={`flex items-center gap-1.5 px-1 py-0.5 transition-all duration-base ease-fandex border ${
          wordTarget > 0
            ? "bg-fandex-primary/10 border-fandex-primary/30 hover:bg-fandex-primary/15"
            : "border-transparent hover:bg-nf-bg-hover border-transparent"
        }`}
      >
        <Target className={`w-3 h-3 ${wordTarget > 0 ? "text-fandex-primary" : "text-nf-text-tertiary"}`} />
        {wordTarget > 0 ? (
          <>
            <div className="w-16 h-1.5 bg-nf-bg-hover border border-nf-border-light/40 overflow-hidden">
              <div
                className="h-full bg-fandex-primary transition-all duration-base ease-fandex"
                style={{ width: `${Math.min(100, progress * 100)}%` }}
              />
            </div>
            <span className="tabular-nums text-nf-text-tertiary text-[10px]">
              {Math.round(progress * 100)}%
            </span>
          </>
        ) : (
          <span className="text-[10px] text-nf-text-tertiary">{t("editor.setTarget")}</span>
        )}
      </button>
      {/* 重置会话按钮（仅当有目标或会话有数据时显示） */}
      {onResetSession && (wordTarget > 0 || sessionWords !== 0) && (
        <button
          onClick={() => {
            if (window.confirm(t("editor.sessionResetConfirm"))) {
              onResetSession();
            }
          }}
          title={t("editor.sessionReset")}
          className="p-1 text-nf-text-tertiary hover:text-fandex-tertiary transition duration-fast"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      )}

      {/* 目标设定对话框 */}
      {targetDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setTargetDialogOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-nf-bg-card border border-nf-border-light shadow-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-nf-border-light">
              <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text">
                {t("editor.targetDialogTitle")}
              </h3>
              <p className="text-xs text-nf-text-tertiary mt-1">
                {t("editor.targetDialogDesc")}
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              {/* 目标输入 */}
              <div>
                <label className="text-xs text-nf-text-secondary mb-1.5 block">
                  {t("editor.targetValue")}
                </label>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={inputTarget}
                  onChange={(e) => setInputTarget(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmTarget();
                    if (e.key === "Escape") setTargetDialogOpen(false);
                  }}
                  autoFocus
                  className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
                />
                <p className="text-[10px] text-nf-text-tertiary mt-1">
                  {t("editor.targetHint")}
                </p>
              </div>
              {/* 快捷目标按钮 */}
              <div className="flex flex-wrap gap-1.5">
                {quickTargets.map((n) => (
                  <button
                    key={n}
                    onClick={() => setInputTarget(String(n))}
                    className="px-2.5 py-1 text-xs text-nf-text-secondary bg-nf-bg border border-nf-border-light hover:border-fandex-primary/50 hover:text-fandex-primary transition duration-fast"
                  >
                    {n}
                  </button>
                ))}
              </div>
              {/* 会话信息（若有 startedAt） */}
              {startedAt && (
                <div className="text-[10px] text-nf-text-tertiary border-t border-nf-border-light pt-2">
                  {t("editor.sessionStarted")}: {new Date(startedAt).toLocaleTimeString()}
                </div>
              )}
            </div>
            <div className="flex justify-between gap-2 px-5 py-3 border-t border-nf-border-light">
              <button
                onClick={handleClearTarget}
                className="px-3 py-1.5 text-sm text-nf-text-tertiary hover:text-fandex-tertiary transition duration-fast"
              >
                {t("editor.targetClear")}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setTargetDialogOpen(false)}
                  className="px-3 py-1.5 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
                >
                  {t("editor.targetCancel")}
                </button>
                <button
                  onClick={handleConfirmTarget}
                  className="px-3 py-1.5 text-sm font-medium text-nf-text-inverse bg-fandex-primary hover:bg-fandex-primary-hover transition duration-fast"
                >
                  {t("editor.targetConfirm")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 工具栏属性
interface EditorToolbarProps {
  editor: Editor | null;
  wordCount: number;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onExportTxt: () => void;
  focusMode?: boolean;
  showOutline?: boolean;
  onToggleOutline?: () => void;
  // 写作会话统计
  sessionWords: number;
  sessionDuration: number;
  wpm: number;
  wordTarget: number;
  progress: number;
  sessionPaused: boolean;
  sessionStartedAt?: string;
  onToggleSessionPause: () => void;
  onSetSessionTarget: (target: number) => void;
  onResetSession?: () => void;
  // 专注模式快捷切换
  typewriterMode: boolean;
  focusDim: boolean;
  onToggleTypewriter: () => void;
  onToggleFocusDim: () => void;
  // 版本快照历史
  showSnapshotHistory?: boolean;
  onToggleSnapshotHistory?: () => void;
  // 查找替换面板
  showFindReplace?: boolean;
  onToggleFindReplace?: () => void;
}

// 编辑器工具栏组件（Office 级富文本模式）
export default function EditorToolbar({
  editor,
  wordCount,
  dirty,
  saving,
  onSave,
  onExportTxt,
  focusMode = false,
  showOutline = false,
  onToggleOutline,
  sessionWords,
  sessionDuration,
  wpm,
  wordTarget,
  progress,
  sessionPaused,
  sessionStartedAt,
  onToggleSessionPause,
  onSetSessionTarget,
  onResetSession,
  typewriterMode,
  focusDim,
  onToggleTypewriter,
  onToggleFocusDim,
  showSnapshotHistory = false,
  onToggleSnapshotHistory,
  showFindReplace = false,
  onToggleFindReplace,
}: EditorToolbarProps) {
  const { t } = useI18n();

  // 诗歌排版：切换居中样式
  const handlePoetryToggle = () => {
    if (!editor) return;
    editor.chain().focus().togglePoetry().run();
  };

  // 歌词排版：切换歌词样式
  const handleLyricsToggle = () => {
    if (!editor) return;
    editor.chain().focus().toggleLyrics().run();
  };

  // 检测当前段落是否为诗歌样式
  const isPoetryActive = (): boolean => {
    if (!editor) return false;
    const { $from } = editor.state.selection;
    const para = $from.parent;
    return para.attrs["data-poetry"] === "true";
  };

  // 检测当前段落是否为歌词样式
  const isLyricsActive = (): boolean => {
    if (!editor) return false;
    const { $from } = editor.state.selection;
    const para = $from.parent;
    return para.attrs["data-lyrics"] === "true";
  };

  // 快速加引号：用""包裹选中文本，无选中则在引号间放置光标
  const handleQuickQuote = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, "\n");
    if (selectedText) {
      editor.chain().focus()
        .deleteSelection()
        .insertContent(`\u201c${selectedText}\u201d`)
        .run();
    } else {
      editor.chain().focus()
        .insertContent("\u201c\u201d")
        .setTextSelection(from + 1)
        .run();
    }
  };

  return (
    <div className="fandex-nav-blur flex items-center gap-1 px-4 py-2 border-b border-nf-border-light overflow-x-auto">
      {/* 聚焦模式下隐藏格式化按钮，仅保留状态和保存 */}
      {!focusMode && (
        <>
          {/* 基础格式组：粗体/斜体/下划线/删除线/代码/上下标 */}
          <div className="flex items-center gap-0.5 bg-nf-bg-card/50 px-1 py-0.5 border border-nf-border-light/40">
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleBold().run()}
              active={editor?.isActive("bold") || false}
              title={t("editor.bold")}
            >
              <Bold className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              active={editor?.isActive("italic") || false}
              title={t("editor.italic")}
            >
              <Italic className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleUnderline().run()}
              active={editor?.isActive("underline") || false}
              title={t("editor.underline")}
            >
              <UnderlineIcon className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleStrike().run()}
              active={editor?.isActive("strike") || false}
              title={t("editor.strikethrough")}
            >
              <Strikethrough className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleCode().run()}
              active={editor?.isActive("code") || false}
              title={t("editor.inlineCode")}
            >
              <CodeIcon className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleSubscript().run()}
              active={editor?.isActive("subscript") || false}
              title={t("editor.subscript")}
            >
              <SubscriptIcon className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleSuperscript().run()}
              active={editor?.isActive("superscript") || false}
              title={t("editor.superscript")}
            >
              <SuperscriptIcon className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={handleQuickQuote}
              active={false}
              title={t("editor.quickQuote")}
            >
              <Quote className="w-4 h-4" />
            </ToolbarButton>
          </div>
          <Divider />
          {/* 标题段落组 */}
          <div className="flex items-center gap-0.5 bg-nf-bg-card/50 px-1 py-0.5 border border-nf-border-light/40">
            <HeadingDropdown editor={editor} />
            <ToolbarButton
              onClick={() => editor?.chain().focus().setHorizontalRule().run()}
              active={false}
              title={t("editor.horizontalRule")}
            >
              <Minus className="w-4 h-4" />
            </ToolbarButton>
          </div>
          <Divider />
          {/* 列表组 */}
          <div className="flex items-center gap-0.5 bg-nf-bg-card/50 px-1 py-0.5 border border-nf-border-light/40">
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              active={editor?.isActive("bulletList") || false}
              title={t("editor.bulletList")}
            >
              <List className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              active={editor?.isActive("orderedList") || false}
              title={t("editor.orderedList")}
            >
              <ListOrdered className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleTaskList().run()}
              active={editor?.isActive("taskList") || false}
              title={t("editor.taskList")}
            >
              <ListChecks className="w-4 h-4" />
            </ToolbarButton>
          </div>
          <Divider />
          {/* 对齐组 */}
          <div className="flex items-center gap-0.5 bg-nf-bg-card/50 px-1 py-0.5 border border-nf-border-light/40">
            <ToolbarButton
              onClick={() => editor?.chain().focus().setTextAlign("left").run()}
              active={editor?.isActive({ textAlign: "left" }) || false}
              title={t("editor.alignLeft")}
            >
              <AlignLeft className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().setTextAlign("center").run()}
              active={editor?.isActive({ textAlign: "center" }) || false}
              title={t("editor.alignCenter")}
            >
              <AlignCenter className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().setTextAlign("right").run()}
              active={editor?.isActive({ textAlign: "right" }) || false}
              title={t("editor.alignRight")}
            >
              <AlignRight className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().setTextAlign("justify").run()}
              active={editor?.isActive({ textAlign: "justify" }) || false}
              title={t("editor.alignJustify")}
            >
              <AlignJustify className="w-4 h-4" />
            </ToolbarButton>
          </div>
          <Divider />
          {/* 颜色组：字体颜色 + 高亮 */}
          <div className="flex items-center gap-0.5 bg-nf-bg-card/50 px-1 py-0.5 border border-nf-border-light/40">
            <ColorPicker editor={editor} type="text" />
            <ColorPicker editor={editor} type="highlight" />
          </div>
          <Divider />
          {/* 插入组：链接 / 表格 / 引用块 / 诗歌 / 歌词 */}
          <div className="flex items-center gap-0.5 bg-nf-bg-card/50 px-1 py-0.5 border border-nf-border-light/40">
            <ToolbarButton
              onClick={() => handleInsertLink(editor)}
              active={editor?.isActive("link") || false}
              title={t("editor.link")}
            >
              <LinkIcon className="w-4 h-4" />
            </ToolbarButton>
            <TableMenu editor={editor} />
            <ToolbarButton
              onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              active={editor?.isActive("blockquote") || false}
              title={t("editor.blockquote")}
            >
              <Quote className="w-4 h-4 rotate-180" />
            </ToolbarButton>
            <ToolbarButton
              onClick={handlePoetryToggle}
              active={isPoetryActive()}
              title={t("editor.poetryFormat")}
            >
              <Pilcrow className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={handleLyricsToggle}
              active={isLyricsActive()}
              title={t("editor.lyricsFormat")}
            >
              <Music className="w-4 h-4" />
            </ToolbarButton>
          </div>
          <Divider />
          {/* 操作历史组 + 大纲 + 快照 + 查找替换 */}
          <div className="flex items-center gap-0.5 bg-nf-bg-card/50 px-1 py-0.5 border border-nf-border-light/40">
            <ToolbarButton
              onClick={() => editor?.chain().focus().undo().run()}
              active={false}
              title={t("editor.undo")}
            >
              <Undo className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor?.chain().focus().redo().run()}
              active={false}
              title={t("editor.redo")}
            >
              <Redo className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => onToggleOutline?.()}
              active={showOutline}
              title={t("outline.title")}
            >
              <ListTree className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => onToggleSnapshotHistory?.()}
              active={showSnapshotHistory}
              title={t("snapshot.toggleHistory")}
            >
              <History className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => onToggleFindReplace?.()}
              active={showFindReplace}
              title={t("editor.findReplace")}
            >
              <Search className="w-4 h-4" />
            </ToolbarButton>
          </div>
        </>
      )}

      {/* 右侧状态区 */}
      <div className="ml-auto flex items-center gap-3 text-xs text-nf-text-tertiary flex-shrink-0">
        {/* 写作会话统计 */}
        <SessionStats
          sessionWords={sessionWords}
          sessionDuration={sessionDuration}
          wpm={wpm}
          wordTarget={wordTarget}
          progress={progress}
          paused={sessionPaused}
          startedAt={sessionStartedAt}
          onTogglePause={onToggleSessionPause}
          onSetTarget={onSetSessionTarget}
          onResetSession={onResetSession}
        />
        <Divider />
        {/* 专注模式快捷切换 */}
        {!focusMode && (
          <div className="flex items-center gap-0.5">
            <ToolbarButton
              onClick={onToggleTypewriter}
              active={typewriterMode}
              title={t("editor.typewriterMode") || "打字机模式"}
            >
              <Square className="w-3.5 h-3.5" />
            </ToolbarButton>
            <ToolbarButton
              onClick={onToggleFocusDim}
              active={focusDim}
              title={t("editor.focusDim") || "焦点暗化"}
            >
              <Eye className="w-3.5 h-3.5" />
            </ToolbarButton>
          </div>
        )}
        <span className="tabular-nums">{t("editor.wordCount", { count: wordCount })}</span>
        {/* 保存状态指示器 */}
        {dirty && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 bg-fandex-tertiary/10 text-fandex-tertiary border border-fandex-tertiary/20">
            <span className="w-1.5 h-1.5 bg-fandex-tertiary animate-pulse" />
            {t("editor.unsaved")}
          </span>
        )}
        {!focusMode && (
          <button
            onClick={onExportTxt}
            title={t("editor.exportTxt")}
            className="flex items-center gap-1 px-2 py-1 text-fandex-secondary border border-fandex-secondary/30 hover:bg-fandex-secondary/10 hover:border-fandex-secondary/50 transition-all duration-base ease-fandex"
          >
            <Download className="w-3.5 h-3.5" />
            TXT
          </button>
        )}
        <button
          onClick={onSave}
          disabled={!dirty || saving}
          className={`flex items-center gap-1 px-2.5 py-1 transition-all duration-base ease-fandex disabled:opacity-30 disabled:cursor-not-allowed ${
            dirty
              ? 'bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse shadow-sm hover:shadow-md'
              : 'bg-fandex-primary/40 text-nf-text-inverse/60'
          }`}
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {t("app.save")}
        </button>
      </div>
    </div>
  );
}
