// 时间线管理组件 - 多分支树形可视化
//
// 功能概述：
// 用于管理小说项目的时间线，支持分支多线并行。
// 以泳道图/树形可视化展示事件节点，各分支并行显示为水平轨道，
// 事件按时间定位在水平轴上，跨分支垂直对齐。
// 采用 FANDEX 直角美学与三色品牌体系。
//
// 模块职责：
// 1. 渲染多分支泳道时间线（分支=水平轨道，时间=水平轴）
// 2. 支持新建事件(含时间、标题、描述、分支标签)
// 3. 支持编辑与删除事件
// 4. 支持分支筛选
// 5. 支持缩放控制

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Plus, Trash2, Edit3, GitBranch, Clock, X, ZoomIn, ZoomOut } from "lucide-react";
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

// Branch accent colors for visual distinction
const BRANCH_COLORS = [
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
];

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
  const [zoom, setZoom] = useState(3); // pixels per day, 1=compact 10=dense

  const timelineRef = useRef<HTMLDivElement>(null);

  const getBranchColor = useCallback(
    (branch: string) => {
      const idx = branches.indexOf(branch);
      return BRANCH_COLORS[idx >= 0 ? idx % BRANCH_COLORS.length : 0];
    },
    [branches],
  );

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
            currentProject.path,
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

  const handleSaveEvent = useCallback(
    async (event: TimelineEvent) => {
      if (!currentProject) return;
      const content = `# ${event.title}\n\n- 时间: ${event.time}\n- 分支: ${event.branch}\n\n---\n\n${event.description}\n`;
      await writeFile(getAbsolutePath(currentProject.path, event.relativePath), content, currentProject.path);
      setShowEditor(false);
      setEditingEvent(null);
      await loadEvents();
    },
    [currentProject, loadEvents],
  );

  // ── Derived data for swimlane layout ──────────────────────────────

  const filteredEvents =
    activeBranch === ALL_BRANCHES
      ? events
      : events.filter((e) => e.branch === activeBranch);

  const visibleBranches = useMemo(
    () => (activeBranch === ALL_BRANCHES ? branches : branches.filter((b) => b === activeBranch)),
    [activeBranch, branches],
  );

  // Group events by branch, preserving time-sorted order
  const eventsByBranch = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const b of visibleBranches) map.set(b, []);
    for (const ev of filteredEvents) {
      const arr = map.get(ev.branch);
      if (arr) arr.push(ev);
    }
    return map;
  }, [filteredEvents, visibleBranches]);

  // Compute time → pixel mapping
  const timeLayout = useMemo(() => {
    const DAY_MS = 86400000;
    const PAD = 80; // horizontal padding inside timeline area
    const MIN_WIDTH = 800;

    const timedEvents = filteredEvents
      .map((e) => ({ ...e, _ts: tryParseTime(e.time) }))
      .filter((e) => e._ts !== null);

    if (timedEvents.length === 0) {
      return { minTs: 0, maxTs: DAY_MS, totalWidth: MIN_WIDTH, toX: () => PAD, ticks: [] as number[] };
    }

    const timestamps = timedEvents.map((e) => e._ts as number);
    let minTs = Math.min(...timestamps);
    let maxTs = Math.max(...timestamps);
    if (maxTs === minTs) maxTs = minTs + DAY_MS;

    const rangeDays = (maxTs - minTs) / DAY_MS;
    const contentWidth = Math.max(rangeDays * zoom, MIN_WIDTH - PAD * 2);
    const totalWidth = contentWidth + PAD * 2;

    const toX = (ts: number) => PAD + ((ts - minTs) / (maxTs - minTs)) * contentWidth;

    // Generate sensible tick marks
    const ticks: number[] = [];
    const rangeMs = maxTs - minTs;
    let stepMs: number;
    if (rangeMs > 365.25 * 20 * DAY_MS) stepMs = 365.25 * 5 * DAY_MS; // 5-year
    else if (rangeMs > 365.25 * 5 * DAY_MS) stepMs = 365.25 * DAY_MS; // 1-year
    else if (rangeMs > 365.25 * DAY_MS) stepMs = 365.25 * DAY_MS / 4; // quarter
    else if (rangeMs > 60 * DAY_MS) stepMs = 30 * DAY_MS; // month
    else if (rangeMs > 14 * DAY_MS) stepMs = 7 * DAY_MS; // week
    else stepMs = DAY_MS; // day

    let tick = Math.ceil(minTs / stepMs) * stepMs;
    while (tick <= maxTs) {
      ticks.push(tick);
      tick += stepMs;
    }

    return { minTs, maxTs, totalWidth, toX, ticks };
  }, [filteredEvents, zoom]);

  // Separate events with/without parseable times
  const { timedByBranch, untimedByBranch } = useMemo(() => {
    const timed = new Map<string, (TimelineEvent & { _ts: number })[]>();
    const untimed = new Map<string, TimelineEvent[]>();
    for (const b of visibleBranches) {
      timed.set(b, []);
      untimed.set(b, []);
    }
    for (const ev of filteredEvents) {
      const ts = tryParseTime(ev.time);
      if (ts !== null) {
        timed.get(ev.branch)?.push({ ...ev, _ts: ts });
      } else {
        untimed.get(ev.branch)?.push(ev);
      }
    }
    return { timedByBranch: timed, untimedByBranch: untimed };
  }, [filteredEvents, visibleBranches]);

  const hasUntimed = useMemo(
    () => Array.from(untimedByBranch.values()).some((arr) => arr.length > 0),
    [untimedByBranch],
  );

  const formatTick = (ts: number): string => {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    if (m === 1 && d.getDate() === 1) return `${y}`;
    return `${y}-${String(m).padStart(2, "0")}`;
  };

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────── */}
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

      {/* ── Branch filter + Zoom ───────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-nf-border-light bg-nf-bg-sidebar">
        <div className="flex items-center gap-1 min-w-0">
          <GitBranch className="w-3.5 h-3.5 text-nf-text-tertiary mr-1 flex-shrink-0" />
          <button
            key={ALL_BRANCHES}
            onClick={() => setActiveBranch(ALL_BRANCHES)}
            className={`px-2.5 py-0.5 text-xs transition duration-fast flex-shrink-0 ${
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
              className={`px-2.5 py-0.5 text-xs transition duration-fast flex-shrink-0 ${
                activeBranch === b
                  ? "bg-fandex-primary/15 text-fandex-primary border border-fandex-primary/40"
                  : "text-nf-text-tertiary hover:text-nf-text border border-transparent"
              }`}
            >
              <span
                className="inline-block w-2 h-2 mr-1"
                style={{ backgroundColor: getBranchColor(b) }}
              />
              {b}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 ml-3 flex-shrink-0">
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 1))}
            className="p-1 text-nf-text-tertiary hover:text-nf-text transition duration-fast"
            title={t("timeline.zoomOut") || "Zoom out"}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] text-nf-text-tertiary font-mono w-6 text-center">
            {zoom}x
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(20, z + 1))}
            className="p-1 text-nf-text-tertiary hover:text-nf-text transition duration-fast"
            title={t("timeline.zoomIn") || "Zoom in"}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Timeline body ──────────────────────────────────────── */}
      <div className="flex-1 overflow-auto" ref={timelineRef}>
        {loading ? (
          <div className="p-6 space-y-6" role="status" aria-label={t("timeline.loading")}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="fandex-bar-left bg-nf-bg-card/40 border border-nf-border-light p-4">
                <SkeletonLines lines={3} />
              </div>
            ))}
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Clock className="w-16 h-16 text-nf-border mb-4" />
            <p className="text-sm text-nf-text-tertiary mb-4">{t("timeline.noEvents")}</p>
          </div>
        ) : (
          <div style={{ minWidth: timeLayout.totalWidth }}>
            {/* ── Time axis header ─────────────────────────────── */}
            <div className="sticky top-0 z-20 bg-nf-bg border-b border-nf-border-light" style={{ height: 36 }}>
              <div className="relative h-full">
                {timeLayout.ticks.map((tick) => {
                  const x = timeLayout.toX(tick);
                  return (
                    <div
                      key={tick}
                      className="absolute top-0 h-full flex flex-col justify-end"
                      style={{ left: x }}
                    >
                      <span className="text-[9px] text-nf-text-tertiary font-mono whitespace-nowrap -translate-x-1/2 block">
                        {formatTick(tick)}
                      </span>
                      <div className="w-px h-2 bg-nf-border-light" />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Branch swim-lanes ────────────────────────────── */}
            {visibleBranches.map((branch, laneIdx) => {
              const color = getBranchColor(branch);
              const laneTimed = timedByBranch.get(branch) || [];
              const laneUntimed = untimedByBranch.get(branch) || [];
              const isEven = laneIdx % 2 === 0;

              return (
                <div
                  key={branch}
                  className="relative border-b border-nf-border-light/60"
                  style={{
                    backgroundColor: isEven ? "transparent" : "rgba(0,0,0,0.015)",
                    minHeight: 88,
                  }}
                >
                  {/* Lane accent bar (left edge) */}
                  <div
                    className="absolute left-0 top-0 bottom-0 w-[3px]"
                    style={{ backgroundColor: color }}
                  />

                  {/* Branch label overlay (visible at start of lane) */}
                  <div
                    className="absolute left-[3px] top-0 z-10 flex items-center gap-1.5 px-3 py-1.5"
                    style={{
                      backgroundColor: isEven ? "var(--nf-bg, #1a1a1a)" : "var(--nf-bg-sidebar, #161616)",
                      borderRight: "1px solid rgba(255,255,255,0.06)",
                      minWidth: 100,
                    }}
                  >
                    <span className="w-2 h-2 flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-xs font-semibold font-display text-nf-text whitespace-nowrap">
                      {branch}
                    </span>
                    <span className="text-[10px] text-nf-text-tertiary">
                      {(eventsByBranch.get(branch) || []).length}
                    </span>
                  </div>

                  {/* Vertical grid lines (time references) */}
                  {timeLayout.ticks.map((tick) => (
                    <div
                      key={tick}
                      className="absolute top-0 bottom-0 w-px bg-nf-border-light/20"
                      style={{ left: timeLayout.toX(tick) }}
                    />
                  ))}

                  {/* Horizontal spine line connecting events in this lane */}
                  {laneTimed.length > 0 && (
                    <div
                      className="absolute h-px"
                      style={{
                        top: 44,
                        left: timeLayout.toX(laneTimed[0]._ts),
                        width: Math.max(
                          1,
                          timeLayout.toX(laneTimed[laneTimed.length - 1]._ts) -
                            timeLayout.toX(laneTimed[0]._ts),
                        ),
                        backgroundColor: color,
                        opacity: 0.3,
                      }}
                    />
                  )}

                  {/* Event nodes positioned along the timeline */}
                  {laneTimed.map((event, idx) => {
                    const x = timeLayout.toX(event._ts);
                    return (
                      <div
                        key={event.relativePath}
                        className="absolute group"
                        style={{ left: x, top: 12 }}
                      >
                        {/* Node dot on the spine */}
                        <div
                          className="absolute w-[10px] h-[10px] border-2 border-nf-bg z-10"
                          style={{
                            backgroundColor: color,
                            left: -5,
                            top: 28,
                          }}
                        />
                        {/* Vertical connector from dot to card */}
                        <div
                          className="absolute w-px"
                          style={{
                            left: 0,
                            top: 18,
                            height: 10,
                            backgroundColor: color,
                            opacity: 0.4,
                          }}
                        />

                        {/* Event card */}
                        <div
                          className="absolute -translate-x-1/2 w-[170px] bg-nf-bg-card/80 border border-nf-border-light hover:border-fandex-primary/40 transition duration-fast cursor-pointer"
                          style={{ top: 42, borderLeftColor: color, borderLeftWidth: 2 }}
                          onClick={() => handleEdit(event)}
                        >
                          <div className="px-2.5 py-2">
                            <div className="flex items-center justify-between mb-0.5">
                              <span
                                className="text-[10px] font-mono font-medium"
                                style={{ color }}
                              >
                                {event.time}
                              </span>
                              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition duration-fast">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEdit(event);
                                  }}
                                  className="p-0.5 text-nf-text-tertiary hover:text-fandex-primary transition duration-fast"
                                  title={t("timeline.editEvent")}
                                >
                                  <Edit3 className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(event);
                                  }}
                                  className="p-0.5 text-nf-text-tertiary hover:text-red-400 transition duration-fast"
                                  title={t("timeline.deleteEvent")}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            <h4 className="text-xs font-semibold font-display text-nf-text truncate leading-tight">
                              {event.title}
                            </h4>
                            {event.description && (
                              <p className="text-[10px] text-nf-text-secondary mt-1 leading-relaxed line-clamp-2 whitespace-pre-wrap">
                                {event.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Untimed events indicator */}
                  {laneUntimed.length > 0 && (
                    <div
                      className="absolute right-4 top-2 flex items-center gap-1 px-2 py-0.5 bg-nf-bg-card/60 border border-nf-border-light/40 text-[10px] text-nf-text-tertiary"
                      title={laneUntimed.map((e) => e.title).join(", ")}
                    >
                      <Clock className="w-3 h-3" />
                      {laneUntimed.length} {t("timeline.untimed") || "untimed"}
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── Untimed events section ───────────────────────── */}
            {hasUntimed && (
              <div className="border-t border-nf-border-light">
                <div className="px-4 py-2 bg-nf-bg-sidebar/50">
                  <span className="text-[10px] text-nf-text-tertiary uppercase tracking-wider font-display">
                    {t("timeline.untimedEvents") || "Unplaced Events"}
                  </span>
                </div>
                {visibleBranches.map((branch) => {
                  const laneUntimed = untimedByBranch.get(branch) || [];
                  if (laneUntimed.length === 0) return null;
                  const color = getBranchColor(branch);
                  return (
                    <div key={`untimed-${branch}`} className="px-4 py-2 border-t border-nf-border-light/30">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2" style={{ backgroundColor: color }} />
                        <span className="text-[10px] text-nf-text-tertiary font-display">{branch}</span>
                      </div>
                      <div className="flex flex-wrap gap-2 ml-4">
                        {laneUntimed.map((event) => (
                          <div
                            key={event.relativePath}
                            className="group bg-nf-bg-card/60 border border-nf-border-light hover:border-fandex-primary/40 px-3 py-1.5 cursor-pointer transition duration-fast max-w-[200px]"
                            style={{ borderLeftColor: color, borderLeftWidth: 2 }}
                            onClick={() => handleEdit(event)}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-mono text-nf-text-tertiary">
                                {event.time}
                              </span>
                              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition duration-fast ml-auto">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEdit(event);
                                  }}
                                  className="p-0.5 text-nf-text-tertiary hover:text-fandex-primary"
                                >
                                  <Edit3 className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(event);
                                  }}
                                  className="p-0.5 text-nf-text-tertiary hover:text-red-400"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            <h4 className="text-xs font-semibold font-display text-nf-text truncate">
                              {event.title}
                            </h4>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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

// ── Event Editor Dialog ─────────────────────────────────────────────

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
          'input, select, textarea, button, [tabindex]:not([tabindex="-1"])',
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
