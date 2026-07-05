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
import { X, Plus, Trash2 } from "lucide-react";
import { useCharacterGraphStore } from "../lib/stores/characterGraphStore";
import {
  getAllRelationTypes,
  getRelationMeta,
  addCustomRelationType,
  deleteCustomRelationType,
  type RelationTypeMeta,
} from "../lib/stores/characterGraphTypes";
import { useI18n } from "../lib/i18n";

/** 本地草稿防抖时间(毫秒) */
const LOCAL_DEBOUNCE_MS = 300;

/** 自定义关系类型颜色候选(用户添加时可选) */
const COLOR_CHOICES = [
  "#6EA8FE",
  "#55EFC4",
  "#F09070",
  "#A855F7",
  "#EC4899",
  "#FACC15",
  "#22D3EE",
  "#FB923C",
];

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
  // relationType 类型为 string, 兼容内置 8 种预设与用户自定义关系类型 id
  const [draft, setDraft] = useState<{
    relationType: string;
    description: string;
  }>({ relationType: "other", description: "" });

  // 关系类型选项列表(内置 + 自定义), 每次渲染时从 localStorage 读取, 保证新增后立即显示
  const [relationOptions, setRelationOptions] = useState<RelationTypeMeta[]>(getAllRelationTypes());

  // 新增自定义关系类型的内联表单状态
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRelLabel, setNewRelLabel] = useState("");
  const [newRelColor, setNewRelColor] = useState(COLOR_CHOICES[0]);

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
    relationType?: string;
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
   * 输入: value 关系类型 id(内置字面量或自定义 id)
   * 输出: void
   * 流程: 更新草稿并提交到 store
   */
  const handleRelationTypeChange = (value: string) => {
    setDraft((prev) => ({ ...prev, relationType: value }));
    commitToStore({ relationType: value });
  };

  /**
   * 提交新增自定义关系类型
   * 流程:
   *   1. 校验 label 非空
   *   2. 调用 addCustomRelationType 持久化到 localStorage
   *   3. 刷新关系类型选项列表
   *   4. 自动选中新添加的类型
   *   5. 清空表单并关闭
   */
  const handleAddCustomRelation = () => {
    const trimmed = newRelLabel.trim();
    if (!trimmed) return;
    const created = addCustomRelationType(trimmed, newRelColor);
    if (created) {
      setRelationOptions(getAllRelationTypes());
      handleRelationTypeChange(created.id);
    }
    setNewRelLabel("");
    setNewRelColor(COLOR_CHOICES[0]);
    setShowAddForm(false);
  };

  /**
   * 删除自定义关系类型
   * 输入: id 关系类型 id
   * 流程: 从 localStorage 删除并刷新列表, 不修改已使用该类型的边
   */
  const handleDeleteCustomRelation = (id: string) => {
    deleteCustomRelationType(id);
    setRelationOptions(getAllRelationTypes());
    // 若当前选中项被删除, 回退到 other
    if (draft.relationType === id) {
      handleRelationTypeChange("other");
    }
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

  // 当前选中关系类型对应的元信息(用于色块预览, 兼容自定义类型)
  const currentMeta = getRelationMeta(draft.relationType);
  const currentColor = currentMeta.color;

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
          {/* 关系类型下拉选择 + 新增自定义按钮 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-nf-text-secondary">
                {t("characterGraph.edgeDrawer.relationTypeLabel")}
              </label>
              <button
                type="button"
                onClick={() => setShowAddForm((v) => !v)}
                className="text-[10px] text-fandex-primary hover:text-fandex-secondary transition-colors duration-fast flex items-center gap-0.5"
                title="新增自定义关系类型"
              >
                <Plus className="w-3 h-3" />
                自定义
              </button>
            </div>
            <select
              value={draft.relationType}
              onChange={(e) => {
                const value = e.target.value;
                handleRelationTypeChange(value);
              }}
              className="w-full px-2 py-1.5 text-sm bg-nf-bg border border-nf-border-light rounded-none text-nf-text focus:outline-none focus:border-fandex-primary transition duration-fast"
            >
              {relationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                  {!option.builtin ? " (自定义)" : ""}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-nf-text-tertiary mt-1">
              {t("characterGraph.edgeDrawer.relationTypeHint")}
            </p>

            {/* 新增自定义关系类型表单(可折叠) */}
            {showAddForm && (
              <div className="mt-2 p-2 border border-nf-border-light bg-nf-bg space-y-2">
                <input
                  type="text"
                  value={newRelLabel}
                  onChange={(e) => setNewRelLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddCustomRelation();
                    if (e.key === "Escape") setShowAddForm(false);
                  }}
                  placeholder="关系名称(如 师徒/宿敌/同盟)"
                  className="w-full h-7 px-2 text-xs bg-nf-bg-sidebar border border-nf-border-light text-nf-text placeholder:text-nf-text-tertiary focus:outline-none focus:border-fandex-primary"
                  autoFocus
                />
                {/* 颜色选择器 */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-nf-text-tertiary">颜色:</span>
                  {COLOR_CHOICES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewRelColor(c)}
                      className={`w-4 h-4 rounded-full border transition-all duration-fast ${
                        newRelColor === c ? "border-white scale-110" : "border-nf-border-light"
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={`选择颜色 ${c}`}
                    />
                  ))}
                </div>
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-2 h-6 text-[11px] text-nf-text-tertiary hover:text-nf-text border border-nf-border-light hover:bg-nf-bg-hover transition-colors duration-fast"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleAddCustomRelation}
                    className="px-2 h-6 text-[11px] text-white bg-fandex-primary hover:opacity-90 transition-opacity duration-fast"
                  >
                    添加
                  </button>
                </div>
              </div>
            )}

            {/* 已有自定义关系类型列表(可删除) */}
            {relationOptions.some((o) => !o.builtin) && (
              <div className="mt-2 space-y-1">
                <div className="text-[10px] text-nf-text-tertiary">自定义关系类型:</div>
                {relationOptions.filter((o) => !o.builtin).map((o) => (
                  <div key={o.value} className="flex items-center justify-between px-2 py-1 bg-nf-bg border border-nf-border-light">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: o.color }} />
                      <span className="text-xs text-nf-text-secondary">{o.label}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteCustomRelation(o.value)}
                      className="text-nf-text-tertiary hover:text-fandex-tertiary transition-colors duration-fast"
                      title="删除此自定义关系类型"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
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
                {currentMeta.label}
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
