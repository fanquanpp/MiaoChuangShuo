// src/components/TimelineDrawer.tsx
//
// 时间线编辑器节点详情抽屉组件
// 双击节点或右键"编辑详情"触发, 显示在画布右侧。
// 表单字段: 标题、状态、摘要、核心冲突、关联章节。
// 本地草稿 300ms 防抖提交到 store, store 500ms 防抖写入磁盘。
//
// Task 4.2.2: 新增"关联章节"下拉选择器, 从 manifest 读取章节列表,
//             选中后写入节点 chapterId(UUID), 支持取消关联(置 null)。
// Task 4.2.3: 新增"跳转到章节"按钮, 仅当 chapterId 非空时显示,
//             点击触发 onJumpToChapter 回调(由 TimelinePanel 注入)。

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, ArrowRight, Link2 } from "lucide-react";
import { useTimelineStore } from "../lib/stores/timelineStore";
import type { TimelineNodeData, NodeStatus } from "../lib/stores/timelineTypes";
import { useAppStore } from "../lib/store";
import { useI18n } from "../lib/i18n";

/** 本地草稿防抖时间(毫秒) */
const LOCAL_DEBOUNCE_MS = 300;

/**
 * Manifest 章节实体(与后端 ManifestEntity 对应,仅取 UI 所需字段)
 * 避免引入完整 Manifest 类型, 保持模块内聚
 */
type ManifestChapterEntity = {
  /** 章节唯一标识(UUID v4, 来自 front matter) */
  id: string;
  /** 源文件相对路径(相对项目根, 正斜杠分隔) */
  sourceFile: string;
  /** 章节标题(可选, 为空时 UI 回退显示文件名) */
  title?: string;
};

/**
 * Manifest 根结构快照(仅取 chapters 字段, 用于章节下拉列表)
 */
type ManifestSnapshot = {
  entities: {
    chapters: ManifestChapterEntity[];
  };
};

/**
 * 从相对路径中提取文件名并去除扩展名
 * 输入: sourceFile 相对路径(如 "正文/第一卷/第一章.pmd")
 * 输出: 去除 .txt/.pmd 扩展名的文件名(如 "第一章")
 */
function stripChapterExtension(sourceFile: string): string {
  const fileName = sourceFile.split(/[\\/]/).pop() ?? sourceFile;
  return fileName.replace(/\.(txt|pmd)$/i, "");
}

/**
 * 抽屉表单字段配置
 */
interface DrawerField {
  key: keyof TimelineNodeData;
  label: string;
  type: "text" | "textarea" | "select";
  options?: { value: string; label: string }[];
}

/**
 * 构建抽屉表单字段配置(从 i18n 读取 label)
 * 输入: t 翻译函数
 * 输出: DrawerField 数组, 顺序决定表单渲染顺序
 */
function buildDrawerFields(t: (key: string) => string): DrawerField[] {
  return [
    { key: "title", label: t("timeline.drawer.titleLabel"), type: "text" },
    {
      key: "status",
      label: t("timeline.drawer.statusLabel"),
      type: "select",
      options: [
        { value: "planned", label: t("timeline.status.planned") },
        { value: "writing", label: t("timeline.status.writing") },
        { value: "done", label: t("timeline.status.done") },
      ],
    },
    { key: "summary", label: t("timeline.drawer.summaryLabel"), type: "textarea" },
    { key: "coreConflict", label: t("timeline.drawer.conflictLabel"), type: "textarea" },
  ];
}

/**
 * 抽屉本地草稿提交到 store(防抖 300ms)
 * 关键: 定时器绑定 useRef, 避免多实例互相干扰
 *      组件卸载时清理定时器, 避免内存泄漏
 * 输入: nodeId 当前编辑节点 ID
 * 输出: commitToStore 提交函数(patch 局部更新)
 */
