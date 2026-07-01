// 大纲生成章节组件
//
// 功能概述：
// 实现"大纲 → 正文"的数据联动，从大纲文件中提取章节标题，
// 一键批量生成对应的正文章节文件，避免作家逐个手动创建。
//
// 模块职责：
// 1. 读取大纲目录下所有 .txt 文件
// 2. 解析大纲文本，提取章节标题（支持多种格式）
// 3. 预览将生成的章节文件列表（可勾选）
// 4. 批量创建章节文件（跳过已存在的同名文件）
// 5. 创建完成后触发项目树刷新
//
// 设计理念：
// 作家写完大纲后，切到正文分类，一键生成所有章节文件
// 从此告别"逐个新建文件"的机械劳动

import { useEffect, useState, useCallback } from "react";
import {
  X,
  ListTree,
  Loader2,
  AlertCircle,
  Check,
  FilePlus,
  RefreshCw,
} from "lucide-react";
import { readProjectTree, readFile, createFile } from "../lib/api";
import type { FileNode } from "../lib/api";
import { useAppStore } from "../lib/store";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";

interface OutlineToChaptersProps {
  /** 关闭对话框回调 */
  onClose: () => void;
  /** 创建完成后的回调（用于刷新项目树与文件列表） */
  onCreated: () => void;
}

// 解析出的章节条目
interface ParsedChapter {
  // 章节标题原文（如"第一章 风起"）
  title: string;
  // 来源文件名
  sourceFile: string;
  // 将创建的文件名（如"第一章 风起.txt"）
  fileName: string;
  // 是否已存在（跳过创建）
  exists: boolean;
  // 是否选中创建
  selected: boolean;
}

/**
 * 章节标题匹配正则列表
 * 支持：第X章/节/回/卷/集/部/篇、Chapter X、CHAPTER X
 */
const CHAPTER_PATTERNS: RegExp[] = [
  /^第[一二三四五六七八九十百千万零\d]+[章节回卷集部篇].*$/,
  /^[Cc]hapter\s*\d+.*$/,
  /^[Cc][Hh][Aa][Pp][Tt][Ee][Rr]\s*\d+.*$/,
];

/**
 * 判断一行文本是否为章节标题
 * 输入: line 文本行
 * 输出: boolean 是否为章节标题
 */
function isChapterTitle(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 50) return false;
  return CHAPTER_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * 生成章节文件名
 * 输入: title 章节标题
 * 输出: 文件名（带 .txt 后缀）
 * 流程: 去除文件名非法字符，添加 .txt
 */
function makeFileName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ");
  return `${cleaned}.txt`;
}

/**
 * 大纲生成章节对话框
 * 输入:
 *   onClose 关闭回调
 *   onCreated 创建完成回调
 * 输出: JSX 模态对话框
 * 流程:
 *   1. 读取大纲目录下所有 .txt 文件
 *   2. 逐文件解析章节标题
 *   3. 显示预览列表（可勾选）
 *   4. 确认后批量创建章节文件
 */
