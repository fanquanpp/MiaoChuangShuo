// src/lib/stores/customRelationStore.ts
//
// 自定义关系类型 Store 模块
// 从 characterGraphTypes.ts 拆分而来, 专注用户自定义关系类型的 localStorage 持久化。
//
// 模块职责:
//   1. 提供 loadCustomRelationTypes / addCustomRelationType / deleteCustomRelationType CRUD
//   2. 提供 getAllRelationTypes / getRelationMeta 查询接口(合并内置与自定义)
//   3. 持久化到 localStorage, 跨项目共享
//
// 设计说明:
//   - 类型定义(RelationType / CustomRelationType / RelationTypeMeta / 内置映射)保留在
//     characterGraphTypes.ts 中, 本模块仅 import 使用, 避免类型与逻辑耦合
//   - 内置关系类型元信息(BUILTIN_RELATION_TYPES)由 characterGraphTypes 维护,
//     本模块负责合并内置与自定义, 对外提供统一查询接口
//   - 所有函数保持原签名不变, 仅迁移位置, 调用方需更新 import 路径

import {
  type CustomRelationType,
  type RelationTypeMeta,
  type RelationType,
  BUILTIN_RELATION_TYPES,
  RELATION_TYPE_LABELS,
  RELATION_TYPE_COLORS,
} from "./characterGraphTypes";

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
  // 未找到: 回退到 i18n key 字符串,由消费方调用 t() 转换为本地化文案
  return { label: "characterGraph.relationUnknown", color: RELATION_TYPE_COLORS.other };
}
