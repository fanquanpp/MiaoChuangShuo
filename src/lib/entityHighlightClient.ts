// 实体高亮客户端：主线程封装
//
// 功能概述：
// 管理 Web Worker 生命周期，提供同步式的搜索 API，并在匹配结果变化时
// 触发 Tauri Event `entity:detected`，为 AI 实时分析提供数据流。
//
// 模块职责：
// 1. 懒加载 Web Worker（首次调用时创建，避免应用启动开销）
// 2. 维护请求-响应映射（基于 requestId 的 Promise 解析）
// 3. 比对前后匹配结果，仅在实体集合变化时触发 `entity:detected` 事件
// 4. 提供防抖搜索，避免高频键入导致 Worker 队列堆积
//
// AI-Ready 设计说明：
// `entity:detected` 事件携带当前正文中出现的全部实体（去重），
// 未来 AI 模块可监听此事件，实时更新"当前场景有哪些角色在场"的上下文，
// 无需 AI 主动轮询编辑器状态。

import { emit } from "@tauri-apps/api/event";
import type { EntityMatch, EntityPattern } from "./entityHighlightWorker";

// 重新导出 EntityMatch 与 EntityPattern，供下游模块统一从 client 导入
export type { EntityMatch, EntityPattern } from "./entityHighlightWorker";

/**
 * `entity:detected` 事件 payload
 * 携带当前正文中出现的全部去重实体信息
 */
export interface EntityDetectedPayload {
  /** 触发检测的文件路径（用于 AI 定位上下文） */
  filePath: string;
  /** 当前正文中出现的去重实体 ID 列表 */
  entityIds: string[];
  /** 当前正文中出现的去重实体名列表（与 entityIds 一一对应） */
  entityNames: string[];
  /** 按类型分组的实体计数（AI 可据此判断场景性质） */
  typeCounts: Record<string, number>;
  /** 总匹配次数（含重复，反映实体曝光度） */
  totalMatches: number;
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  /** 当前文件路径（用于 `entity:detected` 事件） */
  filePath?: string;
  /** 是否触发 `entity:detected` 事件（默认 true）
   *  在高亮渲染等不需要 AI 感知的场景可关闭 */
  emitEvent?: boolean;
}

/** 防抖延迟（毫秒），避免高频键入触发过多搜索 */
const SEARCH_DEBOUNCE_MS = 150;

/** 请求超时（毫秒），Worker 无响应时拒绝 Promise */
const REQUEST_TIMEOUT_MS = 5000;

/**
 * 实体高亮客户端
 *
 * 使用方式：
 * ```ts
 * const client = new EntityHighlightClient();
 * await client.buildAutomaton(entities);
 * const matches = await client.search(editorText, { filePath: currentFile });
 * client.dispose(); // 组件卸载时调用
 * ```
 */
export class EntityHighlightClient {
  /** Web Worker 实例（懒加载） */
  private worker: Worker | null = null;

  /** 请求计数器，作为 requestId */
  private nextRequestId = 1;

  /** 待处理请求映射：requestId -> { resolve, reject, timer } */
  private pending: Map<number, {
    resolve: (matches: EntityMatch[]) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();

  /** 上一次触发的实体 ID 集合（用于变化检测，避免重复触发事件） */
  private lastDetectedIds: Set<string> = new Set();

  /** 防抖定时器 */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** 防抖挂起的搜索参数 */
  private pendingSearch: { text: string; options: SearchOptions } | null = null;

  /**
   * 懒加载创建 Web Worker
   * 输出: Worker 实例
   * 流程: 首次调用时通过 Vite ?worker 语法创建模块 Worker
   */
  private getWorker(): Worker {
    if (this.worker) return this.worker;
    // Vite 原生支持 new Worker(new URL(...)) 语法，构建时自动打包为独立 chunk
    this.worker = new Worker(
      new URL("./entityHighlightWorker.ts", import.meta.url),
      { type: "module" }
    );
    this.worker.onmessage = (e: MessageEvent) => {
      this.handleWorkerMessage(e.data);
    };
    this.worker.onerror = (e: ErrorEvent) => {
      // Worker 崩溃时拒绝所有待处理请求
      const err = new Error(`Worker 错误: ${e.message}`);
      for (const [, entry] of this.pending) {
        entry.reject(err);
        clearTimeout(entry.timer);
      }
      this.pending.clear();
    };
    return this.worker;
  }

  /**
   * 处理 Worker 响应消息
   * 输入: msg Worker 响应消息
   * 流程:
   *   1. 根据消息类型分发处理
   *   2. result 类型解析对应 requestId 的 Promise
   *   3. error 类型拒绝对应 Promise
   */
  private handleWorkerMessage(msg: unknown): void {
    const m = msg as { type: string; requestId?: number; matches?: EntityMatch[]; message?: string; patternCount?: number };
    switch (m.type) {
      case "result": {
        if (m.requestId === undefined) return;
        const entry = this.pending.get(m.requestId);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(m.requestId);
        entry.resolve(m.matches ?? []);
        break;
      }
      case "error": {
        if (m.requestId === undefined) return;
        const entry = this.pending.get(m.requestId);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(m.requestId);
        entry.reject(new Error(m.message ?? "未知 Worker 错误"));
        break;
      }
      case "built":
        // 自动机构建完成，无需特殊处理
        break;
      default:
        // 忽略未知消息类型
        break;
    }
  }

  /**
   * 构建自动机（替换原有实体字典）
   * 输入: patterns 实体模式列表
   * 输出: Promise<number> 已注册的模式串数量
   * 流程: 发送 build 消息给 Worker，等待 built 响应
   */
  async buildAutomaton(patterns: EntityPattern[]): Promise<number> {
    const worker = this.getWorker();
    return new Promise<number>((resolve, reject) => {
      // build 消息无 requestId，使用临时监听器等待 built 响应
      const handler = (e: MessageEvent) => {
        const msg = e.data as { type: string; patternCount?: number };
        if (msg.type === "built") {
          worker.removeEventListener("message", handler);
          resolve(msg.patternCount ?? 0);
        }
      };
      worker.addEventListener("message", handler);
      worker.postMessage({ type: "build", patterns });
      // 超时保护
      setTimeout(() => {
        worker.removeEventListener("message", handler);
        reject(new Error("构建自动机超时"));
      }, 10000);
    });
  }

  /**
   * 搜索文本中的实体匹配
   * 输入:
   *   text - 待搜索文本
   *   options - 搜索选项（filePath 与 emitEvent）
   * 输出: Promise<EntityMatch[]> 匹配结果列表
   * 流程:
   *   1. 发送 search 消息给 Worker，附带递增的 requestId
   *   2. 设置超时定时器（5 秒后自动拒绝）
   *   3. 收到 result 响应后解析 Promise
   *   4. 若 emitEvent 为 true，比对前后实体集合，变化时触发 `entity:detected`
   */
  async search(text: string, options: SearchOptions = {}): Promise<EntityMatch[]> {
    const { emitEvent = true, filePath = "" } = options;
    const worker = this.getWorker();
    const requestId = this.nextRequestId++;
    return new Promise<EntityMatch[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Worker 搜索超时"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      worker.postMessage({ type: "search", text, requestId });
    }).then((matches) => {
      if (emitEvent) {
        this.maybeEmitEntityDetected(matches, filePath);
      }
      return matches;
    });
  }

