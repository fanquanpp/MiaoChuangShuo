// 文件 IO 命令模块
//
// 功能概述：
// 提供文件读写、创建、删除、重命名、复制与项目目录树读取等 Tauri 命令。
// 所有命令均经过路径沙箱校验，限制在项目根目录内。
//
// 模块职责：
// 1. 读取项目目录树（递归构建 FileNode 树）
// 2. 读取文件内容（含 50MB 大小限制）
// 3. 写入文件内容（写入成功后同步 Tantivy 索引）
// 4. 创建新文件（写入成功后同步 Tantivy 索引）
// 5. 删除文件或目录（移至系统回收站，删除前同步索引）
// 6. 重命名文件或目录（重命名后同步索引）
// 7. 复制文件（复制后同步索引）

use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::{validate_path_in_project, validate_project_path};
use crate::error::AppError;
use crate::index_sync::{
    try_sync_index_add, try_sync_index_remove, try_sync_index_rename,
};

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

/// 读取项目目录树
/// 输入: project_path 项目根目录
/// 输出: Result<Vec<FileNode>, AppError> 目录树节点列表
/// 流程: 递归读取目录结构并返回树形数据
#[tauri::command]
pub fn read_project_tree(project_path: String) -> Result<Vec<FileNode>, AppError> {
    let path = validate_project_path(&project_path)?;
    read_dir_recursive(&path, &path)
}

/// 递归读取目录
/// 输入: current 当前路径, root 项目根路径
/// 输出: Result<Vec<FileNode>, AppError> 节点列表
/// 流程: 遍历目录构建树形结构，忽略 .novelforge 隐藏目录
fn read_dir_recursive(current: &Path, root: &Path) -> Result<Vec<FileNode>, AppError> {
    let mut nodes = Vec::new();
    let entries = fs::read_dir(current).map_err(|e| AppError::io_error(e, "读取目录失败"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // 忽略隐藏目录和文件
        if name.starts_with('.') {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|e| AppError::io_error(e, "读取元数据失败"))?;
        let is_dir = metadata.is_dir();

        // 非目录文件仅允许 .txt 扩展名（应用仅支持 .txt 文件）
        if !is_dir {
            let ext = path
                .extension()
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
/// 输出: Result<String, AppError> 文件内容或错误
/// 流程: 校验路径在项目内，读取文本文件内容
#[tauri::command]
pub fn read_file(file_path: String, project_path: String) -> Result<String, AppError> {
    let validated = validate_path_in_project(&file_path, &project_path)?;
    // 文件大小限制: 50MB，防止内存溢出
    const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;
    if let Ok(metadata) = fs::metadata(&validated) {
        if metadata.len() > MAX_FILE_SIZE {
            return Err(AppError::path_validation_error(format!(
                "文件过大 ({}MB)，超过限制 (50MB)",
                metadata.len() / 1024 / 1024
            )));
        }
    }
    fs::read_to_string(&validated).map_err(|e| AppError::io_error(e, "读取文件失败"))
}

/// 写入文件内容（含路径沙箱校验）
/// 输入: file_path 文件路径, content 内容, project_path 项目根目录
/// 输出: Result<(), AppError> 成功或错误
/// 流程: 校验路径后创建父目录并写入；写入成功后同步 Tantivy 索引（P1-4）
#[tauri::command]
pub fn write_file(
    file_path: String,
    content: String,
    project_path: String,
) -> Result<(), AppError> {
    let validated = validate_path_in_project(&file_path, &project_path)?;
    if let Some(parent) = validated.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io_error(e, "创建目录失败"))?;
    }
    fs::write(&validated, content).map_err(|e| AppError::io_error(e, "写入文件失败"))?;
    // P1-4: 写入后同步 Tantivy 索引（仅对可索引格式，失败仅记录日志）
    try_sync_index_add(&project_path, &validated);
    Ok(())
}

/// 创建新文件（含路径沙箱校验）
/// 输入: project_path 项目路径, relative_path 相对路径, content 内容
/// 输出: Result<String, AppError> 文件绝对路径或错误
/// 流程: 在校验后的项目目录内创建新文件；创建成功后同步 Tantivy 索引（P1-4）
#[tauri::command]
pub fn create_file(
    project_path: String,
    relative_path: String,
    content: String,
) -> Result<String, AppError> {
    let root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| AppError::io_error(e, "无法解析项目路径"))?;
    let file_path = root.join(&relative_path);

    // 使用统一的沙箱校验
    let validated = validate_path_in_project(&file_path.to_string_lossy(), &project_path)?;

    if validated.exists() {
        return Err(AppError::path_validation_error("文件已存在"));
    }
    if let Some(parent) = validated.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io_error(e, "创建目录失败"))?;
    }
    fs::write(&validated, content).map_err(|e| AppError::io_error(e, "创建文件失败"))?;
    // P1-4: 创建后同步 Tantivy 索引（仅对可索引格式，失败仅记录日志）
    try_sync_index_add(&project_path, &validated);
    Ok(validated.to_string_lossy().to_string())
}

