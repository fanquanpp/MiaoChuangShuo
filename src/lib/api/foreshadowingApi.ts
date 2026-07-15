// 喵创说 伏笔追踪 API
//
// 模块职责:
// 封装伏笔追踪模块的 CRUD 调用,作为前端 Service 层与 Rust 后端之间的桥接。
// 所有命令均通过 @tauri-apps/api/core 的 invoke 调用后端 foreshadowing_commands 模块。
//
// 依赖:
// - @tauri-apps/api/core 的 invoke 调用 Rust 后端
// - ./_internal 的 extractErrorMessage 统一错误消息提取

import { invoke } from "@tauri-apps/api/core";
import { extractErrorMessage } from "./_internal";

/**
 * 伏笔状态枚举字面量
 * 与后端 foreshadowing_commands.rs 中字符串值一一对应
 */
export type ForeshadowingStatus = "planted" | "setup" | "resolved" | "abandoned";

/**
 * 伏笔重要度枚举字面量
 * 与后端 foreshadowing_commands.rs 中字符串值一一对应
 */
export type ForeshadowingImportance = "high" | "medium" | "low";

/**
 * 伏笔业务实体接口
 * 字段与后端 Foreshadowing 结构体(camelCase 序列化后)一一对应
 */
export interface Foreshadowing {
  /** 唯一标识(UUID v4,由后端生成) */
  id: string;
  /** 伏笔标题 */
  title: string;
  /** 状态(planted/setup/resolved/abandoned) */
  status: ForeshadowingStatus;
  /** 埋设章节 UUID,关联 manifest,可为空 */
  setupChapterId: string | null;
  /** 回收章节 UUID,关联 manifest,可为空 */
  resolutionChapterId: string | null;
  /** 重要度(high/medium/low) */
  importance: ForeshadowingImportance;
  /** 备注 */
  note: string;
  /** 创建时间(ISO 8601,由后端维护) */
  createdAt: string;
  /** 最后修改时间(ISO 8601,由后端维护) */
  updatedAt: string;
}

/**
 * 列出项目下所有伏笔
 *
 * 输入: projectPath 项目根路径
 * 输出: Promise<Foreshadowing[]> 伏笔列表(后端文件不存在时返回空数组)
 * 流程: 调用 Rust 后端 list_foreshadowings 命令
 * 容错: 后端文件不存在视为空列表,不会抛错
 */
export async function listForeshadowings(projectPath: string): Promise<Foreshadowing[]> {
  try {
    return await invoke<Foreshadowing[]>("list_foreshadowings", { projectPath });
  } catch (e) {
    throw new Error(extractErrorMessage(e));
  }
}

/**
 * 新建伏笔
 *
 * 输入:
 *   projectPath 项目根路径
 *   foreshadowing 前端构造的伏笔对象(id/createdAt/updatedAt 由后端覆盖)
 * 输出: Promise<Foreshadowing> 创建完成后的伏笔对象(含后端生成的 id 与时间戳)
 * 流程: 调用 Rust 后端 create_foreshadowing 命令
 */
export async function createForeshadowing(
  projectPath: string,
  foreshadowing: Omit<Foreshadowing, "id" | "createdAt" | "updatedAt">,
): Promise<Foreshadowing> {
  try {
    // 构造完整对象,补充占位字段(后端会覆盖)
    const payload: Foreshadowing = {
      id: "",
      createdAt: "",
      updatedAt: "",
      ...foreshadowing,
    };
    return await invoke<Foreshadowing>("create_foreshadowing", {
      projectPath,
      foreshadowing: payload,
    });
  } catch (e) {
    throw new Error(extractErrorMessage(e));
  }
}

/**
 * 更新伏笔
 *
 * 输入:
 *   projectPath 项目根路径
 *   foreshadowing 待更新的伏笔对象(按 id 匹配,updatedAt 由后端覆盖)
 * 输出: Promise<void>
 * 流程: 调用 Rust 后端 update_foreshadowing 命令
 */
export async function updateForeshadowing(
  projectPath: string,
  foreshadowing: Foreshadowing,
): Promise<void> {
  try {
    await invoke<void>("update_foreshadowing", { projectPath, foreshadowing });
  } catch (e) {
    throw new Error(extractErrorMessage(e));
  }
}

/**
 * 删除伏笔
 *
 * 输入:
 *   projectPath 项目根路径
 *   foreshadowingId 待删除伏笔的 UUID
 * 输出: Promise<void>
 * 流程: 调用 Rust 后端 delete_foreshadowing 命令
 */
export async function deleteForeshadowing(
  projectPath: string,
  foreshadowingId: string,
): Promise<void> {
  try {
    await invoke<void>("delete_foreshadowing", { projectPath, foreshadowingId });
  } catch (e) {
    throw new Error(extractErrorMessage(e));
  }
}
