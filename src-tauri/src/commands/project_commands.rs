// 项目 CRUD 命令模块
//
// 功能概述：
// 提供项目创建、扫描、导入、删除、元数据更新等 Tauri 命令。
// 所有命令均返回 Result<T, AppError>，向前端传递结构化错误信息。
//
// 模块职责：
// 1. 创建小说项目（生成完整目录结构与预设引导文件）
// 2. 扫描本地项目列表
// 3. 导入已有项目
// 4. 删除项目（移至系统回收站）
// 5. 更新项目元数据（原子写入）
// 6. 打开目录选择对话框

use std::fs;
use std::path::PathBuf;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::commands::{
    count_project_chapters, read_project_meta, validate_project_path, ProjectInfo,
};
use crate::error::AppError;
use crate::project_template::{
    create_project_meta_v2, render_template, standard_template_files, universal_directories,
    StandardProjectType, TemplateVars,
};

/// 创建小说项目命令
/// 输入: name 项目名称, type_str 文体类型(novel/script/essay), genre 题材(可选),
///       author 作者, description 描述, parent_path 父目录, custom_dirs 自定义目录(可选)
/// 输出: Result<String, AppError> 项目根目录路径或错误
/// 流程:
///   1. 校验项目名称合法性
///   2. 解析标准文体类型(Novel/Script/Essay)
///   3. 创建统一一级目录(正文/设定/大纲/草稿箱/.novelforge)
///   4. 写入文体对应的预设引导文件
///   5. 写入项目元数据文件
///   6. 创建自定义模板目录(如果有)
#[tauri::command]
pub fn create_project(
    name: String,
    type_str: String,
    genre: String,
    author: String,
    description: String,
    parent_path: String,
    custom_dirs: Option<Vec<String>>,
) -> Result<String, AppError> {
    // 校验项目名称: 不允许空值或特殊字符
    if name.trim().is_empty() {
        return Err(AppError::path_validation_error("项目名称不能为空"));
    }
    // 校验名称中的非法字符
    let invalid_chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    if name.chars().any(|c| invalid_chars.contains(&c)) {
        return Err(AppError::path_validation_error("项目名称包含非法字符"));
    }

    // 解析为标准文体类型(Novel/Script/Essay)
    let project_type = StandardProjectType::from_str(&type_str);
    let project_root = PathBuf::from(&parent_path).join(&name);

    // 检查目录是否已存在
    if project_root.exists() {
        return Err(AppError::path_validation_error(format!(
            "目录已存在: {}",
            project_root.display()
        )));
    }

    // 创建项目根目录
    fs::create_dir_all(&project_root)
        .map_err(|e| AppError::io_error(e, "创建项目目录失败"))?;

    // 创建统一一级目录(所有文体共享 5 个标准目录 + .novelforge 元数据目录)
    for dir in universal_directories() {
        let dir_path = project_root.join(dir);
        fs::create_dir_all(&dir_path)
            .map_err(|e| AppError::io_error(e, format!("创建目录失败 {}", dir)))?;
    }

    // 创建自定义模板目录（如果有，用于自定义模板补充的目录）
    if let Some(ref dirs_list) = custom_dirs {
        for dir in dirs_list {
            // 跳过与统一目录重名的目录
            let dir_path = project_root.join(dir);
            if !dir_path.exists() {
                fs::create_dir_all(&dir_path)
                    .map_err(|e| AppError::io_error(e, format!("创建自定义目录失败 {}", dir)))?;
            }
        }
    }

    // 构造模板变量：用于替换预设文件中的 {{项目名}} {{作者名}} {{当前日期}} 等占位符
    let now = chrono::Local::now();
    let template_vars = TemplateVars {
        project_name: name.clone(),
        author: author.clone(),
        date: now.format("%Y-%m-%d").to_string(),
        time: now.format("%H:%M").to_string(),
        year: now.format("%Y").to_string(),
        month: now.format("%m").to_string(),
        project_type_label: project_type.label().to_string(),
        genre: genre.clone(),
        description: description.clone(),
    };

    // 写入文体对应的预设引导文件(应用模板变量替换)
    for (rel_path, content) in standard_template_files(&project_type) {
        let file_path = project_root.join(rel_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| AppError::io_error(e, "创建父目录失败"))?;
        }
        let rendered = render_template(&content, &template_vars);
        fs::write(&file_path, rendered)
            .map_err(|e| AppError::io_error(e, format!("写入预设文件失败 {}", rel_path)))?;
    }

    // 写入项目元数据(使用标准文体枚举,project_type 字段存储 to_str 值)
    let meta = create_project_meta_v2(&name, &project_type, &genre, &author, &description);
    let meta_path = project_root.join(".novelforge").join("project.json");
    let meta_json = serde_json::to_string_pretty(&meta)
        .map_err(|e| AppError::serialize_error(e, "序列化元数据失败"))?;
    fs::write(&meta_path, meta_json).map_err(|e| AppError::io_error(e, "写入元数据失败"))?;

    // 初始化空 manifest(项目级统一索引,生成新 projectId)
    // 存储位置：<project>/.novelforge/manifest.json
    // 后续文件 IO 命令(create_file/delete_path/rename_path)会自动同步实体记录
    let mut manifest = crate::manifest::Manifest::default();
    crate::manifest::save_manifest(&project_root, &mut manifest)?;

    Ok(project_root.to_string_lossy().to_string())
}

