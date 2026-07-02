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
use std::io::Write;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::project_template::{
    common_directories, common_files, create_project_meta, initial_manuscript_file,
    project_type_label, render_template, type_specific_directories, type_specific_files,
    ProjectMeta, ProjectType, TemplateVars,
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
/// 输入: target 目标路径, project_root 项目根目录
/// 输出: Result<PathBuf, String> 规范化后的目标路径或错误
/// 流程:
///   1. canonicalize 项目根路径（Windows 下返回带 \\?\ 前缀的绝对路径）
///   2. 归一化目标路径分隔符，处理前端传入的混合分隔符
///   3. 目标路径存在时直接 canonicalize
///   4. 目标路径不存在时 canonicalize 父目录后拼接文件名
///   5. 父目录也不存在时做纯词法检查，返回与根路径格式一致的路径
///   6. 统一使用规范化字符串比较包含关系，避免 Path::starts_with 在前缀差异下的误判
pub(crate) fn validate_path_in_project(target: &str, project_root: &str) -> Result<PathBuf, String> {
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
            // 父目录也不存在，做纯词法检查
            // 统一格式：去掉 \\?\ 前缀 + 正斜杠 + 小写（Windows 不区分大小写）
            let target_norm = normalize_for_compare(&target_path.to_string_lossy());
            let root_norm = normalize_for_compare(&root_path.to_string_lossy());
            if !target_norm.starts_with(&root_norm) {
                return Err(format!(
                    "路径越界: 不允许访问项目目录外的路径 ({} 不在 {} 内)",
                    target_path.display(),
                    root_path.display()
                ));
            }
            // 返回与 root_path 格式一致的路径（拼接相对部分），保证带 \\?\ 前缀
            // 这样后续 starts_with 比较才能与 root_path 匹配
            let relative = target_path
                .strip_prefix(&root_path)
                .unwrap_or(&target_path);
            root_path.join(relative)
        }
    };

    // 统一使用规范化字符串比较包含关系
    // 避免 Path::starts_with 在 \\?\ 前缀差异下误判（Windows 关键修复点）
    let canonical_norm = normalize_for_compare(&canonical.to_string_lossy());
    let root_norm = normalize_for_compare(&root_path.to_string_lossy());
    if !canonical_norm.starts_with(&root_norm) {
        return Err(format!(
            "路径越界: 不允许访问项目目录外的路径 ({} 不在 {} 内)",
            canonical.display(),
            root_path.display()
        ));
    }

    Ok(canonical)
}

