// 场景化叙事工作台后端命令模块
//
// 功能概述：
// 为场景化叙事工作台提供后端数据支撑，管理章节文件的场景元数据。
// 采用 yWriter 风格的场景字段模型：Viewpoint/Goal/Conflict/Outcome。
//
// 模块职责：
// 1. 解析章节文件中的场景标记（## 场景N：标题）
// 2. 读写场景元数据 JSON 文件（.novelforge/scenes/{filename}.json）
// 3. 提供场景列表查询与字段更新能力
//
// 设计参考：yWriter 场景字段 + Scrivener 场景卡片

use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

/// 场景元数据
/// 对应 yWriter 的场景字段模型，用于追踪叙事核心要素
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneMeta {
    /// 场景唯一标识（基于在文件中的顺序，如 "scene-1"）
    pub id: String,
    /// 场景标题（从 `## 场景N：标题` 解析）
    pub title: String,
    /// 场景在文件中的序号（1-based）
    pub index: u32,
    /// 视点（Viewpoint）：场景的叙述视角角色
    #[serde(default)]
    pub viewpoint: String,
    /// 目标（Goal）：场景中角色想要达成的目标
    #[serde(default)]
    pub goal: String,
    /// 冲突（Conflict）：阻碍目标达成的对抗力量
    #[serde(default)]
    pub conflict: String,
    /// 结果（Outcome）：场景结束时的状态（成功/失败/灾难/妥协）
    #[serde(default)]
    pub outcome: String,
    /// 场景备注（可选）
    #[serde(default)]
    pub notes: String,
}

/// 章节文件的场景元数据集合
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneFileMeta {
    /// 文件相对路径
    pub file_path: String,
    /// 场景列表
    pub scenes: Vec<SceneMeta>,
}

/// 场景标记正则：匹配 `## 场景N：标题` 或 `## 场景N: 标题` 格式
/// 同时兼容 `## Scene N: title` 英文格式
fn parse_scenes_from_content(content: &str) -> Vec<SceneMeta> {
    let mut scenes = Vec::new();
    let mut index: u32 = 0;
    for line in content.lines() {
        let trimmed = line.trim();
        // 匹配 ## 场景N：标题 或 ## 场景N: 标题
        if let Some(rest) = trimmed.strip_prefix("## ") {
            // 检查是否为场景标记
            let is_scene = rest.starts_with("场景")
                || rest.starts_with("Scene")
                || rest.starts_with("scene");
            if is_scene {
                index += 1;
                let id = format!("scene-{}", index);
                // 提取标题：去除"场景N："或"Scene N:"前缀
                let title = rest
                    .find(['：', ':'])
                    .map(|pos| rest[pos..].chars().skip(1).collect::<String>().trim().to_string())
                    .unwrap_or_else(|| rest.to_string());
                scenes.push(SceneMeta {
                    id,
                    title,
                    index,
                    viewpoint: String::new(),
                    goal: String::new(),
                    conflict: String::new(),
                    outcome: String::new(),
                    notes: String::new(),
                });
            }
        }
    }
    scenes
}

/// 获取场景元数据存储目录
/// 输入: project_path 项目根路径
/// 输出: PathBuf 指向 .novelforge/scenes/ 目录（不保证存在）
fn get_scenes_dir(project_path: &str) -> PathBuf {
    PathBuf::from(project_path).join(".novelforge").join("scenes")
}

/// 获取单个文件场景元数据的存储路径
/// 输入:
///   project_path 项目根路径
///   file_path 文件相对路径（如 "正文/第一章.txt"）
/// 输出: PathBuf 指向 {project}/.novelforge/scenes/{file_path}.json
fn get_scene_meta_file(project_path: &str, file_path: &str) -> PathBuf {
    // 将文件路径中的分隔符替换为下划线，作为 JSON 文件名
    let safe_name = file_path.replace(['/', '\\'], "__");
    get_scenes_dir(project_path).join(format!("{}.json", safe_name))
}

