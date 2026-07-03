// src/components/CharacterGraphDrawer.tsx
//
// 人物关系图编辑器节点详情抽屉组件
// 双击节点或右键"编辑详情"触发, 显示在画布中央模态。
// 表单字段: 姓名、身份、标签(逗号分隔)、简介、关联文件。
// 本地草稿 300ms 防抖提交到 store, store 500ms 防抖写入磁盘。

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useCharacterGraphStore } from "../lib/stores/characterGraphStore";
import type { CharacterGraphNodeData } from "../lib/stores/characterGraphTypes";
import { useI18n } from "../lib/i18n";

/** 本地草稿防抖时间(毫秒) */
const LOCAL_DEBOUNCE_MS = 300;

/**
 * 抽屉表单字段配置
 */
interface DrawerField {
  key: keyof CharacterGraphNodeData;
  label: string;
  type: "text" | "textarea" | "tags";
}

/**
 * 构建抽屉表单字段配置(从 i18n 读取 label)
 * 输入: t 翻译函数
 * 输出: DrawerField 数组, 顺序决定表单渲染顺序
 */
function buildDrawerFields(t: (key: string) => string): DrawerField[] {
  return [
    { key: "name", label: t("characterGraph.drawer.nameLabel"), type: "text" },
    { key: "identity", label: t("characterGraph.drawer.identityLabel"), type: "text" },
    { key: "tags", label: t("characterGraph.drawer.tagsLabel"), type: "tags" },
    { key: "brief", label: t("characterGraph.drawer.briefLabel"), type: "textarea" },
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
  const updateNodeData = useCharacterGraphStore((s) => s.updateNodeData);

  useEffect(() => {
    return () => {
      if (localCommitTimer.current) clearTimeout(localCommitTimer.current);
    };
  }, []);

  const commitToStore = (patch: Partial<CharacterGraphNodeData>) => {
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
 * 输出: JSX 抽屉浮层(画布中央模态)
 * 流程:
 *   1. 从 store 读取节点数据
 *   2. 初始化本地草稿 state
 *   3. 字段编辑触发 commitToStore(300ms 防抖)
 *   4. 节点切换时重新初始化草稿
 */
export default function CharacterGraphDrawer({
  nodeId,
  onClose,
}: {
  nodeId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const node = useCharacterGraphStore((s) => s.nodes.find((n) => n.id === nodeId));
  const commitToStore = useDebouncedCommit(nodeId);

  // 本地草稿(仅在节点变化时初始化)
  // tags 字段在表单中以逗号分隔字符串呈现, 提交时拆分为数组
  const [draft, setDraft] = useState<{
    name: string;
    identity: string;
    tagsText: string;
    brief: string;
  }>({ name: "", identity: "", tagsText: "", brief: "" });

  useEffect(() => {
    if (node) {
      setDraft({
        name: node.data.name,
        identity: node.data.identity,
        tagsText: node.data.tags.join(", "),
        brief: node.data.brief,
      });
    }
  }, [nodeId, node]);

  if (!node) return null;

  const fields = buildDrawerFields(t);

  /**
   * 处理 tags 字段变更: 同时更新文本草稿与拆分后的数组提交到 store
   * 输入: value 逗号分隔的标签字符串
   * 输出: void
   * 流程: 拆分字符串为数组(去除空白与空项), 提交到 store
   */
  const handleTagsChange = (value: string) => {
    setDraft((prev) => ({ ...prev, tagsText: value }));
    const tags = value
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    commitToStore({ tags });
  };

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
          <h3 className="text-sm font-semibold font-display text-nf-text">
            {t("characterGraph.drawer.title")}
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
          {fields.map((field) => (
            <div key={field.key}>
              <label className="block text-xs text-nf-text-secondary mb-1">{field.label}</label>
              {field.type === "text" && (
                <input
                  type="text"
                  value={(draft[field.key as keyof typeof draft] as string) ?? ""}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    setDraft((prev) => ({ ...prev, [field.key]: newValue }));
                    commitToStore({ [field.key]: newValue });
                  }}
                  className="w-full px-2 py-1.5 text-sm bg-nf-bg border border-nf-border-light rounded-none text-nf-text focus:outline-none focus:border-fandex-primary transition duration-fast"
                />
              )}
              {field.type === "textarea" && (
                <textarea
                  value={(draft[field.key as keyof typeof draft] as string) ?? ""}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    setDraft((prev) => ({ ...prev, [field.key]: newValue }));
                    commitToStore({ [field.key]: newValue });
                  }}
                  rows={4}
                  className="w-full px-2 py-1.5 text-sm bg-nf-bg border border-nf-border-light rounded-none text-nf-text focus:outline-none focus:border-fandex-primary resize-none transition duration-fast"
                />
              )}
              {field.type === "tags" && (
                <>
                  <input
                    type="text"
                    value={draft.tagsText}
                    onChange={(e) => handleTagsChange(e.target.value)}
                    placeholder={t("characterGraph.drawer.tagsPlaceholder")}
                    className="w-full px-2 py-1.5 text-sm bg-nf-bg border border-nf-border-light rounded-none text-nf-text focus:outline-none focus:border-fandex-primary transition duration-fast"
                  />
                  <p className="text-[10px] text-nf-text-tertiary mt-1">
                    {t("characterGraph.drawer.tagsHint")}
                  </p>
                </>
              )}
            </div>
          ))}

          {/* 关联文件信息(只读展示) */}
          {node.data.sourceFile && (
            <div>
              <label className="block text-xs text-nf-text-secondary mb-1">
                {t("characterGraph.drawer.sourceFileLabel")}
              </label>
              <div className="px-2 py-1.5 text-xs bg-nf-bg border border-nf-border-light text-nf-text-tertiary truncate">
                {node.data.sourceFile}
              </div>
            </div>
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
