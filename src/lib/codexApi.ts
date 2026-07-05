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
import { readProjectTree, createFile, deletePath, readFile } from "./api";
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
 * 从设定文件内容解析别名列表
 * 输入: content 文件内容字符串
 * 输出: string[] 别名列表（去重去空）
 * 流程:
 *   1. 按行分割文件内容
 *   2. 查找以"别名:"或"别名："开头的行（兼容中英文冒号与前后空白）
 *   3. 提取冒号后的内容，按逗号/中文逗号/顿号分割
 *   4. 清理每项空白并过滤空值
 */
function parseAliasesFromContent(content: string): string[] {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    // 匹配 "别名: A, B, C" 或 "别名：A、B、C" 格式（兼容中英文冒号）
    const match = trimmed.match(/^别名\s*[:：]\s*(.+)$/);
    if (match) {
      const aliasesStr = match[1];
      // 按英文逗号、中文逗号、顿号分割
      const aliases = aliasesStr
        .split(/[,，、]/)
        .map((a) => a.trim())
        .filter((a) => a.length > 0);
      return aliases;
    }
  }
  return [];
}

/**
 * 扫描项目下所有 Codex 实体文件
 * 输入: projectPath 项目根路径
 * 输出: Promise<CodexEntity[]> 实体列表（按类型分组后按名称排序）
 * 流程:
 *   1. 读取项目目录树
 *   2. 遍历 4 种 Codex 类型对应的目录
 *   3. 收集每个目录下的 .txt 文件作为实体
 *   4. 读取文件内容，解析首行"别名: A, B, C"格式填充 aliases 数组
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
        // 读取文件内容解析别名（首行"别名: A, B, C"格式）
        // 修复原"懒加载断链"问题：原代码注释标注懒加载但无实现，aliases 始终为空数组
        let aliases: string[] = [];
        try {
          const filePath = `${projectPath}/${file.relative_path}`;
          const content = await readFile(filePath, projectPath);
          aliases = parseAliasesFromContent(content);
        } catch {
          // 文件读取失败，别名留空，不影响实体扫描流程
        }
        entities.push({
          id,
          name: id,
          aliases,
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

// ===== 实体增删 API =====

/**
 * 解析实体类型对应的实际目录名
 * 输入: type 实体类型
 * 输出: 目录名字符串（取 CODEX_TYPE_DIRS 中第一个作为主目录名）
 * 流程: 查表返回主目录名，若不存在则回退到 "角色"
 */
export function getCodexDirName(type: CodexEntityType): string {
  return CODEX_TYPE_DIRS[type]?.[0] ?? "角色";
}

/**
 * 创建新的 Codex 实体文件
 * 输入:
 *   projectPath 项目根路径
 *   type 实体类型（决定写入哪个设定目录）
 *   name 实体名称（作为文件名与标题）
 *   aliases 别名列表（可选，写入文件首行"别名: A, B, C"格式）
 *   content 正文内容（可选，默认为空模板）
 * 输出: Promise<string> 新建文件的绝对路径
 * 流程:
 *   1. 根据 type 解析目标目录名
 *   2. 拼接相对路径 {目录名}/{name}.txt
 *   3. 生成文件内容（别名行 + 标题行 + 空模板）
 *   4. 调用 createFile 创建文件
 */
export async function createCodexEntity(
  projectPath: string,
  type: CodexEntityType,
  name: string,
  aliases: string[] = [],
  content: string = ""
): Promise<string> {
  const dirName = getCodexDirName(type);
  // 清理文件名：去除非法字符
  const safeName = name.replace(/[\\/:*?"<>|]/g, "").trim();
  if (!safeName) throw new Error("实体名称不能为空");
  const relativePath = `${dirName}/${safeName}.txt`;
  // 生成文件内容：别名行 + 标题 + 正文
  const aliasLine = aliases.length > 0 ? `别名: ${aliases.join(", ")}\n` : "";
  const titleLine = `# ${safeName}\n\n`;
  const fileContent = `${aliasLine}${titleLine}${content}`;
  return createFile(projectPath, relativePath, fileContent);
}

/**
 * 删除 Codex 实体文件
 * 输入:
 *   projectPath 项目根路径
 *   entity 待删除的实体对象
 * 输出: Promise<void>
 * 流程: 调用 deletePath 删除源文件（后端会移至回收站）
 */
export async function deleteCodexEntity(
  projectPath: string,
  entity: CodexEntity
): Promise<void> {
  // 源文件为相对路径，需拼接为绝对路径
  const sep = navigator.platform.toLowerCase().includes("win") ? "\\" : "/";
  const absPath = `${projectPath}${sep}${entity.sourceFile.replace(/[\\/]/g, sep)}`;
  return deletePath(absPath, projectPath);
}
