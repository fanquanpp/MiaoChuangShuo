// 卡片管理组件
//
// 功能概述：
// 用于角色、世界观、名词等分类的卡片式管理界面。
// 支持卡片的增删改查，每个卡片展开后占用整个编辑区。
//
// 模块职责：
// 1. 渲染卡片网格列表
// 2. 支持新建卡片
// 3. 点击卡片进入编辑模式
// 4. 编辑模式下支持保存与返回

import { useState, useEffect, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Placeholder from "@tiptap/extension-placeholder";
import { Plus, Trash2, ChevronLeft, Save, FileText, Loader2 } from "lucide-react";
import { useAppStore, CATEGORY_DIRS } from "../lib/store";
import { readProjectTree, createFile, deletePath, readFile, writeFile } from "../lib/api";
import type { FileNode } from "../lib/api";
import { findDirByName } from "../lib/fileTreeUtils";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import ConfirmDialog from "./ConfirmDialog";
import { SkeletonBlock } from "./SkeletonComponents";

// 卡片管理属性接口
interface CardManagerProps {
  categoryLabel: string;
}

// 卡片项接口
interface CardItem {
  node: FileNode;
  title: string;
  preview: string;
}

export default function CardManager({ categoryLabel }: CardManagerProps) {
  const { currentProject, activeCategory } = useAppStore();
  const { showToast } = useToast();
  const { t } = useI18n();
  const [cards, setCards] = useState<CardItem[]>([]);
  const [editingCard, setEditingCard] = useState<CardItem | null>(null);
  const [editContent, setEditContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CardItem | null>(null);
  const [showCreatePrompt, setShowCreatePrompt] = useState(false);

  const cardEditor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      Placeholder.configure({ placeholder: t("cardmanager.editorPlaceholder") }),
    ],
    content: "",
    onUpdate: () => setDirty(true),
  });

  useEffect(() => {
    if (!editingCard) {
      setDirty(false);
      setEditContent("");
    }
  }, [editingCard]);

  useEffect(() => {
    if (editingCard && cardEditor && editContent) {
      cardEditor.commands.setContent(editContent);
    }
  }, [editingCard, !!cardEditor]);

  const loadCards = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    try {
      const tree = await readProjectTree(currentProject.path);
      const dirName = CATEGORY_DIRS[activeCategory];
      const dir = findDirByName(tree, dirName);
      const files = dir?.children.filter((f) => !f.is_dir) || [];

      const cardItems: CardItem[] = [];
      for (const file of files) {
        try {
          const content = await readFile(
            `${currentProject.path}/${file.relative_path}`,
            currentProject.path
          );
          cardItems.push({
            node: file,
            title: file.name.replace(/\.txt$/i, ""),
            preview: content.slice(0, 100).trim(),
          });
        } catch {
          cardItems.push({
            node: file,
            title: file.name.replace(/\.txt$/i, ""),
            preview: "",
          });
        }
      }
      setCards(cardItems);
    } catch (e) {
      showToast("error", t("cardmanager.loadFailedShort", { error: String(e) }));
    } finally {
      setLoading(false);
    }
  }, [currentProject, activeCategory, showToast, t]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  // 新建卡片（打开对话框）
  const handleCreateCard = () => {
    setShowCreatePrompt(true);
  };

  // 确认新建卡片
  const handleCreateConfirm = async (name?: string) => {
    setShowCreatePrompt(false);
    if (!name?.trim() || !currentProject) return;
    try {
      const dirName = CATEGORY_DIRS[activeCategory];
      await createFile(currentProject.path, `${dirName}/${name.trim()}.txt`, `${name.trim()}\n\n`);
      await loadCards();
      showToast("success", t("cardmanager.created", { name: name.trim() }));
    } catch (e) {
      showToast("error", t("cardmanager.createFailed", { error: String(e) }));
    }
  };

  // 删除卡片
  const handleDeleteCard = (card: CardItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget(card);
  };

  // 确认删除
  const handleDeleteConfirm = async () => {
    if (!currentProject || !deleteTarget) return;
    const card = deleteTarget;
    setDeleteTarget(null);
    try {
      await deletePath(
        `${currentProject.path}/${card.node.relative_path}`,
        currentProject.path
      );
      await loadCards();
      showToast("success", t("cardmanager.deleted", { name: card.title }));
    } catch (e) {
      showToast("error", t("cardmanager.deleteFailed", { error: String(e) }));
    }
  };

  // 打开卡片编辑
  const handleOpenCard = async (card: CardItem) => {
    if (!currentProject) return;
    try {
      const content = await readFile(
        `${currentProject.path}/${card.node.relative_path}`,
        currentProject.path
      );
      setEditingCard(card);
      setEditContent(content);
      setDirty(false);
    } catch (e) {
      showToast("error", t("cardmanager.loadFailed", { error: String(e) }));
    }
  };

  // 保存卡片
  const handleSave = async () => {
    if (!currentProject || !editingCard || !cardEditor || saving) return;
    setSaving(true);
    try {
      const text = cardEditor.getText();
      await writeFile(
        `${currentProject.path}/${editingCard.node.relative_path}`,
        text,
        currentProject.path
      );
      setDirty(false);
      showToast("success", t("cardmanager.saved"));
      await loadCards();
    } catch (e) {
      showToast("error", t("cardmanager.saveFailed", { error: String(e) }));
    } finally {
      setSaving(false);
    }
  };

  if (editingCard) {
    return (
      <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-nf-border-light bg-nf-bg-sidebar">
          <button
            onClick={() => {
              setEditingCard(null);
              loadCards();
            }}
            className="flex items-center gap-1 text-sm text-nf-text-tertiary hover:text-fandex-primary transition-fast"
          >
            <ChevronLeft className="w-4 h-4" />
            {t("cardmanager.backToList")}
          </button>
          <h2 className="fandex-bar-left text-sm font-bold font-display text-nf-text">{editingCard.title}</h2>
          <div className="ml-auto flex items-center gap-2">
            {dirty && <span className="text-xs text-fandex-tertiary">{t("cardmanager.unsaved")}</span>}
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="flex items-center gap-1 px-3 py-1 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition-fast disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? t("cardmanager.saving") : t("cardmanager.save")}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <EditorContent
            editor={cardEditor}
            className="prose prose-invert max-w-none min-h-full px-8 py-6 leading-loose"
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
        <h2 className="fandex-bar-left text-lg font-bold font-display text-nf-text">{categoryLabel}</h2>
        <button
          onClick={handleCreateCard}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition-fast"
        >
          <Plus className="w-4 h-4" />
          {t("cardmanager.newCard", { category: categoryLabel })}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-1 bg-nf-border-light border border-nf-border-light" role="status" aria-label={t("common.loading")}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-nf-bg p-4 flex flex-col gap-3">
                <SkeletonBlock className="h-4 w-3/4 mb-1" />
                <SkeletonBlock className="h-3 w-full" />
                <SkeletonBlock className="h-3 w-4/5" />
              </div>
            ))}
          </div>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <FileText className="w-16 h-16 text-nf-border mb-4" />
            <p className="text-sm text-nf-text-tertiary mb-4">
              {t("cardmanager.emptyCard", { category: categoryLabel })}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-1 bg-nf-border-light border border-nf-border-light">
            {cards.map((card) => (
              <div
                key={card.node.relative_path}
                role="button"
                tabIndex={0}
                onClick={() => handleOpenCard(card)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleOpenCard(card);
                  }
                }}
                className="group relative bg-nf-bg hover:bg-nf-bg-hover p-4 cursor-pointer transition-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-fandex-primary focus-visible:outline-offset-[-2px]"
              >
                <button
                  onClick={(e) => handleDeleteCard(card, e)}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-nf-text-tertiary hover:text-red-400 transition-fast"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                <h3 className="fandex-bar-left text-sm font-bold font-display text-nf-text mb-2 pr-6 truncate">
                  {card.title}
                </h3>

                <p className="text-xs text-nf-text-tertiary line-clamp-3 leading-relaxed">
                  {card.preview || t("cardmanager.noContent")}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>

    {/* 新建卡片提示框 */}
    <ConfirmDialog
      open={showCreatePrompt}
      type="prompt"
      title={t("cardmanager.newCard", { category: categoryLabel })}
      message={t("cardmanager.promptName", { category: categoryLabel })}
      placeholder={categoryLabel}
      onConfirm={handleCreateConfirm}
      onCancel={() => setShowCreatePrompt(false)}
    />

    {/* 删除确认框 */}
    <ConfirmDialog
      open={!!deleteTarget}
      type="danger"
      title={t("cardmanager.confirmDelete", { name: deleteTarget?.title || "" })}
      message={t("cardmanager.confirmDelete", { name: deleteTarget?.title || "" })}
      confirmLabel={t("app.delete")}
      onConfirm={handleDeleteConfirm}
      onCancel={() => setDeleteTarget(null)}
    />
    </>
  );
}
