// TipTap 富文本编辑器组件（Office 级）
//
// 功能概述：
// 基于 TipTap 的小说创作编辑器，提供 Office 级富文本编辑体验。
// 支持标题层级、有序/无序列表、任务列表、链接、高亮、文本对齐、
// 字体颜色、上下标、水平分割线、硬换行等完整富文本能力。
// 底层存储采用 HTML 格式（持久化富文本格式），向后兼容纯文本 .txt 文件。
// 支持自动保存、字数统计、TXT 导出、大纲视图、聚焦模式、版本快照、
// 查找替换、角色悬停卡片。
//
// 模块职责（重构后仅保留编排，逻辑下沉至 hooks）：
// 1. 构建 TipTap 扩展列表并创建编辑器实例
// 2. 调用 useEntityHighlightAutomaton 构建实体高亮 AC 自动机
// 3. 调用 useEditorFileIO 管理文件加载/保存
// 4. 调用 useEditorAutoSave 管理自动保存定时器
// 5. 调用 useEditorMention 管理角色提及/悬停/右键菜单
// 6. 调用 useEditorAiCommands 管理 AI 命令组装
// 7. 保留：renameQueue 联动、TXT 导出、全局快捷键、焦点常驻

import { useEditor, EditorContent } from "@tiptap/react";
import type { Extensions } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import History from "@tiptap/extension-history";
import Underline from "@tiptap/extension-underline";
import Strike from "@tiptap/extension-strike";
import Code from "@tiptap/extension-code";
import CodeBlock from "@tiptap/extension-code-block";
import Blockquote from "@tiptap/extension-blockquote";
import Placeholder from "@tiptap/extension-placeholder";
import Heading from "@tiptap/extension-heading";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import ListItem from "@tiptap/extension-list-item";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Typography from "@tiptap/extension-typography";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import HardBreak from "@tiptap/extension-hard-break";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAppStore } from "../lib/store";
import { useCodexStore } from "../lib/stores/useCodexStore";
import { useSettingsStore } from "../lib/settingsStore";
import { usePreferencesStore } from "../lib/preferencesSlice";
import { CharacterMention, CharacterMentionNode } from "../lib/characterMention";
import { IndentParagraph } from "../lib/indentParagraph";
import { PoetryFormat } from "../lib/poetryFormat";
import { VSShortcuts } from "../lib/vscodeShortcuts";
import { AutoPair } from "../lib/autoPair";
import { LineHighlight } from "../lib/lineHighlight";
import { SmartTab } from "../lib/smartTab";
import { FontSizeShortcut } from "../lib/fontSizeShortcut";
import { EntityHighlight } from "../lib/entityHighlightPlugin";
import { countWords } from "../lib/wordCounter";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import { isScriptType, isEssayType } from "../lib/projectType";
import { useWritingSession } from "../hooks/useWritingSession";
import { useEntityHighlightAutomaton } from "../hooks/useEntityHighlightAutomaton";
import { useEditorFileIO } from "../hooks/useEditorFileIO";
import { useEditorAutoSave } from "../hooks/useEditorAutoSave";
import { useEditorMention } from "../hooks/useEditorMention";
import { useEditorAiCommands } from "../hooks/useEditorAiCommands";
import EditorToolbar from "./EditorToolbar";
import EditorBubbleMenu from "./EditorBubbleMenu";
import SnapshotHistory from "./SnapshotHistory";
import CharacterHoverCard from "./CharacterHoverCard";
import FindReplace from "./FindReplace";
import AiAssistantPanel from "./AiAssistantPanel";
import EditorContextMenu from "./editor/EditorContextMenu";

interface NovelEditorProps {
  filePath: string | null;
  focusMode?: boolean;
}

