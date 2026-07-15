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
//
// 错误处理：
// 本模块作为 AppError 试点，全量替换 Result<T, String> 为 Result<T, AppError>，
// 通过结构化错误类型向前端传递 { kind, message, context } 信息，便于前端
// 根据 kind 字段进行差异化处理与 i18n 本地化映射。

use crate::error::AppError;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::command;

// ===== 用户级偏好 =====

/// 用户级编辑器偏好（功能开关集合）
///
/// 存储位置：AppData/MiaoChuangShuo/preferences.json
/// 跨项目共享，新建项目时作为默认值
/// Task 1.7.2: 派生 JsonSchema 用于自动生成前端 TS 类型与 CI 一致性校验
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
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
    /// 长篇小说：开缩进、关 Tab 补全
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
/// Task 1.7.2: 派生 JsonSchema 用于自动生成前端 TS 类型与 CI 一致性校验
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
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
/// 输出: Result<PathBuf, AppError> 偏好文件路径
/// 流程: 定位 AppData/MiaoChuangShuo/preferences.json，必要时创建偏好目录
/// 错误:
///   - ConfigError: 系统无法提供配置目录（如环境变量缺失）
///   - IoError: 创建偏好目录失败
fn get_preferences_path() -> Result<PathBuf, AppError> {
    let config_dir = dirs::config_dir().ok_or_else(|| {
        AppError::ConfigError("无法获取配置目录".to_string())
    })?;
    let prefs_dir = config_dir.join("MiaoChuangShuo");
    if !prefs_dir.exists() {
        fs::create_dir_all(&prefs_dir).map_err(|e| AppError::IoError {
            source: e,
            context: "创建偏好目录失败".to_string(),
        })?;
    }
    Ok(prefs_dir.join("preferences.json"))
}

/// 获取项目级配置文件路径
/// 输入: project_root 项目根目录
/// 输出: Result<PathBuf, AppError> 配置文件路径
/// 流程: 拼接 {project_root}/.novelforge/config.json，必要时创建配置目录
/// 错误:
///   - PathValidationError: 项目路径不存在
///   - IoError: 创建项目配置目录失败
fn get_project_config_path(project_root: &str) -> Result<PathBuf, AppError> {
    let root = PathBuf::from(project_root);
    if !root.exists() {
        return Err(AppError::PathValidationError("项目路径不存在".to_string()));
    }
    let config_dir = root.join(".novelforge");
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| AppError::IoError {
            source: e,
            context: "创建项目配置目录失败".to_string(),
        })?;
    }
    Ok(config_dir.join("config.json"))
}

// ===== 原子写入 =====

/// 原子写入文件（先写 .tmp 再 rename）
/// 输入: path 目标路径, content 内容
/// 输出: Result<(), AppError> 写入结果
/// 流程:
///   1. 写入 {path}.tmp 临时文件
///   2. rename 到目标路径（原子操作）
///   3. rename 失败时清理临时文件后返回错误
/// 错误:
///   - IoError: 写入临时文件失败 / 重命名临时文件失败
fn atomic_write(path: &PathBuf, content: &str) -> Result<(), AppError> {
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, content).map_err(|e| AppError::IoError {
        source: e,
        context: "写入临时文件失败".to_string(),
    })?;
    fs::rename(&tmp_path, path).map_err(|e| {
        // rename 失败时清理临时文件，避免残留
        let _ = fs::remove_file(&tmp_path);
        AppError::IoError {
            source: e,
            context: "重命名临时文件失败".to_string(),
        }
    })
}

// ===== Tauri 命令：用户级偏好 =====

