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
  Edit3,
  ArrowRight,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { useCodexStore } from "../lib/stores/useCodexStore";
import { useToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import { logger } from "../lib/logger";
import { readProjectTree } from "../lib/api";
import {
  scanEntityMentions,
  createCodexEntity,
  deleteCodexEntity,
  scanInvalidMentions,
  CODEX_TYPE_LABELS,
  type CodexCard,
  type CodexEntityType,
  type EntityMention,
} from "../lib/codexApi";
import ConfirmDialog from "./ConfirmDialog";
import CodexCardEditor from "./CodexCardEditor";

// Codex 实体类型图标映射
const TYPE_ICONS: Record<CodexEntityType, React.ComponentType<{ className?: string }>> = {
  character: Users,
  worldview: Globe,
  glossary: Book,
  material: Package,
};

/**
 * ProseMirror JSON 节点结构（用于内容预览提取的类型安全遍历）
 */
interface ProseMirrorNode {
  type?: string;
  text?: string;
  content?: ProseMirrorNode[];
}

/**
 * 从 ProseMirror JSON 内容中提取纯文本预览
 * 输入: contentJson ProseMirror JSON 字符串（.pmd 文件正文部分）
 * 输出: string 纯文本预览（段落以换行分隔，截断至 200 字符）
 * 流程:
 *   1. 解析 JSON，递归遍历节点树
 *   2. 收集 text 节点的 text 字段
 *   3. 段落间以换行分隔，超长内容截断并追加省略号
 */
function extractContentPreview(contentJson: string): string {
  if (!contentJson) return "";
  try {
    const doc = JSON.parse(contentJson) as ProseMirrorNode;
    const lines: string[] = [];
    // 递归遍历 ProseMirror 节点树，收集所有 text 节点的文本内容
    const walk = (node: ProseMirrorNode) => {
      if (node.text) {
        lines.push(node.text);
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content) {
          walk(child);
        }
      }
    };
    walk(doc);
    // 段落间换行分隔，首尾空白清理
    const text = lines.join("\n").trim();
    if (!text) return "";
    // 截断至 200 字符，超出追加省略号
    return text.length > 200 ? text.slice(0, 200) + "..." : text;
  } catch {
    // content 非合法 JSON，返回原始字符串截断
    const text = contentJson.trim();
    return text.length > 200 ? text.slice(0, 200) + "..." : text;
  }
}

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

  // Sprint 1 任务 1.3b：从 useCodexStore 读取设定库数据（SSOT）
  // cards 为 Map<string, CodexCard>，订阅后状态变更自动触发重渲染
  const cards = useCodexStore((s) => s.cards);
  const loadAll = useCodexStore((s) => s.loadAll);
  const deleteCardFromStore = useCodexStore((s) => s.deleteCard);
  const resetStore = useCodexStore((s) => s.reset);
  // 派生查询 selector：getAll / getFiltered / getGrouped 已下沉至 store，组件仅订阅引用与 cards 触发更新
  const getAllCards = useCodexStore((s) => s.getAll);
  const getFilteredCards = useCodexStore((s) => s.getFiltered);
  const getGroupedCards = useCodexStore((s) => s.getGrouped);
  // Sprint 3 任务 3.3：订阅 pendingSelectCardId 实现跨组件跳转
  // NovelEditor 双击 characterMentionNode 时设置此值，CodexPanel 消费后选中对应卡片
  const pendingSelectCardId = useCodexStore((s) => s.pendingSelectCardId);
  const setPendingSelectCardId = useCodexStore((s) => s.setPendingSelectCardId);
  // Sprint 3 任务 3.5：订阅 pendingEditMode 实现右键菜单"编辑设定"自动进入编辑模式
  const pendingEditMode = useCodexStore((s) => s.pendingEditMode);
  const setPendingEditMode = useCodexStore((s) => s.setPendingEditMode);

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
  const [deleteTarget, setDeleteTarget] = useState<CodexCard | null>(null);
  // Sprint 2 任务 2.5：删除失效检测结果（正文中引用该卡片的 characterMentionNode 总数）
  // 大于 0 时删除确认对话框追加失效警告提示
  const [deleteInvalidCount, setDeleteInvalidCount] = useState(0);

  // Sprint 2 任务 2.3：查看/编辑模式切换状态
  // editing 为 true 时渲染 CodexCardEditor，false 时渲染只读详情视图
  const [editing, setEditing] = useState(false);

  // 加载设定库卡片：项目切换时调用 useCodexStore.loadAll
  // loadAll 内部调用后端 list_codex_entities 并填充 Map，组件订阅 cards 自动重渲染
  const loadEntities = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    try {
      await loadAll(currentProject.path);
    } catch (e) {
      showToast("error", t("codex.loadFailed", { error: String(e) }));
    } finally {
      setLoading(false);
    }
  }, [currentProject, loadAll, showToast, t]);

  // 同步刷新项目目录树：设定卡片 CRUD 后触发，确保 FileList 显示最新文件状态
  // 静默执行，失败仅记录日志不阻塞主流程（FileList 订阅 projectTree 自动重渲染）
  const refreshProjectTree = useCallback(async () => {
    if (!currentProject) return;
    try {
      const tree = await readProjectTree(currentProject.path);
      useAppStore.getState().setProjectTree(tree);
    } catch (err) {
      logger.error("刷新项目目录树失败:", err instanceof Error ? err : String(err));
    }
  }, [currentProject]);

  useEffect(() => {
    // 项目切换时先重置 Store，避免上一个项目的卡片残留
    resetStore();
    loadEntities();
  }, [loadEntities, resetStore]);

  // cards 全量数组：通过 store.getAll() selector 派生（保持 Map 插入顺序，不排序）
  // 依赖 cards 触发 useMemo 重新计算，派生逻辑下沉至 store
  const cardsList = useMemo(() => getAllCards(), [getAllCards, cards]);

  // 选中实体后懒加载出现追踪
  const selectedEntity = useMemo(
    () => (selectedId ? cards.get(selectedId) || null : null),
    [cards, selectedId]
  );

  const loadMentions = useCallback(async (entity: CodexCard) => {
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

  // Sprint 2 任务 2.3：选中实体变化时退出编辑模式，避免上一个卡片的未保存改动残留
  // 设计说明：原实现使用 useEffect 监听 selectedId 变化重置 editing，
  // 但会与 pendingEditMode（右键菜单"编辑设定"）冲突 —— 程序化选中后 setEditing(true)
  // 会被 selectedId 变化触发的 effect 覆盖为 false。
  // 修正：移除 effect，改为在用户手动点击卡片时调用 handleSelectCard 重置编辑态，
  // 程序化选中（pendingSelectCardId / 新建后选中）不受影响，保留其编辑态控制权。

  // Sprint 3 任务 3.3：订阅 pendingSelectCardId 实现跨组件跳转
  // 当 NovelEditor 双击 characterMentionNode 时设置此值，CodexPanel 消费后选中对应卡片
  // 一次性信号量：消费后立即清空，避免重复触发
  // Sprint 3 任务 3.5：若 pendingEditMode 为 true，选中后自动进入编辑模式
  useEffect(() => {
    if (!pendingSelectCardId) return;
    // 校验卡片是否存在（可能因未加载完成或 UUID 失效而缺失）
    if (cards.has(pendingSelectCardId)) {
      setSelectedId(pendingSelectCardId);
      // 右键菜单"编辑设定"触发：选中后自动进入编辑模式
      if (pendingEditMode) {
        setEditing(true);
        setPendingEditMode(false);
      }
    } else {
      showToast("warning", t("codex.cardNotFound"));
    }
    setPendingSelectCardId(null);
  }, [pendingSelectCardId, cards, setPendingSelectCardId, pendingEditMode, setPendingEditMode, showToast, t]);

  // 搜索过滤：通过 store.getFiltered(query) selector 派生（不排序，保持原 UI 顺序）
  // 匹配 name / aliases / tags / summary 四个字段，逻辑下沉至 store
  const filteredEntities = useMemo(
    () => getFilteredCards(searchQuery),
    [getFilteredCards, searchQuery, cards]
  );

  // 按类型分组：通过 store.getGrouped(query) selector 派生
  // 内部基于 getFiltered 过滤后按 cardType 分组，逻辑下沉至 store
  const groupedEntities = useMemo(
    () => getGroupedCards(searchQuery),
    [getGroupedCards, searchQuery, cards]
  );

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

  // Sprint 3 任务 3.4：在正文中查找按钮处理
  // 点击行为：
  //   - mentions 已加载且非空：跳转到第一个匹配文件
  //   - mentions 未加载或为空：触发扫描（扫描完成后由 useEffect 自动填充）
  // 设计说明: 提供主动触发入口，避免用户需滚动到列表底部才能跳转
  const handleFindInManuscript = useCallback(() => {
    if (!selectedEntity) return;
    if (mentions && mentions.length > 0) {
      // 已有匹配结果：直接跳转到第一个文件
      handleJumpToFile(mentions[0]);
    } else {
      // 无结果：触发扫描（扫描完成后 mentions 更新，用户可再点击跳转）
      loadMentions(selectedEntity);
    }
  }, [selectedEntity, mentions, handleJumpToFile, loadMentions]);

  // 打开新增实体对话框：指定类型预填
  const handleOpenAddDialog = useCallback((type: CodexEntityType) => {
    setNewEntityType(type);
    setNewEntityName("");
    setNewEntityAliases("");
    setNewEntityContent("");
    setAddDialogOpen(true);
    setAddMenuOpen(false);
  }, []);

  // 提交新增实体：调用后端创建 .pmd 文件后刷新 Store
  // 创建成功后通过名称查找新卡片并自动选中（ID 为 UUID，前端创建时不可知）
  const handleCreateEntity = useCallback(async () => {
    if (!currentProject) return;
    const name = newEntityName.trim();
    if (!name) {
      showToast("warning", t("codex.nameRequired"));
      return;
    }
    // 检查重名：同类型下不允许重名（基于 Store 中的 cardsList）
    const exists = cardsList.some(
      (c) => c.cardType === newEntityType && c.name === name
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
      // 刷新 Store 以加载新创建的卡片（后端生成 UUID，前端需重新拉取）
      await loadEntities();
      // 同步刷新项目目录树：新建的 .pmd 文件需在 FileList 中显示
      refreshProjectTree();
      // 精确选中新建卡片：按名称 + 类型双重匹配，避免同名跨类型卡片误选
      // getByName 仅按名称匹配，同名不同类型时可能返回错误卡片
      const allCards = Array.from(useCodexStore.getState().cards.values());
      const newCard = allCards.find(
        (c) => c.name === name && c.cardType === newEntityType
      );
      if (newCard) setSelectedId(newCard.id);
    } catch (e) {
      showToast("error", t("codex.createFailed", { error: String(e) }));
    } finally {
      setCreating(false);
    }
  }, [currentProject, newEntityName, newEntityAliases, newEntityContent, newEntityType, cardsList, showToast, t, loadEntities, refreshProjectTree]);

  // 删除实体：先扫描正文中引用该卡片的 characterMentionNode，再打开确认对话框
  // Sprint 2 任务 2.5：若检测到失效引用，确认对话框追加警告提示
  const handleDeleteEntity = useCallback(
    async (card: CodexCard) => {
      setDeleteTarget(card);
      setDeleteInvalidCount(0);
      // 当前项目不可用时直接打开对话框（不进行失效检测）
      if (!currentProject) {
        return;
      }
      try {
        // 扫描正文中引用该卡片 UUID 的 characterMentionNode
        const invalidMentions = await scanInvalidMentions(
          currentProject.path,
          card.id
        );
        // 汇总各文件的引用数量
        const totalCount = invalidMentions.reduce(
          (sum, m) => sum + m.count,
          0
        );
        setDeleteInvalidCount(totalCount);
      } catch {
        // 扫描失败时不阻塞删除流程，按无失效提及处理
        setDeleteInvalidCount(0);
      }
    },
    [currentProject]
  );

  // 确认删除实体：调用后端删除文件后同步移除 Store 中的卡片
  const handleConfirmDelete = useCallback(async () => {
    if (!currentProject || !deleteTarget) return;
    try {
      await deleteCodexEntity(currentProject.path, deleteTarget.sourceFile);
      showToast("success", t("codex.deleteSuccess", { name: deleteTarget.name }));
      // 从 Store 中移除该卡片（SSOT：Store 删除即 UI 更新）
      deleteCardFromStore(deleteTarget.id);
      // 同步刷新项目目录树：删除的 .pmd 文件需从 FileList 中移除
      refreshProjectTree();
      // 若删除的是当前选中项，清空选中
      if (selectedId === deleteTarget.id) {
        setSelectedId(null);
      }
      setDeleteTarget(null);
      setDeleteInvalidCount(0);
    } catch (e) {
      showToast("error", t("codex.deleteFailed", { error: String(e) }));
    }
  }, [currentProject, deleteTarget, selectedId, showToast, t, deleteCardFromStore, refreshProjectTree]);

  // 取消删除：重置删除目标与失效计数
  const handleCancelDelete = useCallback(() => {
    setDeleteTarget(null);
    setDeleteInvalidCount(0);
  }, []);

  // 总出现次数统计
  const totalMentions = useMemo(() => {
    if (!mentions) return 0;
    return mentions.reduce((sum, m) => sum + m.count, 0);
  }, [mentions]);

  // 用户手动点击卡片选中：重置编辑态，避免上一个卡片的未保存改动残留
  // 程序化选中（pendingSelectCardId / 新建后选中）不经过此路径，保留其编辑态控制权
  const handleSelectCard = useCallback((cardId: string) => {
    setSelectedId(cardId);
    setEditing(false);
  }, []);

  return (
    <div className="flex h-full w-full flex-1 bg-nf-bg-panel min-w-0">
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
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-nf-bg-input border border-nf-border-light text-nf-text placeholder:text-nf-text-tertiary focus:outline-none focus:border-fandex-primary transition-colors"
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
                  {list!.map((card) => {
                    const isSelected = card.id === selectedId;
                    return (
                      <div
                        key={card.id}
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
                          onClick={() => handleSelectCard(card.id)}
                          className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        >
                          <FileText className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                          <span className="truncate flex-1">{card.name}</span>
                          {card.aliases.length > 0 && (
                            <span className="text-[10px] text-nf-text-tertiary">
                              +{card.aliases.length}
                            </span>
                          )}
                        </button>
                        {/* 删除按钮：悬停时显示 */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteEntity(card);
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
          // Sprint 2 任务 2.3：查看/编辑模式切换
          // editing 为 true 且项目路径可用时渲染 CodexCardEditor，否则渲染只读详情视图
          editing && currentProject ? (
            <CodexCardEditor
              card={selectedEntity}
              projectPath={currentProject.path}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                // 同步刷新项目目录树：卡片改名会重命名 .pmd 文件，需更新 FileList
                refreshProjectTree();
              }}
            />
          ) : (
            <>
              {/* 详情头部（固定项，禁止压缩，仅下方列表滚动） */}
              <div className="flex-shrink-0 px-6 py-4 border-b border-nf-border-light">
                <div className="flex items-center gap-3 mb-2">
                  {(() => {
                    const Icon = TYPE_ICONS[selectedEntity.cardType];
                    return <Icon className="w-5 h-5 text-fandex-primary" />;
                  })()}
                  <h2 className="text-lg font-semibold text-nf-text">{selectedEntity.name}</h2>
                  <span className="text-[10px] px-1.5 py-0.5 bg-fandex-primary/10 text-fandex-primary font-medium">
                    {CODEX_TYPE_LABELS[selectedEntity.cardType]}
                  </span>
                  {/* Sprint 2 任务 2.3：编辑卡片按钮，点击进入编辑模式 */}
                  <button
                    onClick={() => setEditing(true)}
                    title={t("codex.editCard")}
                    className="ml-auto flex items-center gap-1.5 px-3 py-1 text-xs border border-nf-border-light text-nf-text-secondary hover:text-fandex-primary hover:border-fandex-primary/60 hover:bg-fandex-primary/5 transition duration-fast"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    {t("codex.editCard")}
                  </button>
                  {/* Sprint 3 任务 3.4：在正文中查找按钮，跳转到第一个匹配文件或触发扫描 */}
                  <button
                    onClick={handleFindInManuscript}
                    title={t("codex.findInManuscript")}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs border border-nf-border-light text-nf-text-secondary hover:text-fandex-secondary hover:border-fandex-secondary/60 hover:bg-fandex-secondary/5 transition duration-fast"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    {t("codex.findInManuscript")}
                  </button>
                </div>
                {selectedEntity.aliases.length > 0 && (
                  <div className="flex items-center gap-2 text-xs text-nf-text-tertiary">
                    <span>{t("codex.aliasesLabel")}:</span>
                    {selectedEntity.aliases.map((alias, i) => (
                      <span key={i} className="px-1.5 py-0.5 bg-nf-bg-hover text-nf-text-secondary">
                        {alias}
                      </span>
                    ))}
                  </div>
                )}
                {/* 简介展示（Sprint 2 新增字段，非空时显示） */}
                {selectedEntity.summary && (
                  <div className="mt-2 text-xs text-nf-text-secondary leading-relaxed">
                    {selectedEntity.summary}
                  </div>
                )}
                {/* 正文内容预览：从 ProseMirror JSON 提取纯文本，截断至 200 字符 */}
                {/* 为只读详情视图提供快速内容预览，避免每次查看都需进入编辑模式 */}
                {(() => {
                  const preview = extractContentPreview(selectedEntity.content);
                  return preview ? (
                    <div className="mt-2 text-xs text-nf-text-tertiary leading-relaxed whitespace-pre-wrap border-l-2 border-nf-border-light pl-2">
                      {preview}
                    </div>
                  ) : null;
                })()}
                {/* 标签展示（Sprint 2 新增字段，非空时显示） */}
                {selectedEntity.tags.length > 0 && (
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    {selectedEntity.tags.map((tag, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-1.5 py-0.5 bg-fandex-secondary/10 text-fandex-secondary border border-fandex-secondary/20"
                      >
                        {tag}
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
                            <span className="text-[10px] px-1.5 py-0.5 bg-fandex-secondary/10 text-fandex-secondary font-medium">
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
          )
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
                className="nf-tool-btn h-8 px-4 text-sm flex items-center justify-center gap-1.5 border border-nf-border-light text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition duration-fast"
              >
                {t("codex.cancel")}
              </button>
              <button
                onClick={handleCreateEntity}
                disabled={creating || !newEntityName.trim()}
                className="nf-tool-btn group h-8 px-4 text-sm flex items-center justify-center gap-1.5 bg-fandex-primary hover:bg-fandex-primary-hover font-medium text-nf-text-inverse transition duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* 删除实体确认对话框（Sprint 2 任务 2.5：含失效提及警告） */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("codex.deleteEntity")}
        message={
          deleteTarget
            ? deleteInvalidCount > 0
              ? `${t("codex.deleteConfirm", { name: deleteTarget.name })}\n${t(
                  "codex.deleteWithInvalidWarning",
                  { count: deleteInvalidCount }
                )}\n${t("codex.deleteConfirmDesc")}`
              : `${t("codex.deleteConfirm", { name: deleteTarget.name })}\n${t(
                  "codex.deleteConfirmDesc"
                )}`
            : ""
        }
        type="danger"
        confirmLabel={t("app.delete")}
        cancelLabel={t("app.cancel")}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}
