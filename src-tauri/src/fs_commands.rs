// 文件系统操作命令模块
//
// 功能概述：
// 提供 Tauri 命令接口，供前端调用以创建、读取、管理小说项目。
// 所有文件操作均在用户选择的本地目录中执行。
//
// 模块职责：
// 1. 创建小说项目(生成完整目录结构)
// 2. 扫描本地项目列表
// 3. 读取项目元数据
// 4. 导入已有项目
// 5. 统计项目字数

use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::project_template::{
    common_directories, common_files, create_project_meta, type_specific_directories,
    type_specific_files, ProjectMeta, ProjectType,
};

/// 创建小说项目命令
/// 输入: name 项目名称, type_str 类型字符串, author 作者, description 描述, parent_path 父目录
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
    author: String,
    description: String,
    parent_path: String,
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
    let meta = create_project_meta(&name, &project_type, &author, &description);
    let meta_path = project_root.join(".novelforge").join("project.json");
    let meta_json = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("序列化元数据失败: {}", e))?;
    fs::write(&meta_path, meta_json)
        .map_err(|e| format!("写入元数据失败: {}", e))?;

    // 创建正文初始文件
    let main_doc = project_root.join("正文").join("第一章.md");
    fs::write(&main_doc, "# 第一章\n\n开始你的创作...\n")
        .map_err(|e| format!("创建正文文件失败: {}", e))?;

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
    let parent = PathBuf::from(&parent_path);
    if !parent.exists() {
        return Ok(vec![]);
    }

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
                projects.push(ProjectInfo {
                    path: path.to_string_lossy().to_string(),
                    meta,
                    word_count,
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
/// 流程: 遍历正文目录下的所有 .txt 和 .md 文件，统计字符数
fn count_project_words(project_root: &Path) -> u64 {
    let content_dir = project_root.join("正文");
    if !content_dir.exists() {
        return 0;
    }
    let mut total: u64 = 0;
    count_words_recursive(&content_dir, &mut total);
    total
}

/// 递归统计目录下文件字数
/// 输入: dir 目录路径, total 累计字数
/// 输出: 无
/// 流程: 遍历目录，对 .txt/.md 文件统计字符数
fn count_words_recursive(dir: &Path, total: &mut u64) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                count_words_recursive(&path, total);
            } else if path.extension().map(|e| e == "txt" || e == "md").unwrap_or(false) {
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
/// 流程: 调用 Tauri dialog 插件弹出目录选择器
#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> Result<Option<String>, String> {
    use std::sync::mpsc;
    let (tx, rx) = mpsc::channel();
    app.dialog()
        .file()
        .set_title("选择项目保存位置")
        .pick_folder(move |path| {
            let result = path.map(|p| p.to_string());
            let _ = tx.send(result);
        });
    let result = rx.recv().map_err(|e| format!("对话框错误: {}", e))?;
    Ok(result)
}

/// 导入已有项目
/// 输入: project_path 项目根目录路径
/// 输出: Result<ProjectInfo, String> 项目信息或错误
/// 流程: 校验目录是否为有效 NovelForge 项目并返回信息
#[tauri::command]
pub fn import_project(project_path: String) -> Result<ProjectInfo, String> {
    let path = PathBuf::from(&project_path);
    if !path.exists() {
        return Err("路径不存在".to_string());
    }
    if !path.is_dir() {
        return Err("路径不是目录".to_string());
    }
    let meta_path = path.join(".novelforge").join("project.json");
    if !meta_path.exists() {
        return Err("不是有效的 NovelForge 项目(缺少元数据文件)".to_string());
    }
    let meta = read_project_meta(&path)?;
    let word_count = count_project_words(&path);
    Ok(ProjectInfo {
        path: path.to_string_lossy().to_string(),
        meta,
        word_count,
    })
}

/// 读取项目目录树
/// 输入: project_path 项目根目录
/// 输出: Result<Vec<FileNode>, String> 目录树节点列表
/// 流程: 递归读取目录结构并返回树形数据
#[tauri::command]
pub fn read_project_tree(project_path: String) -> Result<Vec<FileNode>, String> {
    let path = PathBuf::from(&project_path);
    if !path.exists() {
        return Err("项目路径不存在".to_string());
    }
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

        let relative_path = path
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| name.clone());

        let metadata = entry.metadata().map_err(|e| format!("读取元数据失败: {}", e))?;
        let is_dir = metadata.is_dir();
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

/// 读取文件内容
/// 输入: file_path 文件绝对路径
/// 输出: Result<String, String> 文件内容或错误
/// 流程: 读取文本文件内容
#[tauri::command]
pub fn read_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| format!("读取文件失败: {}", e))
}

/// 写入文件内容
/// 输入: file_path 文件路径, content 内容
/// 输出: Result<(), String> 成功或错误
/// 流程: 将内容写入文件
#[tauri::command]
pub fn write_file(file_path: String, content: String) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&file_path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(&file_path, content).map_err(|e| format!("写入文件失败: {}", e))
}

/// 创建新文件
/// 输入: project_path 项目路径, relative_path 相对路径, content 内容
/// 输出: Result<String, String> 文件绝对路径或错误
/// 流程: 在项目内创建新文件
#[tauri::command]
pub fn create_file(
    project_path: String,
    relative_path: String,
    content: String,
) -> Result<String, String> {
    let file_path = PathBuf::from(&project_path).join(&relative_path);
    if file_path.exists() {
        return Err("文件已存在".to_string());
    }
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(&file_path, content).map_err(|e| format!("创建文件失败: {}", e))?;
    Ok(file_path.to_string_lossy().to_string())
}

/// 删除文件或目录
/// 输入: path 路径
/// 输出: Result<(), String> 成功或错误
/// 流程: 删除文件或递归删除目录
#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| format!("删除目录失败: {}", e))
    } else {
        fs::remove_file(&p).map_err(|e| format!("删除文件失败: {}", e))
    }
}
