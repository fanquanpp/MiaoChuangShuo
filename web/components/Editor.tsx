// TipTap 编辑器封装组件
//
// 功能概述:
// 基于 TipTap 的富文本编辑器, 提供小说创作所需的格式化能力。
// 支持: 段落、标题 (H1-H3)、粗体/斜体/下划线/删除线、行内代码、
// 无序/有序列表、引用块、代码块、水平分割线、链接、硬换行、历史记录、占位符。
// 内容以 ProseMirror JSON 格式持久化到 IndexedDB, 编辑后 debounce 1 秒自动保存。
//
// 模块职责:
// 1. 初始化 TipTap 编辑器实例与扩展
// 2. 加载章节内容 (ProseMirror JSON)
// 3. 监听内容变化, debounce 1 秒后触发自动保存
// 4. 实时计算并上报字数
// 5. 渲染工具栏与编辑区
//
// 设计要点:
//   - 仅使用现有 package.json 中已安装的 TipTap 扩展, 不新增依赖
//   - 不使用 @tiptap/starter-kit (未安装), 改为逐个注册扩展
//   - 不使用 @tiptap/extension-character-count (未安装), 自行统计字数

import { useEffect, useRef, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor as TipTapEditor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import Strike from "@tiptap/extension-strike";
import Code from "@tiptap/extension-code";
import CodeBlock from "@tiptap/extension-code-block";
import Blockquote from "@tiptap/extension-blockquote";
import Heading from "@tiptap/extension-heading";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import ListItem from "@tiptap/extension-list-item";
import Link from "@tiptap/extension-link";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import HardBreak from "@tiptap/extension-hard-break";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import type { ProseMirrorNode, WebChapter } from "../lib/types";
import { createEmptyDoc } from "../lib/types";
import { countWordsFromProseMirror } from "../lib/wordCount";
import { getChapter, updateChapter } from "../lib/db";
import Toolbar from "./Toolbar";

// Editor 组件属性
interface EditorProps {
  // 当前选中的章节 ID (null 表示未选中)
  chapterId: string | null;
}

// 自动保存状态
type SaveStatus = "idle" | "saving" | "saved" | "error";

// 自动保存 debounce 延迟 (毫秒)
const AUTOSAVE_DEBOUNCE_MS = 1000;
// "已保存"提示显示时长 (毫秒)
const SAVED_HINT_DURATION_MS = 2000;

/**
 * Editor 编辑器组件
 * 输入: chapterId 章节 ID
 * 输出: JSX.Element
 * 流程:
 *   1. chapterId 变化时加载章节内容
 *   2. 初始化 TipTap 编辑器
 *   3. 内容变化时 debounce 1 秒保存
 *   4. 实时更新字数
 */
export default function Editor({ chapterId }: EditorProps): JSX.Element {
  // 当前章节对象
  const [chapter, setChapter] = useState<WebChapter | null>(null);
  // 加载状态
  const [loading, setLoading] = useState<boolean>(false);
  // 保存状态
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  // 当前字数
  const [wordCount, setWordCount] = useState<number>(0);
  // debounce 定时器引用
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "已保存"提示清除定时器
  const savedHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 防止初次加载触发自动保存的标志
  const isLoadingContentRef = useRef<boolean>(false);

  /**
   * 初始化 TipTap 编辑器
   * 输入: 无
   * 输出: 编辑器实例
   * 流程: 注册所有富文本扩展, 配置 onUpdate 回调
   */
  const editor = useEditor({
    extensions: [
      // 文档根节点
      Document,
      // 段落与文本
      Paragraph,
      Text,
      // 内联格式
      Bold,
      Italic,
      Underline,
      Strike,
      Code,
      // 块级格式
      Heading.configure({ levels: [1, 2, 3] }),
      BulletList,
      OrderedList,
      ListItem,
      Blockquote,
      CodeBlock,
      HorizontalRule,
      // 链接 (Ctrl+Click 跳转, 自动识别)
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer" },
      }),
      // 硬换行 (Shift+Enter)
      HardBreak,
      // 历史记录 (撤销/重做)
      History,
      // 占位符
      Placeholder.configure({
        placeholder: "开始你的创作...",
      }),
    ],
    // 初始内容为空文档
    content: createEmptyDoc(),
    // 内容变化回调
    onUpdate: ({ editor: ed }) => {
      // 加载阶段触发的内容变化不自动保存
      if (isLoadingContentRef.current) return;
      // 立即更新字数
      const json = ed.getJSON() as unknown as ProseMirrorNode;
      setWordCount(countWordsFromProseMirror(json));
      setSaveStatus("saving");
      // 清除已有定时器
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
      // debounce 1 秒后保存
      saveTimerRef.current = setTimeout(() => {
        void saveContent(ed);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
  });

  /**
   * 保存编辑器内容到 IndexedDB
   * 输入: ed TipTap 编辑器实例
   * 输出: Promise<void>
   * 流程:
   *   1. 校验 chapter 与 editor 状态
   *   2. 获取 ProseMirror JSON
   *   3. 调用 updateChapter 写入
   *   4. 更新保存状态
   */
  const saveContent = useCallback(
    async (ed: TipTapEditor): Promise<void> => {
      if (!chapter) return;
      try {
        const json = ed.getJSON() as unknown as ProseMirrorNode;
        await updateChapter(chapter.id, { content: json });
        setSaveStatus("saved");
        // 2 秒后恢复 idle 状态
        if (savedHintTimerRef.current !== null) {
          clearTimeout(savedHintTimerRef.current);
        }
        savedHintTimerRef.current = setTimeout(() => {
          setSaveStatus("idle");
        }, SAVED_HINT_DURATION_MS);
      } catch (e) {
        console.error("[MiaoChuangShuo Web] 自动保存失败:", e);
        setSaveStatus("error");
      }
    },
    [chapter]
  );

  /**
   * 加载章节内容到编辑器
   * 输入: id 章节 ID
   * 输出: Promise<void>
   * 流程:
   *   1. 从 IndexedDB 读取章节
   *   2. 设置 isLoadingContent 标志 (防止触发自动保存)
   *   3. 调用 editor.commands.setContent 加载内容
   *   4. 更新字数
   *   5. 清除标志
   */
  const loadChapter = useCallback(
    async (id: string): Promise<void> => {
      if (!editor) return;
      setLoading(true);
      try {
        const ch = await getChapter(id);
        if (!ch) {
          setChapter(null);
          return;
        }
        setChapter(ch);
        // 标记加载中, 防止 onUpdate 触发自动保存
        isLoadingContentRef.current = true;
        editor.commands.setContent(ch.content);
        setWordCount(countWordsFromProseMirror(ch.content));
        // nextTick 后清除标志
        setTimeout(() => {
          isLoadingContentRef.current = false;
        }, 0);
      } catch (e) {
        console.error("[MiaoChuangShuo Web] 加载章节失败:", e);
      } finally {
        setLoading(false);
      }
    },
    [editor]
  );

  // chapterId 变化时加载章节
  useEffect(() => {
    if (!editor) return;
    if (chapterId === null) {
      // 未选中章节时清空编辑器
      isLoadingContentRef.current = true;
      editor.commands.setContent(createEmptyDoc());
      setChapter(null);
      setWordCount(0);
      setSaveStatus("idle");
      setTimeout(() => {
        isLoadingContentRef.current = false;
      }, 0);
      return;
    }
    void loadChapter(chapterId);
  }, [chapterId, editor, loadChapter]);

  // 卸载时清除定时器
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
      if (savedHintTimerRef.current !== null) {
        clearTimeout(savedHintTimerRef.current);
      }
    };
  }, []);

  // 保存状态显示文案
  const saveStatusText: string = (() => {
    switch (saveStatus) {
      case "saving":
        return "保存中...";
      case "saved":
        return "已保存";
      case "error":
        return "保存失败";
      default:
        return "";
    }
  })();

  return (
    <div className="editor-area">
      <Toolbar editor={editor} />
      <div className="editor-content-wrapper">
        <div className="editor-content">
          {loading ? (
            <div style={{ textAlign: "center", color: "var(--mc-text-tertiary)", padding: 40 }}>
              正在加载章节内容...
            </div>
          ) : chapterId === null ? (
            <div
              style={{
                textAlign: "center",
                color: "var(--mc-text-tertiary)",
                padding: 60,
                lineHeight: 2,
              }}
            >
              <p style={{ fontSize: "1.1rem", marginBottom: 12 }}>未选择章节</p>
              <p style={{ fontSize: "0.85rem" }}>
                请在左侧章节列表中选择或创建一个章节开始创作
              </p>
            </div>
          ) : (
            <EditorContent editor={editor} />
          )}
        </div>
      </div>
      <div className="editor-statusbar">
        <div className="editor-statusbar-left">
          {chapter && (
            <span className="editor-statusbar-item">{chapter.name}</span>
          )}
        </div>
        <div className="editor-statusbar-left">
          <span className="editor-statusbar-item">
            字数: <strong style={{ color: "var(--mc-secondary)" }}>{wordCount}</strong>
          </span>
          {saveStatusText && (
            <span className="editor-statusbar-item">
              <span
                className={`save-status${
                  saveStatus === "saving" ? " saving" : ""
                }`}
                style={
                  saveStatus === "error"
                    ? { color: "var(--mc-danger)" }
                    : undefined
                }
              >
                {saveStatusText}
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
