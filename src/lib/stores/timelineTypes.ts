// src/lib/stores/timelineTypes.ts
//
// 剧情时间线编辑器类型定义模块
// 定义节点/边/图谱的核心 TypeScript 类型, 供 Service 层与 UI 层共享。
// 所有类型严格禁用 any/unknown, 使用完整泛型。

import type { Node as RFNode, Edge as RFEdge } from "@xyflow/react";

/**
 * 剧情时间线节点类型枚举
 * - Main: 主线节点(卷/章, 主轴水平排列)
 * - Branch: 分支节点(番外/间章/支线, 垂直分布主轴上下)
 * - Event: 事件节点(关键情节标记, 依附主线节点)
 * - Ending: 结局节点(多结局小说的终点)
 */
export type TimelineNodeType = "main" | "branch" | "event" | "ending";

/** 节点状态枚举(用于状态徽章与统计) */
export type NodeStatus = "planned" | "writing" | "done";

/**
 * 剧情节点业务数据载荷
 * 与 React Flow Node.data 字段对接, 承载所有业务字段
 */
export interface TimelineNodeData {
  /** 节点标题(必填, 显示在卡片顶部) */
  title: string;
  /** 节点类型(必填, 决定视觉样式与布局位置) */
  nodeType: TimelineNodeType;
  /** 剧情摘要(节点详细描述, 200 字内) */
  summary: string;
  /** 核心冲突(本节点的主要矛盾) */
  coreConflict: string;
  /** 伏笔备注(埋设/回收的伏笔标记) */
  foreshadowing: string;
  /** 节点状态(决定状态徽章颜色) */
  status: NodeStatus;
  /** 排序序号(同一主轴位置内的顺序) */
  order: number;
  /** 折叠状态(仅 main 节点有效, true 表示其子分支已折叠) */
  collapsed?: boolean;
  /** 子节点数量(折叠时显示为数字角标) */
  childCount?: number;
  /** 创建时间 ISO 8601 */
  createdAt: string;
  /** 最后修改时间 ISO 8601 */
  updatedAt: string;
}

/**
 * React Flow 节点基类型(去掉 data/type, 用业务类型替换)
 * 使用 Omit 模式避免 @xyflow/react v12 的 NodeData extends Record<string, unknown> 约束,
 * 该约束要求添加 [key: string]: unknown 索引签名, 与项目禁用 unknown 规则冲突。
 */
type RFNodeBase = Omit<RFNode, "data" | "type">;

/** React Flow 节点类型(带业务数据, 禁用 any/unknown) */
export type TimelineNode = RFNodeBase & {
  data: TimelineNodeData;
  type: "storyNode";
};

/** React Flow 边基类型(去掉 data/type, 用业务类型替换) */
type RFEdgeBase = Omit<RFEdge, "data" | "type">;

/**
 * React Flow 边类型
 * 注意: 自定义边数据必须包裹在 data 字段内, 与后端 PersistedEdge.data 对齐
 */
export type TimelineEdge = RFEdgeBase & {
  data: { edgeKind: TimelineNodeType };
  type: "storyEdge";
};

/**
 * 剧情图谱持久化文件结构
 * 存储于 {project_root}/剧情图谱/timeline.json
 */
export interface TimelineGraph {
  /** 文件格式版本(用于未来迁移) */
  schemaVersion: 1;
  /** 项目唯一标识(取自项目路径, 用于内部关联) */
  projectId: string;
  /** 项目名称(冗余字段, 便于离线识别) */
  projectName: string;
  /** 最后修改时间 ISO 8601 */
  updatedAt: string;
  /** 节点列表(包含位置信息, 与 React Flow nodes 一一对应) */
  nodes: TimelineNode[];
  /** 边列表 */
  edges: TimelineEdge[];
}

/**
 * 节点类型对应的 FANDEX 颜色 token
 * main=主色蓝, branch=次色绿, event=三色橙, ending=灰色
 */
export const NODE_TYPE_COLORS: Record<TimelineNodeType, {
  border: string;
  bg: string;
  text: string;
  badge: string;
}> = {
  // 主线: 主色 #6EA8FE
  main: {
    border: "border-fandex-primary",
    bg: "bg-fandex-primary/10",
    text: "text-fandex-primary",
    badge: "bg-fandex-primary",
  },
  // 分支: 次色 #55EFC4
  branch: {
    border: "border-fandex-secondary",
    bg: "bg-fandex-secondary/10",
    text: "text-fandex-secondary",
    badge: "bg-fandex-secondary",
  },
  // 事件: 三色 #F09070
  event: {
    border: "border-fandex-tertiary",
    bg: "bg-fandex-tertiary/10",
    text: "text-fandex-tertiary",
    badge: "bg-fandex-tertiary",
  },
  // 结局: 灰色 zinc-400
  ending: {
    border: "border-zinc-400",
    bg: "bg-zinc-400/10",
    text: "text-zinc-300",
    badge: "bg-zinc-400",
  },
};

/** 节点状态徽章文案与颜色 */
export const NODE_STATUS_MAP: Record<NodeStatus, { label: string; color: string }> = {
  planned: { label: "未开始", color: "bg-zinc-500" },
  writing: { label: "写作中", color: "bg-fandex-tertiary" },
  done: { label: "完稿", color: "bg-fandex-secondary" },
};

/** 边类型颜色映射(用于自定义连线 SVG stroke) */
export const EDGE_TYPE_COLORS: Record<TimelineNodeType, string> = {
  main: "#6EA8FE",
  branch: "#55EFC4",
  event: "#F09070",
  ending: "#a1a1aa",
};
