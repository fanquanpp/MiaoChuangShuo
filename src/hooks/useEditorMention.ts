// 编辑器角色提及交互 Hook
//
// 功能概述：
// 抽取 NovelEditor 的角色提及相关交互逻辑，包括：
// 1. 角色名悬停卡片（鼠标悬停 500ms 显示摘要）
// 2. 角色提及节点双击跳转设定库
// 3. 角色提及节点右键菜单（查看/编辑/复制）
// 4. 右键菜单关闭逻辑（点击外部/Esc/滚动/失焦）
//
// 模块职责：
// - 管理 hoverCard 与 mentionContextMenu 状态
// - 注册编辑器 DOM 事件监听（dblclick/contextmenu/mousemove/mouseleave）
// - 提供菜单动作回调（查看设定/编辑设定/复制名称）
// - 所有 setTimeout 引用保存到 ref，卸载时清理
//
// 设计原则：
// - editor 实例通过 props 传入
// - 通过 requestAnimationFrame 节流 mousemove，避免高频阻塞主线程
// - 同一角色名内移动仅更新坐标，不重置计时器（避免闪烁）
// - 跨角色名切换立即切换（已激活悬停态，无需再次延迟）

import { useState, useEffect, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { useAppStore } from "../lib/store";
import { useCodexStore } from "../lib/stores/useCodexStore";
import type { ToastType } from "../lib/toast";

// ===== 类型定义 =====

/** 翻译函数类型（与 i18n 模块的 TFunction 对齐） */
type TranslateFn = (
  key: string,
  params?: Record<string, string | number>
) => string;

/** Toast 提示函数类型 */
type ShowToastFn = (
  type: ToastType,
  message: string,
  duration?: number
) => void;

/** 角色悬停卡片状态 */
export interface HoverCardState {
  /** 是否显示 */
  open: boolean;
  /** 卡片横坐标（鼠标 clientX） */
  x: number;
  /** 卡片纵坐标（鼠标 clientY） */
  y: number;
  /** 角色名 */
  name: string;
  /** 角色 UUID（来自实体高亮装饰的 data-entity-id，可能为 undefined） */
  characterId?: string;
}

/** 角色提及右键菜单状态 */
export interface MentionContextMenuState {
  /** 是否显示 */
  open: boolean;
  /** 菜单横坐标（鼠标 clientX） */
  x: number;
  /** 菜单纵坐标（鼠标 clientY） */
  y: number;
  /** 角色 UUID（null 表示旧版无 UUID 的提及节点） */
  characterId: string | null;
  /** 角色名文本 */
  characterName: string;
}

/** useEditorMention 输入参数 */
export interface UseEditorMentionParams {
  /** TipTap 编辑器实例 */
  editor: Editor | null;
  /** 角色名列表（来自 codexCards 派生） */
  characters: string[];
  /** Toast 提示函数 */
  showToast: ShowToastFn;
  /** 翻译函数 */
  t: TranslateFn;
}

/** useEditorMention 返回值 */
export interface UseEditorMentionResult {
  /** 悬停卡片状态 */
  hoverCard: HoverCardState;
  /** 右键菜单状态 */
  mentionContextMenu: MentionContextMenuState;
  /** 设置右键菜单状态（供 EditorContextMenu 关闭使用） */
  setMentionContextMenu: React.Dispatch<React.SetStateAction<MentionContextMenuState>>;
  /** 菜单动作：查看设定 */
  handleMentionViewInCodex: (characterId: string | null) => void;
  /** 菜单动作：编辑设定 */
  handleMentionEditInCodex: (characterId: string | null) => void;
  /** 菜单动作：复制角色名 */
  handleMentionCopyName: (characterName: string) => void;
}

// ===== Hook 实现 =====

/**
 * 编辑器角色提及交互 Hook
 * 输入: UseEditorMentionParams（editor/characters/showToast/t）
 * 输出: UseEditorMentionResult（hoverCard/mentionContextMenu/handlers）
 * 核心流程:
 *   1. 双击跳转 effect：监听 dblclick，提取 characterId 切换到设定库
 *   2. 右键菜单 effect：监听 contextmenu，弹出应用菜单
 *   3. 菜单关闭 effect：点击外部/Esc/滚动/失焦时关闭菜单
 *   4. 悬停卡片 effect：mousemove 节流检测角色名，延迟 500ms 显示
 *   5. 菜单动作：查看/编辑设定切换分类并设置 pendingSelectCardId/pendingEditMode
 * 定时器清理:
 *   - hoverTimerRef: 悬停延迟显示 timer
 *   - contextMenuClickTimerRef: 右键菜单 click 事件延迟绑定 timer
 */
export function useEditorMention(params: UseEditorMentionParams): UseEditorMentionResult {
  const { editor, characters, showToast, t } = params;

  // 悬停卡片状态
  const [hoverCard, setHoverCard] = useState<HoverCardState>({
    open: false,
    x: 0,
    y: 0,
    name: "",
  });
  // 悬停延迟显示 timer 引用
  const hoverTimerRef = useRef<number | null>(null);
  // 当前已显示的角色名引用：避免同一角色名上移动反复触发计时器
  const hoverShownNameRef = useRef<string>("");

  // 右键菜单状态
  const [mentionContextMenu, setMentionContextMenu] = useState<MentionContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    characterId: null,
    characterName: "",
  });
  // 右键菜单 click 事件延迟绑定 timer 引用（避免触发右键的同一交互周期立即关闭）
  const contextMenuClickTimerRef = useRef<number | null>(null);

  // ===== 双击跳转设定库 =====
  const setPendingSelectCardId = useCodexStore((s) => s.setPendingSelectCardId);
  useEffect(() => {
    if (!editor) return;
    const editorDom = editor.view.dom;
    /**
     * 双击事件处理：检测是否落在 characterMentionNode 上
     * 输入: e 鼠标双击事件
     * 流程:
     *   1. 通过 closest 查找最近的 .nf-character-mention 祖先元素
     *   2. 提取 data-character-id 属性
     *   3. 切换到 codex 分类并设置 pendingSelectCardId
     */
    const handleDoubleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const mentionEl = target.closest<HTMLElement>(".nf-character-mention");
      if (!mentionEl) return;
      const characterId = mentionEl.getAttribute("data-character-id");
      if (!characterId) {
        // 旧版无 UUID 的提及节点：提示用户该节点未关联设定库
        showToast("warning", t("characterMention.noLinkedEntity"));
        return;
      }
      // 切换到设定库分类并设置待选中卡片 ID
      useAppStore.getState().setActiveCategory("codex");
      setPendingSelectCardId(characterId);
    };
    editorDom.addEventListener("dblclick", handleDoubleClick);
    return () => {
      editorDom.removeEventListener("dblclick", handleDoubleClick);
    };
  }, [editor, setPendingSelectCardId, showToast, t]);

  // ===== 右键菜单事件 =====
  useEffect(() => {
    if (!editor) return;
    const editorDom = editor.view.dom;
    /**
     * 上下文菜单事件处理：检测是否落在 characterMentionNode 上
     * 输入: e 鼠标右键事件
     * 流程:
     *   1. 通过 closest 查找最近的 .nf-character-mention 祖先元素
     *   2. 阻止浏览器默认菜单并弹出应用菜单
     *   3. 提取 characterId（可能为 null）与角色名文本
     */
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const mentionEl = target.closest<HTMLElement>(".nf-character-mention");
      if (!mentionEl) return;
      e.preventDefault();
      const characterId = mentionEl.getAttribute("data-character-id");
      const characterName = mentionEl.textContent || "";
      setMentionContextMenu({
        open: true,
        x: e.clientX,
        y: e.clientY,
        characterId: characterId || null,
        characterName,
      });
    };
    editorDom.addEventListener("contextmenu", handleContextMenu);
    return () => {
      editorDom.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [editor]);

  // ===== 右键菜单关闭逻辑 =====
  useEffect(() => {
    if (!mentionContextMenu.open) return;
    const closeMenu = () =>
      setMentionContextMenu((prev) =>
        prev.open ? { ...prev, open: false } : prev
      );
    // 延迟绑定 click 事件，避免触发右键的同一交互周期立即关闭菜单
    // 保存 timer 引用到 ref，卸载时清理
    if (contextMenuClickTimerRef.current !== null) {
      window.clearTimeout(contextMenuClickTimerRef.current);
    }
    contextMenuClickTimerRef.current = window.setTimeout(() => {
      contextMenuClickTimerRef.current = null;
      window.addEventListener("click", closeMenu);
    }, 0);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    const handleContext = (e: MouseEvent) => {
      // 在菜单外右键：关闭当前菜单，让浏览器默认菜单生效
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".nf-mention-context-menu")) {
        closeMenu();
      } else {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("contextmenu", handleContext, true);
    window.addEventListener("blur", closeMenu);
    return () => {
      // 清理 click 延迟绑定 timer
      if (contextMenuClickTimerRef.current !== null) {
        window.clearTimeout(contextMenuClickTimerRef.current);
        contextMenuClickTimerRef.current = null;
      }
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("contextmenu", handleContext, true);
      window.removeEventListener("blur", closeMenu);
    };
  }, [mentionContextMenu.open]);

  // ===== 菜单动作回调 =====
  /**
   * 菜单动作：查看设定
   * 输入: characterId 角色 UUID
   * 流程: 切换到设定库分类 + 设置 pendingSelectCardId
   * 容错: characterId 为空时提示未关联实体
   */
  const handleMentionViewInCodex = useCallback(
    (characterId: string | null) => {
      if (!characterId) {
        showToast("warning", t("characterMention.noLinkedEntity"));
        return;
      }
      useAppStore.getState().setActiveCategory("codex");
      setPendingSelectCardId(characterId);
      setMentionContextMenu((prev) => ({ ...prev, open: false }));
    },
    [setPendingSelectCardId, showToast, t]
  );

  const setPendingEditMode = useCodexStore((s) => s.setPendingEditMode);
  /**
   * 菜单动作：编辑设定
   * 输入: characterId 角色 UUID
   * 流程: 查看流程 + 设置 pendingEditMode=true
   */
  const handleMentionEditInCodex = useCallback(
    (characterId: string | null) => {
      if (!characterId) {
        showToast("warning", t("characterMention.noLinkedEntity"));
        return;
      }
      useAppStore.getState().setActiveCategory("codex");
      setPendingSelectCardId(characterId);
      setPendingEditMode(true);
      setMentionContextMenu((prev) => ({ ...prev, open: false }));
    },
    [setPendingSelectCardId, setPendingEditMode, showToast, t]
  );

  /**
   * 菜单动作：复制角色名到剪贴板
   * 输入: characterName 角色名文本
   * 流程: 写入剪贴板 + 提示成功/失败
   */
  const handleMentionCopyName = useCallback(
    async (characterName: string) => {
      try {
        await navigator.clipboard.writeText(characterName);
        showToast("success", t("characterMention.nameCopied"));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast("error", t("characterMention.copyFailed", { error: msg }));
      }
      setMentionContextMenu((prev) => ({ ...prev, open: false }));
    },
    [showToast, t]
  );

  // ===== 角色悬停卡片 =====
  // 交互逻辑：
  //   1. 首次悬停在某角色名上：延迟 500ms 后显示（避免误触）
  //   2. 在同一角色名内移动：仅更新卡片坐标，不重置计时器（避免闪烁）
  //   3. 从一个角色名切换到另一个：立即切换（已激活悬停态，无需再次延迟）
  //   4. 移动到非角色名文本：立即隐藏卡片
  //   5. 离开编辑器区域：立即隐藏卡片
  // AI-Ready：优先从 data-entity-id 提取 characterId（UUID），无装饰时回退为 undefined
  useEffect(() => {
    if (!editor || characters.length === 0) {
      setHoverCard((prev) => (prev.open ? { ...prev, open: false } : prev));
      hoverShownNameRef.current = "";
      return;
    }
    const editorDom = editor.view.dom;
    // requestAnimationFrame 节流：浏览器自动调度至最佳渲染时机（约 16ms/帧），
    // 避免高频 mousemove 阻塞主线程，同时比固定 60ms 节流更流畅。
    // rAFPending 标记确保同一帧内仅执行一次检测
    let rAFPending = false;
    let lastMouseEvent: MouseEvent | null = null;

    /**
     * 执行悬停检测
     * 流程:
     *   1. 通过 caretRangeFromPoint 获取光标位置的文本节点与偏移
     *   2. 检查偏移是否落在某个角色名范围内
     *   3. 根据当前悬停态决定：延迟显示 / 仅更新坐标 / 立即切换 / 隐藏
     */
    const performHoverCheck = () => {
      rAFPending = false;
      const e = lastMouseEvent;
      if (!e) return;

      // 通过坐标获取光标位置的文本节点与偏移（Chromium 支持 caretRangeFromPoint）
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (!range) return;
      const node = range.startContainer;
      if (!node || node.nodeType !== Node.TEXT_NODE) {
        // 非文本节点（如段落边界、空白区域）：清除计时器并隐藏
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }
        setHoverCard((prev) => (prev.open ? { ...prev, open: false } : prev));
        hoverShownNameRef.current = "";
        return;
      }
      const text = node.textContent || "";
      const offset = range.startOffset;
      // 检查光标偏移是否落在某个角色名范围内
      let matchedName: string | null = null;
      for (const name of characters) {
        if (!name) continue;
        let idx = text.indexOf(name);
        while (idx !== -1) {
          if (offset >= idx && offset <= idx + name.length) {
            matchedName = name;
            break;
          }
          idx = text.indexOf(name, idx + name.length);
        }
        if (matchedName) break;
      }

      // AI-Ready：从实体高亮装饰提取 characterId（UUID）
      // 优先查询最近的 .nf-entity-character 祖先元素的 data-entity-id 属性
      // 无装饰时返回 undefined（旧版未启用实体高亮的兼容路径）
      const extractCharacterId = (): string | undefined => {
        const target = e.target as HTMLElement | null;
        if (!target) return undefined;
        const entitySpan = target.closest(
          '[data-entity-type="character"]'
        ) as HTMLElement | null;
        if (!entitySpan) return undefined;
        const id = entitySpan.getAttribute("data-entity-id");
        return id || undefined;
      };

      if (matchedName) {
        const name = matchedName;
        if (hoverShownNameRef.current === name) {
          // 同一角色名已显示：仅更新坐标，不触碰计时器
          setHoverCard((prev) =>
            prev.open ? { ...prev, x: e.clientX, y: e.clientY } : prev
          );
        } else if (hoverShownNameRef.current !== "") {
          // 从一个角色名切换到另一个：立即切换（已激活悬停态）
          if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
          }
          hoverShownNameRef.current = name;
          setHoverCard({
            open: true,
            x: e.clientX,
            y: e.clientY,
            name,
            characterId: extractCharacterId(),
          });
        } else {
          // 首次悬停：延迟 500ms 显示，避免快速划过时误触
          if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
          }
          hoverTimerRef.current = window.setTimeout(() => {
            hoverShownNameRef.current = name;
            setHoverCard({
              open: true,
              x: e.clientX,
              y: e.clientY,
              name,
              characterId: extractCharacterId(),
            });
          }, 500);
        }
      } else {
        // 非角色名文本：清除计时器并隐藏
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }
        setHoverCard((prev) => (prev.open ? { ...prev, open: false } : prev));
        hoverShownNameRef.current = "";
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      lastMouseEvent = e;
      if (!rAFPending) {
        rAFPending = true;
        requestAnimationFrame(performHoverCheck);
      }
    };

    const handleMouseLeave = () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      setHoverCard((prev) => (prev.open ? { ...prev, open: false } : prev));
      hoverShownNameRef.current = "";
    };

    editorDom.addEventListener("mousemove", handleMouseMove);
    editorDom.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      editorDom.removeEventListener("mousemove", handleMouseMove);
      editorDom.removeEventListener("mouseleave", handleMouseLeave);
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    };
  }, [editor, characters]);

  // ===== 卸载时清理所有定时器 =====
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      if (contextMenuClickTimerRef.current !== null) {
        clearTimeout(contextMenuClickTimerRef.current);
        contextMenuClickTimerRef.current = null;
      }
    };
  }, []);

  return {
    hoverCard,
    mentionContextMenu,
    setMentionContextMenu,
    handleMentionViewInCodex,
    handleMentionEditInCodex,
    handleMentionCopyName,
  };
}
