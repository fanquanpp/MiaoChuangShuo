// 伏笔追踪面板组件
//
// 功能概述:
// 展示项目下所有伏笔的统计概览与按状态分组的可展开列表,
// 支持新建/编辑/删除伏笔,以及跳转到关联的埋设/回收章节。
// 采用 FANDEX 配色(bg-zinc-950 背景 + bg-zinc-900/40 面板),使用 Framer Motion 实现抽屉动画。
//
// 模块职责:
//   1. 顶部统计概览:总数 / 已埋设 / 已回收 / 已放弃(4 张卡片)
//   2. 按状态分组的可展开列表(planted/setup/resolved/abandoned 4 组)
//   3. 每条伏笔:标题 / 重要度标签 / 备注 / 跳转埋设章节 / 跳转回收章节 / 编辑 / 删除
//   4. 右上角新建伏笔按钮(Plus 图标)
//   5. 点击标题展开详情编辑抽屉(Framer Motion spring, duration 0.4, bounce 0.15)

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Eye,
  Plus,
  Pencil,
  Trash2,
  ArrowRight,
  ChevronDown,
  X,
} from "lucide-react";

import { useAppStore } from "../lib/store";
import { useForeshadowingStore } from "../lib/stores/useForeshadowingStore";
import type {
  Foreshadowing,
  ForeshadowingStatus,
  ForeshadowingImportance,
} from "../lib/api/foreshadowingApi";
import { getManifest } from "../lib/api/manifestApi";
import { findFileByPath } from "../lib/fileTreeUtils";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import { logger } from "../lib/logger";

// 状态分组顺序:已埋设 → 铺垫中 → 已回收 → 已放弃
const STATUS_ORDER: ForeshadowingStatus[] = ["planted", "setup", "resolved", "abandoned"];

