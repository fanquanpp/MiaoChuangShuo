// 智能设定库（Codex）面板组件
//
// 功能概述：
// 喵创说 的智能设定库入口，统一收敛原角色/世界观/术语/素材四类设定。
// 提供实体列表 + 出现追踪双栏布局，支持搜索过滤与点击跳转编辑。
// 参考 Novelcrafter Codex 设计：实体作为可追踪对象，统计在正文中的出现。
//
// 模块职责：
// 1. 扫描项目下 4 类设定目录，聚合为统一 Codex 实体列表
// 2. 按类型分组展示，支持搜索过滤
// 3. 选中实体后懒加载调用后端扫描出现位置
// 4. 渲染出现追踪结果：文件名 + 次数 + 上下文预览
// 5. 支持点击预览跳转到对应文件编辑
// 6. 支持内嵌快捷新增实体与删除实体（不依赖外部向导）

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Library,
  Search,
  Users,
  Globe,
  Book,
  Package,
  Loader2,
  FileText,
  ChevronRight,
  RefreshCw,
  Inbox,
  Plus,
  Trash2,
  X,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import {
  scanCodexEntities,
  scanEntityMentions,
  createCodexEntity,
  deleteCodexEntity,
  CODEX_TYPE_LABELS,
  type CodexEntity,
  type CodexEntityType,
  type EntityMention,
} from "../lib/codexApi";
import ConfirmDialog from "./ConfirmDialog";

// Codex 实体类型图标映射
const TYPE_ICONS: Record<CodexEntityType, React.ComponentType<{ className?: string }>> = {
  character: Users,
  worldview: Globe,
  glossary: Book,
  material: Package,
};

/**
 * Codex 面板组件
 * 输入: 无（通过 useAppStore 获取当前项目）
 * 输出: JSX 双栏布局（左侧实体列表 + 右侧出现追踪）
 * 流程:
 *   1. 挂载时扫描项目设定目录，聚合实体列表
 *   2. 渲染左侧列表：按类型分组 + 搜索过滤
 *   3. 选中实体后调用后端扫描出现位置
 *   4. 渲染右侧追踪结果：文件名 + 次数 + 预览
 *   5. 支持点击文件项跳转到正文编辑
 */