/// 删除文件或目录（含路径沙箱校验，移至回收站）
/// 输入: path 路径, project_path 项目根目录
/// 输出: Result<(), AppError> 成功或错误
/// 流程: 校验路径；删除前同步 Tantivy 索引（目录需递归收集子文件路径）；移至系统回收站
/// 设计说明: 索引同步在 trash::delete 之前完成，因为目录删除后无法再枚举子文件路径
#[tauri::command]
pub fn delete_path(path: String, project_path: String) -> Result<(), AppError> {
    let p = validate_path_in_project(&path, &project_path)?;
    // P1-4: 删除前同步 Tantivy 索引（目录需递归收集子文件 relative_path）
    try_sync_index_remove(&project_path, &p);
    trash::delete(&p).map_err(|e| {
        AppError::io_error(
            std::io::Error::new(std::io::ErrorKind::Other, e),
            "删除失败",
        )
    })
}

/// 重命名文件或目录（含路径沙箱校验）
/// 输入: old_path 原路径, new_path 新路径, project_path 项目根目录
/// 输出: Result<(), AppError> 成功或错误
/// 流程: 校验原路径在项目内，校验新路径在项目内且不存在，执行重命名；重命名后同步 Tantivy 索引（P1-4）
#[tauri::command]
pub fn rename_path(
    old_path: String,
    new_path: String,
    project_path: String,
) -> Result<(), AppError> {
    // 校验原路径（必须存在，用 validate_path_in_project）
    let old_abs = validate_path_in_project(&old_path, &project_path)?;

    // 使用统一的沙箱校验新路径
    let new_abs = validate_path_in_project(&new_path, &project_path)?;

    // 检查目标路径是否已存在
    if new_abs.exists() {
        return Err(AppError::path_validation_error("目标路径已存在"));
    }

    // 确保新路径的父目录存在
    if let Some(parent) = new_abs.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| AppError::io_error(e, "创建目录失败"))?;
        }
    }

    // 执行重命名
    fs::rename(&old_abs, &new_abs).map_err(|e| AppError::io_error(e, "重命名失败"))?;
    // P1-4: 重命名后同步 Tantivy 索引（删除旧路径索引 + 添加新路径索引）
    try_sync_index_rename(&project_path, &old_abs, &new_abs);
    Ok(())
}

/// 复制文件（在项目内复制文件到新路径）
/// 输入: src_path 源文件路径, dest_path 目标文件路径, project_path 项目根目录
/// 输出: Result<String, AppError> 目标文件绝对路径或错误
/// 流程: 校验源路径存在且为文件，校验目标路径在项目内且不存在，执行复制；复制后同步 Tantivy 索引（P1-4）
#[tauri::command]
pub fn copy_file(
    src_path: String,
    dest_path: String,
    project_path: String,
) -> Result<String, AppError> {
    let src_abs = validate_path_in_project(&src_path, &project_path)?;
    let dest_abs = validate_path_in_project(&dest_path, &project_path)?;

    // 源必须是文件
    if !src_abs.is_file() {
        return Err(AppError::path_validation_error("源路径不是文件"));
    }
    // 目标不能已存在
    if dest_abs.exists() {
        return Err(AppError::path_validation_error("目标文件已存在"));
    }
    // 确保目标父目录存在
    if let Some(parent) = dest_abs.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io_error(e, "创建目录失败"))?;
    }
    fs::copy(&src_abs, &dest_abs).map_err(|e| AppError::io_error(e, "复制文件失败"))?;
    // P1-4: 复制后同步 Tantivy 索引（仅对可索引格式，失败仅记录日志）
    try_sync_index_add(&project_path, &dest_abs);
    Ok(dest_abs.to_string_lossy().to_string())
}
