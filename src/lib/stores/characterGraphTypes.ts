// src/lib/stores/characterGraphTypes.ts
//
// 人物关系图编辑器类型定义模块
// 定义角色节点/关系边/图谱的核心 TypeScript 类型, 供 Service 层与 UI 层共享。
// 复用 Timeline 图谱架构, 但节点/边语义聚焦于"人物关系"领域:
//   - 节点: 单个角色(姓名/身份/标签/简介)
//   - 边:  角色间关系(师徒/敌对/亲属/朋友/恋人/上下级/同门/其他)
// 所有类型严格禁用 any/unknown, 使用完整泛型。

import type { Node as RFNode, Edge as RFEdge } from "@xyflow/react";

/**
 * 角色关系类型枚举
 * - Master: 师徒(师徒/师徒关系, 含师徒双向语义)
 * - Enemy:  敌对(对立/仇敌/竞争对手)
 * - Family: 亲属(血缘/家族关系)
 * - Friend: 朋友(友谊/盟友)
 * - Lover:  恋人(情侣/爱人)
 * - Subordinate: 上下级(主从/统属关系)
 * - Fellow: 同门(同门/同修/同袍)
 * - Other:  其他(无法归类的特殊关系)
 */
export type RelationType =
  | "master"
  | "enemy"
  | "family"
  | "friend"
  | "lover"
  | "subordinate"
  | "fellow"
  | "other";

/**
 * 角色节点业务数据载荷
 * 与 React Flow Node.data 字段对接, 承载所有业务字段
 */
export interface CharacterGraphNodeData {
  /** 角色姓名(必填, 显示在卡片顶部) */
  name: string;
  /** 身份/职业(从角色设定文件提取或手动填写, 如"剑客"/"尚书") */
  identity: string;
  /** 标签数组(角色特质关键词, 如["冷酷","痴情"], 用于快速识别) */
  tags: string[];
  /** 一句话简介(角色核心描述, 50 字内) */
  brief: string;
  /** 节点强调色(HEX 格式, 用于卡片装饰条与 Handle 颜色, 默认主色蓝) */
  accentColor: string;
  /** 关联的角色设定文件相对路径(可选, 用于双向联动) */
  sourceFile: string;
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
export type CharacterGraphNode = RFNodeBase & {
  data: CharacterGraphNodeData;
  type: "characterNode";
};

/** React Flow 边基类型(去掉 data/type, 用业务类型替换) */
type RFEdgeBase = Omit<RFEdge, "data" | "type">;

/**
 * React Flow 边类型
 * 注意: 自定义边数据必须包裹在 data 字段内, 与后端 PersistedEdge.data 对齐
 */
export type CharacterGraphEdge = RFEdgeBase & {
  data: { relationType: RelationType; description: string };
  type: "characterEdge";
};

/**
 * 人物关系图谱持久化文件结构
 * 存储于 {project_root}/人物关系图/character_graph.json
 */
export interface CharacterGraph {
  /** 文件格式版本(用于未来迁移) */
  schemaVersion: 1;
  /** 项目唯一标识(取自项目路径, 用于内部关联) */
  projectId: string;
  /** 项目名称(冗余字段, 便于离线识别) */
  projectName: string;
  /** 最后修改时间 ISO 8601 */
  updatedAt: string;
  /** 节点列表(包含位置信息, 与 React Flow nodes 一一对应) */
  nodes: CharacterGraphNode[];
  /** 边列表 */
  edges: CharacterGraphEdge[];
}

/**
 * 关系类型对应的中文标签(用于 UI 显示)
 */
export const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  master: "师徒",
  enemy: "敌对",
  family: "亲属",
  friend: "朋友",
  lover: "恋人",
  subordinate: "上下级",
  fellow: "同门",
  other: "其他",
};

/**
 * 关系类型对应的 FANDEX 颜色(用于边 stroke 颜色与节点装饰条)
 * 主色蓝/次色绿/三色橙 + 灰色系补充, 保证视觉区分度
 */
export const RELATION_TYPE_COLORS: Record<RelationType, string> = {
  // 师徒: 主色蓝(传承关系, 庄重感)
  master: "#6EA8FE",
  // 敌对: 红色(冲突警示, 区别于 FANDEX 三色)
  enemy: "#EF4444",
  // 亲属: 次色绿(血缘温暖)
  family: "#55EFC4",
  // 朋友: 黄色(友谊明亮)
  friend: "#FACC15",
  // 恋人: 粉色(爱情浪漫)
  lover: "#EC4899",
  // 上下级: 紫色(统属权威)
  subordinate: "#A855F7",
  // 同门: 三色橙(同袍情谊)
  fellow: "#F09070",
  // 其他: 灰色(中性)
  other: "#a1a1aa",
};

/** 默认节点强调色(主色蓝, 用于新建节点未指定 accentColor 时) */
export const DEFAULT_NODE_ACCENT = "#6EA8FE";
