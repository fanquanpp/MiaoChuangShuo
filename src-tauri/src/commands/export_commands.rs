// TXT 导出命令模块
//
// 功能概述：
// 提供项目正文章节导出为 TXT 文件的 Tauri 命令，支持四种导出模式：
// 1. single: 单章导出（导出指定章节为单个 TXT）
// 2. merged: 整项目合并（所有章节合并到一个 TXT，每章前插入标题行）
// 3. per_chapter: 每章一个文件
// 4. per_volume: 按分卷导出（正文目录下的子目录，每卷一个 TXT）
//
// 模块职责：
// 1. 递归遍历正文目录，按文件名字典序排序
// 2. 调用 text_extractor::extract_plain_text 提取纯文本
// 3. 按选项拼接章节标题、换行符、UTF-8 BOM
// 4. 原子写入策略（临时文件 + rename）输出到用户选择目录
//
// 错误处理：
// 所有 Tauri 命令返回 Result<T, AppError>，向前端传递结构化错误信息。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::commands::{is_indexable_file, read_project_meta, validate_project_path};
use crate::error::AppError;
use crate::text_extractor;

/// TXT 导出选项结构体
///
/// 由前端构造并通过 invoke 传入，控制导出模式与格式化行为。
/// 字段采用 camelCase 序列化，与前端 TypeScript 接口一致。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxtExportOptions {
    /// 导出模式："single" | "merged" | "per_chapter" | "per_volume"
    pub mode: String,
    /// 是否在每章前插入标题行（从 front matter title 字段或文件名提取）
    pub include_chapter_title: bool,
    /// 是否写入 UTF-8 BOM（\xEF\xBB\xBF），Windows 记事本兼容
    pub bom: bool,
    /// 是否使用 CRLF 换行符（Windows 风格），false 时使用 LF
    pub crlf: bool,
    /// 用户选择的导出目录绝对路径
    pub output_path: String,
    /// 单章导出模式下的章节文件相对路径（相对项目根目录）
    /// 仅 mode="single" 时使用，其他模式忽略
    #[serde(default)]
    pub chapter_path: Option<String>,
}

/// TXT 导出结果统计
///
/// 返回给前端的导出结果，包含生成的文件列表与字数统计。
/// 注意：命名为 TxtExportResult 以避免与 archive_commands::ExportResult 冲突
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TxtExportResult {
    /// 是否导出成功
    pub success: bool,
    /// 生成的文件绝对路径列表
    pub files: Vec<String>,
    /// 导出的章节总数
    pub total_chapters: u32,
    /// 导出的总字数
    pub total_words: u64,
    /// 结果消息（成功/失败描述）
    pub message: String,
}

/// 章节信息内部结构
///
/// 在遍历正文目录时收集，包含文件路径、显示名（标题）、所属卷名
struct ChapterInfo {
    /// 章节文件绝对路径
    path: PathBuf,
    /// 章节显示名（从 front matter title 或文件名提取，含扩展名去除）
    title: String,
    /// 所属卷名（正文根目录下的文件为空字符串，子目录下的文件为子目录名）
    volume: String,
}

/// 导出项目正文章节为 TXT 文件
///
/// 输入:
///   project_path 项目根目录绝对路径
///   options 导出选项（模式/标题/BOM/CRLF/输出目录/单章路径）
/// 输出: Result<TxtExportResult, AppError> 导出结果统计
/// 流程:
///   1. 校验项目路径与输出目录
///   2. 读取 ProjectMeta 获取正文目录名（默认"正文"）
///   3. 根据 mode 分派到对应的导出函数
///   4. 原子写入文件到输出目录
///   5. 返回生成的文件列表与字数统计
#[tauri::command]
pub fn export_project_to_txt(
    project_path: String,
    options: TxtExportOptions,
) -> Result<TxtExportResult, AppError> {
    let root = validate_project_path(&project_path)?;
    let output_dir = PathBuf::from(&options.output_path);

    // 校验输出目录存在且为目录
    if !output_dir.exists() {
        fs::create_dir_all(&output_dir)
            .map_err(|e| AppError::io_error(e, "创建输出目录失败"))?;
    }
    if !output_dir.is_dir() {
        return Err(AppError::path_validation_error(
            "输出路径不是目录",
        ));
    }

    // 读取项目元数据获取正文目录名（旧项目缺字段时 serde 默认填充"正文"）
    let meta = read_project_meta(&root)?;
    let manuscript_dir = meta.manuscript_dir.as_str();
    let manuscript_path = root.join(manuscript_dir);

    if !manuscript_path.exists() {
        return Ok(TxtExportResult {
            success: false,
            files: Vec::new(),
            total_chapters: 0,
            total_words: 0,
            message: format!("正文目录不存在: {}", manuscript_dir),
        });
    }

    // 按 mode 分派到对应的导出逻辑
    match options.mode.as_str() {
        "single" => export_single_chapter(&root, &manuscript_path, &output_dir, &options),
        "merged" => export_merged(&root, &manuscript_path, &output_dir, &options),
        "per_chapter" => export_per_chapter(&manuscript_path, &output_dir, &options),
        "per_volume" => export_per_volume(&manuscript_path, &output_dir, &options),
        other => Err(AppError::config_error(format!(
            "不支持的导出模式: {}",
            other
        ))),
    }
}

