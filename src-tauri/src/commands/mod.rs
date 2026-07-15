// 文件系统命令模块（按职责拆分自 fs_commands.rs）
//
// 功能概述：
// 提供 Tauri 命令接口，供前端调用以创建、读取、管理小说项目。
// 所有文件操作均经过路径沙箱校验，限制在项目目录内。
//
// 模块组织（按职责拆分）：
// - project_commands:        项目 CRUD（创建/扫描/导入/删除/更新元数据）
// - file_io_commands:        文件读写（读项目树/读文件/写文件/创建/删除/重命名/复制）
// - search_replace_commands: 全局搜索与结构感知替换
// - writing_stats_commands:  项目写作统计信息
// - custom_template_commands:自定义模板 CRUD
// - archive_commands:        项目导入导出（.novelforge 压缩包）
//
// 配套模块（同 crate 顶层）：
// - crate::index_sync: Tantivy 索引增量同步钩子
//
// 错误处理：
// 本模块作为 AppError 模式扩展试点，全量替换 Result<T, String> 为 Result<T, AppError>，
// 通过结构化错误类型向前端传递 { kind, message, context } 信息，便于前端
// 根据 kind 字段进行差异化处理与 i18n 本地化映射。
//
// 模块依赖关系（无循环依赖）：
//   mod（共享工具：路径校验/项目元数据读取/字数统计）
//     ↑
//   project_commands        → mod + project_template
//   file_io_commands        → mod + index_sync
//   search_replace_commands → mod + text_extractor + index_sync
//   writing_stats_commands  → mod + text_extractor
//   custom_template_commands→ mod
//   archive_commands        → mod

// 含 #[tauri::command] 函数的子模块需 pub mod，使 generate_handler!
// 能通过 commands::xxx::function 路径定位宏生成的 __cmd__ 隐藏项
pub mod project_commands;
pub mod file_io_commands;
pub mod search_replace_commands;
pub mod writing_stats_commands;
pub mod custom_template_commands;
pub mod archive_commands;
pub mod export_commands;

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::project_template::ProjectMeta;

// ===== 路径沙箱校验工具 =====

/// 路径沙箱校验：确保目标路径在项目根目录内
/// 输入: target 目标路径, project_root 项目根目录
/// 输出: Result<PathBuf, AppError> 规范化后的目标路径或错误
/// 流程:
///   1. canonicalize 项目根路径（Windows 下返回带 \\?\ 前缀的绝对路径）
///   2. 归一化目标路径分隔符，处理前端传入的混合分隔符
///   3. 目标路径存在时直接 canonicalize
///   4. 目标路径不存在时 canonicalize 父目录后拼接文件名
///   5. 父目录也不存在时做纯词法检查，返回与根路径格式一致的路径
///   6. 统一使用规范化字符串比较包含关系，避免 Path::starts_with 在前缀差异下的误判
pub(crate) fn validate_path_in_project(
    target: &str,
    project_root: &str,
) -> Result<PathBuf, AppError> {
    let root_path = PathBuf::from(project_root)
        .canonicalize()
        .map_err(|e| AppError::io_error(e, "无法解析项目路径"))?;

    if !root_path.exists() {
        return Err(AppError::path_validation_error("项目路径不存在"));
    }

    // 归一化目标路径分隔符（处理前端传入的混合分隔符路径）
    let normalized_target = normalize_path_separators(target);
    let target_path = PathBuf::from(&normalized_target);

    // 如果目标路径已存在，直接 canonicalize；否则 canonicalize 父目录后拼接文件名
    let canonical = if target_path.exists() {
        target_path
            .canonicalize()
            .map_err(|e| AppError::io_error(e, "无法解析路径"))?
    } else {
        // 目标路径不存在（如新建文件），canonicalize 父目录
        let parent = target_path.parent().unwrap_or(std::path::Path::new(""));
        if parent.exists() {
            let canonical_parent = parent
                .canonicalize()
                .map_err(|e| AppError::io_error(e, "无法解析父路径"))?;
            let filename = target_path
                .file_name()
                .ok_or_else(|| AppError::path_validation_error("无效的文件路径"))?;
            canonical_parent.join(filename)
        } else {
            // 父目录也不存在，做纯词法检查
            // 统一格式：去掉 \\?\ 前缀 + 正斜杠 + 小写（Windows 不区分大小写）
            let target_norm = normalize_for_compare(&target_path.to_string_lossy());
            let root_norm = normalize_for_compare(&root_path.to_string_lossy());
            if !target_norm.starts_with(&root_norm) {
                return Err(AppError::path_validation_error(format!(
                    "路径越界: 不允许访问项目目录外的路径 ({} 不在 {} 内)",
                    target_path.display(),
                    root_path.display()
                )));
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
        return Err(AppError::path_validation_error(format!(
            "路径越界: 不允许访问项目目录外的路径 ({} 不在 {} 内)",
            canonical.display(),
            root_path.display()
        )));
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
pub(crate) fn validate_project_path(project_path: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(project_path)
        .canonicalize()
        .map_err(|e| AppError::io_error(e, "无法解析项目路径"))?;
    if !path.is_dir() {
        return Err(AppError::path_validation_error("项目路径不是目录"));
    }
    Ok(path)
}

// ===== 共享结构体 =====

/// 项目信息结构（包含路径与元数据）
///
/// Task 4.5.2: 删除 word_count 缓存字段,字数 SSOT 收敛到 WritingStats
/// 前端获取字数时改为调用 get_writing_stats 命令读取 WritingStats.total_words
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectInfo {
    /// 项目根目录绝对路径
    pub path: String,
    /// 项目元数据
    pub meta: ProjectMeta,
    /// 正文章节总数（正文目录下的支持文档数）
    pub chapter_count: u64,
}

// ===== 共享的项目元数据与统计工具 =====

/// 读取项目元数据
/// 输入: project_root 项目根目录
/// 输出: Result<ProjectMeta, AppError> 元数据或错误
/// 流程: 读取并解析 project.json
pub(crate) fn read_project_meta(project_root: &Path) -> Result<ProjectMeta, AppError> {
    let meta_path = project_root.join(".novelforge").join("project.json");
    let content = fs::read_to_string(&meta_path)
        .map_err(|e| AppError::io_error(e, "读取元数据失败"))?;
    serde_json::from_str(&content).map_err(|e| AppError::serialize_error(e, "解析元数据失败"))
}

/// 统计项目正文章节数
/// 输入: project_root 项目根目录
/// 输出: u64 章节总数
/// 流程: 递归统计正文目录下的支持文档数量
pub(crate) fn count_project_chapters(project_root: &Path) -> u64 {
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
/// 流程: 遍历目录，对支持的文档文件计数（.txt/.pmd/.html/.htm）
fn count_chapters_recursive(dir: &Path, total: &mut u64) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                count_chapters_recursive(&path, total);
            } else if is_indexable_file(&path) {
                *total += 1;
            }
        }
    }
}

/// 判断文件是否为可索引格式（.txt/.pmd/.html/.htm）
///
/// Task 6.1.3 合并: 原 is_supported_doc 与 is_indexable_file 功能完全重复,
/// 统一保留 is_indexable_file 作为单一函数,消除重复定义。
///
/// 输入: path 文件路径
/// 输出: 是否为可索引格式
pub(crate) fn is_indexable_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_lowercase().as_str(), "txt" | "pmd" | "html" | "htm"))
        .unwrap_or(false)
}