/**
 * TipTap 富文本编辑器组件（Office 级）
 * 输入:
 *   filePath 当前打开的文件路径（null 时显示空状态）
 *   focusMode 是否启用聚焦模式（隐藏工具栏装饰）
 * 输出: JSX 编辑器界面（工具栏 + 编辑区 + 可选大纲视图）
 * 核心流程:
 *   1. 构建 TipTap 扩展列表并创建编辑器实例
 *   2. 通过 hooks 编排文件 IO / 自动保存 / 提及 / AI 命令 / 实体高亮
 *   3. 保留 renameQueue 联动、TXT 导出、全局快捷键、焦点常驻
 */
export default function NovelEditor({
  filePath,
  focusMode = false,
}: NovelEditorProps) {
  const currentProject = useAppStore((s) => s.currentProject);
  const { t } = useI18n();
  const { showToast } = useToast();

  // ===== 全局状态订阅 =====
  const codexCards = useCodexStore((s) => s.cards);
  const codexLoaded = useCodexStore((s) => s.loaded);
  const loadAllCodex = useCodexStore((s) => s.loadAll);
  // getByType selector 引用（稳定标识，用于派生 character 类型卡片）
  const getCodexByType = useCodexStore((s) => s.getByType);
  const autoSaveInterval = useSettingsStore((s) => s.autoSaveInterval);
  const indentEnabled = useSettingsStore((s) => s.indentEnabled);
  const indentWidth = useSettingsStore((s) => s.indentWidth);
  const snapshotEnabled = useSettingsStore((s) => s.snapshotEnabled);
  const snapshotMinInterval = useSettingsStore((s) => s.snapshotMinInterval);
  const editorPrefs = usePreferencesStore((s) => s.preferences);

  // ===== 派生状态 =====
  const projectType = currentProject?.meta?.projectType || "novel";
  const isScript = isScriptType(projectType);
  const isEssay = isEssayType(projectType);
  // 角色名列表：通过 useCodexStore.getByType('character') selector 派生（SSOT）
  // 派生计算下沉至 store，组件仅订阅 cards 触发依赖更新
  const characters = useMemo<string[]>(() => {
    return getCodexByType("character")
      .map((card) => card.name)
      .filter(Boolean);
  }, [getCodexByType, codexCards]);

  // ===== UI 状态 =====
  const [wordCount, setWordCount] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [showSnapshotHistory, setShowSnapshotHistory] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findReplaceMode, setFindReplaceMode] = useState<"find" | "replace">("find");
  const [reloadKey, setReloadKey] = useState(0);

  // 写作会话追踪：记录本次会话字数、时长、WPM
  const session = useWritingSession(wordCount, filePath);

  // ===== 实体高亮 AC 自动机（项目切换时构建） =====
  useEntityHighlightAutomaton(currentProject);

  // ===== 构建 TipTap 扩展列表（Office 级富文本模式） =====
  const extensions: Extensions = useMemo(() => {
    const exts: Extensions = [
      Document, Paragraph, Text,
      Bold, Italic, Underline, Strike, Code,
      CodeBlock, Blockquote,
      Heading.configure({ levels: [1, 2, 3, 4] }),
      BulletList, OrderedList, ListItem,
      TaskList, TaskItem.configure({ nested: true }),
      Link.configure({
        openOnClick: false, autolink: true,
        HTMLAttributes: { class: "nf-link", rel: "noopener noreferrer" },
      }),
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle, Color, Typography,
      HorizontalRule, HardBreak,
      Subscript, Superscript,
      History,
      Placeholder.configure({ placeholder: t("editor.placeholder") }),
      VSShortcuts.configure({ enabled: true }),
      AutoPair.configure({ enabled: true }),
      LineHighlight.configure({ enabled: true, className: "current-paragraph" }),
      SmartTab.configure({ enabled: true, indentChar: "\u3000" }),
      FontSizeShortcut.configure({ enabled: true }),
    ];

    // 首行缩进：所有文体全量注册，由全局开关控制行为
    const autoIndentEnabled = indentEnabled && editorPrefs.enableAutoIndent;
    exts.push(IndentParagraph.configure({ enabled: autoIndentEnabled, indentWidth }));

    // 角色名补全：所有文体全量注册，由全局开关控制行为
    // zundo 协调策略：characterMention 插入产生的文档变更由 ProseMirror History 处理，
    // zundo temporal 仅管理全局状态。两者作用域分离，无需 pause/resume。
    exts.push(
      CharacterMention.configure({
        characters,
        enabled: editorPrefs.enableCharacterMentionPicker,
        onSelect: () => {},
        labels: {
          pickerAriaLabel: t("editor.charRosterHint", { count: characters.length }),
          listboxAriaLabel: t("editor.charRosterHint", { count: characters.length }),
          customInputAriaLabel: t("characterMention.placeholder"),
          customInputPlaceholder: t("characterMention.placeholder"),
          hintText: "Tab ↵ | ↑↓ | Esc",
        },
      })
    );

    // 角色提及 inline Node：存储 characterId（UUID）+ name，与设定库 CodexMeta.id 关联
    exts.push(
      CharacterMentionNode.configure({
        HTMLAttributes: { class: "nf-character-mention" },
        editable: false,
      })
    );

    // 实体高亮：Web Worker Aho-Corasick 自动机匹配实体名/别名
    exts.push(
      EntityHighlight.configure({
        enabled: editorPrefs.enableEntityHighlight,
        filePath: filePath || "",
      })
    );

    // 诗歌排版：所有文体全量注册，由全局开关控制行为
    exts.push(PoetryFormat.configure({ enabled: editorPrefs.enablePoetryFormat }));

    return exts;
  }, [characters, t, indentEnabled, indentWidth, editorPrefs, filePath, editorPrefs.enableEntityHighlight]);

  // ===== 创建编辑器实例 =====
  const editor = useEditor({
    extensions,
    content: "",
    editorProps: {
      attributes: {
        class:
          "fandex-editor-rich prose max-w-none focus:outline-none min-h-[60vh] px-8 py-6 leading-loose text-nf-text",
      },
    },
    onUpdate: () => {
      setDirty(true);
      useAppStore.getState().setEditorDirty(true);
      if (editor) {
        const wc = countWords(editor.getText());
        setWordCount(wc);
        useAppStore.getState().setActiveFileWordCount(wc);
      }
    },
  });

  // ===== 文件 IO（加载/保存/快照/索引） =====
  const { saving, handleSave, savingRef } = useEditorFileIO({
    editor,
    filePath,
    currentProject,
    reloadKey,
    dirty,
    setDirty,
    setWordCount,
    setLoadError,
    snapshotEnabled,
    snapshotMinInterval,
    showToast,
    t,
  });

  // ===== 自动保存定时器 =====
  useEditorAutoSave({
    filePath,
    dirty,
    autoSaveInterval,
    handleSave,
    savingRef,
  });

  // ===== 角色提及/悬停/右键菜单 =====
  const {
    hoverCard,
    mentionContextMenu,
    handleMentionViewInCodex,
    handleMentionEditInCodex,
    handleMentionCopyName,
  } = useEditorMention({
    editor,
    characters,
    showToast,
    t,
  });

  // ===== AI 命令组装 =====
  const {
    showAiPanel,
    setShowAiPanel,
    pendingAiInstruction,
    setPendingAiInstruction,
    pendingAiCharacterId,
    pendingAiSelectedText,
    pendingAiTaskType,
    clearPendingAiTask,
    handleAiCommand,
    handleCharacterAiAction,
  } = useEditorAiCommands({ editor });

  // ===== Codex 数据加载（项目切换时触发） =====
  useEffect(() => {
    if (!currentProject) return;
    if (codexLoaded) return;
    let cancelled = false;
    loadAllCodex(currentProject.path).catch((err) => {
      if (!cancelled) {
        showToast("error", t("editor.codexLoadFailed", { error: String(err) }));
      }
    });
    return () => { cancelled = true; };
  }, [currentProject, codexLoaded, loadAllCodex, showToast, t]);

  // ===== renameQueue 联动：设定库改名时同步正文中的 characterMentionNode =====
  const renameQueue = useCodexStore((s) => s.renameQueue);
  const consumeRenameQueue = useCodexStore((s) => s.consumeRenameQueue);
  useEffect(() => {
    if (!editor || editor.isDestroyed || renameQueue.length === 0) return;
    for (const entry of renameQueue) {
      editor.commands.updateCharacterMentionName(entry.cardId, entry.newName);
    }
    consumeRenameQueue();
    setDirty(true);
    useAppStore.getState().setEditorDirty(true);
  }, [renameQueue, editor, consumeRenameQueue]);

  // ===== TXT 导出 =====
  const handleExportTxt = useCallback(async () => {
    if (!editor) return;
    try {
      const text = editor.getText();
      let txtName = t("editor.defaultExportName");
      if (filePath) {
        const baseName = filePath.split(/[\\/]/).pop() || "export";
        txtName = baseName.replace(/\.txt$/i, "") + ".txt";
      }
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = txtName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("success", t("editor.exported", { name: txtName }));
    } catch (e) {
      showToast("error", t("editor.exportFailed", { error: String(e) }));
    }
  }, [editor, filePath, showToast, t]);

  // ===== 全局快捷键：Ctrl+S/Q/F/H/Shift+A / Esc =====
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "q" || e.key === "Q")) {
        e.preventDefault();
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
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setFindReplaceMode("find");
        setShowFindReplace(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "h") {
        e.preventDefault();
        setFindReplaceMode("replace");
        setShowFindReplace(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        setShowAiPanel((prev) => !prev);
      }
      if (e.key === "Escape" && showFindReplace) {
        setShowFindReplace(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, editor, showFindReplace, setShowAiPanel]);

  // ===== 卸载时销毁编辑器 =====
  const editorRef = useRef(editor);
  editorRef.current = editor;
  useEffect(() => {
    return () => {
      editorRef.current?.destroy();
    };
  }, []);

  // ===== 焦点常驻：关闭浮层后恢复编辑器焦点 =====
  useEffect(() => {
    if (showFindReplace || showSnapshotHistory) return;
    if (!editor || editor.isDestroyed) return;
    const id = window.setTimeout(() => {
      if (!editor.isDestroyed) {
        editor.commands.focus();
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [showFindReplace, showSnapshotHistory, editor]);

  // ===== 焦点常驻：Tauri 窗口重新获焦时恢复编辑器焦点 =====
  useEffect(() => {
    const handleWindowFocus = () => {
      if (!editor || editor.isDestroyed) return;
      if (showFindReplace || showSnapshotHistory) return;
      const active = document.activeElement;
      if (active && editor.view.dom.contains(active)) return;
      editor.commands.focus();
    };
    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, [editor, showFindReplace, showSnapshotHistory]);

  // ===== 焦点常驻：编辑器挂载后立即获焦 =====
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const id = window.setTimeout(() => {
      if (!editor.isDestroyed) {
        editor.commands.focus();
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [editor]);

  // ===== 渲染 =====
  if (!filePath) {
    return (
      <div className="flex-1 flex items-center justify-center bg-nf-bg">
        <div className="text-center space-y-3" role="status">
          <p className="text-sm text-nf-text-tertiary">
            {t("editor.selectFile")}
          </p>
          <p className="text-xs text-nf-text-tertiary/60">
            {t("editor.commandPaletteHint").split("Ctrl+K").length === 2 ? (
              <>
                {t("editor.commandPaletteHint").split("Ctrl+K")[0]}
                <kbd className="px-1 py-0.5 bg-nf-bg-hover border border-nf-border-light text-[10px] font-mono text-nf-text-secondary">Ctrl+K</kbd>
                {t("editor.commandPaletteHint").split("Ctrl+K")[1]}
              </>
            ) : t("editor.commandPaletteHint")}
          </p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-nf-bg" role="alert">
        <div className="text-center text-red-400 text-sm">{loadError}</div>
      </div>
    );
  }

  return (
    <div
      className={`flex-1 flex flex-col bg-nf-bg overflow-hidden ${focusMode ? "fandex-focus-mode" : ""}`}
      role="region"
      aria-label={`${t("editor.editor")} - ${filePath ? filePath.split(/[\\/]/).pop() : ""}`}
    >
      <EditorToolbar
        editor={editor}
        wordCount={wordCount}
        dirty={dirty}
        saving={saving}
        onSave={handleSave}
        onExportTxt={handleExportTxt}
        focusMode={focusMode}
        sessionWords={session.sessionWords}
        sessionDuration={session.sessionDuration}
        wpm={session.wpm}
        wordTarget={session.wordTarget}
        progress={session.progress}
        sessionPaused={session.paused}
        sessionStartedAt={session.startedAt}
        onToggleSessionPause={session.togglePause}
        onSetSessionTarget={session.updateWordTarget}
        onResetSession={session.resetSession}
        showSnapshotHistory={showSnapshotHistory}
        onToggleSnapshotHistory={() => setShowSnapshotHistory((prev) => !prev)}
        showFindReplace={showFindReplace}
        onToggleFindReplace={() => setShowFindReplace((prev) => !prev)}
        showAiPanel={showAiPanel}
        onToggleAiPanel={() => setShowAiPanel((prev) => !prev)}
      />

      {isScript && characters.length > 0 && (
        <div className="fandex-admonition fandex-admonition-note px-4 py-1.5 border-b border-nf-border-light text-xs text-nf-text-tertiary flex items-center gap-2">
          <span className="text-fandex-primary font-medium">{t("editor.scriptMode")}</span>
          <span>·</span>
          <span>{t("editor.charRosterHint", { count: characters.length })}</span>
        </div>
      )}

      {isEssay && (
        <div className="fandex-admonition fandex-admonition-tip px-4 py-1.5 border-b border-nf-border-light text-xs text-nf-text-tertiary flex items-center gap-2">
          <span className="text-fandex-secondary font-medium">{t("editor.essayMode")}</span>
          <span>·</span>
          <span>{t("editor.essayHint")}</span>
        </div>
      )}

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto relative">
          <EditorContent editor={editor} />
          {editor && <EditorBubbleMenu editor={editor} onAiCommand={handleAiCommand} />}
          {showFindReplace && editor && (
            <FindReplace
              editor={editor}
              mode={findReplaceMode}
              onClose={() => setShowFindReplace(false)}
              onModeChange={setFindReplaceMode}
            />
          )}
        </div>
        {showSnapshotHistory && filePath && currentProject?.path && (
          <SnapshotHistory
            filePath={filePath}
            projectPath={currentProject.path}
            currentContent={editor ? JSON.stringify(editor.getJSON()) : ""}
            onClose={() => setShowSnapshotHistory(false)}
            onRestored={() => setReloadKey((n) => n + 1)}
          />
        )}
      </div>

      <CharacterHoverCard
        open={hoverCard.open}
        x={hoverCard.x}
        y={hoverCard.y}
        characterName={hoverCard.name}
        projectPath={currentProject?.path || ""}
        characterId={hoverCard.characterId}
        onAiAction={handleCharacterAiAction}
      />

      <EditorContextMenu
        menu={mentionContextMenu}
        onView={handleMentionViewInCodex}
        onEdit={handleMentionEditInCodex}
        onCopy={handleMentionCopyName}
        t={t}
      />

      <AiAssistantPanel
        open={showAiPanel}
        onClose={() => setShowAiPanel(false)}
        editor={editor}
        projectPath={currentProject?.path || ""}
        filePath={filePath}
        pendingInstruction={pendingAiInstruction}
        onPendingInstructionConsumed={() => setPendingAiInstruction(null)}
        pendingCharacterId={pendingAiCharacterId}
        pendingSelectedText={pendingAiSelectedText}
        pendingTaskType={pendingAiTaskType}
        onPendingTaskConsumed={clearPendingAiTask}
      />
    </div>
  );
}
