// 跨面板事件总线
//
// 功能概述：
// 提供全局事件订阅/发布能力，实现编辑器、设定库面板、时间线面板、
// 人物关系图面板之间的双向联动。当用户在某一面板中操作实体（hover/click）
// 或在编辑器中跳转场景时，其他面板可同步响应。
//
// 模块职责：
// 1. 定义跨面板事件类型（entity:hover / entity:click / scene:navigate 等）
// 2. 提供 on / off / emit 方法管理事件订阅与触发
// 3. 自动清理已卸载组件的监听器（通过返回的 unsubscribe 函数）
// 4. 支持 payload 数据传递，携带实体 ID、场景 ID 等上下文
//
// 设计说明：
// 采用 Zustand 管理事件监听器集合，而非 mitt / EventEmitter 等第三方库：
// 1. 零新增依赖，与现有 store 体系无缝集成
// 2. 监听器集合存储在 Zustand 内部状态，组件卸载时通过 unsubscribe 清理
// 3. 事件触发为同步执行，保证面板间联动的即时性
// 4. 监听器异常不会中断其他监听器的执行（try-catch 包裹）

import { create } from "zustand";

// ===== 事件类型定义 =====

/**
 * 跨面板事件类型枚举
 * - entity:hover: 鼠标悬停在实体上（编辑器正文或设定面板），其他面板高亮该实体
 * - entity:click: 点击实体，其他面板聚焦/打开该实体详情
 * - scene:navigate: 跳转场景，时间线面板高亮对应节点，设定面板加载场景相关实体
 * - codex:updated: 设定库数据变更（新增/删除/编辑实体），各面板刷新缓存
 */
export type EventBusType =
  | "entity:hover"
  | "entity:click"
  | "scene:navigate"
  | "codex:updated";

/**
 * 事件 payload 联合类型
 * 不同事件携带不同的上下文数据
 */
export interface EventBusPayloadMap {
  /** 实体悬停：携带实体 ID（可为 null 表示悬停取消） */
  "entity:hover": { entityId: string | null; entityType?: string };
  /** 实体点击：携带实体 ID 与来源面板 */
  "entity:click": { entityId: string; source: "editor" | "codex" | "timeline" | "graph" };
  /** 场景跳转：携带场景 ID（sceneBreak 节点的 sceneId） */
  "scene:navigate": { sceneId: string; filePath?: string };
  /** 设定库更新：无 payload，各面板主动刷新 */
  "codex:updated": Record<string, never>;
}

// 事件监听器函数类型
type EventListener<T extends EventBusType> = (payload: EventBusPayloadMap[T]) => void;

// 监听器集合类型：Map<事件类型, Set<监听器函数>>
type ListenerMap = Map<EventBusType, Set<EventListener<EventBusType>>>;

// ===== 事件总线 Store =====

/**
 * 事件总线状态接口
 * 监听器集合存储在 store 内部，通过 on/off/emit 方法管理
 */
interface EventBusState {
  /** 监听器集合（内部状态，不直接暴露给消费者） */
  listeners: ListenerMap;

  /**
   * 订阅事件
   * 输入: type 事件类型, listener 监听器函数
   * 输出: unsubscribe 取消订阅函数（组件卸载时调用）
   * 流程:
   *   1. 获取或创建该事件类型的监听器集合
   *   2. 添加监听器到集合
   *   3. 返回取消订阅函数，调用后从集合中移除该监听器
   */
  on: <T extends EventBusType>(
    type: T,
    listener: EventListener<T>
  ) => () => void;

  /**
   * 取消订阅事件
   * 输入: type 事件类型, listener 监听器函数
   * 输出: 无
   * 流程: 从监听器集合中移除指定函数
   */
  off: <T extends EventBusType>(
    type: T,
    listener: EventListener<T>
  ) => void;

  /**
   * 触发事件
   * 输入: type 事件类型, payload 事件数据
   * 输出: 无
   * 流程:
   *   1. 获取该事件类型的所有监听器
   *   2. 依次同步调用每个监听器，传入 payload
   *   3. 单个监听器异常不影响其他监听器执行（try-catch 包裹）
   */
  emit: <T extends EventBusType>(
    type: T,
    payload: EventBusPayloadMap[T]
  ) => void;
}

/**
 * 事件总线 Store 实例
 * 使用方式：
 *   const emit = useEventBus((s) => s.emit);
 *   useEffect(() => useEventBus.getState().on("entity:hover", handler), []);
 */
// set 未使用：事件总线仅依赖 get 读取当前 listeners 集合
// 保留 set 参数以符合 Zustand create 签名，前缀下划线表示有意未用
export const useEventBus = create<EventBusState>(( _set, get) => ({
  listeners: new Map(),

  on: (type, listener) => {
    const { listeners } = get();
    // 获取或创建该事件类型的监听器集合
    let set_ = listeners.get(type);
    if (!set_) {
      set_ = new Set();
      listeners.set(type, set_);
    }
    set_.add(listener as EventListener<EventBusType>);

    // 返回取消订阅函数
    return () => {
      const currentSet = get().listeners.get(type);
      if (currentSet) {
        currentSet.delete(listener as EventListener<EventBusType>);
        // 集合为空时清理，避免内存泄漏
        if (currentSet.size === 0) {
          get().listeners.delete(type);
        }
      }
    };
  },

  off: (type, listener) => {
    const set_ = get().listeners.get(type);
    if (set_) {
      set_.delete(listener as EventListener<EventBusType>);
      if (set_.size === 0) {
        get().listeners.delete(type);
      }
    }
  },

  emit: (type, payload) => {
    const set_ = get().listeners.get(type);
    if (!set_) return;
    // 依次同步调用监听器，异常隔离
    for (const listener of set_) {
      try {
        (listener as EventListener<typeof type>)(payload);
      } catch (err) {
        // 监听器异常不中断其他监听器，记录到控制台便于调试
        console.error(`[EventBus] 监听器执行异常 (${type}):`, err);
      }
    }
  },
}));

// ===== 使用示例 =====
//
// React 组件中订阅事件（在 useEffect 中注册，卸载时自动清理）：
//
//   import { useEffect } from "react";
//   import { useEventBus } from "../lib/eventBusSlice";
//
//   function CodexPanel() {
//     const emit = useEventBus((s) => s.emit);
//     useEffect(() => {
//       // 订阅实体悬停事件，高亮设定面板中对应实体
//       const unsubscribe = useEventBus
//         .getState()
//         .on("entity:hover", (payload) => {
//           setHoveredId(payload.entityId);
//         });
//       return unsubscribe; // 组件卸载时自动取消订阅
//     }, []);
//
//     // 触发实体点击事件，通知其他面板
//     const handleEntityClick = (id: string) => {
//       emit("entity:click", { entityId: id, source: "codex" });
//     };
//   }
//
// 非 React 场景（如 Web Worker、工具函数）直接操作 store：
//
//   useEventBus.getState().emit("codex:updated", {} as never);

