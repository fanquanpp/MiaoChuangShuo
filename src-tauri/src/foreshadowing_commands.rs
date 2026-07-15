// src-tauri/src/foreshadowing_commands.rs
//
// 伏笔追踪模块 Data 层 Rust 命令实现
// 提供 list_foreshadowings / create_foreshadowing / update_foreshadowing / delete_foreshadowing 四个 Tauri 命令,
// 持久化到 <project>/伏笔/foreshadowings.json, 采用原子写入(临时文件 + rename)防止数据损坏。
//
// 模块职责:
//   1. 定义 Foreshadowing 业务结构体(含 schema 派生)
//   2. 实现 CRUD 命令,统一通过 AppError 向前端传递结构化错误
//   3. 自动生成 UUID v4 与 ISO 8601 时间戳
//
// 字段命名约定:
//   #[serde(rename_all = "camelCase")] 保证 Rust snake_case 与前端 camelCase 双向匹配,
//   避免反序列化时 "missing field" 错误。

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Local;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;

/// 伏笔业务实体结构
///
/// 持久化到 <project>/伏笔/foreshadowings.json,字段含义:
/// - id: UUID v4 主键,创建时由后端生成
/// - title: 伏笔标题,用户输入
/// - status: 状态枚举字符串(planted/setup/resolved/abandoned)
/// - setup_chapter_id: 埋设章节 UUID,关联 manifest.entities.chapters,可为空
/// - resolution_chapter_id: 回收章节 UUID,关联 manifest.entities.chapters,可为空
/// - importance: 重要度枚举字符串(high/medium/low)
/// - note: 备注,用户自由填写
/// - created_at / updated_at: ISO 8601 时间戳,由后端维护
///
/// Task 1.7.2: 派生 JsonSchema 用于自动生成前端 TS 类型与 CI 一致性校验
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Foreshadowing {
    /// 唯一标识(UUID v4)
    pub id: String,
    /// 伏笔标题
    pub title: String,
    /// 状态(planted/setup/resolved/abandoned)
    pub status: String,
    /// 埋设章节 UUID,关联 manifest
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_chapter_id: Option<String>,
    /// 回收章节 UUID,关联 manifest
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution_chapter_id: Option<String>,
    /// 重要度(high/medium/low)
    pub importance: String,
    /// 备注
    #[serde(default)]
    pub note: String,
    /// 创建时间(ISO 8601)
    pub created_at: String,
    /// 最后修改时间(ISO 8601)
    pub updated_at: String,
}

/// 构建伏笔目录路径
/// 输入: project_root 项目根路径
/// 输出: 伏笔目录的完整路径
fn foreshadowing_dir(project_root: &str) -> PathBuf {
    Path::new(project_root).join("伏笔")
}

/// 构建 foreshadowings.json 文件路径
/// 输入: project_root 项目根路径
/// 输出: foreshadowings.json 完整路径
fn foreshadowings_json_path(project_root: &str) -> PathBuf {
    foreshadowing_dir(project_root).join("foreshadowings.json")
}

/// 读取伏笔列表
///
/// 输入: project_path 项目根路径
/// 输出: Result<Vec<Foreshadowing>, AppError> 伏笔列表或错误信息
/// 流程:
///   1. 文件不存在时返回空 Vec(兼容新项目与未初始化场景)
///   2. 读取并反序列化 JSON 数组
///   3. 失败时返回 SerializeError,前端通过 AppError 结构化处理
#[tauri::command]
pub fn list_foreshadowings(project_path: String) -> Result<Vec<Foreshadowing>, AppError> {
    let json_path = foreshadowings_json_path(&project_path);

    // 文件不存在视为空列表(新项目或未写入过伏笔)
    if !json_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&json_path)
        .map_err(|e| AppError::io_error(e, "读取伏笔列表失败"))?;

    let list: Vec<Foreshadowing> = serde_json::from_str(&content)
        .map_err(|e| AppError::serialize_error(e, "解析伏笔列表 JSON 失败"))?;

    Ok(list)
}

/// 新建伏笔
///
/// 输入:
///   project_path 项目根路径
///   foreshadowing 前端构造的伏笔对象(id/created_at/updated_at 由后端覆盖)
/// 输出: Result<Foreshadowing, AppError> 创建完成后的伏笔对象(含生成的 id 与时间戳)
/// 流程:
///   1. 后端生成 UUID v4 与 ISO 8601 时间戳,覆盖前端传入值
///   2. 读取现有列表(不存在则视为空)
///   3. 追加新伏笔到列表末尾
///   4. 原子写入(临时文件 + rename)
///   5. 返回创建后的伏笔对象
#[tauri::command]
pub fn create_foreshadowing(
    project_path: String,
    mut foreshadowing: Foreshadowing,
) -> Result<Foreshadowing, AppError> {
    // 生成主键与时间戳(强制覆盖前端传入,保证全局唯一性与时间一致性)
    let now = Local::now().to_rfc3339();
    foreshadowing.id = Uuid::new_v4().to_string();
    foreshadowing.created_at = now.clone();
    foreshadowing.updated_at = now;

    // 读取现有列表(不存在则视为空)
    let mut list = load_list(&project_path)?;

    // 追加新伏笔
    list.push(foreshadowing.clone());

    // 原子写入
    save_list(&project_path, &list)?;

    Ok(foreshadowing)
}

