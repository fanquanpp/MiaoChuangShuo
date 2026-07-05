// 实体高亮 Web Worker：Aho-Corasick 多模式匹配
//
// 功能概述：
// 在独立线程中构建 Aho-Corasick 自动机，对编辑器正文进行多实体名称并行匹配。
// 主线程通过 postMessage 发送文本，Worker 返回匹配位置列表，避免阻塞 UI 渲染。
//
// 模块职责：
// 1. 接收实体字典（实体名 + 别名），构建 AC 自动机
// 2. 接收正文文本，返回所有实体出现位置
// 3. 对重叠匹配进行最长优先消解，避免"张三"与"张三丰"冲突
//
// AI-Ready 设计说明：
// 本 Worker 不仅是高亮渲染的基础设施，更是 AI 实时感知"当前场景有哪些角色在场"的数据源。
// 主线程（entityHighlightClient.ts）在收到匹配结果后会同步触发 Tauri Event `entity:detected`，
// 为未来 AI 场景分析与 RLHF 数据采集提供事件流。

// ===== 消息协议定义 =====

/**
 * 实体模式（主线程发送给 Worker 用于构建自动机）
 */
export interface EntityPattern {
  /** 实体唯一标识（CodexMeta.id，UUID v4） */
  entityId: string;
  /** 实体显示名 */
  entityName: string;
  /** 实体类型：character / worldview / glossary / material */
  entityType: string;
  /** 别名列表（与实体名一并作为模式串注入自动机） */
  aliases: string[];
}

/**
 * 构建自动机消息
 */
interface BuildMessage {
  type: "build";
  patterns: EntityPattern[];
}

/**
 * 搜索消息
 */
interface SearchMessage {
  type: "search";
  text: string;
  /** 请求标识，用于主线程匹配请求与响应 */
  requestId: number;
}

/**
 * 清空自动机消息
 */
interface ResetMessage {
  type: "reset";
}

type WorkerRequest = BuildMessage | SearchMessage | ResetMessage;

/**
 * 自动机构建完成消息
 */
interface BuiltMessage {
  type: "built";
  patternCount: number;
}

/**
 * 实体匹配结果项
 */
export interface EntityMatch {
  /** 实体唯一标识 */
  entityId: string;
  /** 实体显示名 */
  entityName: string;
  /** 实体类型 */
  entityType: string;
  /** 匹配起始位置（字符偏移，含） */
  start: number;
  /** 匹配结束位置（字符偏移，不含） */
  end: number;
  /** 匹配到的文本 */
  matchedText: string;
}

/**
 * 搜索结果消息
 */
interface ResultMessage {
  type: "result";
  requestId: number;
  matches: EntityMatch[];
}

/**
 * 错误消息
 */
interface ErrorMessage {
  type: "error";
  message: string;
  requestId?: number;
}

type WorkerResponse = BuiltMessage | ResultMessage | ErrorMessage;

// ===== Aho-Corasick 自动机实现 =====

/**
 * 自动机节点
 */
interface AcNode {
  /** 子节点转移表：字符 -> 节点索引 */
  children: Map<string, number>;
  /** fail 指针（失配时跳转的节点索引） */
  fail: number;
  /** 输出列表：在该节点终止的所有模式信息 */
  output: PatternOutput[];
}

/**
 * 模式输出信息（存储在节点 output 列表中）
 */
interface PatternOutput {
  /** 实体唯一标识 */
  entityId: string;
  /** 实体显示名 */
  entityName: string;
  /** 实体类型 */
  entityType: string;
  /** 模式串字符长度（用于计算匹配起始位置） */
  length: number;
}

/**
 * Aho-Corasick 自动机
 *
 * 算法复杂度：
 *   - 构建：O(M)，M 为所有模式串长度总和
 *   - 搜索：O(N + K)，N 为文本长度，K 为匹配数
 *
 * 设计说明：
 *   - 使用数组存储节点，避免递归对象引用，提升 GC 效率
 *   - fail 指针通过 BFS 构建，保证层级正确性
 *   - output 合并 fail 节点的输出，避免搜索时回溯 fail 链
 */
class AhoCorasick {
  /** 节点数组，索引 0 为根节点 */
  private nodes: AcNode[] = [];

  constructor() {
    this.reset();
  }

  /**
   * 重置自动机为初始状态（仅根节点）
   */
  reset(): void {
    this.nodes = [
      {
        children: new Map(),
        fail: 0,
        output: [],
      },
    ];
  }

  /**
   * 插入模式串
   * 输入:
   *   pattern - 模式串文本
   *   entity - 关联的实体信息
   * 流程:
   *   1. 从根节点出发，逐字符沿 trie 下行
   *   2. 不存在的子节点创建新节点
   *   3. 在终止节点追加 output
   */
  insert(pattern: string, entity: PatternOutput): void {
    if (pattern.length === 0) return;
    let cur = 0;
    for (const ch of pattern) {
      let next = this.nodes[cur].children.get(ch);
      if (next === undefined) {
        next = this.nodes.length;
        this.nodes.push({
          children: new Map(),
          fail: 0,
          output: [],
        });
        this.nodes[cur].children.set(ch, next);
      }
      cur = next;
    }
    this.nodes[cur].output.push(entity);
  }