function useDebouncedCommit(nodeId: string) {
  const localCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateNodeData = useTimelineStore((s) => s.updateNodeData);

  useEffect(() => {
    return () => {
      if (localCommitTimer.current) clearTimeout(localCommitTimer.current);
    };
  }, []);

  const commitToStore = (patch: Partial<TimelineNodeData>) => {
    if (localCommitTimer.current) clearTimeout(localCommitTimer.current);
    localCommitTimer.current = setTimeout(() => {
      updateNodeData(nodeId, patch);
    }, LOCAL_DEBOUNCE_MS);
  };

  return commitToStore;
}

/**
 * 节点详情抽屉组件 Props
 * nodeId - 选中节点 ID
 * onClose - 关闭抽屉回调
 * onJumpToChapter - 跳转到章节回调, 参数为章节相对路径(sourceFile)
 *                   由 TimelinePanel 注入, 执行 setActiveCategory + 打开文件
 */
interface TimelineDrawerProps {
  nodeId: string;
  onClose: () => void;
  onJumpToChapter: (sourceFile: string) => void;
}

/**
 * 节点详情抽屉组件
 * 输入: nodeId 选中节点 ID, onClose 关闭回调, onJumpToChapter 跳转章节回调
 * 输出: JSX 抽屉浮层(画布右侧固定定位)
 * 流程:
 *   1. 从 store 读取节点数据
 *   2. 初始化本地草稿 state(含 chapterId)
 *   3. 字段编辑触发 commitToStore(300ms 防抖)
 *   4. 节点切换时重新初始化草稿
 *   5. Task 4.2.2: 加载 manifest 章节列表, 渲染关联章节下拉选择器
 *   6. Task 4.2.3: 当 chapterId 非空时显示"跳转到章节"按钮
 */
