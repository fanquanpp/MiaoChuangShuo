// 文件拖拽排序 Hook
//
// 功能概述：
// 抽取 FileList 组件中正文分类专用的拖拽排序逻辑，支持文件节点重排
// 与自动重编号。拖拽完成后通过 renamePath API 持久化新顺序，
// 并刷新项目目录树触发 UI 同步。
// Task 5.3.1/5.3.2: 扩展支持跨目录拖拽（文件拖到另一卷目录触发移动）。
//
// 模块职责：
// 1. 维护 dragging / dragOver 索引状态
// 2. 生成节点级拖拽事件回调（onDragStart/onDragOver/onDragLeave/onDrop）
// 3. 拖放完成后批量重命名：先临时名后正式名，避免名称冲突
// 4. 刷新项目树并通过 toast 反馈结果
// 5. Task 5.3: 卷目录作为 drop target，文件拖到卷目录时调用 renamePath 跨目录移动
//
// 设计说明：
// - 仅正文分类（isManuscript=true）启用拖拽，其他分类返回空回调对象
// - 重命名采用两阶段策略：先全部改为 __tmp_ 前缀名，再改为正式编号名
//   防止 "1.a.txt" → "2.a.txt" 时与现有 "2.a.txt" 冲突
// - 所有异步操作必须 try-catch 包裹，失败时回滚刷新以恢复正确状态
// - Task 5.3: 跨目录移动使用 renamePath（后端无 move_file 命令，renamePath 支持跨目录）

import { useCallback, useState } from "react";
import { useAppStore } from "../lib/store";
import { readProjectTree, renamePath } from "../lib/api";
import type { FileNode } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { logger } from "../lib/logger";
import { useToast } from "../lib/toast";
import { stripNumberPrefix } from "../components/file-list/FileTreeNode";
import { getManifest, updateManifestEntity } from "../lib/api/manifestApi";

/**
 * 拖拽属性对象：注入到文件节点以启用拖拽交互
 * 与 FileTreeNode 组件的 isDraggable/isDragOver/isDragging 等属性对齐
 */
export interface FileDragProps {
  /** 是否可拖拽 */
  isDraggable: boolean;
  /** 是否为拖拽悬停目标 */
  isDragOver: boolean;
  /** 是否正在被拖拽 */
  isDragging: boolean;
  /** 拖拽开始事件回调 */
  onDragStart: (e: React.DragEvent) => void;
  /** 拖拽悬停事件回调 */
  onDragOver: (e: React.DragEvent) => void;
  /** 拖拽离开事件回调 */
  onDragLeave: (e: React.DragEvent) => void;
  /** 拖拽放置事件回调 */
  onDrop: (e: React.DragEvent) => void;
}

/**
 * useFileDragSort 返回值接口
 */
interface UseFileDragSortReturn {
  /** 当前正在拖拽的节点索引 */
  dragIndex: number | null;
  /** 当前拖拽悬停的节点索引 */
  dragOverIndex: number | null;
  /**
   * 获取指定节点的拖拽属性对象
   * 输入:
   *   node 文件节点
   *   index 节点在父级中的索引
   * 输出: 拖拽属性对象（非正文分类或目录节点返回空对象）
   */
  getFileDragProps: (node: FileNode, index: number) => Partial<FileDragProps>;
  /**
   * Task 5.3.1: 获取卷目录节点的 drop 属性对象
   * 用于将文件拖到另一卷目录时触发跨目录移动
   * 输入:
   *   node 目录节点（正文分类下的卷子目录）
   * 输出: drop 属性对象（非正文分类或非目录节点返回空对象）
   */
  getVolumeDropProps: (node: FileNode) => Partial<{
    isDragOver: boolean;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  }>;
}

/**
 * 文件拖拽排序 Hook
 * 输入:
 *   children 当前目录下的子节点列表
 *   isManuscript 是否为正文分类
 * 输出: UseFileDragSortReturn 拖拽状态与属性获取函数
 * 流程:
 *   1. 维护 dragIndex / dragOverIndex 状态
 *   2. getFileDragProps 为节点生成事件回调
 *   3. handleDrop 执行两阶段批量重命名：
 *      a. 先全部改为 __tmp_ 前缀临时名（避免冲突）
 *      b. 再按新顺序改为正式编号名（如 "1.标题.txt"）
 *   4. 刷新项目目录树，触发 UI 同步
 *   5. 失败时刷新恢复正确状态，并通过 toast 提示
 */