/// 读取用户级编辑器偏好
/// 输入: 无
/// 输出: Result<EditorPreferences, AppError> 偏好数据
/// 流程: 读取 AppData/preferences.json，文件不存在则返回默认值
/// 错误:
///   - IoError: 读取偏好文件失败
///   - SerializeError: 解析偏好文件失败
#[command]
pub fn get_user_preferences() -> Result<EditorPreferences, AppError> {
    let path = get_preferences_path()?;
    if !path.exists() {
        return Ok(EditorPreferences::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| AppError::IoError {
        source: e,
        context: "读取偏好文件失败".to_string(),
    })?;
    let prefs: EditorPreferences = serde_json::from_str(&content).map_err(|e| {
        AppError::SerializeError {
            source: e,
            context: "解析偏好文件失败".to_string(),
        }
    })?;
    Ok(prefs)
}

/// 保存用户级编辑器偏好
/// 输入: preferences 偏好数据
/// 输出: Result<(), AppError> 保存结果
/// 流程: 序列化为 JSON 并原子写入 AppData/preferences.json
/// 错误:
///   - SerializeError: 序列化偏好失败
///   - IoError: 原子写入失败（写入临时文件或重命名失败）
#[command]
pub fn set_user_preferences(preferences: EditorPreferences) -> Result<(), AppError> {
    let path = get_preferences_path()?;
    let content = serde_json::to_string_pretty(&preferences).map_err(|e| {
        AppError::SerializeError {
            source: e,
            context: "序列化偏好失败".to_string(),
        }
    })?;
    atomic_write(&path, &content)
}

// ===== Tauri 命令：项目级配置 =====

/// 读取项目级配置
/// 输入: project_root 项目根目录
/// 输出: Result<ProjectConfig, AppError> 配置数据
/// 流程: 读取 {project_root}/.novelforge/config.json，文件不存在则返回默认值
/// 错误:
///   - PathValidationError: 项目路径不存在
///   - IoError: 读取项目配置失败
///   - SerializeError: 解析项目配置失败
#[command]
pub fn get_project_config(project_root: String) -> Result<ProjectConfig, AppError> {
    let path = get_project_config_path(&project_root)?;
    if !path.exists() {
        return Ok(ProjectConfig::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| AppError::IoError {
        source: e,
        context: "读取项目配置失败".to_string(),
    })?;
    let config: ProjectConfig = serde_json::from_str(&content).map_err(|e| {
        AppError::SerializeError {
            source: e,
            context: "解析项目配置失败".to_string(),
        }
    })?;
    Ok(config)
}

/// 保存项目级配置
/// 输入: project_root 项目根目录, config 配置数据
/// 输出: Result<(), AppError> 保存结果
/// 流程: 序列化为 JSON 并原子写入 {project_root}/.novelforge/config.json
/// 错误:
///   - PathValidationError: 项目路径不存在
///   - SerializeError: 序列化项目配置失败
///   - IoError: 原子写入失败（写入临时文件或重命名失败）
#[command]
pub fn set_project_config(project_root: String, config: ProjectConfig) -> Result<(), AppError> {
    let path = get_project_config_path(&project_root)?;
    let content = serde_json::to_string_pretty(&config).map_err(|e| {
        AppError::SerializeError {
            source: e,
            context: "序列化项目配置失败".to_string(),
        }
    })?;
    atomic_write(&path, &content)
}

// ===== AppData 目录迁移(历史 novelforge → MiaoChuangShuo) =====

/// 迁移旧版 novelforge AppData 目录到 MiaoChuangShuo
///
/// 功能说明:
///   检测 %APPDATA%/novelforge 是否存在,存在则迁移到 %APPDATA%/MiaoChuangShuo。
///   实现历史数据自动迁移,确保用户从 novelforge 命名时代升级后不丢失偏好/模板等数据。
///
/// 输入: 无
/// 输出: Result<(), AppError> 迁移结果
/// 流程:
///   1. 获取 config_dir(系统配置目录)
///   2. 检查 config_dir/novelforge 是否存在(旧版应用数据目录)
///   3. 若不存在,无需迁移,直接返回 Ok
///   4. 若存在,检查 config_dir/MiaoChuangShuo 是否已存在
///      - 若都已存在,合并策略:递归复制 novelforge 下文件到 MiaoChuangShuo
///        (不覆盖已存在文件),最后将 novelforge 重命名为 novelforge.bak
///      - 若只有 novelforge,直接 rename 为 MiaoChuangShuo
///   5. 返回结果
///
/// 错误处理:
///   - ConfigError: 系统无法提供配置目录
///   - IoError: 目录创建/复制/重命名失败
pub fn migrate_appdata_directory() -> Result<(), AppError> {
    let config_dir = dirs::config_dir().ok_or_else(|| {
        AppError::ConfigError("无法获取配置目录".to_string())
    })?;

    let old_dir = config_dir.join("novelforge");
    let new_dir = config_dir.join("MiaoChuangShuo");

    // 旧目录不存在,无需迁移
    if !old_dir.exists() {
        return Ok(());
    }

    if new_dir.exists() {
        // 合并策略: 两个目录都存在,递归复制旧目录文件到新目录(不覆盖已存在文件)
        copy_dir_recursive(&old_dir, &new_dir, false)?;

        // 将旧目录重命名为 novelforge.bak 作为备份,避免迁移失败导致数据丢失
        let backup_dir = config_dir.join("novelforge.bak");
        // 若 .bak 已存在(历史迁移残留),先删除
        if backup_dir.exists() {
            fs::remove_dir_all(&backup_dir).map_err(|e| AppError::IoError {
                source: e,
                context: "清理历史 novelforge.bak 目录失败".to_string(),
            })?;
        }
        fs::rename(&old_dir, &backup_dir).map_err(|e| AppError::IoError {
            source: e,
            context: "重命名 novelforge 为 novelforge.bak 失败".to_string(),
        })?;
    } else {
        // 直接迁移策略: 只有旧目录,直接重命名为新目录
        fs::rename(&old_dir, &new_dir).map_err(|e| AppError::IoError {
            source: e,
            context: "重命名 novelforge 为 MiaoChuangShuo 失败".to_string(),
        })?;
    }

    Ok(())
}

/// 递归复制目录内容
///
/// 输入:
///   src - 源目录路径
///   dst - 目标目录路径
///   overwrite - 是否覆盖已存在文件(true 覆盖, false 跳过已存在)
/// 输出: Result<(), AppError> 复制结果
/// 流程:
///   1. 确保目标目录存在
///   2. 遍历源目录所有条目
///   3. 子目录: 递归复制
///   4. 文件: 检查目标是否存在(根据 overwrite 决定复制或跳过)
///
/// 错误处理:
///   - IoError: 目录创建/文件复制失败
fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf, overwrite: bool) -> Result<(), AppError> {
    if !dst.exists() {
        fs::create_dir_all(dst).map_err(|e| AppError::IoError {
            source: e,
            context: format!("创建目标目录失败: {}", dst.display()),
        })?;
    }

    let entries = fs::read_dir(src).map_err(|e| AppError::IoError {
        source: e,
        context: format!("读取源目录失败: {}", src.display()),
    })?;

    for entry in entries.flatten() {
        let entry_path = entry.path();
        let file_name = entry.file_name();
        let target_path = dst.join(&file_name);

        if entry_path.is_dir() {
            // 递归复制子目录
            copy_dir_recursive(&entry_path, &target_path, overwrite)?;
        } else if entry_path.is_file() {
            // 文件: 检查目标是否存在
            if !overwrite && target_path.exists() {
                // 不覆盖且目标已存在,跳过
                continue;
            }
            fs::copy(&entry_path, &target_path).map_err(|e| AppError::IoError {
                source: e,
                context: format!(
                    "复制文件失败: {} -> {}",
                    entry_path.display(),
                    target_path.display()
                ),
            })?;
        }
    }

    Ok(())
}

// ===== 自定义关系类型后端持久化(Task 1.5) =====

/// 用户自定义关系类型结构体
///
/// 用于人物关系图谱中用户自定义的关系类型(如师徒/敌对/亲属等内置类型之外的关系)
/// 持久化位置: %APPDATA%/MiaoChuangShuo/custom_relation_types.json
/// 跨项目共享,所有项目共用同一份自定义关系类型配置
/// Task 1.7.2: 派生 JsonSchema 用于自动生成前端 TS 类型与 CI 一致性校验
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CustomRelationType {
    /// 唯一标识(用作 edge.data.relationType 的值,格式如 "custom_xxx")
    pub id: String,
    /// 中文显示名称(如"宿敌""挚友")
    pub label: String,
    /// 边 stroke 颜色(HEX 格式,如 "#6EA8FE")
    pub color: String,
}

/// 获取自定义关系类型持久化文件路径
///
/// 输入: 无
/// 输出: Result<PathBuf, AppError> 文件路径
/// 流程: 定位 %APPDATA%/MiaoChuangShuo/custom_relation_types.json,必要时创建目录
/// 错误:
///   - ConfigError: 系统无法提供配置目录
///   - IoError: 创建目录失败
fn get_custom_relation_types_path() -> Result<PathBuf, AppError> {
    let config_dir = dirs::config_dir().ok_or_else(|| {
        AppError::ConfigError("无法获取配置目录".to_string())
    })?;
    let app_dir = config_dir.join("MiaoChuangShuo");
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| AppError::IoError {
            source: e,
            context: "创建应用数据目录失败".to_string(),
        })?;
    }
    Ok(app_dir.join("custom_relation_types.json"))
}

