// 大纲章节同步检测(Task 4.8.2)
//
// 功能概述:
// 大纲文件保存后,检测其 manifest 实体的 extra.chapterId 字段,
// 若已关联章节,通过 toast 提示用户可同步章节标题。
//
// 模块职责:
// 1. 判断保存的文件是否为大纲 .pmd 文件
// 2. 查询 manifest 获取大纲实体的 chapterId 关联状态
// 3. 若已关联章节,显示 info toast 提示用户
//
// 设计说明:
//   - 此模块为纯函数,不依赖 React 生命周期,由 useEditorFileIO 在保存成功后调用
//   - showToast 与 t 通过参数注入,保持与 useEditorFileIO 的依赖注入风格一致
//   - 检测失败静默处理,绝不影响保存主流程

import { invoke } from "@tauri-apps/api/core";
import type { ToastType } from "../lib/toast";

// ===== 类型定义 =====

/** Toast 提示函数类型(与 useToast 的 showToast 对齐) */
type ShowToastFn = (type: ToastType, message: string, duration?: number) => void;

/** 翻译函数类型(与 i18n 的 t 函数对齐) */
type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/** manifest 扩展字段(仅声明检测所需字段,后端 extra 为 serde_json::Value) */
interface ManifestExtra {
  /** 关联章节 ID(后端使用字符串 "null" 表示未关联) */
  chapterId?: string;
}

/** manifest 实体类型(仅取检测所需字段,避免引入完整类型) */
interface ManifestEntity {
  /** 实体唯一标识(UUID v4) */
  id: string;
  /** 源文件相对路径(正斜杠格式) */
  sourceFile: string;
  /** 实体类型标识 */
  entityType: string;
  /** 实体标题(可选) */
  title?: string;
  /** 扩展字段(可选) */
  extra?: ManifestExtra;
}

/** manifest 快照类型(仅取检测所需字段) */
interface ManifestSnapshot {
  /** 实体集合 */
  entities: {
    /** 章节实体列表 */
    chapters: ManifestEntity[];
    /** 大纲实体列表 */
    outlines: ManifestEntity[];
  };
}

// ===== 常量 =====

/** 默认大纲目录名(与后端 project_template.rs 默认值一致) */
const DEFAULT_OUTLINE_DIR = "大纲";

// ===== 工具函数 =====

/**
 * 判断文件路径是否位于大纲目录下(前端侧判断,使用默认大纲目录名)
 * 输入: filePath 文件绝对路径, projectPath 项目根路径
 * 输出: boolean 是否为大纲 .pmd 文件
 * 流程: 路径前缀匹配大纲目录 + 扩展名为 .pmd
 */
function isOutlineFile(filePath: string, projectPath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const prefix =
    projectPath.replace(/\\/g, "/").replace(/\/$/, "") +
    "/" +
    DEFAULT_OUTLINE_DIR +
    "/";
  return normalized.startsWith(prefix) && normalized.endsWith(".pmd");
}

/**
 * 将绝对路径转换为项目相对路径(正斜杠格式)
 * 输入: filePath 文件绝对路径, projectPath 项目根路径
 * 输出: string 相对路径(如 "大纲/第一章.pmd")
 */
function toRelativePath(filePath: string, projectPath: string): string {
  const normalizedProject = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedFile = filePath.replace(/\\/g, "/");
  return normalizedFile.startsWith(normalizedProject + "/")
    ? normalizedFile.slice(normalizedProject.length + 1)
    : normalizedFile;
}

// ===== 核心检测函数 =====

/**
 * 大纲 chapterId 同步检测(Task 4.8.2)
 * 在大纲文件保存后调用,检测其 manifest 实体是否已关联章节,
 * 若已关联则通过 toast 提示用户可同步章节标题
 *
 * 输入:
 *   filePath - 刚保存的大纲文件绝对路径
 *   projectPath - 当前项目根路径
 *   showToast - Toast 提示函数
 *   t - i18n 翻译函数
 * 输出: Promise<void>
 * 流程:
 *   1. 判断文件是否为大纲 .pmd 文件(路径前缀 + 扩展名)
 *   2. 调用 get_manifest 命令获取项目 manifest
 *   3. 在 outlines 实体中按 sourceFile 匹配找到该大纲实体
 *   4. 检查 extra.chapterId 是否为有效值(非 null/非 "null" 字符串)
 *   5. 若有效,在 chapters 实体中找到关联章节,显示 info toast 提示
 * 设计说明:
 *   - 使用默认大纲目录名 "大纲",不额外请求 ProjectMeta(绝大多数项目使用默认目录)
 *   - 后端在 create_file 时注入 chapterId: "null" 表示未关联,前端需识别此约定
 *   - 检测失败静默处理,不影响保存流程
 */
export async function checkOutlineChapterSync(
  filePath: string,
  projectPath: string,
  showToast: ShowToastFn,
  t: TranslateFn,
): Promise<void> {
  try {
    // 步骤 1: 判断是否为大纲文件
    if (!isOutlineFile(filePath, projectPath)) return;

    // 步骤 2: 获取 manifest
    const manifest = await invoke<ManifestSnapshot>("get_manifest", { projectPath });

    // 步骤 3: 计算相对路径并匹配大纲实体
    const relPath = toRelativePath(filePath, projectPath);
    const outlineEntity = manifest.entities.outlines.find(
      (o) => o.sourceFile === relPath,
    );
    if (!outlineEntity) return;

    // 步骤 4: 检查 chapterId 是否有效
    // 后端使用字符串 "null" 表示未关联,前端需识别此约定
    const chapterId = outlineEntity.extra?.chapterId;
    if (!chapterId || chapterId === "null") return;

    // 步骤 5: 查找关联章节并显示提示
    const chapterEntity = manifest.entities.chapters.find(
      (c) => c.id === chapterId,
    );
    if (!chapterEntity) return;

    showToast(
      "info",
      t("outline.syncPrompt", {
        title: chapterEntity.title ?? chapterEntity.sourceFile,
      }),
    );
  } catch {
    // 检测失败静默处理,不影响保存流程
  }
}
