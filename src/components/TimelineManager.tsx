// 时间线管理组件
//
// 功能概述：
// 用于管理小说项目的时间线，支持线性时间线与分支多线并行。
// 以可视化卡片形式展示事件节点，支持增删改查。
// 采用 FANDEX 直角美学与三色品牌体系。
//
// 模块职责：
// 1. 渲染时间线事件卡片(按时间排序)
// 2. 支持新建事件(含时间、标题、描述、分支标签)
// 3. 支持编辑与删除事件
// 4. 支持分支筛选

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Edit3, GitBranch, Clock, X } from "lucide-react";
import { useAppStore } from "../lib/store";
import { readFile, writeFile, deletePath, readProjectTree } from "../lib/api";
import type { FileNode } from "../lib/api";

// 时间线事件接口
interface TimelineEvent {
  // 文件相对路径
  relativePath: string;
  // 事件时间(用户自定义字符串)
  time: string;
  // 事件标题
  title: string;
  // 事件描述
  description: string;
  // 分支标签(主线/支线A等)
  branch: string;
}

// 时间线管理组件
// 输入: 无
// 输出: 渲染时间线界面
// 流程:
//   1. 从时间线目录加载所有事件文件
//   2. 解析事件元数据
//   3. 按时间排序展示
//   4. 支持新建/编辑/删除
export default function TimelineManager() {
  const { currentProject } = useAppStore();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [branches, setBranches] = useState<string[]>(["主线"]);
  const [activeBranch, setActiveBranch] = useState<string>("全部");
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [loading, setLoading] = useState(false);

  // 解析时间线文件内容为事件对象
  // 输入: content 文件内容, relativePath 相对路径
  // 输出: TimelineEvent 事件对象
  // 流程: 解析 Markdown 格式的事件元数据
  const parseEvent = (content: string, relativePath: string): TimelineEvent => {
    const lines = content.split("\n");
    let title = "";
    let time = "";
    let description = "";
    let branch = "主线";
    let inDescription = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("# ")) {
        title = trimmed.slice(2);
      } else if (trimmed.startsWith("- 时间:")) {
        time = trimmed.replace("- 时间:", "").trim();
      } else if (trimmed.startsWith("- 分支:")) {
        branch = trimmed.replace("- 分支:", "").trim();
      } else if (trimmed === "---" && !inDescription) {
        inDescription = true;
      } else if (inDescription && trimmed) {
        description += (description ? "\n" : "") + trimmed;
      }
    }

    return { relativePath, time, title, description, branch };
  };

  // 加载时间线事件
  // 输入: 无
  // 输出: 无
  // 流程: 读取时间线目录下所有文件并解析
  const loadEvents = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    try {
      const tree = await readProjectTree(currentProject.path);
      // 查找时间线目录
      const findDir = (nodes: FileNode[]): FileNode | null => {
        for (const n of nodes) {
          if (n.name === "时间线" && n.is_dir) return n;
          if (n.is_dir && n.children.length > 0) {
            const found = findDir(n.children);
            if (found) return found;
          }
        }
        return null;
      };
      const dir = findDir(tree);
      const files = dir?.children.filter((f) => !f.is_dir) || [];

      const eventList: TimelineEvent[] = [];
      const branchSet = new Set<string>(["主线"]);

      for (const file of files) {
        try {
          const content = await readFile(
            `${currentProject.path}\\${file.relative_path}`
          );
          const event = parseEvent(content, file.relative_path);
          eventList.push(event);
          branchSet.add(event.branch);
        } catch {
          // 跳过读取失败的文件
        }
      }

      // 按时间排序(字符串排序,用户应使用可排序的时间格式)
      eventList.sort((a, b) => a.time.localeCompare(b.time));
      setEvents(eventList);
      setBranches(Array.from(branchSet));
    } catch (e) {
      console.error("加载时间线失败:", e);
    } finally {
      setLoading(false);
    }
  }, [currentProject]);

  // 初始化加载
  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // 新建事件
  // 输入: 无
  // 输出: 无
  // 流程: 打开编辑器创建新事件
  const handleCreate = () => {
    setEditingEvent(null);
    setShowEditor(true);
  };

  // 编辑事件
  // 输入: event 事件对象
  // 输出: 无
  // 流程: 打开编辑器编辑现有事件
  const handleEdit = (event: TimelineEvent) => {
    setEditingEvent(event);
    setShowEditor(true);
  };

  // 删除事件
  // 输入: event 事件对象
  // 输出: 无
  // 流程: 确认后删除文件并刷新
  const handleDelete = async (event: TimelineEvent) => {
    if (!currentProject) return;
    if (!confirm(`确定删除事件 "${event.title}" 吗?`)) return;
    try {
      await deletePath(`${currentProject.path}\\${event.relativePath}`);
      await loadEvents();
    } catch (e) {
      alert(`删除失败: ${e}`);
    }
  };

  // 保存事件
  // 输入: event 事件数据
  // 输出: 无
  // 流程: 将事件序列化为 Markdown 并写入文件
  const handleSaveEvent = async (event: TimelineEvent) => {
    if (!currentProject) return;
    const content = `# ${event.title}\n\n- 时间: ${event.time}\n- 分支: ${event.branch}\n\n---\n\n${event.description}\n`;
    try {
      await writeFile(`${currentProject.path}\\${event.relativePath}`, content);
      setShowEditor(false);
      setEditingEvent(null);
      await loadEvents();
    } catch (e) {
      alert(`保存失败: ${e}`);
    }
  };

  // 过滤当前分支的事件
  const filteredEvents =
    activeBranch === "全部"
      ? events
      : events.filter((e) => e.branch === activeBranch);

  return (
    <div className="flex-1 flex flex-col bg-nf-bg overflow-hidden">
      {/* 顶部工具栏 - FANDEX 直角 + 左侧色条标题 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-nf-border-light">
        <h2 className="fandex-bar-left text-lg font-semibold font-display text-nf-text">
          时间线
        </h2>
        <button
          onClick={handleCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-fandex-primary hover:bg-fandex-primary-hover text-nf-text-inverse transition-fast"
        >
          <Plus className="w-4 h-4" />
          新建事件
        </button>
      </div>

      {/* 分支筛选 - FANDEX 直角标签 */}
      <div className="flex items-center gap-1 px-6 py-2 border-b border-nf-border-light bg-nf-bg-sidebar">
        <GitBranch className="w-3.5 h-3.5 text-nf-text-tertiary mr-1" />
        {["全部", ...branches].map((b) => (
          <button
            key={b}
            onClick={() => setActiveBranch(b)}
            className={`px-2.5 py-0.5 text-xs transition-fast ${
              activeBranch === b
                ? "bg-fandex-primary/15 text-fandex-primary border border-fandex-primary/40"
                : "text-nf-text-tertiary hover:text-nf-text border border-transparent"
            }`}
          >
            {b}
          </button>
        ))}
      </div>

      {/* 时间线列表 */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full text-nf-text-tertiary text-sm">
            加载中...
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Clock className="w-16 h-16 text-nf-border mb-4" />
            <p className="text-sm text-nf-text-tertiary mb-4">
              暂无时间线事件
            </p>
          </div>
        ) : (
          <div className="relative max-w-3xl mx-auto">
            {/* 时间线竖线 - FANDEX 1px 主色渐变 */}
            <div className="absolute left-4 top-0 bottom-0 w-px bg-gradient-to-b from-fandex-primary/60 via-nf-border-light to-transparent" />

            {filteredEvents.map((event) => (
              <div
                key={event.relativePath}
                className="relative pl-12 pb-6 group"
              >
                {/* 时间线节点 - FANDEX 直角方块 */}
                <div className="absolute left-[11px] top-2 w-[10px] h-[10px] bg-fandex-primary border-2 border-nf-bg z-10" />

                {/* 事件卡片 - FANDEX 直角 + 左侧色条 */}
                <div className="fandex-bar-left bg-nf-bg-card/40 border border-nf-border-light hover:border-fandex-primary/40 p-4 transition-fast">
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-fandex-primary font-medium font-display">
                          {event.time}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-fandex-secondary/10 text-fandex-secondary border border-fandex-secondary/20">
                          {event.branch}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold font-display text-nf-text">
                        {event.title}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-fast ml-2">
                      <button
                        onClick={() => handleEdit(event)}
                        className="p-1 text-nf-text-tertiary hover:text-fandex-primary transition-fast"
                        title="编辑事件"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(event)}
                        className="p-1 text-nf-text-tertiary hover:text-red-400 transition-fast"
                        title="删除事件"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {event.description && (
                    <p className="text-xs text-nf-text-secondary leading-relaxed whitespace-pre-wrap">
                      {event.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 事件编辑器对话框 */}
      {showEditor && (
        <EventEditor
          event={editingEvent}
          branches={branches}
          onClose={() => {
            setShowEditor(false);
            setEditingEvent(null);
          }}
          onSave={handleSaveEvent}
        />
      )}
    </div>
  );
}

// 事件编辑器对话框属性接口
interface EventEditorProps {
  event: TimelineEvent | null;
  branches: string[];
  onClose: () => void;
  onSave: (event: TimelineEvent) => void;
}

// 事件编辑器对话框组件 - FANDEX 直角风格
// 输入: event 事件数据, branches 分支列表, onClose 关闭回调, onSave 保存回调
// 输出: 渲染编辑对话框
// 流程: 收集用户输入并触发保存
function EventEditor({ event, branches, onClose, onSave }: EventEditorProps) {
  const [title, setTitle] = useState(event?.title || "");
  const [time, setTime] = useState(event?.time || "");
  const [branch, setBranch] = useState(event?.branch || "主线");
  const [description, setDescription] = useState(event?.description || "");
  const [newBranch, setNewBranch] = useState("");

  // 生成文件相对路径
  // 输入: 无
  // 输出: 文件相对路径
  // 流程: 使用标题生成文件名
  const getRelativePath = () => {
    const fileName = (title || "未命名事件")
      .replace(/[<>:"/\\|?*]/g, "_")
      .slice(0, 50);
    return event?.relativePath || `时间线/${fileName}.md`;
  };

  // 处理保存
  // 输入: 无
  // 输出: 无
  // 流程: 校验后调用 onSave
  const handleSave = () => {
    if (!title.trim()) {
      alert("请输入事件标题");
      return;
    }
    const finalBranch = newBranch.trim() || branch;
    onSave({
      relativePath: getRelativePath(),
      time: time || "未知时间",
      title: title.trim(),
      description: description.trim(),
      branch: finalBranch,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-nf-bg-card border border-nf-border-light shadow-lg overflow-hidden">
        {/* 头部 - FANDEX 左侧色条标题 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-nf-border-light">
          <h3 className="fandex-bar-left text-sm font-semibold font-display text-nf-text">
            {event ? "编辑事件" : "新建事件"}
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-nf-bg-hover text-nf-text-tertiary transition-fast"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 表单 - FANDEX 直角输入框 */}
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs text-nf-text-secondary mb-1">
              事件标题
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入事件标题"
              autoFocus
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition-fast"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-nf-text-secondary mb-1">
                时间
              </label>
              <input
                type="text"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="如: 第一章 / 1000年"
                className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition-fast"
              />
            </div>
            <div>
              <label className="block text-xs text-nf-text-secondary mb-1">
                分支
              </label>
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text focus:outline-none focus:border-fandex-primary/60 transition-fast"
              >
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-nf-text-secondary mb-1">
              新分支(可选,留空使用上方选择)
            </label>
            <input
              type="text"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              placeholder="输入新分支名"
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition-fast"
            />
          </div>
          <div>
            <label className="block text-xs text-nf-text-secondary mb-1">
              事件描述
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="详细描述事件内容"
              rows={4}
              className="w-full bg-nf-bg border border-nf-border-light px-3 py-2 text-sm text-nf-text placeholder-nf-text-tertiary focus:outline-none focus:border-fandex-primary/60 transition-fast resize-none"
            />
          </div>
        </div>

        {/* 底部按钮 - FANDEX 直角 */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-nf-border-light">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-nf-text-secondary hover:text-nf-text hover:bg-nf-bg-hover transition-fast"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 bg-fandex-primary hover:bg-fandex-primary-hover text-sm font-medium text-nf-text-inverse transition-fast"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