/// 更新伏笔
///
/// 输入:
///   project_path 项目根路径
///   foreshadowing 待更新的伏笔对象(按 id 匹配)
/// 输出: Result<(), AppError> 成功或错误信息
/// 流程:
///   1. 读取现有列表
///   2. 按 id 查找目标伏笔,不存在返回 ConfigError
///   3. 替换条目,更新 updated_at 时间戳
///   4. 原子写入
#[tauri::command]
pub fn update_foreshadowing(
    project_path: String,
    mut foreshadowing: Foreshadowing,
) -> Result<(), AppError> {
    let mut list = load_list(&project_path)?;

    // 按 id 查找目标索引
    let idx = list
        .iter()
        .position(|item| item.id == foreshadowing.id)
        .ok_or_else(|| {
            AppError::config_error(format!("伏笔不存在: {}", foreshadowing.id))
        })?;

    // 更新时间戳(强制覆盖,保证一致性)
    foreshadowing.updated_at = Local::now().to_rfc3339();
    // 保留原 created_at,防止前端误传导致创建时间丢失
    foreshadowing.created_at = list[idx].created_at.clone();

    // 替换目标条目
    list[idx] = foreshadowing;

    save_list(&project_path, &list)?;

    Ok(())
}

/// 删除伏笔
///
/// 输入:
///   project_path 项目根路径
///   foreshadowing_id 待删除伏笔的 UUID
/// 输出: Result<(), AppError> 成功或错误信息
/// 流程:
///   1. 读取现有列表
///   2. 按 id 过滤移除目标条目,不存在时返回 ConfigError
///   3. 原子写入
#[tauri::command]
pub fn delete_foreshadowing(
    project_path: String,
    foreshadowing_id: String,
) -> Result<(), AppError> {
    let mut list = load_list(&project_path)?;

    // 按 id 查找目标索引
    let idx = list
        .iter()
        .position(|item| item.id == foreshadowing_id)
        .ok_or_else(|| {
            AppError::config_error(format!("伏笔不存在: {}", foreshadowing_id))
        })?;

    // 移除目标条目
    list.remove(idx);

    save_list(&project_path, &list)?;

    Ok(())
}

/// 内部工具:加载伏笔列表
///
/// 输入: project_path 项目根路径
/// 输出: Result<Vec<Foreshadowing>, AppError> 伏笔列表
/// 流程: 文件不存在时返回空 Vec,否则读取并反序列化
fn load_list(project_path: &str) -> Result<Vec<Foreshadowing>, AppError> {
    let json_path = foreshadowings_json_path(project_path);

    if !json_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&json_path)
        .map_err(|e| AppError::io_error(e, "读取伏笔列表失败"))?;

    let list: Vec<Foreshadowing> = serde_json::from_str(&content)
        .map_err(|e| AppError::serialize_error(e, "解析伏笔列表 JSON 失败"))?;

    Ok(list)
}

/// 内部工具:原子写入伏笔列表
///
/// 输入:
///   project_path 项目根路径
///   list 待持久化的伏笔列表
/// 输出: Result<(), AppError> 成功或错误信息
/// 流程:
///   1. 确保 伏笔/ 目录存在
///   2. 序列化为 pretty JSON
///   3. 写入临时文件 .tmp
///   4. 原子 rename 到目标文件
///   5. rename 失败时清理临时文件,避免残留
fn save_list(project_path: &str, list: &[Foreshadowing]) -> Result<(), AppError> {
    // 确保目录存在
    let dir = foreshadowing_dir(project_path);
    fs::create_dir_all(&dir)
        .map_err(|e| AppError::io_error(e, "创建伏笔目录失败"))?;

    // 序列化 JSON(pretty 提升可读性,与项目其他数据文件保持一致)
    let json = serde_json::to_string_pretty(list)
        .map_err(|e| AppError::serialize_error(e, "序列化伏笔列表失败"))?;

    let json_path = foreshadowings_json_path(project_path);
    let tmp_path = json_path.with_extension("json.tmp");

    // 写入临时文件
    fs::write(&tmp_path, &json)
        .map_err(|e| AppError::io_error(e, "写入伏笔临时文件失败"))?;

    // 原子 rename(Windows NTFS 与 Linux ext4 均支持)
    fs::rename(&tmp_path, &json_path).map_err(|e| {
        // rename 失败时清理临时文件,避免残留
        let _ = fs::remove_file(&tmp_path);
        AppError::io_error(e, "替换伏笔文件失败")
    })?;

    Ok(())
}
