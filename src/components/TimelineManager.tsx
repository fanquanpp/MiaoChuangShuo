// 时间线管理组件
//
// 功能概述：
// 用于管理小说项目的时间线，支持线性时间线与分支多线并行。
// 以可视化卡片形式展示事件节点，支持增删改查。
// 采用 FANDEX 直角美学与三色品牌体系。
//
// 模块职责：
// 1. 渲染时间线事件卡片(按时间排序)
// 2. 支持新建事件(含时间、标题、描述、分支标签)
// 3. 支持编辑与删除事件
// 4. 支持分支筛选

import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Trash2, Edit3, GitBranch, Clock, X } from "lucide-react";
import { useAppStore } from "../lib/store";
import { readFile, writeFile, deletePath, readProjectTree } from "../lib/api";
import type { FileNode } from "../lib/api";
import { findDirByName, getAbsolutePath } from "../lib/fileTreeUtils";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import ConfirmDialog from "./ConfirmDialog";
import { SkeletonLines } from "./SkeletonComponents";

interface TimelineEvent {
  relativePath: string;
  time: string;
  title: string;
  description: string;
  branch: string;
}

// Locale-independent constants for data storage keys
const TIMELINE_DIR = "时间线";
const ALL_BRANCHES = "__all__";
const MAIN_BRANCH = "主线";

