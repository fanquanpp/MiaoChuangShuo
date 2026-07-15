// JSON Schema 自动生成命令模块 (Task 1.7.3)
//
// 功能概述:
//   利用 schemars crate 为核心数据结构自动生成 JSON Schema 文件,
//   输出到 schemas/ 目录,供前端 TS 类型生成与 CI 一致性校验使用.
//
// 模块职责:
//   1. 提供 generate_schemas Tauri 命令,批量生成核心结构体的 JSON Schema
//   2. 每个结构体输出为独立的 <name>.schema.json 文件
//   3. 返回生成的文件路径列表,供前端或 CI 校验使用
//
// 设计说明:
//   - schemars 0.8 通过 schema_for! 宏在编译期生成 Schema 对象
//   - 输出文件采用 pretty JSON 格式,便于人工排查与 git diff 可读
//   - 输出目录不存在时自动创建,避免首次运行报错
//   - 命令接收 output_dir 参数,允许调用方指定输出位置(默认项目根的 schemas/)

use std::fs;
use std::path::PathBuf;

use schemars::schema_for;

use crate::error::AppError;

/// 为核心数据结构生成 JSON Schema 文件 (Task 1.7.3)
///
/// 输入:
///   output_dir - Schema 文件输出目录绝对路径(为空时使用项目根的 schemas/ 目录)
/// 输出: Result<Vec<String>, AppError> 生成的 Schema 文件路径列表
/// 流程:
///   1. 确定输出目录,不存在时创建
///   2. 遍历核心结构体列表,调用 schemars::schema_for! 生成 Schema 对象
///   3. 序列化为 pretty JSON,写入 <output_dir>/<name>.schema.json
///   4. 收集所有生成的文件路径并返回
/// 用途:
///   - 前端通过 json-schema-to-typescript 生成 TS 类型定义
///   - CI 中校验前端 TS 类型与后端 Rust 结构体的一致性
///   - 文档化数据结构的字段约束与默认值
#[tauri::command]
pub fn generate_schemas(output_dir: String) -> Result<Vec<String>, AppError> {
    // 确定输出目录: 参数为空时回退到当前工作目录的 schemas/ 子目录
    let dir = if output_dir.is_empty() {
        PathBuf::from("schemas")
    } else {
        PathBuf::from(&output_dir)
    };

    // 确保输出目录存在(兼容首次运行)
    fs::create_dir_all(&dir).map_err(|e| AppError::io_error(e, "创建 schemas 输出目录失败"))?;

    let mut generated_paths = Vec::new();

    // 核心结构体 Schema 生成列表
    // 每个元组为 (输出文件名, 闭包生成 Schema)
    // 注:schemars::schema_for! 是宏,无法直接放入 Vec 闭包,
    //    故采用逐个生成 + 收集路径的显式写法
    generate_one::<crate::project_template::ProjectMeta>(&dir, "ProjectMeta", &mut generated_paths)?;
    generate_one::<crate::manifest::Manifest>(&dir, "Manifest", &mut generated_paths)?;
    generate_one::<crate::manifest::ManifestEntity>(&dir, "ManifestEntity", &mut generated_paths)?;
    generate_one::<crate::manifest::ManifestEntities>(&dir, "ManifestEntities", &mut generated_paths)?;
    generate_one::<crate::manifest::ReverseIndex>(&dir, "ReverseIndex", &mut generated_paths)?;
    generate_one::<crate::ai_config::AiConfig>(&dir, "AiConfig", &mut generated_paths)?;
    generate_one::<crate::editor_preferences::EditorPreferences>(&dir, "EditorPreferences", &mut generated_paths)?;
    generate_one::<crate::editor_preferences::ProjectConfig>(&dir, "ProjectConfig", &mut generated_paths)?;
    generate_one::<crate::editor_preferences::CustomRelationType>(&dir, "CustomRelationType", &mut generated_paths)?;
    generate_one::<crate::timeline_commands::TimelineGraph>(&dir, "TimelineGraph", &mut generated_paths)?;
    generate_one::<crate::timeline_commands::TimelineNodeData>(&dir, "TimelineNodeData", &mut generated_paths)?;
    generate_one::<crate::timeline_commands::PersistedNode>(&dir, "TimelinePersistedNode", &mut generated_paths)?;
    generate_one::<crate::timeline_commands::PersistedEdge>(&dir, "TimelinePersistedEdge", &mut generated_paths)?;
    generate_one::<crate::character_graph_commands::CharacterGraph>(&dir, "CharacterGraph", &mut generated_paths)?;
    generate_one::<crate::character_graph_commands::CharacterNodeData>(&dir, "CharacterNodeData", &mut generated_paths)?;
    generate_one::<crate::character_graph_commands::PersistedNode>(&dir, "CharacterPersistedNode", &mut generated_paths)?;
    generate_one::<crate::character_graph_commands::PersistedEdge>(&dir, "CharacterPersistedEdge", &mut generated_paths)?;
    generate_one::<crate::snapshot_commands::SnapshotMeta>(&dir, "SnapshotMeta", &mut generated_paths)?;
    generate_one::<crate::commands::custom_template_commands::CustomTemplate>(&dir, "CustomTemplate", &mut generated_paths)?;
    generate_one::<crate::commands::writing_stats_commands::WritingStatsSnapshot>(&dir, "WritingStatsSnapshot", &mut generated_paths)?;

    Ok(generated_paths)
}

/// 为单个结构体生成 JSON Schema 并写入文件(内部辅助函数)
///
/// 输入:
///   dir - 输出目录
///   name - 结构体名称(用作文件名前缀)
///   paths - 已生成文件路径列表(函数内追加)
/// 输出: Result<(), AppError> 生成结果
/// 流程:
///   1. 调用 schemars::schema_for! 生成 Schema 对象
///   2. 序列化为 pretty JSON
///   3. 写入 <dir>/<name>.schema.json
///   4. 将文件路径追加到 paths 列表
fn generate_one<T: schemars::JsonSchema>(
    dir: &PathBuf,
    name: &str,
    paths: &mut Vec<String>,
) -> Result<(), AppError> {
    let schema = schema_for!(T);
    let json = serde_json::to_string_pretty(&schema)
        .map_err(|e| AppError::serialize_error(e, format!("序列化 {} Schema 失败", name)))?;
    let file_path = dir.join(format!("{}.schema.json", name));
    fs::write(&file_path, json)
        .map_err(|e| AppError::io_error(e, format!("写入 {} Schema 文件失败", name)))?;
    paths.push(file_path.to_string_lossy().to_string());
    Ok(())
}
