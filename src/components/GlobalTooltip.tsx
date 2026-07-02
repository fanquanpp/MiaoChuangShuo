// src/components/GlobalTooltip.tsx
//
// 全局自定义 Tooltip 组件(替代原生 HTML title 属性)
//
// 设计目的:
//   原生 title 属性存在三大缺陷, 严重影响用户体验:
//   1. 显示延迟过长(浏览器默认约 500ms+), 用户感知迟钝
//   2. 难以重复触发(需完全移出元素再移入才能再次显示)
//   3. 无法自定义样式与定位, 与应用暗色主题不协调
//
// 解决方案:
//   通过事件委托(mouseover/mouseout 冒泡)全局接管所有 [title] 元素,
//   在鼠标进入时临时缓存并移除 title 属性(阻止原生提示),
//   150ms 后显示自定义毛玻璃浮层; 鼠标移出时即时隐藏并恢复 title。
//
// 优势:
//   - 零侵入: 无需修改任何现有 title= 属性代码
//   - 高灵敏: 150ms 延远低于原生 500ms+, 且每次移入均可触发
//   - 可重复: 移出再移入即可重新触发, 无需等待
//   - 统一风格: 暗色毛玻璃质感, 与 FANDEX 主题一致
//
// 模块职责: UI 层 - 仅负责浮层渲染与定位, 不含业务逻辑

import { useEffect, useRef, useState } from "react";

/**
 * Tooltip 可见状态数据结构
 * @property text - 提示文本
 * @property x - 浮层 left 坐标(fixed 定坐标)
 * @property y - 浮层 top 坐标
 * @property wrap - 是否启用自动换行(长文本时为 true)
 */
interface TooltipState {
  text: string;
  x: number;
  y: number;
  wrap: boolean;
}

/** 显示延迟(ms): 远低于原生 title 的 500ms+, 保证即时反馈 */
const SHOW_DELAY_MS = 150;

/** 文本长度阈值: 超过此值启用自动换行模式 */
const WRAP_THRESHOLD = 40;

/**
 * 全局 Tooltip 组件
 * 输入: 无(通过 document 事件委托自动接管)
 * 输出: JSX 浮层(固定定位, pointer-events: none 不阻挡交互)
 * 流程:
 *   1. 监听 document mouseover 事件(冒泡)
 *   2. 检测事件目标是否携带 title 属性
 *   3. 若有: 缓存 title 文本, 移除 title 属性(阻止原生提示), 启动 150ms 定时器
 *   4. 定时器触发后: 计算定位(上方居中 + 边缘检测), 设置 tooltipState 显示浮层
 *   5. 监听 document mouseout 事件: 清除定时器, 隐藏浮层, 恢复 title 属性
 *   6. 组件卸载时清理所有监听器与定时器
 */
export default function GlobalTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 当前被缓存 title 的元素引用: mouseout 时需恢复其 title 属性
  const currentElementRef = useRef<HTMLElement | null>(null);
  const cachedTitleRef = useRef<string>("");

  useEffect(() => {
    /**
     * mouseover 事件处理(冒泡监听)
     * 输入: MouseEvent
     * 输出: void
     * 流程:
     *   1. 从事件目标向上查找最近的 [title] 元素(最多上溯 5 层避免性能损耗)
     *   2. 若找到: 缓存 title, 移除属性, 启动延迟显示定时器
     *   3. 若未找到: 不处理(可能是上次已移除 title 的同一元素再次 hover)
     */
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // 从 target 向上查找携带 title 属性的元素(限制 5 层避免深层 DOM 性能问题)
      let el: HTMLElement | null = target;
      let depth = 0;
      while (el && depth < 5) {
        if (el.tagName === "HTML" || el.tagName === "BODY") break;
        const title = el.getAttribute("title");
        if (title && title.trim()) {
          // 找到 title 元素: 缓存并移除 title 阻止原生提示
          currentElementRef.current = el;
          cachedTitleRef.current = title;
          el.removeAttribute("title");

          // 清除上次未触发的定时器, 启动新定时器
          if (showTimerRef.current) clearTimeout(showTimerRef.current);
          showTimerRef.current = setTimeout(() => {
            const text = cachedTitleRef.current;
            if (!text || !currentElementRef.current) return;

            // 计算定位: 元素上方居中
            const rect = currentElementRef.current.getBoundingClientRect();
            const tooltipWidth = Math.min(280, text.length * 7 + 24);
            let x = rect.left + rect.width / 2 - tooltipWidth / 2;
            // 水平边缘检测: 防止超出视窗
            x = Math.max(8, Math.min(x, window.innerWidth - tooltipWidth - 8));

            // 垂直定位: 优先在元素上方, 空间不足时下方
            const tooltipHeight = 28;
            let y = rect.top - tooltipHeight - 6;
            if (y < 8) {
              y = rect.bottom + 6;
            }

            setTooltip({
              text,
              x,
              y,
              wrap: text.length > WRAP_THRESHOLD,
            });
          }, SHOW_DELAY_MS);
          return;
        }
        el = el.parentElement;
        depth++;
      }
    };

    /**
     * mouseout 事件处理(冒泡监听)
     * 输入: MouseEvent
     * 输出: void
     * 流程:
     *   1. 检测是否移出了当前缓存 title 的元素
     *   2. 若是: 清除定时器, 隐藏浮层, 恢复 title 属性
     */
    const handleMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      const current = currentElementRef.current;

      // 仅当鼠标真正离开当前 title 元素(relatedTarget 不在其内部)时才清理
      if (current && !current.contains(related)) {
        if (showTimerRef.current) {
          clearTimeout(showTimerRef.current);
          showTimerRef.current = null;
        }
        // 恢复 title 属性(下次移入可再次触发)
        current.setAttribute("title", cachedTitleRef.current);
        currentElementRef.current = null;
        cachedTitleRef.current = "";
        setTooltip(null);
      }
    };

    // 使用 capture 阶段确保在子元素 handler 之前拦截
    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("mouseout", handleMouseOut, true);

    return () => {
      document.removeEventListener("mouseover", handleMouseOver, true);
      document.removeEventListener("mouseout", handleMouseOut, true);
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      // 卸载时恢复残留的 title
      if (currentElementRef.current) {
        currentElementRef.current.setAttribute("title", cachedTitleRef.current);
      }
    };
  }, []);

  // 不渲染任何 DOM 当无 tooltip 状态(pointer-events: none 确保不阻挡交互)
  if (!tooltip) return null;

  return (
    <div
      className={`nf-global-tooltip${tooltip.wrap ? " nf-tooltip-wrap" : ""}`}
      style={{ left: tooltip.x, top: tooltip.y }}
      role="tooltip"
    >
      {tooltip.text}
    </div>
  );
}
