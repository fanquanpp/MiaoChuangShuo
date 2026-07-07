// 分卷管理组件
//
// 功能概述：
// 为 multi_volume / standard 等文体提供可视化分卷管理界面。
// 支持创建卷名、将正文章节归入对应卷、调整卷序和章节归属。
// 卷宗数据以结构化 .txt 文件存储在项目的卷宗目录中。
//
// 模块职责：
// 1. 读取项目目录树，提取卷宗目录和正文章节
// 2. 渲染分卷列表（每卷含归属章节）
// 3. 支持新建卷、编辑卷名、删除卷
// 4. 支持将章节拖拽归入卷
// 5. 保存卷宗映射到文件

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  BookOpen,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  FileText,
  GripVertical,
  Save,
  Edit3,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { useAppStore, getCategoryDir } from "../lib/store";
import { readProjectTree, readFile, writeFile, createFile } from "../lib/api";
import type { FileNode } from "../lib/api";
import { findDirByName, extractChapterNumber } from "../lib/fileTreeUtils";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import ConfirmDialog from "./ConfirmDialog";

// extractChapterNumber 已统一提取至 lib/fileTreeUtils.ts，消除与 FileList 的重复定义

// 卷数据结构
interface Volume {
  id: string;
  name: string;
  /** 归属的章节文件名列表 */
  chapters: string[];
}

// 卷宗数据文件解析格式：
// [卷名] 第一卷：开篇
// - 第一章：序曲
// - 第二章：启程
// [卷名] 第二卷：风云
// - 第三章：变故

function parseVolumeData(content: string): Volume[] {
  const volumes: Volume[] = [];
  const lines = content.split(/\r?\n/);
  let currentVolume: Volume | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[卷名]")) {
      const name = trimmed.replace("[卷名]", "").trim();
      currentVolume = {
        id: `vol-${volumes.length}`,
        name,
        chapters: [],
      };
      volumes.push(currentVolume);
    } else if (trimmed.startsWith("- ") && currentVolume) {
      currentVolume.chapters.push(trimmed.slice(2).trim());
    }
  }

  return volumes;
}

function serializeVolumeData(volumes: Volume[]): string {
  return volumes
    .map((vol) => {
      const chapters = vol.chapters.map((ch) => `- ${ch}`).join("\n");
      return `[卷名] ${vol.name}\n${chapters}`;
    })
    .join("\n\n");
}

