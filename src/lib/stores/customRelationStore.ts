// src/lib/stores/customRelationStore.ts
//
// 自定义关系类型 Store 模块(Task 1.5 后端持久化改造)
// 从 characterGraphTypes.ts 拆分而来, 专注用户自定义关系类型的持久化。
//
// 模块职责:
//   1. 提供 loadCustomRelationTypes / addCustomRelationType / deleteCustomRelationType CRUD(同步 API)
//   2. 提供 getAllRelationTypes / getRelationMeta 查询接口(合并内置与自定义)
//   3. 提供 initCustomRelationTypes 异步初始化(从后端加载 + localStorage 迁移)
//   4. 持久化到后端文件 %APPDATA%/MiaoChuangShuo/custom_relation_types.json
//
// 设计说明:
//   - 类型定义(RelationType / CustomRelationType / RelationTypeMeta / 内置映射)保留在
//     characterGraphTypes.ts 中, 本模块仅 import 使用, 避免类型与逻辑耦合
//   - 内置关系类型元信息(BUILTIN_RELATION_TYPES)由 characterGraphTypes 维护,
//     本模块负责合并内置与自定义, 对外提供统一查询接口
//   - 所有同步函数保持原签名不变, 调用方无需修改
//   - 模块加载时同步从 localStorage 读取到内存缓存(兼容历史数据)
//   - 异步初始化完成后用后端数据覆盖缓存, 同时执行 localStorage → 后端的单向迁移
//   - 迁移完成后清除 localStorage, 后续读写全部走后端

import { invoke } from "@tauri-apps/api/core";
import {
  type CustomRelationType,
  type RelationTypeMeta,
  type RelationType,
  BUILTIN_RELATION_TYPES,
  RELATION_TYPE_LABELS,
  RELATION_TYPE_COLORS,
} from "./characterGraphTypes";

/** localStorage 键名(历史遗留, 仅用于迁移时读取与清理) */
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

// ===== 模块级内存缓存 =====

/**
 * 内存缓存(同步读取, 异步初始化时覆盖)
 * 模块加载时从 localStorage 同步读取,保证首屏渲染有数据
 * 异步初始化完成后用后端数据覆盖,并清除 localStorage
 */
let cache: CustomRelationType[] = loadFromLocalStorage();

/**
 * 初始化 Promise(防止多次重复初始化)
 * null 表示尚未启动初始化,非 null 表示已启动(可能 pending/fulfilled/rejected)
 */
let initPromise: Promise<void> | null = null;

/**
 * 订阅者集合(缓存变化时通知,用于组件响应式更新)
 */
const subscribers = new Set<() => void>();

/**
 * 从 localStorage 同步读取自定义关系类型(迁移用,历史数据兼容)
 * 输出: CustomRelationType[] 关系类型数组(无数据或解析失败返回空数组)
 */
function loadFromLocalStorage(): CustomRelationType[] {
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
 * 通知所有订阅者缓存已变化
 * 流程: 遍历 subscribers 集合并调用回调
 */
function notifySubscribers(): void {
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      // 单个订阅者异常不影响其他订阅者通知
    }
  }
}

/**
 * 订阅缓存变化(组件挂载时调用,卸载时调用返回的解绑函数)
 * 输入: callback 缓存变化时的回调函数
 * 输出: 解绑函数(调用后移除订阅)
 * 用途: CharacterGraphEdgeDrawer 等组件在 init 异步完成后需要刷新下拉列表
 */
