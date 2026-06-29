// 卡片管理组件
//
// 功能概述：
// 用于角色、世界观、名词等分类的卡片式管理界面。
// 支持卡片的增删改查，每个卡片展开后占用整个编辑区。
// 针对不同分类提供差异化的模板和视觉风格。
//
// 模块职责：
// 1. 渲染卡片网格列表
// 2. 支持新建卡片
// 3. 点击卡片进入编辑模式
// 4. 编辑模式下支持保存与返回
// 5. 根据分类提供不同的模板和视觉风格

import { useState, useEffect, useCallback, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Placeholder from "@tiptap/extension-placeholder";
import { Plus, Trash2, ChevronLeft, Save, FileText, Loader2, Users, Globe, BookMarked } from "lucide-react";
import { useAppStore, getCategoryDir, type SidebarCategory } from "../lib/store";
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
  fields: { label: string; value: string }[];
}

// 分类配置接口
interface CategoryCardConfig {
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
  templateFields: string[];
  templateGenerator: (name: string, t: (key: string) => string) => string;
}

// 各分类的配置
const CATEGORY_CARD_CONFIG: Record<string, CategoryCardConfig> = {
  characters: {
    icon: Users,
    accentColor: "fandex-primary",
    templateFields: [
      "card.characterAppearance",
      "card.characterPersonality",
      "card.characterBackground",
      "card.characterMotivation",
      "card.characterRelationships",
      "card.characterSpeech",
    ],
    templateGenerator: (name, t) =>
      `${name}\n\n${t("card.characterAppearance")}\n${t("card.characterPersonality")}\n${t("card.characterBackground")}\n${t("card.characterMotivation")}\n${t("card.characterRelationships")}\n${t("card.characterSpeech")}\n`,
  },
  worldview: {
    icon: Globe,
    accentColor: "fandex-secondary",
    templateFields: [
      "card.worldGeography",
      "card.worldHistory",
      "card.worldCulture",
      "card.worldMagicSystem",
      "card.worldFactions",
    ],
    templateGenerator: (name, t) =>
      `${name}\n\n${t("card.worldGeography")}\n${t("card.worldHistory")}\n${t("card.worldCulture")}\n${t("card.worldMagicSystem")}\n${t("card.worldFactions")}\n`,
  },
  glossary: {
    icon: BookMarked,
    accentColor: "fandex-tertiary",
    templateFields: [
      "card.glossaryDefinition",
      "card.glossaryUsage",
      "card.glossaryRelated",
    ],
    templateGenerator: (name, t) =>
      `${name}\n\n${t("card.glossaryDefinition")}\n${t("card.glossaryUsage")}\n${t("card.glossaryRelated")}\n`,
  },
};

// 从内容中提取字段预览
function extractFields(content: string, fieldKeys: string[], t: (key: string) => string): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = [];
  const lines = content.split("\n");

  for (const key of fieldKeys) {
    const label = t(key);
    const labelPrefix = label.replace(/：$/, "").replace(/:$/, "");
    const line = lines.find((l) => l.trim().startsWith(labelPrefix));
    if (line) {
      const value = line.replace(new RegExp(`^${labelPrefix}[：:]?\\s*`), "").trim();
      if (value) {
        fields.push({ label: labelPrefix, value: value.slice(0, 30) + (value.length > 30 ? "…" : "") });
      }
    }
  }

  return fields.slice(0, 3); // 最多显示 3 个字段
}