/// 单章导出模式
///
/// 输入:
///   root 项目根目录
///   manuscript_path 正文目录路径
///   output_dir 输出目录
///   options 导出选项（需包含 chapter_path）
/// 输出: Result<TxtExportResult, AppError>
/// 流程:
///   1. 从 options.chapter_path 获取章节相对路径
///   2. 拼接为绝对路径，校验文件存在
///   3. 提取纯文本，写入单个 TXT 文件
fn export_single_chapter(
    _root: &Path,
    _manuscript_path: &Path,
    output_dir: &Path,
    options: &TxtExportOptions,
) -> Result<TxtExportResult, AppError> {
    let chapter_rel = options
        .chapter_path
        .as_ref()
        .ok_or_else(|| AppError::config_error("单章导出模式缺少 chapter_path 参数"))?;

    // chapter_path 可能为相对项目根的路径，也可能为绝对路径
    // 统一处理：若是绝对路径直接使用，否则拼接项目根
    let chapter_file = if Path::new(chapter_rel).is_absolute() {
        PathBuf::from(chapter_rel)
    } else {
        _root.join(chapter_rel)
    };

    if !chapter_file.exists() {
        return Err(AppError::path_validation_error(format!(
            "章节文件不存在: {}",
            chapter_file.display()
        )));
    }

    // 提取章节标题（从文件名去除扩展名）
    let title = extract_chapter_title(&chapter_file);
    let content = fs::read_to_string(&chapter_file)
        .map_err(|e| AppError::io_error(e, "读取章节文件失败"))?;
    let file_name = chapter_file
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("chapter");
    let format = text_extractor::detect_format(file_name, &content);
    let plain = text_extractor::extract_plain_text(&content, format);

    // 构造输出文本
    let final_text = build_chapter_text(&plain, &title, options);
    let words = count_words(&final_text);

    // 输出文件名：章节名.txt
    let output_name = format!("{}.txt", sanitize_filename(&title));
    let output_path = output_dir.join(&output_name);

    atomic_write_text(&output_path, &final_text, options.bom, options.crlf)?;

    Ok(TxtExportResult {
        success: true,
        files: vec![output_path.to_string_lossy().to_string()],
        total_chapters: 1,
        total_words: words,
        message: format!("单章导出成功: {}", output_name),
    })
}

