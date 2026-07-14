// 自定义模板 CRUD 命令模块
//
// 功能概述：
// 提供自定义项目模板的列表、保存、删除 Tauri 命令。
// 模板以 JSON 文件形式存储在系统配置目录的 novelforge/templates/ 子目录下。
//
// 模块职责：
// 1. 列出所有自定义模板
// 2. 保存（创建或更新）自定义模板
// 3. 删除指定 ID 的自定义模板
//
// 错误处理：
// 所有 Tauri 命令返回 Result<T, AppError>，向前端传递结构化错误信息。

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// 自定义模板结构
/// 存储在应用配置目录 templates/ 下
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub directories: Vec<String>,
    pub created_at: String,
}

/// 获取自定义模板存储目录
/// 输出: Result<PathBuf, AppError> 模板目录路径
/// 流程: 定位系统配置目录下的 novelforge/templates/，不存在时创建
/// 错误:
///   - ConfigError: 系统无法提供配置目录
///   - IoError: 创建模板目录失败
fn get_templates_dir() -> Result<PathBuf, AppError> {
    let config_dir = dirs::config_dir().ok_or_else(|| {
        AppError::config_error("无法获取配置目录")
    })?;
    let templates_dir = config_dir.join("novelforge").join("templates");
    if !templates_dir.exists() {
        fs::create_dir_all(&templates_dir).map_err(|e| AppError::IoError {
            source: e,
            context: "创建模板目录失败".to_string(),
        })?;
    }
    Ok(templates_dir)
}

/// 列出所有自定义模板
/// 输出: Result<Vec<CustomTemplate>, AppError> 模板列表
#[tauri::command]
pub fn list_custom_templates() -> Result<Vec<CustomTemplate>, AppError> {
    let templates_dir = get_templates_dir()?;
    let mut templates = Vec::new();

    if let Ok(entries) = fs::read_dir(&templates_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(tpl) = serde_json::from_str::<CustomTemplate>(&content) {
                        templates.push(tpl);
                    }
                }
            }
        }
    }

    Ok(templates)
}

/// 保存自定义模板
/// 输入: template 模板结构
/// 输出: Result<(), AppError>
#[tauri::command]
pub fn save_custom_template(template: CustomTemplate) -> Result<(), AppError> {
    let templates_dir = get_templates_dir()?;
    let file_path = templates_dir.join(format!("{}.json", template.id));
    let json = serde_json::to_string_pretty(&template)
        .map_err(|e| AppError::serialize_error(e, "序列化模板失败"))?;
    fs::write(&file_path, json).map_err(|e| AppError::io_error(e, "写入模板文件失败"))?;
    Ok(())
}

/// 删除自定义模板
/// 输入: id 模板 ID
/// 输出: Result<(), AppError>
#[tauri::command]
pub fn delete_custom_template(id: String) -> Result<(), AppError> {
    let templates_dir = get_templates_dir()?;
    let file_path = templates_dir.join(format!("{}.json", id));
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| AppError::io_error(e, "删除模板文件失败"))?;
    }
    Ok(())
}
