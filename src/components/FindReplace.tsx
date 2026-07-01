// 查找替换面板组件
//
// 功能概述：
// 基于 TipTap 编辑器实例的查找替换面板，浮于编辑区顶部右侧。
// 支持仅查找模式（Ctrl+F）和查找并替换模式（Ctrl+H）。
// 查找功能：实时高亮所有匹配项，显示匹配计数与当前定位。
// 替换功能：替换当前匹配项 / 全部替换。
// 支持大小写敏感与正则表达式切换。
// 参考 VSCode / 番茄小说作家助手的查找替换交互。
//
// 模块职责：
// 1. 提供查找输入框与替换输入框
// 2. 实时搜索匹配项并计数
// 3. 上一个/下一个导航
// 4. 替换当前/全部替换
// 5. 选项切换：大小写敏感 / 正则表达式

import type { Editor } from "@tiptap/core";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search,
  Replace,
  ChevronUp,
  ChevronDown,
  X,
  CaseSensitive,
  Regex,
  Check,
  AlertCircle,
} from "lucide-react";
import { useI18n } from "../lib/i18n";

interface FindReplaceProps {
  /** TipTap 编辑器实例 */
  editor: Editor;
  /** 初始模式：find 仅查找 / replace 查找并替换 */
  mode: "find" | "replace";
  /** 关闭面板回调 */
  onClose: () => void;
  /** 模式切换回调 */
  onModeChange: (mode: "find" | "replace") => void;
}

// 匹配项结构：记录匹配的文本位置（ProseMirror 文档全局位置）
interface Match {
  /** 起始位置（ProseMirror 全局 pos） */
  from: number;
  /** 结束位置 */
  to: number;
  /** 匹配的文本 */
  text: string;
}

/**
 * 查找替换面板组件
 * 输入:
 *   editor TipTap 编辑器实例
 *   mode 初始模式（find / replace）
 *   onClose 关闭回调
 *   onModeChange 模式切换回调
 * 输出: JSX 浮动面板
 * 流程:
 *   1. 监听查找词变化，重新搜索所有匹配项
 *   2. 使用 ProseMirror Decoration 高亮匹配项（简化版：仅滚动定位）
 *   3. 上一个/下一个导航：循环切换当前匹配项
 *   4. 替换当前：替换当前匹配项并跳到下一个
 *   5. 全部替换：遍历所有匹配项替换（从后向前避免位置偏移）
 */
