// TipTap 富文本编辑器组件
//
// 功能概述：
// 基于 TipTap 的小说创作编辑器，支持富文本编辑、自动保存、
// 字数统计、特色自动化功能（剧本角色名/散文缩进/诗歌排版）、
// TXT 导出、大纲视图、聚焦模式。适配 FANDEX 暗黑主题。
//
// 模块职责：
// 1. 提供 TipTap 编辑器实例
// 2. 自动加载与保存文件内容
// 3. 实时统计字数
// 4. 根据项目类型加载特色扩展
// 5. 支持 TXT 导出、大纲视图、聚焦模式

import { useEditor, EditorContent } from "@tiptap/react";
import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { readFile, writeFile } from "../lib/api";
import { useAppStore } from "../lib/store";
import { CharacterMention } from "../lib/characterMention";
import { IndentParagraph } from "../lib/indentParagraph";
import { PoetryFormat } from "../lib/poetryFormat";
import { markdownToHtml, htmlToMarkdown } from "../lib/markdownConverter";
import { countWords } from "../lib/wordCounter";
import { addRecentFile } from "../lib/recentFiles";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import EditorToolbar from "./EditorToolbar";
import OutlineView from "./OutlineView";

interface NovelEditorProps {
  filePath: string | null;
  focusMode?: boolean;
  focusTimerActive?: boolean;
}

export default function NovelEditor({
  filePath,
  focusMode = false,
  focusTimerActive = false,
}: NovelEditorProps) {
  const { currentProject } = useAppStore();
  const { t } = useI18n();
  const [wordCount, setWordCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [characters, setCharacters] = useState<string[]>([]);
  const [editorHtml, setEditorHtml] = useState("");
  const { showToast } = useToast();

  const projectType = currentProject?.meta?.type || "standard";
  const isScript = projectType === "script";
  const isEssay = projectType === "essay";

  // 加载剧本角色名列表
  useEffect(() => {
    if (!isScript || !currentProject) {
      setCharacters([]);
      return;
    }
    const rosterPath = `${currentProject.path}\\角色\\角色名册.md`;
    readFile(rosterPath)
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
  }, [isScript, currentProject]);

  // 构建 TipTap 扩展列表
  const extensions: Extensions = useMemo(() => {
    const exts: Extensions = [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: t("editor.placeholder") }),
    ];

    if (isEssay) {
      exts.push(IndentParagraph.configure({ enabled: true }));
    }

    if (isScript) {
      exts.push(
        CharacterMention.configure({
          characters,
          onSelect: () => {},
        })
      );
    }

    exts.push(PoetryFormat.configure({ enabled: true }));
    return exts;
  }, [isEssay, isScript, characters, t]);

  // 创建编辑器实例
  const editor = useEditor({
    extensions,
    content: "",
    editorProps: {
      attributes: {
        class:
          "prose prose-invert max-w-none focus:outline-none min-h-[60vh] px-8 py-6 leading-loose",
      },
    },
    onUpdate: () => {
      setDirty(true);
      useAppStore.getState().setEditorDirty(true);
      if (editor) {
        const wc = countWords(editor.getText());
        setWordCount(wc);
        setEditorHtml(editor.getHTML());
        // 实时推送字数到 store，供 FileList 侧边栏展示
        useAppStore.getState().setActiveFileWordCount(wc);
      }
    },
  });

  // 加载文件内容
  useEffect(() => {
    if (!editor || !filePath) {
      editor?.commands.clearContent();
      setWordCount(0);
      setDirty(false);
      setEditorHtml("");
      return;
    }

    setLoadError("");
    readFile(filePath)
      .then((content) => {
        editor.commands.setContent(markdownToHtml(content));
        setDirty(false);
        setWordCount(countWords(editor.getText()));
        setEditorHtml(editor.getHTML());
        // 记录最近文件
        const relativePath = filePath.replace(currentProject?.path + "\\" || "", "");
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
  }, [filePath, editor, currentProject, t]);

  // 保存文件（含外部修改冲突检测）
  // 返回 true 表示保存成功，false 表示失败（供退出流程使用）
  const lastSavedContentRef = useRef("");
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!editor || !filePath || !dirty || saving) return false;
    setSaving(true);
    autoSavePendingRef.current = true;
    try {
      try {
        const currentContent = await readFile(filePath);
        if (
          lastSavedContentRef.current &&
          currentContent !== lastSavedContentRef.current
        ) {
          const overwrite = confirm(t("editor.conflictDetected"));
          if (!overwrite) {
            showToast("warning", t("editor.conflictCancelled"));
            return false;
          }
        }
      } catch {
        // 文件可能不存在，跳过冲突检测
      }

      const markdown = htmlToMarkdown(editor.getHTML());
      await writeFile(filePath, markdown);
      lastSavedContentRef.current = markdown;
      setDirty(false);
      useAppStore.getState().setEditorDirty(false);
      showToast("success", t("editor.saved"));
      // 保存后刷新目录树，更新侧边栏文件大小等元数据
      useAppStore.getState().refreshProjectTree();
      return true;
    } catch (e) {
      showToast("error", t("editor.saveFailed", { error: String(e) }));
      return false;
    } finally {
      setSaving(false);
      autoSavePendingRef.current = false;
    }
  }, [editor, filePath, dirty, saving, showToast, t]);

  // 初始化 lastSavedContent
  useEffect(() => {
    if (editor && filePath) {
      readFile(filePath)
        .then((content) => {
          lastSavedContentRef.current = content;
        })
        .catch(() => {});
    }
  }, [editor, filePath]);

  // 导出 TXT
  const handleExportTxt = useCallback(async () => {
    if (!editor) return;
    try {
      const text = editor.getText();
      let txtName = t("editor.defaultExportName");
      if (filePath) {
        const baseName = filePath.split(/[\\/]/).pop() || "export";
        txtName = baseName.replace(/\.(md|markdown|txt)$/i, "") + ".txt";
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

  // Ctrl+S 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  // 自动保存: 30 秒
  const autoSavePendingRef = useRef(false);
  useEffect(() => {
    if (!filePath || !dirty) return;
    const timer = setTimeout(() => {
      if (!autoSavePendingRef.current) {
        handleSave();
      }
    }, 30000);
    return () => clearTimeout(timer);
  }, [filePath, dirty, handleSave]);

  // 注册/注销编辑器保存回调（供退出流程使用）
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
      {/* 聚焦模式下简化工具栏 */}
      <EditorToolbar
        editor={editor}
        wordCount={wordCount}
        dirty={dirty}
        saving={saving}
        onSave={handleSave}
        onExportTxt={handleExportTxt}
        focusMode={focusMode}
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

      <div className="flex-1 overflow-y-auto relative">
        <EditorContent editor={editor} />
        {/* 大纲视图 — 编辑器右侧覆盖 */}
        {filePath && <OutlineView htmlContent={editorHtml} />}
      </div>
    </div>
  );
}
