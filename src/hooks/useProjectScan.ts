// 项目扫描 Hook
//
// 功能概述：
// 封装启动器项目列表的所有扫描、导入、删除逻辑,统一管理 loading 与 error 状态。
// 通过 localStorage 持久化扫描目录,挂载时自动恢复并执行首次扫描。
//
// 模块职责:
// 1. 维护 scanDir/projects/loading 状态
// 2. 提供 scan/importFromDir/importFromPath/browseScanDir/removeProject 方法
// 3. 持久化扫描目录到 localStorage,挂载时自动恢复并扫描
// 4. 异步操作均通过 try-catch 包裹,失败时通过 toast 反馈

import { useState, useEffect, useCallback } from "react";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import {
  scanProjects,
  importProject,
  pickDirectory,
  type ProjectInfo,
} from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";

// localStorage 中扫描目录的持久化键名
const SCAN_DIR_KEY = "novelforge:scanDir:v1";

/**
 * 项目扫描 Hook
 * 输入: 无
 * 输出:
 *   - scanDir: 当前扫描目录
 *   - setScanDir: 设置扫描目录(自动持久化)
 *   - projects: 已扫描到的项目列表
 *   - setProjects: 直接修改项目列表(供创建/删除后局部更新)
 *   - loading: 是否正在扫描
 *   - scan: 执行扫描(基于当前 scanDir)
 *   - importFromDir: 弹窗选择目录并导入项目
 *   - importFromPath: 从指定路径导入项目(用于压缩包解压后导入)
 *   - browseScanDir: 弹窗选择扫描目录
 *   - removeProject: 从列表中移除指定项目(删除成功后调用)
 *   - clearScanDir: 清空扫描目录与项目列表(同时清理 localStorage)
 * 流程:
 *   1. 挂载时从 localStorage 读取 scanDir,非空则自动扫描
 *   2. scanDir 变化时自动持久化到 localStorage
 *   3. 各方法均通过 try-catch 处理异常,失败时通过 toast 反馈
 */