  /**
   * 防抖搜索（高频键入场景使用）
   * 输入:
   *   text - 待搜索文本
   *   options - 搜索选项
   * 输出: Promise<EntityMatch[]> 匹配结果
   * 流程:
   *   1. 清除上一次防抖定时器
   *   2. 设置新的定时器（SEARCH_DEBOUNCE_MS 后执行）
   *   3. 多次调用合并为最后一次调用
   */
  searchDebounced(text: string, options: SearchOptions = {}): Promise<EntityMatch[]> {
    this.pendingSearch = { text, options };
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    return new Promise<EntityMatch[]>((resolve, reject) => {
      this.debounceTimer = setTimeout(() => {
        const pending = this.pendingSearch;
        this.pendingSearch = null;
        this.debounceTimer = null;
        if (!pending) {
          resolve([]);
          return;
        }
        this.search(pending.text, pending.options).then(resolve, reject);
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  /**
   * 比对匹配结果，在实体集合变化时触发 `entity:detected` 事件
   * 输入:
   *   matches - 当前匹配结果
   *   filePath - 当前文件路径
   * 流程:
   *   1. 提取去重的实体 ID 集合
   *   2. 与 lastDetectedIds 比对，相同则跳过（避免重复事件）
   *   3. 不同则构造 payload 并 emit Tauri Event
   *   4. 更新 lastDetectedIds
   * 设计说明:
   *   变化检测避免每次键入都触发事件，仅在"有角色新进场/离场"时通知 AI。
   */
  private async maybeEmitEntityDetected(matches: EntityMatch[], filePath: string): Promise<void> {
    // 提取去重实体 ID
    const currentIds = new Set(matches.map((m) => m.entityId));
    // 比对：若集合相同则不触发
    if (setsEqual(currentIds, this.lastDetectedIds)) return;
    this.lastDetectedIds = currentIds;
    // 构造 payload
    const idToName = new Map<string, string>();
    const typeCounts: Record<string, number> = {};
    for (const m of matches) {
      idToName.set(m.entityId, m.entityName);
      typeCounts[m.entityType] = (typeCounts[m.entityType] ?? 0) + 1;
    }
    const payload: EntityDetectedPayload = {
      filePath,
      entityIds: [...currentIds],
      entityNames: [...currentIds].map((id) => idToName.get(id) ?? ""),
      typeCounts,
      totalMatches: matches.length,
    };
    try {
      await emit("entity:detected", payload);
    } catch {
      // 事件触发失败不影响高亮渲染主流程，静默处理
    }
  }

  /**
   * 重置自动机（清空所有模式串）
   */
  reset(): void {
    if (this.worker) {
      this.worker.postMessage({ type: "reset" });
    }
    this.lastDetectedIds = new Set();
  }

  /**
   * 销毁客户端，释放 Worker 资源
   * 流程:
   *   1. 终止 Worker 进程
   *   2. 拒绝所有待处理请求
   *   3. 清理定时器与状态
   * 注意: 组件卸载时必须调用，避免 Worker 泄漏
   */
  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingSearch = null;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("客户端已销毁"));
    }
    this.pending.clear();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.lastDetectedIds = new Set();
  }
}

/**
 * 比较两个 Set<string> 是否包含相同元素
 */
function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/**
 * 全局单例客户端
 *
 * 设计说明：
 *   - 编辑器实例全局唯一，实体高亮客户端无需多实例
 *   - 单例避免重复创建 Worker，降低内存开销
 *   - 组件卸载时不销毁单例，仅在实际退出应用时销毁
 */
let globalClient: EntityHighlightClient | null = null;

/**
 * 获取全局实体高亮客户端单例
 * 输出: EntityHighlightClient 实例
 */
export function getEntityHighlightClient(): EntityHighlightClient {
  if (!globalClient) {
    globalClient = new EntityHighlightClient();
  }
  return globalClient;
}