/// 整项目合并导出模式
///
/// 输入:
///   root 项目根目录（用于生成默认文件名）
///   manuscript_path 正文目录路径
///   output_dir 输出目录
///   options 导出选项
/// 输出: Result<TxtExportResult, AppError>
/// 流程:
///   1. 收集正文目录下所有章节（按文件名字典序排序）
///   2. 逐章提取纯文本，按选项拼接标题行
///   3. 合并为单个 TXT 文件，输出为 <项目名>.txt
fn export_merged(
    root: &Path,
    manuscript_path: &Path,
    output_dir: &Path,
    options: &TxtExportOptions,
) -> Result<TxtExportResult, AppError> {
    let chapters = collect_chapters(manuscript_path);
    if chapters.is_empty() {
        return Ok(TxtExportResult {
            success: false,
            files: Vec::new(),
            total_chapters: 0,
            total_words: 0,
            message: "未找到可导出的章节".to_string(),
        });
    }

    let mut combined = String::new();
    let mut total_words: u64 = 0;

    for chapter in &chapters {
        let content = match fs::read_to_string(&chapter.path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let file_name = chapter
            .path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let format = text_extractor::detect_format(file_name, &content);
        let plain = text_extractor::extract_plain_text(&content, format);
        let chapter_text = build_chapter_text(&plain, &chapter.title, options);
        total_words += count_words(&chapter_text);
        combined.push_str(&chapter_text);
        // 章节间追加空行分隔
        combined.push_str("\n\n");
    }

    // 输出文件名：项目名.txt
    let project_name = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project");
    let output_name = format!("{}.txt", sanitize_filename(project_name));
    let output_path = output_dir.join(&output_name);

    atomic_write_text(&output_path, &combined, options.bom, options.crlf)?;

    Ok(TxtExportResult {
        success: true,
        files: vec![output_path.to_string_lossy().to_string()],
        total_chapters: chapters.len() as u32,
        total_words: total_words,
        message: format!("合并导出成功: {}（共 {} 章）", output_name, chapters.len()),
    })
}

/// 每章一个文件导出模式
///
/// 输入:
///   manuscript_path 正文目录路径
///   output_dir 输出目录
///   options 导出选项
/// 输出: Result<TxtExportResult, AppError>
/// 流程:
///   1. 收集正文目录下所有章节（按文件名字典序排序）
///   2. 逐章提取纯文本，按选项拼接标题行
///   3. 每章生成独立的 TXT 文件，文件名为 <章节名>.txt
fn export_per_chapter(
    manuscript_path: &Path,
    output_dir: &Path,
    options: &TxtExportOptions,
) -> Result<TxtExportResult, AppError> {
    let chapters = collect_chapters(manuscript_path);
    if chapters.is_empty() {
        return Ok(TxtExportResult {
            success: false,
            files: Vec::new(),
            total_chapters: 0,
            total_words: 0,
            message: "未找到可导出的章节".to_string(),
        });
    }

    let mut files = Vec::new();
    let mut total_words: u64 = 0;

    for chapter in &chapters {
        let content = match fs::read_to_string(&chapter.path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let file_name = chapter
            .path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let format = text_extractor::detect_format(file_name, &content);
        let plain = text_extractor::extract_plain_text(&content, format);
        let chapter_text = build_chapter_text(&plain, &chapter.title, options);
        total_words += count_words(&chapter_text);

        let output_name = format!("{}.txt", sanitize_filename(&chapter.title));
        let output_path = output_dir.join(&output_name);
        atomic_write_text(&output_path, &chapter_text, options.bom, options.crlf)?;
        files.push(output_path.to_string_lossy().to_string());
    }

    Ok(TxtExportResult {
        success: true,
        files,
        total_chapters: chapters.len() as u32,
        total_words: total_words,
        message: format!("每章导出成功: 共 {} 个文件", chapters.len()),
    })
}

/// 按分卷导出模式
///
/// 输入:
///   manuscript_path 正文目录路径
///   output_dir 输出目录
///   options 导出选项
/// 输出: Result<TxtExportResult, AppError>
/// 流程:
///   1. 读取正文目录下的子目录（分卷），按名称字典序排序
///   2. 每卷收集章节，逐章提取纯文本并拼接
///   3. 每卷生成独立的 TXT 文件，文件名为 <卷名>.txt
///   4. 正文根目录下的散落章节归入"散章"卷
fn export_per_volume(
    manuscript_path: &Path,
    output_dir: &Path,
    options: &TxtExportOptions,
) -> Result<TxtExportResult, AppError> {
    // 收集所有章节（含卷名信息）
    let chapters = collect_chapters(manuscript_path);
    if chapters.is_empty() {
        return Ok(TxtExportResult {
            success: false,
            files: Vec::new(),
            total_chapters: 0,
            total_words: 0,
            message: "未找到可导出的章节".to_string(),
        });
    }

    // 按卷名分组（保持卷名字典序）
    let mut volumes: std::collections::BTreeMap<String, Vec<&ChapterInfo>> =
        std::collections::BTreeMap::new();
    for chapter in &chapters {
        volumes
            .entry(chapter.volume.clone())
            .or_default()
            .push(chapter);
    }

    let mut files = Vec::new();
    let mut total_words: u64 = 0;
    let mut total_chapters: u32 = 0;

    for (volume_name, volume_chapters) in volumes {
        let mut combined = String::new();

        for chapter in volume_chapters {
            let content = match fs::read_to_string(&chapter.path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let file_name = chapter
                .path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            let format = text_extractor::detect_format(file_name, &content);
            let plain = text_extractor::extract_plain_text(&content, format);
            let chapter_text = build_chapter_text(&plain, &chapter.title, options);
            combined.push_str(&chapter_text);
            combined.push_str("\n\n");
            total_chapters += 1;
        }

        if combined.is_empty() {
            continue;
        }

        total_words += count_words(&combined);

        // 卷名为空时使用"散章"作为文件名
        let display_name = if volume_name.is_empty() {
            "散章".to_string()
        } else {
            volume_name.clone()
        };
        let output_name = format!("{}.txt", sanitize_filename(&display_name));
        let output_path = output_dir.join(&output_name);
        atomic_write_text(&output_path, &combined, options.bom, options.crlf)?;
        files.push(output_path.to_string_lossy().to_string());
    }

    let file_count = files.len();
    Ok(TxtExportResult {
        success: true,
        files,
        total_chapters: total_chapters,
        total_words: total_words,
        message: format!("按卷导出成功: 共 {} 个文件", file_count),
    })
}

/// 递归收集正文目录下的所有章节文件
///
/// 输入: manuscript_path 正文目录路径
/// 输出: Vec<ChapterInfo> 章节信息列表（按文件名字典序排序）
/// 流程:
///   1. 递归遍历正文目录
///   2. 对支持的文档文件（.txt/.pmd/.html/.htm）收集路径与标题
///   3. 卷名取正文根目录下的第一级子目录名
///   4. 按文件名（含相对路径）字典序排序，保证章节顺序稳定
fn collect_chapters(manuscript_path: &Path) -> Vec<ChapterInfo> {
    let mut chapters: Vec<ChapterInfo> = Vec::new();
    collect_chapters_recursive(manuscript_path, manuscript_path, &mut chapters);

    // 按文件名字典序排序，保证章节顺序稳定
    chapters.sort_by(|a, b| {
        a.path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .cmp(b.path.file_name().and_then(|n| n.to_str()).unwrap_or(""))
    });
    chapters
}

/// 递归收集章节文件的内部辅助函数
///
/// 输入:
///   current_dir 当前遍历目录
///   manuscript_root 正文根目录（用于计算卷名）
///   chapters 累积的章节列表
/// 流程:
///   1. 遍历当前目录下的条目
///   2. 目录：递归处理
///   3. 文件：若为支持的文档格式，提取标题与卷名后加入列表
fn collect_chapters_recursive(
    current_dir: &Path,
    manuscript_root: &Path,
    chapters: &mut Vec<ChapterInfo>,
) {
    let entries = match fs::read_dir(current_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_chapters_recursive(&path, manuscript_root, chapters);
        } else if is_indexable_file(&path) {
            let title = extract_chapter_title(&path);
            // 卷名：文件相对于正文根目录的第一级子目录名
            // 若文件直接在正文根目录下，卷名为空字符串
            let volume = path
                .strip_prefix(manuscript_root)
                .ok()
                .and_then(|rel| rel.parent())
                .and_then(|parent| {
                    if parent.as_os_str().is_empty() {
                        None
                    } else {
                        parent
                            .components()
                            .next()
                            .and_then(|c| c.as_os_str().to_str())
                            .map(|s| s.to_string())
                    }
                })
                .unwrap_or_default();

            chapters.push(ChapterInfo {
                path,
                title,
                volume,
            });
        }
    }
}

/// 从文件路径提取章节标题
///
/// 输入: path 章节文件路径
/// 输出: String 章节标题（去除扩展名的文件名）
/// 流程:
///   1. 取文件名部分
///   2. 去除文件扩展名
///   3. 去除常见的前导编号前缀（如 "01." "1." "01_" 等）
fn extract_chapter_title(path: &Path) -> String {
    let file_name = path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("未命名")
        .to_string();
    // 去除前导编号前缀（如 "01." "1." "01_" "01-" "01 "）
    // 手动解析：跳过前导数字字符，若紧跟分隔符（._- 空格）则一并跳过
    strip_leading_number_prefix(&file_name)
        .trim()
        .to_string()
}

/// 去除字符串前导编号前缀
///
/// 输入: s 原始字符串
/// 输出: &str 去除前导编号与分隔符后的字符串
/// 流程:
///   1. 跳过前导 ASCII 数字字符
///   2. 若数字后紧跟分隔符（. _ - 空格），跳过分隔符
///   3. 返回剩余部分
fn strip_leading_number_prefix(s: &str) -> &str {
    let chars: Vec<char> = s.chars().collect();
    let mut idx = 0;
    // 跳过前导数字
    while idx < chars.len() && chars[idx].is_ascii_digit() {
        idx += 1;
    }
    // 无前导数字时直接返回原字符串
    if idx == 0 {
        return s;
    }
    // 数字后紧跟分隔符时跳过分隔符
    if idx < chars.len() && matches!(chars[idx], '.' | '_' | '-' | ' ') {
        idx += 1;
    }
    // 返回剩余部分（将索引转换为字符切片边界）
    let byte_pos = chars[..idx]
        .iter()
        .map(|c| c.len_utf8())
        .sum::<usize>();
    &s[byte_pos..]
}

/// 构造单章文本（按选项决定是否插入标题行）
///
/// 输入:
///   plain 章节纯文本
///   title 章节标题
///   options 导出选项
/// 输出: String 含可选标题行的章节文本
fn build_chapter_text(plain: &str, title: &str, options: &TxtExportOptions) -> String {
    if options.include_chapter_title {
        format!("{}\n\n{}", title, plain)
    } else {
        plain.to_string()
    }
}

/// 原子写入文本文件
///
/// 输入:
///   path 目标文件路径
///   content 文本内容
///   bom 是否写入 UTF-8 BOM
///   crlf 是否使用 CRLF 换行符
/// 输出: Result<(), AppError>
/// 流程:
///   1. 按 crlf 选项转换换行符
///   2. 写入临时文件（.tmp 后缀）
///   3. rename 替换目标文件（原子操作）
///   4. rename 失败时清理临时文件
fn atomic_write_text(
    path: &Path,
    content: &str,
    bom: bool,
    crlf: bool,
) -> Result<(), AppError> {
    // 换行符转换：LF -> CRLF（若启用）
    let final_content = if crlf {
        content.replace('\n', "\r\n")
    } else {
        content.to_string()
    };

    // 构造字节数组：可选 BOM + 文本内容
    let mut bytes: Vec<u8> = Vec::new();
    if bom {
        bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]); // UTF-8 BOM
    }
    bytes.extend_from_slice(final_content.as_bytes());

    // 原子写入：先写临时文件，再 rename 替换
    let tmp_path = path.with_extension("txt.tmp");
    let mut file = fs::File::create(&tmp_path)
        .map_err(|e| AppError::io_error(e, "创建临时文件失败"))?;
    file.write_all(&bytes)
        .map_err(|e| AppError::io_error(e, "写入临时文件失败"))?;
    file.sync_all()
        .map_err(|e| AppError::io_error(e, "同步临时文件失败"))?;
    drop(file);

    fs::rename(&tmp_path, path).map_err(|e| {
        // rename 失败时清理临时文件，避免残留
        let _ = fs::remove_file(&tmp_path);
        AppError::io_error(e, "替换目标文件失败")
    })?;

    Ok(())
}

