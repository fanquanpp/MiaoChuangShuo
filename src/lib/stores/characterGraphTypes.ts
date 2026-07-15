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
 *
 * 类型形式说明:
 *   使用 type 别名(而非 interface)声明, TypeScript 会为 type 别名对象类型
 *   推导隐式索引签名, 使本类型满足 `Record<string, unknown>` 约束,
 *   从而兼容 @xyflow/react v12 的 `Node<NodeData extends Record<string, unknown>>` 泛型,
 *   无需显式声明 `[key: string]: unknown` 索引签名(遵守项目禁用 unknown 规则)。
 *
 * Task 4.1.1: 新增 codexId 字段(UUID), 作为节点与设定库卡片的强关联主键,
 *             替代旧版仅依赖 sourceFile 字符串路径的弱关联方式, 解决数据孤岛问题。
 *             保留 sourceFile 用于抽屉中的只读显示, codexId 为业务联动主键。
 */
export type CharacterGraphNodeData = {
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
  /**
   * 关联的角色设定文件相对路径(可选, 用于抽屉只读显示)
   * 注: 业务联动主键已迁移至 codexId, 此字段仅保留用于 UI 展示与旧数据兼容
   */
  sourceFile: string;
  /**
   * 关联的设定库卡片 UUID(Task 4.1.1 新增)
   * 作为节点与设定库卡片的强关联主键, 通过 manifest 反向索引实现双向联动。
   * 空字符串表示未关联(旧数据迁移时由后端通过 sourceFile 反查 manifest 填充)。
   */
  codexId: string;
  /** 创建时间 ISO 8601 */
  createdAt: string;
  /** 最后修改时间 ISO 8601 */
  updatedAt: string;
};

/**
 * React Flow 节点基类型(去掉 data/type, 用业务类型替换)
 * 使用 Omit 模式将 data 字段替换为业务类型 CharacterGraphNodeData,
 * 将 type 字段收窄为字面量 "characterNode", 保留 React Flow 节点其他属性。
 * CharacterGraphNodeData 使用 type 别名声明, 具备隐式索引签名,
 * 满足 Node<NodeData extends Record<string, unknown>> 泛型约束。
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
 * 关系类型对应的 i18n key(用于 UI 显示,由消费方调用 t() 转换为本地化文案)
 * 参照 timelineTypes.ts::NODE_STATUS_MAP 的 i18n key 模式,
 * 消费方需通过 t(label) 渲染;自定义关系类型的 label 为用户输入文本,
 * t() 找不到 key 时原样返回,兼容两种场景。
 */
export const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  master: "characterGraph.relation.master",
  enemy: "characterGraph.relation.enemy",
  family: "characterGraph.relation.family",
  friend: "characterGraph.relation.friend",
  lover: "characterGraph.relation.lover",
  subordinate: "characterGraph.relation.subordinate",
  fellow: "characterGraph.relation.fellow",
  other: "characterGraph.relation.other",
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

// ===== 自定义关系类型 CRUD 已迁移至 src/lib/stores/customRelationStore.ts =====
// 此处通过 re-export 保留入口, 保持向后兼容, 调用方可继续从本模块导入
// 真正实现在 customRelationStore.ts, 不再混入类型定义文件
// Task 1.5: 后端持久化改造,新增 initCustomRelationTypes(异步初始化) 与 subscribeCustomRelationTypes(订阅缓存变化)
export {
  loadCustomRelationTypes,
  addCustomRelationType,
  deleteCustomRelationType,
  getAllRelationTypes,
  getRelationMeta,
  initCustomRelationTypes,
  subscribeCustomRelationTypes,
} from "./customRelationStore";

