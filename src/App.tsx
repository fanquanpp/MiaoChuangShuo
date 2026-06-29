// 根组件
//
// 功能概述：
// NovelForge 应用根组件，根据全局状态切换启动器与工作台视图。
// 在挂载时初始化主题状态和 i18n。
//
// 模块职责：
// 1. 读取全局状态中的 viewMode
// 2. 渲染 Launcher 或 Workspace
// 3. 包裹 FANDEX 主题容器、ToastProvider、I18nProvider
// 4. 全局快捷键面板与命令面板

import { useEffect } from "react";
import Launcher from "./components/Launcher";
import Workspace from "./components/Workspace";
import ErrorBoundary, { setErrorBoundaryI18n } from "./components/ErrorBoundary";
import ShortcutPanel from "./components/ShortcutPanel";
import { setSkeletonI18n } from "./components/SkeletonComponents";
import { useAppStore } from "./lib/store";
import { useThemeStore } from "./lib/themeStore";
import { ToastProvider } from "./lib/toast";
import { I18nProvider, useI18n } from "./lib/i18n";
import { useWindowCloseGuard } from "./hooks/useAutoSaveOnExit";

// 内部组件：在 I18nProvider 内，负责向静态组件注入 t 函数
function I18nWiring() {
  const { t } = useI18n();
  useEffect(() => {
    setErrorBoundaryI18n({ t });
    setSkeletonI18n(t);
  }, [t]);
  return null;
}

function App() {
  const viewMode = useAppStore((s) => s.viewMode);
  const initTheme = useThemeStore((s) => s.initTheme);
  const setupCloseGuard = useWindowCloseGuard();

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  // 注册 Tauri 窗口关闭事件（退出前自动保存）
  useEffect(() => {
    const unlisten = setupCloseGuard();
    return () => {
      unlisten?.then((fn) => fn());
    };
  }, [setupCloseGuard]);

  return (
    <ErrorBoundary>
      <I18nProvider>
        <I18nWiring />
        <ToastProvider>
          <div className="antialiased text-nf-text bg-nf-bg min-h-screen">
            {viewMode === "launcher" ? <Launcher /> : <Workspace />}
          </div>
          <ShortcutPanel />
        </ToastProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}

export default App;