export default function TimelineDrawer({ nodeId, onClose, onJumpToChapter }: TimelineDrawerProps) {
  const { t } = useI18n();
  const node = useTimelineStore((s) => s.nodes.find((n) => n.id === nodeId));
  const commitToStore = useDebouncedCommit(nodeId);
  const currentProject = useAppStore((s) => s.currentProject);

  // 本地草稿(仅在节点变化时初始化)
  const [draft, setDraft] = useState<Partial<TimelineNodeData>>({});
  useEffect(() => {
    if (node) {
      setDraft({
        title: node.data.title,
        status: node.data.status,
        summary: node.data.summary,
        coreConflict: node.data.coreConflict,
        chapterId: node.data.chapterId,
      });
    }
  }, [nodeId, node]);

  // Task 4.2.2: 从 manifest 加载章节列表(含 UUID / 标题 / 源文件路径)
  // 通过 get_manifest 命令读取项目 manifest, 提取 chapters 实体列表
  const [chapters, setChapters] = useState<ManifestChapterEntity[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);

  useEffect(() => {
    if (!currentProject) {
      setChapters([]);
      return;
    }
    let cancelled = false;
    setChaptersLoading(true);
    invoke<ManifestSnapshot>("get_manifest", { projectPath: currentProject.path })
      .then((manifest) => {
        if (cancelled) return;
        setChapters(manifest.entities.chapters);
      })
      .catch(() => {
        if (cancelled) return;
        // manifest 加载失败时静默降级为空列表(旧项目可能无 manifest)
        setChapters([]);
      })
      .finally(() => {
        if (!cancelled) setChaptersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProject]);

  if (!node) return null;

  const fields = buildDrawerFields(t);

  // 当前草稿中的 chapterId(可能为 null)
  const currentChapterId = draft.chapterId ?? null;
  // 当前选中的章节实体(用于跳转按钮获取 sourceFile)
  const selectedChapter = currentChapterId
    ? chapters.find((ch) => ch.id === currentChapterId) ?? null
    : null;

  /**
   * 处理章节下拉选择变更
   * 输入: value 选中值(空字符串表示"取消关联", 否则为章节 UUID)
   * 流程: 更新本地草稿 + 防抖提交到 store
   */
  const handleChapterChange = (value: string) => {
    const newChapterId = value === "" ? null : value;
    setDraft({ ...draft, chapterId: newChapterId });
    commitToStore({ chapterId: newChapterId });
  };

  /**
   * 处理跳转到章节按钮点击
   * 流程: 从选中章节实体获取 sourceFile, 调用 onJumpToChapter 回调
   */
  const handleJumpToChapter = () => {
    if (selectedChapter) {
      onJumpToChapter(selectedChapter.sourceFile);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="nf-glass-panel w-full max-w-md bg-nf-bg-card border border-nf-border-light shadow-lg flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-nf-border-light">
          <h3 className="text-sm font-semibold font-display text-nf-text">{t("timeline.drawer.title")}</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-nf-bg-hover text-nf-text-tertiary transition duration-fast"
            aria-label="close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 表单字段 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {fields.map((field) => (
            <div key={field.key}>
              <label className="block text-xs text-nf-text-secondary mb-1">{field.label}</label>
              {field.type === "text" && (
                <input
                  type="text"
                  value={(draft[field.key] as string) ?? ""}
                  onChange={(e) => {
                    const newDraft = { ...draft, [field.key]: e.target.value };
                    setDraft(newDraft);
                    commitToStore({ [field.key]: e.target.value });
                  }}
                  className="w-full px-2 py-1.5 text-sm bg-nf-bg border border-nf-border-light rounded-none text-nf-text focus:outline-none focus:border-fandex-primary transition duration-fast"
                />
              )}
              {field.type === "textarea" && (
                <textarea
                  value={(draft[field.key] as string) ?? ""}
                  onChange={(e) => {
                    const newDraft = { ...draft, [field.key]: e.target.value };
                    setDraft(newDraft);
                    commitToStore({ [field.key]: e.target.value });
                  }}
                  rows={4}
                  className="w-full px-2 py-1.5 text-sm bg-nf-bg border border-nf-border-light rounded-none text-nf-text focus:outline-none focus:border-fandex-primary resize-none transition duration-fast"
                />
              )}
              {field.type === "select" && (
                <select
                  value={(draft[field.key] as string) ?? "planned"}
                  onChange={(e) => {
                    const newDraft = { ...draft, [field.key]: e.target.value as NodeStatus };
                    setDraft(newDraft);
                    commitToStore({ [field.key]: e.target.value as NodeStatus });
                  }}
                  className="w-full px-2 py-1.5 text-sm bg-nf-bg border border-nf-border-light rounded-none text-nf-text focus:outline-none focus:border-fandex-primary transition duration-fast"
                >
                  {field.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
            </div>
          ))}

          {/* Task 4.2.2: 关联章节下拉选择器 */}
          <div>
            <label className="block text-xs text-nf-text-secondary mb-1 flex items-center gap-1">
              <Link2 className="w-3 h-3" />
              {t("timeline.linkChapter.label")}
            </label>
            <select
              value={currentChapterId ?? ""}
              onChange={(e) => handleChapterChange(e.target.value)}
              disabled={chaptersLoading}
              className="w-full px-2 py-1.5 text-sm bg-nf-bg border border-nf-border-light rounded-none text-nf-text focus:outline-none focus:border-fandex-primary transition duration-fast disabled:opacity-50"
            >
              <option value="">{t("timeline.linkChapter.none")}</option>
              {chapters.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.title ?? stripChapterExtension(ch.sourceFile)}
                </option>
              ))}
            </select>
            {chaptersLoading && (
              <p className="text-xs text-nf-text-tertiary mt-1">{t("timeline.linkChapter.loading")}</p>
            )}
            {!chaptersLoading && chapters.length === 0 && (
              <p className="text-xs text-nf-text-tertiary mt-1">{t("timeline.linkChapter.empty")}</p>
            )}
          </div>

          {/* Task 4.2.3: 跳转到章节按钮(仅当 chapterId 非空时显示) */}
          {currentChapterId && (
            <button
              type="button"
              onClick={handleJumpToChapter}
              disabled={!selectedChapter}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-fandex-primary/40 text-fandex-primary hover:bg-fandex-primary/10 transition duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              {t("timeline.linkChapter.jumpToChapter")}
            </button>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-nf-border-light">
          <button
            onClick={onClose}
            className="nf-tool-btn h-8 px-4 text-sm flex items-center justify-center gap-1.5 border border-nf-border-light text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
          >
            {t("app.close") || "关闭"}
          </button>
        </div>
      </div>
    </div>
  );
}