export default function TimelineManager() {
  const currentProject = useAppStore((s) => s.currentProject);
  const { t } = useI18n();
  const { showToast } = useToast();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [branches, setBranches] = useState<string[]>([MAIN_BRANCH]);
  const [activeBranch, setActiveBranch] = useState<string>(ALL_BRANCHES);
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TimelineEvent | null>(null);

  const parseEvent = (content: string, relativePath: string): TimelineEvent => {
    const lines = content.split("\n");
    let title = "";
    let time = "";
    let description = "";
    let branch = MAIN_BRANCH;
    let inDescription = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("# ")) {
        title = trimmed.slice(2);
      } else if (trimmed.startsWith("- 时间:")) {
        time = trimmed.replace("- 时间:", "").trim();
      } else if (trimmed.startsWith("- 分支:")) {
        branch = trimmed.replace("- 分支:", "").trim();
      } else if (trimmed === "---" && !inDescription) {
        inDescription = true;
      } else if (inDescription && trimmed) {
        description += (description ? "\n" : "") + trimmed;
      }
    }

    return { relativePath, time, title, description, branch };
  };

  // 尝试多种时间格式解析，返回可比较的时间戳或 null
  const tryParseTime = (timeStr: string): number | null => {
    // 标准 ISO / 常用日期格式
    const parsed = Date.parse(timeStr);
    if (!isNaN(parsed)) return parsed;

    // 中文日期：2024年1月1日、2024年01月01日
    const cnMatch = timeStr.match(/(\d{1,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
    if (cnMatch) {
      const [, y, m, d] = cnMatch;
      return Date.parse(`${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
    }

    // 公元前后格式：公元前221年 → 负值年份
    const bcMatch = timeStr.match(/公元前\s*(\d+)\s*年/);
    if (bcMatch) return -parseInt(bcMatch[1]) * 365.25 * 86400000;

    // 纯数字年份（如 "2024"、"1999"）
    const yearOnly = timeStr.match(/^(\d{1,4})$/);
    if (yearOnly) return Date.parse(`${yearOnly[1].padStart(4, "0")}-01-01`);

    return null;
  };

  const loadEvents = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    try {
      const tree = await readProjectTree(currentProject.path);
      const dir = findDirByName(tree, TIMELINE_DIR);
      const files = dir?.children.filter((f) => !f.is_dir) || [];

      const eventList: TimelineEvent[] = [];
      const branchSet = new Set<string>([MAIN_BRANCH]);

      for (const file of files) {
        try {
          const content = await readFile(
            getAbsolutePath(currentProject.path, file.relative_path),
            currentProject.path
          );
          const event = parseEvent(content, file.relative_path);
          eventList.push(event);
          branchSet.add(event.branch);
        } catch {
          // 跳过
        }
      }

      eventList.sort((a, b) => {
        const ta = tryParseTime(a.time);
        const tb = tryParseTime(b.time);
        if (ta !== null && tb !== null) return ta - tb;
        if (ta !== null) return -1;
        if (tb !== null) return 1;
        // 都不可解析时按字典序稳定性排序
        return a.time.localeCompare(b.time);
      });
      setEvents(eventList);
      setBranches(Array.from(branchSet));
    } catch (e) {
      console.error("加载时间线失败:", e);
    } finally {
      setLoading(false);
    }
  }, [currentProject]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleCreate = () => {
    setEditingEvent(null);
    setShowEditor(true);
  };

  const handleEdit = (event: TimelineEvent) => {
    setEditingEvent(event);
    setShowEditor(true);
  };

  const handleDelete = (event: TimelineEvent) => {
    setDeleteTarget(event);
  };

  const handleDeleteConfirm = async () => {
    if (!currentProject || !deleteTarget) return;
    const event = deleteTarget;
    setDeleteTarget(null);
    try {
      await deletePath(getAbsolutePath(currentProject.path, event.relativePath), currentProject.path);
      showToast("success", t("timeline.deleted", { title: event.title }));
      await loadEvents();
    } catch (e) {
      showToast("error", t("timeline.deleteFailed", { error: String(e) }));
    }
  };

  const handleSaveEvent = useCallback(async (event: TimelineEvent) => {
    if (!currentProject) return;
    const content = `# ${event.title}\n\n- 时间: ${event.time}\n- 分支: ${event.branch}\n\n---\n\n${event.description}\n`;
    await writeFile(getAbsolutePath(currentProject.path, event.relativePath), content, currentProject.path);
    setShowEditor(false);
    setEditingEvent(null);
    await loadEvents();
  }, [currentProject, loadEvents]);

  const filteredEvents =
    activeBranch === ALL_BRANCHES
      ? events
      : events.filter((e) => e.branch === activeBranch);

  return (
    <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
        <h2 className="fandex-bar-left text-lg font-semibold font-display text-nf-text">
          {t("timeline.title")}
        </h2>
        <button
          onClick={handleCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast"
        >
          <Plus className="w-4 h-4" />
          {t("timeline.newEvent")}
        </button>
      </div>

      <div className="flex items-center gap-1 px-6 py-2 border-b border-nf-border-light bg-nf-bg-sidebar">
        <GitBranch className="w-3.5 h-3.5 text-nf-text-tertiary mr-1" />
        <button
          key={ALL_BRANCHES}
          onClick={() => setActiveBranch(ALL_BRANCHES)}
          className={`px-2.5 py-0.5 text-xs transition duration-fast ${
            activeBranch === ALL_BRANCHES
              ? "bg-fandex-primary/15 text-fandex-primary border border-fandex-primary/40"
              : "text-nf-text-tertiary hover:text-nf-text border border-transparent"
          }`}
        >
          {t("timeline.allBranches")}
        </button>
        {branches.map((b) => (
          <button
            key={b}
            onClick={() => setActiveBranch(b)}
            className={`px-2.5 py-0.5 text-xs transition duration-fast ${
              activeBranch === b
                ? "bg-fandex-primary/15 text-fandex-primary border border-fandex-primary/40"
                : "text-nf-text-tertiary hover:text-nf-text border border-transparent"
            }`}
          >
            {b}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="max-w-3xl mx-auto space-y-6" role="status" aria-label={t("timeline.loading")}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="fandex-bar-left bg-nf-bg-card/40 border border-nf-border-light p-4">
                <SkeletonLines lines={3} />
              </div>
            ))}
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Clock className="w-16 h-16 text-nf-border mb-4" />
            <p className="text-sm text-nf-text-tertiary mb-4">
              {t("timeline.noEvents")}
            </p>
          </div>
        ) : (
          <div className="relative max-w-3xl mx-auto">
            <div className="absolute left-4 top-0 bottom-0 w-px bg-gradient-to-b from-fandex-primary/60 via-nf-border-light to-transparent" />

            {filteredEvents.map((event) => (
              <div
                key={event.relativePath}
                className="relative pl-12 pb-6 group"
              >
                <div className="absolute left-[11px] top-2 w-[10px] h-[10px] bg-fandex-primary border-2 border-nf-bg z-10" />

                <div className="fandex-bar-left bg-nf-bg-card/40 border border-nf-border-light hover:border-fandex-primary/40 p-4 transition duration-fast">
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-fandex-primary font-medium font-display">
                          {event.time}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-fandex-secondary/10 text-fandex-secondary border border-fandex-secondary/20">
                          {event.branch}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold font-display text-nf-text">
                        {event.title}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition duration-fast ml-2">
                      <button
                        onClick={() => handleEdit(event)}
                        className="p-1 text-nf-text-tertiary hover:text-fandex-primary transition duration-fast"
                        title={t("timeline.editEvent")}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(event)}
                        className="p-1 text-nf-text-tertiary hover:text-red-400 transition duration-fast"
                        title={t("timeline.deleteEvent")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {event.description && (
                    <p className="text-xs text-nf-text-secondary leading-relaxed whitespace-pre-wrap">
                      {event.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showEditor && (
        <EventEditor
          event={editingEvent}
          branches={branches}
          onClose={() => {
            setShowEditor(false);
            setEditingEvent(null);
          }}
          onSave={handleSaveEvent}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        type="danger"
        title={t("timeline.confirmDelete", { title: deleteTarget?.title || "" })}
        message={t("timeline.confirmDelete", { title: deleteTarget?.title || "" })}
        confirmLabel={t("app.delete")}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

interface EventEditorProps {
  event: TimelineEvent | null;
  branches: string[];
  onClose: () => void;
  onSave: (event: TimelineEvent) => void;
}

function EventEditor({ event, branches, onClose, onSave }: EventEditorProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [title, setTitle] = useState(event?.title || "");
  const [time, setTime] = useState(event?.time || "");
  const [branch, setBranch] = useState(event?.branch || MAIN_BRANCH);
  const [description, setDescription] = useState(event?.description || "");
  const [newBranch, setNewBranch] = useState("");
  const [saving, setSaving] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Enter" && e.ctrlKey) {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'input, select, textarea, button, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, title, time, branch, description, newBranch]);

  const getRelativePath = () => {
    const fileName = (title || t("timeline.unnamedEvent"))
      .replace(/[<>:"/\\|?*]/g, "_")
      .slice(0, 50);
    return event?.relativePath || `${TIMELINE_DIR}/${fileName}.txt`;
  };

  const handleSave = async () => {
    if (!title.trim()) {
      setTitleError(true);
      showToast("error", t("timeline.titleRequired"));
      return;
    }
    setTitleError(false);
    if (saving) return;
    setSaving(true);
    try {
      const finalBranch = newBranch.trim() || branch;
      await onSave({
        relativePath: getRelativePath(),
        time: time || t("timeline.unknownTime"),
        title: title.trim(),
        description: description.trim(),
        branch: finalBranch,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-lg bg-nf-bg-card border border-nf-border-light shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-nf-border-light">
          <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text">
            {event ? t("timeline.editEvent") : t("timeline.newEvent")}
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-nf-bg-hover text-nf-text-tertiary transition duration-fast"
            title={t("app.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs text-nf-text-secondary mb-1">
              {t("timeline.eventTitle")}
            </label>
            <input
              ref={firstInputRef}
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(false);
              }}
              placeholder={t("timeline.eventTitlePlaceholder")}
              className={`w-full bg-nf-bg border px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none transition duration-fast ${
                titleError
                  ? "border-red-400 focus:border-red-400"
                  : "border-nf-border-light focus:border-fandex-primary/60"
              }`}
            />
            {titleError && (
              <p className="text-[10px] text-red-400 mt-0.5">{t("timeline.titleRequired")}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-nf-text-secondary mb-1">
                {t("timeline.eventTime")}
              </label>
              <input
                type="text"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder={t("timeline.eventTimePlaceholder")}
                className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
              />
            </div>
            <div>
              <label className="block text-xs text-nf-text-secondary mb-1">
                {t("timeline.eventBranch")}
              </label>
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
              >
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-nf-text-secondary mb-1">
              {t("timeline.newBranchLabel")}
            </label>
            <input
              type="text"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              placeholder={t("timeline.newBranchPlaceholder")}
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
            />
          </div>
          <div>
            <label className="block text-xs text-nf-text-secondary mb-1">
              {t("timeline.eventDescription")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("timeline.eventDescriptionPlaceholder")}
              rows={4}
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-nf-border-light">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
          >
            {t("app.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 bg-fandex-primary hover:bg-fandex-primary-hover text-sm font-medium text-nf-text-inverse transition duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? t("timeline.saving") : t("timeline.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
