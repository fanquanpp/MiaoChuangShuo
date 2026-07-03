// src/components/CharacterGraphContextMenu.tsx
//
// 人物关系图编辑器右键上下文菜单组件
// 根据触发位置(画布空白 / 节点)渲染不同菜单项集合,
// 使用 position: fixed 定位, 支持 Esc 键与点击外部关闭。
//
// 模块职责:
// 1. 接收菜单状态(x/y/nodeId)与回调函数
// 2. 渲染菜单项(新建节点/编辑/删除/自动布局/重置视图)
// 3. 通过回调触发 store 操作, 自身不直接操作状态
// 4. 自动边界检测, 防止菜单溢出屏幕右侧与底部

import { useEffect, useRef, useState } from "react";
import {
  UserPlus,
  Edit3,
  Trash2,
  LayoutGrid,
  Maximize2,
  Share2,
} from "lucide-react";
import { useI18n } from "../lib/i18n";

/** 菜单状态(null 表示菜单关闭) */
export interface ContextMenuState {
  /** 屏幕坐标 X(clientX) */
  x: number;
  /** 屏幕坐标 Y(clientY) */
  y: number;
  /** 节点 ID(null 表示画布空白处右键触发) */
  nodeId: string | null;
}

/** 菜单项操作回调接口 */
export interface ContextMenuActions {
  /** 新建角色节点(传入屏幕坐标, 由 Panel 转换为画布坐标) */
  onCreateNode: (screenPosition: { x: number; y: number }) => void;
  /** 编辑节点详情(打开抽屉) */
  onEditNode: (nodeId: string) => void;
  /** 删除节点(级联删除关联边) */
  onDeleteNode: (nodeId: string) => void;
  /** 自动布局(dagre LR 整理) */
  onAutoLayout: () => void;
  /** 重置视图(居中并适配缩放) */
  onResetView: () => void;
  /** 从指定节点开始连线(进入连线模式) */
  onConnectFrom: (nodeId: string) => void;
}

interface CharacterGraphContextMenuProps {
  /** 菜单状态(null 时组件不渲染) */
  state: ContextMenuState | null;
  /** 操作回调集合 */
  actions: ContextMenuActions;
  /** 关闭菜单回调 */
  onClose: () => void;
}

/**
 * 人物关系图右键上下文菜单
 * 输入:
 *   - state: 菜单状态(位置 + nodeId)
 *   - actions: 菜单项操作回调
 *   - onClose: 关闭回调
 * 输出: JSX 浮动菜单(state=null 时返回 null)
 * 流程:
 *   1. state=null 时不渲染
 *   2. 根据 nodeId 是否存在决定菜单项集合
 *      - 画布空白(nodeId=null): 新建节点 + 自动布局 + 重置视图
 *      - 节点(nodeId 存在): 编辑 + 删除 + 从此连线 + 自动布局 + 重置视图
 *   3. 自动检测屏幕边界, 防止菜单溢出右侧/底部
 *   4. 监听 Esc 键与点击外部事件关闭菜单
 */
