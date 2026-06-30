// 文件系统操作命令模块
//
// 功能概述：
// 提供 Tauri 命令接口，供前端调用以创建、读取、管理小说项目。
// 所有文件操作均经过路径沙箱校验，限制在项目目录内。
//
// 模块职责：
// 1. 创建小说项目(生成完整目录结构)
// 2. 扫描本地项目列表
// 3. 读取项目元数据
// 4. 导入已有项目
// 5. 统计项目字数

use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::project_template::{
    common_directories, common_files, create_project_meta, initial_manuscript_file,
    type_specific_directories, type_specific_files, ProjectMeta, ProjectType,
};

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
fn get_templates_dir() -> Result<PathBuf, String> {
    let config_dir = dirs::config_dir()
        .ok_or_else(|| "无法获取配置目录".to_string())?;
    let templates_dir = config_dir.join("novelforge").join("templates");
    if !templates_dir.exists() {
        fs::create_dir_all(&templates_dir)
            .map_err(|e| format!("创建模板目录失败: {}", e))?;
    }
    Ok(templates_dir)
}

/// 路径沙箱校验：确保目标路径在项目根目录内
/// 输入: target_path 目标路径, project_root 项目根目录
/// 输出: Result<PathBuf, String> 规范化后的目标路径或错误
/// 流程: 规范化两个路径并验证包含关系，防止目录穿越攻击
fn validate_path_in_project(target: &str, project_root: &str) -> Result<PathBuf, String> {
    let root_path = PathBuf::from(project_root)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;

    if !root_path.exists() {
        return Err("项目路径不存在".to_string());
    }

    // 归一化目标路径分隔符（处理前端传入的混合分隔符路径）
    let normalized_target = normalize_path_separators(target);
    let target_path = PathBuf::from(&normalized_target);

    // 如果目标路径已存在，直接 canonicalize；否则 canonicalize 父目录后拼接文件名
    let canonical = if target_path.exists() {
        target_path
            .canonicalize()
            .map_err(|e| format!("无法解析路径: {}", e))?
    } else {
        // 目标路径不存在（如新建文件），canonicalize 父目录
        let parent = target_path.parent().unwrap_or(std::path::Path::new(""));
        if parent.exists() {
            let canonical_parent = parent
                .canonicalize()
                .map_err(|e| format!("无法解析父路径: {}", e))?;
            let filename = target_path
                .file_name()
                .ok_or_else(|| "无效的文件路径".to_string())?;
            canonical_parent.join(filename)
        } else {
            // 父目录也不存在，做词法检查（路径归一化后比较前缀）
            // 关键：去掉 \\?\ 长路径前缀后再比较，防止误判
            let target_str = strip_verbatim_prefix(&target_path.to_string_lossy()).replace('\\', "/");
            let root_str = strip_verbatim_prefix(&root_path.to_string_lossy()).replace('\\', "/");
            if target_str.starts_with(&root_str) {
                target_path.clone()
            } else {
                return Err(format!(
                    "路径越界: 不允许访问项目目录外的路径 ({} 不在 {} 内)",
                    target_path.display(),
                    root_path.display()
                ));
            }
        }
    };

    // 检查目标路径是否以项目根目录开头
    if !canonical.starts_with(&root_path) {
        return Err(format!(
            "路径越界: 不允许访问项目目录外的路径 ({} 不在 {} 内)",
            canonical.display(),
            root_path.display()
        ));
    }

    Ok(canonical)
}

