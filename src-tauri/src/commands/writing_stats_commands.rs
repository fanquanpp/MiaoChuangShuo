// 项目写作统计命令模块
//
// 功能概述：
// 提供项目写作统计信息的 Tauri 命令，包含正文字数、设定字数、大纲字数、
// 章节字数列表、总文件数、项目创建天数等指标。
//
// 模块职责：
// 1. 计算正文字数与各章节字数（按字数降序排序）
// 2. 统计设定文件字数（角色/世界观/名词/时间线）
// 3. 统计大纲字数
// 4. 统计项目总文件数
// 5. 计算项目创建天数
//
// 错误处理：
// 所有 Tauri 命令返回 Result<T, AppError>，向前端传递结构化错误信息。

use std::fs;
use std::path::Path;

use crate::commands::{
    count_chinese_and_words, is_supported_doc, validate_project_path,
};
use crate::error::AppError;
use crate::text_extractor;

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
/// 输出: Result<WritingStats, AppError> 统计信息
/// 流程: 遍历项目各目录统计字数与文件数
#[tauri::command]
pub fn get_writing_stats(project_path: String) -> Result<WritingStats, AppError> {
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
/// 流程: 遍历正文目录，统计每个支持文档的字数（接入 text_extractor 统一层）
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
            } else if is_supported_doc(&path) {
                if let Ok(content) = fs::read_to_string(&path) {
                    // 接入 text_extractor 提取纯文本，避免 HTML 标签字符计入字数
                    let file_name = path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let format = text_extractor::detect_format(&file_name, &content);
                    let plain = text_extractor::extract_plain_text(&content, format);
                    let words = count_chinese_and_words(&plain);
                    *total_words += words;
                    let relative_path = path
                        .strip_prefix(root)
                        .map(|p| p.to_string_lossy().to_string())
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
/// 流程: 遍历目录，对支持文档统计字数（接入 text_extractor 统一层）
fn count_dir_words(dir: &Path, total: &mut u64) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                count_dir_words(&path, total);
            } else if is_supported_doc(&path) {
                if let Ok(content) = fs::read_to_string(&path) {
                    let file_name = path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let format = text_extractor::detect_format(&file_name, &content);
                    let plain = text_extractor::extract_plain_text(&content, format);
                    *total += count_chinese_and_words(&plain);
                }
            }
        }
    }
}

/// 递归统计目录下文件数
/// 输入: dir 目录路径, total 累计文件数
/// 输出: 无
/// 流程: 遍历目录，统计支持文档数量（.txt/.pmd/.html/.htm）
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
            } else if is_supported_doc(&path) {
                *total += 1;
            }
        }
    }
}
