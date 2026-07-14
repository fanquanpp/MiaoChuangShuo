// 角色提及右键菜单组件
//
// 功能概述：
// 独立的角色提及右键菜单组件，通过 Portal 渲染至 document.body，
// 避免 overflow 容器裁切。支持查看设定、编辑设定、复制名称三个操作。
//
// 模块职责：
// 1. 渲染浮动菜单（定位基于鼠标坐标，自动避免溢出视口）
// 2. 旧版无 UUID 节点：查看/编辑按钮禁用
// 3. 点击菜单项触发对应回调
// 4. 阻止 click 与 contextmenu 事件冒泡（避免菜单立即关闭）
//
// 设计原则：
// - 无状态组件，所有状态与回调由父组件管理
// - 使用 lucide-react 图标
// - FANDEX 暗黑主题（bg-nf-bg-secondary / border-nf-border-light）
// - 通过 createPortal 渲染至 body 避免 overflow 裁切

import { createPortal } from "react-dom";
import { BookOpen, Edit3, Copy } from "lucide-react";
import type { MentionContextMenuState } from "../../hooks/useEditorMention";

// ===== 类型定义 =====

/** 翻译函数类型（与 i18n 模块的 TFunction 对齐） */
type TranslateFn = (
  key: string,
  params?: Record<string, string | number>
) => string;

/** EditorContextMenu 输入参数 */
export interface EditorContextMenuProps {
  /** 菜单状态（open/x/y/characterId/characterName） */
  menu: MentionContextMenuState;
  /** 菜单动作：查看设定 */
  onView: (characterId: string | null) => void;
  /** 菜单动作：编辑设定 */
  onEdit: (characterId: string | null) => void;
  /** 菜单动作：复制角色名 */
  onCopy: (characterName: string) => void;
  /** 翻译函数 */
  t: TranslateFn;
}

// ===== 组件实现 =====

/**
 * 角色提及右键菜单组件
 * 输入:
 *   menu - 菜单状态（包含坐标、characterId、characterName）
 *   onView - 查看设定回调
 *   onEdit - 编辑设定回调
 *   onCopy - 复制名称回调
 *   t - 翻译函数
 * 输出: JSX（通过 Portal 渲染至 document.body，menu.open 为 false 时返回 null）
 * 核心流程:
 *   1. menu.open 为 false 时返回 null
 *   2. 计算菜单位置（避免溢出视口右下边界）
 *   3. 渲染三个菜单项：查看设定 / 编辑设定 / 复制名称
 *   4. characterId 为 null 时查看/编辑按钮禁用
 * 容错: 旧版无 UUID 节点仅可复制名称
 */
export default function EditorContextMenu({
  menu,
  onView,
  onEdit,
  onCopy,
  t,
}: EditorContextMenuProps): React.ReactElement | null {
  if (!menu.open) return null;

  return createPortal(
    <div
      role="menu"
      className="nf-mention-context-menu fixed z-[300] min-w-[140px] py-1 bg-nf-bg-secondary border border-nf-border-light shadow-lg rounded-md text-xs"
      style={{
        left: Math.min(menu.x, window.innerWidth - 160),
        top: Math.min(menu.y, window.innerHeight - 120),
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        disabled={!menu.characterId}
        onClick={() => onView(menu.characterId)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-nf-text-primary hover:bg-nf-bg-hover disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
      >
        <BookOpen className="w-3.5 h-3.5 text-fandex-primary" />
        {t("characterMention.viewInCodex")}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!menu.characterId}
        onClick={() => onEdit(menu.characterId)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-nf-text-primary hover:bg-nf-bg-hover disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
      >
        <Edit3 className="w-3.5 h-3.5 text-fandex-secondary" />
        {t("characterMention.editInCodex")}
      </button>
      <div className="my-1 border-t border-nf-border-light" />
      <button
        type="button"
        role="menuitem"
        onClick={() => onCopy(menu.characterName)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-nf-text-primary hover:bg-nf-bg-hover transition-colors"
      >
        <Copy className="w-3.5 h-3.5 text-fandex-tertiary" />
        {t("characterMention.copyName")}
      </button>
    </div>,
    document.body
  );
}