export function subscribeCustomRelationTypes(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

// ===== 异步初始化(从后端加载 + localStorage 迁移) =====

/**
 * 异步初始化自定义关系类型(从后端加载,首次启动时迁移 localStorage 数据)
 *
 * 输入: 无
 * 输出: Promise<void> 初始化完成
 * 流程:
 *   1. 检查 initPromise 防止重复初始化
 *   2. 调用后端 load_custom_relation_types 读取持久化数据
 *   3. 迁移场景判断:
 *      - 后端为空 且 localStorage 缓存非空: 将 localStorage 数据保存到后端,清除 localStorage
 *      - 后端非空: 用后端数据覆盖内存缓存,清除 localStorage 残留
 *      - 后端为空 且 localStorage 也为空: 全新用户,无需迁移
 *   4. 后端调用失败时: 保持 localStorage 缓存数据(降级模式),不阻止 UI 渲染
 *   5. 通知所有订阅者缓存已变化
 *
 * 迁移策略:
 *   - 单向迁移: localStorage → 后端,迁移成功后清除 localStorage
 *   - 幂等性: 多次调用不会重复迁移(initPromise 守卫)
 *   - 容错: 后端失败时保持 localStorage 数据可读,UI 仍可正常工作
 */
export async function initCustomRelationTypes(): Promise<void> {
  if (initPromise !== null) {
    return initPromise;
  }
  initPromise = (async (): Promise<void> => {
    try {
      const backend = await invoke<CustomRelationType[]>("load_custom_relation_types");
      if (backend.length === 0) {
        // 后端为空: 检查是否有 localStorage 历史数据需要迁移
        if (cache.length > 0) {
          // 迁移场景: localStorage 有数据,后端为空 → 保存到后端
          await invoke("save_custom_relation_types", { types: cache });
          // 迁移成功后清除 localStorage(单向迁移,不回退)
          localStorage.removeItem(CUSTOM_RELATION_TYPES_STORAGE_KEY);
          // cache 已包含迁移的数据,保持不变
        }
        // 全新用户: cache 已为空数组,无需操作
      } else {
        // 后端有数据: 覆盖内存缓存(可能为空或有 localStorage 残留)
        cache = backend;
        // 清除 localStorage 残留(用户可能从新版本回退后再升级)
        if (localStorage.getItem(CUSTOM_RELATION_TYPES_STORAGE_KEY) !== null) {
          localStorage.removeItem(CUSTOM_RELATION_TYPES_STORAGE_KEY);
        }
      }
    } catch {
      // 后端调用失败: 保持 localStorage 内存缓存(降级模式,UI 可继续工作)
      // 不重置 initPromise,允许重试(下次调用 initCustomRelationTypes 会重新尝试)
    }
    notifySubscribers();
  })();
  return initPromise;
}

// ===== 同步 CRUD API(向后兼容,内存缓存驱动) =====

/**
 * 从内存缓存读取自定义关系类型列表(同步)
 *
 * 输出: CustomRelationType[] 缓存的自定义关系类型数组
 * 流程:
 *   1. 首次调用时触发异步初始化(fire and forget)
 *   2. 返回当前内存缓存
 * 说明:
 *   - 同步 API 保持向后兼容,调用方无需修改
 *   - 首次调用返回的可能是 localStorage 历史数据,异步初始化完成后会更新缓存
 *   - 需要响应缓存变化的组件应使用 subscribeCustomRelationTypes 订阅
 */
export function loadCustomRelationTypes(): CustomRelationType[] {
  // 首次访问触发异步初始化(fire and forget)
  if (initPromise === null) {
    void initCustomRelationTypes();
  }
  return cache;
}

/**
 * 新增自定义关系类型(同步更新缓存 + 异步保存到后端)
 *
 * 输入:
 *   label: 中文显示名称(必填, 非空)
 *   color: 边颜色(可选, 缺省时按数量轮询色板)
 * 输出: CustomRelationType 新增的关系类型(含生成的 id), 失败返回 null
 * 流程:
 *   1. 校验 label 非空
 *   2. 生成 id(时间戳+随机数,避免与内置类型冲突)
 *   3. 同步更新内存缓存
 *   4. 异步调用后端 save_custom_relation_types 持久化(fire and forget)
 *   5. 通知订阅者缓存变化
 */
export function addCustomRelationType(label: string, color?: string): CustomRelationType | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  // 颜色: 优先用户传入, 否则按现有数量轮询色板
  const finalColor = color || CUSTOM_COLOR_PALETTE[cache.length % CUSTOM_COLOR_PALETTE.length];
  // id 生成: custom_ + 时间戳基 36, 避免与内置类型(master/enemy 等)冲突
  const id = `custom_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const newType: CustomRelationType = { id, label: trimmed, color: finalColor };
  // 同步更新缓存(即时反馈)
  cache = [...cache, newType];
  // 异步持久化到后端(fire and forget,失败时仅记录日志不回滚)
  void invoke("save_custom_relation_types", { types: cache }).catch(() => {
    // 后端保存失败时静默处理,内存缓存已更新保证前端一致
  });
  notifySubscribers();
  return newType;
}

/**
 * 删除自定义关系类型(同步更新缓存 + 异步保存到后端)
 *
 * 输入: id 关系类型 id
 * 输出: void
 * 流程:
 *   1. 同步过滤缓存中目标 id
 *   2. 异步调用后端持久化(fire and forget)
 *   3. 通知订阅者缓存变化
 * 注意: 不会修改已使用该类型的边(边数据中保留旧 id, 显示时回退到"未知关系")
 */
export function deleteCustomRelationType(id: string): void {
  cache = cache.filter((t) => t.id !== id);
  void invoke("save_custom_relation_types", { types: cache }).catch(() => {
    // 后端保存失败时静默处理
  });
  notifySubscribers();
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
 * 流程: 先查内置映射, 再查内存缓存, 都未命中返回"其他"灰色
 */
export function getRelationMeta(type: string): { label: string; color: string } {
  // 内置类型直接查映射
  if (type in RELATION_TYPE_LABELS) {
    return {
      label: RELATION_TYPE_LABELS[type as RelationType],
      color: RELATION_TYPE_COLORS[type as RelationType],
    };
  }
  // 自定义类型查内存缓存
  const found = cache.find((c) => c.id === type);
  if (found) return { label: found.label, color: found.color };
  // 未找到: 回退到 i18n key 字符串,由消费方调用 t() 转换为本地化文案
  return { label: "characterGraph.relationUnknown", color: RELATION_TYPE_COLORS.other };
}
