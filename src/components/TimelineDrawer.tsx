// src/components/TimelineDrawer.tsx
//
// 时间线编辑器节点详情抽屉组件
// 双击节点或右键"编辑详情"触发, 显示在画布右侧。
// 表单字段: 标题、状态、摘要、核心冲突、伏笔备注。
// 本地草稿 300ms 防抖提交到 store, store 500ms 防抖写入磁盘。

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTimelineStore } from "../lib/stores/timelineStore";
import type { TimelineNodeData, NodeStatus } from "../lib/stores/timelineTypes";
import { useI18n } from "../lib/i18n";

/** 本地草稿防抖时间(毫秒) */
const LOCAL_DEBOUNCE_MS = 300;

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
    { key: "foreshadowing", label: t("timeline.drawer.foreshadowingLabel"), type: "textarea" },
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
 * 节点详情抽屉组件
 * 输入: nodeId 选中节点 ID, onClose 关闭回调
 * 输出: JSX 抽屉浮层(画布右侧固定定位)
 * 流程:
 *   1. 从 store 读取节点数据
 *   2. 初始化本地草稿 state
 *   3. 字段编辑触发 commitToStore(300ms 防抖)
 *   4. 节点切换时重新初始化草稿
 */
export default function TimelineDrawer({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const { t } = useI18n();
  const node = useTimelineStore((s) => s.nodes.find((n) => n.id === nodeId));
  const commitToStore = useDebouncedCommit(nodeId);

  // 本地草稿(仅在节点变化时初始化)
  const [draft, setDraft] = useState<Partial<TimelineNodeData>>({});
  useEffect(() => {
    if (node) {
      setDraft({
        title: node.data.title,
        status: node.data.status,
        summary: node.data.summary,
        coreConflict: node.data.coreConflict,
        foreshadowing: node.data.foreshadowing,
      });
    }
  }, [nodeId, node]);

  if (!node) return null;

  const fields = buildDrawerFields(t);

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
