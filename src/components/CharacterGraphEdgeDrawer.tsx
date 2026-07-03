// src/components/CharacterGraphEdgeDrawer.tsx
//
// 人物关系图编辑器连线详情抽屉组件
// 双击连线或点击连线中点关系标签触发, 显示在画布中央模态。
// 表单字段: 关系类型(下拉选择)、关系描述(文本域)。
// 本地草稿 300ms 防抖提交到 store, store 500ms 防抖写入磁盘。
//
// 模块职责:
//   1. 渲染关系类型下拉选择器(8 种内置关系)
//   2. 渲染关系描述文本域(自定义关系说明)
//   3. 防抖提交到 store, 避免高频写入

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useCharacterGraphStore } from "../lib/stores/characterGraphStore";
import {
  RELATION_TYPE_LABELS,
  RELATION_TYPE_COLORS,
  type RelationType,
} from "../lib/stores/characterGraphTypes";
import { useI18n } from "../lib/i18n";

/** 本地草稿防抖时间(毫秒) */
const LOCAL_DEBOUNCE_MS = 300;

/**
 * 关系类型选项数组(用于下拉选择渲染)
 * 遍历 RELATION_TYPE_LABELS 构造, 保证选项与颜色/标签映射一致
 */
const RELATION_OPTIONS: Array<{
  value: RelationType;
  label: string;
  color: string;
}> = (Object.keys(RELATION_TYPE_LABELS) as RelationType[]).map((key) => ({
  value: key,
  label: RELATION_TYPE_LABELS[key],
  color: RELATION_TYPE_COLORS[key],
}));

/**
 * 连线详情抽屉组件
 * 输入: edgeId 选中边 ID, onClose 关闭回调
 * 输出: JSX 抽屉浮层(画布中央模态)
 * 流程:
 *   1. 从 store 读取边数据
 *   2. 初始化本地草稿 state
 *   3. 字段编辑触发 commitToStore(300ms 防抖)
 *   4. 边切换时重新初始化草稿
 */
export default function CharacterGraphEdgeDrawer({
  edgeId,
  onClose,
}: {
  edgeId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const edge = useCharacterGraphStore((s) => s.edges.find((e) => e.id === edgeId));
  const updateEdgeData = useCharacterGraphStore((s) => s.updateEdgeData);

  // 本地草稿定时器引用(组件级隔离, 避免多实例干扰)
  const localCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载时清理定时器, 避免内存泄漏
  useEffect(() => {
    return () => {
      if (localCommitTimer.current) clearTimeout(localCommitTimer.current);
    };
  }, []);

  // 本地草稿(仅在边变化时初始化)
  const [draft, setDraft] = useState<{
    relationType: RelationType;
    description: string;
  }>({ relationType: "other", description: "" });

  useEffect(() => {
    if (edge) {
      setDraft({
        relationType: edge.data.relationType,
        description: edge.data.description,
      });
    }
  }, [edgeId, edge]);

  if (!edge) return null;

  /**
   * 防抖提交到 store
   * 输入: patch 待合并的字段
   * 输出: void
   * 流程: 取消上次定时器, 设置新定时器, 300ms 后提交
   */
  const commitToStore = (patch: {
    relationType?: RelationType;
    description?: string;
  }) => {
    if (localCommitTimer.current) clearTimeout(localCommitTimer.current);
    localCommitTimer.current = setTimeout(() => {
      updateEdgeData(edgeId, {
        relationType: patch.relationType ?? edge.data.relationType,
        description: patch.description ?? edge.data.description,
      });
    }, LOCAL_DEBOUNCE_MS);
  };

  /**
   * 处理关系类型变更
   * 输入: value 关系类型枚举值
   * 输出: void
   * 流程: 更新草稿并提交到 store
   */
  const handleRelationTypeChange = (value: RelationType) => {
    setDraft((prev) => ({ ...prev, relationType: value }));
    commitToStore({ relationType: value });
  };

  /**
   * 处理描述文本变更
   * 输入: value 描述文本
   * 输出: void
   * 流程: 更新草稿并提交到 store
   */
  const handleDescriptionChange = (value: string) => {
    setDraft((prev) => ({ ...prev, description: value }));
    commitToStore({ description: value });
  };

  // 当前选中关系类型对应的颜色(用于下拉选中项的色块预览)
  const currentColor = RELATION_TYPE_COLORS[draft.relationType];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="nf-glass-panel w-full max-w-md bg-nf-bg-card border border-nf-border-light shadow-lg flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-nf-border-light">
          <h3 className="text-sm font-semibold font-display text-nf-text flex items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: currentColor }}
            />
            {t("characterGraph.edgeDrawer.title")}
          </h3>
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
          {/* 关系类型下拉选择 */}
          <div>
            <label className="block text-xs text-nf-text-secondary mb-1">
              {t("characterGraph.edgeDrawer.relationTypeLabel")}
            </label>
            <select
              value={draft.relationType}
              onChange={(e) => {
                const value = e.target.value as RelationType;
                handleRelationTypeChange(value);
              }}
              className="w-full px-2 py-1.5 text-sm bg-nf-bg border border-nf-border-light rounded-none text-nf-text focus:outline-none focus:border-fandex-primary transition duration-fast"
            >
              {RELATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-nf-text-tertiary mt-1">
              {t("characterGraph.edgeDrawer.relationTypeHint")}
            </p>
          </div>

          {/* 关系描述文本域 */}
          <div>
            <label className="block text-xs text-nf-text-secondary mb-1">
              {t("characterGraph.edgeDrawer.descriptionLabel")}
            </label>
            <textarea
              value={draft.description}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              rows={4}
              placeholder={t("characterGraph.edgeDrawer.descriptionPlaceholder")}
              className="w-full px-2 py-1.5 text-sm bg-nf-bg border border-nf-border-light rounded-none text-nf-text focus:outline-none focus:border-fandex-primary resize-none transition duration-fast"
            />
            <p className="text-[10px] text-nf-text-tertiary mt-1">
              {t("characterGraph.edgeDrawer.descriptionHint")}
            </p>
          </div>

          {/* 关系类型颜色预览(只读展示当前选中类型对应颜色) */}
          <div>
            <label className="block text-xs text-nf-text-secondary mb-1">
              {t("characterGraph.edgeDrawer.colorPreviewLabel")}
            </label>
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs bg-nf-bg border border-nf-border-light">
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ backgroundColor: currentColor }}
              />
              <span className="text-nf-text-tertiary">
                {RELATION_TYPE_LABELS[draft.relationType]}
              </span>
            </div>
          </div>
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
