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
 * 内置角色关系类型枚举(8 种预设, 用于类型安全与默认值)
 * - Master: 师徒(师徒/师徒关系, 含师徒双向语义)
 * - Enemy:  敌对(对立/仇敌/竞争对手)
 * - Family: 亲属(血缘/家族关系)
 * - Friend: 朋友(友谊/盟友)
 * - Lover:  恋人(情侣/爱人)
 * - Subordinate: 上下级(主从/统属关系)
 * - Fellow: 同门(同门/同修/同袍)
 * - Other:  其他(无法归类的特殊关系)
 *
 * 注意: 实际存储字段 relationType 类型为 string, 允许用户自定义关系类型.
 *       此联合仅用于内置类型的类型提示与默认值约束.
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
 * 用户自定义关系类型接口
 * 持久化到 localStorage, 跨项目共享
 * id: 唯一标识(用作 edge.data.relationType 的值, 不能与内置类型冲突)
 * label: 中文显示名称
 * color: 边 stroke 颜色(HEX)
 */
export interface CustomRelationType {
  id: string;
  label: string;
  color: string;
}

/**
 * 关系类型元信息(内置与自定义统一结构, 用于 UI 渲染)
 */
export interface RelationTypeMeta {
  value: string;
  label: string;
  color: string;
  /** 是否为内置类型( false 表示用户自定义) */
  builtin: boolean;
}

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
  // relationType 类型为 string, 兼容内置 8 种预设与用户自定义关系类型
  data: { relationType: string; description: string };
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

// ===== 关系类型管理(内置 + 用户自定义) =====

/**
 * 内置关系类型元信息数组(8 种预设, 顺序固定, 用于下拉选择渲染)
 * 与 RELATION_TYPE_LABELS / RELATION_TYPE_COLORS 保持一致
 */
export const BUILTIN_RELATION_TYPES: RelationTypeMeta[] = (
  Object.keys(RELATION_TYPE_LABELS) as RelationType[]
).map((key) => ({
  value: key,
  label: RELATION_TYPE_LABELS[key],
  color: RELATION_TYPE_COLORS[key],
  builtin: true,
}));

/** localStorage 键名(自定义关系类型持久化) */
const CUSTOM_RELATION_TYPES_STORAGE_KEY = "mcs_custom_relation_types";

/** 自定义关系类型默认颜色候选(用户未选色时轮询使用) */
const CUSTOM_COLOR_PALETTE = [
  "#6EA8FE",
  "#55EFC4",
  "#F09070",
  "#A855F7",
  "#EC4899",
  "#FACC15",
  "#22D3EE",
  "#FB923C",
];

/**
 * 从 localStorage 读取自定义关系类型列表
 * 输出: CustomRelationType[] 自定义关系类型数组(无数据时返回空数组)
 * 流程: 解析 localStorage JSON, 失败时返回空数组
 */
export function loadCustomRelationTypes(): CustomRelationType[] {
  try {
    const raw = localStorage.getItem(CUSTOM_RELATION_TYPES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CustomRelationType[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/**
 * 保存自定义关系类型列表到 localStorage
 * 输入: types 自定义关系类型数组
 * 输出: void
 * 流程: JSON 序列化后写入 localStorage
 */
function persistCustomRelationTypes(types: CustomRelationType[]): void {
  try {
    localStorage.setItem(CUSTOM_RELATION_TYPES_STORAGE_KEY, JSON.stringify(types));
  } catch {
    // 静默处理写入失败(如 localStorage 满)
  }
}

/**
 * 新增自定义关系类型
 * 输入:
 *   label: 中文显示名称(必填, 非空)
 *   color: 边颜色(可选, 缺省时按数量轮询色板)
 * 输出: CustomRelationType 新增的关系类型(含生成的 id), 失败返回 null
 * 流程:
 *   1. 校验 label 非空
 *   2. 生成 id(label 拼音化或随机串, 避免与内置类型冲突)
 *   3. 追加到 localStorage 并返回
 */
export function addCustomRelationType(label: string, color?: string): CustomRelationType | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  const existing = loadCustomRelationTypes();
  // 颜色: 优先用户传入, 否则按现有数量轮询色板
  const finalColor = color || CUSTOM_COLOR_PALETTE[existing.length % CUSTOM_COLOR_PALETTE.length];
  // id 生成: custom_ + 时间戳基 36, 避免与内置类型(master/enemy 等)冲突
  const id = `custom_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const newType: CustomRelationType = { id, label: trimmed, color: finalColor };
  persistCustomRelationTypes([...existing, newType]);
  return newType;
}

/**
 * 删除自定义关系类型
 * 输入: id 关系类型 id
 * 输出: void
 * 流程: 从 localStorage 过滤掉目标 id 并保存
 * 注意: 不会修改已使用该类型的边(边数据中保留旧 id, 显示时回退到"未知关系")
 */
export function deleteCustomRelationType(id: string): void {
  const existing = loadCustomRelationTypes();
  persistCustomRelationTypes(existing.filter((t) => t.id !== id));
}

/**
 * 获取所有关系类型(内置 + 自定义), 用于下拉选择渲染
 * 输出: RelationTypeMeta[] 合并后的关系类型列表
 */
export function getAllRelationTypes(): RelationTypeMeta[] {
  const customs = loadCustomRelationTypes().map((c) => ({
    value: c.id,
    label: c.label,
    color: c.color,
    builtin: false,
  }));
  return [...BUILTIN_RELATION_TYPES, ...customs];
}

/**
 * 根据关系类型 id 查询元信息(标签与颜色)
 * 输入: type 关系类型 id(内置字面量或自定义 id)
 * 输出: { label, color } 元信息, 未找到时回退到"其他"的值
 * 流程: 先查内置映射, 再查自定义列表, 都未命中返回"其他"灰色
 */
export function getRelationMeta(type: string): { label: string; color: string } {
  // 内置类型直接查映射
  if (type in RELATION_TYPE_LABELS) {
    return {
      label: RELATION_TYPE_LABELS[type as RelationType],
      color: RELATION_TYPE_COLORS[type as RelationType],
    };
  }
  // 自定义类型查 localStorage
  const customs = loadCustomRelationTypes();
  const found = customs.find((c) => c.id === type);
  if (found) return { label: found.label, color: found.color };
  // 未找到: 回退到"其他"
  return { label: "未知关系", color: RELATION_TYPE_COLORS.other };
}

