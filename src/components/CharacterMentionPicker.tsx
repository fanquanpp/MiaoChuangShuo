// 角色名选择浮层 React 组件
//
// 功能概述：
// 在编辑器中按 Tab 键或 Ctrl+Shift+N 时弹出的角色名选择浮层。
// 显示角色列表与自定义输入框，支持键盘导航（上下箭头、Enter 选择、Esc 关闭）。
// 替代 characterMention.ts 中原生的 DOM 构建逻辑，通过 React 组件化管理浮层。
//
// 模块职责：
// 1. 渲染角色名列表，支持鼠标悬停与点击选择
// 2. 提供自定义角色名输入框
// 3. 键盘导航：ArrowUp/ArrowDown 移动选中项，Enter 确认选择，Escape 关闭
// 4. 点击浮层外部自动关闭
// 5. 组件卸载时自动清理所有事件监听，避免内存泄漏
//
// 设计说明：
// 本组件通过 createRoot 在 characterMention.ts 中挂载到 document.body，
// 不在主 React 组件树内，因此无法使用 useI18n 获取 I18nContext。
// 所有显示文案通过 labels prop 由父组件（NovelEditor.tsx）调用 useI18n 的 t() 翻译后传入，
// 从而保持与项目 i18n 体系的一致性。

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { UserCircle, CornerDownLeft } from "lucide-react";

/**
 * 角色名选择浮层的标签文案
 * 由父组件通过 useI18n 的 t() 翻译后传入，
 * 避免 createRoot 跨 React 树导致 I18nContext 丢失
 */
export interface CharacterMentionPickerLabels {
  /** 浮层 aria-label */
  pickerAriaLabel?: string;
  /** 列表框 aria-label */
  listboxAriaLabel?: string;
  /** 自定义输入框 aria-label */
  customInputAriaLabel?: string;
  /** 自定义输入框 placeholder */
  customInputPlaceholder?: string;
  /** 底部快捷键提示文本 */
  hintText?: string;
}

/**
 * 角色名选择浮层组件 Props
 */
interface CharacterMentionPickerProps {
  /** 浮层定位锚点（光标坐标） */
  rect: DOMRect;
  /** 可选角色名列表 */
  characters: string[];
  /** 显示文案标签（由父组件翻译后传入） */
  labels: CharacterMentionPickerLabels;
  /** 选择角色名回调（点击列表项或按 Enter 时触发） */
  onSelect: (name: string) => void;
  /** 关闭浮层回调（按 Esc 或点击外部时触发） */
  onClose: () => void;
}

/**
 * 角色名选择浮层组件
 * 输入:
 *   - rect: 浮层定位锚点
 *   - characters: 角色名列表
 *   - labels: 显示文案
 *   - onSelect: 选择回调
 *   - onClose: 关闭回调
 * 输出: JSX 浮层（fixed 定位，挂载到 document.body）
 * 流程:
 *   1. 挂载时自动聚焦自定义输入框
 *   2. 渲染角色列表，默认选中第一项
 *   3. 键盘导航：ArrowUp/Down 移动选中项，Enter 确认，Esc 关闭
 *   4. 鼠标悬停切换选中项，点击触发选择
 *   5. 点击浮层外部触发关闭
 *   6. 卸载时通过 useEffect cleanup 自动移除 mousedown 监听器
 */
