// 卡片管理组件
//
// 功能概述：
// 用于角色、世界观、名词等分类的卡片式管理界面。
// 支持卡片的增删改查，每个卡片展开后占用整个编辑区。
// 针对不同分类提供差异化的模板和视觉风格。
// 角色卡片支持预设模板选择（主角、配角、反派、路人）。
//
// 模块职责：
// 1. 渲染卡片网格列表，每个分类有独特的主题色
// 2. 支持新建卡片（角色卡片提供预设选择）
// 3. 点击卡片进入编辑模式
// 4. 编辑模式下支持保存与返回
// 5. 根据分类提供不同的模板和视觉风格
// 6. 模板格式：名称 + 分隔线 + 字段（字段间空行）

import { useState, useEffect, useCallback, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Placeholder from "@tiptap/extension-placeholder";
import { Plus, Trash2, ChevronLeft, Save, FileText, Loader2, Users, Globe, Quote, X, Download, Settings } from "lucide-react";
import { useAppStore, getCategoryDir, type SidebarCategory } from "../lib/store";
import { readProjectTree, createFile, deletePath, readFile, writeFile, scanProjects } from "../lib/api";
import type { FileNode, ProjectInfo as ProjectInfoType } from "../lib/api";
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

// 角色预设接口
interface CharacterPreset {
  id: string;
  nameKey: string;
  descriptionKey: string;
  fieldKeys: string[];
}

// 角色预设定义
const CHARACTER_PRESETS: CharacterPreset[] = [
  {
    id: "protagonist",
    nameKey: "cardmanager.presetProtagonist",
    descriptionKey: "cardmanager.presetProtagonistDesc",
    fieldKeys: [
      "card.characterAppearance",
      "card.characterPersonality",
      "card.characterBackground",
      "card.characterMotivation",
      "card.characterRelationships",
      "card.characterSpeech",
    ],
  },
  {
    id: "supporting",
    nameKey: "cardmanager.presetSupporting",
    descriptionKey: "cardmanager.presetSupportingDesc",
    fieldKeys: [
      "card.characterAppearance",
      "card.characterPersonality",
      "card.characterRelationships",
      "card.characterSpeech",
    ],
  },
  {
    id: "antagonist",
    nameKey: "cardmanager.presetAntagonist",
    descriptionKey: "cardmanager.presetAntagonistDesc",
    fieldKeys: [
      "card.characterAppearance",
      "card.characterPersonality",
      "card.characterBackground",
      "card.characterMotivation",
      "card.characterRelationships",
    ],
  },
  {
    id: "minor",
    nameKey: "cardmanager.presetMinor",
    descriptionKey: "cardmanager.presetMinorDesc",
    fieldKeys: [
      "card.characterAppearance",
      "card.characterSpeech",
    ],
  },
];

// 自定义预设字段接口
interface CustomPresetField {
  key: string;
  label: string;
}

// 自定义预设存储接口
interface CustomPresetData {
  [presetId: string]: CustomPresetField[];
}

const CUSTOM_PRESETS_KEY = "novelforge:customPresets:v1";

// 从 localStorage 加载自定义预设
function loadCustomPresets(): CustomPresetData {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (raw) return JSON.parse(raw) as CustomPresetData;
  } catch { /* ignore */ }
  return {};
}

// 保存自定义预设到 localStorage
function saveCustomPresets(data: CustomPresetData): void {
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(data));
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
    templateGenerator: (name, t) => {
      const fields = [
        "card.characterAppearance",
        "card.characterPersonality",
        "card.characterBackground",
        "card.characterMotivation",
        "card.characterRelationships",
        "card.characterSpeech",
      ];
      const fieldText = fields.map((key) => t(key).trim()).join("\n\n");
      return `${name}\n\n---\n\n${fieldText}\n`;
    },
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
    templateGenerator: (name, t) => {
      const fields = [
        "card.worldGeography",
        "card.worldHistory",
        "card.worldCulture",
        "card.worldMagicSystem",
        "card.worldFactions",
      ];
      const fieldText = fields.map((key) => t(key).trim()).join("\n\n");
      return `${name}\n\n---\n\n${fieldText}\n`;
    },
  },
  glossary: {
    icon: Quote,
    accentColor: "fandex-tertiary",
    templateFields: [
      "card.glossaryDefinition",
      "card.glossaryUsage",
      "card.glossaryRelated",
    ],
    templateGenerator: (name, t) => {
      const fields = [
        "card.glossaryDefinition",
        "card.glossaryUsage",
        "card.glossaryRelated",
      ];
      const fieldText = fields.map((key) => t(key).trim()).join("\n\n");
      return `${name}\n\n---\n\n${fieldText}\n`;
    },
  },
};

