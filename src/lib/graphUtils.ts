// src/lib/graphUtils.ts
//
// 图谱通用工具函数模块
// 从 timelineStore.ts 拆分而来, 提供无副作用纯函数, 供各类图谱 store 与 UI 层共享。
//
// 模块职责:
//   1. 提供折叠可达性分析(filterCollapsed)等图谱算法工具
//   2. 严格无副作用: 不修改入参, 不依赖外部状态
//   3. 通过泛型约束兼容不同业务图谱节点(TimelineNode / CharacterGraphNode 等)
//
// 设计说明:
//   - 通过 CollapsibleNodeData / CollapsibleNode / EdgeLike 最小约束接口,
//     filterCollapsed 可同时处理时间线主节点折叠与未来其他图谱场景
//   - 不依赖 @xyflow/react 的 Node/Edge 类型, 避免引入 unknown 索引签名约束
//   - utils 目录仅允许存放无副作用纯函数, 不引入 store / API 依赖

/**
 * 可折叠节点数据约束
 * 业务图谱节点 data 字段需提供 nodeType 与可选 collapsed 字段, 才能参与折叠可达性分析
 */
export interface CollapsibleNodeData {
  /** 节点类型字符串(业务图谱自行定义字面量联合, 此处仅约束为 string) */
  nodeType: string;
  /** 折叠状态(可选, true 表示其子树被隐藏) */
  collapsed?: boolean;
}

/**
 * 可折叠节点约束
 * 仅要求 id 与 data.nodeType/data.collapsed 字段, 兼容 React Flow Node 与业务节点
 */
export interface CollapsibleNode {
  /** 节点唯一标识 */
  id: string;
  /** 节点业务数据 */
  data: CollapsibleNodeData;
}

/**
 * 边的最小约束接口
 * 仅需 source 与 target 字段即可参与可达性分析
 */
export interface EdgeLike {
  /** 起点 ID */
  source: string;
  /** 终点 ID */
  target: string;
}

/**
 * 计算折叠后实际显示的节点与边(可达性分析)
 * 输入:
 *   nodes 全部节点, 需满足 CollapsibleNode 约束
 *   edges 全部边, 需满足 EdgeLike 约束
 * 输出: { visibleNodes, visibleEdges } 过滤后的可见集合
 * 流程:
 *   1. 找出所有 collapsed=true 的 main 节点(通过 nodeType 字段判定, 由调用方约定 main 字面量)
 *   2. 从所有"未折叠的 main 节点"出发, 沿边方向 BFS
 *   3. 遍历过程中跳过"已折叠的 main 节点"(不穿透其子树)
 *   4. 所有被 BFS 访问到的节点为可见节点
 *   5. 两端均可见的边为可见边
 *
 * 关键: BFS 处理任意深度的级联隐藏, 避免"悬浮孤岛"问题
 *
 * 泛型说明:
 *   - TNode 必须满足 CollapsibleNode, 保证 data.nodeType 与 data.collapsed 可访问
 *   - TEdge 必须满足 EdgeLike, 保证 source 与 target 可访问
 *   - 返回类型保留 TNode[] / TEdge[], 调用方获得具体业务类型数组, 无需断言
 *
 * @template TNode 业务节点类型
 * @template TEdge 业务边类型
 */
export function filterCollapsed<
  TNode extends CollapsibleNode,
  TEdge extends EdgeLike
>(nodes: TNode[], edges: TEdge[]): {
  visibleNodes: TNode[];
  visibleEdges: TEdge[];
} {
  // 收集所有已折叠的 main 节点 ID(作为不透明屏障, BFS 不穿透)
  const collapsedMainIds = new Set(
    nodes
      .filter((n) => n.data.nodeType === "main" && n.data.collapsed)
      .map((n) => n.id)
  );

  // 无折叠节点时直接返回原始集合, 避免无谓遍历
  if (collapsedMainIds.size === 0) {
    return { visibleNodes: nodes, visibleEdges: edges };
  }

  // 构建邻接表(source -> target[]), 仅前向遍历, 不反向
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source)!.push(edge.target);
  }

  // BFS 初始化: 从所有未折叠的 main 节点出发作为根
  const visited = new Set<string>();
  const queue: string[] = [];

  for (const node of nodes) {
    if (node.data.nodeType === "main" && !node.data.collapsed) {
      visited.add(node.id);
      queue.push(node.id);
    }
  }

  // BFS 主体: 沿边遍历可达节点, 遇到已折叠 main 节点时停止向下穿透
  while (queue.length > 0) {
    const current = queue.shift()!;
    // 已折叠的 main 节点作为屏障, 不展开其子树
    if (collapsedMainIds.has(current)) continue;

    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // 过滤: 仅保留可达节点 + 两端均可达的边
  const visibleNodes = nodes.filter((n) => visited.has(n.id));
  const visibleEdges = edges.filter(
    (e) => visited.has(e.source) && visited.has(e.target)
  );

  return { visibleNodes, visibleEdges };
}
