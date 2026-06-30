// TipTap 纯文本编辑器组件
//
// 功能概述：
// 基于 TipTap 的小说创作编辑器，纯文本/WYSIWYG 体验。
// 底层存储为纯文本（无 Markdown 转换层），支持基础富文本（加粗/斜体）。
// 支持自动保存、字数统计、TXT 导出、大纲视图、聚焦模式。
// 适配 FANDEX 暗黑主题。
//
// 模块职责：
// 1. 提供 TipTap 编辑器实例（基础纯文本模式）
// 2. 自动加载与保存文件内容（纯文本直读直写）
// 3. 实时统计字数
// 4. 根据项目类型加载特色扩展
// 5. 支持 TXT 导出、大纲视图、聚焦模式

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
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { readFile, writeFile } from "../lib/api";
import { useAppStore } from "../lib/store";
import { useSettingsStore } from "../lib/settingsStore";
import { CharacterMention } from "../lib/characterMention";
import { IndentParagraph } from "../lib/indentParagraph";
import { PoetryFormat } from "../lib/poetryFormat";
import { countWords } from "../lib/wordCounter";
import { addRecentFile } from "../lib/recentFiles";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import EditorToolbar from "./EditorToolbar";
import OutlineView from "./OutlineView";

interface NovelEditorProps {
  filePath: string | null;
  focusMode?: boolean;
}

