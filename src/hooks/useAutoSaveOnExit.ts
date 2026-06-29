// 退出自动保存 Hook
//
// 功能概述：
// 编排项目退出（返回启动器 / 窗口关闭 / 切换项目）时的自动保存流程。
// 检查编辑器脏状态 → 确认保存 → 触发保存 → 处理失败 → 执行退出。
//
// 模块职责：
// 1. 提供 handleBackToLauncher：包装 closeProject，保存后退出
// 2. 提供 handleWindowClose：Tauri 窗口关闭事件处理
// 3. 提供 handleSwitchProject：切换项目前保存当前项目

import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../lib/store";
import { getEditorSaveFn } from "../lib/stores/viewSlice";
import type { ProjectInfo } from "../lib/api";

// i18n 文案（静态引用，避免 Hook 依赖循环）
const MSG = {
  zh: {
    unsavedTitle: "未保存的修改",
    unsavedMessage: "有未保存的修改，是否保存后再退出？",
    saveFailedForceTitle: "保存失败",
    saveFailedForce: "保存失败，是否强制退出（未保存的修改将丢失）？",
    saveFailedTitle: "保存失败",
    saveFailed: "保存失败: {error}",
  },
  en: {
    unsavedTitle: "Unsaved Changes",
    unsavedMessage: "You have unsaved changes. Save before exiting?",
    saveFailedForceTitle: "Save Failed",
    saveFailedForce:
      "Save failed. Force exit? Unsaved changes will be lost.",
    saveFailedTitle: "Save Failed",
    saveFailed: "Save failed: {error}",
  },
};

/**
 * 异步确认对话框（替代原生 confirm）
 * Tauri 环境使用原生对话框，浏览器开发模式回退到 window.confirm
 */
async function asyncConfirm(message: string, title?: string): Promise<boolean> {
  try {
    return await ask(message, title ? { title } : undefined);
  } catch {
    return window.confirm(message);
  }
}

function getMsg(key: keyof typeof MSG.zh, error?: string): string {
  // 从 store 获取当前语言
  const locale = (() => {
    try {
      const stored = localStorage.getItem("novelforge-locale");
      return stored === "en-US" ? "en-US" : "zh-CN";
    } catch {
      return "zh-CN";
    }
  })();

  const dict = locale === "en-US" ? MSG.en : MSG.zh;
  let text = dict[key];
  if (error) {
    text = text.replace("{error}", error);
  }
  return text;
}

/**
 * 核心保存并退出编排函数
 * @returns true 表示可以继续退出，false 表示用户取消
 */
async function saveBeforeExit(): Promise<boolean> {
  const { editorDirty } = useAppStore.getState();

  // 无脏数据，直接退出
  if (!editorDirty) return true;

  // 询问是否保存
  const shouldSave = await asyncConfirm(
    getMsg("unsavedMessage"),
    getMsg("unsavedTitle")
  );
  if (!shouldSave) {
    // 用户选择不保存 → 清除脏标记，允许退出
    useAppStore.getState().setEditorDirty(false);
    return true;
  }

  // 执行保存
  const saveFn = getEditorSaveFn();
  if (!saveFn) {
    // 无保存回调（编辑器未挂载），直接退出
    return true;
  }

  try {
    const success = await saveFn();
    if (success) return true;

    // 保存失败 → 询问是否强制退出
    const forceExit = await asyncConfirm(
      getMsg("saveFailedForce"),
      getMsg("saveFailedForceTitle")
    );
    if (forceExit) {
      useAppStore.getState().setEditorDirty(false);
      return true;
    }
    return false; // 用户取消退出
  } catch (e) {
    const forceExit = await asyncConfirm(
      getMsg("saveFailed", String(e)),
      getMsg("saveFailedTitle")
    );
    if (forceExit) {
      useAppStore.getState().setEditorDirty(false);
      return true;
    }
    return false;
  }
}

export function useAutoSaveOnExit() {
  const closeProject = useAppStore((s) => s.closeProject);
  const openProject = useAppStore((s) => s.openProject);

  /**
   * 场景 1: 点击返回启动器
   * 先保存，再关闭项目回到 Launcher
   */
  const handleBackToLauncher = useCallback(async () => {
    const canExit = await saveBeforeExit();
    if (canExit) {
      closeProject();
    }
  }, [closeProject]);

  /**
   * 场景 2: Tauri 窗口关闭事件
   * 注册到 getCurrentWindow().onCloseRequested
   */
  const handleWindowClose = useCallback(
    async (): Promise<void> => {
      const canExit = await saveBeforeExit();
      if (!canExit) {
        // Tauri v2: 阻止关闭需要抛出错误或返回特定值
        // 实际上在 onCloseRequested 中，不调用 appWindow.close() 即可阻止
        throw new Error("User cancelled close");
      }
    },
    []
  );

  /**
   * 场景 3: 切换项目
   * 保存当前项目后切换到新项目
   */
  const handleSwitchProject = useCallback(
    async (project: ProjectInfo) => {
      const canExit = await saveBeforeExit();
      if (canExit) {
        openProject(project);
      }
    },
    [openProject]
  );

  return {
    handleBackToLauncher,
    handleWindowClose,
    handleSwitchProject,
  };
}

/**
 * 注册 Tauri 窗口关闭事件监听
 * 应在 App 根组件调用一次
 */
export function useWindowCloseGuard() {
  const { handleWindowClose } = useAutoSaveOnExit();

  // 直接使用 callback 形式，避免闭包陈旧问题
  const handleWindowCloseStable = useCallback(async () => {
    await handleWindowClose();
  }, [handleWindowClose]);

  // 在 Tauri 环境中注册窗口关闭事件
  // 注意：onCloseRequested 回调通过 async 函数阻止关闭：
  // 如果回调 reject/resolve 晚于一定时间，窗口仍会关闭
  // Tauri v2 中通过 event.preventDefault() 阻止
  const setupCloseGuard = useCallback(() => {
    try {
      const appWindow = getCurrentWindow();
      let isClosing = false; // 重入保护标志
      const unlisten = appWindow.onCloseRequested(async (event) => {
        // 始终阻止默认关闭行为，由我们显式控制关闭流程
        // Tauri v2 的 async handler 中，不调用 preventDefault 可能无法可靠关闭窗口
        event.preventDefault();

        // 如果已经在关闭流程中，放行（避免 destroy() → onCloseRequested 循环）
        if (isClosing) return;
        isClosing = true;

        const { editorDirty } = useAppStore.getState();

        // 无未保存修改 → 直接关闭
        if (!editorDirty) {
          await appWindow.destroy();
          return;
        }

        // 有未保存修改 → 询问保存
        try {
          await handleWindowCloseStable();
          // 保存成功或用户确认退出 → 使用 destroy() 直接关闭（不触发 onCloseRequested）
          await appWindow.destroy();
        } catch {
          // 用户取消关闭 → 重置标志，窗口保持打开
          isClosing = false;
        }
      });
      return unlisten;
    } catch {
      // 非 Tauri 环境（如浏览器开发模式），静默跳过
      return undefined;
    }
  }, [handleWindowCloseStable]);

  return setupCloseGuard;
}