// 根据预设生成角色模板（支持自定义字段）
function generatePresetTemplate(name: string, preset: CharacterPreset, t: (key: string) => string, customFields?: CustomPresetField[]): string {
  let fieldText: string;
  if (customFields && customFields.length > 0) {
    fieldText = customFields.map((f) => f.label.trim()).join("\n\n");
  } else {
    fieldText = preset.fieldKeys.map((key) => t(key).trim()).join("\n\n");
  }
  return `${name}\n\n---\n\n${fieldText}\n`;
}

// 从内容中提取字段预览（支持多种格式）
// 格式支持：
//   【外貌】：金发碧眼  /  [外貌] 金发碧眼  /  外貌：金发碧眼  /  外貌: 金发碧眼
function extractFields(content: string, fieldKeys: string[], t: (key: string) => string): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = [];
  const lines = content.split("\n");

  for (const key of fieldKeys) {
    const label = t(key).trim();
    // 去掉括号和冒号后缀，提取纯标签名
    const labelPrefix = label
      .replace(/：$/, "").replace(/:$/, "")
      .replace(/^[\[【]/, "").replace(/[\]】]$/, "")
      .trim();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // 匹配多种格式
      let value = "";

      // 1. 【字段】：值 或 【字段】值
      const bracketMatch = line.match(/^[【\[]\s*([^】\]]+)\s*[】\]]\s*[:：]?\s*(.*)/);
      if (bracketMatch) {
        const bracketLabel = bracketMatch[1].trim();
        if (bracketLabel === labelPrefix || bracketLabel.includes(labelPrefix)) {
          value = bracketMatch[2].trim();
        }
      }

      // 2. 字段：值 或 字段: 值 或 字段 值
      if (!value) {
        // 精确匹配：行以标签名开头，后跟冒号或空格
        const escapedPrefix = labelPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const plainMatch = line.match(new RegExp(`^${escapedPrefix}\\s*[:：]\\s*(.*)`));
        if (plainMatch) {
          value = plainMatch[1].trim();
        }
      }

      if (value) {
        fields.push({ label: labelPrefix, value: value.slice(0, 30) + (value.length > 30 ? "…" : "") });
        break;
      }
    }
  }

  // 如果标准字段没找到，尝试提取任意 key-value 行作为预览
  if (fields.length === 0) {
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("---") || line.startsWith("===")) continue;
      // 跳过第一行（通常是卡片名称）
      if (lines.indexOf(rawLine) === 0) continue;

      // 匹配 "xxx：yyy" 或 "xxx: yyy" 或 "【xxx】yyy"
      const kvMatch = line.match(/^(?:[【\[]\s*([^】\]]+)\s*[】\]]|([^:：\s]+))\s*[:：]\s*(.+)/);
      if (kvMatch) {
        const label = (kvMatch[1] || kvMatch[2] || "").trim();
        const value = (kvMatch[3] || "").trim();
        if (label && value && label.length <= 20) {
          fields.push({ label, value: value.slice(0, 30) + (value.length > 30 ? "…" : "") });
          if (fields.length >= 3) break;
        }
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
  const [showPresetDialog, setShowPresetDialog] = useState(false);
  const [pendingPreset, setPendingPreset] = useState<CharacterPreset | null>(null);

  // 从其他项目导入卡片的状态
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importProjects, setImportProjects] = useState<ProjectInfoType[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [selectedImportProject, setSelectedImportProject] = useState<ProjectInfoType | null>(null);
  const [importableCards, setImportableCards] = useState<CardItem[]>([]);
  const [selectedImportCards, setSelectedImportCards] = useState<Set<string>>(new Set());

  // 模板编辑器状态
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [templateEditorTab, setTemplateEditorTab] = useState(0);
  const [templateEditorFields, setTemplateEditorFields] = useState<CustomPresetField[]>([]);
  const [newFieldLabel, setNewFieldLabel] = useState("");

  // 获取当前分类的配置
  const categoryConfig = useMemo(() => {
    return CATEGORY_CARD_CONFIG[activeCategory] || {
      icon: FileText,
      accentColor: "fandex-primary",
      templateFields: [],
      templateGenerator: (name: string) => `${name}\n\n---\n\n`,
    };
  }, [activeCategory]);

  const CategoryIcon = categoryConfig.icon;
  const isCharactersCategory = activeCategory === "characters";

  // 获取预设的有效字段（合并自定义预设）
  const getEffectiveFields = useCallback((preset: CharacterPreset): CustomPresetField[] => {
    const customPresets = loadCustomPresets();
    if (customPresets[preset.id]) {
      return customPresets[preset.id];
    }
    return preset.fieldKeys.map((key) => ({ key, label: t(key).trim() }));
  }, [t]);

  // 切换模板编辑器标签页时同步字段
  useEffect(() => {
    if (showTemplateEditor && CHARACTER_PRESETS[templateEditorTab]) {
      setTemplateEditorFields(getEffectiveFields(CHARACTER_PRESETS[templateEditorTab]));
    }
  }, [showTemplateEditor, templateEditorTab, getEffectiveFields]);

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

  // 新建卡片（根据分类决定流程）
  const handleCreateCard = () => {
    if (isCharactersCategory) {
      // 角色分类：先显示预设选择
      setShowPresetDialog(true);
    } else {
      // 其他分类：直接输入名称
      setShowCreatePrompt(true);
    }
  };

  // 选择预设后进入名称输入
  const handlePresetSelect = (preset: CharacterPreset) => {
    setPendingPreset(preset);
    setShowPresetDialog(false);
    setShowCreatePrompt(true);
  };

  // 确认新建卡片
  const handleCreateConfirm = async (name?: string) => {
    setShowCreatePrompt(false);
    if (!name?.trim() || !currentProject) {
      setPendingPreset(null);
      return;
    }
    try {
      const dirName = getCategoryDir(activeCategory);
      const cardName = name.trim();
      let templateContent: string;

      if (isCharactersCategory && pendingPreset) {
        // 使用预设模板（支持自定义字段）
        const customPresets = loadCustomPresets();
        const customFields = customPresets[pendingPreset.id];
        templateContent = generatePresetTemplate(cardName, pendingPreset, t, customFields);
      } else {
        // 使用默认模板
        templateContent = categoryConfig.templateGenerator(cardName, t);
      }

      await createFile(currentProject.path, `${dirName}/${cardName}.txt`, templateContent);
      await loadCards();
      showToast("success", t("cardmanager.created", { name: cardName }));
    } catch (e) {
      showToast("error", t("cardmanager.createFailed", { error: String(e) }));
    } finally {
      setPendingPreset(null);
    }
  };

  // 取消新建
  const handleCreateCancel = () => {
    setShowCreatePrompt(false);
    setPendingPreset(null);
  };

  // 打开导入对话框：扫描同目录下的其他项目
  const handleOpenImportDialog = async () => {
    const scanDir = localStorage.getItem("novelforge:scanDir:v1");
    if (!scanDir) {
      showToast("error", t("cardmanager.noScanDir"));
      return;
    }
    setShowImportDialog(true);
    setImportLoading(true);
    setSelectedImportProject(null);
    setImportableCards([]);
    setSelectedImportCards(new Set());
    try {
      const projects = await scanProjects(scanDir);
      // 排除当前项目
      setImportProjects(projects.filter((p) => p.path !== currentProject?.path));
    } catch (e) {
      showToast("error", t("cardmanager.importScanFailed", { error: String(e) }));
    } finally {
      setImportLoading(false);
    }
  };

  // 选择源项目后加载其卡片列表
  const handleSelectImportProject = async (project: ProjectInfoType) => {
    setSelectedImportProject(project);
    setImportLoading(true);
    setSelectedImportCards(new Set());
    try {
      const tree = await readProjectTree(project.path);
      const dirName = getCategoryDir(activeCategory);
      const dir = findDirByName(tree, dirName);
      const files = dir?.children.filter((f) => !f.is_dir) || [];
      const cards: CardItem[] = await Promise.all(
        files.map(async (file) => {
          try {
            const content = await readFile(`${project.path}/${file.relative_path}`, project.path);
            return { node: file, title: file.name.replace(/\.txt$/i, ""), preview: content.slice(0, 80).trim(), fields: [] };
          } catch {
            return { node: file, title: file.name.replace(/\.txt$/i, ""), preview: "", fields: [] };
          }
        })
      );
      setImportableCards(cards);
    } catch (e) {
      showToast("error", t("cardmanager.importLoadCardsFailed", { error: String(e) }));
    } finally {
      setImportLoading(false);
    }
  };

  // 切换卡片选中状态
  const handleToggleImportCard = (cardPath: string) => {
    setSelectedImportCards((prev) => {
      const next = new Set(prev);
      if (next.has(cardPath)) {
        next.delete(cardPath);
      } else {
        next.add(cardPath);
      }
      return next;
    });
  };

  // 确认导入：将选中的卡片文件复制到当前项目
  const handleConfirmImport = async () => {
    if (!currentProject || !selectedImportProject || selectedImportCards.size === 0) return;
    setImportLoading(true);
    try {
      const dirName = getCategoryDir(activeCategory);
      for (const card of importableCards) {
        if (!selectedImportCards.has(card.node.relative_path)) continue;
        const content = await readFile(
          `${selectedImportProject.path}/${card.node.relative_path}`,
          selectedImportProject.path
        );
        await writeFile(
          `${currentProject.path}/${dirName}/${card.node.name}`,
          content,
          currentProject.path
        );
      }
      showToast("success", t("cardmanager.importSuccess", { count: selectedImportCards.size }));
      setShowImportDialog(false);
      await loadCards();
    } catch (e) {
      showToast("error", t("cardmanager.importFailed", { error: String(e) }));
    } finally {
      setImportLoading(false);
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

  // 预设选择对话框
  if (showPresetDialog) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowPresetDialog(false);
          }
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preset-dialog-title"
          className="w-full max-w-2xl bg-nf-bg-card border border-nf-border-light shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
            <h2 id="preset-dialog-title" className="text-lg font-bold font-display text-nf-text">
              {t("cardmanager.presetTitle")}
            </h2>
            <button
              onClick={() => setShowPresetDialog(false)}
              className="p-1 hover:bg-nf-bg-hover text-nf-text-tertiary transition duration-fast"
              aria-label={t("app.close")}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 grid grid-cols-2 gap-4">
            {CHARACTER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handlePresetSelect(preset)}
                className="group relative bg-nf-bg hover:bg-nf-bg-hover border border-nf-border-light hover:border-fandex-primary/60 p-5 text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-fandex-primary focus-visible:outline-offset-[-2px]"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-5 h-5 text-fandex-primary" />
                  <h3 className="text-base font-bold font-display text-nf-text">
                    {t(preset.nameKey)}
                  </h3>
                </div>
                <p className="text-sm text-nf-text-secondary mb-3 leading-relaxed">
                  {t(preset.descriptionKey)}
                </p>
                <div className="text-xs text-nf-text-tertiary">
                  {preset.fieldKeys.length} {t("cardmanager.presetFields") || "个字段"}
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-fandex-primary opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between px-6 py-4 border-t border-nf-border-light">
            <button
              onClick={() => {
                setShowPresetDialog(false);
                setShowTemplateEditor(true);
                setTemplateEditorTab(0);
              }}
              className="flex items-center gap-1.5 text-sm text-nf-text-tertiary hover:text-fandex-primary transition duration-fast"
            >
              <Settings className="w-3.5 h-3.5" />
              {t("cardmanager.customizeTemplate")}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPresetDialog(false)}
                className="px-4 py-2 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
              >
                {t("app.cancel")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 模板编辑器对话框
  if (showTemplateEditor) {
    const currentPreset = CHARACTER_PRESETS[templateEditorTab];
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowTemplateEditor(false);
          }
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="template-editor-title"
          className="w-full max-w-2xl bg-nf-bg-card border border-nf-border-light shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
            <h2 id="template-editor-title" className="text-lg font-bold font-display text-nf-text">
              {t("cardmanager.templateEditor")}
            </h2>
            <button
              onClick={() => setShowTemplateEditor(false)}
              className="p-1 hover:bg-nf-bg-hover text-nf-text-tertiary transition duration-fast"
              aria-label={t("app.close")}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 标签页 */}
          <div className="flex border-b border-nf-border-light">
            {CHARACTER_PRESETS.map((preset, idx) => (
              <button
                key={preset.id}
                onClick={() => setTemplateEditorTab(idx)}
                className={`px-4 py-2.5 text-sm font-medium transition duration-fast border-b-2 ${
                  idx === templateEditorTab
                    ? "text-fandex-primary border-fandex-primary"
                    : "text-nf-text-tertiary border-transparent hover:text-nf-text-secondary hover:border-nf-border-light"
                }`}
              >
                {t(preset.nameKey)}
              </button>
            ))}
          </div>

          {/* 字段编辑区 */}
          <div className="p-6">
            <div className="mb-4">
              <p className="text-xs text-nf-text-tertiary mb-3">
                {currentPreset && t(currentPreset.descriptionKey)}
              </p>
              {templateEditorFields.length === 0 ? (
                <p className="text-sm text-nf-text-tertiary italic py-4 text-center">
                  {t("cardmanager.noContent")}
                </p>
              ) : (
                <div className="space-y-2">
                  {templateEditorFields.map((field, idx) => (
                    <div key={`${field.key}-${idx}`} className="flex items-center gap-2 group">
                      <input
                        type="text"
                        value={field.label}
                        onChange={(e) => {
                          const updated = [...templateEditorFields];
                          updated[idx] = { ...updated[idx], label: e.target.value };
                          setTemplateEditorFields(updated);
                        }}
                        className="flex-1 px-3 py-1.5 text-sm bg-nf-bg border border-nf-border-light focus:border-fandex-primary/60 text-nf-text outline-none transition duration-fast"
                      />
                      <button
                        onClick={() => {
                          setTemplateEditorFields(templateEditorFields.filter((_, i) => i !== idx));
                        }}
                        className="p-1.5 text-nf-text-tertiary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all duration-fast"
                        title={t("app.delete")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 添加新字段 */}
            <div className="flex items-center gap-2 mb-4">
              <input
                type="text"
                value={newFieldLabel}
                onChange={(e) => setNewFieldLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newFieldLabel.trim()) {
                    setTemplateEditorFields([
                      ...templateEditorFields,
                      { key: `custom_${Date.now()}`, label: newFieldLabel.trim() },
                    ]);
                    setNewFieldLabel("");
                  }
                }}
                placeholder={t("cardmanager.newCard", { category: "" })}
                className="flex-1 px-3 py-1.5 text-sm bg-nf-bg border border-nf-border-light focus:border-fandex-primary/60 text-nf-text placeholder:text-nf-text-tertiary outline-none transition duration-fast"
              />
              <button
                onClick={() => {
                  if (newFieldLabel.trim()) {
                    setTemplateEditorFields([
                      ...templateEditorFields,
                      { key: `custom_${Date.now()}`, label: newFieldLabel.trim() },
                    ]);
                    setNewFieldLabel("");
                  }
                }}
                disabled={!newFieldLabel.trim()}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Plus className="w-3.5 h-3.5" />
                {t("app.create")}
              </button>
            </div>
          </div>

          {/* 底部操作栏 */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-nf-border-light">
            <button
              onClick={() => {
                if (!currentPreset) return;
                const defaultFields = currentPreset.fieldKeys.map((key) => ({
                  key,
                  label: t(key).trim(),
                }));
                setTemplateEditorFields(defaultFields);
              }}
              className="text-sm text-nf-text-tertiary hover:text-fandex-primary transition duration-fast"
            >
              {t("cardmanager.resetTemplate")}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowTemplateEditor(false)}
                className="px-4 py-2 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
              >
                {t("app.cancel")}
              </button>
              <button
                onClick={() => {
                  if (!currentPreset) return;
                  const allCustom = loadCustomPresets();
                  allCustom[currentPreset.id] = templateEditorFields;
                  saveCustomPresets(allCustom);
                  showToast("success", t("cardmanager.templateSaved"));
                  setShowTemplateEditor(false);
                }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast"
              >
                <Save className="w-3.5 h-3.5" />
                {t("cardmanager.save")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 编辑模式视图
  if (editingCard) {
    return (
      <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden">
        <div className={`flex items-center gap-3 px-4 py-2 border-b border-nf-border-light bg-${categoryConfig.accentColor}/5`}>
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
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenImportDialog}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-nf-text-secondary hover:text-nf-text border border-nf-border-light hover:border-fandex-primary/40 hover:bg-nf-bg-hover transition duration-fast"
            >
              <Download className="w-4 h-4" />
              {t("cardmanager.importFromOther")}
            </button>
            <button
              onClick={handleCreateCard}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast"
            >
              <Plus className="w-4 h-4" />
              {t("cardmanager.newCard", { category: categoryLabel })}
            </button>
          </div>
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
        onCancel={handleCreateCancel}
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

      {/* 从其他项目导入卡片对话框 */}
      {showImportDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowImportDialog(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg bg-nf-bg-card border border-nf-border-light shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 对话框头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
              <h2 className="text-base font-bold font-display text-nf-text">
                {selectedImportProject
                  ? t("cardmanager.importSelectCards")
                  : t("cardmanager.importTitle")}
              </h2>
              <button
                onClick={() => setShowImportDialog(false)}
                className="p-1 hover:bg-nf-bg-hover text-nf-text-tertiary transition duration-fast"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 对话框内容 */}
            <div className="px-6 py-4 max-h-96 overflow-y-auto">
              {importLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-fandex-primary" />
                </div>
              ) : !selectedImportProject ? (
                /* 第一步：选择源项目 */
                importProjects.length === 0 ? (
                  <p className="text-sm text-nf-text-tertiary text-center py-4">
                    {t("cardmanager.importNoProjects")}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {importProjects.map((project) => (
                      <button
                        key={project.path}
                        onClick={() => handleSelectImportProject(project)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left border border-nf-border-light hover:border-fandex-primary/50 hover:bg-nf-bg-hover transition-all duration-fast group"
                      >
                        <div className="w-8 h-8 flex items-center justify-center bg-fandex-primary/10 text-fandex-primary flex-shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-nf-text group-hover:text-fandex-primary transition-colors truncate">
                            {project.meta.name}
                          </div>
                          <div className="text-xs text-nf-text-tertiary">
                            {project.meta.type} · {project.word_count} {t("launcher.wordUnit")}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )
              ) : importableCards.length === 0 ? (
                /* 源项目中没有可导入的卡片 */
                <p className="text-sm text-nf-text-tertiary text-center py-4">
                  {t("cardmanager.importNoCards")}
                </p>
              ) : (
                /* 第二步：选择要导入的卡片 */
                <div className="space-y-1">
                  {importableCards.map((card) => {
                    const isSelected = selectedImportCards.has(card.node.relative_path);
                    return (
                      <label
                        key={card.node.relative_path}
                        className={`flex items-center gap-3 px-3 py-2 border cursor-pointer transition-all duration-fast ${
                          isSelected
                            ? "border-fandex-primary/50 bg-fandex-primary/5"
                            : "border-nf-border-light hover:border-fandex-primary/30 hover:bg-nf-bg-hover"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleImportCard(card.node.relative_path)}
                          className="w-4 h-4 accent-fandex-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-nf-text truncate">
                            {card.title}
                          </div>
                          {card.preview && (
                            <div className="text-xs text-nf-text-tertiary truncate">
                              {card.preview}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 对话框底部 */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-nf-border-light">
              <div>
                {selectedImportProject && (
                  <button
                    onClick={() => {
                      setSelectedImportProject(null);
                      setImportableCards([]);
                      setSelectedImportCards(new Set());
                    }}
                    className="text-sm text-nf-text-tertiary hover:text-fandex-primary transition duration-fast"
                  >
                    {t("cardmanager.importBackToProjects")}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowImportDialog(false)}
                  className="px-3 py-1.5 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
                >
                  {t("app.cancel")}
                </button>
                {selectedImportProject && selectedImportCards.size > 0 && (
                  <button
                    onClick={handleConfirmImport}
                    disabled={importLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition duration-fast disabled:opacity-50"
                  >
                    {importLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {t("cardmanager.importConfirm", { count: selectedImportCards.size })}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
