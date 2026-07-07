// 编辑器偏好配置模块
//
// 功能概述：
// 管理项目级配置与用户级偏好两部分数据，实现"功能全局开关化"架构。
// 项目级配置存储于项目目录的 .novelforge/config.json，跟随项目迁移。
// 用户级偏好存储于 AppData/MiaoChuangShuo/preferences.json，跨项目共享。
// 新建项目时以用户级偏好为默认值，用户可针对单个项目覆盖。
//
// 模块职责：
// 1. 定义项目级配置结构（ProjectConfig：template_type、created_at）
// 2. 定义用户级偏好结构（EditorPreferences：所有 enable_* 功能开关）
// 3. 提供 get_project_config / set_project_config Tauri 命令
// 4. 提供 get_user_preferences / set_user_preferences Tauri 命令
// 5. 提供根据模板类型生成默认偏好的工具函数
// 6. 原子写入（先写 .tmp 再 rename）保证配置文件完整性
//
// 设计说明：
// 配置存储拆分理由——功能开关是用户偏好而非项目属性，同一用户在不同项目
// 通常希望沿用相同开关设置。项目级仅存储项目固有属性（类型、创建时间），
// 功能开关存用户级，新建项目时以用户级为默认值，用户可针对单项目覆盖。
// 当前阶段仅实现用户级偏好的读写，项目级配置在阶段 2 模板重构时启用。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::command;

// ===== 用户级偏好 =====

/// 用户级编辑器偏好（功能开关集合）
///
/// 存储位置：AppData/MiaoChuangShuo/preferences.json
/// 跨项目共享，新建项目时作为默认值
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorPreferences {
    /// Tab 键角色名补全（原 CharacterMention 扩展，默认关闭）
    pub enable_character_mention_picker: bool,
    /// 首行自动缩进（散文排版，默认开启）
    pub enable_auto_indent: bool,
    /// 智能引号配对（英文引号自动转中文引号，默认开启）
    pub enable_smart_quotes: bool,
    /// 诗歌排版模式（居中对齐、韵脚辅助，默认关闭）
    pub enable_poetry_format: bool,
    /// 场景分隔辅助（插入场景分隔线时弹出元数据填写面板，默认关闭）
    pub enable_scene_break_helper: bool,
    /// 实体名自动高亮（正文中设定库实体名自动高亮，默认开启）
    pub enable_entity_highlight: bool,
}

impl Default for EditorPreferences {
    /// 默认偏好：以散文与文章场景为基线
    /// 长短篇小说：开缩进、关 Tab 补全
    /// 剧本与脚本：关缩进、开 Tab 补全
    /// 散文与文章：开缩进、关 Tab 补全
    fn default() -> Self {
        Self {
            enable_character_mention_picker: false,
            enable_auto_indent: true,
            enable_smart_quotes: true,
            enable_poetry_format: false,
            enable_scene_break_helper: false,
            enable_entity_highlight: true,
        }
    }
}

impl EditorPreferences {
    // 项目当前使用 EditorPreferences::default() 作为统一默认偏好
    // 模板类型差异由前端项目创建流程处理，无需后端按模板生成偏好
}

// ===== 项目级配置 =====

/// 项目级配置（存储于 .novelforge/config.json）
///
/// 仅包含项目固有属性，功能开关存用户级偏好
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfig {
    /// 模板类型："novel" / "script" / "essay"
    pub template_type: String,
    /// 创建时间（ISO 8601 格式，如 "2026-07-04T12:00:00Z"）
    pub created_at: String,
}