export function useFileDragSort(
  children: FileNode[],
  isManuscript: boolean
): UseFileDragSortReturn {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Task 5.3.1: 卷目录拖拽悬停路径（用于高亮目标卷目录）
  const [dragOverDirPath, setDragOverDirPath] = useState<string | null>(null);
  const { t } = useI18n();
  const { showToast } = useToast();

  /**
   * 拖拽开始：记录源索引到状态与 dataTransfer
   */
  const handleDragStart = useCallback((index: number) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    setDragIndex(index);
  }, []);

  /**
   * 拖拽悬停：阻止默认行为以允许 drop，记录目标索引
   */
  const handleDragOver = useCallback((index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  }, []);

  /**
   * 拖拽离开：清空目标索引
   */
  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  /**
   * 拖拽放置：执行两阶段批量重命名并刷新项目树
   * 异常处理：失败时刷新项目树恢复正确状态，并通过 toast 提示用户
   */
  const handleDrop = useCallback((targetIndex: number) => async (e: React.DragEvent) => {
    e.preventDefault();
    const sourceIndex = dragIndex;
    setDragIndex(null);
    setDragOverIndex(null);

    // 源索引无效或与目标相同，无需排序
    if (sourceIndex === null || sourceIndex === targetIndex) return;
    // 仅正文分类支持拖拽排序
    if (!isManuscript) return;

    // 构建新顺序：从源索引移除并插入到目标索引
    const newOrder = [...children];
    const [moved] = newOrder.splice(sourceIndex, 1);
    newOrder.splice(targetIndex, 0, moved);

    // 获取当前项目路径
    const { currentProject } = useAppStore.getState();
    if (!currentProject) return;

    try {
      // 阶段一：先全部改为临时名称，避免正式名称冲突
      const tempNames: string[] = [];
      for (let i = 0; i < newOrder.length; i++) {
        const node = newOrder[i];
        if (node.is_dir) continue;
        const cleanName = stripNumberPrefix(node.name);
        const tempName = `__tmp_${i}_${cleanName}.txt`;
        const dirPath = node.relative_path.substring(0, node.relative_path.lastIndexOf("/") + 1);
        const newRelPath = dirPath + tempName;
        await renamePath(currentProject.path, node.relative_path, newRelPath);
        tempNames.push(newRelPath);
      }

      // 阶段二：从临时名称改为正式编号名称
      let fileIdx = 0;
      for (let i = 0; i < newOrder.length; i++) {
        const node = newOrder[i];
        if (node.is_dir) continue;
        const cleanName = stripNumberPrefix(node.name);
        const newName = `${i + 1}.${cleanName}.txt`;
        const dirPath = node.relative_path.substring(0, node.relative_path.lastIndexOf("/") + 1);
        const newRelPath = dirPath + newName;
        await renamePath(currentProject.path, tempNames[fileIdx], newRelPath);
        fileIdx++;
      }

      // 刷新项目目录树
      const tree = await readProjectTree(currentProject.path);
      useAppStore.getState().setProjectTree(tree);
      showToast("success", t("filelist.renumbered"));
    } catch (e) {
      // 重命名失败：刷新项目树恢复正确状态，并提示用户
      showToast("error", t("filelist.renameFailed", { error: String(e) }));
      try {
        const tree = await readProjectTree(currentProject.path);
        useAppStore.getState().setProjectTree(tree);
      } catch (refreshErr) {
        // 刷新失败静默处理，避免掩盖原始错误
        logger.error("刷新项目树失败:", refreshErr instanceof Error ? refreshErr : String(refreshErr));
      }
    }
  }, [dragIndex, children, isManuscript, showToast, t]);

  /**
   * 获取指定节点的拖拽属性对象
   * 非正文分类或目录节点返回空对象，避免注入无效事件回调
   */
  const getFileDragProps = useCallback((node: FileNode, index: number): Partial<FileDragProps> => {
    if (!isManuscript || node.is_dir) return {};
    return {
      isDraggable: true,
      isDragOver: dragOverIndex === index,
      isDragging: dragIndex === index,
      onDragStart: handleDragStart(index),
      onDragOver: handleDragOver(index),
      onDragLeave: handleDragLeave,
      onDrop: handleDrop(index),
    };
  }, [isManuscript, dragOverIndex, dragIndex, handleDragStart, handleDragOver, handleDragLeave, handleDrop]);

  /**
   * Task 5.3.1/5.3.2: 卷目录拖拽放置处理
   * 当文件被拖到另一卷目录时：
   *   1. 调用 renamePath 跨目录移动文件（后端无 move_file，renamePath 支持跨目录）
   *   2. 更新 manifest 中对应 chapter 实体的 source_file 路径
   *   3. 刷新项目目录树
   *   4. 通过 toast 反馈结果
   * 输入: targetDirNode 目标卷目录节点
   */
  const handleVolumeDrop = useCallback((targetDirNode: FileNode) => async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDirPath(null);

    const sourceIndex = dragIndex;
    setDragIndex(null);
    setDragOverIndex(null);

    // 源索引无效或非正文分类，不处理
    if (sourceIndex === null || !isManuscript) return;
    // 目标必须是目录节点
    if (!targetDirNode.is_dir) return;

    const sourceNode = children[sourceIndex];
    if (!sourceNode || sourceNode.is_dir) return;

    // 若文件已在目标卷目录中，无需移动
    if (sourceNode.relative_path.startsWith(targetDirNode.relative_path + "/")) {
      return;
    }

    const { currentProject } = useAppStore.getState();
    if (!currentProject) return;

    // 提取文件名（保留原扩展名）
    const fileName = sourceNode.relative_path.split("/").pop() || sourceNode.name;
    const newRelPath = `${targetDirNode.relative_path}/${fileName}`;

    try {
      // 阶段一：调用 renamePath 跨目录移动文件
      await renamePath(currentProject.path, sourceNode.relative_path, newRelPath);

      // 阶段二：更新 manifest 中对应 chapter 实体的 source_file 路径
      try {
        const manifest = await getManifest(currentProject.path);
        const chapterEntity = manifest.entities.chapters.find(
          (ent) => ent.source_file === sourceNode.relative_path
        );
        if (chapterEntity) {
          await updateManifestEntity(
            currentProject.path,
            "chapters",
            { ...chapterEntity, source_file: newRelPath },
            "update"
          );
        }
      } catch (manifestErr) {
        // manifest 更新失败不阻断主流程，仅记录日志
        logger.error(
          "更新 manifest sourceFile 失败:",
          manifestErr instanceof Error ? manifestErr : String(manifestErr)
        );
      }

      // 刷新项目目录树
      const tree = await readProjectTree(currentProject.path);
      useAppStore.getState().setProjectTree(tree);

      showToast(
        "success",
        t("filelist.batch.crossVolumeMove", {
          name: sourceNode.name,
          target: targetDirNode.name,
        })
      );
    } catch (err) {
      showToast(
        "error",
        t("filelist.batch.crossVolumeMoveFailed", {
          name: sourceNode.name,
          error: String(err),
        })
      );
      // 失败时刷新项目树恢复正确状态
      try {
        const tree = await readProjectTree(currentProject.path);
        useAppStore.getState().setProjectTree(tree);
      } catch (refreshErr) {
        logger.error(
          "刷新项目树失败:",
          refreshErr instanceof Error ? refreshErr : String(refreshErr)
        );
      }
    }
  }, [dragIndex, children, isManuscript, showToast, t]);

  /**
   * Task 5.3.1: 获取卷目录节点的 drop 属性对象
   * 非正文分类或非目录节点返回空对象
   */
  const getVolumeDropProps = useCallback((node: FileNode): Partial<{
    isDragOver: boolean;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  }> => {
    if (!isManuscript || !node.is_dir) return {};
    return {
      isDragOver: dragOverDirPath === node.relative_path,
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOverDirPath(node.relative_path);
      },
      onDragLeave: () => {
        setDragOverDirPath(null);
      },
      onDrop: handleVolumeDrop(node),
    };
  }, [isManuscript, dragOverDirPath, handleVolumeDrop]);

  return {
    dragIndex,
    dragOverIndex,
    getFileDragProps,
    getVolumeDropProps,
  };
}
