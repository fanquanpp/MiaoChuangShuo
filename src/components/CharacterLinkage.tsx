// 角色联动组件
//
// 功能概述：
// 提供"角色 ↔ 正文"双向联动的可视化交互层，是模块联动的核心 UI。
// 包含两个高价值能力：
// 1. 角色出场统计面板：扫描全项目 .txt 文件，统计每个角色名的出现次数与分布
// 2. 全局改名对话框：在项目所有 .txt 文件中批量替换角色名，解决作家改名痛苦
//
// 模块职责：
// 1. 渲染角色出场统计抽屉面板（按角色、按文件两个维度）
// 2. 渲染全局改名对话框（输入旧名新名、预览影响、确认执行）
// 3. 调用后端 API 完成统计与替换
// 4. 改名后触发项目树刷新，保证数据一致
//
// 设计理念：
// 让作家从"逐文件查找替换"的机械劳动中解放出来
// 一键查看角色戏份分布，一键完成全局改名

import { useEffect, useState, useCallback } from "react";
import {
  X,
  BarChart3,
  Search as SearchIcon,
  Loader2,
  AlertCircle,
  FileText,
  BookOpen,
  RotateCcw,
  TrendingUp,
} from "lucide-react";
import {
  countCharacterAppearances,
  renameCharacterInProject,
  type CharacterAppearance,
} from "../lib/api";
import { useAppStore } from "../lib/store";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";

// =====================================================================
// 角色出场统计面板
// =====================================================================

interface AppearancePanelProps {
  /** 角色名列表（从角色目录提取） */
  characterNames: string[];
  /** 关闭面板回调 */
  onClose: () => void;
  /** 统计完成后的回调（可用于刷新数据） */
  onRefresh?: () => void;
}

/**
 * 角色出场统计抽屉面板
 * 输入:
 *   characterNames 角色名列表
 *   onClose 关闭回调
 *   onRefresh 刷新回调
 * 输出: JSX 抽屉面板
 * 流程:
 *   1. 挂载时自动调用后端统计接口
 *   2. 展示每个角色的总出场次数、出现文件数
 *   3. 展开角色后显示按文件分布的详细数据
 *   4. 标记正文目录文件（is_manuscript）
 */