/// 去掉 Windows 长路径前缀 \\?\ 或 //?/
fn strip_verbatim_prefix(path: &str) -> &str {
    path.strip_prefix(r"\\?\")
        .or_else(|| path.strip_prefix("//?/"))
        .unwrap_or(path)
}

/// 统一路径分隔符为平台原生分隔符（Windows 用 \，Unix 用 /）
/// 解决前端传入混合分隔符路径（如 C:\...\test/对话场景\file.txt）的问题
fn normalize_path_separators(path: &str) -> String {
    if cfg!(windows) {
        path.replace('/', "\\")
    } else {
        path.replace('\\', "/")
    }
}

/// 项目路径校验：确保路径是有效的项目根目录
/// 用于 scan_projects/import_project/delete_project/read_project_tree 等接受项目路径的命令
fn validate_project_path(project_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;
    if !path.is_dir() {
        return Err("项目路径不是目录".to_string());
    }
    Ok(path)
}

/// 创建小说项目命令
/// 输入: name 项目名称, type_str 文体类型, genre 题材(可选), author 作者, description 描述, parent_path 父目录
/// 输出: Result<String, String> 项目根目录路径或错误
/// 流程:
///   1. 校验项目名称合法性
///   2. 构建项目根目录路径
///   3. 创建通用目录与专属目录
///   4. 写入通用预设文件与专属预设文件
///   5. 写入项目元数据文件
#[tauri::command]
pub fn create_project(
    name: String,
    type_str: String,
    genre: String,
    author: String,
    description: String,
    parent_path: String,
    custom_dirs: Option<Vec<String>>,
) -> Result<String, String> {
    // 校验项目名称: 不允许空值或特殊字符
    if name.trim().is_empty() {
        return Err("项目名称不能为空".to_string());
    }
    // 校验名称中的非法字符
    let invalid_chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    if name.chars().any(|c| invalid_chars.contains(&c)) {
        return Err("项目名称包含非法字符".to_string());
    }

    let project_type = ProjectType::from_str(&type_str);
    let project_root = PathBuf::from(&parent_path).join(&name);

    // 检查目录是否已存在
    if project_root.exists() {
        return Err(format!("目录已存在: {}", project_root.display()));
    }

    // 创建项目根目录
    fs::create_dir_all(&project_root).map_err(|e| format!("创建项目目录失败: {}", e))?;

    // 创建通用目录
    for dir in common_directories() {
        let dir_path = project_root.join(dir);
        fs::create_dir_all(&dir_path).map_err(|e| format!("创建目录失败 {}: {}", dir, e))?;
    }

    // 创建类型专属目录
    for dir in type_specific_directories(&project_type) {
        let dir_path = project_root.join(dir);
        fs::create_dir_all(&dir_path).map_err(|e| format!("创建专属目录失败 {}: {}", dir, e))?;
    }

    // 创建自定义模板目录（如果有）
    if let Some(ref dirs_list) = custom_dirs {
        for dir in dirs_list {
            // 跳过与通用目录或专属目录重名的目录
            let dir_path = project_root.join(dir);
            if !dir_path.exists() {
                fs::create_dir_all(&dir_path)
                    .map_err(|e| format!("创建自定义目录失败 {}: {}", dir, e))?;
            }
        }
    }

    // 写入通用预设文件
    for (rel_path, content) in common_files() {
        let file_path = project_root.join(rel_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
        }
        fs::write(&file_path, content)
            .map_err(|e| format!("写入文件失败 {}: {}", rel_path, e))?;
    }

    // 写入类型专属预设文件
    for (rel_path, content) in type_specific_files(&project_type) {
        let file_path = project_root.join(rel_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
        }
        fs::write(&file_path, content)
            .map_err(|e| format!("写入专属文件失败 {}: {}", rel_path, e))?;
    }

    // 写入项目元数据
    let meta = create_project_meta(&name, &project_type, &genre, &author, &description);
    let meta_path = project_root.join(".novelforge").join("project.json");
    let meta_json = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("序列化元数据失败: {}", e))?;
    fs::write(&meta_path, meta_json)
        .map_err(|e| format!("写入元数据失败: {}", e))?;

    // 创建正文初始文件（当前所有类型均不自动创建，由用户自行创建）
    if let Some((manuscript_name, manuscript_content)) = initial_manuscript_file(&project_type) {
        let manuscript_path = project_root.join("正文").join(manuscript_name);
        if let Some(parent) = manuscript_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建正文子目录失败: {}", e))?;
        }
        fs::write(&manuscript_path, manuscript_content)
            .map_err(|e| format!("创建正文文件失败: {}", e))?;
    }

    Ok(project_root.to_string_lossy().to_string())
}

