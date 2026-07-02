// 分卷章节生成器组件
//
// 功能概述：
// 在"正文"目录下创建分卷子目录，并按用户参数批量生成卷首语、N 个章节、卷尾语。
// 作者常需规划分卷结构，本组件把"逐个新建文件+起标题"的机械操作一次性完成。
//
// 模块职责：
// 1. 收集用户输入：分卷名、章节数、起始号、标题格式、是否含卷首/尾语
// 2. 实时预览将生成的文件列表（含已存在标记）
// 3. 调用后端 generate_volume_chapters 批量创建文件
// 4. 完成后刷新项目树并展示统计结果
// 5. 完整中英文国际化

import { useState, useMemo, useCallback } from "react";
import {
  X,
  BookCopy,
  Loader2,
  CheckCircle2,
  FileText,
  Sparkles,
  AlertTriangle,
  Info,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { generateVolumeChapters, type VolumeChapterResult } from "../lib/api";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import ConfirmDialog from "./ConfirmDialog";

interface VolumeChapterGeneratorProps {
  /** 关闭对话框回调 */
  onClose: () => void;
  /** 创建完成后的回调（用于刷新项目树） */
  onCreated?: () => void;
  /** 预填的卷名（可选） */
  defaultVolumeName?: string;
}

// 标题格式类型
type TitleFormat = "chinese" | "arabic" | "english";

// 中文数字映射（1-20）
const CN_NUMS: string[] = [
  "", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
];

/**
 * 中文数字转换
 * 输入: n 数字
 * 输出: 中文数字字符串
 */
function toChinese(n: number): string {
  if (n >= 0 && n < CN_NUMS.length) return CN_NUMS[n];
  return String(n);
}

/**
 * 推算卷序号
 * 输入: name 卷名
 * 输出: 卷序号（默认1）
 */
function detectVolumeNumber(name: string): number {
  // 阿拉伯数字优先
  const digits = name.match(/\d+/);
  if (digits) return parseInt(digits[0], 10);
  // 中文数字
  const cnMap: Record<string, number> = {
    "十一": 11, "十二": 12, "十三": 13, "十四": 14, "十五": 15,
    "十六": 16, "十七": 17, "十八": 18, "十九": 19, "二十": 20,
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
  };
  for (const [cn, num] of Object.entries(cnMap)) {
    if (name.includes(cn)) return num;
  }
  return 1;
}

/**
 * 根据标题格式返回默认章节文件名模板
 * 输入: format 标题格式
 * 输出: 默认模板字符串（含 {n} 占位符）
 */
function defaultTemplateByFormat(format: TitleFormat): string {
  if (format === "arabic") return "第{n}章";
  if (format === "english") return "Chapter {n}";
  return "第{n}章";
}

/**
 * 将模板中的 {n} 占位符替换为章节序号
 * 输入:
 *   template 模板字符串（含 {n} 占位符）
 *   num 章节序号
 * 输出: 替换后的标题字符串
 * 流程: 若模板为空或不含 {n}，回退为 "第{n}章" 后替换
 */
function applyTemplate(template: string, num: number): string {
  const tpl = template && template.includes("{n}") ? template : "第{n}章";
  return tpl.replace(/\{n\}/g, String(num));
}

/**
 * 生成预览章节列表
 * 输入:
 *   volumeName 卷名
 *   chapterCount 章节数
 *   startNum 起始章号
 *   withPrologue 是否含卷首语
 *   withEpilogue 是否含卷尾语
 *   chapterNameTemplate 章节文件名模板（含 {n} 占位符）
 * 输出: VolumeChapterResult[] 预览列表
 * 说明: 章节文件名仅使用用户模板，不再追加"（第X卷）"标识，
 *      因文件已归类到分卷子目录，卷号信息由目录承载
 */
function buildPreview(
  volumeName: string,
  chapterCount: number,
  startNum: number,
  withPrologue: boolean,
  withEpilogue: boolean,
  chapterNameTemplate: string
): VolumeChapterResult[] {
  const volumeNum = detectVolumeNumber(volumeName);
  const list: VolumeChapterResult[] = [];

  // 卷首语
  if (withPrologue) {
    list.push({
      relative_path: `正文/${volumeName}/卷首语.txt`,
      chapter_title: `第${toChinese(volumeNum)}卷·卷首语`,
      is_prologue: true,
      is_epilogue: false,
      already_exists: false,
    });
  }

  // 章节：文件名仅由用户模板生成，不再追加卷号标识
  for (let i = 0; i < chapterCount; i++) {
    const n = startNum + i;
    const title = applyTemplate(chapterNameTemplate, n);
    const safe = title.replace(/[\/\\:*?"<>|]/g, "").trim();
    list.push({
      relative_path: `正文/${volumeName}/${safe}.txt`,
      chapter_title: title,
      is_prologue: false,
      is_epilogue: false,
      already_exists: false,
    });
  }

  // 卷尾语
  if (withEpilogue) {
    list.push({
      relative_path: `正文/${volumeName}/卷尾语.txt`,
      chapter_title: `第${toChinese(volumeNum)}卷·卷尾语`,
      is_prologue: false,
      is_epilogue: true,
      already_exists: false,
    });
  }

  return list;
}

/**
 * 分卷章节生成器组件
 * 输入:
 *   onClose 关闭回调
 *   onCreated 创建完成回调
 *   defaultVolumeName 预填卷名
 * 输出: JSX 对话框
 * 流程:
 *   1. 收集用户输入
 *   2. 实时预览生成列表
 *   3. 调用后端 API 批量创建
 *   4. 完成后刷新项目树并展示统计
 */
export default function VolumeChapterGenerator({
  onClose,
  onCreated,
  defaultVolumeName = "",
}: VolumeChapterGeneratorProps) {
  const currentProject = useAppStore((s) => s.currentProject);
  const refreshProjectTree = useAppStore((s) => s.refreshProjectTree);
  const { showToast } = useToast();
  const { t } = useI18n();

  const [volumeName, setVolumeName] = useState(defaultVolumeName);
  const [chapterCount, setChapterCount] = useState(10);
  const [startNum, setStartNum] = useState(1);
  const [withPrologue, setWithPrologue] = useState(true);
  const [withEpilogue, setWithEpilogue] = useState(false);
  const [format, setFormat] = useState<TitleFormat>("chinese");
  // 章节文件名模板：用户可自定义，支持 {n} 占位符
  // 切换 format 时自动同步为对应默认模板（用户可后续手动修改）
  const [chapterNameTemplate, setChapterNameTemplate] = useState(
    defaultTemplateByFormat("chinese")
  );
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  // 二次确认对话框可见状态:点击"创建空白骨架"后先弹出确认,避免用户误操作
  const [showConfirm, setShowConfirm] = useState(false);

  /**
   * 切换标题格式时同步更新章节文件名模板为对应默认值
   * 输入: f 新的标题格式
   * 流程: 设置 format，并将模板重置为该格式对应的默认模板
   */
  const handleFormatChange = useCallback((f: TitleFormat) => {
    setFormat(f);
    setChapterNameTemplate(defaultTemplateByFormat(f));
  }, []);

  /**
   * 重置章节文件名模板为当前格式对应的默认值
   */
  const handleResetTemplate = useCallback(() => {
    setChapterNameTemplate(defaultTemplateByFormat(format));
  }, [format]);

  // 预览列表
  const preview = useMemo(() => {
    if (!volumeName.trim() || chapterCount <= 0) return [];
    return buildPreview(
      volumeName.trim(),
      Math.min(chapterCount, 100),
      Math.max(1, startNum),
      withPrologue,
      withEpilogue,
      chapterNameTemplate
    );
  }, [volumeName, chapterCount, startNum, withPrologue, withEpilogue, chapterNameTemplate]);

  // 是否可生成
  const canGenerate = useMemo(() => {
    return (
      !!currentProject &&
      volumeName.trim().length > 0 &&
      chapterCount > 0 &&
      chapterCount <= 500 &&
      startNum >= 1 &&
      !generating
    );
  }, [currentProject, volumeName, chapterCount, startNum, generating]);

  /**
   * 执行真正的生成逻辑(内部函数)
   * 流程: 调用后端 generateVolumeChapters,成功后刷新项目树并关闭对话框
   * 注意: 本函数不做参数校验,校验由 handleGenerateClick 完成
   */
  const doGenerate = useCallback(async () => {
    if (!currentProject) {
      showToast("error", t("volumeGen.noProject"));
      return;
    }
    setGenerating(true);
    setResult(null);
    try {
      const res = await generateVolumeChapters(
        currentProject.path,
        volumeName.trim(),
        chapterCount,
        startNum,
        withPrologue,
        withEpilogue,
        format,
        chapterNameTemplate
      );
      setResult({
        created: res.created_count,
        skipped: res.skipped_count,
      });
      showToast(
        "success",
        t("volumeGen.success", {
          created: res.created_count,
          skipped: res.skipped_count,
        })
      );
      await refreshProjectTree?.();
      onCreated?.();
      // 生成成功后自动关闭对话框,避免用户误以为操作未完成
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("error", t("volumeGen.failed") + ": " + msg);
    } finally {
      setGenerating(false);
    }
  }, [
    currentProject,
    volumeName,
    chapterCount,
    startNum,
    withPrologue,
    withEpilogue,
    format,
    chapterNameTemplate,
    showToast,
    t,
    refreshProjectTree,
    onCreated,
    onClose,
  ]);

  /**
   * 点击"创建空白骨架"按钮:先校验参数,通过后弹出二次确认对话框
   * 流程: 参数校验 -> 弹出确认对话框(告知将创建N个空白文件)
   */
  const handleGenerateClick = useCallback(() => {
    if (!currentProject) {
      showToast("error", t("volumeGen.noProject"));
      return;
    }
    if (!volumeName.trim()) {
      showToast("error", t("volumeGen.nameRequired"));
      return;
    }
    if (chapterCount <= 0) {
      showToast("error", t("volumeGen.countInvalid"));
      return;
    }
    // 弹出二次确认,避免用户误以为此功能会整理现有章节
    setShowConfirm(true);
  }, [currentProject, volumeName, chapterCount, showToast, t]);

  /**
   * 确认对话框:用户点击"确认创建"后执行真正的生成逻辑
   */
  const handleConfirmGenerate = useCallback(() => {
    setShowConfirm(false);
    void doGenerate();
  }, [doGenerate]);

  // 快捷章节数选项
  const quickCounts = [5, 10, 20, 30, 50];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="nf-glass-panel w-full max-w-2xl max-h-[90vh] bg-nf-bg-card border border-nf-border-light shadow-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-nf-border-light flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-fandex-primary/10">
              <BookCopy className="w-5 h-5 text-fandex-primary" />
            </div>
            <div>
              <h2 className="fandex-bar-left text-base font-bold font-display text-nf-text">
                {t("volumeGen.title")}
              </h2>
              <p className="text-xs text-nf-text-tertiary mt-0.5">
                {t("volumeGen.subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
            aria-label={t("app.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* 功能说明警告横幅:明确告知此功能预创建空白文件,非整理现有章节 */}
        <div className="flex items-start gap-2 px-5 py-2.5 bg-fandex-tertiary/10 border-b border-fandex-tertiary/30 flex-shrink-0">
          <Info className="w-4 h-4 text-fandex-tertiary flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-fandex-tertiary mb-0.5">
              {t("volumeGen.warningTitle")}
            </div>
            <p className="text-[11px] text-nf-text-secondary leading-relaxed">
              {t("volumeGen.warningText")}
            </p>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 分卷名 + 章节数 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-nf-text-secondary mb-1.5 block">
                {t("volumeGen.volumeName")}
              </label>
              <input
                type="text"
                value={volumeName}
                onChange={(e) => setVolumeName(e.target.value)}
                placeholder={t("volumeGen.volumeNamePlaceholder")}
                className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
              />
            </div>
            <div>
              <label className="text-xs text-nf-text-secondary mb-1.5 block">
                {t("volumeGen.chapterCount")}
              </label>
              <input
                type="number"
                min={1}
                max={500}
                value={chapterCount}
                onChange={(e) => setChapterCount(parseInt(e.target.value) || 0)}
                className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
              />
            </div>
          </div>

          {/* 快捷章节数 */}
          <div className="flex flex-wrap gap-1.5">
            {quickCounts.map((n) => (
              <button
                key={n}
                onClick={() => setChapterCount(n)}
                className={`px-2.5 py-1 text-xs border transition duration-fast ${
                  chapterCount === n
                    ? "bg-fandex-primary/15 text-fandex-primary border-fandex-primary/40"
                    : "text-nf-text-secondary bg-nf-bg border-nf-border-light hover:border-fandex-primary/50"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          {/* 起始章号 + 标题格式 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-nf-text-secondary mb-1.5 block">
                {t("volumeGen.startChapter")}
              </label>
              <input
                type="number"
                min={1}
                value={startNum}
                onChange={(e) => setStartNum(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
              />
            </div>
            <div>
              <label className="text-xs text-nf-text-secondary mb-1.5 block">
                {t("volumeGen.titleFormat")}
              </label>
              <div className="flex gap-1 bg-nf-bg border border-nf-border-light p-0.5">
                {(["chinese", "arabic", "english"] as TitleFormat[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => handleFormatChange(f)}
                    className={`flex-1 px-2 py-1.5 text-xs transition duration-fast ${
                      format === f
                        ? "bg-fandex-primary/15 text-fandex-primary"
                        : "text-nf-text-tertiary hover:text-nf-text"
                    }`}
                  >
                    {f === "chinese" && t("volumeGen.fmtChinese")}
                    {f === "arabic" && t("volumeGen.fmtArabic")}
                    {f === "english" && t("volumeGen.fmtEnglish")}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 章节文件名模板：用户自定义文件名格式，支持 {n} 占位符 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-nf-text-secondary">
                {t("volumeGen.chapterNameTemplate")}
              </label>
              <button
                onClick={handleResetTemplate}
                className="text-[10px] text-fandex-primary hover:text-fandex-primary-hover transition duration-fast"
              >
                {t("volumeGen.chapterNameTemplateReset")}
              </button>
            </div>
            <input
              type="text"
              value={chapterNameTemplate}
              onChange={(e) => setChapterNameTemplate(e.target.value)}
              placeholder={t("volumeGen.chapterNameTemplatePlaceholder")}
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast font-mono"
            />
            <p className="text-[10px] text-nf-text-tertiary mt-1 leading-relaxed">
              {t("volumeGen.chapterNameTemplateHint")}
            </p>
          </div>

          {/* 附加选项 */}
          <div>
            <div className="text-xs text-nf-text-secondary mb-2">{t("volumeGen.options")}</div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={withPrologue}
                  onChange={(e) => setWithPrologue(e.target.checked)}
                  className="w-4 h-4 accent-fandex-primary"
                />
                <span className="text-sm text-nf-text">{t("volumeGen.includePrologue")}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={withEpilogue}
                  onChange={(e) => setWithEpilogue(e.target.checked)}
                  className="w-4 h-4 accent-fandex-primary"
                />
                <span className="text-sm text-nf-text">{t("volumeGen.includeEpilogue")}</span>
              </label>
            </div>
          </div>

          {/* 预览列表 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-nf-text-secondary">{t("volumeGen.preview")}</div>
              <div className="text-[10px] text-nf-text-tertiary">
                {preview.length > 0 && t("volumeGen.itemsCount", { count: preview.length })}
              </div>
            </div>
            <div className="bg-nf-bg border border-nf-border-light max-h-48 overflow-y-auto">
              {preview.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-nf-text-tertiary">
                  {t("volumeGen.previewEmpty")}
                </div>
              ) : (
                <ul className="divide-y divide-nf-border-light">
                  {preview.map((item, idx) => (
                    <li
                      key={`${item.relative_path}-${idx}`}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs"
                    >
                      <FileText className="w-3.5 h-3.5 text-fandex-primary flex-shrink-0" />
                      <span className="text-nf-text truncate flex-1">{item.chapter_title}</span>
                      <span
                        className={`px-1.5 py-0.5 text-[10px] flex-shrink-0 ${
                          item.is_prologue
                            ? "bg-fandex-secondary/15 text-fandex-secondary"
                            : item.is_epilogue
                              ? "bg-fandex-tertiary/15 text-fandex-tertiary"
                              : "bg-nf-bg-hover text-nf-text-tertiary"
                        }`}
                      >
                        {item.is_prologue
                          ? t("volumeGen.prologueTag")
                          : item.is_epilogue
                            ? t("volumeGen.epilogueTag")
                            : t("volumeGen.chapterTag")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* 结果统计 */}
          {result && (
            <div className="flex items-center gap-2 p-3 bg-fandex-secondary/5 border border-fandex-secondary/20 text-xs">
              <CheckCircle2 className="w-4 h-4 text-fandex-secondary flex-shrink-0" />
              <span className="text-nf-text-secondary">
                {t("volumeGen.success", {
                  created: result.created,
                  skipped: result.skipped,
                })}
              </span>
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <footer className="flex justify-between items-center px-5 py-3 border-t border-nf-border-light flex-shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-nf-text-tertiary">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>{t("volumeGen.skipExistingHint")}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
            >
              {t("app.close")}
            </button>
            <button
              onClick={handleGenerateClick}
              disabled={!canGenerate}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-nf-text-inverse bg-fandex-primary hover:bg-fandex-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition duration-fast"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {generating ? t("volumeGen.generating") : t("volumeGen.generate")}
            </button>
          </div>
        </footer>
      </div>

      {/* 二次确认对话框:明确告知将创建N个空白文件,防止用户误操作 */}
      <ConfirmDialog
        open={showConfirm}
        title={t("volumeGen.confirmTitle")}
        message={t("volumeGen.confirmMsg", {
          volume: volumeName.trim(),
          count: preview.length,
        })}
        type="confirm"
        confirmLabel={t("volumeGen.confirmOk")}
        onConfirm={handleConfirmGenerate}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