export default function CardManager({ categoryLabel }: CardManagerProps) {
  const currentProject = useAppStore((s) => s.currentProject);
  const activeCategory = useAppStore((s) => s.activeCategory);
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

  // 获取当前分类的配置
  const categoryConfig = useMemo(() => {
    return CATEGORY_CARD_CONFIG[activeCategory] || {
      icon: FileText,
      accentColor: "fandex-primary",
      templateFields: [],
      templateGenerator: (name: string) => `${name}\n\n`,
    };
  }, [activeCategory]);

  const CategoryIcon = categoryConfig.icon;

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
      const dirName = getCategoryDir(activeCategory);
      const dir = findDirByName(tree, dirName);
      const files = dir?.children.filter((f) => !f.is_dir) || [];

      const cardItems: CardItem[] = await Promise.all(
        files.map(async (file) => {
          try {
            const content = await readFile(
              `${currentProject.path}/${file.relative_path}`,
              currentProject.path
            );
            const fields = extractFields(content, categoryConfig.templateFields, t);
            return {
              node: file,
              title: file.name.replace(/\.txt$/i, ""),
              preview: content.slice(0, 80).trim(),
              fields,
            };
          } catch {
            return {
              node: file,
              title: file.name.replace(/\.txt$/i, ""),
              preview: "",
              fields: [],
            };
          }
        })
      );
      setCards(cardItems);
    } catch (e) {
      showToast("error", t("cardmanager.loadFailedShort", { error: String(e) }));
    } finally {
      setLoading(false);
    }
  }, [currentProject, activeCategory, showToast, t, categoryConfig]);

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
      const dirName = getCategoryDir(activeCategory);
      const cardName = name.trim();
      const templateContent = categoryConfig.templateGenerator(cardName, t);
      await createFile(currentProject.path, `${dirName}/${cardName}.txt`, templateContent);
      await loadCards();
      showToast("success", t("cardmanager.created", { name: cardName }));
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

  // 编辑模式视图
  if (editingCard) {
    return (
      <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-nf-border-light bg-nf-bg-sidebar">
          <button
            onClick={() => {
              if (dirty) {
                const msg = t("cardmanager.unsavedWarning");
                if (!window.confirm(msg)) return;
              }
              setEditingCard(null);
              loadCards();
            }}
            className="flex items-center gap-1 text-sm text-nf-text-tertiary hover:text-fandex-primary transition duration-fast"
          >
            <ChevronLeft className="w-4 h-4" />
            {t("cardmanager.backToList")}
          </button>
          <div className="flex items-center gap-2">
            <CategoryIcon className={`w-4 h-4 text-${categoryConfig.accentColor}`} />
            <h2 className="fandex-bar-left text-sm font-bold font-display text-nf-text">{editingCard.title}</h2>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {dirty && <span className="text-xs text-fandex-tertiary">{t("cardmanager.unsaved")}</span>}
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="flex items-center gap-1 px-3 py-1 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast disabled:opacity-30 disabled:cursor-not-allowed"
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

  // 列表模式视图
  return (
    <>
      <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden">
        {/* 头部 - 带分类图标和颜色 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 bg-${categoryConfig.accentColor}/10 rounded-md`}>
              <CategoryIcon className={`w-5 h-5 text-${categoryConfig.accentColor}`} />
            </div>
            <h2 className="fandex-bar-left text-lg font-bold font-display text-nf-text">{categoryLabel}</h2>
          </div>
          <button
            onClick={handleCreateCard}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast"
          >
            <Plus className="w-4 h-4" />
            {t("cardmanager.newCard", { category: categoryLabel })}
          </button>
        </div>

        {/* 卡片网格 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3" role="status" aria-label={t("common.loading")}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-nf-bg-card border border-nf-border-light p-4 flex flex-col gap-3">
                  <SkeletonBlock className="h-5 w-2/3 mb-1" />
                  <SkeletonBlock className="h-3 w-full" />
                  <SkeletonBlock className="h-3 w-4/5" />
                  <SkeletonBlock className="h-3 w-3/5" />
                </div>
              ))}
            </div>
          ) : cards.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className={`p-4 bg-${categoryConfig.accentColor}/10 rounded-lg mb-4`}>
                <CategoryIcon className={`w-12 h-12 text-${categoryConfig.accentColor}/60`} />
              </div>
              <p className="text-sm text-nf-text-secondary font-medium mb-1">
                {t("cardmanager.emptyCard", { category: categoryLabel })}
              </p>
              <p className="text-xs text-nf-text-tertiary mb-4">
                {t("cardmanager.emptyHint", { category: categoryLabel })}
              </p>
              <button
                onClick={handleCreateCard}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast"
              >
                <Plus className="w-4 h-4" />
                {t("cardmanager.newCard", { category: categoryLabel })}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
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
                  className="group relative bg-nf-bg-card hover:bg-nf-bg-hover border border-nf-border-light hover:border-fandex-primary/40 p-4 cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-fandex-primary focus-visible:outline-offset-[-2px]"
                >
                  {/* 删除按钮 */}
                  <button
                    onClick={(e) => handleDeleteCard(card, e)}
                    className="absolute top-2.5 right-2.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto p-1.5 text-nf-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition-all duration-fast rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  {/* 卡片标题 */}
                  <div className="flex items-center gap-2 mb-2.5 pr-6">
                    <CategoryIcon className={`w-4 h-4 text-${categoryConfig.accentColor}/70 flex-shrink-0`} />
                    <h3 className="text-sm font-bold font-display text-nf-text truncate">
                      {card.title}
                    </h3>
                  </div>

                  {/* 字段预览 */}
                  {card.fields.length > 0 ? (
                    <div className="space-y-1.5">
                      {card.fields.map((field, idx) => (
                        <div key={idx} className="text-xs">
                          <span className="text-nf-text-tertiary">{field.label}：</span>
                          <span className="text-nf-text-secondary">{field.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-nf-text-tertiary line-clamp-2 leading-relaxed">
                      {card.preview || t("cardmanager.noContent")}
                    </p>
                  )}

                  {/* 底部装饰线 */}
                  <div className={`absolute bottom-0 left-0 right-0 h-0.5 bg-${categoryConfig.accentColor} opacity-0 group-hover:opacity-100 transition-opacity duration-200`} />
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
