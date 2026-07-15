// 项目级 manifest 统一索引 Service 层 API 封装
//
// 模块职责:
// 封装与后端 manifest.rs 的 Tauri invoke 调用,提供 manifest 读取、实体增删改、
// 章节删除联动清理等能力。所有 UI 层调用必经此模块,禁止直接 invoke。
//
// 设计说明:
// - manifest 是项目级统一索引,记录所有数据实体的 UUID 与 sourceFile 映射 + 反向索引
// - 反向索引支持 codexId/chapterId → 关联实体 ID 列表的反向查找
// - 章节删除联动清理(Task 4.3):调用 clean_chapter_reverse_indices 清理 manifest 层残留,
//   返回的 timeline_node_ids / graph_node_ids 由调用方联动清理各模块数据

import { invoke } from "@tauri-apps/api/core";

// ===== 类型定义 =====

/**
 * manifest 实体记录(与后端 ManifestEntity 结构对应)
 * 通过 extra 字段存储 volumeId / outlineId / order / wordCount 等扩展字段
 */
export interface ManifestEntity {
  /** 实体唯一标识(UUID v4) */
  id: string;
  /** 源文件相对路径(相对项目根,统一使用正斜杠) */
  source_file: string;
  /** 实体类型标识(如 "chapter" / "outline" / "codex" 等) */
  entity_type: string;
  /** 实体标题(可选,通常为文件名或卡片名) */
  title?: string;
  /** 扩展字段(可选,JSON 对象,存储 volumeId/outlineId/order/wordCount 等) */
  extra?: Record<string, unknown> | null;
}

/**
 * manifest 实体集合(6 种实体类型分组)
 */
export interface ManifestEntities {
  chapters: ManifestEntity[];
  outlines: ManifestEntity[];
  codex: ManifestEntity[];
  graph_nodes: ManifestEntity[];
  timeline_nodes: ManifestEntity[];
  foreshadowings: ManifestEntity[];
}

/**
 * manifest 反向索引(3 类反向引用关系)
 */
export interface ReverseIndex {
  /** codexId → 图谱节点 ID 列表 */
  codex_to_graph_nodes: Record<string, string[]>;
  /** codexId → 章节 ID 列表 */
  codex_to_chapters: Record<string, string[]>;
  /** chapterId → 时间线节点 ID 列表 */
  chapter_to_timeline_nodes: Record<string, string[]>;
}

/**
 * 顶层 manifest 结构
 */
export interface Manifest {
  schema_version: number;
  project_id: string;
  updated_at: string;
  entities: ManifestEntities;
  reverse_index: ReverseIndex;
}

/**
 * 章节删除联动清理结果(Task 4.3)
 * 后端清理 manifest 层残留后,返回需要前端联动清理的节点 ID 列表
 */
export interface ChapterCleanupResult {
  /** 被删除章节的实体 UUID(空字符串表示 manifest 中未找到对应记录) */
  chapter_id: string;
  /** 需要前端清理 chapterId 引用的时间线节点 ID 列表 */
  timeline_node_ids: string[];
  /** 需要前端清理 sourceFile 引用的人物图谱节点 ID 列表 */
  graph_node_ids: string[];
}

// ===== API 封装 =====

/**
 * 读取项目 manifest
 * 输入: projectPath 项目根路径
 * 输出: Promise<Manifest> manifest 对象(不存在时返回默认空 manifest)
 * 流程: 调用后端 get_manifest 命令
 */
export async function getManifest(projectPath: string): Promise<Manifest> {
  return invoke<Manifest>("get_manifest", { projectPath });
}

/**
 * 更新 manifest 实体(增/删/改)
 * 输入:
 *   projectPath 项目根路径
 *   entityType 实体类型字符串
 *   entity 实体记录
 *   action 操作类型:"add" / "remove" / "update"
 * 输出: Promise<void>
 */
export async function updateManifestEntity(
  projectPath: string,
  entityType: string,
  entity: ManifestEntity,
  action: "add" | "remove" | "update"
): Promise<void> {
  return invoke<void>("update_manifest_entity", {
    projectPath,
    entityType,
    entity,
    action,
  });
}

/**
 * 清理章节删除后残留的反向索引与 manifest 实体记录(Task 4.3)
 * 输入:
 *   projectPath 项目根路径
 *   chapterSourceFile 被删除章节的 source_file 路径(相对项目根,正斜杠格式)
 * 输出: Promise<ChapterCleanupResult> 清理结果,包含需要前端联动清理的节点 ID 列表
 * 流程: 调用后端 clean_chapter_reverse_indices 命令
 * 设计说明:
 *   - 后端只清理 manifest 层数据,前端据返回的 ID 列表联动清理 timeline.json / graph.json
 *   - 幂等:manifest 中无对应记录时返回空数组,允许重复调用
 */
export async function cleanChapterReverseIndices(
  projectPath: string,
  chapterSourceFile: string
): Promise<ChapterCleanupResult> {
  return invoke<ChapterCleanupResult>("clean_chapter_reverse_indices", {
    projectPath,
    chapterSourceFile,
  });
}