/// 统计文本字数（委托至 word_count 模块）
///
/// 输入: text 文本内容
/// 输出: u64 字数
fn count_words(text: &str) -> u64 {
    crate::word_count::count_words(text)
}

/// 清理文件名中的非法字符
///
/// 输入: name 原始文件名
/// 输出: String 安全的文件名（非法字符替换为下划线）
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_chapter_title_strips_extension() {
        let path = Path::new("/project/正文/第一章.txt");
        assert_eq!(extract_chapter_title(path), "第一章");
    }

    #[test]
    fn test_extract_chapter_title_strips_leading_number() {
        let path = Path::new("/project/正文/01.序章.txt");
        assert_eq!(extract_chapter_title(path), "序章");
    }

    #[test]
    fn test_sanitize_filename_replaces_illegal_chars() {
        assert_eq!(sanitize_filename("a:b"), "a_b");
        assert_eq!(sanitize_filename("正常名称"), "正常名称");
    }

    #[test]
    fn test_build_chapter_text_with_title() {
        let options = TxtExportOptions {
            mode: "single".to_string(),
            include_chapter_title: true,
            bom: false,
            crlf: false,
            output_path: String::new(),
            chapter_path: None,
        };
        let result = build_chapter_text("正文内容", "第一章", &options);
        assert_eq!(result, "第一章\n\n正文内容");
    }

    #[test]
    fn test_build_chapter_text_without_title() {
        let options = TxtExportOptions {
            mode: "single".to_string(),
            include_chapter_title: false,
            bom: false,
            crlf: false,
            output_path: String::new(),
            chapter_path: None,
        };
        let result = build_chapter_text("正文内容", "第一章", &options);
        assert_eq!(result, "正文内容");
    }
}