export default function CodexPanel() {
  const currentProject = useAppStore((s) => s.currentProject);
  const setSelectedFile = useAppStore((s) => s.setSelectedFile);
  const setActiveCategory = useAppStore((s) => s.setActiveCategory);
  const { showToast } = useToast();
  const { t } = useI18n();

  const [entities, setEntities] = useState<CodexEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentions, setMentions] = useState<EntityMention[] | null>(null);

  // 新增实体对话框状态
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [newEntityType, setNewEntityType] = useState<CodexEntityType>("character");
  const [newEntityName, setNewEntityName] = useState("");
  const [newEntityAliases, setNewEntityAliases] = useState("");
  const [newEntityContent, setNewEntityContent] = useState("");
  const [creating, setCreating] = useState(false);

  // 删除确认对话框状态
  const [deleteTarget, setDeleteTarget] = useState<CodexEntity | null>(null);

  // 扫描设定库实体
  const loadEntities = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    try {
      const list = await scanCodexEntities(currentProject.path);
      setEntities(list);
    } catch (e) {
      showToast("error", t("codex.loadFailed", { error: String(e) }));
    } finally {
      setLoading(false);
    }
  }, [currentProject, showToast, t]);

  useEffect(() => {
    loadEntities();
  }, [loadEntities]);

  // 选中实体后懒加载出现追踪
  const selectedEntity = useMemo(
    () => entities.find((e) => e.id === selectedId) || null,
    [entities, selectedId]
  );

  const loadMentions = useCallback(async (entity: CodexEntity) => {
    if (!currentProject) return;
    setMentionLoading(true);
    setMentions(null);
    try {
      const result = await scanEntityMentions(
        currentProject.path,
        entity.name,
        entity.aliases
      );
      setMentions(result);
    } catch (e) {
      showToast("error", t("codex.scanFailed", { error: String(e) }));
      setMentions([]);
    } finally {
      setMentionLoading(false);
    }
  }, [currentProject, showToast, t]);

  useEffect(() => {
    if (selectedEntity) {
      loadMentions(selectedEntity);
    } else {
      setMentions(null);
    }
  }, [selectedEntity, loadMentions]);

  // 搜索过滤
  const filteredEntities = useMemo(() => {
    if (!searchQuery.trim()) return entities;
    const q = searchQuery.toLowerCase();
    return entities.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q))
    );
  }, [entities, searchQuery]);

  // 按类型分组
  const groupedEntities = useMemo(() => {
    const groups: Partial<Record<CodexEntityType, CodexEntity[]>> = {};
    for (const entity of filteredEntities) {
      if (!groups[entity.type]) groups[entity.type] = [];
      groups[entity.type]!.push(entity);
    }
    return groups;
  }, [filteredEntities]);

  // 点击文件项跳转到正文编辑
  const handleJumpToFile = useCallback(
    (mention: EntityMention) => {
      // 构造 FileNode 并切换到正文分类
      setSelectedFile({
        name: mention.file_name,
        relative_path: mention.file_path,
        is_dir: false,
        children: [],
        size: 0,
      });
      setActiveCategory("manuscript");
    },
    [setSelectedFile, setActiveCategory]
  );

  // 打开新增实体对话框：指定类型预填
  const handleOpenAddDialog = useCallback((type: CodexEntityType) => {
    setNewEntityType(type);
    setNewEntityName("");
    setNewEntityAliases("");
    setNewEntityContent("");
    setAddDialogOpen(true);
    setAddMenuOpen(false);
  }, []);

  // 提交新增实体：调用后端创建文件后刷新列表
  const handleCreateEntity = useCallback(async () => {
    if (!currentProject) return;
    const name = newEntityName.trim();
    if (!name) {
      showToast("warning", t("codex.nameRequired"));
      return;
    }
    // 检查重名：同类型下不允许重名
    const exists = entities.some(
      (e) => e.type === newEntityType && e.name === name
    );
    if (exists) {
      showToast("warning", t("codex.nameExists", { name }));
      return;
    }
    setCreating(true);
    try {
      // 解析别名：按逗号分隔
      const aliases = newEntityAliases
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      await createCodexEntity(
        currentProject.path,
        newEntityType,
        name,
        aliases,
        newEntityContent
      );
      showToast("success", t("codex.createSuccess", { name }));
      setAddDialogOpen(false);
      // 刷新实体列表
      await loadEntities();
      // 自动选中新创建的实体
      const newId = `${newEntityType}-${name}`;
      setSelectedId(newId);
    } catch (e) {
      showToast("error", t("codex.createFailed", { error: String(e) }));
    } finally {
      setCreating(false);
    }
  }, [currentProject, newEntityName, newEntityAliases, newEntityContent, newEntityType, entities, showToast, t, loadEntities]);

  // 删除实体：打开确认对话框
  const handleDeleteEntity = useCallback((entity: CodexEntity) => {
    setDeleteTarget(entity);
  }, []);

  // 确认删除实体：调用后端删除文件后刷新列表
  const handleConfirmDelete = useCallback(async () => {
    if (!currentProject || !deleteTarget) return;
    try {
      await deleteCodexEntity(currentProject.path, deleteTarget);
      showToast("success", t("codex.deleteSuccess", { name: deleteTarget.name }));
      // 若删除的是当前选中项，清空选中
      if (selectedId === `${deleteTarget.type}-${deleteTarget.id}`) {
        setSelectedId(null);
      }
      setDeleteTarget(null);
      // 刷新实体列表
      await loadEntities();
    } catch (e) {
      showToast("error", t("codex.deleteFailed", { error: String(e) }));
    }
  }, [currentProject, deleteTarget, selectedId, showToast, t, loadEntities]);

  // 总出现次数统计
  const totalMentions = useMemo(() => {
    if (!mentions) return 0;
    return mentions.reduce((sum, m) => sum + m.count, 0);
  }, [mentions]);

  return (
    <div className="flex h-full bg-nf-bg-panel">
      {/* 左侧：实体列表（固定宽度，作为设定库导航栏） */}
      <div className="w-72 min-w-[260px] border-r border-nf-border-light flex flex-col bg-nf-bg-sidebar flex-shrink-0">
        {/* 头部：标题 + 新增 + 刷新（固定项，禁止压缩） */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-nf-border-light flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Library className="w-4 h-4 text-fandex-primary" />
            <h2 className="text-sm font-semibold text-nf-text">{t("codex.title")}</h2>
          </div>
          <div className="flex items-center gap-1.5">
            {/* 新增实体下拉菜单：提供按类型快速新增 */}
            <div className="relative">
              <button
                onClick={() => setAddMenuOpen((v) => !v)}
                title={t("codex.addEntity")}
                className="flex items-center gap-0.5 px-2 py-1 text-xs text-nf-text-secondary hover:text-fandex-primary border border-nf-border-light hover:border-fandex-primary/60 hover:bg-fandex-primary/5 transition duration-fast"
              >
                <Plus className="w-3.5 h-3.5" />
                <ChevronDown className="w-3 h-3 opacity-70" />
              </button>
              {addMenuOpen && (
                <>
                  {/* 透明遮罩：点击外部关闭下拉 */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setAddMenuOpen(false)}
                  />
                  <div className="nf-glass-panel absolute top-full right-0 mt-1 w-44 bg-nf-bg-card border border-nf-border-light shadow-lg z-50 py-1">
                    {/* 按类型快速新增 */}
                    {(["character", "worldview", "glossary", "material"] as CodexEntityType[]).map((type) => {
                      const Icon = TYPE_ICONS[type];
                      return (
                        <button
                          key={type}
                          onClick={() => handleOpenAddDialog(type)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-nf-text hover:bg-nf-bg-hover transition duration-fast"
                        >
                          <Icon className="w-3.5 h-3.5 text-fandex-primary" />
                          <span>{CODEX_TYPE_LABELS[type]}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            {/* 刷新按钮 */}
            <button
              onClick={loadEntities}
              disabled={loading}
              title={t("codex.refresh")}
              className="text-nf-text-tertiary hover:text-fandex-primary transition-colors duration-150 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* 搜索框（固定项，禁止压缩） */}
        <div className="flex-shrink-0 px-3 py-2 border-b border-nf-border-light">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-nf-text-tertiary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("codex.searchPlaceholder")}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-nf-bg-input border border-nf-border-light rounded text-nf-text placeholder:text-nf-text-tertiary focus:outline-none focus:border-fandex-primary transition-colors"
            />
          </div>
        </div>

        {/* 实体列表（按类型分组） */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-nf-text-tertiary">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              <span className="text-xs">{t("codex.loading")}</span>
            </div>
          ) : filteredEntities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-nf-text-tertiary">
              <Inbox className="w-8 h-8 mb-2 opacity-50" />
              <span className="text-xs">{searchQuery ? t("codex.noSearchResult") : t("codex.empty")}</span>
            </div>
          ) : (
            Object.entries(groupedEntities).map(([type, list]) => {
              const entityType = type as CodexEntityType;
              const Icon = TYPE_ICONS[entityType];
              return (
                <div key={type} className="mb-1">
                  {/* 分组标题 */}
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-nf-text-tertiary uppercase tracking-wider flex items-center gap-1.5">
                    <Icon className="w-3 h-3" />
                    {CODEX_TYPE_LABELS[entityType]}
                    <span className="text-nf-text-tertiary/60">({list!.length})</span>
                  </div>
                  {/* 实体项 */}
                  {list!.map((entity) => {
                    const isSelected = entity.id === selectedId;
                    return (
                      <div
                        key={`${entity.type}-${entity.id}`}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-all duration-150 relative group ${
                          isSelected
                            ? "bg-fandex-primary/10 text-fandex-primary"
                            : "text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover"
                        }`}
                      >
                        {/* 左侧色条激活指示器 */}
                        <span
                          className={`absolute left-0 top-1 bottom-1 w-[3px] bg-fandex-primary transition-all duration-150 ${
                            isSelected ? "opacity-100 scale-y-100" : "opacity-0 scale-y-0"
                          }`}
                          style={{ transformOrigin: "center" }}
                        />
                        <button
                          onClick={() => setSelectedId(entity.id)}
                          className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        >
                          <FileText className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                          <span className="truncate flex-1">{entity.name}</span>
                          {entity.aliases.length > 0 && (
                            <span className="text-[10px] text-nf-text-tertiary">
                              +{entity.aliases.length}
                            </span>
                          )}
                        </button>
                        {/* 删除按钮：悬停时显示 */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteEntity(entity);
                          }}
                          title={t("codex.deleteEntity")}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-nf-text-tertiary hover:text-red-500 transition duration-fast p-0.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 主区域：实体详情与出现追踪（占据中间最大空间） */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {selectedEntity ? (
          <>
            {/* 详情头部（固定项，禁止压缩，仅下方列表滚动） */}
            <div className="flex-shrink-0 px-6 py-4 border-b border-nf-border-light">
              <div className="flex items-center gap-3 mb-2">
                {(() => {
                  const Icon = TYPE_ICONS[selectedEntity.type];
                  return <Icon className="w-5 h-5 text-fandex-primary" />;
                })()}
                <h2 className="text-lg font-semibold text-nf-text">{selectedEntity.name}</h2>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-fandex-primary/10 text-fandex-primary font-medium">
                  {CODEX_TYPE_LABELS[selectedEntity.type]}
                </span>
              </div>
              {selectedEntity.aliases.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-nf-text-tertiary">
                  <span>{t("codex.aliasesLabel")}:</span>
                  {selectedEntity.aliases.map((alias, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-nf-bg-hover text-nf-text-secondary">
                      {alias}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 text-xs text-nf-text-tertiary">
                {t("codex.totalMentions", { count: totalMentions })}
              </div>
            </div>

            {/* 出现追踪列表 */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {mentionLoading ? (
                <div className="flex items-center justify-center py-12 text-nf-text-tertiary">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  <span className="text-xs">{t("codex.scanning")}</span>
                </div>
              ) : !mentions || mentions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-nf-text-tertiary">
                  <Inbox className="w-8 h-8 mb-2 opacity-50" />
                  <span className="text-xs">{t("codex.noMentions")}</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {mentions.map((mention, idx) => (
                    <button
                      key={`${mention.file_path}-${idx}`}
                      onClick={() => handleJumpToFile(mention)}
                      className="w-full text-left p-3 border border-nf-border-light bg-nf-bg-panel hover:border-fandex-primary/40 hover:bg-nf-bg-hover transition-all duration-150 group"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-3.5 h-3.5 flex-shrink-0 text-fandex-secondary" />
                          <span className="text-sm font-medium text-nf-text truncate">
                            {mention.file_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-fandex-secondary/10 text-fandex-secondary font-medium">
                            {t("codex.mentionCount", { count: mention.count })}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-nf-text-tertiary group-hover:text-fandex-primary transition-colors" />
                        </div>
                      </div>
                      <div className="text-xs text-nf-text-tertiary line-clamp-2 leading-relaxed">
                        {mention.preview}
                      </div>
                      <div className="text-[10px] text-nf-text-tertiary/60 mt-1 truncate">
                        {mention.file_path}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-nf-text-tertiary">
            <Library className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">{t("codex.selectEntityHint")}</p>
            <p className="text-xs mt-1 opacity-70">{t("codex.selectEntitySubHint")}</p>
          </div>
        )}
      </div>

      {/* 新增实体对话框（内嵌快速新增） */}
      {addDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
          onClick={() => !creating && setAddDialogOpen(false)}
        >
          <div
            className="nf-glass-panel w-full max-w-md bg-nf-bg-card border border-nf-border-light shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-nf-border-light">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-fandex-primary" />
                <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text">
                  {t("codex.addEntityTitle")}
                </h3>
              </div>
              <button
                onClick={() => setAddDialogOpen(false)}
                disabled={creating}
                className="p-1 text-nf-text-tertiary hover:text-nf-text transition duration-fast disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* 表单区 */}
            <div className="px-5 py-4 space-y-3">
              {/* 实体类型 */}
              <div>
                <label className="block text-xs text-nf-text-tertiary mb-1.5">
                  {t("codex.entityType")}
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(["character", "worldview", "glossary", "material"] as CodexEntityType[]).map((type) => {
                    const Icon = TYPE_ICONS[type];
                    const isActive = newEntityType === type;
                    return (
                      <button
                        key={type}
                        onClick={() => setNewEntityType(type)}
                        className={`flex flex-col items-center gap-1 py-2 border transition duration-fast ${
                          isActive
                            ? "border-fandex-primary bg-fandex-primary/10 text-fandex-primary"
                            : "border-nf-border-light text-nf-text-secondary hover:border-fandex-primary/40"
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span className="text-[10px]">{CODEX_TYPE_LABELS[type]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* 实体名称 */}
              <div>
                <label className="block text-xs text-nf-text-tertiary mb-1.5">
                  {t("codex.entityName")}
                </label>
                <input
                  type="text"
                  value={newEntityName}
                  onChange={(e) => setNewEntityName(e.target.value)}
                  placeholder={t("codex.entityNamePlaceholder")}
                  autoFocus
                  className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
                />
              </div>
              {/* 别名 */}
              <div>
                <label className="block text-xs text-nf-text-tertiary mb-1.5">
                  {t("codex.aliasesPlaceholder")}
                </label>
                <input
                  type="text"
                  value={newEntityAliases}
                  onChange={(e) => setNewEntityAliases(e.target.value)}
                  placeholder={t("codex.aliasesPlaceholder")}
                  className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast"
                />
              </div>
              {/* 正文内容（可选） */}
              <div>
                <label className="block text-xs text-nf-text-tertiary mb-1.5">
                  {t("codex.entityContent")}
                </label>
                <textarea
                  value={newEntityContent}
                  onChange={(e) => setNewEntityContent(e.target.value)}
                  placeholder={t("codex.entityContentPlaceholder")}
                  rows={3}
                  className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition duration-fast resize-none"
                />
              </div>
            </div>
            {/* 底部操作区 */}
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-nf-border-light">
              <button
                onClick={() => setAddDialogOpen(false)}
                disabled={creating}
                className="nf-tool-btn px-3 py-1.5 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
              >
                {t("codex.cancel")}
              </button>
              <button
                onClick={handleCreateEntity}
                disabled={creating || !newEntityName.trim()}
                className="nf-tool-btn group flex items-center gap-1.5 px-4 py-1.5 bg-fandex-primary hover:bg-fandex-primary-hover text-sm font-medium text-nf-text-inverse transition duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {creating ? t("app.creating") : t("codex.create")}
                {!creating && (
                  <Sparkles className="w-3 h-3 opacity-70 group-hover:opacity-100 transition-opacity" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除实体确认对话框 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("codex.deleteEntity")}
        message={deleteTarget ? `${t("codex.deleteConfirm", { name: deleteTarget.name })}\n${t("codex.deleteConfirmDesc")}` : ""}
        type="danger"
        confirmLabel={t("app.delete")}
        cancelLabel={t("app.cancel")}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