/// 扫描指定目录下的所有 NovelForge 项目
/// 输入: parent_path 父目录路径
/// 输出: Result<Vec<ProjectInfo>, String> 项目信息列表或错误
/// 流程:
///   1. 遍历父目录下的子目录
///   2. 检查每个子目录是否包含 .novelforge/project.json
///   3. 解析元数据并返回项目列表
#[tauri::command]
pub fn scan_projects(parent_path: String) -> Result<Vec<ProjectInfo>, String> {
    let parent = validate_project_path(&parent_path).or_else(|_| {
        // scan_projects 接受非项目目录（如用户选择的上层目录），仅做基本校验
        let p = PathBuf::from(&parent_path);
        if p.exists() && p.is_dir() {
            Ok(p)
        } else {
            Err(format!("目录不存在: {}", parent_path))
        }
    })?;

    let mut projects = Vec::new();
    let entries = fs::read_dir(&parent).map_err(|e| format!("读取目录失败: {}", e))?;

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
                let word_count = count_project_words(&path);
                let chapter_count = count_project_chapters(&path);
                projects.push(ProjectInfo {
                    path: path.to_string_lossy().to_string(),
                    meta,
                    word_count,
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

/// 项目信息结构(包含路径与元数据)
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectInfo {
    /// 项目根目录绝对路径
    pub path: String,
    /// 项目元数据
    pub meta: ProjectMeta,
    /// 项目总字数
    pub word_count: u64,
    /// 正文章节总数(正文目录下的 .txt 文件数)
    pub chapter_count: u64,
}

/// 读取项目元数据
/// 输入: project_root 项目根目录
/// 输出: Result<ProjectMeta, String> 元数据或错误
/// 流程: 读取并解析 project.json
fn read_project_meta(project_root: &Path) -> Result<ProjectMeta, String> {
    let meta_path = project_root.join(".novelforge").join("project.json");
    let content = fs::read_to_string(&meta_path)
        .map_err(|e| format!("读取元数据失败: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析元数据失败: {}", e))
}

/// 统计项目总字数
/// 输入: project_root 项目根目录
/// 输出: u64 总字数
/// 流程: 遍历正文目录下的所有 .txt 文件，统计字符数
fn count_project_words(project_root: &Path) -> u64 {
    let content_dir = project_root.join("正文");
    if !content_dir.exists() {
        return 0;
    }
    let mut total: u64 = 0;
    count_words_recursive(&content_dir, &mut total);
    total
}

/// 统计项目正文章节数
/// 输入: project_root 项目根目录
/// 输出: u64 章节总数
/// 流程: 递归统计正文目录下的 .txt 文件数量
fn count_project_chapters(project_root: &Path) -> u64 {
    let content_dir = project_root.join("正文");
    if !content_dir.exists() {
        return 0;
    }
    let mut total: u64 = 0;
    count_chapters_recursive(&content_dir, &mut total);
    total
}

/// 递归统计目录下的章节数
/// 输入: dir 目录路径, total 累计章节数
/// 输出: 无
/// 流程: 遍历目录，对 .txt 文件计数
fn count_chapters_recursive(dir: &Path, total: &mut u64) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                count_chapters_recursive(&path, total);
            } else if path.extension().map(|e| e == "txt").unwrap_or(false) {
                *total += 1;
            }
        }
    }
}

