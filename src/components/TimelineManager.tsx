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
import { findDirByName } from "../lib/fileTreeUtils";
import { useI18n } from "../lib/i18n";

interface TimelineEvent {
  relativePath: string;
  time: string;
  title: string;
  description: string;
  branch: string;
}

export default function TimelineManager() {
  const { currentProject } = useAppStore();
  const { t } = useI18n();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [branches, setBranches] = useState<string[]>([t("timeline.mainBranch")]);
  const [activeBranch, setActiveBranch] = useState<string>(t("timeline.allBranches"));
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [loading, setLoading] = useState(false);

  const parseEvent = (content: string, relativePath: string): TimelineEvent => {
    const lines = content.split("\n");
    let title = "";
    let time = "";
    let description = "";
    let branch = t("timeline.mainBranch");
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

  const loadEvents = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    try {
      const tree = await readProjectTree(currentProject.path);
      const dir = findDirByName(tree, t("timeline.dirName"));
      const files = dir?.children.filter((f) => !f.is_dir) || [];

      const eventList: TimelineEvent[] = [];
      const branchSet = new Set<string>([t("timeline.mainBranch")]);

      for (const file of files) {
        try {
          const content = await readFile(
            `${currentProject.path}\\${file.relative_path}`
          );
          const event = parseEvent(content, file.relative_path);
          eventList.push(event);
          branchSet.add(event.branch);
        } catch {
          // 跳过
        }
      }

      eventList.sort((a, b) => {
        const ta = Date.parse(a.time);
        const tb = Date.parse(b.time);
        if (!isNaN(ta) && !isNaN(tb)) return ta - tb;
        if (!isNaN(ta)) return -1;
        if (!isNaN(tb)) return 1;
        return a.time.localeCompare(b.time);
      });
      setEvents(eventList);
      setBranches(Array.from(branchSet));
    } catch (e) {
      console.error("加载时间线失败:", e);
    } finally {
      setLoading(false);
    }
  }, [currentProject, t]);

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

  const handleDelete = async (event: TimelineEvent) => {
    if (!currentProject) return;
    if (!confirm(t("timeline.confirmDelete", { title: event.title }))) return;
    try {
      await deletePath(`${currentProject.path}\\${event.relativePath}`);
      await loadEvents();
    } catch (e) {
      alert(t("timeline.deleteFailed", { error: String(e) }));
    }
  };

  const handleSaveEvent = useCallback(async (event: TimelineEvent) => {
    if (!currentProject) return;
    const content = `# ${event.title}\n\n- 时间: ${event.time}\n- 分支: ${event.branch}\n\n---\n\n${event.description}\n`;
    await writeFile(`${currentProject.path}\\${event.relativePath}`, content);
    setShowEditor(false);
    setEditingEvent(null);
    await loadEvents();
  }, [currentProject, loadEvents]);

  const filteredEvents =
    activeBranch === t("timeline.allBranches")
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
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition-fast"
        >
          <Plus className="w-4 h-4" />
          {t("timeline.newEvent")}
        </button>
      </div>

      <div className="flex items-center gap-1 px-6 py-2 border-b border-nf-border-light bg-nf-bg-sidebar">
        <GitBranch className="w-3.5 h-3.5 text-nf-text-tertiary mr-1" />
        {[t("timeline.allBranches"), ...branches].map((b) => (
          <button
            key={b}
            onClick={() => setActiveBranch(b)}
            className={`px-2.5 py-0.5 text-xs transition-fast ${
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
          <div className="flex items-center justify-center h-full text-nf-text-tertiary text-sm">
            {t("timeline.loading")}
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

                <div className="fandex-bar-left bg-nf-bg-card/40 border border-nf-border-light hover:border-fandex-primary/40 p-4 transition-fast">
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
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-fast ml-2">
                      <button
                        onClick={() => handleEdit(event)}
                        className="p-1 text-nf-text-tertiary hover:text-fandex-primary transition-fast"
                        title={t("timeline.editEvent")}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(event)}
                        className="p-1 text-nf-text-tertiary hover:text-red-400 transition-fast"
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
  const [title, setTitle] = useState(event?.title || "");
  const [time, setTime] = useState(event?.time || "");
  const [branch, setBranch] = useState(event?.branch || t("timeline.mainBranch"));
  const [description, setDescription] = useState(event?.description || "");
  const [newBranch, setNewBranch] = useState("");
  const [saving, setSaving] = useState(false);
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
    return event?.relativePath || `${t("timeline.dirName")}/${fileName}.md`;
  };

  const handleSave = async () => {
    if (!title.trim()) {
      alert(t("timeline.titleRequired"));
      return;
    }
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
    <div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-nf-bg-card border border-nf-border-light shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-nf-border-light">
          <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text">
            {event ? t("timeline.editEvent") : t("timeline.newEvent")}
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-nf-bg-hover text-nf-text-tertiary transition-fast"
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
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("timeline.eventTitlePlaceholder")}
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition-fast"
            />
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
                className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition-fast"
              />
            </div>
            <div>
              <label className="block text-xs text-nf-text-secondary mb-1">
                {t("timeline.eventBranch")}
              </label>
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text focus:outline-none focus:border-fandex-primary/60 transition-fast"
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
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition-fast"
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
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition-fast resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-nf-border-light">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition-fast"
          >
            {t("app.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 bg-fandex-primary hover:bg-fandex-primary-hover text-sm font-medium text-nf-text-inverse transition-fast disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? t("timeline.saving") : t("timeline.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