export default function NovelEditor({
  filePath,
  focusMode = false,
}: NovelEditorProps) {
  const currentProject = useAppStore((s) => s.currentProject);
  const { t } = useI18n();
  const [wordCount, setWordCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [characters, setCharacters] = useState<string[]>([]);
  const { showToast } = useToast();

  const projectType = currentProject?.meta?.type || "standard";
  const isScript = projectType === "script" || projectType === "screenplay";
  const isEssay = projectType === "diary";
  const isDialogue = projectType === "dialogue";
  const autoSaveInterval = useSettingsStore((s) => s.autoSaveInterval);
  const diaryAutoDate = useSettingsStore((s) => s.diaryAutoDate);
  const [showOutline, setShowOutline] = useState(false);

  // 加载剧本/对话体角色名列表
  useEffect(() => {
    if ((!isScript && !isDialogue) || !currentProject) {
      setCharacters([]);
      return;
    }
    const rosterPath = `${currentProject.path}/角色/角色名册.txt`;
    readFile(rosterPath, currentProject.path)
      .then((content) => {
        const names = content
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(
            (line) =>
              line &&
              !line.startsWith("#") &&
              !line.startsWith(">") &&
              !line.startsWith("-") &&
              !/^[-=]{3,}$/.test(line)
          );
        setCharacters(names);
      })
      .catch(() => {
        setCharacters([]);
      });
  }, [isScript, isDialogue, currentProject]);

  // 构建 TipTap 扩展列表（纯文本 + 新增格式化扩展）
  const extensions: Extensions = useMemo(() => {
    const exts: Extensions = [
      Document,
      Paragraph,
      Text,
      Bold,
      Italic,
      Underline,
      Strike,
      Code,
      CodeBlock,
      Blockquote,
      History,
      Placeholder.configure({ placeholder: t("editor.placeholder") }),
    ];

    if (isEssay) {
      exts.push(IndentParagraph.configure({ enabled: true }));
    }

    if (isScript || isDialogue) {
      exts.push(
        CharacterMention.configure({
          characters,
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
    }

    exts.push(PoetryFormat.configure({ enabled: true }));
    return exts;
  }, [isEssay, isScript, isDialogue, characters, t]);

  // 创建编辑器实例（纯文本模式）
  const editor = useEditor({
    extensions,
    content: "",
    editorProps: {
      attributes: {
        class:
          "fandex-editor-plain prose max-w-none focus:outline-none min-h-[60vh] px-8 py-6 leading-loose text-nf-text",
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

  // 加载文件内容（纯文本直读，无 MD→HTML 转换）
  useEffect(() => {
    if (!editor || !filePath) {
      editor?.commands.clearContent();
      setWordCount(0);
      setDirty(false);
      return;
    }

    setLoadError("");
    readFile(filePath, currentProject?.path || "")
      .then((content) => {
        // 日记模式：新建空文件时自动添加当天日期
        let finalContent = content;
        if (projectType === "diary" && diaryAutoDate && content.trim() === "") {
          const today = new Date();
          const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          finalContent = `${dateStr}\n\n`;
        }

        // 纯文本转为 ProseMirror JSON 文档结构，避免 setContent 将文本当作 HTML 解析
        const lines = finalContent.split(/\r?\n/);
        const docContent = lines.map((line: string) => ({
          type: "paragraph",
          content: line ? [{ type: "text", text: line }] : [],
        }));
        editor.commands.setContent({
          type: "doc",
          content: docContent.length > 0 ? docContent : [{ type: "paragraph" }],
        });
        setDirty(false);
        lastSavedContentRef.current = finalContent;
        setWordCount(countWords(editor.getText()));
        // 记录最近文件
        const relativePath = filePath.replace(
          (currentProject?.path || "") + "/",
          ""
        );
        const fileName = relativePath.split(/[\\/]/).pop() || relativePath;
        addRecentFile({
          name: fileName,
          relative_path: relativePath,
          project_name: currentProject?.meta?.name || "",
          project_path: currentProject?.path || "",
        });
      })
      .catch((e) => {
        setLoadError(t("editor.loadFailed", { error: String(e) }));
      });
  }, [filePath, editor, currentProject, t, projectType, diaryAutoDate]);

  // 保存文件（纯文本直写，无 HTML→MD 转换；含竞态保护）
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const lastSavedContentRef = useRef("");
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!editor || !filePath || !dirty) return false;
    // 竞态保护：如果正在保存，标记待保存但不阻塞
    if (savingRef.current) {
      pendingSaveRef.current = true;
      return false;
    }
    savingRef.current = true;
    pendingSaveRef.current = false;
    setSaving(true);
    try {
      // 冲突检测：读取当前磁盘内容与上次保存内容比较
      try {
        const currentContent = await readFile(filePath, currentProject?.path || "");
        if (
          lastSavedContentRef.current &&
          currentContent !== lastSavedContentRef.current
        ) {
          showToast(
            "warning",
            t("editor.conflictDetected")
          );
          // 不阻塞保存，但提示用户存在冲突
        }
      } catch {
        // 文件可能不存在，跳过冲突检测
      }

      const text = editor.getText();
      await writeFile(filePath, text, currentProject?.path || "");
      lastSavedContentRef.current = text;
      setDirty(false);
      useAppStore.getState().setEditorDirty(false);
      showToast("success", t("editor.saved"));
      useAppStore.getState().refreshProjectTree();
      return true;
    } catch (e) {
      showToast("error", t("editor.saveFailed", { error: String(e) }));
      // 保存失败保留 dirty 状态以便重试
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
      // 处理排队的保存请求
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        setTimeout(() => handleSave(), 100);
      }
    }
  }, [editor, filePath, dirty, showToast, t, currentProject]);

  // 导出 TXT
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

  // Ctrl+S 快捷键 & Ctrl+Q 快速加引号
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      // Ctrl+Q 快速加引号""
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
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, editor]);

  // 自动保存: 使用用户设置的间隔（0=禁用）
  useEffect(() => {
    if (!filePath || !dirty || autoSaveInterval === 0) return;
    const timer = setTimeout(() => {
      if (!savingRef.current) {
        handleSave();
      }
    }, autoSaveInterval * 1000);
    return () => clearTimeout(timer);
  }, [filePath, dirty, handleSave, autoSaveInterval]);

  // 注册/注销编辑器保存回调
  useEffect(() => {
    if (handleSave) {
      useAppStore.getState().registerEditorSave(handleSave);
    }
    return () => {
      useAppStore.getState().registerEditorSave(null);
    };
  }, [handleSave]);

  // 卸载时销毁编辑器
  const editorRef = useRef(editor);
  editorRef.current = editor;
  useEffect(() => {
    return () => {
      editorRef.current?.destroy();
    };
  }, []);

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
                <kbd className="px-1 py-0.5 bg-nf-bg-hover border border-nf-border-light rounded text-[10px] font-mono text-nf-text-secondary">Ctrl+K</kbd>
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
        showOutline={showOutline}
        onToggleOutline={() => setShowOutline((prev) => !prev)}
      />

      {isScript && characters.length > 0 && (
        <div className="fandex-admonition fandex-admonition-note px-4 py-1.5 border-b border-nf-border-light text-xs text-nf-text-tertiary flex items-center gap-2">
          <span className="text-fandex-primary font-medium">{t("editor.scriptMode")}</span>
          <span>·</span>
          <span>
            {t("editor.charRosterHint", { count: characters.length })}
          </span>
        </div>
      )}

      {isEssay && (
        <div className="fandex-admonition fandex-admonition-tip px-4 py-1.5 border-b border-nf-border-light text-xs text-nf-text-tertiary flex items-center gap-2">
          <span className="text-fandex-secondary font-medium">{t("editor.essayMode")}</span>
          <span>·</span>
          <span>{t("editor.essayHint")}</span>
        </div>
      )}

      {isDialogue && characters.length > 0 && (
        <div className="fandex-admonition fandex-admonition-note px-4 py-1.5 border-b border-nf-border-light text-xs text-nf-text-tertiary flex items-center gap-2">
          <span className="text-fandex-primary font-medium">{t("editor.dialogueMode")}</span>
          <span>·</span>
          <span>
            {t("editor.dialogueCharHint")}
          </span>
          <span>·</span>
          <span>
            {t("editor.charRosterHint", { count: characters.length })}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto relative">
        <EditorContent editor={editor} />
        {showOutline && editor && (
          <OutlineView htmlContent={editor.getText()} />
        )}
      </div>
    </div>
  );
}
