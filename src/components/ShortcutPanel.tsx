// 快捷键参考面板
//
// 功能概述：
// 按 `?` 键弹出快捷键参考面板，展示所有可用快捷键及其功能描述。
// 采用 FANDEX 直角美学，分类展示编辑器、全局、侧边栏快捷键。

import { useEffect, useState, useCallback } from "react";
import { X, Keyboard } from "lucide-react";
import { useI18n } from "../lib/i18n";

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string; desc: string }[];
}

function buildShortcuts(t: (key: string) => string): ShortcutGroup[] {
  return [
    {
      title: t("shortcuts.editor"),
      shortcuts: [
        { keys: "Ctrl + B", desc: t("shortcuts.bold") },
        { keys: "Ctrl + I", desc: t("shortcuts.italic") },
        { keys: "Ctrl + U", desc: t("shortcuts.underline") },
        { keys: "Ctrl + 1", desc: t("shortcuts.heading1") },
        { keys: "Ctrl + 2", desc: t("shortcuts.heading2") },
        { keys: "Ctrl + Shift + P", desc: t("shortcuts.poetryFormat") },
        { keys: "Ctrl + Shift + L", desc: t("shortcuts.lyricsFormat") },
        { keys: "Ctrl + Z", desc: t("shortcuts.undo") },
        { keys: "Ctrl + Shift + Z", desc: t("shortcuts.redo") },
        { keys: "Ctrl + S", desc: t("shortcuts.save") },
        { keys: "Tab", desc: t("shortcuts.scriptMode") },
      ],
    },
    {
      title: t("shortcuts.global"),
      shortcuts: [
        { keys: "?", desc: t("shortcuts.togglePanel") },
        { keys: "Ctrl + K", desc: t("shortcuts.commandPalette") },
        { keys: "Ctrl + Shift + F", desc: t("shortcuts.globalSearch") },
        { keys: "Escape", desc: t("shortcuts.close") },
        { keys: "F11", desc: t("shortcuts.focusMode") },
      ],
    },
    {
      title: t("shortcuts.sidebarNav"),
      shortcuts: [
        { keys: "Alt + 1", desc: t("shortcuts.navManuscript") },
        { keys: "Alt + 2", desc: t("shortcuts.navOutline") },
        { keys: "Alt + 3", desc: t("shortcuts.navCharacters") },
        { keys: "Alt + 4", desc: t("shortcuts.navWorldview") },
        { keys: "Alt + 5", desc: t("shortcuts.navGlossary") },
        { keys: "Alt + 6", desc: t("shortcuts.navMaterials") },
        { keys: "Alt + 7", desc: t("shortcuts.navTimeline") },
        { keys: "Alt + 8", desc: t("shortcuts.navStats") },
      ],
    },
  ];
}

const STORAGE_KEY = "novelforge-shortcuts-seen";

export default function ShortcutPanel() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const SHORTCUTS = buildShortcuts(t);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen && typeof window !== "undefined") {
      const timer = setTimeout(() => {
        setOpen(true);
        localStorage.setItem(STORAGE_KEY, "1");
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-nf-bg-card border border-nf-border-light shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
          <div className="flex items-center gap-2.5">
            <Keyboard className="w-4 h-4 text-fandex-primary" />
            <h2 className="fandex-bar-left text-lg font-bold font-display text-nf-text">
              {t("shortcuts.title")}
            </h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 hover:bg-nf-bg-hover text-nf-text-tertiary hover:text-nf-text transition-fast"
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
                    className="flex items-center justify-between py-1.5 px-2 hover:bg-nf-bg-hover transition-fast"
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