export default function OutlineToChapters({
  onClose,
  onCreated,
}: OutlineToChaptersProps) {
  const currentProject = useAppStore((s) => s.currentProject);
  const projectTree = useAppStore((s) => s.projectTree);
  const { showToast } = useToast();
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [chapters, setChapters] = useState<ParsedChapter[]>([]);
  const [creating, setCreating] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);

  /**
   * 加载并解析大纲文件
   * 流程:
   *   1. 从项目树中找到大纲目录
   *   2. 读取所有 .txt 文件
   *   3. 逐文件提取章节标题
   *   4. 检查正文目录下是否已存在同名文件
   */
  const loadOutlineChapters = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    try {
      const tree = projectTree.length > 0 ? projectTree : await readProjectTree(currentProject.path);

      // 查找大纲目录
      const outlineDir = tree.find(
        (n) => n.is_dir && (n.name === "大纲" || n.name === "outline")
      );
      if (!outlineDir?.children) {
        setChapters([]);
        setLoading(false);
        return;
      }

      // 查找正文目录（用于检查文件是否已存在）
      const manuscriptDir = tree.find(
        (n) => n.is_dir && (n.name === "正文" || n.name === "manuscript")
      );
      const existingFiles = new Set<string>();
      if (manuscriptDir?.children) {
        const collectFiles = (nodes: FileNode[]) => {
          for (const n of nodes) {
            if (!n.is_dir) existingFiles.add(n.name);
            else if (n.children) collectFiles(n.children);
          }
        };
        collectFiles(manuscriptDir.children);
      }

      // 解析大纲文件
      const parsed: ParsedChapter[] = [];
      for (const file of outlineDir.children) {
        if (file.is_dir || !file.name.endsWith(".txt")) continue;
        try {
          const content = await readFile(
            `${currentProject.path}/大纲/${file.name}`,
            currentProject.path
          );
          const lines = content.split(/\r?\n/);
          for (const line of lines) {
            if (isChapterTitle(line.trim())) {
              const title = line.trim();
              const fileName = makeFileName(title);
              const exists = existingFiles.has(fileName);
              parsed.push({
                title,
                sourceFile: file.name,
                fileName,
                exists,
                selected: !exists, // 默认选中不存在的
              });
            }
          }
        } catch {
          // 跳过无法读取的文件
        }
      }

      setChapters(parsed);
    } catch (err) {
      showToast(
        "error",
        t("outlineToChapters.loadError") +
          (err instanceof Error ? err.message : String(err))
      );
      setChapters([]);
    } finally {
      setLoading(false);
    }
  }, [currentProject, projectTree, showToast, t]);

  useEffect(() => {
    loadOutlineChapters();
  }, [loadOutlineChapters]);

  // 可创建的章节数（选中且不存在）
  const creatableChapters = chapters.filter((c) => c.selected && !c.exists);
  const selectedCount = chapters.filter((c) => c.selected).length;

  /**
   * 批量创建章节文件
   * 流程:
   *   1. 获取当前正文目录的最大章节序号
   *   2. 逐个创建选中的章节文件
   *   3. 文件内容：章节标题 + 空行
   *   4. 统计创建数量并触发刷新
   */
  const handleCreate = useCallback(async () => {
    if (!currentProject || creatableChapters.length === 0) return;
    setCreating(true);
    setCreatedCount(0);
    let created = 0;
    try {
      for (const chapter of creatableChapters) {
        // 章节文件内容：标题 + 空行
        const content = `${chapter.title}\n\n`;
        try {
          await createFile(currentProject.path, `正文/${chapter.fileName}`, content);
          created++;
          setCreatedCount(created);
        } catch {
          // 单个文件创建失败不中断整体流程
        }
      }
      showToast(
        "success",
        t("outlineToChapters.createSuccess", { count: created })
      );
      onCreated();
      onClose();
    } catch (err) {
      showToast(
        "error",
        t("outlineToChapters.createError") +
          (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setCreating(false);
    }
  }, [currentProject, creatableChapters, showToast, t, onCreated, onClose]);

  /**
   * 全选/取消全选
   */
  const handleSelectAll = useCallback(() => {
    setChapters((prev) =>
      prev.map((c) => ({ ...c, selected: !c.exists ? true : c.selected }))
    );
  }, []);

  const handleDeselectAll = useCallback(() => {
    setChapters((prev) => prev.map((c) => ({ ...c, selected: false })));
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
      onClick={() => !creating && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={t("outlineToChapters.title")}
    >
      <div
        className="nf-glass-panel w-full max-w-lg bg-nf-bg border border-nf-border-light shadow-2xl flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-nf-border-light">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-fandex-primary/10">
              <ListTree className="w-5 h-5 text-fandex-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold font-display text-nf-text">
                {t("outlineToChapters.title")}
              </h2>
              <p className="text-xs text-nf-text-tertiary mt-0.5">
                {t("outlineToChapters.subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={() => !creating && onClose()}
            disabled={creating}
            className="p-1 text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-hover rounded transition duration-fast disabled:opacity-50"
            aria-label={t("app.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 text-fandex-primary animate-spin" />
              <p className="text-sm text-nf-text-secondary">
                {t("outlineToChapters.loading")}
              </p>
            </div>
          ) : chapters.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <AlertCircle className="w-10 h-10 text-nf-text-tertiary" />
              <p className="text-sm text-nf-text-secondary">
                {t("outlineToChapters.noChapters")}
              </p>
              <p className="text-xs text-nf-text-tertiary">
                {t("outlineToChapters.noChaptersHint")}
              </p>
            </div>
          ) : (
            <>
              {/* 操作栏 */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-nf-text-secondary">
                  {t("outlineToChapters.totalFound", { count: chapters.length })}
                  {" · "}
                  {t("outlineToChapters.selected", { count: selectedCount })}
                  {" · "}
                  {t("outlineToChapters.creatable", {
                    count: creatableChapters.length,
                  })}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSelectAll}
                    disabled={creating}
                    className="text-xs text-fandex-primary hover:text-fandex-primary-hover transition duration-fast disabled:opacity-50"
                  >
                    {t("outlineToChapters.selectAll")}
                  </button>
                  <span className="text-nf-text-tertiary">|</span>
                  <button
                    onClick={handleDeselectAll}
                    disabled={creating}
                    className="text-xs text-nf-text-tertiary hover:text-nf-text transition duration-fast disabled:opacity-50"
                  >
                    {t("outlineToChapters.deselectAll")}
                  </button>
                </div>
              </div>

              {/* 章节列表 */}
              <ul className="space-y-1">
                {chapters.map((chapter, idx) => (
                  <li
                    key={`${chapter.sourceFile}-${idx}`}
                    className={`flex items-center gap-3 px-3 py-2 rounded border transition duration-fast ${
                      chapter.exists
                        ? "border-nf-border-light bg-nf-bg-hover/20 opacity-60"
                        : chapter.selected
                        ? "border-fandex-primary/30 bg-fandex-primary/5"
                        : "border-nf-border-light hover:bg-nf-bg-hover/30"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={chapter.selected}
                      disabled={chapter.exists || creating}
                      onChange={(e) => {
                        setChapters((prev) =>
                          prev.map((c, i) =>
                            i === idx ? { ...c, selected: e.target.checked } : c
                          )
                        );
                      }}
                      className="w-4 h-4 accent-fandex-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-nf-text truncate">
                        {chapter.title}
                      </div>
                      <div className="text-xs text-nf-text-tertiary truncate">
                        {chapter.fileName}
                        {chapter.exists && (
                          <span className="ml-2 text-amber-400">
                            ({t("outlineToChapters.exists")})
                          </span>
                        )}
                      </div>
                    </div>
                    {chapter.exists && (
                      <Check className="w-4 h-4 text-nf-text-tertiary flex-shrink-0" />
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* 底部操作 */}
        <footer className="flex items-center justify-between px-5 py-4 border-t border-nf-border-light">
          <button
            onClick={loadOutlineChapters}
            disabled={creating || loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-nf-text-secondary hover:text-nf-text border border-nf-border-light hover:border-nf-border rounded transition duration-fast disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
            {t("outlineToChapters.refresh")}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={creating}
              className="px-4 py-2 text-sm text-nf-text-secondary hover:text-nf-text border border-nf-border-light hover:border-nf-border rounded transition duration-fast disabled:opacity-50"
            >
              {t("app.cancel")}
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || creatableChapters.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse rounded transition duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FilePlus className="w-4 h-4" />
              )}
              {creating
                ? t("outlineToChapters.creating", { count: createdCount })
                : t("outlineToChapters.create", {
                    count: creatableChapters.length,
                  })}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