  /**
   * 构建 fail 指针（BFS 层序遍历）
   * 流程:
   *   1. 根节点的直接子节点 fail 指向根
   *   2. 对每个节点，其子节点的 fail = 沿父节点 fail 链查找第一个有相同字符转移的节点
   *   3. 合并 fail 节点的 output 到当前节点（搜索时无需回溯 fail 链）
   */
  build(): void {
    const queue: number[] = [];
    // 第一层节点 fail 指向根
    for (const child of this.nodes[0].children.values()) {
      this.nodes[child].fail = 0;
      queue.push(child);
    }
    while (queue.length > 0) {
      const cur = queue.shift() as number;
      for (const [ch, child] of this.nodes[cur].children) {
        queue.push(child);
        // 沿父节点 fail 链查找匹配字符的转移
        let f = this.nodes[cur].fail;
        while (f !== 0 && !this.nodes[f].children.has(ch)) {
          f = this.nodes[f].fail;
        }
        const failTarget = this.nodes[f].children.get(ch);
        if (failTarget !== undefined && failTarget !== child) {
          this.nodes[child].fail = failTarget;
        } else {
          this.nodes[child].fail = 0;
        }
        // 合并 fail 节点的 output
        const failOutput = this.nodes[this.nodes[child].fail].output;
        this.nodes[child].output.push(...failOutput);
      }
    }
  }

  /**
   * 搜索文本中的所有实体匹配
   * 输入: text 待搜索文本
   * 输出: EntityMatch[] 匹配结果列表（已消解重叠）
   * 流程:
   *   1. 逐字符遍历文本，沿自动机转移
   *   2. 失配时沿 fail 链回退
   *   3. 收集每个节点的 output 对应的匹配
   *   4. 按最长优先原则消解重叠匹配
   */
  search(text: string): EntityMatch[] {
    if (this.nodes.length <= 1) return [];
    const chars = Array.from(text);
    const rawMatches: EntityMatch[] = [];
    let cur = 0;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      // 沿 fail 链回退直到找到匹配字符的转移或回到根
      while (cur !== 0 && !this.nodes[cur].children.has(ch)) {
        cur = this.nodes[cur].fail;
      }
      const next = this.nodes[cur].children.get(ch);
      if (next !== undefined) {
        cur = next;
      }
      // 收集当前节点的所有 output（已合并 fail 链的 output）
      for (const out of this.nodes[cur].output) {
        const start = i - out.length + 1;
        rawMatches.push({
          entityId: out.entityId,
          entityName: out.entityName,
          entityType: out.entityType,
          start,
          end: i + 1,
          matchedText: chars.slice(start, i + 1).join(""),
        });
      }
    }
    return resolveOverlaps(rawMatches);
  }

  /**
   * 获取已注册的模式串数量（近似值，按插入次数计）
   */
  get patternCount(): number {
    let count = 0;
    for (const node of this.nodes) {
      count += node.output.length;
    }
    return count;
  }
}

/**
 * 消解重叠匹配：最长优先
 * 输入: matches 原始匹配列表
 * 输出: EntityMatch[] 消解后的无重叠匹配列表
 * 流程:
 *   1. 按起始位置升序、长度降序排序
 *   2. 顺序遍历，跳过与已接受匹配重叠的项
 * 设计说明:
 *   解决"张三"与"张三丰"在"张三丰"文本中重叠的问题，优先保留更长的"张三丰"。
 */
function resolveOverlaps(matches: EntityMatch[]): EntityMatch[] {
  if (matches.length <= 1) return matches;
  const sorted = [...matches].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - b.start - (a.end - a.start);
  });
  const result: EntityMatch[] = [];
  let lastEnd = -1;
  for (const m of sorted) {
    if (m.start >= lastEnd) {
      result.push(m);
      lastEnd = m.end;
    }
  }
  return result;
}

// ===== Worker 消息处理 =====

const automaton = new AhoCorasick();

/**
 * 从 EntityPattern 列表构建自动机
 * 输入: patterns 实体模式列表
 * 流程:
 *   1. 重置自动机
 *   2. 对每个实体，将实体名与所有别名作为模式串插入
 *   3. 构建 fail 指针
 */
function buildAutomaton(patterns: EntityPattern[]): void {
  automaton.reset();
  for (const p of patterns) {
    const baseOutput: Omit<PatternOutput, "length"> = {
      entityId: p.entityId,
      entityName: p.entityName,
      entityType: p.entityType,
    };
    // 实体名作为模式串（跳过空值）
    if (p.entityName.length > 0) {
      automaton.insert(p.entityName, { ...baseOutput, length: Array.from(p.entityName).length });
    }
    // 别名作为模式串
    for (const alias of p.aliases) {
      if (alias.length > 0) {
        automaton.insert(alias, { ...baseOutput, length: Array.from(alias).length });
      }
    }
  }
  automaton.build();
}

/**
 * 发送响应消息给主线程
 */
function postResponse(msg: WorkerResponse): void {
  (self as unknown as Worker).postMessage(msg);
}

/**
 * Worker 消息入口
 */
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "build": {
        buildAutomaton(msg.patterns);
        postResponse({ type: "built", patternCount: automaton.patternCount });
        break;
      }
      case "search": {
        const matches = automaton.search(msg.text);
        postResponse({ type: "result", requestId: msg.requestId, matches });
        break;
      }
      case "reset": {
        automaton.reset();
        postResponse({ type: "built", patternCount: 0 });
        break;
      }
      default: {
        postResponse({ type: "error", message: `未知消息类型: ${(msg as { type: string }).type}` });
      }
    }
  } catch (err) {
    postResponse({
      type: "error",
      message: String(err),
      requestId: msg.type === "search" ? msg.requestId : undefined,
    });
  }
};