export default function CharacterMentionPicker({
  rect,
  characters,
  labels,
  onSelect,
  onClose,
}: CharacterMentionPickerProps) {
  // 选中项索引（默认 0，即第一个角色）
  const [selectedIndex, setSelectedIndex] = useState(0);
  // 自定义输入框值
  const [customValue, setCustomValue] = useState("");

  // DOM 引用
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  // 回调函数引用（避免 useEffect 依赖变化导致重新绑定事件监听）
  // Task 2.9: useRef.current 赋值移入 useEffect, 避免渲染期间副作用
  const onSelectRef = useRef(onSelect);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onCloseRef.current = onClose;
  });

  // 显示文案（带中文回退默认值，与原始 DOM 实现保持一致）
  const pickerAria = labels.pickerAriaLabel || "角色名选择";
  const listboxAria = labels.listboxAriaLabel || "可选角色名";
  const inputAria = labels.customInputAriaLabel || "自定义角色名输入";
  const inputPlaceholder = labels.customInputPlaceholder || "自定义角色名…";
  const hintLabel = labels.hintText || "Tab 选择 | ↑↓ 导航 | Esc 关闭";

  /**
   * 确认选择：优先提交自定义输入值，否则选择当前高亮项
   * 输入: 无（从 state 与 input 读取）
   * 输出: 调用 onSelect 回调
   * 流程:
   *   1. 读取自定义输入框值并 trim
   *   2. 非空时提交自定义值
   *   3. 空时提交当前高亮角色名（若列表非空）
   */
  const confirmSelection = () => {
    const trimmed = customValue.trim();
    if (trimmed) {
      onSelectRef.current(trimmed);
    } else if (characters.length > 0 && characters[selectedIndex]) {
      onSelectRef.current(characters[selectedIndex]);
    }
  };

  /**
   * 键盘导航主处理器
   * 输入: React KeyboardEvent
   * 输出: 无（通过 preventDefault 与回调控制行为）
   * 流程:
   *   - ArrowUp: 选中上一项（循环到末尾）
   *   - ArrowDown: 选中下一项（循环到开头）
   *   - Enter: 确认选择（自定义值优先，否则高亮项）
   *   - Escape: 关闭浮层
   *   - 其他键: 不拦截
   */
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        if (characters.length > 0) {
          setSelectedIndex((prev) => (prev - 1 + characters.length) % characters.length);
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        if (characters.length > 0) {
          setSelectedIndex((prev) => (prev + 1) % characters.length);
        }
        break;
      case "Enter":
        e.preventDefault();
        confirmSelection();
        break;
      case "Escape":
        e.preventDefault();
        onCloseRef.current();
        break;
      default:
        break;
    }
  };

  // 挂载时自动聚焦自定义输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 选中项变化时滚动到可视区域
  useEffect(() => {
    const listbox = listboxRef.current;
    if (!listbox) return;
    const item = listbox.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // 点击浮层外部关闭浮层
  // 修复原始 DOM 实现中事件监听未显式移除的内存泄漏问题：
  // 通过 useEffect 的 cleanup 函数确保组件卸载时自动移除 mousedown 监听器
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const picker = pickerRef.current;
      if (!picker) return;
      // 使用 globalThis.Node 避免与 ProseMirror Node 类型冲突
      if (!picker.contains(e.target as globalThis.Node)) {
        onCloseRef.current();
      }
    };
    // 延迟 100ms 绑定，避免捕获到打开浮层时的触发点击事件
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", handleMouseDown);
    }, 100);
    // cleanup: 组件卸载时移除监听器与定时器，杜绝内存泄漏
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, []);

  // 计算浮层位置（锚点下方 4px）
  const top = rect.bottom + 4;

  return (
    <div
      ref={pickerRef}
      role="dialog"
      aria-label={pickerAria}
      onKeyDown={handleKeyDown}
      className="fixed z-[9999] min-w-[160px] max-h-[240px] overflow-y-auto p-1 bg-nf-bg-card border border-nf-border-light rounded-lg shadow-lg font-sans"
      style={{ left: rect.left, top }}
    >
      {/* 角色名列表 */}
      <div
        ref={listboxRef}
        role="listbox"
        aria-label={listboxAria}
        aria-activedescendant={
          characters.length > 0 ? `character-picker-item-${selectedIndex}` : undefined
        }
      >
        {characters.map((name, i) => (
          <div
            key={`${name}-${i}`}
            id={`character-picker-item-${i}`}
            role="option"
            aria-selected={i === selectedIndex}
            data-index={i}
            onMouseEnter={() => setSelectedIndex(i)}
            onClick={() => onSelectRef.current(name)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[13px] cursor-pointer rounded-sm transition-colors duration-75 ${
              i === selectedIndex
                ? "bg-nf-bg-hover text-fandex-primary"
                : "bg-transparent text-nf-text"
            }`}
          >
            <UserCircle className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
            <span className="truncate">{name}</span>
          </div>
        ))}
      </div>

      {/* 分隔线 */}
      <div className="h-px bg-nf-border-light my-1" />

      {/* 自定义角色名输入框 */}
      <input
        ref={inputRef}
        type="text"
        value={customValue}
        onChange={(e) => setCustomValue(e.target.value)}
        placeholder={inputPlaceholder}
        aria-label={inputAria}
        className="w-full box-border px-3 py-1.5 text-[13px] bg-nf-bg border border-nf-border-light rounded-sm text-nf-text outline-none focus:border-fandex-primary"
      />

      {/* 底部快捷键提示 */}
      <div
        className="flex items-center gap-1 px-3 py-1 text-[11px] text-nf-text-tertiary"
        aria-hidden="true"
      >
        <CornerDownLeft className="w-2.5 h-2.5" />
        <span>{hintLabel}</span>
      </div>
    </div>
  );
}