/// 扫描指定目录下的所有 喵创说 项目
/// 输入: parent_path 父目录路径
/// 输出: Result<Vec<ProjectInfo>, AppError> 项目信息列表或错误
/// 流程:
///   1. 遍历父目录下的子目录
///   2. 检查每个子目录是否包含 .novelforge/project.json
///   3. 解析元数据并返回项目列表
#[tauri::command]
pub fn scan_projects(parent_path: String) -> Result<Vec<ProjectInfo>, AppError> {
    let parent = validate_project_path(&parent_path).or_else(|_| {
        // scan_projects 接受非项目目录（如用户选择的上层目录），仅做基本校验
        let p = PathBuf::from(&parent_path);
        if p.exists() && p.is_dir() {
            Ok(p)
        } else {
            Err(AppError::path_validation_error(format!(
                "目录不存在: {}",
                parent_path
            )))
        }
    })?;

    let mut projects = Vec::new();
    let entries = fs::read_dir(&parent).map_err(|e| AppError::io_error(e, "读取目录失败"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let meta_path = path.join(".novelforge").join("project.json");
        if !meta_path.exists() {
            continue;
        }
        match read_project_meta(&path) {
            Ok(meta) => {
                // Task 4.5.2: word_count 已从 ProjectInfo 移除,字数 SSOT 收敛到 WritingStats
                // 前端获取字数时调用 get_writing_stats 命令读取 WritingStats.total_words
                let chapter_count = count_project_chapters(&path);
                projects.push(ProjectInfo {
                    path: path.to_string_lossy().to_string(),
                    meta,
                    chapter_count,
                });
            }
            Err(_) => continue,
        }
    }

    // 按最后修改时间降序排序
    projects.sort_by(|a, b| b.meta.updated_at.cmp(&a.meta.updated_at));
    Ok(projects)
}

/// 打开目录选择对话框
/// 输入: app AppHandle
/// 输出: Result<Option<String>, AppError> 选中目录路径或错误
/// 流程: 调用 Tauri dialog 插件弹出目录选择器，使用异步通道避免阻塞
#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> Result<Option<String>, AppError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("选择项目保存位置")
        .pick_folder(move |path| {
            let result = path.map(|p| p.to_string());
            let _ = tx.send(result);
        });
    let result = rx
        .await
        .map_err(|e| AppError::config_error(format!("对话框错误: {}", e)))?;
    Ok(result)
}

/// 导入已有项目
/// 输入: project_path 项目根目录路径
/// 输出: Result<ProjectInfo, AppError> 项目信息或错误
/// 流程: 校验目录是否为有效 喵创说 项目并返回信息
#[tauri::command]
pub fn import_project(project_path: String) -> Result<ProjectInfo, AppError> {
    let path = validate_project_path(&project_path)?;
    let meta_path = path.join(".novelforge").join("project.json");
    if !meta_path.exists() {
        return Err(AppError::path_validation_error(
            "不是有效的 喵创说 项目(缺少元数据文件)",
        ));
    }
    let meta = read_project_meta(&path)?;
    // Task 4.5.2: word_count 已从 ProjectInfo 移除,字数 SSOT 收敛到 WritingStats
    let chapter_count = count_project_chapters(&path);
    Ok(ProjectInfo {
        path: path.to_string_lossy().to_string(),
        meta,
        chapter_count,
    })
}