// 重要度颜色映射(high 红 / medium 黄 / low 绿)
const IMPORTANCE_COLOR: Record<ForeshadowingImportance, string> = {
  high: "bg-red-500/15 text-red-400 border-red-500/30",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  low: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

// 状态对应统计卡片颜色映射
const STATUS_CARD_COLOR: Record<ForeshadowingStatus, string> = {
  planted: "border-zinc-700/60 text-zinc-200",
  setup: "border-sky-500/30 text-sky-300",
  resolved: "border-emerald-500/30 text-emerald-300",
  abandoned: "border-zinc-700/60 text-zinc-500",
};

// 抽屉动画参数:duration 0.4, bounce 0.15
const DRAWER_TRANSITION = { type: "spring" as const, duration: 0.4, bounce: 0.15 };

/**
 * 伏笔追踪面板组件
 * 输入: 无(通过 useAppStore 获取当前项目)
 * 输出: JSX 面板界面(统计卡片 + 分组列表 + 编辑抽屉)
 * 流程:
 *   1. 项目加载时拉取伏笔列表
 *   2. 渲染 4 张统计概览卡片
 *   3. 渲染按状态分组的可展开列表
 *   4. 点击标题或编辑按钮展开抽屉
 *   5. 新建按钮创建默认伏笔并立即打开抽屉
 */
export default function ForeshadowingPanel() {
  const currentProject = useAppStore((s) => s.currentProject);
  const projectTree = useAppStore((s) => s.projectTree);
  const navigateToFile = useAppStore((s) => s.navigateToFile);

  const foreshadowings = useForeshadowingStore((s) => s.foreshadowings);
  const loading = useForeshadowingStore((s) => s.loading);
  const error = useForeshadowingStore((s) => s.error);
  const fetchList = useForeshadowingStore((s) => s.fetchList);
  const createForeshadowingAction = useForeshadowingStore((s) => s.create);
  const updateForeshadowingAction = useForeshadowingStore((s) => s.update);
  const removeForeshadowingAction = useForeshadowingStore((s) => s.remove);

  const { showToast } = useToast();
  const { t } = useI18n();

  // 编辑抽屉状态:null 表示关闭,否则为正在编辑的伏笔对象
  // 新建时构造一个临时对象(含临时空 id),保存时调用 create
  const [editing, setEditing] = useState<Foreshadowing | null>(null);
  // 是否为新建模式(决定保存时调用 create 还是 update)
  const [isCreating, setIsCreating] = useState(false);

  // 各分组的展开状态(默认全部展开)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<ForeshadowingStatus>>(new Set());

  // 项目切换时拉取伏笔列表
  useEffect(() => {
    if (currentProject) {
      fetchList(currentProject.path);
    }
  }, [currentProject, fetchList]);

  // 加载或操作失败时显示 toast
  useEffect(() => {
    if (error) {
      showToast("error", error);
    }
  }, [error, showToast]);

  /**
   * 统计数据:总数 / 各状态计数
   * 通过 useMemo 派生,避免每次渲染重新计算
   */
  const stats = useMemo(() => {
    const total = foreshadowings.length;
    const planted = foreshadowings.filter((f) => f.status === "planted").length;
    const setup = foreshadowings.filter((f) => f.status === "setup").length;
    const resolved = foreshadowings.filter((f) => f.status === "resolved").length;
    const abandoned = foreshadowings.filter((f) => f.status === "abandoned").length;
    return { total, planted, setup, resolved, abandoned };
  }, [foreshadowings]);

  /**
   * 按状态分组的伏笔映射
   */
  const groupedByStatus = useMemo(() => {
    const map: Record<ForeshadowingStatus, Foreshadowing[]> = {
      planted: [],
      setup: [],
      resolved: [],
      abandoned: [],
    };
    for (const f of foreshadowings) {
      map[f.status].push(f);
    }
    return map;
  }, [foreshadowings]);

  /**
   * 跳转到关联章节
   * 输入: chapterId 章节 UUID
   * 输出: Promise<void>
   * 流程:
   *   1. 读取 manifest 查找 chapterId 对应的 sourceFile
   *   2. 通过 findFileByPath 在项目目录树中定位 FileNode
   *   3. 调用 navigateToFile 切换到正文分类并打开文件
   *   4. 任一步失败时显示错误 toast
   */
  const handleJumpToChapter = useCallback(
    async (chapterId: string | null): Promise<void> => {
      if (!currentProject || !chapterId) {
        showToast("error", t("foreshadowing.jumpFailed"));
        return;
      }
      try {
        const manifest = await getManifest(currentProject.path);
        const chapterEntity = manifest.entities.chapters.find(
          (c) => c.id === chapterId,
        );
        if (!chapterEntity) {
          showToast("error", t("foreshadowing.jumpFailed"));
          return;
        }
        const fileNode = findFileByPath(projectTree, chapterEntity.source_file);
        if (!fileNode) {
          showToast("error", t("foreshadowing.jumpFailed"));
          return;
        }
        navigateToFile(fileNode, "manuscript");
      } catch (e) {
        logger.error("跳转伏笔关联章节失败:", e instanceof Error ? e : String(e));
        showToast("error", t("foreshadowing.jumpFailed"));
      }
    },
    [currentProject, projectTree, navigateToFile, showToast, t],
  );

  /**
   * 切换分组展开/折叠
   */
  const toggleGroup = useCallback((status: ForeshadowingStatus): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }, []);

  /**
   * 打开新建抽屉
   * 构造一个临时伏笔对象,保存时调用 create
   */
  const handleOpenCreate = useCallback((): void => {
    const now = new Date().toISOString();
    setEditing({
      id: "",
      title: "",
      status: "planted",
      setupChapterId: null,
      resolutionChapterId: null,
      importance: "medium",
      note: "",
      createdAt: now,
      updatedAt: now,
    });
    setIsCreating(true);
  }, []);

  /**
   * 打开编辑抽屉
   */
  const handleOpenEdit = useCallback((f: Foreshadowing): void => {
    setEditing({ ...f });
    setIsCreating(false);
  }, []);

  /**
   * 关闭抽屉
   */
  const handleCloseDrawer = useCallback((): void => {
    setEditing(null);
    setIsCreating(false);
  }, []);

  /**
   * 抽屉内字段变更
   */
  const handleFieldChange = useCallback(
    <K extends keyof Foreshadowing>(key: K, value: Foreshadowing[K]): void => {
      setEditing((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    [],
  );

  /**
   * 保存抽屉(新建调用 create,编辑调用 update)
   */
  const handleSave = useCallback(async (): Promise<void> => {
    if (!currentProject || !editing) return;
    // 标题必填校验
    if (!editing.title.trim()) {
      showToast("error", t("foreshadowing.titleField"));
      return;
    }
    try {
      if (isCreating) {
        await createForeshadowingAction(currentProject.path, {
          title: editing.title.trim(),
          status: editing.status,
          setupChapterId: editing.setupChapterId,
          resolutionChapterId: editing.resolutionChapterId,
          importance: editing.importance,
          note: editing.note,
        });
        showToast("success", t("foreshadowing.create"));
      } else {
        await updateForeshadowingAction(currentProject.path, { ...editing, title: editing.title.trim() });
        showToast("success", t("app.save"));
      }
      handleCloseDrawer();
    } catch (e) {
      // store 已设置 error,toast 由 useEffect 统一处理
      logger.error("保存伏笔失败:", e instanceof Error ? e : String(e));
    }
  }, [
    currentProject,
    editing,
    isCreating,
    createForeshadowingAction,
    updateForeshadowingAction,
    handleCloseDrawer,
    showToast,
    t,
  ]);

  /**
   * 删除伏笔(带二次确认)
   */
  const handleDelete = useCallback(
    async (f: Foreshadowing): Promise<void> => {
      if (!currentProject) return;
      // 浏览器原生确认对话框,简化实现
      const confirmed = window.confirm(t("foreshadowing.deleteConfirm"));
      if (!confirmed) return;
      try {
        await removeForeshadowingAction(currentProject.path, f.id);
        showToast("success", t("foreshadowing.delete"));
      } catch (e) {
        logger.error("删除伏笔失败:", e instanceof Error ? e : String(e));
      }
    },
    [currentProject, removeForeshadowingAction, showToast, t],
  );

  // 渲染单张统计卡片
  const renderStatCard = (
    label: string,
    value: number,
    extraClass: string,
  ): React.ReactNode => (
    <div
      className={`flex flex-col gap-1 px-4 py-3 border ${extraClass} bg-zinc-900/40`}
    >
      <span className="text-xs uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="text-2xl font-semibold font-display">{value}</span>
    </div>
  );

  // 渲染单条伏笔行
  const renderForeshadowingItem = (f: Foreshadowing): React.ReactNode => (
    <div
      key={f.id}
      className="group flex items-start gap-3 px-4 py-3 border-b border-zinc-800/60 hover:bg-zinc-900/60 transition-colors"
    >
      {/* 标题与备注 */}
      <button
        type="button"
        onClick={() => handleOpenEdit(f)}
        className="flex-1 min-w-0 text-left"
      >
        <div className="text-sm font-medium text-zinc-100 truncate group-hover:text-white">
          {f.title || t("foreshadowing.empty")}
        </div>
        {f.note && (
          <div className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{f.note}</div>
        )}
      </button>

      {/* 重要度标签 */}
      <span
        className={`inline-flex items-center px-1.5 py-0.5 text-[10px] border ${IMPORTANCE_COLOR[f.importance]}`}
      >
        {t(`foreshadowing.importance.${f.importance}`)}
      </span>

      {/* 跳转埋设章节 */}
      <button
        type="button"
        onClick={() => handleJumpToChapter(f.setupChapterId)}
        disabled={!f.setupChapterId}
        title={t("foreshadowing.jumpToSetup")}
        className="opacity-0 group-hover:opacity-100 disabled:opacity-20 disabled:cursor-not-allowed p-1 text-zinc-400 hover:text-sky-300 transition-colors"
      >
        <ArrowRight className="w-3.5 h-3.5" />
      </button>

      {/* 跳转回收章节 */}
      <button
        type="button"
        onClick={() => handleJumpToChapter(f.resolutionChapterId)}
        disabled={!f.resolutionChapterId}
        title={t("foreshadowing.jumpToResolution")}
        className="opacity-0 group-hover:opacity-100 disabled:opacity-20 disabled:cursor-not-allowed p-1 text-zinc-400 hover:text-emerald-300 transition-colors"
      >
        <ArrowRight className="w-3.5 h-3.5" />
      </button>

      {/* 编辑 */}
      <button
        type="button"
        onClick={() => handleOpenEdit(f)}
        title={t("foreshadowing.edit")}
        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-zinc-100 transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>

      {/* 删除 */}
      <button
        type="button"
        onClick={() => handleDelete(f)}
        title={t("foreshadowing.delete")}
        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-400 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  // 渲染分组
  const renderGroup = (status: ForeshadowingStatus): React.ReactNode => {
    const list = groupedByStatus[status];
    const collapsed = collapsedGroups.has(status);
    return (
      <div key={status} className="border border-zinc-800/60 bg-zinc-900/40">
        <button
          type="button"
          onClick={() => toggleGroup(status)}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-zinc-800/40 transition-colors"
        >
          <ChevronDown
            className={`w-4 h-4 text-zinc-500 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          />
          <span className="text-sm font-medium text-zinc-200">
            {t(`foreshadowing.status.${status}`)}
          </span>
          <span className="text-xs text-zinc-500">({list.length})</span>
        </button>
        <AnimatePresence initial={false}>
          {!collapsed && list.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {list.map(renderForeshadowingItem)}
            </motion.div>
          )}
          {!collapsed && list.length === 0 && (
            <div className="px-4 py-3 text-xs text-zinc-600">{t("foreshadowing.empty")}</div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="h-full w-full bg-zinc-950 overflow-hidden flex flex-col">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-orange-400" />
          <h2 className="text-sm font-semibold font-display text-zinc-100">
            {t("foreshadowing.title")}
          </h2>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="flex items-center gap-1 px-3 py-1.5 text-xs border border-zinc-700 hover:border-orange-500/50 hover:text-orange-300 text-zinc-300 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("foreshadowing.create")}
        </button>
      </div>

      {/* 统计概览卡片 */}
      <div className="grid grid-cols-4 gap-3 px-6 py-4">
        {renderStatCard(t("foreshadowing.stats.total"), stats.total, "border-zinc-700/60 text-zinc-200")}
        {renderStatCard(t("foreshadowing.status.planted"), stats.planted, STATUS_CARD_COLOR.planted)}
        {renderStatCard(t("foreshadowing.status.resolved"), stats.resolved, STATUS_CARD_COLOR.resolved)}
        {renderStatCard(t("foreshadowing.status.abandoned"), stats.abandoned, STATUS_CARD_COLOR.abandoned)}
      </div>

      {/* 分组列表 */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-3">
        {loading && foreshadowings.length === 0 ? (
          <div className="text-center text-sm text-zinc-500 py-8">{t("common.loading")}</div>
        ) : foreshadowings.length === 0 ? (
          <div className="text-center text-sm text-zinc-500 py-8">{t("foreshadowing.empty")}</div>
        ) : (
          STATUS_ORDER.map(renderGroup)
        )}
      </div>

      {/* 编辑抽屉(Framer Motion spring 动画) */}
      <AnimatePresence>
        {editing && (
          <motion.div
            className="fixed inset-0 z-50 flex justify-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* 背景遮罩 */}
            <div
              className="absolute inset-0 bg-black/50"
              onClick={handleCloseDrawer}
            />

            {/* 抽屉本体 */}
            <motion.div
              className="relative h-full w-full max-w-md bg-zinc-950 border-l border-zinc-800 flex flex-col"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={DRAWER_TRANSITION}
            >
              {/* 抽屉头部 */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                <h3 className="text-sm font-semibold text-zinc-100">
                  {isCreating ? t("foreshadowing.create") : t("foreshadowing.edit")}
                </h3>
                <button
                  type="button"
                  onClick={handleCloseDrawer}
                  className="p-1 text-zinc-400 hover:text-zinc-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 抽屉内容(可滚动) */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {/* 标题 */}
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-400">
                    {t("foreshadowing.titleField")}
                  </label>
                  <input
                    type="text"
                    value={editing.title}
                    onChange={(e) => handleFieldChange("title", e.target.value)}
                    placeholder={t("foreshadowing.titleField")}
                    className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 text-zinc-100 focus:border-orange-500/50 focus:outline-none"
                  />
                </div>

                {/* 状态 */}
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-400">
                    {t("foreshadowing.status.planted")} / {t("foreshadowing.status.setup")} / {t("foreshadowing.status.resolved")} / {t("foreshadowing.status.abandoned")}
                  </label>
                  <select
                    value={editing.status}
                    onChange={(e) =>
                      handleFieldChange("status", e.target.value as ForeshadowingStatus)
                    }
                    className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 text-zinc-100 focus:border-orange-500/50 focus:outline-none"
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {t(`foreshadowing.status.${s}`)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 重要度 */}
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-400">
                    {t("foreshadowing.importance")}
                  </label>
                  <select
                    value={editing.importance}
                    onChange={(e) =>
                      handleFieldChange("importance", e.target.value as ForeshadowingImportance)
                    }
                    className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 text-zinc-100 focus:border-orange-500/50 focus:outline-none"
                  >
                    {(["high", "medium", "low"] as const).map((i) => (
                      <option key={i} value={i}>
                        {t(`foreshadowing.importance.${i}`)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 埋设章节 UUID(手动输入或后续接入选择器) */}
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-400">
                    {t("foreshadowing.setupChapter")}
                  </label>
                  <input
                    type="text"
                    value={editing.setupChapterId ?? ""}
                    onChange={(e) =>
                      handleFieldChange("setupChapterId", e.target.value || null)
                    }
                    placeholder="UUID"
                    className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 text-zinc-100 focus:border-orange-500/50 focus:outline-none font-mono"
                  />
                </div>

                {/* 回收章节 UUID */}
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-400">
                    {t("foreshadowing.resolutionChapter")}
                  </label>
                  <input
                    type="text"
                    value={editing.resolutionChapterId ?? ""}
                    onChange={(e) =>
                      handleFieldChange("resolutionChapterId", e.target.value || null)
                    }
                    placeholder="UUID"
                    className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 text-zinc-100 focus:border-orange-500/50 focus:outline-none font-mono"
                  />
                </div>

                {/* 备注 */}
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-400">{t("foreshadowing.note")}</label>
                  <textarea
                    value={editing.note}
                    onChange={(e) => handleFieldChange("note", e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 text-zinc-100 focus:border-orange-500/50 focus:outline-none resize-none"
                  />
                </div>
              </div>

              {/* 抽屉底部操作按钮 */}
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={handleCloseDrawer}
                  className="px-4 py-1.5 text-xs border border-zinc-700 text-zinc-300 hover:text-zinc-100"
                >
                  {t("app.cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="px-4 py-1.5 text-xs bg-orange-500/90 hover:bg-orange-500 text-zinc-950 font-medium"
                >
                  {t("app.save")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
