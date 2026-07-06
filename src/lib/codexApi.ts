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
 * 创建新的 Codex 实体文件（.pmd 格式）
 * 输入:
 *   projectPath 项目根路径
 *   type 实体类型（决定写入哪个设定目录）
 *   name 实体名称（作为文件名与显示名）
 *   aliases 别名列表（可选，写入 front matter）
 *   content 正文内容（可选，纯文本，自动转换为 ProseMirror JSON）
 * 输出: Promise<string> 新建文件的相对路径
 * 流程:
 *   1. 根据 type 解析目标目录名
 *   2. 生成 UUID 作为实体唯一标识
 *   3. 构造 CodexMeta front matter（含新字段 summary/tags/avatar/sort_order/updated_at）
 *   4. 将纯文本正文转换为 ProseMirror JSON
 *   5. 组合为 .pmd 文件内容（front matter + ProseMirror JSON）
 *   6. 调用 createFile 创建 .pmd 文件
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
  // 生成 .pmd 文件（设定文件统一格式：front matter + ProseMirror JSON）
  const relativePath = `${dirName}/${safeName}.pmd`;
  // 构造 CodexMeta 元数据（含 Sprint 1 新增字段）
  const now = new Date().toISOString();
  const meta: CodexMeta = {
    id: generateCodexUuid(),
    name: safeName,
    aliases,
    entity_type: type,
    created: now,
    summary: "",
    tags: [],
    avatar: null,
    sort_order: 0,
    updated_at: now,
  };
  // 构造 ProseMirror JSON 正文（空文档或含初始内容）
  const pmdContent = content
    ? convertTextToPmd(content)
    : '{"type":"doc","content":[{"type":"paragraph"}]}';
  // 组合 .pmd 文件内容：front matter + ProseMirror JSON
  const fileContent = `---\n${JSON.stringify(meta)}\n---\n${pmdContent}`;
  return createFile(projectPath, relativePath, fileContent);
}

/**
 * 删除 Codex 实体文件
 * 输入:
 *   projectPath 项目根路径
 *   sourceFile 待删除实体的来源文件相对路径（CodexCard.sourceFile 或 CodexEntity.sourceFile）
 * 输出: Promise<void>
 * 流程: 调用 deletePath 删除源文件（后端会移至回收站）
 */
export async function deleteCodexEntity(
  projectPath: string,
  sourceFile: string
): Promise<void> {
  // 源文件为相对路径，需拼接为绝对路径
  const sep = navigator.platform.toLowerCase().includes("win") ? "\\" : "/";
  const absPath = `${projectPath}${sep}${sourceFile.replace(/[\\/]/g, sep)}`;
  return deletePath(absPath, projectPath);
}

// ===== 结构化设定实体（阶段 1：JSON front matter） =====

/**
 * 设定文件元数据（与后端 CodexMeta 结构对应）
 * 存储于设定文件首部 JSON front matter 中
 */
export interface CodexMeta {
  /** 实体唯一标识（UUID v4） */
  id: string;
  /** 实体显示名 */
  name: string;
  /** 别名列表 */
  aliases: string[];
  /** 实体类型：character / worldview / glossary / material
   *  注：对应方案中的 card_type，保留 entity_type 以向后兼容旧 front matter */
  entity_type: string;
  /** 创建时间（ISO 8601） */
  created: string;
  /** 一句话简介（用于 Hover 预览和 AI 快速读取） */
  summary?: string;
  /** 标签数组（如 ["主角","骑士"]） */
  tags?: string[];
  /** 头像/图标 URL（可选） */
  avatar?: string | null;
  /** 排序权重（数字越小越靠前，默认 0） */
  sort_order?: number;
  /** 更新时间（ISO 8601 格式） */
  updated_at?: string;
}

/**
 * 结构化设定实体（与后端 CodexEntity 结构对应）
 * 包含完整元数据 + 正文内容 + 来源路径
 */
export interface StructuredCodexEntity {
  /** 元数据（front matter 解析结果） */
  meta: CodexMeta;
  /** 来源文件相对路径 */
  source_file: string;
  /** 正文内容（已剥离 front matter） */
  content: string;
}

