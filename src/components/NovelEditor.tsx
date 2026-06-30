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
import { readFile, writeFile, readProjectTree, createSnapshot } from "../lib/api";
import { useAppStore } from "../lib/store";
import { useSettingsStore } from "../lib/settingsStore";
import { CharacterMention } from "../lib/characterMention";
import { IndentParagraph } from "../lib/indentParagraph";
import { PoetryFormat } from "../lib/poetryFormat";
import { VSShortcuts } from "../lib/vscodeShortcuts";
import { AutoPair } from "../lib/autoPair";
import { LineHighlight } from "../lib/lineHighlight";
import { SmartTab } from "../lib/smartTab";
import { TypewriterMode } from "../lib/typewriterMode";
import { FocusDim } from "../lib/focusDim";
import { countWords } from "../lib/wordCounter";
import { addRecentFile } from "../lib/recentFiles";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import { useWritingSession } from "../hooks/useWritingSession";
import EditorToolbar from "./EditorToolbar";
import OutlineView from "./OutlineView";
import SnapshotHistory from "./SnapshotHistory";

interface NovelEditorProps {
  filePath: string | null;
  focusMode?: boolean;
}

/**
 * 验证字符串是否为有效的角色名
 * 输入: name 待验证的字符串
 * 输出: boolean 是否有效
 * 流程:
 *   1. 非空且长度 <= 20
 *   2. 不包含冒号（:或：）—— 排除字段行如"姓名:张三"
 *   3. 不以常见标签词开头（角色/姓名/声线/外貌/性格/背景等）
 *   4. 不全是数字或纯符号
 */
function isValidCharacterName(name: string): boolean {
  if (!name || name.length === 0 || name.length > 20) return false;
  // 包含冒号的行视为字段而非角色名
  if (name.includes(":") || name.includes("：")) return false;
  // 以常见标签词开头的行视为字段标签
  const labelPrefixes = ["角色", "姓名", "声线", "外貌", "性格", "背景", "动机", "关系", "语言", "口头禅"];
  for (const prefix of labelPrefixes) {
    if (name.startsWith(prefix)) return false;
  }
  // 不允许纯数字或纯符号
  if (/^[\d\s\p{P}]+$/u.test(name)) return false;
  return true;
}

