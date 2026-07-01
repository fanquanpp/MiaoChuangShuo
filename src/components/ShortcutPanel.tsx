// 快捷键参考面板
//
// 功能概述：
// 按 `?` 键弹出快捷键参考面板，展示所有可用快捷键及其功能描述。
// 采用 FANDEX 直角美学，分类展示编辑器、全局、侧边栏快捷键。
//
// 模块职责：
// 1. 全局监听 `?` 键切换显示/隐藏
// 2. 监听外部 nf:open-shortcuts 事件打开面板
// 3. 分类渲染快捷键列表，支持键盘 Caps Lock 样式键帽
// 4. 点击遮罩或 Escape 关闭面板

import { useEffect, useState, useCallback } from "react";
import { X, Keyboard } from "lucide-react";
import { useI18n } from "../lib/i18n";

/** 快捷键分组结构 */
interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string; desc: string }[];
}

/**
 * 构建快捷键分组数据
 * 输入: t i18n 翻译函数
 * 输出: ShortcutGroup[] 按编辑器/段落操作/自动行为/全局/侧边栏分组的快捷键列表
 * 流程: 静态枚举五组快捷键，通过 t 函数本地化描述文案
 */
function buildShortcuts(t: (key: string) => string): ShortcutGroup[] {
  return [
    {
      title: t("shortcuts.editor"),
      shortcuts: [
        { keys: "Ctrl + B", desc: t("shortcuts.bold") },
        { keys: "Ctrl + I", desc: t("shortcuts.italic") },
        { keys: "Ctrl + Shift + P", desc: t("shortcuts.poetryFormat") },
        { keys: "Ctrl + Shift + L", desc: t("shortcuts.lyricsFormat") },
        { keys: "Ctrl + Z", desc: t("shortcuts.undo") },
        { keys: "Ctrl + Shift + Z", desc: t("shortcuts.redo") },
        { keys: "Ctrl + S", desc: t("shortcuts.save") },
        { keys: "Ctrl + Q", desc: t("shortcuts.quickQuote") },
        { keys: "Tab", desc: t("shortcuts.scriptMode") },
        { keys: "Ctrl + =", desc: t("shortcuts.fontSizeIncrease") },
        { keys: "Ctrl + -", desc: t("shortcuts.fontSizeDecrease") },
        { keys: "Ctrl + 0", desc: t("shortcuts.fontSizeReset") },
      ],
    },
    {
      title: t("shortcuts.paragraphOps"),
      shortcuts: [
        { keys: "Ctrl + L", desc: t("shortcuts.selectParagraph") },
        { keys: "Ctrl + Shift + K", desc: t("shortcuts.deleteParagraph") },
        { keys: "Ctrl + Enter", desc: t("shortcuts.insertParagraph") },
        { keys: "Shift + Alt + Down", desc: t("shortcuts.duplicateParagraph") },
        { keys: "Alt + Up", desc: t("shortcuts.moveUp") },
        { keys: "Alt + Down", desc: t("shortcuts.moveDown") },
        { keys: "Ctrl + ]", desc: t("shortcuts.increaseIndent") },
        { keys: "Ctrl + [", desc: t("shortcuts.decreaseIndent") },
        { keys: "Tab", desc: t("shortcuts.indentSelection") },
        { keys: "Shift + Tab", desc: t("shortcuts.outdentSelection") },
      ],
    },
    {
      title: t("shortcuts.autoBehaviors"),
      shortcuts: [
        { keys: "( ) [ ]", desc: t("shortcuts.autoPair") },
        { keys: "\" '", desc: t("shortcuts.smartQuote") },
        { keys: "Backspace", desc: t("shortcuts.deletePair") },
        { keys: "—", desc: t("shortcuts.lineHighlight") },
      ],
    },
    {
      title: t("shortcuts.global"),
      shortcuts: [
        { keys: "?", desc: t("shortcuts.togglePanel") },
        { keys: "Ctrl + K", desc: t("shortcuts.commandPalette") },
        { keys: "Escape", desc: t("shortcuts.close") },
        { keys: "F11", desc: t("shortcuts.focusMode") },
        { keys: "Ctrl + F", desc: t("shortcuts.findReplace") },
        { keys: "Ctrl + H", desc: t("shortcuts.replaceMode") },
      ],
    },
    {
      title: t("shortcuts.sidebarNav"),
      shortcuts: [
        { keys: "Alt + 1", desc: t("shortcuts.navManuscript") },
        { keys: "Alt + 2", desc: t("shortcuts.navOutline") },
        { keys: "Alt + 3", desc: t("shortcuts.navCodex") },
        { keys: "Alt + 4", desc: t("shortcuts.navStats") },
        { keys: "Alt + 5", desc: t("shortcuts.navSearch") },
        { keys: "Alt + 6", desc: t("shortcuts.navVolumes") },
      ],
    },
  ];
}

/**
 * 快捷键参考面板组件
 * 输入: 无
 * 输出: JSX 浮层面板（未打开时返回 null）
 * 流程:
 *   1. 监听全局 `?` 键切换面板开关，Escape 关闭
 *   2. 输入框/文本域/可编辑元素中按 `?` 不触发面板
 *   3. 监听外部 nf:open-shortcuts 事件打开面板
 *   4. 渲染五组快捷键：编辑器、段落操作、自动行为、全局、侧边栏导航
 */
export default function ShortcutPanel() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const SHORTCUTS = buildShortcuts(t);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;

      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    },
    [open]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // 监听外部打开事件:主页快捷键入口按钮派发 nf:open-shortcuts
  // 复用本面板作为"介绍页面",避免重复实现功能介绍内容
  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener("nf:open-shortcuts", handleOpen);
    return () => window.removeEventListener("nf:open-shortcuts", handleOpen);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setOpen(false);
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="nf-glass-panel w-full max-w-xl bg-nf-bg-card border border-nf-border-light shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
          <div className="flex items-center gap-2.5">
            <Keyboard className="w-4 h-4 text-fandex-primary" />
            <h2 id="shortcuts-title" className="fandex-bar-left text-lg font-bold font-display text-nf-text">
              {t("shortcuts.title")}
            </h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 hover:bg-nf-bg-hover text-nf-text-tertiary hover:text-nf-text transition duration-fast"
            aria-label={t("shortcuts.closePanel")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 max-h-[65vh] overflow-y-auto space-y-5">
          <p className="text-xs text-nf-text-tertiary leading-relaxed">
            {t("shortcuts.pressQuestionHint")}
          </p>

          {SHORTCUTS.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-semibold font-display text-nf-text-secondary uppercase tracking-wider mb-2.5">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.shortcuts.map((sc) => (
                  <div
                    key={sc.keys + sc.desc}
                    className="flex items-center justify-between py-1.5 px-2 hover:bg-nf-bg-hover transition duration-fast"
                  >
                    <span className="text-sm text-nf-text">{sc.desc}</span>
                    <div className="flex gap-1">
                      {sc.keys.split(" + ").map((k, i, arr) => (
                        <span key={i} className="flex items-center">
                          <kbd className="px-1.5 py-0.5 bg-nf-bg-hover border border-nf-border-light text-[11px] font-mono text-nf-text-secondary">
                            {k}
                          </kbd>
                          {i < arr.length - 1 && (
                            <span className="text-[10px] text-nf-text-tertiary mx-0.5">
                              +
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-3 border-t border-nf-border-light text-center">
          <span className="text-xs text-nf-text-tertiary">
            {t("shortcuts.autoShowHint")}
          </span>
        </div>
      </div>
    </div>
  );
}