/**
 * 扫描设定目录，返回结构化设定实体列表
 * 输入: projectPath 项目根路径
 * 输出: Promise<StructuredCodexEntity[]> 实体列表（按类型分组后按名称排序）
 * 流程: 调用后端 list_codex_entities 命令，统一扫描设定目录 + 兼容旧版目录
 * 设计说明:
 *   - 标准目录为"设定"，兼容旧版的 角色/人物/世界观/术语/名词/素材/资料
 *   - 每个文件解析 JSON front matter，无 front matter 的旧文件自动生成默认元数据
 *   - 返回的实体可直接用于 CodexPanel 展示与跨面板联动
 */
export async function listCodexEntities(
  projectPath: string
): Promise<StructuredCodexEntity[]> {
  return invoke<StructuredCodexEntity[]>("list_codex_entities", { projectPath });
}

/**
 * 为旧版设定文件注入 JSON front matter（迁移工具）
 * 输入: projectPath 项目根路径
 * 输出: Promise<number> 迁移的文件数量
 * 流程: 调用后端 inject_codex_front_matter 命令
 * 设计说明:
 *   - 扫描所有兼容目录下的 .txt 文件
 *   - 对无 front matter 的文件，解析旧格式并注入 front matter
 *   - 原子写入保证文件完整性
 *   - 已有 front matter 的文件跳过，避免重复注入
 */
export async function injectCodexFrontMatter(
  projectPath: string
): Promise<number> {
  return invoke<number>("inject_codex_front_matter", { projectPath });
}

// ===== Sprint 1 新增：CodexCard 类型与辅助函数 =====

/**
 * Codex 卡片（前端全局 Store 使用的扁平结构）
 * 由 StructuredCodexEntity 转换而来，供 useCodexStore 统一管理
 */
export interface CodexCard {
  /** 实体唯一标识（UUID v4，来自 CodexMeta.id） */
  id: string;
  /** 卡片名称（来自 CodexMeta.name） */
  name: string;
  /** 卡片类型（来自 CodexMeta.entity_type） */
  cardType: CodexEntityType;
  /** 别名列表 */
  aliases: string[];
  /** 一句话简介（用于 Hover 预览和 AI 上下文） */
  summary: string;
  /** 标签数组 */
  tags: string[];
  /** 头像/图标 URL */
  avatar: string | null;
  /** 排序权重 */
  sortOrder: number;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 更新时间（ISO 8601） */
  updatedAt: string;
  /** 来源文件相对路径（.pmd 文件路径） */
  sourceFile: string;
  /** 正文内容（ProseMirror JSON 字符串，供 TipTap 编辑器加载） */
  content: string;
}

/**
 * 生成 UUID v4（优先使用浏览器原生 crypto.randomUUID，不可用时降级为手动生成）
 * 输入: 无
 * 输出: string UUID v4 格式字符串
 * 流程:
 *   1. 检测 crypto.randomUUID 是否可用
 *   2. 可用则直接调用
 *   3. 不可用则手动生成（Math.random 降级方案）
 */
function generateCodexUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // 降级方案：手动生成 UUID v4
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 将纯文本转换为 ProseMirror JSON 文档字符串
 * 输入: text 纯文本内容
 * 输出: string ProseMirror JSON 字符串（每行一个 paragraph）
 * 流程:
 *   1. 按换行符分割文本（兼容 CRLF 与 LF）
 *   2. 非空行转为含 text 节点的 paragraph
 *   3. 空行转为空 paragraph
 *   4. 包装为 doc 根节点并序列化
 * 设计说明: 与后端 convert_codex_text_to_pmd 函数逻辑一致，保证前后端转换结果相同
 */
export function convertTextToPmd(text: string): string {
  const content: object[] = [];
  for (const line of text.split("\n").map((l) => l.replace(/\r$/, ""))) {
    if (line === "") {
      content.push({ type: "paragraph" });
    } else {
      content.push({
        type: "paragraph",
        content: [{ type: "text", text: line }],
      });
    }
  }
  if (content.length === 0) {
    content.push({ type: "paragraph" });
  }
  const doc = { type: "doc", content };
  return JSON.stringify(doc);
}

