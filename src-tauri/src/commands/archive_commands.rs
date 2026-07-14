// 项目导入导出命令模块
//
// 功能概述：
// 提供 .novelforge 压缩包格式的项目导出与导入 Tauri 命令，
// 用于项目分发、备份与跨设备迁移。
//
// 模块职责：
// 1. 导出项目为 .novelforge 压缩包（zip 格式 + Deflated 压缩）
// 2. 导入 .novelforge 压缩包（含路径穿越防护）
// 3. 写入导出元数据（导出时间、格式版本、应用版本、文件数）
//
// 安全：
// 导入时禁止绝对路径与 .. 路径穿越，并通过 canonicalize 二次校验解压路径在目标目录内。
//
// 错误处理：
// 所有 Tauri 命令返回 Result<T, AppError>，向前端传递结构化错误信息。

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use crate::commands::validate_project_path;
use crate::error::AppError;

/// 导出项目为 .novelforge 压缩包
/// 输入:
///   project_path 项目根路径
///   output_path 输出文件路径（.novelforge）
/// 输出: Result<ExportResult, AppError> 导出结果统计
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
) -> Result<ExportResult, AppError> {
    let root = validate_project_path(&project_path)?;
    let output = PathBuf::from(&output_path);

    // 确保输出目录存在
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io_error(e, "创建输出目录失败"))?;
    }

    let file = fs::File::create(&output).map_err(|e| AppError::io_error(e, "创建输出文件失败"))?;
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
        let rel = path
            .strip_prefix(&root)
            .map_err(|e| AppError::path_validation_error(format!("路径解析失败: {}", e)))?;
        let rel_str = rel.to_string_lossy().replace('\\', "/");

        if path.is_dir() {
            zip.add_directory(&rel_str, options).map_err(|e| {
                AppError::io_error(
                    std::io::Error::new(std::io::ErrorKind::Other, e),
                    "添加目录到 zip 失败",
                )
            })?;
        } else if path.is_file() {
            // 读取文件内容
            let content = fs::read(path).map_err(|e| AppError::io_error(e, "读取文件失败"))?;
            total_size += content.len() as u64;
            file_count += 1;
            zip.start_file(&rel_str, options).map_err(|e| {
                AppError::io_error(
                    std::io::Error::new(std::io::ErrorKind::Other, e),
                    "添加文件到 zip 失败",
                )
            })?;
            zip.write_all(&content)
                .map_err(|e| AppError::io_error(e, "写入 zip 内容失败"))?;
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
        .map_err(|e| {
            AppError::io_error(
                std::io::Error::new(std::io::ErrorKind::Other, e),
                "写入元数据失败",
            )
        })?;
    zip.write_all(meta_str.as_bytes())
        .map_err(|e| AppError::io_error(e, "写入元数据失败"))?;

    zip.finish().map_err(|e| {
        AppError::io_error(
            std::io::Error::new(std::io::ErrorKind::Other, e),
            "完成 zip 失败",
        )
    })?;

    // 获取输出文件大小
    let output_size = fs::metadata(&output).map(|m| m.len()).unwrap_or(0);

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
/// 输出: Result<ImportResult, AppError> 导入结果统计
/// 流程:
///   1. 打开 zip 文件
///   2. 遍历 zip 内文件，解压到目标目录
///   3. 跳过危险路径（绝对路径、.. 路径穿越）
///   4. 返回文件数与总大小
#[tauri::command]
pub fn import_archive(archive_path: String, target_dir: String) -> Result<ImportResult, AppError> {
    let archive = PathBuf::from(&archive_path);
    if !archive.exists() {
        return Err(AppError::path_validation_error("压缩包不存在"));
    }
    let target = PathBuf::from(&target_dir);
    fs::create_dir_all(&target).map_err(|e| AppError::io_error(e, "创建目标目录失败"))?;

    let file = fs::File::open(&archive).map_err(|e| AppError::io_error(e, "打开压缩包失败"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| {
        AppError::io_error(
            std::io::Error::new(std::io::ErrorKind::Other, e),
            "读取 zip 失败",
        )
    })?;

    let mut file_count: u64 = 0;
    let mut total_size: u64 = 0;
    let mut project_name: String = String::new();

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| {
            AppError::io_error(
                std::io::Error::new(std::io::ErrorKind::Other, e),
                "读取 zip 条目失败",
            )
        })?;
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
        let canonical_out = out_path
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .unwrap_or_else(|| canonical_target.clone());
        if !canonical_out.starts_with(&canonical_target) {
            continue;
        }

        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| AppError::io_error(e, "创建目录失败"))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| AppError::io_error(e, "创建父目录失败"))?;
            }
            let mut out_file =
                fs::File::create(&out_path).map_err(|e| AppError::io_error(e, "创建文件失败"))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| AppError::io_error(e, "写入文件失败"))?;
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
