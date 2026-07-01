// 场景化叙事工作台前端 API 封装
//
// 功能概述：
// 封装与后端 scene_commands.rs 的 Tauri invoke 调用，提供场景元数据管理能力。
// 配合 SceneWorkbench 组件实现 yWriter 风格的场景字段编辑。
//
// 模块职责：
// 1. 定义 SceneMeta / SceneFileMeta 类型
// 2. 封装 listScenes / saveScenes / updateSceneField / listSceneFiles API
// 3. 提供场景字段标签映射

import { invoke } from "@tauri-apps/api/core";

// ===== 类型定义 =====

/**
 * 场景元数据
 * 对应后端 SceneMeta 结构体
 */
export interface SceneMeta {
  // 场景唯一标识（scene-1, scene-2...）
  id: string;
  // 场景标题（从 `## 场景N：标题` 解析）
  title: string;
  // 场景序号（1-based）
  index: number;
  // 视点（Viewpoint）：叙述视角角色
  viewpoint: string;
  // 目标（Goal）：角色想要达成的目标
  goal: string;
  // 冲突（Conflict）：阻碍目标的力量
  conflict: string;
  // 结果（Outcome）：成功/失败/灾难/妥协
  outcome: string;
  // 场景备注
  notes: string;
}

/**
 * 章节文件的场景元数据集合
 */
export interface SceneFileMeta {
  // 文件相对路径
  file_path: string;
  // 场景列表
  scenes: SceneMeta[];
}

// ===== 场景字段配置 =====

/**
 * 场景字段定义
 */
export interface SceneFieldDef {
  // 字段 key
  key: keyof Pick<SceneMeta, "viewpoint" | "goal" | "conflict" | "outcome" | "notes">;
  // 字段显示名
  label: string;
  // 字段占位提示
  placeholder: string;
}

/**
 * 场景字段配置列表
 * 对应 yWriter 的 4 核心字段 + 备注
 */
export const SCENE_FIELDS: SceneFieldDef[] = [
  { key: "viewpoint", label: "视点", placeholder: "叙述视角角色（如：主角张三）" },
  { key: "goal", label: "目标", placeholder: "场景中角色想要达成的目标" },
  { key: "conflict", label: "冲突", placeholder: "阻碍目标达成的对抗力量" },
  { key: "outcome", label: "结果", placeholder: "场景结束状态（成功/失败/灾难/妥协）" },
  { key: "notes", label: "备注", placeholder: "场景备注（可选）" },
];

// ===== API 封装 =====

/**
 * 列出章节文件中的场景（解析标记 + 合并已保存元数据）
 * 输入:
 *   projectPath 项目根路径
 *   filePath 文件相对路径
 * 输出: Promise<SceneFileMeta> 场景元数据集合
 * 流程: 调用后端 list_scenes 命令
 */
export async function listScenes(
  projectPath: string,
  filePath: string
): Promise<SceneFileMeta> {
  return invoke<SceneFileMeta>("list_scenes", { projectPath, filePath });
}

/**
 * 保存单个文件的场景元数据
 * 输入:
 *   projectPath 项目根路径
 *   filePath 文件相对路径
 *   scenes 场景列表
 * 输出: Promise<void>
 * 流程: 调用后端 save_scenes 命令
 */
export async function saveScenes(
  projectPath: string,
  filePath: string,
  scenes: SceneMeta[]
): Promise<void> {
  return invoke<void>("save_scenes", { projectPath, filePath, scenes });
}

/**
 * 更新单个场景的字段
 * 输入:
 *   projectPath 项目根路径
 *   filePath 文件相对路径
 *   sceneId 场景 ID
 *   fieldName 字段名
 *   value 新值
 * 输出: Promise<SceneFileMeta> 更新后的完整元数据
 * 流程: 调用后端 update_scene_field 命令
 */
export async function updateSceneField(
  projectPath: string,
  filePath: string,
  sceneId: string,
  fieldName: string,
  value: string
): Promise<SceneFileMeta> {
  return invoke<SceneFileMeta>("update_scene_field", {
    projectPath,
    filePath,
    sceneId,
    fieldName,
    value,
  });
}

/**
 * 列出项目中所有有场景元数据的文件
 * 输入: projectPath 项目根路径
 * 输出: Promise<string[]> 文件相对路径列表
 * 流程: 调用后端 list_scene_files 命令
 */
export async function listSceneFiles(projectPath: string): Promise<string[]> {
  return invoke<string[]>("list_scene_files", { projectPath });
}