/// 加载自定义关系类型列表
///
/// 输入: 无
/// 输出: Result<Vec<CustomRelationType>, AppError> 关系类型列表
/// 流程:
///   1. 获取持久化文件路径
///   2. 文件不存在时返回空列表(用户从未添加自定义类型)
///   3. 读取并反序列化 JSON
///   4. 反序列化失败时返回空列表(容错,避免历史脏数据阻塞)
/// 错误:
///   - IoError: 读取文件失败
///   - SerializeError: 反序列化失败已容错为空列表(不返回错误)
#[command]
pub fn load_custom_relation_types() -> Result<Vec<CustomRelationType>, AppError> {
    let path = get_custom_relation_types_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| AppError::IoError {
        source: e,
        context: "读取 custom_relation_types.json 失败".to_string(),
    })?;
    // 反序列化失败容错为空列表,避免历史脏数据阻塞前端 UI
    let types: Vec<CustomRelationType> = serde_json::from_str(&content)
        .unwrap_or_else(|_| Vec::new());
    Ok(types)
}

/// 保存自定义关系类型列表
///
/// 输入: types 关系类型数组
/// 输出: Result<(), AppError> 保存结果
/// 流程:
///   1. 获取持久化文件路径
///   2. 序列化为 pretty JSON
///   3. 原子写入(先写 .tmp 再 rename)避免写入中途崩溃损坏 JSON
/// 错误:
///   - SerializeError: 序列化失败
///   - IoError: 原子写入失败
#[command]
pub fn save_custom_relation_types(types: Vec<CustomRelationType>) -> Result<(), AppError> {
    let path = get_custom_relation_types_path()?;
    let content = serde_json::to_string_pretty(&types).map_err(|e| {
        AppError::SerializeError {
            source: e,
            context: "序列化 custom_relation_types.json 失败".to_string(),
        }
    })?;
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

    /// 验证 AppError 错误类型的序列化输出结构
    /// 确保前端能收到 { kind, message, context } 三个字段
    #[test]
    fn test_app_error_serialization_structure() {
        let err = AppError::PathValidationError("测试路径校验失败".to_string());
        let json = serde_json::to_string(&err).expect("AppError 应可序列化");
        // 验证三个字段均存在
        let v: serde_json::Value = serde_json::from_str(&json).expect("应解析为合法 JSON");
        assert!(v.get("kind").is_some(), "序列化结果应包含 kind 字段");
        assert!(v.get("message").is_some(), "序列化结果应包含 message 字段");
        assert!(
            v.get("context").is_some(),
            "序列化结果应包含 context 字段"
        );
    }

    /// 验证 AppError::ConfigError 错误类型的序列化
    #[test]
    fn test_app_error_config_error_kind() {
        let err = AppError::ConfigError("无法获取配置目录".to_string());
        let json = serde_json::to_string(&err).expect("AppError 应可序列化");
        let v: serde_json::Value = serde_json::from_str(&json).expect("应解析为合法 JSON");
        assert_eq!(v["kind"], "configError");
    }

    /// 验证路径不存在时返回 PathValidationError
    #[test]
    fn test_get_project_config_path_not_exist() {
        let result = get_project_config_path("/nonexistent/path/that/should/not/exist");
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PathValidationError(msg) => {
                assert!(msg.contains("项目路径不存在"));
            }
            other => panic!("预期 PathValidationError，实际得到: {:?}", other),
        }
    }
}