/// 递归统计目录下文件字数
/// 输入: dir 目录路径, total 累计字数
/// 输出: 无
/// 流程: 遍历目录，对 .txt 文件统计字符数
fn count_words_recursive(dir: &Path, total: &mut u64) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                count_words_recursive(&path, total);
            } else if path.extension().map(|e| e == "txt").unwrap_or(false) {
                if let Ok(content) = fs::read_to_string(&path) {
                    // 中文字符按 1 字计算，英文单词按 1 字计算
                    *total += count_chinese_and_words(&content);
                }
            }
        }
    }
}

/// 统计中文字符与英文单词数
/// 输入: text 文本内容
/// 输出: u64 字数
/// 流程: 遍历字符，中文字符计数，英文连续字母作为一个单词
fn count_chinese_and_words(text: &str) -> u64 {
    let mut count: u64 = 0;
    let mut in_word = false;
    for ch in text.chars() {
        // 中文字符范围(基本汉字 + 扩展)
        if ('\u{4E00}'..='\u{9FFF}').contains(&ch)
            || ('\u{3400}'..='\u{4DBF}').contains(&ch)
            || ('\u{F900}'..='\u{FAFF}').contains(&ch)
        {
            count += 1;
            in_word = false;
        } else if ch.is_alphabetic() {
            if !in_word {
                count += 1;
                in_word = true;
            }
        } else {
            in_word = false;
        }
    }
    count
}

/// 打开目录选择对话框
/// 输入: app AppHandle
/// 输出: Result<Option<String>, String> 选中目录路径或错误
/// 流程: 调用 Tauri dialog 插件弹出目录选择器，使用异步通道避免阻塞
#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("选择项目保存位置")
        .pick_folder(move |path| {
            let result = path.map(|p| p.to_string());
            let _ = tx.send(result);
        });
    let result = rx.await.map_err(|e| format!("对话框错误: {}", e))?;
    Ok(result)
}

/// 导入已有项目
/// 输入: project_path 项目根目录路径
/// 输出: Result<ProjectInfo, String> 项目信息或错误
/// 流程: 校验目录是否为有效 NovelForge 项目并返回信息
#[tauri::command]
pub fn import_project(project_path: String) -> Result<ProjectInfo, String> {
    let path = validate_project_path(&project_path)?;
    let meta_path = path.join(".novelforge").join("project.json");
    if !meta_path.exists() {
        return Err("不是有效的 NovelForge 项目(缺少元数据文件)".to_string());
    }
    let meta = read_project_meta(&path)?;
    let word_count = count_project_words(&path);
    let chapter_count = count_project_chapters(&path);
    Ok(ProjectInfo {
        path: path.to_string_lossy().to_string(),
        meta,
        word_count,
        chapter_count,
    })
}

/// 读取项目目录树
/// 输入: project_path 项目根目录
/// 输出: Result<Vec<FileNode>, String> 目录树节点列表
/// 流程: 递归读取目录结构并返回树形数据
#[tauri::command]
pub fn read_project_tree(project_path: String) -> Result<Vec<FileNode>, String> {
    let path = validate_project_path(&project_path)?;
    read_dir_recursive(&path, &path)
}

/// 文件节点结构
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileNode {
    /// 节点名称
    pub name: String,
    /// 相对路径(相对于项目根目录)
    pub relative_path: String,
    /// 是否为目录
    pub is_dir: bool,
    /// 子节点(仅目录有)
    pub children: Vec<FileNode>,
    /// 文件大小(字节,文件节点有效)
    pub size: u64,
}

