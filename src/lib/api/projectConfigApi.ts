// src/lib/api/projectConfigApi.ts
//
// 项目级配置 API 模块
// 从 preferencesSlice.ts 拆分而来, 专注项目级 .novelforge/config.json 的读写,
// 与编辑器用户级偏好(PreferencesState)解耦。
//
// 模块职责:
//   1. 定义 ProjectConfig 接口(与 Rust ProjectConfig 结构对应)
//   2. 提供 getProjectConfig / setProjectConfig 两个 API 函数
//   3. 通过 Tauri invoke 调用 Rust 后端, 不直接读写文件
//
// 设计说明:
//   - 配置存储分层: 项目级存 .novelforge/config.json(本模块管理),
//     用户级偏好存 AppData/preferences.json(由 preferencesSlice.ts 管理)
//   - 所有 UI 层调用必经此模块, 禁止直接 invoke

import { invoke } from "@tauri-apps/api/core";

/**
 * 项目级配置接口(与 Rust ProjectConfig 结构对应)
 * 持久化到 {project_root}/.novelforge/config.json
 */
export interface ProjectConfig {
  /** 模板类型:"novel" / "script" / "essay" */
  templateType: string;
  /** 创建时间(ISO 8601) */
  createdAt: string;
}

/**
 * 读取项目级配置
 * 输入: projectRoot 项目根目录
 * 输出: Promise<ProjectConfig> 配置数据
 * 流程: 调用 get_project_config Tauri 命令, 由后端读取 .novelforge/config.json
 * 异常: 后端读取失败时 reject, 由调用方处理
 */
export async function getProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  return invoke<ProjectConfig>("get_project_config", { projectRoot });
}

/**
 * 保存项目级配置
 * 输入: projectRoot 项目根目录, config 配置数据
 * 输出: Promise<void>
 * 流程: 调用 set_project_config Tauri 命令, 由后端原子写入 .novelforge/config.json
 * 异常: 后端写入失败时 reject, 由调用方处理
 */
export async function setProjectConfig(projectRoot: string, config: ProjectConfig): Promise<void> {
  await invoke("set_project_config", { projectRoot, config });
}