export function useProjectScan() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [scanDir, setScanDirState] = useState("");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);

  /**
   * 设置扫描目录并持久化到 localStorage
   * 输入: dir 目录路径
   * 输出: 无
   */
  const setScanDir = useCallback((dir: string) => {
    setScanDirState(dir);
  }, []);

  /**
   * 执行扫描
   * 流程:
   *   1. 校验 scanDir 非空
   *   2. 设置 loading=true
   *   3. 若目录不存在则自动创建(失败时静默忽略,交由 scanProjects 处理)
   *   4. 调用后端 scanProjects 获取列表
   *   5. 成功时通过 toast 反馈,失败时通过 error toast 反馈
   *   6. finally 块关闭 loading
   */
  const scan = useCallback(async () => {
    if (!scanDir) return;
    setLoading(true);
    try {
      // 若目录不存在则自动创建,失败时静默继续,让 scanProjects 自行处理
      try {
        const dirExists = await exists(scanDir);
        if (!dirExists) {
          await mkdir(scanDir, { recursive: true });
        }
      } catch {
        // 目录检查/创建失败时静默继续,交由后端 scanProjects 处理
      }
      const list = await scanProjects(scanDir);
      setProjects(list);
      showToast("success", t("launcher.scanSuccess", { count: list.length }));
    } catch (e) {
      showToast("error", t("launcher.scanFailed", { error: String(e) }));
    } finally {
      setLoading(false);
    }
  }, [scanDir, t, showToast]);

  /**
   * 从指定路径导入项目(已存在路径,不弹窗)
   * 用于压缩包解压后导入场景
   *
   * 输入: projectPath 项目根路径
   * 输出: 导入成功返回 ProjectInfo,失败返回 null
   * 流程:
   *   1. 调用后端 importProject
   *   2. 若路径已存在于列表中则替换,否则插入到列表头部
   *   3. 成功时通过 toast 反馈,失败时通过 error toast 反馈
   */
  const importFromPath = useCallback(
    async (projectPath: string): Promise<ProjectInfo | null> => {
      try {
        const project = await importProject(projectPath);
        if (project) {
          setProjects((prev) => {
            const idx = prev.findIndex((p) => p.path === project.path);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = project;
              return copy;
            }
            return [project, ...prev];
          });
          showToast(
            "success",
            t("launcher.importSuccess", { name: project.meta.name })
          );
          return project;
        }
        return null;
      } catch (e) {
        showToast("error", t("launcher.importFailed", { error: String(e) }));
        return null;
      }
    },
    [t, showToast]
  );

  /**
   * 弹窗选择目录并导入项目
   * 流程:
   *   1. 调用 pickDirectory 弹窗选择目录
   *   2. 用户取消时静默返回
   *   3. 调用 importFromPath 完成导入
   */
  const importFromDir = useCallback(async (): Promise<void> => {
    try {
      const dir = await pickDirectory();
      if (!dir) return;
      await importFromPath(dir);
    } catch (e) {
      showToast("error", t("launcher.importFailed", { error: String(e) }));
    }
  }, [importFromPath, t, showToast]);

  /**
   * 弹窗选择扫描目录
   * 用户取消时静默忽略
   */
  const browseScanDir = useCallback(async (): Promise<void> => {
    try {
      const dir = await pickDirectory();
      if (dir) setScanDirState(dir);
    } catch {
      // 用户取消选择,静默忽略
    }
  }, []);

  /**
   * 从列表中移除指定项目(删除成功后调用)
   * 输入: projectPath 要移除的项目路径
   */
  const removeProject = useCallback((projectPath: string) => {
    setProjects((prev) => prev.filter((p) => p.path !== projectPath));
  }, []);

  /**
   * 添加或更新项目到列表(不调用后端 importProject,不显示 toast)
   * 用于创建项目成功后由调用方自行调用 importProject 并处理 toast 的场景
   *
   * 输入: project 要添加/更新的项目信息
   * 流程:
   *   1. 若路径已存在则替换,否则插入到列表头部
   *   2. 不调用后端 API,不显示 toast,仅更新本地状态
   */
  const addOrUpdateProject = useCallback((project: ProjectInfo) => {
    setProjects((prev) => {
      const idx = prev.findIndex((p) => p.path === project.path);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = project;
        return copy;
      }
      return [project, ...prev];
    });
  }, []);

  /**
   * 清空扫描目录与项目列表
   * 同时清理 localStorage 中的持久化记录
   */
  const clearScanDir = useCallback(() => {
    setScanDirState("");
    setProjects([]);
    try {
      localStorage.removeItem(SCAN_DIR_KEY);
    } catch {
      // localStorage 不可用时静默忽略
    }
  }, []);

  // 挂载时从 localStorage 恢复扫描目录并自动扫描
  useEffect(() => {
    let savedDir = "";
    try {
      savedDir = localStorage.getItem(SCAN_DIR_KEY) || "";
    } catch {
      // localStorage 不可用时静默忽略
    }
    if (savedDir) {
      setScanDirState(savedDir);
      // 异步执行首次扫描,失败时静默处理不干扰用户
      (async () => {
        setLoading(true);
        try {
          const list = await scanProjects(savedDir);
          setProjects(list);
        } catch {
          // 首次扫描失败时静默处理,等待用户手动重试
        } finally {
          setLoading(false);
        }
      })();
    }
  }, []);

  // 持久化扫描目录到 localStorage
  useEffect(() => {
    if (scanDir) {
      try {
        localStorage.setItem(SCAN_DIR_KEY, scanDir);
      } catch {
        // localStorage 不可用时静默忽略
      }
    }
  }, [scanDir]);

  return {
    scanDir,
    setScanDir,
    projects,
    setProjects,
    loading,
    scan,
    importFromDir,
    importFromPath,
    browseScanDir,
    removeProject,
    addOrUpdateProject,
    clearScanDir,
  };
}