/// 递归读取目录
/// 输入: current 当前路径, root 项目根路径
/// 输出: Result<Vec<FileNode>, String> 节点列表
/// 流程: 遍历目录构建树形结构，忽略 .novelforge 隐藏目录
fn read_dir_recursive(current: &Path, root: &Path) -> Result<Vec<FileNode>, String> {
    let mut nodes = Vec::new();
    let entries = fs::read_dir(current).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // 忽略隐藏目录和文件
        if name.starts_with('.') {
            continue;
        }

        let metadata = entry.metadata().map_err(|e| format!("读取元数据失败: {}", e))?;
        let is_dir = metadata.is_dir();

        // 非目录文件仅允许 .txt 扩展名（应用仅支持 .txt 文件）
        if !is_dir {
            let ext = path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            if ext != "txt" {
                continue;
            }
        }

        let relative_path = path
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| name.clone());

        let size = if is_dir { 0 } else { metadata.len() };

        let children = if is_dir {
            read_dir_recursive(&path, root)?
        } else {
            vec![]
        };

        nodes.push(FileNode {
            name,
            relative_path,
            is_dir,
            children,
            size,
        });
    }

    // 目录优先排序
    nodes.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(nodes)
}

/// 读取文件内容（含路径沙箱校验）
/// 输入: file_path 文件绝对路径, project_path 项目根目录用于校验
/// 输出: Result<String, String> 文件内容或错误
/// 流程: 校验路径在项目内，读取文本文件内容
#[tauri::command]
pub fn read_file(file_path: String, project_path: String) -> Result<String, String> {
    let validated = validate_path_in_project(&file_path, &project_path)?;
    // 文件大小限制: 50MB，防止内存溢出
    const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;
    if let Ok(metadata) = fs::metadata(&validated) {
        if metadata.len() > MAX_FILE_SIZE {
            return Err(format!("文件过大 ({}MB)，超过限制 (50MB)", metadata.len() / 1024 / 1024));
        }
    }
    fs::read_to_string(&validated).map_err(|e| format!("读取文件失败: {}", e))
}

/// 写入文件内容（含路径沙箱校验）
/// 输入: file_path 文件路径, content 内容, project_path 项目根目录
/// 输出: Result<(), String> 成功或错误
/// 流程: 校验路径后创建父目录并写入
#[tauri::command]
pub fn write_file(file_path: String, content: String, project_path: String) -> Result<(), String> {
    let validated = validate_path_in_project(&file_path, &project_path)?;
    if let Some(parent) = validated.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(&validated, content).map_err(|e| format!("写入文件失败: {}", e))
}

/// 创建新文件（含路径沙箱校验）
/// 输入: project_path 项目路径, relative_path 相对路径, content 内容
/// 输出: Result<String, String> 文件绝对路径或错误
/// 流程: 在校验后的项目目录内创建新文件
#[tauri::command]
pub fn create_file(
    project_path: String,
    relative_path: String,
    content: String,
) -> Result<String, String> {
    let root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;
    let file_path = root.join(&relative_path);

    // 使用统一的沙箱校验
    let validated = validate_path_in_project(
        &file_path.to_string_lossy(),
        &project_path,
    )?;

    if validated.exists() {
        return Err("文件已存在".to_string());
    }
    if let Some(parent) = validated.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(&validated, content).map_err(|e| format!("创建文件失败: {}", e))?;
    Ok(validated.to_string_lossy().to_string())
}

/// 删除文件或目录（含路径沙箱校验，移至回收站）
/// 输入: path 路径, project_path 项目根目录
/// 输出: Result<(), String> 成功或错误
/// 流程: 校验路径后移至系统回收站
#[tauri::command]
pub fn delete_path(path: String, project_path: String) -> Result<(), String> {
    let p = validate_path_in_project(&path, &project_path)?;
    trash::delete(&p).map_err(|e| format!("删除失败: {}", e))
}