export default function FindReplace({
  editor,
  mode,
  onClose,
  onModeChange,
}: FindReplaceProps) {
  const { t } = useI18n();
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [regexError, setRegexError] = useState("");
  const findInputRef = useRef<HTMLInputElement>(null);

  // 打开面板时自动聚焦查找输入框
  useEffect(() => {
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, []);

  /**
   * 执行搜索：遍历编辑器文档所有文本节点，查找匹配项
   * 输入: findText 查找词 / caseSensitive 大小写敏感 / useRegex 正则模式
   * 输出: Match[] 匹配项数组
   * 流程:
   *   1. 构建正则表达式或转义字符串
   *   2. 遍历文档节点树，提取每个文本节点的文本与位置
   *   3. 对每个文本节点执行 match，记录匹配位置
   *   4. 返回所有匹配项
   */
  const performSearch = useCallback(() => {
    if (!findText) {
      setMatches([]);
      setCurrentIndex(0);
      setRegexError("");
      return;
    }

    let regex: RegExp;
    try {
      if (useRegex) {
        regex = new RegExp(findText, caseSensitive ? "g" : "gi");
        setRegexError("");
      } else {
        // 转义正则特殊字符
        const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        regex = new RegExp(escaped, caseSensitive ? "g" : "gi");
        setRegexError("");
      }
    } catch (e) {
      setRegexError(t("findReplace.regexError", { error: String(e) }));
      setMatches([]);
      return;
    }

    const result: Match[] = [];
    const doc = editor.state.doc;

    // 遍历文档所有文本节点，提取匹配位置
    doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return;
      const text = node.text;
      // 重置 regex lastIndex（全局标志会保留状态）
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        if (match[0].length === 0) {
          // 避免零宽匹配死循环
          regex.lastIndex++;
          continue;
        }
        result.push({
          from: pos + match.index,
          to: pos + match.index + match[0].length,
          text: match[0],
        });
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
      return false;
    });

    setMatches(result);
    setCurrentIndex(result.length > 0 ? 0 : 0);

    // 定位到第一个匹配项
    if (result.length > 0) {
      const first = result[0];
      editor.commands.setTextSelection({ from: first.from, to: first.to });
      editor.commands.scrollIntoView();
    }
  }, [findText, caseSensitive, useRegex, editor, t]);

  // 查找词或选项变化时重新搜索（防抖 200ms）
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch();
    }, 200);
    return () => clearTimeout(timer);
  }, [performSearch]);

  /**
   * 跳转到指定匹配项
   * 输入: index 目标匹配项索引
   * 输出: void
   * 流程: 设置选区并滚动到匹配位置
   */
  const goToMatch = useCallback((index: number) => {
    if (matches.length === 0) return;
    const safeIndex = ((index % matches.length) + matches.length) % matches.length;
    const m = matches[safeIndex];
    setCurrentIndex(safeIndex);
    editor.chain().focus().setTextSelection({ from: m.from, to: m.to }).scrollIntoView().run();
  }, [matches, editor]);

  // 上一个
  const handlePrev = () => goToMatch(currentIndex - 1);
  // 下一个
  const handleNext = () => goToMatch(currentIndex + 1);

  /**
   * 替换当前匹配项
   * 输入: 无
   * 输出: void
   * 流程:
   *   1. 检查是否有匹配项
   *   2. 用 replaceText 替换当前匹配项
   *   3. 重新搜索并跳到下一个匹配项
   */
  const handleReplace = useCallback(() => {
    if (matches.length === 0 || !findText) return;
    const m = matches[currentIndex];
    if (!m) return;

    // 执行替换：删除匹配文本并插入替换文本
    editor.chain().focus()
      .setTextSelection({ from: m.from, to: m.to })
      .deleteSelection()
      .insertContent(replaceText)
      .run();

    // 替换后重新搜索
    setTimeout(() => {
      performSearch();
    }, 50);
  }, [matches, currentIndex, findText, replaceText, editor, performSearch]);

  /**
   * 全部替换
   * 输入: 无
   * 输出: void
   * 流程:
   *   1. 从后向前遍历匹配项（避免位置偏移）
   *   2. 逐个替换匹配文本
   *   3. 重新搜索（应为 0 匹配）
   */
  const handleReplaceAll = useCallback(() => {
    if (matches.length === 0 || !findText) return;

    // 从后向前替换，避免位置偏移
    const sorted = [...matches].sort((a, b) => b.from - a.from);
    const { tr } = editor.state;
    for (const m of sorted) {
      tr.replaceWith(m.from, m.to, replaceText ? editor.state.schema.text(replaceText) : []);
    }
    editor.view.dispatch(tr);

    // 替换后重新搜索
    setTimeout(() => {
      performSearch();
    }, 50);
  }, [matches, findText, replaceText, editor, performSearch]);

  // 快捷键：Enter 下一个 / Shift+Enter 上一个 / Esc 关闭
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleNext();
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      handlePrev();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="absolute top-2 right-2 w-80 bg-nf-bg-card border border-nf-border-light shadow-lg z-30 animate-slide-up">
      {/* 头部：模式标签 + 关闭按钮 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-nf-border-light">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onModeChange("find")}
            className={`flex items-center gap-1 px-2 py-1 text-xs transition duration-fast ${
              mode === "find"
                ? "text-fandex-primary border-b-2 border-fandex-primary"
                : "text-nf-text-tertiary hover:text-nf-text"
            }`}
          >
            <Search className="w-3 h-3" />
            {t("findReplace.find")}
          </button>
          <button
            onClick={() => onModeChange("replace")}
            className={`flex items-center gap-1 px-2 py-1 text-xs transition duration-fast ${
              mode === "replace"
                ? "text-fandex-primary border-b-2 border-fandex-primary"
                : "text-nf-text-tertiary hover:text-nf-text"
            }`}
          >
            <Replace className="w-3 h-3" />
            {t("findReplace.replace")}
          </button>
        </div>
        <button
          onClick={onClose}
          className="text-nf-text-tertiary hover:text-nf-text transition duration-fast"
          title={t("findReplace.close")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 查找输入区 */}
      <div className="px-3 py-2 space-y-2">
        <div className="flex items-center gap-1">
          <input
            ref={findInputRef}
            type="text"
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("findReplace.findPlaceholder")}
            className="flex-1 bg-nf-bg border border-nf-border-light px-2 py-1 text-xs text-nf-text focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
          />
          {/* 大小写敏感切换 */}
          <button
            onClick={() => setCaseSensitive((prev) => !prev)}
            title={t("findReplace.caseSensitive")}
            className={`p-1 transition duration-fast ${
              caseSensitive
                ? "bg-fandex-primary/10 text-fandex-primary border border-fandex-primary/40"
                : "text-nf-text-tertiary hover:text-nf-text border border-transparent hover:border-nf-border-light"
            }`}
          >
            <CaseSensitive className="w-3.5 h-3.5" />
          </button>
          {/* 正则表达式切换 */}
          <button
            onClick={() => setUseRegex((prev) => !prev)}
            title={t("findReplace.regex")}
            className={`p-1 transition duration-fast ${
              useRegex
                ? "bg-fandex-primary/10 text-fandex-primary border border-fandex-primary/40"
                : "text-nf-text-tertiary hover:text-nf-text border border-transparent hover:border-nf-border-light"
            }`}
          >
            <Regex className="w-3.5 h-3.5" />
          </button>
          {/* 上一个/下一个 */}
          <button
            onClick={handlePrev}
            disabled={matches.length === 0}
            title={t("findReplace.prev")}
            className="p-1 text-nf-text-tertiary hover:text-nf-text transition duration-fast disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleNext}
            disabled={matches.length === 0}
            title={t("findReplace.next")}
            className="p-1 text-nf-text-tertiary hover:text-nf-text transition duration-fast disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 匹配计数 / 正则错误提示 */}
        {regexError ? (
          <div className="flex items-center gap-1 text-[10px] text-fandex-tertiary">
            <AlertCircle className="w-3 h-3" />
            <span className="truncate">{regexError}</span>
          </div>
        ) : findText ? (
          <div className="text-[10px] text-nf-text-tertiary tabular-nums">
            {matches.length > 0
              ? t("findReplace.matchCount", { current: currentIndex + 1, total: matches.length })
              : t("findReplace.noMatch")}
          </div>
        ) : null}

        {/* 替换输入区（仅 replace 模式显示） */}
        {mode === "replace" && (
          <>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("findReplace.replacePlaceholder")}
                className="flex-1 bg-nf-bg border border-nf-border-light px-2 py-1 text-xs text-nf-text focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
              />
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleReplace}
                disabled={matches.length === 0}
                className="flex-1 px-2 py-1 text-xs text-nf-text-secondary border border-nf-border-light hover:border-fandex-primary/50 hover:text-fandex-primary transition duration-fast disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {t("findReplace.replaceOne")}
              </button>
              <button
                onClick={handleReplaceAll}
                disabled={matches.length === 0}
                className="flex-1 px-2 py-1 text-xs text-fandex-secondary border border-fandex-secondary/30 hover:bg-fandex-secondary/10 hover:border-fandex-secondary/50 transition duration-fast disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {t("findReplace.replaceAll")}
              </button>
            </div>
          </>
        )}

        {/* 替换成功提示（可选） */}
        {mode === "replace" && matches.length > 0 && (
          <div className="flex items-center gap-1 text-[10px] text-nf-text-tertiary">
            <Check className="w-3 h-3 text-fandex-secondary" />
            <span>{t("findReplace.hint")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