impl Default for ProjectConfig {
    fn default() -> Self {
        Self {
            template_type: "novel".to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

// ===== 路径定位 =====

/// 获取用户级偏好文件路径
/// 输入: 无
/// 输出: Result<PathBuf, String> 偏好文件路径
/// 流程: 定位 AppData/novelforge/preferences.json
fn get_preferences_path() -> Result<PathBuf, String> {
    let config_dir = dirs::config_dir()
        .ok_or_else(|| "无法获取配置目录".to_string())?;
    let prefs_dir = config_dir.join("novelforge");
    if !prefs_dir.exists() {
        fs::create_dir_all(&prefs_dir)
            .map_err(|e| format!("创建偏好目录失败: {}", e))?;
    }
    Ok(prefs_dir.join("preferences.json"))
}

/// 获取项目级配置文件路径
/// 输入: project_root 项目根目录
/// 输出: Result<PathBuf, String> 配置文件路径
/// 流程: 拼接 {project_root}/.novelforge/config.json
fn get_project_config_path(project_root: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(project_root);
    if !root.exists() {
        return Err("项目路径不存在".to_string());
    }
    let config_dir = root.join(".novelforge");
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("创建项目配置目录失败: {}", e))?;
    }
    Ok(config_dir.join("config.json"))
}

// ===== 原子写入 =====

/// 原子写入文件（先写 .tmp 再 rename）
/// 输入: path 目标路径, content 内容
/// 输出: Result<(), String> 写入结果
/// 流程:
///   1. 写入 {path}.tmp 临时文件
///   2. rename 到目标路径（原子操作）
///   3. 失败时清理临时文件
fn atomic_write(path: &PathBuf, content: &str) -> Result<(), String> {
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, content)
        .map_err(|e| format!("写入临时文件失败: {}", e))?;
    fs::rename(&tmp_path, path)
        .map_err(|e| {
            // rename 失败时清理临时文件
            let _ = fs::remove_file(&tmp_path);
            format!("重命名临时文件失败: {}", e)
        })
}

// ===== Tauri 命令：用户级偏好 =====

/// 读取用户级编辑器偏好
/// 输入: 无
/// 输出: Result<EditorPreferences, String> 偏好数据
/// 流程: 读取 AppData/preferences.json，失败返回默认值
#[command]
pub fn get_user_preferences() -> Result<EditorPreferences, String> {
    let path = get_preferences_path()?;
    if !path.exists() {
        return Ok(EditorPreferences::default());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取偏好文件失败: {}", e))?;
    let prefs: EditorPreferences = serde_json::from_str(&content)
        .map_err(|e| format!("解析偏好文件失败: {}", e))?;
    Ok(prefs)
}

/// 保存用户级编辑器偏好
/// 输入: preferences 偏好数据
/// 输出: Result<(), String> 保存结果
/// 流程: 序列化为 JSON 并原子写入 AppData/preferences.json
#[command]
pub fn set_user_preferences(preferences: EditorPreferences) -> Result<(), String> {
    let path = get_preferences_path()?;
    let content = serde_json::to_string_pretty(&preferences)
        .map_err(|e| format!("序列化偏好失败: {}", e))?;
    atomic_write(&path, &content)
}

// ===== Tauri 命令：项目级配置 =====

/// 读取项目级配置
/// 输入: project_root 项目根目录
/// 输出: Result<ProjectConfig, String> 配置数据
/// 流程: 读取 {project_root}/.novelforge/config.json，失败返回默认值
#[command]
pub fn get_project_config(project_root: String) -> Result<ProjectConfig, String> {
    let path = get_project_config_path(&project_root)?;
    if !path.exists() {
        return Ok(ProjectConfig::default());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取项目配置失败: {}", e))?;
    let config: ProjectConfig = serde_json::from_str(&content)
        .map_err(|e| format!("解析项目配置失败: {}", e))?;
    Ok(config)
}

/// 保存项目级配置
/// 输入: project_root 项目根目录, config 配置数据
/// 输出: Result<(), String> 保存结果
/// 流程: 序列化为 JSON 并原子写入 {project_root}/.novelforge/config.json
#[command]
pub fn set_project_config(project_root: String, config: ProjectConfig) -> Result<(), String> {
    let path = get_project_config_path(&project_root)?;
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("序列化项目配置失败: {}", e))?;
    atomic_write(&path, &content)
}

// ===== 单元测试 =====

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证默认偏好：散文场景为基线
    #[test]
    fn test_default_preferences() {
        let prefs = EditorPreferences::default();
        assert!(prefs.enable_auto_indent);
        assert!(!prefs.enable_character_mention_picker);
        assert!(prefs.enable_smart_quotes);
        assert!(!prefs.enable_poetry_format);
        assert!(!prefs.enable_scene_break_helper);
        assert!(prefs.enable_entity_highlight);
    }

    /// 验证偏好序列化/反序列化
    #[test]
    fn test_preferences_serialization() {
        let prefs = EditorPreferences::default();
        let json = serde_json::to_string(&prefs).unwrap();
        let deserialized: EditorPreferences = serde_json::from_str(&json).unwrap();
        assert_eq!(prefs.enable_auto_indent, deserialized.enable_auto_indent);
        assert_eq!(
            prefs.enable_character_mention_picker,
            deserialized.enable_character_mention_picker
        );
    }
}