export function CharacterAppearancePanel({
  characterNames,
  onClose,
}: AppearancePanelProps) {
  const currentProject = useAppStore((s) => s.currentProject);
  const { showToast } = useToast();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [appearances, setAppearances] = useState<CharacterAppearance[]>([]);
  const [expandedName, setExpandedName] = useState<string | null>(null);

  /**
   * 加载出场统计数据
   * 流程: 调用后端 countCharacterAppearances，处理空角色名与异常
   */
  const loadAppearances = useCallback(async () => {
    if (!currentProject) return;
    const validNames = characterNames.filter((n) => n && n.trim().length > 0);
    if (validNames.length === 0) {
      setAppearances([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await countCharacterAppearances(
        currentProject.path,
        validNames
      );
      setAppearances(result);
    } catch (err) {
      showToast(
        "error",
        t("characterLinkage.statsError") +
          (err instanceof Error ? err.message : String(err))
      );
      setAppearances([]);
    } finally {
      setLoading(false);
    }
  }, [currentProject, characterNames, showToast, t]);

  useEffect(() => {
    loadAppearances();
  }, [loadAppearances]);

  // 统计汇总数据
  const totalCharacters = appearances.length;
  const totalOccurrences = appearances.reduce(
    (sum, a) => sum + a.total_count,
    0
  );
  const activeCharacters = appearances.filter(
    (a) => a.total_count > 0
  ).length;

  return (
    <>
      {/* 遮罩层 */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* 抽屉面板 */}
      <aside
        className="fixed right-0 top-0 bottom-0 w-[480px] max-w-[90vw] bg-nf-bg border-l border-nf-border-light shadow-2xl z-50 flex flex-col"
        role="dialog"
        aria-label={t("characterLinkage.appearanceTitle")}
      >
        {/* 头部 */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-nf-border-light">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-fandex-primary/10 rounded-md">
              <BarChart3 className="w-5 h-5 text-fandex-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold font-display text-nf-text">
                {t("characterLinkage.appearanceTitle")}
              </h2>
              <p className="text-xs text-nf-text-tertiary mt-0.5">
                {t("characterLinkage.appearanceSubtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-hover rounded transition duration-fast"
            aria-label={t("app.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* 统计概览 */}
        {!loading && totalCharacters > 0 && (
          <div className="px-5 py-3 border-b border-nf-border-light bg-nf-bg-hover/30">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-xl font-bold text-fandex-primary">
                  {totalCharacters}
                </div>
                <div className="text-xs text-nf-text-tertiary mt-0.5">
                  {t("characterLinkage.totalChars")}
                </div>
              </div>
              <div>
                <div className="text-xl font-bold text-fandex-secondary">
                  {activeCharacters}
                </div>
                <div className="text-xs text-nf-text-tertiary mt-0.5">
                  {t("characterLinkage.activeChars")}
                </div>
              </div>
              <div>
                <div className="text-xl font-bold text-fandex-tertiary">
                  {totalOccurrences}
                </div>
                <div className="text-xs text-nf-text-tertiary mt-0.5">
                  {t("characterLinkage.totalOccurrences")}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="w-8 h-8 text-fandex-primary animate-spin" />
              <p className="text-sm text-nf-text-secondary">
                {t("characterLinkage.loading")}
              </p>
            </div>
          ) : appearances.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
              <AlertCircle className="w-10 h-10 text-nf-text-tertiary" />
              <p className="text-sm text-nf-text-secondary">
                {t("characterLinkage.noChars")}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-nf-border-light">
              {appearances.map((app) => {
                const isExpanded = expandedName === app.name;
                const hasOccurrences = app.total_count > 0;
                return (
                  <li key={app.name}>
                    <button
                      onClick={() =>
                        setExpandedName(isExpanded ? null : app.name)
                      }
                      className="w-full flex items-center justify-between px-5 py-3 hover:bg-nf-bg-hover transition duration-fast text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            hasOccurrences
                              ? "bg-fandex-secondary"
                              : "bg-nf-text-tertiary"
                          }`}
                        />
                        <span className="text-sm font-medium text-nf-text truncate">
                          {app.name}
                        </span>
                        {hasOccurrences && (
                          <span className="text-xs text-nf-text-tertiary">
                            {t("characterLinkage.inFiles", {
                              count: app.file_count,
                            })}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          className={`text-sm font-bold ${
                            hasOccurrences
                              ? "text-fandex-primary"
                              : "text-nf-text-tertiary"
                          }`}
                        >
                          {app.total_count}
                        </span>
                        {hasOccurrences && (
                          <TrendingUp className="w-3.5 h-3.5 text-fandex-primary/60" />
                        )}
                      </div>
                    </button>
                    {/* 展开的文件分布详情 */}
                    {isExpanded && hasOccurrences && (
                      <div className="px-5 pb-3 bg-nf-bg-hover/20">
                        <ul className="space-y-1 mt-1">
                          {app.files.map((file, idx) => (
                            <li
                              key={idx}
                              className="flex items-center justify-between py-1.5 px-2 text-xs rounded hover:bg-nf-bg-hover/40"
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                {file.is_manuscript ? (
                                  <BookOpen className="w-3.5 h-3.5 text-fandex-secondary flex-shrink-0" />
                                ) : (
                                  <FileText className="w-3.5 h-3.5 text-nf-text-tertiary flex-shrink-0" />
                                )}
                                <span
                                  className="text-nf-text-secondary truncate"
                                  title={file.path}
                                >
                                  {file.path}
                                </span>
                                {file.is_manuscript && (
                                  <span className="text-fandex-secondary text-[10px] px-1 py-0.5 bg-fandex-secondary/10 rounded flex-shrink-0">
                                    {t("characterLinkage.manuscript")}
                                  </span>
                                )}
                              </div>
                              <span className="text-nf-text font-bold ml-2 flex-shrink-0">
                                {file.count}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 底部说明 */}
        {!loading && totalCharacters > 0 && (
          <footer className="px-5 py-3 border-t border-nf-border-light text-xs text-nf-text-tertiary">
            {t("characterLinkage.statsHint")}
          </footer>
        )}
      </aside>
    </>
  );
}

// =====================================================================
// 全局改名对话框
// =====================================================================

interface RenameDialogProps {
  /** 关闭对话框回调 */
  onClose: () => void;
  /** 改名完成后的回调（用于刷新项目树与编辑器） */
  onRenamed: () => void;
  /** 预填的旧角色名（从角色卡片点击触发时传入） */
  defaultOldName?: string;
}

/**
 * 全局改名对话框
 * 输入:
 *   onClose 关闭回调
 *   onRenamed 改名完成回调
 *   defaultOldName 预填旧名
 * 输出: JSX 模态对话框
 * 流程:
 *   1. 输入旧角色名与新角色名
 *   2. 点击确认后调用后端 renameCharacterInProject
 *   3. 显示修改结果（文件数、替换次数）
 *   4. 触发 onRenamed 回调刷新数据
 * 安全提示:
 *   改名为简单字符串替换，存在子串误伤风险
 *   建议作者改名前已通过自动快照机制保留可回滚版本
 */
export function CharacterRenameDialog({
  onClose,
  onRenamed,
  defaultOldName = "",
}: RenameDialogProps) {
  const currentProject = useAppStore((s) => s.currentProject);
  const { showToast } = useToast();
  const { t } = useI18n();
  const [oldName, setOldName] = useState(defaultOldName);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    files_modified: number;
    occurrences: number;
  } | null>(null);

  // 是否可执行改名
  const canRename =
    oldName.trim().length > 0 &&
    newName.trim().length > 0 &&
    oldName.trim() !== newName.trim() &&
    !loading;

  /**
   * 执行全局改名
   * 流程: 调用后端 renameCharacterInProject，处理结果与异常
   */
  const handleRename = useCallback(async () => {
    if (!currentProject || !canRename) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await renameCharacterInProject(
        currentProject.path,
        oldName.trim(),
        newName.trim()
      );
      setResult({
        files_modified: res.files_modified,
        occurrences: res.occurrences,
      });
      showToast(
        "success",
        t("characterLinkage.renameSuccess", {
          files: res.files_modified,
          occurrences: res.occurrences,
        })
      );
      onRenamed();
    } catch (err) {
      showToast(
        "error",
        t("characterLinkage.renameError") +
          (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setLoading(false);
    }
  }, [currentProject, oldName, newName, canRename, showToast, t, onRenamed]);

  /**
   * 关闭对话框（执行过改名时需确认）
   */
  const handleClose = useCallback(() => {
    if (loading) return;
    onClose();
  }, [loading, onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("characterLinkage.renameTitle")}
    >
      <div
        className="w-full max-w-md bg-nf-bg border border-nf-border-light rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-nf-border-light">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-fandex-tertiary/10 rounded-md">
              <RotateCcw className="w-5 h-5 text-fandex-tertiary" />
            </div>
            <h2 className="text-base font-bold font-display text-nf-text">
              {t("characterLinkage.renameTitle")}
            </h2>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="p-1 text-nf-text-tertiary hover:text-nf-text hover:bg-nf-bg-hover rounded transition duration-fast disabled:opacity-50"
            aria-label={t("app.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* 内容区 */}
        <div className="px-5 py-4 space-y-4">
          {/* 风险提示 */}
          <div className="flex items-start gap-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-md">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300/90 leading-relaxed">
              {t("characterLinkage.renameWarning")}
            </p>
          </div>

          {/* 旧名输入 */}
          <div>
            <label className="block text-xs font-medium text-nf-text-secondary mb-1.5">
              {t("characterLinkage.oldName")}
            </label>
            <input
              type="text"
              value={oldName}
              onChange={(e) => setOldName(e.target.value)}
              disabled={loading}
              placeholder={t("characterLinkage.oldNamePlaceholder")}
              className="w-full px-3 py-2 text-sm bg-nf-bg-hover border border-nf-border-light focus:border-fandex-primary/50 focus:outline-none rounded text-nf-text placeholder:text-nf-text-tertiary transition duration-fast"
            />
          </div>

          {/* 新名输入 */}
          <div>
            <label className="block text-xs font-medium text-nf-text-secondary mb-1.5">
              {t("characterLinkage.newName")}
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={loading}
              placeholder={t("characterLinkage.newNamePlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canRename) {
                  handleRename();
                }
              }}
              className="w-full px-3 py-2 text-sm bg-nf-bg-hover border border-nf-border-light focus:border-fandex-primary/50 focus:outline-none rounded text-nf-text placeholder:text-nf-text-tertiary transition duration-fast"
            />
          </div>

          {/* 执行结果 */}
          {result && (
            <div className="flex items-center gap-2 p-3 bg-fandex-secondary/5 border border-fandex-secondary/20 rounded-md">
              <SearchIcon className="w-4 h-4 text-fandex-secondary flex-shrink-0" />
              <p className="text-xs text-fandex-secondary leading-relaxed">
                {t("characterLinkage.renameResult", {
                  files: result.files_modified,
                  occurrences: result.occurrences,
                })}
              </p>
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t border-nf-border-light">
          <button
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-nf-text-secondary hover:text-nf-text border border-nf-border-light hover:border-nf-border rounded transition duration-fast disabled:opacity-50"
          >
            {result ? t("app.close") : t("app.cancel")}
          </button>
          {!result && (
            <button
              onClick={handleRename}
              disabled={!canRename}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-fandex-tertiary hover:bg-fandex-tertiary/80 text-white rounded transition duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              {t("characterLinkage.executeRename")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