/// 重命名文件或目录（含路径沙箱校验）
/// 输入: old_path 原路径, new_path 新路径, project_path 项目根目录
/// 输出: Result<(), String> 成功或错误
/// 流程: 校验原路径在项目内，校验新路径在项目内且不存在，执行重命名
#[tauri::command]
pub fn rename_path(
    old_path: String,
    new_path: String,
    project_path: String,
) -> Result<(), String> {
    // 校验原路径（必须存在，用 validate_path_in_project）
    let old_abs = validate_path_in_project(&old_path, &project_path)?;

    // 使用统一的沙箱校验新路径
    let new_abs = validate_path_in_project(&new_path, &project_path)?;

    // 检查目标路径是否已存在
    if new_abs.exists() {
        return Err("目标路径已存在".to_string());
    }

    // 确保新路径的父目录存在
    if let Some(parent) = new_abs.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
    }

    // 执行重命名
    fs::rename(&old_abs, &new_abs).map_err(|e| format!("重命名失败: {}", e))
}

/// 删除项目（移至系统回收站）
/// 输入: project_path 项目根目录路径
/// 输出: Result<(), String> 成功或错误
/// 流程: 校验路径存在且为有效项目，移至系统回收站
/// 注意: 前端在调用前应显示确认对话框
#[tauri::command]
pub fn delete_project(project_path: String) -> Result<(), String> {
    let path = validate_project_path(&project_path)?;
    // 验证是有效的 NovelForge 项目（防止误删非项目目录）
    let meta_path = path.join(".novelforge").join("project.json");
    if !meta_path.exists() {
        return Err("不是有效的 NovelForge 项目（缺少元数据文件）".to_string());
    }
    trash::delete(&path).map_err(|e| format!("删除项目失败: {}", e))
}

/// 搜索结果项结构
#[derive(Debug, Clone, serde::Serialize)]
pub struct SearchResult {
    /// 文件相对路径
    pub relative_path: String,
    /// 文件名
    pub file_name: String,
    /// 匹配行号(从1开始)
    pub line_number: u64,
    /// 匹配行内容
    pub line_content: String,
    /// 匹配内容前 40 字符上下文
    pub context_before: String,
    /// 匹配内容后 40 字符上下文
    pub context_after: String,
}

/// 全局搜索项目内文本内容
/// 输入: project_path 项目路径, query 搜索关键词, case_sensitive 是否区分大小写
/// 输出: Result<Vec<SearchResult>, String> 搜索结果列表
/// 流程: 递归遍历项目内所有 .txt 文件，逐行匹配关键词
#[tauri::command]
pub fn search_in_project(
    project_path: String,
    query: String,
    case_sensitive: bool,
) -> Result<Vec<SearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    let root = validate_project_path(&project_path)?;
    let mut results = Vec::new();
    let search_query = if case_sensitive {
        query.clone()
    } else {
        query.to_lowercase()
    };
    search_recursive(&root, &root, &search_query, case_sensitive, &mut results);
    // 限制最大结果数为 200 条，避免性能问题
    results.truncate(200);
    Ok(results)
}

/// 递归搜索目录下文件内容
/// 输入: current 当前路径, root 项目根路径, query 搜索词, case_sensitive 区分大小写, results 结果集合
/// 输出: 无
/// 流程: 遍历目录，对 .txt 文件逐行搜索匹配内容
fn search_recursive(
    current: &Path,
    root: &Path,
    query: &str,
    case_sensitive: bool,
    results: &mut Vec<SearchResult>,
) {
    if let Ok(entries) = fs::read_dir(current) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            // 跳过隐藏目录
            if name.starts_with('.') {
                continue;
            }
            if path.is_dir() {
                search_recursive(&path, root, query, case_sensitive, results);
            } else if path.extension().map(|e| e == "txt").unwrap_or(false) {
                search_in_file(&path, root, query, case_sensitive, results);
            }
        }
    }
}