/**
 * 将 StructuredCodexEntity 转换为 CodexCard
 * 输入: entity 后端返回的结构化实体
 * 输出: CodexCard 前端 Store 使用的扁平结构
 * 流程:
 *   1. 从 meta 提取字段，应用默认值（兼容旧文件缺失新字段的情况）
 *   2. 映射 entity_type 为 CodexEntityType 枚举
 *   3. 返回扁平化的 CodexCard 对象
 */
export function toCodexCard(entity: StructuredCodexEntity): CodexCard {
  const meta = entity.meta;
  // 类型映射：未知类型降级为 material（素材）以避免前端渲染崩溃
  const cardType = (
    ["character", "worldview", "glossary", "material"].includes(meta.entity_type)
      ? meta.entity_type
      : "material"
  ) as CodexEntityType;

  return {
    id: meta.id,
    name: meta.name,
    cardType,
    aliases: meta.aliases ?? [],
    summary: meta.summary ?? "",
    tags: meta.tags ?? [],
    avatar: meta.avatar ?? null,
    sortOrder: meta.sort_order ?? 0,
    createdAt: meta.created,
    updatedAt: meta.updated_at ?? meta.created,
    sourceFile: entity.source_file,
    content: entity.content,
  };
}

// ===== Sprint 2 任务 2.2：单卡片更新 API =====

/**
 * 元数据补丁类型（与后端 CodexMetaPatch 对应）
 * 所有字段可选：undefined 表示不更新，null（仅 avatar）表示清空
 */
export interface CodexMetaPatch {
  name?: string;
  aliases?: string[];
  entity_type?: string;
  summary?: string;
  tags?: string[];
  avatar?: string | null;
  sort_order?: number;
}

/**
 * 更新单个设定卡片（调用后端 update_codex_entity 命令）
 * 输入:
 *   projectPath 项目根路径
 *   sourceFile 卡片来源文件相对路径（如 "角色/亚瑟.pmd"）
 *   metaPatch 元数据补丁（仅含待更新字段）
 *   content 正文内容（ProseMirror JSON 字符串，空字符串表示不更新正文）
 * 输出: Promise<CodexMeta> 更新后的完整元数据
 * 流程:
 *   1. 序列化 metaPatch 为 JSON 字符串
 *   2. 调用后端 update_codex_entity 命令
 *   3. 后端处理：合并补丁、更新时间戳、必要时重命名文件、原子写入
 *   4. 返回更新后的完整 CodexMeta
 * 设计说明:
 *   - name 变更时后端会重命名文件，返回的 meta.name 为新名称
 *   - 前端据返回的 meta 更新 Store 中的卡片信息
 */
export async function updateCodexEntity(
  projectPath: string,
  sourceFile: string,
  metaPatch: CodexMetaPatch,
  content: string = ""
): Promise<CodexMeta> {
  const metaPatchJson = JSON.stringify(metaPatch);
  return invoke<CodexMeta>("update_codex_entity", {
    projectPath,
    sourceFile,
    metaPatch: metaPatchJson,
    content,
  });
}

// ===== Sprint 2 任务 2.5：删除失效检测 API =====

/**
 * 失效提及位置（单文件维度）
 * 对应后端 InvalidMention 结构体
 */
export interface InvalidMention {
  /** 文件相对路径（相对于项目根，含"正文/"前缀） */
  file_path: string;
  /** 文件名（含扩展名） */
  file_name: string;
  /** 该文件中引用该卡片的 characterMentionNode 数量 */
  count: number;
}

/**
 * 扫描正文中引用指定卡片的 characterMentionNode 数量
 * 输入:
 *   projectPath 项目根路径
 *   cardId 待检测的卡片 UUID
 * 输出: Promise<InvalidMention[]> 引用该卡片的文件列表（按数量降序）
 * 流程: 调用后端 scan_invalid_mentions 命令，递归扫描正文 .pmd 文件
 * 设计说明:
 *   - 删除卡片前调用，返回值用于前端弹出失效提示
 *   - 仅扫描 .pmd 文件（characterMentionNode 仅存在于 ProseMirror JSON 中）
 *   - 返回空数组表示无引用，可安全删除
 */
export async function scanInvalidMentions(
  projectPath: string,
  cardId: string
): Promise<InvalidMention[]> {
  return invoke<InvalidMention[]>("scan_invalid_mentions", {
    projectPath,
    cardId,
  });
}

