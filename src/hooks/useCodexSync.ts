// 设定库索引同步 Hook
//
// 功能概述：
// 抽取 FileList 组件中文件操作（删除/重命名）后的设定库与全文索引同步逻辑。
// 当文件被删除或重命名时，需要同步：
//   1. Codex Store（设定库卡片列表）- 通过 loadAll 重新加载
//   2. Tantivy 全文索引 - 通过 removeFileIndex / updateFileIndex 增删条目
//
// 模块职责：
// 1. 提供文件删除后的索引清理（含 .txt 与 .pmd 双路径清理）
// 2. 提供文件重命名后的索引迁移（清理旧路径 + 构建新路径）
// 3. 提供 Codex Store 刷新方法（避免设定卡片残留旧路径）
// 4. 提供 buildProjectIndex 触发入口（全量重建索引）
//
// 设计说明：
// - 索引同步均为静默执行（catch 错误但不阻断主流程），避免索引故障影响文件操作
// - .txt 与 .pmd 路径同时清理，防止历史 .pmd 残留索引
// - 所有异步操作必须 try-catch 包裹，错误通过 logger.error 记录

import { useCallback } from "react";
import {
  buildProjectIndex,
  removeFileIndex,
  updateFileIndex,
} from "../lib/api";
import type { FileNode } from "../lib/api";
import { logger } from "../lib/logger";
import { useCodexStore } from "../lib/stores/useCodexStore";

/**
 * useCodexSync 返回值接口
 */
interface UseCodexSyncReturn {
  /**
   * 文件删除后同步索引与设定库
   * 输入:
   *   projectPath 项目根路径
   *   node 被删除的文件节点
   * 流程:
   *   1. 目录节点跳过索引清理（目录不索引）
   *   2. 文件节点：调用 removeFileIndex 清理原路径
   *   3. 若为 .txt 文件：同时清理可能存在的 .pmd 路径索引
   *   4. 刷新 Codex Store，避免已删除卡片仍显示
   */
  syncOnDelete: (projectPath: string, node: FileNode) => void;
  /**
   * 文件重命名后同步索引与设定库
   * 输入:
   *   projectPath 项目根路径
   *   oldRelPath 旧相对路径
   *   newRelPath 新相对路径
   *   isDir 是否为目录
   * 流程:
   *   1. 目录节点跳过索引清理
   *   2. 文件节点：清理旧路径索引（.txt 与 .pmd）
   *   3. 异步触发新路径 .pmd 索引构建
   *   4. 刷新 Codex Store，避免设定卡片残留旧路径
   */
  syncOnRename: (
    projectPath: string,
    oldRelPath: string,
    newRelPath: string,
    isDir: boolean
  ) => void;
  /**
   * 刷新 Codex Store（重载所有设定卡片）
   * 输入: projectPath 项目根路径
   */
  refreshCodex: (projectPath: string) => void;
  /**
   * 触发全量索引重建（用于索引损坏或大批量变更后）
   * 输入: projectPath 项目根路径
   */
  rebuildProjectIndex: (projectPath: string) => void;
}

/**
 * 设定库与索引同步 Hook
 * 输入: 无（直接调用 useCodexStore 与索引 API）
 * 输出: UseCodexSyncReturn 同步方法集合
 * 流程:
 *   1. syncOnDelete 删除文件后清理 Tantivy 索引与 Codex Store
 *   2. syncOnRename 重命名后迁移索引（清旧 + 建新）并刷新 Codex Store
 *   3. refreshCodex 仅刷新 Codex Store
 *   4. rebuildProjectIndex 触发全量索引重建
 */
export function useCodexSync(): UseCodexSyncReturn {
  /**
   * 刷新 Codex Store：重载所有设定卡片
   * 异常处理：失败时通过 logger.error 记录，不阻断主流程
   */
  const refreshCodex = useCallback((projectPath: string) => {
    useCodexStore.getState().loadAll(projectPath).catch((err) => {
      logger.error("同步设定库失败:", err instanceof Error ? err : String(err));
    });
  }, []);

  /**
   * 文件删除后同步索引与设定库
   * 异常处理：索引清理失败静默处理，避免影响删除主流程
   */
  const syncOnDelete = useCallback((projectPath: string, node: FileNode) => {
    // 目录节点不索引，跳过清理
    if (!node.is_dir) {
      // 清理原路径索引（.txt）
      removeFileIndex(projectPath, node.relative_path).catch((err) => {
        logger.error("清理索引失败:", err instanceof Error ? err : String(err));
      });
      // 若为 .txt 文件，同时清理可能存在的 .pmd 路径索引
      if (node.relative_path.toLowerCase().endsWith(".txt")) {
        const pmdRelPath = node.relative_path.replace(/\.txt$/i, ".pmd");
        if (pmdRelPath !== node.relative_path) {
          removeFileIndex(projectPath, pmdRelPath).catch((err) => {
            logger.error("清理 .pmd 索引失败:", err instanceof Error ? err : String(err));
          });
        }
      }
    }
    // 同步刷新 Codex Store：删除的文件若属于设定库目录，需更新卡片列表
    refreshCodex(projectPath);
  }, [refreshCodex]);

  /**
   * 文件重命名后同步索引与设定库
   * 异常处理：索引迁移失败静默处理，避免影响重命名主流程
   */
  const syncOnRename = useCallback((
    projectPath: string,
    oldRelPath: string,
    newRelPath: string,
    isDir: boolean
  ) => {
    // 目录节点不索引，跳过清理
    if (!isDir) {
      // 清理旧路径索引（.txt）
      removeFileIndex(projectPath, oldRelPath).catch((err) => {
        logger.error("清理旧路径索引失败:", err instanceof Error ? err : String(err));
      });
      // 若旧路径为 .txt，同时清理可能存在的 .pmd 路径索引
      if (oldRelPath.toLowerCase().endsWith(".txt")) {
        const oldPmdPath = oldRelPath.replace(/\.txt$/i, ".pmd");
        if (oldPmdPath !== oldRelPath) {
          removeFileIndex(projectPath, oldPmdPath).catch((err) => {
            logger.error("清理旧 .pmd 索引失败:", err instanceof Error ? err : String(err));
          });
        }
      }
      // 异步触发新路径索引构建（文件可能为 .pmd 格式）
      const newPmdPath = newRelPath.replace(/\.(txt|pmd)$/i, ".pmd");
      updateFileIndex(projectPath, newPmdPath).catch((err) => {
        logger.error("更新新路径索引失败:", err instanceof Error ? err : String(err));
      });
    }
    // 同步刷新 Codex Store：若文件位于设定库目录，重命名后需更新卡片列表
    refreshCodex(projectPath);
  }, [refreshCodex]);

  /**
   * 触发全量索引重建
   * 异常处理：失败时通过 logger.error 记录，不阻断主流程
   */
  const rebuildProjectIndex = useCallback((projectPath: string) => {
    buildProjectIndex(projectPath).catch((err) => {
      logger.error("重建项目索引失败:", err instanceof Error ? err : String(err));
    });
  }, []);

  return {
    syncOnDelete,
    syncOnRename,
    refreshCodex,
    rebuildProjectIndex,
  };
}