export default function CharacterGraphContextMenu({
  state,
  actions,
  onClose,
}: CharacterGraphContextMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  // 调整后的位置(防止溢出屏幕)
  const [adjustedPos, setAdjustedPos] = useState({ x: 0, y: 0 });

  // 边界检测: 根据菜单实际尺寸调整位置, 防止溢出右侧与底部
  useEffect(() => {
    if (!state) return;
    const menu = menuRef.current;
    // 菜单预估尺寸(实际尺寸在首次渲染后才能获取, 此处用预估值的回退策略)
    // 统一全项目右键菜单宽度 180px
    const MENU_WIDTH = 180;
    const MENU_HEIGHT = 220;
    const rect = menu?.getBoundingClientRect();
    const width = rect?.width ?? MENU_WIDTH;
    const height = rect?.height ?? MENU_HEIGHT;

    let x = state.x;
    let y = state.y;
    // 右溢出: 向左偏移
    if (x + width > window.innerWidth - 8) {
      x = Math.max(8, window.innerWidth - width - 8);
    }
    // 下溢出: 向上偏移
    if (y + height > window.innerHeight - 8) {
      y = Math.max(8, window.innerHeight - height - 8);
    }
    setAdjustedPos({ x, y });
  }, [state]);

  // Esc 键关闭菜单
  useEffect(() => {
    if (!state) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state, onClose]);

  // 点击菜单外部关闭(使用 mousedown 而非 click, 避免与节点右键事件冲突)
  useEffect(() => {
    if (!state) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const menu = menuRef.current;
      if (menu && !menu.contains(e.target as Node)) {
        onClose();
      }
    };
    // 延迟绑定, 避免当前右键事件触发立即关闭
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("contextmenu", handleOutsideClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("contextmenu", handleOutsideClick);
    };
  }, [state, onClose]);

  if (!state) return null;

  const isNodeMenu = state.nodeId !== null;

  /**
   * 菜单按钮通用样式
   * 输入: danger 是否为危险操作(删除)
   * 输出: className 字符串
   */
  const buttonClass = (danger = false) =>
    `w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors duration-fast ${
      danger
        ? "text-nf-text-secondary hover:text-fandex-tertiary hover:bg-fandex-tertiary/5"
        : "text-nf-text-secondary hover:text-fandex-primary hover:bg-fandex-primary/5"
    }`;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] bg-nf-bg-card border border-nf-border-light shadow-lg py-1"
      style={{ left: adjustedPos.x, top: adjustedPos.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        // 阻止菜单内部右键再次触发画布的 onPaneContextMenu
        e.preventDefault();
        e.stopPropagation();
      }}
      role="menu"
    >
      {/* 新建角色节点(画布空白与节点右键均可用) */}
      <button
        onClick={() => {
          actions.onCreateNode({ x: state.x, y: state.y });
          onClose();
        }}
        className={buttonClass(false)}
        role="menuitem"
      >
        <UserPlus className="w-3.5 h-3.5" />
        {t("characterGraph.ctx.addNode")}
      </button>

      {/* 节点专属菜单项: 仅当 nodeId 存在时渲染 */}
      {isNodeMenu && state.nodeId && (
        <>
          {/* 分隔线 */}
          <div className="my-1 border-t border-nf-border-light" />

          {/* 编辑详情 */}
          <button
            onClick={() => {
              actions.onEditNode(state.nodeId!);
              onClose();
            }}
            className={buttonClass(false)}
            role="menuitem"
          >
            <Edit3 className="w-3.5 h-3.5" />
            {t("characterGraph.ctx.editDetail")}
          </button>

          {/* 从此节点连线(进入连线模式) */}
          <button
            onClick={() => {
              actions.onConnectFrom(state.nodeId!);
              onClose();
            }}
            className={buttonClass(false)}
            role="menuitem"
          >
            <Share2 className="w-3.5 h-3.5" />
            {t("characterGraph.ctx.connectFrom")}
          </button>

          {/* 删除节点(危险操作) */}
          <button
            onClick={() => {
              actions.onDeleteNode(state.nodeId!);
              onClose();
            }}
            className={buttonClass(true)}
            role="menuitem"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t("characterGraph.ctx.deleteNode")}
          </button>
        </>
      )}

      {/* 分隔线(节点菜单与画布操作之间) */}
      <div className="my-1 border-t border-nf-border-light" />

      {/* 自动布局(画布空白与节点右键均可用) */}
      <button
        onClick={() => {
          actions.onAutoLayout();
          onClose();
        }}
        className={buttonClass(false)}
        role="menuitem"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        {t("characterGraph.ctx.autoLayout")}
      </button>

      {/* 重置视图(画布空白与节点右键均可用) */}
      <button
        onClick={() => {
          actions.onResetView();
          onClose();
        }}
        className={buttonClass(false)}
        role="menuitem"
      >
        <Maximize2 className="w-3.5 h-3.5" />
        {t("characterGraph.ctx.resetView")}
      </button>
    </div>
  );
}