/**
 * TipTap 纯文本编辑器组件
 * 输入:
 *   filePath 当前打开的文件路径（null 时显示空状态）
 *   focusMode 是否启用聚焦模式（隐藏工具栏装饰）
 * 输出: JSX 编辑器界面（工具栏 + 编辑区 + 可选大纲视图）
 * 流程:
 *   1. 根据 projectType 判断文体（剧本/对话/散文）并构建扩展列表
 *   2. 扫描角色目录提取角色名（剧本/对话体用于 CharacterMention）
 *   3. 加载文件内容：纯文本直读，转 ProseMirror JSON 结构
 *   4. 自动保存：基于 dirty 状态与用户设置的间隔触发
 *   5. 冲突检测：保存前比对磁盘内容与上次保存内容
 *   6. 导出 TXT：Blob 下载，文件名沿用原文件名
 */
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
  const isDialogue = projectType === "dialogue";
  // 散文类文体：包含标准长篇、短篇、日记、分卷、同世界观、诗歌等
  // 剧本式与对话体不启用首行缩进（它们有专属的格式化逻辑）
  const isProse = !isScript && !isDialogue;
  // 兼容旧代码：日记体仍保留 isEssay 标识用于日期自动填充等场景
  const isEssay = projectType === "diary";
  const autoSaveInterval = useSettingsStore((s) => s.autoSaveInterval);
  const diaryAutoDate = useSettingsStore((s) => s.diaryAutoDate);
  const indentEnabled = useSettingsStore((s) => s.indentEnabled);
  const indentWidth = useSettingsStore((s) => s.indentWidth);
  const typewriterMode = useSettingsStore((s) => s.typewriterMode);
  const focusDim = useSettingsStore((s) => s.focusDim);
  const focusDimOpacity = useSettingsStore((s) => s.focusDimOpacity);
  const snapshotEnabled = useSettingsStore((s) => s.snapshotEnabled);
  const snapshotMinInterval = useSettingsStore((s) => s.snapshotMinInterval);
  const [showOutline, setShowOutline] = useState(false);
  const [showSnapshotHistory, setShowSnapshotHistory] = useState(false);
  // 文件重载触发器：恢复快照后递增以强制重新加载文件内容
  const [reloadKey, setReloadKey] = useState(0);
  // 上次自动创建快照的时间戳（毫秒），用于控制最小间隔，避免高频保存产生重复快照
  const lastSnapshotTimeRef = useRef(0);

  // 写作会话追踪：记录本次会话字数、时长、WPM
  const session = useWritingSession(wordCount, filePath);

  // 从角色目录自动提取角色名（扫描每个 .txt 文件首行）
  // 文件格式约定：第一行为角色名（纯文本，不含冒号、不以分隔符开头）
  // 过滤规则：跳过模板文件（文件名包含"模板"/"名册"/"template"/"roster"）
  // 回退方案：读取 角色名册.txt（手动维护的花名册）
  useEffect(() => {
    let cancelled = false;
    if ((!isScript && !isDialogue) || !currentProject) {
      setCharacters([]);
      return;
    }

    const extractNames = async () => {
      try {
        // 优先方案：扫描角色目录，从每个 .txt 文件首行提取角色名
        const charDirPath = `${currentProject.path}/角色`;
        const tree = await readProjectTree(currentProject.path);
        const charDir = tree.find(
          (n) => n.is_dir && n.name === "角色"
        );
        if (charDir?.children) {
          const names: string[] = [];
          for (const child of charDir.children) {
            if (child.is_dir || !child.name.endsWith(".txt")) continue;
            // 过滤模板文件和名册文件（这些不是单个角色的设定文件）
            const lowerName = child.name.toLowerCase();
            if (lowerName.includes("模板") || lowerName.includes("名册") ||
                lowerName.includes("template") || lowerName.includes("roster") ||
                lowerName.includes("readme")) {
              continue;
            }
            try {
              const filePath = `${charDirPath}/${child.name}`;
              const content = await readFile(filePath, currentProject.path);
              const firstLine = content
                .split(/\r?\n/)
                .map((l) => l.trim())
                .find((l) => l && !l.startsWith("#") && !l.startsWith("---") && !l.startsWith("==="));
              // 验证首行是否为有效角色名
              if (firstLine && isValidCharacterName(firstLine)) {
                names.push(firstLine);
              }
            } catch {
              // 单个文件读取失败，跳过
            }
          }
          if (!cancelled && names.length > 0) {
            setCharacters(names);
            return;
          }
        }
      } catch {
        // 目录扫描失败，回退到角色名册
      }

      // 回退方案：读取 角色名册.txt
      const rosterPath = `${currentProject.path}/角色/角色名册.txt`;
      try {
        const content = await readFile(rosterPath, currentProject.path);
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
          )
          .filter(isValidCharacterName);
        if (!cancelled) setCharacters(names);
      } catch {
        if (!cancelled) setCharacters([]);
      }
    };

    extractNames();
    return () => { cancelled = true; };
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
      // VSCode 风格段落级快捷键（所有文体通用）
      VSShortcuts.configure({ enabled: true }),
      // VSCode 风格自动配对括号引号（所有文体通用）
      AutoPair.configure({ enabled: true }),
      // VSCode 风格当前段落高亮（所有文体通用）
      LineHighlight.configure({ enabled: true, className: "current-paragraph" }),
      // VSCode 风格智能选中缩进（Tab/Shift+Tab 批量缩进多段）
      SmartTab.configure({ enabled: true, indentChar: "\u3000" }),
      // 打字机模式：光标行始终居中（iA Writer 风格）
      TypewriterMode.configure({ enabled: typewriterMode, centerRatio: 0.45 }),
      // 焦点暗化：非当前段落降低透明度（iA Writer 风格）
      FocusDim.configure({ enabled: focusDim, dimOpacity: focusDimOpacity, scope: "paragraph" }),
    ];

    // 散文类文体启用首行缩进（标准长篇/短篇/日记/分卷/同世界观/诗歌等）
    // 剧本式与对话体不启用，它们有专属格式化逻辑
    if (isProse) {
      exts.push(IndentParagraph.configure({ enabled: indentEnabled, indentWidth }));
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
  }, [isProse, isScript, isDialogue, characters, t, indentEnabled, indentWidth, typewriterMode, focusDim, focusDimOpacity]);

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
    let cancelled = false;
    if (!editor || !filePath) {
      editor?.commands.clearContent();
      setWordCount(0);
      setDirty(false);
      return;
    }

    setLoadError("");
    readFile(filePath, currentProject?.path || "")
      .then((content) => {
        if (cancelled) return;
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
        if (cancelled) return;
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
        if (cancelled) return;
        setLoadError(t("editor.loadFailed", { error: String(e) }));
      });
    return () => { cancelled = true; };
  }, [filePath, editor, currentProject, t, projectType, diaryAutoDate, reloadKey]);

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

      // 版本快照：保存成功后自动创建快照（作者完全无感）
      // 受 snapshotEnabled 开关控制，并按 snapshotMinInterval 节流避免高频重复
      if (snapshotEnabled && currentProject?.path) {
        const now = Date.now();
        const elapsed = now - lastSnapshotTimeRef.current;
        if (elapsed >= snapshotMinInterval * 1000) {
          lastSnapshotTimeRef.current = now;
          // 异步创建快照，不阻塞保存流程，失败静默处理（不打扰作者）
          createSnapshot(filePath, currentProject.path, text, "auto").catch(() => {
            // 快照创建失败不影响保存成功状态，仅回退时间戳以便下次重试
            lastSnapshotTimeRef.current = 0;
          });
        }
      }
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
  }, [editor, filePath, dirty, showToast, t, currentProject, snapshotEnabled, snapshotMinInterval]);

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
        sessionWords={session.sessionWords}
        sessionDuration={session.sessionDuration}
        wpm={session.wpm}
        wordTarget={session.wordTarget}
        progress={session.progress}
        sessionPaused={session.paused}
        onToggleSessionPause={session.togglePause}
        typewriterMode={typewriterMode}
        focusDim={focusDim}
        onToggleTypewriter={() => useSettingsStore.getState().setTypewriterMode(!typewriterMode)}
        onToggleFocusDim={() => useSettingsStore.getState().setFocusDim(!focusDim)}
        showSnapshotHistory={showSnapshotHistory}
        onToggleSnapshotHistory={() => setShowSnapshotHistory((prev) => !prev)}
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
            {t("editor.dialogueAutoFillHint")}
          </span>
          <span>·</span>
          <span>
            {t("editor.charRosterHint", { count: characters.length })}
          </span>
        </div>
      )}

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto relative">
          <EditorContent editor={editor} />
          {showOutline && editor && (
            <OutlineView htmlContent={editor.getText()} />
          )}
        </div>
        {showSnapshotHistory && filePath && currentProject?.path && (
          <SnapshotHistory
            filePath={filePath}
            projectPath={currentProject.path}
            currentContent={editor?.getText() || ""}
            onClose={() => setShowSnapshotHistory(false)}
            onRestored={() => setReloadKey((n) => n + 1)}
          />
        )}
      </div>
    </div>
  );
}