/// 列出章节文件中的场景（解析标记 + 合并已保存元数据）
/// 输入:
///   project_path - 项目根路径
///   file_path - 文件相对路径
/// 输出: Result<SceneFileMeta, String> 场景元数据集合
/// 流程:
///   1. 读取文件内容并解析场景标记
///   2. 读取已保存的元数据 JSON
///   3. 合并两者：以解析的场景为基础，覆盖已保存的字段值
#[tauri::command]
pub fn list_scenes(
    project_path: String,
    file_path: String,
) -> Result<SceneFileMeta, String> {
    let root = PathBuf::from(&project_path);
    let file_full_path = root.join(&file_path);

    // 解析文件内容中的场景标记
    let content = fs::read_to_string(&file_full_path)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    let mut parsed_scenes = parse_scenes_from_content(&content);

    // 读取已保存的元数据
    let meta_file = get_scene_meta_file(&project_path, &file_path);
    if meta_file.exists() {
        if let Ok(saved) = fs::read_to_string(&meta_file) {
            if let Ok(saved_meta) = serde_json::from_str::<SceneFileMeta>(&saved) {
                // 合并：以解析的场景为基础，用已保存的字段值覆盖
                for scene in &mut parsed_scenes {
                    if let Some(saved_scene) = saved_meta.scenes.iter().find(|s| s.id == scene.id) {
                        scene.viewpoint = saved_scene.viewpoint.clone();
                        scene.goal = saved_scene.goal.clone();
                        scene.conflict = saved_scene.conflict.clone();
                        scene.outcome = saved_scene.outcome.clone();
                        scene.notes = saved_scene.notes.clone();
                    }
                }
            }
        }
    }

    Ok(SceneFileMeta {
        file_path,
        scenes: parsed_scenes,
    })
}

/// 保存单个文件的场景元数据
/// 输入:
///   project_path - 项目根路径
///   file_path - 文件相对路径
///   scenes - 场景元数据列表
/// 输出: Result<(), String> 保存成功或错误
/// 流程: 序列化为 JSON 写入 .novelforge/scenes/{file_path}.json
#[tauri::command]
pub fn save_scenes(
    project_path: String,
    file_path: String,
    scenes: Vec<SceneMeta>,
) -> Result<(), String> {
    let scenes_dir = get_scenes_dir(&project_path);
    // 确保目录存在
    fs::create_dir_all(&scenes_dir)
        .map_err(|e| format!("创建场景元数据目录失败: {}", e))?;

    let meta = SceneFileMeta {
        file_path: file_path.clone(),
        scenes,
    };
    let json = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("序列化场景元数据失败: {}", e))?;

    let meta_file = get_scene_meta_file(&project_path, &file_path);
    fs::write(&meta_file, json)
        .map_err(|e| format!("写入场景元数据失败: {}", e))?;

    Ok(())
}

/// 更新单个场景的字段
/// 输入:
///   project_path - 项目根路径
///   file_path - 文件相对路径
///   scene_id - 场景 ID
///   field_name - 字段名（viewpoint/goal/conflict/outcome/notes）
///   value - 新值
/// 输出: Result<SceneFileMeta, String> 更新后的完整元数据
/// 流程: 读取 → 更新 → 保存 → 返回
#[tauri::command]
pub fn update_scene_field(
    project_path: String,
    file_path: String,
    scene_id: String,
    field_name: String,
    value: String,
) -> Result<SceneFileMeta, String> {
    // 先读取当前场景列表（含解析 + 已保存元数据）
    let mut meta = list_scenes(project_path.clone(), file_path.clone())?;

    // 查找并更新字段
    let scene = meta
        .scenes
        .iter_mut()
        .find(|s| s.id == scene_id)
        .ok_or_else(|| format!("场景 {} 不存在", scene_id))?;

    match field_name.as_str() {
        "viewpoint" => scene.viewpoint = value,
        "goal" => scene.goal = value,
        "conflict" => scene.conflict = value,
        "outcome" => scene.outcome = value,
        "notes" => scene.notes = value,
        _ => return Err(format!("未知字段: {}", field_name)),
    }

    // 保存回文件
    save_scenes(project_path, file_path, meta.scenes.clone())?;

    Ok(meta)
}

/// 列出项目中所有有场景元数据的文件
/// 输入: project_path 项目根路径
/// 输出: Result<Vec<String>, String> 文件相对路径列表
/// 流程: 扫描 .novelforge/scenes/ 目录下的 JSON 文件
#[tauri::command]
pub fn list_scene_files(project_path: String) -> Result<Vec<String>, String> {
    let scenes_dir = get_scenes_dir(&project_path);
    if !scenes_dir.exists() {
        return Ok(vec![]);
    }

    let mut files = Vec::new();
    let entries = fs::read_dir(&scenes_dir)
        .map_err(|e| format!("读取场景目录失败: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "json").unwrap_or(false) {
            // 从文件名还原原始文件路径
            let stem = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let file_path = stem.replace("__", "/");
            files.push(file_path);
        }
    }

    files.sort();
    Ok(files)
}
