// 智能设定库（Codex）前端 API 封装
//
// 功能概述：
// 封装与后端 codex_commands.rs 的 Tauri invoke 调用，提供实体出现追踪能力。
// 配合 CodexPanel 组件实现"实体列表 + 出现位置追踪"的可视化设定库。
//
// 模块职责：
// 1. 定义 EntityMention / CodexEntity 类型
// 2. 封装 scanEntityMentions / batchScanEntities API
// 3. 提供设定库目录扫描辅助函数

import { invoke } from "@tauri-apps/api/core";
import { readProjectTree } from "./api";
import type { FileNode } from "./api";

// ===== 类型定义 =====

/**
 * 实体出现记录
 * 对应后端 EntityMention 结构体
 */
export interface EntityMention {
  // 相对项目根的文件路径
  file_path: string;
  // 文件名（带扩展）
  file_name: string;
  // 在该文件中的出现次数
  count: number;
  // 首次出现的上下文预览
  preview: string;
}

/**
 * Codex 实体定义
 * 前端聚合结构：实体名 + 别名 + 来源文件 + 出现追踪
 */
export interface CodexEntity {
  // 实体唯一标识（文件名去扩展）
  id: string;
  // 实体显示名（文件标题）
  name: string;
  // 别名列表（从文件内容解析，逗号分隔）
  aliases: string[];
  // 实体类型（character/worldview/glossary/material）
  type: CodexEntityType;
  // 来源文件相对路径
  sourceFile: string;
  // 出现追踪结果（懒加载，未扫描时为 null）
  mentions: EntityMention[] | null;
  // 总出现次数（懒加载，未扫描时为 0）
  totalCount: number;
}

/**
 * Codex 实体类型枚举
 * 对应原 characters/worldview/glossary/materials 分类
 */
export type CodexEntityType = "character" | "worldview" | "glossary" | "material";

/**
 * Codex 实体类型显示名映射
 */
export const CODEX_TYPE_LABELS: Record<CodexEntityType, string> = {
  character: "角色",
  worldview: "世界观",
  glossary: "术语",
  material: "素材",
};

/**
 * Codex 实体类型对应目录名
 * 兼容多种历史命名（角色/人物、世界观/设定、术语/名词、素材/资料）
 */
export const CODEX_TYPE_DIRS: Record<CodexEntityType, string[]> = {
  character: ["角色", "人物"],
  worldview: ["世界观", "设定"],
  glossary: ["术语", "名词"],
  material: ["素材", "资料"],
};

// ===== API 封装 =====

/**
 * 扫描单个实体在正文中的出现位置
 * 输入:
 *   projectPath 项目根路径
 *   entityName 实体名称
 *   aliases 别名列表（可选）
 * 输出: Promise<EntityMention[]> 出现记录列表（按出现次数降序）
 * 流程: 调用后端 scan_entity_mentions 命令，递归扫描正文目录
 */
export async function scanEntityMentions(
  projectPath: string,
  entityName: string,
  aliases: string[] = []
): Promise<EntityMention[]> {
  return invoke<EntityMention[]>("scan_entity_mentions", {
    projectPath,
    entityName,
    aliases: aliases.length > 0 ? aliases : null,
  });
}

/**
 * 批量扫描多个实体在正文中的出现位置
 * 输入:
 *   projectPath 项目根路径
 *   entities 实体列表，每项为 [实体名, 别名列表]
 * 输出: Promise<[实体名, 总次数, 出现记录列表][]> 按总次数降序
 * 流程: 调用后端 batch_scan_entities 命令
 */
export async function batchScanEntities(
  projectPath: string,
  entities: Array<[string, string[]]>
): Promise<Array<[string, number, EntityMention[]]>> {
  return invoke<Array<[string, number, EntityMention[]]>>("batch_scan_entities", {
    projectPath,
    entities,
  });
}

// ===== 设定库目录扫描辅助 =====

/**
 * 扫描项目下所有 Codex 实体文件
 * 输入: projectPath 项目根路径
 * 输出: Promise<CodexEntity[]> 实体列表（按类型分组后按名称排序）
 * 流程:
 *   1. 读取项目目录树
 *   2. 遍历 4 种 Codex 类型对应的目录
 *   3. 收集每个目录下的 .txt 文件作为实体
 *   4. 解析文件内容提取别名（首行"别名: A, B, C"格式）
 */
export async function scanCodexEntities(projectPath: string): Promise<CodexEntity[]> {
  const tree = await readProjectTree(projectPath);
  const entities: CodexEntity[] = [];

  for (const [entityType, dirNames] of Object.entries(CODEX_TYPE_DIRS)) {
    const type = entityType as CodexEntityType;
    for (const dirName of dirNames) {
      const dir = tree.find((n: FileNode) => n.is_dir && n.name === dirName);
      if (!dir || !dir.children) continue;
      for (const file of dir.children) {
        if (file.is_dir) continue;
        if (!file.name.endsWith(".txt")) continue;
        const id = file.name.replace(/\.txt$/i, "");
        // 暂不读取文件内容，别名留空，由 CodexPanel 在选中时懒加载解析
        entities.push({
          id,
          name: id,
          aliases: [],
          type,
          sourceFile: file.relative_path,
          mentions: null,
          totalCount: 0,
        });
      }
    }
  }

  // 按类型分组，组内按名称排序
  const typeOrder: CodexEntityType[] = ["character", "worldview", "glossary", "material"];
  entities.sort((a, b) => {
    const ta = typeOrder.indexOf(a.type);
    const tb = typeOrder.indexOf(b.type);
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name, "zh-CN");
  });

  return entities;
}
