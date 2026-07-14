// 文件右键上下文菜单 Hook
//
// 功能概述：
// 抽取 FileList 组件中的右键菜单状态与操作逻辑，包括菜单显示位置管理、
// 菜单项构建、副本创建、路径复制、文件名复制等操作。
//
// 模块职责：
// 1. 维护右键菜单的显示状态与坐标
// 2. 构建菜单项列表（打开、重命名、副本、复制路径、复制名称、删除等）
// 3. 处理菜单项点击回调（含剪贴板写入与后端 API 调用）
// 4. 提供菜单关闭、目标设置等辅助方法
//
// 设计说明：
// - 菜单的「点击外部关闭」「Esc 关闭」由 ContextMenu 组件内部实现
//   本 Hook 仅负责状态管理与回调注入
// - 异步操作（副本创建、剪贴板写入）必须 try-catch 包裹
// - 复制操作失败时通过 toast 反馈，避免静默错误

import { useCallback, useMemo, useState } from "react";
import {
  FileText,
  PenLine,
  Trash2,
  Copy,
  ClipboardCopy,
  Files,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { useCodexStore } from "../lib/stores/useCodexStore";
import { copyFile, readProjectTree } from "../lib/api";
import { logger } from "../lib/logger";
import type { FileNode, ProjectInfo } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import type { ContextMenuItem } from "../components/ContextMenu";

/**
 * 右键菜单状态接口
 */
interface ContextMenuState {
  /** 是否显示 */
  open: boolean;
  /** 屏幕 X 坐标 */
  x: number;
  /** 屏幕 Y 坐标 */
  y: number;
  /** 目标文件节点（无目标时为 null） */
  node: FileNode | null;
}

/**
 * useFileContextMenu 返回值接口
 */
interface UseFileContextMenuReturn {
  /** 菜单状态 */
  ctxMenu: ContextMenuState;
  /** 菜单项列表（根据目标节点动态构建） */
  ctxMenuItems: ContextMenuItem[];
  /**
   * 触发右键菜单
   * 输入: node 目标节点, e 鼠标事件
   */
  handleContextMenu: (node: FileNode, e: React.MouseEvent) => void;
  /** 关闭菜单 */
  closeContextMenu: () => void;
}

/**
 * useFileContextMenu 配置参数
 */
interface UseFileContextMenuOptions {
  /** 当前项目信息（用于拼接绝对路径与调用后端 API） */
  currentProject: ProjectInfo | null;
  /** 文件选择回调（菜单「打开」项触发） */
  onSelectFile: (node: FileNode) => void;
  /** 设置重命名目标回调（菜单「重命名」项触发） */
  setRenameTarget: (node: FileNode) => void;
  /** 设置删除目标回调（菜单「删除」项触发） */
  setDeleteTarget: (node: FileNode) => void;
}

/**
 * 文件右键上下文菜单 Hook
 * 输入:
 *   options.currentProject 当前项目
 *   options.onSelectFile 文件选择回调
 *   options.setRenameTarget 设置重命名目标回调
 *   options.setDeleteTarget 设置删除目标回调
 * 输出: UseFileContextMenuReturn 菜单状态、菜单项与操作方法
 * 流程:
 *   1. 维护 ctxMenu 状态（open/x/y/node）
 *   2. handleContextMenu 在右键事件中记录坐标与目标节点
 *   3. ctxMenuItems 根据节点类型动态构建菜单项
 *   4. 副本创建调用 copyFile API 后刷新项目树与设定库
 *   5. 路径/名称复制通过 navigator.clipboard 写入剪贴板
 */
export function useFileContextMenu({
  currentProject,
  onSelectFile,
  setRenameTarget,
  setDeleteTarget,
}: UseFileContextMenuOptions): UseFileContextMenuReturn {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>({
    open: false, x: 0, y: 0, node: null,
  });

  /**
   * 触发右键菜单：记录屏幕坐标与目标节点
   */
  const handleContextMenu = useCallback((node: FileNode, e: React.MouseEvent) => {
    setCtxMenu({ open: true, x: e.clientX, y: e.clientY, node });
  }, []);

  /**
   * 关闭菜单：保留 node 字段，便于动画期间仍可读取目标
   */
  const closeContextMenu = useCallback(() => {
    setCtxMenu((prev) => ({ ...prev, open: false }));
  }, []);

  /**
   * 创建文件副本：在同级目录下生成「副本_」前缀的同名文件
   * 异常处理：失败时通过 toast 提示用户
   */
  const handleDuplicate = useCallback(async () => {
    const node = ctxMenu.node;
    setCtxMenu((prev) => ({ ...prev, open: false }));
    if (!node || node.is_dir || !currentProject) return;
    const dirPath = node.relative_path.substring(0, node.relative_path.lastIndexOf("/") + 1);
    // 扩展名保留策略：去除原扩展名得到 baseName，再追加原扩展名（.txt / .pmd），
    // 原扩展名缺失时回退到 .txt，保证副本与源文件格式一致
    const extMatch = node.name.match(/\.(txt|pmd)$/i);
    const ext = extMatch ? extMatch[0] : ".txt";
    const baseName = node.name.replace(/\.(txt|pmd)$/i, "");
    const newName = `${t("filelist.copyPrefix")}${baseName}${ext}`;
    const newRelPath = dirPath + newName;
    try {
      await copyFile(currentProject.path, node.relative_path, newRelPath);
      showToast("success", t("ctxmenu.duplicated", { name: newName }));
      const tree = await readProjectTree(currentProject.path);
      useAppStore.getState().setProjectTree(tree);
      // 同步刷新 Codex Store：副本若位于设定库目录，需更新卡片列表
      useCodexStore.getState().loadAll(currentProject.path).catch((err) => {
        logger.error("同步设定库失败:", err instanceof Error ? err : String(err));
      });
    } catch (e) {
      showToast("error", t("ctxmenu.duplicateFailed", { error: String(e) }));
    }
  }, [ctxMenu.node, currentProject, showToast, t]);

  /**
   * 复制文件完整路径到剪贴板
   * 异常处理：剪贴板写入失败时通过 toast 提示
   */
  const handleCopyPath = useCallback(async () => {
    const node = ctxMenu.node;
    setCtxMenu((prev) => ({ ...prev, open: false }));
    if (!node || !currentProject) return;
    const fullPath = `${currentProject.path}/${node.relative_path}`;
    try {
      await navigator.clipboard.writeText(fullPath);
      showToast("success", t("ctxmenu.pathCopied"));
    } catch {
      showToast("error", t("ctxmenu.copyFailed"));
    }
  }, [ctxMenu.node, currentProject, showToast, t]);

  /**
   * 复制文件名到剪贴板
   * 异常处理：剪贴板写入失败时通过 toast 提示
   */
  const handleCopyName = useCallback(async () => {
    const node = ctxMenu.node;
    setCtxMenu((prev) => ({ ...prev, open: false }));
    if (!node) return;
    try {
      await navigator.clipboard.writeText(node.name);
      showToast("success", t("ctxmenu.nameCopied"));
    } catch {
      showToast("error", t("ctxmenu.copyFailed"));
    }
  }, [ctxMenu.node, showToast, t]);

  /**
   * 动态构建右键菜单项列表
   * 根据节点类型（文件/目录）调整可选项，目录无「副本」项
   */
  const ctxMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!ctxMenu.node) return [];
    const node = ctxMenu.node;
    return [
      {
        id: "open",
        label: t("ctxmenu.open"),
        icon: FileText,
        action: () => { if (!node.is_dir) onSelectFile(node); },
      },
      { id: "sep1", label: "", action: () => {}, separator: true },
      {
        id: "rename",
        label: t("ctxmenu.rename"),
        icon: PenLine,
        action: () => setRenameTarget(node),
      },
      ...(!node.is_dir ? [{
        id: "duplicate",
        label: t("ctxmenu.duplicate"),
        icon: Files,
        action: handleDuplicate,
      }] : []),
      { id: "sep2", label: "", action: () => {}, separator: true },
      {
        id: "copyPath",
        label: t("ctxmenu.copyPath"),
        icon: ClipboardCopy,
        action: handleCopyPath,
      },
      {
        id: "copyName",
        label: t("ctxmenu.copyName"),
        icon: Copy,
        action: handleCopyName,
      },
      { id: "sep3", label: "", action: () => {}, separator: true },
      {
        id: "delete",
        label: t("ctxmenu.delete"),
        icon: Trash2,
        action: () => setDeleteTarget(node),
        danger: true,
      },
    ];
  }, [ctxMenu.node, t, onSelectFile, handleDuplicate, handleCopyPath, handleCopyName, setRenameTarget, setDeleteTarget]);

  return {
    ctxMenu,
    ctxMenuItems,
    handleContextMenu,
    closeContextMenu,
  };
}