/// 在单个文件中搜索关键词
/// 输入: file_path 文件路径, root 项目根路径, query 搜索词, case_sensitive 区分大小写, results 结果集合
/// 输出: 无
/// 流程: 逐行读取文件内容，匹配关键词并记录上下文
fn search_in_file(
    file_path: &Path,
    root: &Path,
    query: &str,
    case_sensitive: bool,
    results: &mut Vec<SearchResult>,
) {
    if let Ok(content) = fs::read_to_string(file_path) {
        let relative_path = file_path
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let file_name = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        for (idx, line) in content.lines().enumerate() {
            let line_to_check = if case_sensitive {
                line.to_string()
            } else {
                line.to_lowercase()
            };
            if line_to_check.contains(query) {
                // 提取匹配位置前后 40 字符作为上下文（安全 UTF-8 字符边界）
                let match_pos = line_to_check.find(query).unwrap_or(0);
                let match_end = match_pos + query.len();

                // 找到 start 位置最近的 UTF-8 字符边界（向前扫描）
                let start = {
                    let s = if match_pos > 40 { match_pos - 40 } else { 0 };
                    let mut p = s;
                    while p < match_pos && !line.is_char_boundary(p) {
                        p += 1;
                    }
                    p
                };

                // 找到 end 位置最近的 UTF-8 字符边界（向后扫描）
                let end = {
                    let e = (match_end + 40).min(line.len());
                    let mut p = e;
                    while p < line.len() && !line.is_char_boundary(p) {
                        p += 1;
                    }
                    p
                };

                let context_before = line[start..match_pos].to_string();
                let context_after = line[match_end.min(line.len())..end].to_string();
                results.push(SearchResult {
                    relative_path: relative_path.clone(),
                    file_name: file_name.clone(),
                    line_number: (idx + 1) as u64,
                    line_content: line.to_string(),
                    context_before,
                    context_after,
                });
            }
        }
    }
}

/// 写作统计信息结构
#[derive(Debug, Clone, serde::Serialize)]
pub struct WritingStats {
    /// 总字数
    pub total_words: u64,
    /// 总章节数
    pub total_chapters: u64,
    /// 总文件数(含设定文件)
    pub total_files: u64,
    /// 正文字数
    pub manuscript_words: u64,
    /// 设定文件字数(角色/世界观/名词等)
    pub setting_words: u64,
    /// 大纲字数
    pub outline_words: u64,
    /// 各章节字数列表(文件名, 字数)
    pub chapter_words: Vec<ChapterWordCount>,
    /// 项目创建天数
    pub days_since_creation: u64,
}

/// 章节字数统计项
#[derive(Debug, Clone, serde::Serialize)]
pub struct ChapterWordCount {
    /// 文件名
    pub file_name: String,
    /// 相对路径
    pub relative_path: String,
    /// 字数
    pub word_count: u64,
}

/// 获取项目写作统计信息
/// 输入: project_path 项目路径
/// 输出: Result<WritingStats, String> 统计信息
/// 流程: 遍历项目各目录统计字数与文件数
#[tauri::command]
pub fn get_writing_stats(project_path: String) -> Result<WritingStats, String> {
    let root = validate_project_path(&project_path)?;

    // 统计正文字数与章节列表
    let manuscript_dir = root.join("正文");
    let mut manuscript_words: u64 = 0;
    let mut chapter_words: Vec<ChapterWordCount> = Vec::new();
    if manuscript_dir.exists() {
        collect_chapter_stats(&manuscript_dir, &root, &mut manuscript_words, &mut chapter_words);
    }
    // 按字数降序排序
    chapter_words.sort_by(|a, b| b.word_count.cmp(&a.word_count));

    // 统计设定文件字数(角色/世界观/名词/时间线)
    let mut setting_words: u64 = 0;
    for dir_name in &["角色", "世界观", "名词", "时间线"] {
        let dir = root.join(dir_name);
        if dir.exists() {
            count_dir_words(&dir, &mut setting_words);
        }
    }

    // 统计大纲字数
    let mut outline_words: u64 = 0;
    let outline_dir = root.join("大纲");
    if outline_dir.exists() {
        count_dir_words(&outline_dir, &mut outline_words);
    }

    // 统计总文件数
    let mut total_files: u64 = 0;
    count_files_recursive(&root, &mut total_files);

    // 计算创建天数
    let meta_path = root.join(".novelforge").join("project.json");
    let days_since_creation = if let Ok(content) = fs::read_to_string(&meta_path) {
        if let Ok(meta) = serde_json::from_str::<crate::project_template::ProjectMeta>(&content) {
            if let Ok(created) = chrono::DateTime::parse_from_rfc3339(&meta.created_at) {
                let now = chrono::Local::now();
                (now.signed_duration_since(created).num_days().max(0)) as u64
            } else {
                0
            }
        } else {
            0
        }
    } else {
        0
    };

    Ok(WritingStats {
        total_words: manuscript_words + setting_words + outline_words,
        total_chapters: chapter_words.len() as u64,
        total_files,
        manuscript_words,
        setting_words,
        outline_words,
        chapter_words,
        days_since_creation,
    })
}