/// 删除项目（移至系统回收站）
/// 输入: project_path 项目根目录路径
/// 输出: Result<(), AppError> 成功或错误
/// 流程: 校验路径存在且为有效项目，移至系统回收站
/// 注意: 前端在调用前应显示确认对话框
#[tauri::command]
pub fn delete_project(project_path: String) -> Result<(), AppError> {
    let path = validate_project_path(&project_path)?;
    // 验证是有效的 喵创说 项目（防止误删非项目目录）
    let meta_path = path.join(".novelforge").join("project.json");
    if !meta_path.exists() {
        return Err(AppError::path_validation_error(
            "不是有效的 喵创说 项目（缺少元数据文件）",
        ));
    }
    trash::delete(&path).map_err(|e| {
        AppError::io_error(
            std::io::Error::new(std::io::ErrorKind::Other, e),
            "删除项目失败",
        )
    })
}

/// 更新项目元数据（编辑项目设定）
/// 输入:
///   project_path 项目根目录路径
///   name 项目名称
///   genre 题材（可为空字符串）
///   author 作者
///   description 描述
/// 输出: Result<ProjectInfo, AppError> 更新后的项目信息
/// 流程:
///   1. 校验项目路径有效且为有效项目
///   2. 校验新名称合法性
///   3. 读取现有元数据（保留 created_at/version/project_type 不可变字段）
///   4. 更新可编辑字段与 updated_at 时间戳
///   5. 重新统计字数与章节数，同步到 meta
///   6. 原子写入元数据文件（临时文件 + rename，防止写入中途崩溃损坏 JSON）
///   7. 返回更新后的 ProjectInfo
/// 注意: 仅更新元数据字段，不重命名项目目录，避免破坏现有路径引用
#[tauri::command]
pub fn update_project_meta(
    project_path: String,
    name: String,
    genre: String,
    author: String,
    description: String,
) -> Result<ProjectInfo, AppError> {
    let path = validate_project_path(&project_path)?;
    let meta_path = path.join(".novelforge").join("project.json");
    if !meta_path.exists() {
        return Err(AppError::path_validation_error(
            "不是有效的 喵创说 项目（缺少元数据文件）",
        ));
    }

    // 校验项目名称合法性
    let name_trimmed = name.trim();
    if name_trimmed.is_empty() {
        return Err(AppError::path_validation_error("项目名称不能为空"));
    }
    let invalid_chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    if name_trimmed.chars().any(|c| invalid_chars.contains(&c)) {
        return Err(AppError::path_validation_error("项目名称包含非法字符"));
    }

    // 读取现有元数据，保留 created_at/version/project_type 等不可变字段
    let mut meta = read_project_meta(&path)?;
    meta.name = name_trimmed.to_string();
    meta.genre = genre;
    meta.author = author.trim().to_string();
    meta.description = description.trim().to_string();
    // 更新最后修改时间（ISO 8601）
    meta.updated_at = chrono::Local::now().to_rfc3339();

    // Task 4.5.2: 字数 SSOT 收敛到 WritingStats,不再同步 meta.word_count
    // ProjectMeta.word_count 字段保留用于旧版兼容读取,但不再主动更新
    // 前端获取字数时调用 get_writing_stats 命令读取 WritingStats.total_words
    let chapter_count = count_project_chapters(&path);

    // 原子写入元数据文件：先写入临时文件，再 rename 替换
    // 防止写入中途崩溃导致 project.json 损坏
    let meta_json = serde_json::to_string_pretty(&meta)
        .map_err(|e| AppError::serialize_error(e, "序列化元数据失败"))?;
    let tmp_path = meta_path.with_extension("json.tmp");
    fs::write(&tmp_path, meta_json).map_err(|e| AppError::io_error(e, "写入元数据失败"))?;
    fs::rename(&tmp_path, &meta_path).map_err(|e| {
        // rename 失败时清理临时文件，避免残留
        let _ = fs::remove_file(&tmp_path);
        AppError::io_error(e, "替换元数据文件失败")
    })?;

    Ok(ProjectInfo {
        path: path.to_string_lossy().to_string(),
        meta,
        chapter_count,
    })
}
