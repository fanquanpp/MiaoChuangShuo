// 主题切换按钮组件
//
// 功能概述:
// 提供暗色/亮色主题切换按钮, 点击切换全局主题。
// 图标使用 lucide-react 的 Sun / Moon (已在桌面版中使用, 确认可用)。
//
// 模块职责:
// 1. 读取当前主题状态
// 2. 点击时调用 toggleTheme 切换主题
// 3. 根据 theme 显示对应图标

import { Moon, Sun } from "lucide-react";
import { useWebThemeStore } from "../lib/theme";

/**
 * 主题切换按钮
 * 输入: 无
 * 输出: JSX.Element 按钮
 * 流程:
 *   1. 从 store 读取当前主题
 *   2. 暗色显示太阳图标 (点击切换到亮色)
 *   3. 亮色显示月亮图标 (点击切换到暗色)
 */
export default function ThemeToggle(): JSX.Element {
  const theme = useWebThemeStore((state) => state.theme);
  const toggleTheme = useWebThemeStore((state) => state.toggleTheme);

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      title={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
      aria-label="切换主题"
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