export default function VolumeManager() {
  const currentProject = useAppStore((s) => s.currentProject);
  const { showToast } = useToast();
  const { t } = useI18n();

  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [manuscriptFiles, setManuscriptFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [expandedVolumes, setExpandedVolumes] = useState<Set<string>>(new Set());
  const [editingVolumeId, setEditingVolumeId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Volume | null>(null);

  // 卷宗目录名（所有分卷类文体统一为"卷宗"）
  const volumeDirName = "卷宗";

  useEffect(() => {
    let cancelled = false;
    if (!currentProject) return;
    setLoading(true);
    (async () => {
      try {
        const tree = await readProjectTree(currentProject.path);

        // 读取正文章节
        const manuscriptDir = findDirByName(tree, getCategoryDir("manuscript"));
        const files = manuscriptDir?.children.filter((f) => !f.is_dir) || [];
        // 按章节号排序（使用与 FileList 一致的规则，未识别章节排到末尾而非首位）
        files.sort((a, b) => {
          const numA = extractChapterNumber(a.name);
          const numB = extractChapterNumber(b.name);
          return numA - numB;
        });
        if (cancelled) return;
        setManuscriptFiles(files);

        // 读取卷宗数据文件
        const volumeDir = findDirByName(tree, volumeDirName);
        const volumeFile = volumeDir?.children.find(
          (f) => !f.is_dir && f.name === "分卷规划.txt"
        );

        if (volumeFile) {
          const content = await readFile(
            `${currentProject.path}/${volumeFile.relative_path}`,
            currentProject.path
          );
          if (cancelled) return;
          const parsed = parseVolumeData(content);
          setVolumes(parsed);
          // 默认展开所有卷
          setExpandedVolumes(new Set(parsed.map((v) => v.id)));
        } else {
          if (cancelled) return;
          setVolumes([]);
        }
      } catch (e) {
        if (cancelled) return;
        showToast("error", t("volume.loadFailed", { error: String(e) }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentProject, volumeDirName, showToast, t]);

  // 保存卷宗数据
  const handleSave = useCallback(async () => {
    if (!currentProject || saving) return;
    setSaving(true);
    try {
      const content = serializeVolumeData(volumes);
      const relativePath = `${volumeDirName}/分卷规划.txt`;
      try {
        await writeFile(
          `${currentProject.path}/${relativePath}`,
          content,
          currentProject.path
        );
      } catch {
        // 文件不存在则创建
        await createFile(currentProject.path, relativePath, content);
      }
      setDirty(false);
      showToast("success", t("volume.saved"));
    } catch (e) {
      showToast("error", t("volume.saveFailed", { error: String(e) }));
    } finally {
      setSaving(false);
    }
  }, [currentProject, volumes, volumeDirName, saving, showToast, t]);

  // 新建卷
  const handleAddVolume = () => {
    const newVol: Volume = {
      id: `vol-${Date.now()}`,
      name: t("volume.newVolumeName", { num: volumes.length + 1 }),
      chapters: [],
    };
    setVolumes((prev) => [...prev, newVol]);
    setExpandedVolumes((prev) => new Set([...prev, newVol.id]));
    setDirty(true);
  };

  // 删除卷
  const handleDeleteVolume = (vol: Volume) => {
    setDeleteTarget(vol);
  };

  const confirmDeleteVolume = async () => {
    if (!deleteTarget) return;
    setVolumes((prev) => prev.filter((v) => v.id !== deleteTarget.id));
    setDeleteTarget(null);
    setDirty(true);
  };

  // 编辑卷名
  const startEditName = (vol: Volume) => {
    setEditingVolumeId(vol.id);
    setEditName(vol.name);
  };

  const confirmEditName = () => {
    if (!editingVolumeId || !editName.trim()) return;
    setVolumes((prev) =>
      prev.map((v) =>
        v.id === editingVolumeId ? { ...v, name: editName.trim() } : v
      )
    );
    setEditingVolumeId(null);
    setEditName("");
    setDirty(true);
  };

  const cancelEditName = () => {
    setEditingVolumeId(null);
    setEditName("");
  };

  // 展开/折叠卷
  const toggleVolume = (volId: string) => {
    setExpandedVolumes((prev) => {
      const next = new Set(prev);
      if (next.has(volId)) next.delete(volId);
      else next.add(volId);
      return next;
    });
  };

  // 将章节添加到卷
  const addChapterToVolume = (volId: string, chapterName: string) => {
    setVolumes((prev) => {
      // 先从其他卷中移除该章节（一个章节只属于一个卷）
      const updated = prev.map((v) => ({
        ...v,
        chapters: v.chapters.filter((ch) => ch !== chapterName),
      }));
      // 添加到目标卷
      return updated.map((v) =>
        v.id === volId ? { ...v, chapters: [...v.chapters, chapterName] } : v
      );
    });
    setDirty(true);
  };

  // 从卷中移除章节
  const removeChapterFromVolume = (volId: string, chapterName: string) => {
    setVolumes((prev) =>
      prev.map((v) =>
        v.id === volId
          ? { ...v, chapters: v.chapters.filter((ch) => ch !== chapterName) }
          : v
      )
    );
    setDirty(true);
  };

  // 已归卷的章节集合
  const assignedChapters = useMemo(() => {
    const set = new Set<string>();
    for (const vol of volumes) {
      for (const ch of vol.chapters) {
        set.add(ch);
      }
    }
    return set;
  }, [volumes]);

  // 未归卷的章节
  const unassignedChapters = useMemo(() => {
    return manuscriptFiles.filter(
      (f) => !assignedChapters.has(f.name.replace(/\.txt$/i, ""))
    );
  }, [manuscriptFiles, assignedChapters]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-nf-bg">
        <Loader2 className="w-6 h-6 animate-spin text-fandex-primary" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-fandex-tertiary/10">
            <BookOpen className="w-5 h-5 text-fandex-tertiary" />
          </div>
          <h2 className="fandex-bar-left text-lg font-bold font-display text-nf-text">
            {t("volume.title")}
          </h2>
          <span className="text-xs text-nf-text-tertiary font-mono">
            {volumes.length} {t("volume.unit")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-xs text-fandex-tertiary">{t("volume.unsaved")}</span>
          )}
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {saving ? t("volume.saving") : t("volume.save")}
          </button>
          <button
            onClick={handleAddVolume}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-fandex-tertiary/10 hover:bg-fandex-tertiary/20 text-fandex-tertiary border border-fandex-tertiary/30 transition duration-fast"
          >
            <Plus className="w-4 h-4" />
            {t("volume.addVolume")}
          </button>
        </div>
      </div>

      {/* 主体：双栏布局（卷列表 + 未归卷章节） */}
      <div className="flex-1 flex min-h-0">
        {/* 卷列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {volumes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <BookOpen className="w-12 h-12 text-nf-text-tertiary/40 mb-4" />
              <p className="text-sm text-nf-text-tertiary mb-1">
                {t("volume.empty")}
              </p>
              <p className="text-xs text-nf-text-tertiary/60">
                {t("volume.emptyHint")}
              </p>
            </div>
          ) : (
            volumes.map((vol) => {
              const isExpanded = expandedVolumes.has(vol.id);
              const isEditing = editingVolumeId === vol.id;

              return (
                <div
                  key={vol.id}
                  className="border border-nf-border-light bg-nf-bg-card overflow-hidden"
                >
                  {/* 卷标题栏 */}
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-nf-bg-hover/50 border-b border-nf-border-light">
                    <button
                      onClick={() => toggleVolume(vol.id)}
                      className="text-nf-text-tertiary hover:text-nf-text transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>

                    <BookOpen className="w-4 h-4 text-fandex-tertiary/70 flex-shrink-0" />

                    {isEditing ? (
                      <div className="flex items-center gap-1 flex-1">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") confirmEditName();
                            if (e.key === "Escape") cancelEditName();
                          }}
                          autoFocus
                          className="flex-1 px-2 py-0.5 text-sm bg-nf-bg border border-fandex-primary/40 text-nf-text outline-none"
                        />
                        <button onClick={confirmEditName} className="p-0.5 text-fandex-secondary hover:text-fandex-secondary/80">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={cancelEditName} className="p-0.5 text-nf-text-tertiary hover:text-nf-text">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="text-sm font-medium text-nf-text flex-1 truncate">
                          {vol.name}
                        </span>
                        <span className="text-[10px] text-nf-text-tertiary font-mono">
                          {vol.chapters.length} {t("volume.chapterUnit")}
                        </span>
                        <button
                          onClick={() => startEditName(vol)}
                          className="p-1 text-nf-text-tertiary hover:text-fandex-primary transition-colors opacity-0 group-hover:opacity-100"
                          title={t("volume.rename")}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteVolume(vol)}
                          className="p-1 text-nf-text-tertiary hover:text-red-400 transition-colors"
                          title={t("app.delete")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>

                  {/* 卷内章节列表 */}
                  {isExpanded && (
                    <div className="px-4 py-2 space-y-1">
                      {vol.chapters.length === 0 ? (
                        <p className="text-xs text-nf-text-tertiary py-2 text-center">
                          {t("volume.noChapters")}
                        </p>
                      ) : (
                        vol.chapters.map((ch) => (
                          <div
                            key={ch}
                            className="flex items-center gap-2 px-2 py-1.5 group hover:bg-nf-bg-hover/50 transition-colors"
                          >
                            <GripVertical className="w-3 h-3 text-nf-text-tertiary/40 flex-shrink-0" />
                            <FileText className="w-3.5 h-3.5 text-nf-text-tertiary/60 flex-shrink-0" />
                            <span className="text-xs text-nf-text-secondary flex-1 truncate">
                              {ch}
                            </span>
                            <button
                              onClick={() => removeChapterFromVolume(vol.id, ch)}
                              className="p-0.5 text-nf-text-tertiary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                              title={t("volume.removeChapter")}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))
                      )}

                      {/* 快速添加章节下拉 */}
                      {unassignedChapters.length > 0 && (
                        <div className="pt-2">
                          <select
                            onChange={(e) => {
                              if (e.target.value) {
                                addChapterToVolume(vol.id, e.target.value);
                                e.target.value = "";
                              }
                            }}
                            defaultValue=""
                            className="w-full px-2 py-1 text-xs bg-nf-bg border border-nf-border-light text-nf-text-secondary outline-none cursor-pointer hover:border-fandex-tertiary/40 transition-colors"
                          >
                            <option value="" disabled>
                              + {t("volume.addChapter")}
                            </option>
                            {unassignedChapters.map((f) => (
                              <option
                                key={f.relative_path}
                                value={f.name.replace(/\.txt$/i, "")}
                              >
                                {f.name.replace(/\.txt$/i, "")}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 右侧：未归卷章节列表 */}
        <div className="w-56 border-l border-nf-border-light overflow-y-auto p-3">
          <h3 className="text-xs font-medium text-nf-text-tertiary mb-2 px-1">
            {t("volume.unassigned")} ({unassignedChapters.length})
          </h3>
          {unassignedChapters.length === 0 ? (
            <p className="text-[10px] text-nf-text-tertiary/60 text-center py-4">
              {t("volume.allAssigned")}
            </p>
          ) : (
            <div className="space-y-1">
              {unassignedChapters.map((f) => {
                const name = f.name.replace(/\.txt$/i, "");
                return (
                  <div
                    key={f.relative_path}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs text-nf-text-secondary hover:bg-nf-bg-hover/50 transition-colors group"
                  >
                    <FileText className="w-3 h-3 text-nf-text-tertiary/60 flex-shrink-0" />
                    <span className="flex-1 truncate">{name}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 删除确认框 */}
      <ConfirmDialog
        open={!!deleteTarget}
        type="danger"
        title={t("volume.confirmDelete", { name: deleteTarget?.name || "" })}
        message={t("volume.confirmDeleteMsg", { name: deleteTarget?.name || "" })}
        confirmLabel={t("app.delete")}
        onConfirm={confirmDeleteVolume}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