/// 路径规范化比较函数
/// 输入: 路径字符串
/// 输出: 规范化后的字符串（去前缀 + 正斜杠 + 小写）
/// 流程: 去掉 \\?\ 前缀，统一为正斜杠，小写化以支持 Windows 大小写不敏感比较
fn normalize_for_compare(path: &str) -> String {
    strip_verbatim_prefix(path)
        .replace('\\', "/")
        .to_lowercase()
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

    // 构造模板变量：用于替换预设文件中的 {{项目名}} {{作者名}} {{当前日期}} 等占位符
    let now = chrono::Local::now();
    let template_vars = TemplateVars {
        project_name: name.clone(),
        author: author.clone(),
        date: now.format("%Y-%m-%d").to_string(),
        time: now.format("%H:%M").to_string(),
        year: now.format("%Y").to_string(),
        month: now.format("%m").to_string(),
        project_type_label: project_type_label(&project_type).to_string(),
        genre: genre.clone(),
        description: description.clone(),
    };

    // 写入通用预设文件（应用模板变量替换）
    for (rel_path, content) in common_files() {
        let file_path = project_root.join(rel_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
        }
        let rendered = render_template(content, &template_vars);
        fs::write(&file_path, rendered)
            .map_err(|e| format!("写入文件失败 {}: {}", rel_path, e))?;
    }

    // 写入类型专属预设文件（应用模板变量替换）
    for (rel_path, content) in type_specific_files(&project_type) {
        let file_path = project_root.join(rel_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
        }
        let rendered = render_template(&content, &template_vars);
        fs::write(&file_path, rendered)
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

/// 扫描指定目录下的所有 喵创说 项目
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
/// 流程: 校验目录是否为有效 喵创说 项目并返回信息
#[tauri::command]
pub fn import_project(project_path: String) -> Result<ProjectInfo, String> {
    let path = validate_project_path(&project_path)?;
    let meta_path = path.join(".novelforge").join("project.json");
    if !meta_path.exists() {
        return Err("不是有效的 喵创说 项目(缺少元数据文件)".to_string());
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

/// 复制文件（在项目内复制文件到新路径）
/// 输入: src_path 源文件路径, dest_path 目标文件路径, project_path 项目根目录
/// 输出: Result<String, String> 目标文件绝对路径或错误
/// 流程: 校验源路径存在且为文件，校验目标路径在项目内且不存在，执行复制
#[tauri::command]
pub fn copy_file(
    src_path: String,
    dest_path: String,
    project_path: String,
) -> Result<String, String> {
    let src_abs = validate_path_in_project(&src_path, &project_path)?;
    let dest_abs = validate_path_in_project(&dest_path, &project_path)?;

    // 源必须是文件
    if !src_abs.is_file() {
        return Err("源路径不是文件".to_string());
    }
    // 目标不能已存在
    if dest_abs.exists() {
        return Err("目标文件已存在".to_string());
    }
    // 确保目标父目录存在
    if let Some(parent) = dest_abs.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::copy(&src_abs, &dest_abs).map_err(|e| format!("复制文件失败: {}", e))?;
    Ok(dest_abs.to_string_lossy().to_string())
}

/// 删除项目（移至系统回收站）
/// 输入: project_path 项目根目录路径
/// 输出: Result<(), String> 成功或错误
/// 流程: 校验路径存在且为有效项目，移至系统回收站
/// 注意: 前端在调用前应显示确认对话框
#[tauri::command]
pub fn delete_project(project_path: String) -> Result<(), String> {
    let path = validate_project_path(&project_path)?;
    // 验证是有效的 喵创说 项目（防止误删非项目目录）
    let meta_path = path.join(".novelforge").join("project.json");
    if !meta_path.exists() {
        return Err("不是有效的 喵创说 项目（缺少元数据文件）".to_string());
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
                    let s = match_pos.saturating_sub(40);
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
    chapter_words.sort_by_key(|c| std::cmp::Reverse(c.word_count));

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

// ===== 全局替换命令 =====

/// 单个文件替换结果项
#[derive(Debug, Clone, serde::Serialize)]
pub struct ReplaceFileResult {
    /// 相对路径
    pub relative_path: String,
    /// 文件名
    pub file_name: String,
    /// 替换次数
    pub replacements: u64,
}

/// 全局替换结果
#[derive(Debug, Clone, serde::Serialize)]
pub struct ReplaceResult {
    /// 修改的文件数
    pub files_modified: u64,
    /// 总替换次数
    pub total_replacements: u64,
    /// 各文件替换详情
    pub files: Vec<ReplaceFileResult>,
}

/// 全局替换项目内文本内容
/// 输入:
///   project_path 项目路径
///   query 查找词（非空）
///   replacement 替换字符串
///   case_sensitive 是否区分大小写
/// 输出: Result<ReplaceResult, String> 替换结果统计
/// 流程:
///   1. 校验项目路径与查找词非空
///   2. 递归遍历项目内所有 .txt 文件（跳过 .开头目录）
///   3. 逐文件读取内容，按行执行替换（保留原始换行符）
///   4. 仅当内容有变化时写回文件
///   5. 统计修改文件数与替换次数
/// 安全: 仅 .txt 文件可被修改，所有路径经沙箱校验
#[tauri::command]
pub fn replace_in_project(
    project_path: String,
    query: String,
    replacement: String,
    case_sensitive: bool,
) -> Result<ReplaceResult, String> {
    if query.trim().is_empty() {
        return Err("查找内容不能为空".to_string());
    }
    if query == replacement {
        return Err("查找内容与替换内容相同，无需替换".to_string());
    }
    let root = validate_project_path(&project_path)?;
    let mut ctx = ReplaceContext {
        root: root.clone(),
        query,
        replacement,
        case_sensitive,
        files: Vec::new(),
        total_replacements: 0,
        files_modified: 0,
    };
    replace_recursive(&root, &mut ctx);
    Ok(ReplaceResult {
        files_modified: ctx.files_modified,
        total_replacements: ctx.total_replacements,
        files: ctx.files,
    })
}

/// 替换上下文结构体：封装递归替换过程中的配置与结果累加器
/// 设计目的：避免 replace_recursive 函数参数过多（>7）导致 clippy 警告
struct ReplaceContext {
    /// 项目根路径
    root: PathBuf,
    /// 查找词
    query: String,
    /// 替换字符串
    replacement: String,
    /// 是否区分大小写
    case_sensitive: bool,
    /// 文件结果集合
    files: Vec<ReplaceFileResult>,
    /// 总替换次数累加器
    total_replacements: u64,
    /// 修改文件数累加器
    files_modified: u64,
}

/// 递归执行替换
/// 输入:
///   current 当前路径
///   root 项目根路径
///   ctx 替换上下文（含配置与结果累加器）
/// 输出: 无
/// 流程: 遍历目录，对每个 .txt 文件执行替换并写回
fn replace_recursive(current: &Path, ctx: &mut ReplaceContext) {
    if let Ok(entries) = fs::read_dir(current) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            // 跳过隐藏目录（.novelforge 等）
            if name.starts_with('.') {
                continue;
            }
            if path.is_dir() {
                replace_recursive(&path, ctx);
            } else if path.extension().map(|e| e == "txt").unwrap_or(false) {
                let count = replace_in_file(&path, ctx);
                if count > 0 {
                    ctx.total_replacements += count;
                    ctx.files_modified += 1;
                }
            }
        }
    }
}

/// 在单个文件中执行替换并写回
/// 输入:
///   file_path 文件路径
///   ctx 替换上下文（含配置与结果集合）
/// 输出: u64 替换次数
/// 流程:
///   1. 读取文件内容
///   2. 先统计匹配次数（避免替换后无法定位）
///   3. 执行替换生成新内容
///   4. 仅当有替换发生时写回文件
///   5. 记录文件结果到 ctx.files
fn replace_in_file(file_path: &Path, ctx: &mut ReplaceContext) -> u64 {
    let content = match fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => return 0,
    };
    // 先统计原始内容中的匹配次数
    let count = count_matches(&content, &ctx.query, ctx.case_sensitive);
    if count == 0 {
        return 0;
    }
    // 执行替换
    let new_content = if ctx.case_sensitive {
        content.replace(&ctx.query, &ctx.replacement)
    } else {
        case_insensitive_replace(&content, &ctx.query, &ctx.replacement)
    };
    // 仅当内容确实变化时写回（避免无意义的磁盘写入）
    if new_content == content {
        return 0;
    }
    let _ = fs::write(file_path, &new_content);
    let relative_path = file_path
        .strip_prefix(&ctx.root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let file_name = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    ctx.files.push(ReplaceFileResult {
        relative_path,
        file_name,
        replacements: count,
    });
    count
}

/// 统计字符串中匹配次数
/// 输入: content 原文, query 查找词, case_sensitive 区分大小写
/// 输出: u64 匹配次数
fn count_matches(content: &str, query: &str, case_sensitive: bool) -> u64 {
    if case_sensitive {
        content.matches(query).count() as u64
    } else {
        content
            .to_lowercase()
            .matches(&query.to_lowercase())
            .count() as u64
    }
}

/// 不区分大小写的替换（保留原始大小写）
/// 输入: content 原文, query 查找词, replacement 替换字符串
/// 输出: String 替换后的内容
/// 流程: 通过 to_lowercase 比对定位匹配位置，逐个替换并保留原文其余部分
fn case_insensitive_replace(content: &str, query: &str, replacement: &str) -> String {
    let content_lower = content.to_lowercase();
    let query_lower = query.to_lowercase();
    let mut result = String::with_capacity(content.len());
    let mut remaining = content;
    let mut remaining_lower = content_lower.as_str();
    while let Some(pos) = remaining_lower.find(&query_lower) {
        // 保留匹配前的原文
        result.push_str(&remaining[..pos]);
        // 追加替换内容
        result.push_str(replacement);
        // 跳过已处理部分
        let skip = pos + query_lower.len();
        remaining = &remaining[skip..];
        remaining_lower = &remaining_lower[skip..];
    }
    result.push_str(remaining);
    result
}

// ===== 分卷章节生成命令 =====

/// 单个章节生成结果项
#[derive(Debug, Clone, serde::Serialize)]
pub struct VolumeChapterResult {
    /// 文件相对路径（相对项目根）
    pub relative_path: String,
    /// 章节标题
    pub chapter_title: String,
    /// 是否为卷首语
    pub is_prologue: bool,
    /// 是否为卷尾语
    pub is_epilogue: bool,
    /// 是否已存在（跳过创建）
    pub already_exists: bool,
}

/// 分卷章节生成结果
#[derive(Debug, Clone, serde::Serialize)]
pub struct VolumeGenerationResult {
    /// 卷名（子目录名）
    pub volume_name: String,
    /// 创建的文件数（不含已存在）
    pub created_count: u64,
    /// 跳过文件数（已存在）
    pub skipped_count: u64,
    /// 各文件详情
    pub chapters: Vec<VolumeChapterResult>,
}

/// 中文数字映射（1-99）
fn number_to_chinese(n: u64) -> String {
    const UNITS: [&str; 10] = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    if n == 0 {
        return "零".to_string();
    }
    if n < 10 {
        return UNITS[n as usize].to_string();
    }
    if n < 20 {
        if n == 10 {
            return "十".to_string();
        }
        return format!("十{}", UNITS[(n - 10) as usize]);
    }
    if n < 100 {
        let tens = n / 10;
        let ones = n % 10;
        if ones == 0 {
            return format!("{}十", UNITS[tens as usize]);
        }
        return format!("{}十{}", UNITS[tens as usize], UNITS[ones as usize]);
    }
    // 100+ 直接用阿拉伯数字
    n.to_string()
}

/// 根据格式生成章节标题（旧版保留用于兼容，新版使用模板）
/// 输入:
///   chapter_num 章节序号
///   volume_num 卷序号（可选，已不用于追加卷标识）
///   format_str 格式字符串: "chinese" | "arabic" | "english"
/// 输出: 章节标题字符串
#[allow(dead_code)]
fn format_chapter_title(chapter_num: u64, volume_num: Option<u64>, format_str: &str) -> String {
    // 与前端 formatChapterHeading 保持一致：
    //   chinese → "第一章"
    //   arabic  → "01"（纯数字零填充）
    //   english → "Chapter 1"
    let _ = volume_num; // 卷号不再用于追加卷标识
    match format_str {
        "arabic" => format!("{:02}", chapter_num),
        "english" => format!("Chapter {}", chapter_num),
        _ => format!("第{}章", number_to_chinese(chapter_num)),
    }
}

/// 根据用户模板生成章节标题
/// 输入:
///   chapter_num 章节序号
///   template 模板字符串（含 {n} 占位符）
/// 输出: 章节标题字符串
/// 流程: 若模板为空或不含 {n}，回退为 "第{n}章" 后替换 {n} 为章节序号
fn format_chapter_title_by_template(chapter_num: u64, template: &str) -> String {
    let tpl = if template.is_empty() || !template.contains("{n}") {
        "第{n}章"
    } else {
        template
    };
    tpl.replace("{n}", &chapter_num.to_string())
}

/// 根据格式生成卷首/卷尾语标题
fn format_volume_prelude(volume_num: u64, is_prologue: bool) -> String {
    let cn = number_to_chinese(volume_num);
    if is_prologue {
        format!("第{}卷·卷首语", cn)
    } else {
        format!("第{}卷·卷尾语", cn)
    }
}

/// 为分卷批量生成章节文件
/// 输入:
///   project_path 项目根路径
///   volume_name 分卷名（"正文"下的子目录名，如"第一卷"）
///   chapter_count 章节数量
///   start_chapter_num 起始章节序号（默认1）
///   include_prologue 是否生成卷首语
///   include_epilogue 是否生成卷尾语
///   format_str 标题格式（保留兼容，已不直接用于标题生成）
///   chapter_name_template 章节文件名模板（含 {n} 占位符）
/// 输出: Result<VolumeGenerationResult, String> 生成结果统计
/// 流程:
///   1. 校验项目路径与分卷名
///   2. 在"正文/{volume_name}"下创建目录
///   3. 按需生成卷首语、N 个章节、卷尾语
///   4. 已存在的文件跳过，不覆盖
///   5. 返回各文件创建详情
/// 说明: 章节文件名仅由 chapter_name_template 生成，不再追加"（第X卷）"标识，
///      因文件已归类到分卷子目录，卷号信息由目录承载
#[tauri::command]
pub fn generate_volume_chapters(
    project_path: String,
    volume_name: String,
    chapter_count: u64,
    start_chapter_num: Option<u64>,
    include_prologue: Option<bool>,
    include_epilogue: Option<bool>,
    format_str: Option<String>,
    chapter_name_template: Option<String>,
) -> Result<VolumeGenerationResult, String> {
    if volume_name.trim().is_empty() {
        return Err("分卷名不能为空".to_string());
    }
    if chapter_count == 0 {
        return Err("章节数量必须大于 0".to_string());
    }
    let root = validate_project_path(&project_path)?;
    let manuscript_dir = root.join("正文");
    if !manuscript_dir.exists() {
        return Err("正文目录不存在，请确认项目结构".to_string());
    }
    let volume_dir = manuscript_dir.join(&volume_name);
    fs::create_dir_all(&volume_dir).map_err(|e| format!("创建分卷目录失败: {}", e))?;

    let start_num = start_chapter_num.unwrap_or(1);
    let with_prologue = include_prologue.unwrap_or(false);
    let with_epilogue = include_epilogue.unwrap_or(false);
    let _fmt = format_str.unwrap_or_else(|| "chinese".to_string());
    let name_template = chapter_name_template.unwrap_or_else(|| "第{n}章".to_string());

    // 推算卷序号：从 volume_name 中提取数字，否则用 1
    let volume_num = extract_volume_number(&volume_name).unwrap_or(1);

    let mut chapters: Vec<VolumeChapterResult> = Vec::new();
    let mut created_count: u64 = 0;
    let mut skipped_count: u64 = 0;

    // 卷首语
    if with_prologue {
        let title = format_volume_prelude(volume_num, true);
        let file_name = "卷首语.txt";
        let file_path = volume_dir.join(file_name);
        let rel = relative_path_from(&file_path, &root);
        let already_exists = file_path.exists();
        if !already_exists {
            let content = format!("{}\n\n", title);
            if let Err(e) = fs::write(&file_path, content) {
                return Err(format!("写入卷首语失败: {}", e));
            }
            created_count += 1;
        } else {
            skipped_count += 1;
        }
        chapters.push(VolumeChapterResult {
            relative_path: rel,
            chapter_title: title,
            is_prologue: true,
            is_epilogue: false,
            already_exists,
        });
    }

    // N 个章节：文件名仅由用户模板生成，不再追加卷号标识
    for i in 0..chapter_count {
        let chapter_num = start_num + i;
        let title = format_chapter_title_by_template(chapter_num, &name_template);
        // 文件名：去重非法字符
        let safe_title = sanitize_filename(&title);
        let file_name = format!("{}.txt", safe_title);
        let file_path = volume_dir.join(file_name);
        let rel = relative_path_from(&file_path, &root);
        let already_exists = file_path.exists();
        if !already_exists {
            let content = format!("{}\n\n", title);
            if let Err(e) = fs::write(&file_path, content) {
                return Err(format!("写入章节失败: {}", e));
            }
            created_count += 1;
        } else {
            skipped_count += 1;
        }
        chapters.push(VolumeChapterResult {
            relative_path: rel,
            chapter_title: title,
            is_prologue: false,
            is_epilogue: false,
            already_exists,
        });
    }

    // 卷尾语
    if with_epilogue {
        let title = format_volume_prelude(volume_num, false);
        let file_name = "卷尾语.txt";
        let file_path = volume_dir.join(file_name);
        let rel = relative_path_from(&file_path, &root);
        let already_exists = file_path.exists();
        if !already_exists {
            let content = format!("{}\n\n", title);
            if let Err(e) = fs::write(&file_path, content) {
                return Err(format!("写入卷尾语失败: {}", e));
            }
            created_count += 1;
        } else {
            skipped_count += 1;
        }
        chapters.push(VolumeChapterResult {
            relative_path: rel,
            chapter_title: title,
            is_prologue: false,
            is_epilogue: true,
            already_exists,
        });
    }

    Ok(VolumeGenerationResult {
        volume_name,
        created_count,
        skipped_count,
        chapters,
    })
}

/// 从卷名中提取数字（"第一卷" → 1，"卷2" → 2，"第3卷" → 3，"第十一卷" → 11）
fn extract_volume_name_number(name: &str) -> Option<u64> {
    // 优先匹配阿拉伯数字
    if let Some(num) = name.chars().filter_map(|c| c.to_digit(10)).next() {
        return Some(num as u64);
    }
    // 中文数字映射（多位数必须放在单数前，避免"十一"被"一"先匹配）
    let chinese_map: &[(&str, u64)] = &[
        ("十一", 11), ("十二", 12), ("十三", 13), ("十四", 14), ("十五", 15),
        ("十六", 16), ("十七", 17), ("十八", 18), ("十九", 19), ("二十", 20),
        ("一", 1), ("二", 2), ("三", 3), ("四", 4), ("五", 5),
        ("六", 6), ("七", 7), ("八", 8), ("九", 9), ("十", 10),
    ];
    for (cn, num) in chinese_map {
        if name.contains(cn) {
            return Some(*num);
        }
    }
    None
}

/// 简化别名（统一接口）
fn extract_volume_number(name: &str) -> Option<u64> {
    extract_volume_name_number(name)
}

/// 清理文件名中的非法字符
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect::<String>()
        .trim()
        .to_string()
}

/// 计算文件相对路径
fn relative_path_from(file_path: &Path, root: &Path) -> String {
    file_path
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
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

// ===== 项目导入导出命令 =====

/// 导出项目为 .novelforge 压缩包
/// 输入:
///   project_path 项目根路径
///   output_path 输出文件路径（.novelforge）
/// 输出: Result<ExportResult, String> 导出结果统计
/// 流程:
///   1. 校验项目路径
///   2. 创建 zip 文件
///   3. 递归遍历项目目录，将所有文件加入 zip
///   4. 写入元数据文件（导出时间、版本）
///   5. 返回文件数与总大小
#[tauri::command]
pub fn export_project(
    project_path: String,
    output_path: String,
) -> Result<ExportResult, String> {
    let root = validate_project_path(&project_path)?;
    let output = PathBuf::from(&output_path);

    // 确保输出目录存在
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {}", e))?;
    }

    let file = fs::File::create(&output).map_err(|e| format!("创建输出文件失败: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let mut file_count: u64 = 0;
    let mut total_size: u64 = 0;

    // 递归遍历项目目录
    for entry in walkdir::WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path == root {
            continue;
        }
        let rel = path.strip_prefix(&root).map_err(|e| format!("路径解析失败: {}", e))?;
        let rel_str = rel.to_string_lossy().replace('\\', "/");

        if path.is_dir() {
            zip.add_directory(&rel_str, options)
                .map_err(|e| format!("添加目录到 zip 失败: {}", e))?;
        } else if path.is_file() {
            // 读取文件内容
            let content = fs::read(path).map_err(|e| format!("读取文件失败: {}", e))?;
            total_size += content.len() as u64;
            file_count += 1;
            zip.start_file(&rel_str, options)
                .map_err(|e| format!("添加文件到 zip 失败: {}", e))?;
            zip.write_all(&content)
                .map_err(|e| format!("写入 zip 内容失败: {}", e))?;
        }
    }

    // 写入元数据文件
    let meta = serde_json::json!({
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "format_version": "1.0",
        "app_version": "2.7.0",
        "file_count": file_count,
    });
    let meta_str = serde_json::to_string_pretty(&meta).unwrap_or_default();
    zip.start_file(".novelforge-export-meta.json", options)
        .map_err(|e| format!("写入元数据失败: {}", e))?;
    zip.write_all(meta_str.as_bytes())
        .map_err(|e| format!("写入元数据失败: {}", e))?;

    zip.finish().map_err(|e| format!("完成 zip 失败: {}", e))?;

    // 获取输出文件大小
    let output_size = fs::metadata(&output)
        .map(|m| m.len())
        .unwrap_or(0);

    Ok(ExportResult {
        output_path: output.to_string_lossy().to_string(),
        file_count,
        total_size,
        output_size,
    })
}

/// 导出结果统计
#[derive(Debug, Clone, serde::Serialize)]
pub struct ExportResult {
    /// 输出文件路径
    pub output_path: String,
    /// 打包文件数
    pub file_count: u64,
    /// 原始总大小（字节）
    pub total_size: u64,
    /// 压缩后大小（字节）
    pub output_size: u64,
}

/// 导入 .novelforge 压缩包
/// 输入:
///   archive_path 压缩包路径
///   target_dir 解压目标目录（项目将解压到此目录下）
/// 输出: Result<ImportResult, String> 导入结果统计
/// 流程:
///   1. 打开 zip 文件
///   2. 遍历 zip 内文件，解压到目标目录
///   3. 跳过危险路径（绝对路径、.. 路径穿越）
///   4. 返回文件数与总大小
#[tauri::command]
pub fn import_archive(
    archive_path: String,
    target_dir: String,
) -> Result<ImportResult, String> {
    let archive = PathBuf::from(&archive_path);
    if !archive.exists() {
        return Err("压缩包不存在".to_string());
    }
    let target = PathBuf::from(&target_dir);
    fs::create_dir_all(&target).map_err(|e| format!("创建目标目录失败: {}", e))?;

    let file = fs::File::open(&archive).map_err(|e| format!("打开压缩包失败: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("读取 zip 失败: {}", e))?;

    let mut file_count: u64 = 0;
    let mut total_size: u64 = 0;
    let mut project_name: String = String::new();

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("读取 zip 条目失败: {}", e))?;
        let entry_name = entry.name().to_string();

        // 跳过元数据文件
        if entry_name == ".novelforge-export-meta.json" {
            // 读取元数据获取项目信息
            let mut meta_str = String::new();
            if std::io::Read::read_to_string(&mut entry, &mut meta_str).is_ok() {
                if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&meta_str) {
                    // 元数据不含项目名，跳过
                    let _ = meta;
                }
            }
            continue;
        }

        // 安全校验：禁止绝对路径与路径穿越
        if entry_name.starts_with('/') || entry_name.contains("..") {
            continue;
        }

        let out_path = target.join(&entry_name);

        // 进一步校验：确保解压路径在 target 目录内
        let canonical_target = target.canonicalize().unwrap_or_else(|_| target.clone());
        let canonical_out = out_path.parent()
            .and_then(|p| p.canonicalize().ok())
            .unwrap_or_else(|| canonical_target.clone());
        if !canonical_out.starts_with(&canonical_target) {
            continue;
        }

        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| format!("创建目录失败: {}", e))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
            }
            let mut out_file = fs::File::create(&out_path)
                .map_err(|e| format!("创建文件失败: {}", e))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| format!("写入文件失败: {}", e))?;
            let size = out_path.metadata().map(|m| m.len()).unwrap_or(0);
            total_size += size;
            file_count += 1;
            // 提取项目名（第一个目录）
            if project_name.is_empty() {
                if let Some(first_seg) = entry_name.split('/').next() {
                    if !first_seg.is_empty() {
                        project_name = first_seg.to_string();
                    }
                }
            }
        }
    }

    Ok(ImportResult {
        target_dir: target.to_string_lossy().to_string(),
        file_count,
        total_size,
        project_name,
    })
}

/// 导入结果统计
#[derive(Debug, Clone, serde::Serialize)]
pub struct ImportResult {
    /// 解压目标目录
    pub target_dir: String,
    /// 解压文件数
    pub file_count: u64,
    /// 解压总大小（字节）
    pub total_size: u64,
    /// 推断的项目名
    pub project_name: String,
}