/// 递归收集章节字数统计
/// 输入: dir 目录路径, root 项目根路径, total_words 累计字数, chapters 章节列表
/// 输出: 无
/// 流程: 遍历正文目录，统计每个 .txt 文件的字数
fn collect_chapter_stats(
    dir: &Path,
    root: &Path,
    total_words: &mut u64,
    chapters: &mut Vec<ChapterWordCount>,
) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_chapter_stats(&path, root, total_words, chapters);
            } else if path.extension().map(|e| e == "txt").unwrap_or(false) {
                if let Ok(content) = fs::read_to_string(&path) {
                    let words = count_chinese_and_words(&content);
                    *total_words += words;
                    let relative_path = path
                        .strip_prefix(root)
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let file_name = path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    chapters.push(ChapterWordCount {
                        file_name,
                        relative_path,
                        word_count: words,
                    });
                }
            }
        }
    }
}

/// 递归统计目录下文件字数
/// 输入: dir 目录路径, total 累计字数
/// 输出: 无
/// 流程: 遍历目录，对 .txt 文件统计字数
fn count_dir_words(dir: &Path, total: &mut u64) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                count_dir_words(&path, total);
            } else if path.extension().map(|e| e == "txt").unwrap_or(false) {
                if let Ok(content) = fs::read_to_string(&path) {
                    *total += count_chinese_and_words(&content);
                }
            }
        }
    }
}

/// 递归统计目录下文件数
/// 输入: dir 目录路径, total 累计文件数
/// 输出: 无
/// 流程: 遍历目录，统计 .txt 文件数量
fn count_files_recursive(dir: &Path, total: &mut u64) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            if path.is_dir() {
                count_files_recursive(&path, total);
            } else if path.extension().map(|e| e == "txt").unwrap_or(false) {
                *total += 1;
            }
        }
    }
}

// ===== 自定义模板管理命令 =====

/// 列出所有自定义模板
/// 输出: Result<Vec<CustomTemplate>, String> 模板列表
#[tauri::command]
pub fn list_custom_templates() -> Result<Vec<CustomTemplate>, String> {
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
/// 输出: Result<(), String>
#[tauri::command]
pub fn save_custom_template(template: CustomTemplate) -> Result<(), String> {
    let templates_dir = get_templates_dir()?;
    let file_path = templates_dir.join(format!("{}.json", template.id));
    let json = serde_json::to_string_pretty(&template)
        .map_err(|e| format!("序列化模板失败: {}", e))?;
    fs::write(&file_path, json)
        .map_err(|e| format!("写入模板文件失败: {}", e))?;
    Ok(())
}

/// 删除自定义模板
/// 输入: id 模板 ID
/// 输出: Result<(), String>
#[tauri::command]
pub fn delete_custom_template(id: String) -> Result<(), String> {
    let templates_dir = get_templates_dir()?;
    let file_path = templates_dir.join(format!("{}.json", id));
    if file_path.exists() {
        fs::remove_file(&file_path)
            .map_err(|e| format!("删除模板文件失败: {}", e))?;
    }
    Ok(())
}
