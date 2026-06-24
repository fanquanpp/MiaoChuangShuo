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
import { Plus, Trash2, ChevronLeft, Save, FileText } from "lucide-react";
import { useAppStore, CATEGORY_DIRS } from "../lib/store";
import { readProjectTree, createFile, deletePath, readFile, writeFile } from "../lib/api";
import type { FileNode } from "../lib/api";

// 卡片管理属性接口
interface CardManagerProps {
  // 卡片类型标签(如"角色"、"世界观")
  categoryLabel: string;
}

// 卡片项接口
interface CardItem {
  // 文件节点
  node: FileNode;
  // 卡片标题(文件名去掉扩展名)
  title: string;
  // 卡片内容预览
  preview: string;
}

// 卡片管理组件
// 输入: categoryLabel 分类标签
// 输出: 渲染卡片网格或卡片编辑界面
// 流程:
//   1. 加载当前分类目录下的文件作为卡片
//   2. 点击卡片进入编辑模式
//   3. 编辑模式下使用 TipTap 编辑器
export default function CardManager({ categoryLabel }: CardManagerProps) {
  const { currentProject, activeCategory } = useAppStore();
  const [cards, setCards] = useState<CardItem[]>([]);
  const [editingCard, setEditingCard] = useState<CardItem | null>(null);
  const [editContent, setEditContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);

  // 加载卡片列表
  // 输入: 无
  // 输出: 无
  // 流程: 从项目目录树中过滤当前分类的文件
  const loadCards = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    try {
      const tree = await readProjectTree(currentProject.path);
      const dirName = CATEGORY_DIRS[activeCategory];
      // 查找当前分类目录
      const findDir = (nodes: FileNode[]): FileNode | null => {
        for (const n of nodes) {
          if (n.name === dirName && n.is_dir) return n;
          if (n.is_dir && n.children.length > 0) {
            const found = findDir(n.children);
            if (found) return found;
          }
        }
        return null;
      };
      const dir = findDir(tree);
      const files = dir?.children.filter((f) => !f.is_dir) || [];

      // 加载每个文件的预览
      const cardItems: CardItem[] = [];
      for (const file of files) {
        try {
          const content = await readFile(
            `${currentProject.path}\\${file.relative_path}`
          );
          cardItems.push({
            node: file,
            title: file.name.replace(/\.(md|txt)$/i, ""),
            preview: content.slice(0, 100).replace(/[#*\n]/g, " ").trim(),
          });
        } catch {
          cardItems.push({
            node: file,
            title: file.name.replace(/\.(md|txt)$/i, ""),
            preview: "",
          });
        }
      }
      setCards(cardItems);
    } catch (e) {
      console.error("加载卡片失败:", e);
    } finally {
      setLoading(false);
    }
  }, [currentProject, activeCategory]);

  // 初始化加载
  useEffect(() => {
    loadCards();
  }, [loadCards]);

  // 新建卡片
  // 输入: 无
  // 输出: 无
  // 流程: 创建新文件并刷新列表
  const handleCreateCard = async () => {
    if (!currentProject) return;
    const title = prompt(`输入${categoryLabel}名称:`);
    if (!title) return;
    try {
      const dirName = CATEGORY_DIRS[activeCategory];
      await createFile(currentProject.path, `${dirName}/${title}.md`, `# ${title}\n\n`);
      await loadCards();
    } catch (e) {
      alert(`创建失败: ${e}`);
    }
  };

  // 删除卡片
  // 输入: card 卡片项, e 事件
  // 输出: 无
  // 流程: 确认后删除文件并刷新
  const handleDeleteCard = async (card: CardItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentProject) return;
    if (!confirm(`确定删除 "${card.title}" 吗?`)) return;
    try {
      await deletePath(`${currentProject.path}\\${card.node.relative_path}`);
      await loadCards();
    } catch (e) {
      alert(`删除失败: ${e}`);
    }
  };

  // 打开卡片编辑
  // 输入: card 卡片项
  // 输出: 无
  // 流程: 加载文件内容并进入编辑模式
  const handleOpenCard = async (card: CardItem) => {
    if (!currentProject) return;
    try {
      const content = await readFile(
        `${currentProject.path}\\${card.node.relative_path}`
      );
      setEditingCard(card);
      setEditContent(content);
      setDirty(false);
    } catch (e) {
      alert(`加载失败: ${e}`);
    }
  };

  // 保存卡片
  // 输入: 无
  // 输出: 无
  // 流程: 将编辑内容写入文件
  const handleSave = async () => {
    if (!currentProject || !editingCard) return;
    try {
      await writeFile(
        `${currentProject.path}\\${editingCard.node.relative_path}`,
        editContent
      );
      setDirty(false);
      await loadCards();
    } catch (e) {
      alert(`保存失败: ${e}`);
    }
  };

  // 编辑模式
  if (editingCard) {
    return (
      <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden">
        {/* 顶部工具栏 - FANDEX 左侧色条标题 */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-nf-border-light bg-nf-bg-sidebar">
          <button
            onClick={() => {
              setEditingCard(null);
              loadCards();
            }}
            className="flex items-center gap-1 text-sm text-nf-text-tertiary hover:text-fandex-primary transition-fast"
          >
            <ChevronLeft className="w-4 h-4" />
            返回列表
          </button>
          <h2 className="fandex-bar-left text-sm font-bold font-display text-nf-text">{editingCard.title}</h2>
          <div className="ml-auto flex items-center gap-2">
            {dirty && <span className="text-xs text-fandex-tertiary">未保存</span>}
            <button
              onClick={handleSave}
              disabled={!dirty}
              className="flex items-center gap-1 px-3 py-1 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition-fast disabled:opacity-30"
            >
              <Save className="w-3.5 h-3.5" />
              保存
            </button>
          </div>
        </div>

        {/* 编辑区 */}
        <div className="flex-1 overflow-y-auto p-6">
          <textarea
            value={editContent}
            onChange={(e) => {
              setEditContent(e.target.value);
              setDirty(true);
            }}
            className="w-full h-full bg-transparent text-nf-text text-base leading-loose resize-none focus:outline-none font-sans"
            placeholder="开始编辑内容..."
          />
        </div>
      </div>
    );
  }

  // 列表模式
  return (
    <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden">
      {/* 顶部标题栏 - FANDEX 左侧色条 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
        <h2 className="fandex-bar-left text-lg font-bold font-display text-nf-text">{categoryLabel}</h2>
        <button
          onClick={handleCreateCard}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition-fast"
        >
          <Plus className="w-4 h-4" />
          新建{categoryLabel}
        </button>
      </div>

      {/* 卡片网格 - FANDEX 1px 间距网格 */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full text-nf-text-tertiary text-sm">
            加载中...
          </div>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <FileText className="w-16 h-16 text-nf-border mb-4" />
            <p className="text-sm text-nf-text-tertiary mb-4">
              暂无{categoryLabel}，点击右上角新建
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-1 bg-nf-border-light border border-nf-border-light">
            {cards.map((card) => (
              <div
                key={card.node.relative_path}
                onClick={() => handleOpenCard(card)}
                className="group relative bg-nf-bg hover:bg-nf-bg-hover p-4 cursor-pointer transition-fast"
              >
                {/* 删除按钮 */}
                <button
                  onClick={(e) => handleDeleteCard(card, e)}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-nf-text-tertiary hover:text-red-400 transition-fast"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                {/* 卡片标题 - FANDEX 左侧色条 */}
                <h3 className="fandex-bar-left text-sm font-bold font-display text-nf-text mb-2 pr-6 truncate">
                  {card.title}
                </h3>

                {/* 内容预览 */}
                <p className="text-xs text-nf-text-tertiary line-clamp-3 leading-relaxed">
                  {card.preview || "暂无内容"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
