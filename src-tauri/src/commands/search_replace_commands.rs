// 全局搜索与结构感知替换命令模块
//
// 功能概述：
// 提供项目内全文搜索与按文档格式结构感知的全局替换 Tauri 命令。
// 替换支持 ProseMirror JSON、HTML、JSON front matter 与纯文本四种格式，
// 保留文档结构，仅替换文本内容。
//
// 模块职责：
// 1. 全局搜索项目内文本（逐行匹配，提取上下文）
// 2. 全局替换项目内文本（结构感知：PmdJson/Html/JsonFrontMatter/PlainText）
// 3. 替换后同步 Tantivy 索引（仅对可索引格式）
//
// 错误处理：
// 所有 Tauri 命令返回 Result<T, AppError>，向前端传递结构化错误信息。

use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::{is_indexable_file, validate_project_path};
use crate::error::AppError;
use crate::index_sync::sync_index_add;
use crate::text_extractor;

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
/// 输出: Result<Vec<SearchResult>, AppError> 搜索结果列表
/// 流程: 递归遍历项目内所有 .txt 文件，逐行匹配关键词
#[tauri::command]
pub fn search_in_project(
    project_path: String,
    query: String,
    case_sensitive: bool,
) -> Result<Vec<SearchResult>, AppError> {
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
    // 限制最大结果数为 1000 条, 平衡性能与大型项目完整搜索需求
    // (原 200 条上限对数百章节长篇项目不足, 此处提升至 1000)
    results.truncate(1000);
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
/// 输出: Result<ReplaceResult, AppError> 替换结果统计
/// 流程:
///   1. 校验项目路径与查找词非空
///   2. 递归遍历项目内所有支持文档（.txt/.pmd/.html/.htm，跳过 .开头目录）
///   3. 按格式分派结构感知替换:
///      - PmdJson: 递归遍历 ProseMirror JSON，仅替换 text 节点 text 字段
///      - Html: 状态机识别标签边界，仅替换标签间文本
///      - JsonFrontMatter: 保留 --- 包裹的 JSON 元数据，仅替换正文
///      - PlainText: 直接字符串替换
///   4. 仅当内容有变化时写回文件
///   5. 统计修改文件数与替换次数
/// 安全: 仅支持文档格式可被修改，所有路径经沙箱校验
#[tauri::command]
pub fn replace_in_project(
    project_path: String,
    query: String,
    replacement: String,
    case_sensitive: bool,
) -> Result<ReplaceResult, AppError> {
    if query.trim().is_empty() {
        return Err(AppError::path_validation_error("查找内容不能为空"));
    }
    if query == replacement {
        return Err(AppError::path_validation_error(
            "查找内容与替换内容相同，无需替换",
        ));
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
/// 流程: 遍历目录，对每个支持的文档文件（.txt/.pmd/.html/.htm）执行结构感知替换并写回
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
            } else if is_indexable_file(&path) {
                // P1-6: 扩展为支持 .txt/.pmd/.html/.htm 四种格式
                // replace_in_file 内部根据 detect_format 分派到结构感知替换函数
                let count = replace_in_file(&path, ctx);
                if count > 0 {
                    ctx.total_replacements += count;
                    ctx.files_modified += 1;
                }
            }
        }
    }
}

/// 在单个文件中执行结构感知替换并写回
/// 输入:
///   file_path 文件路径
///   ctx 替换上下文（含配置与结果集合）
/// 输出: u64 替换次数
/// 流程:
///   1. 读取文件内容
///   2. 通过 text_extractor::detect_format 检测格式
///   3. 按格式分派到结构感知替换函数（保留 JSON 结构/HTML 标签/front matter）
///   4. 仅当有替换发生且内容变化时写回文件
///   5. 记录文件结果到 ctx.files
///   6. P1-4: 写回后同步 Tantivy 索引（仅对可索引格式，失败仅记录日志）
fn replace_in_file(file_path: &Path, ctx: &mut ReplaceContext) -> u64 {
    let content = match fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => return 0,
    };
    let file_name = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    // P1-6: 通过 text_extractor 检测格式，按格式分派到结构感知替换
    let format = text_extractor::detect_format(&file_name, &content);
    let (new_content, count) = match format {
        text_extractor::ContentFormat::PmdJson => {
            replace_in_pmd_json(&content, &ctx.query, &ctx.replacement, ctx.case_sensitive)
        }
        text_extractor::ContentFormat::Html => {
            replace_in_html(&content, &ctx.query, &ctx.replacement, ctx.case_sensitive)
        }
        text_extractor::ContentFormat::JsonFrontMatter => replace_in_front_matter(
            &content,
            &ctx.query,
            &ctx.replacement,
            ctx.case_sensitive,
        ),
        text_extractor::ContentFormat::PlainText => {
            // 纯文本：直接字符串替换（保留原始换行符）
            let count = count_matches(&content, &ctx.query, ctx.case_sensitive);
            if count == 0 {
                return 0;
            }
            let new_content = if ctx.case_sensitive {
                content.replace(&ctx.query, &ctx.replacement)
            } else {
                case_insensitive_replace(&content, &ctx.query, &ctx.replacement)
            };
            (new_content, count)
        }
    };
    if count == 0 || new_content == content {
        return 0;
    }
    let _ = fs::write(file_path, &new_content);
    let relative_path = file_path
        .strip_prefix(&ctx.root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    ctx.files.push(ReplaceFileResult {
        relative_path: relative_path.clone(),
        file_name,
        replacements: count,
    });
    // P1-4: 替换写回后同步 Tantivy 索引（仅对可索引格式，失败仅记录日志）
    if is_indexable_file(file_path) {
        if let Err(e) = sync_index_add(&ctx.root, file_path, &relative_path) {
            eprintln!("[索引同步] 替换后同步失败 {}: {}", relative_path, e);
        }
    }
    count
}

/// 在 ProseMirror JSON 文档中执行结构感知替换
/// 输入:
///   content ProseMirror JSON 字符串
///   query 查找词
///   replacement 替换字符串
///   case_sensitive 是否区分大小写
/// 输出: (String, u64) 替换后的 JSON 字符串与替换次数
/// 流程:
///   1. 解析 JSON 为 serde_json::Value
///   2. 递归遍历节点树，仅对 text 节点的 text 字段执行替换
///   3. 保留所有结构化标记（节点类型/属性/嵌套关系不变）
///   4. 序列化回 JSON 字符串（pretty 格式，保持与编辑器输出一致）
/// 容错: JSON 解析失败时降级为纯文本替换（避免阻塞替换流程）
fn replace_in_pmd_json(
    content: &str,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
) -> (String, u64) {
    let mut parsed: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => {
            // JSON 解析失败：降级为纯文本替换
            let count = count_matches(content, query, case_sensitive);
            if count == 0 {
                return (content.to_string(), 0);
            }
            let new_content = if case_sensitive {
                content.replace(query, replacement)
            } else {
                case_insensitive_replace(content, query, replacement)
            };
            return (new_content, count);
        }
    };
    let mut total_count: u64 = 0;
    replace_text_in_node_recursive(&mut parsed, query, replacement, case_sensitive, &mut total_count);
    if total_count == 0 {
        return (content.to_string(), 0);
    }
    // 序列化回 JSON（pretty 格式，保持与 NovelEditor 输出一致）
    match serde_json::to_string_pretty(&parsed) {
        Ok(new_content) => (new_content, total_count),
        Err(_) => (content.to_string(), 0),
    }
}

/// 递归遍历 ProseMirror 节点树，在 text 节点中执行替换
/// 输入:
///   node 当前节点（可变引用）
///   query 查找词
///   replacement 替换字符串
///   case_sensitive 是否区分大小写
///   total_count 替换次数累加器
/// 流程:
///   1. 若节点 type == "text"，对其 attrs.text 或 text 字段执行替换
///   2. 递归处理 content 数组中的所有子节点
///   3. characterMentionNode 的 attrs.name 也参与替换（角色名可能被替换）
fn replace_text_in_node_recursive(
    node: &mut serde_json::Value,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
    total_count: &mut u64,
) {
    if let Some(node_type) = node.get("type").and_then(|v| v.as_str()) {
        let node_type = node_type.to_string();
        match node_type.as_str() {
            // text 节点：替换 text 字段
            "text" => {
                if let Some(text_val) = node.get_mut("text").and_then(|v| v.as_str().map(|s| s.to_string())) {
                    let old_text = text_val;
                    let (new_text, count) = replace_with_count(&old_text, query, replacement, case_sensitive);
                    if count > 0 {
                        if let Some(text_field) = node.get_mut("text") {
                            *text_field = serde_json::Value::String(new_text);
                        }
                        *total_count += count;
                    }
                }
            }
            // characterMentionNode：替换 attrs.name 字段（角色名可能需要批量替换）
            "characterMentionNode" => {
                if let Some(attrs) = node.get_mut("attrs") {
                    if let Some(name_val) = attrs.get_mut("name").and_then(|v| v.as_str().map(|s| s.to_string())) {
                        let old_name = name_val;
                        let (new_name, count) = replace_with_count(&old_name, query, replacement, case_sensitive);
                        if count > 0 {
                            if let Some(name_field) = attrs.get_mut("name") {
                                *name_field = serde_json::Value::String(new_name);
                            }
                            *total_count += count;
                        }
                    }
                }
            }
            _ => {}
        }
    }
    // 递归处理子节点
    if let Some(content) = node.get_mut("content").and_then(|v| v.as_array_mut()) {
        for child in content.iter_mut() {
            replace_text_in_node_recursive(child, query, replacement, case_sensitive, total_count);
        }
    }
}

/// 在 HTML 文档中执行结构感知替换（保留标签与属性，仅替换标签间文本）
/// 输入:
///   content HTML 字符串
///   query 查找词
///   replacement 替换字符串
///   case_sensitive 是否区分大小写
/// 输出: (String, u64) 替换后的 HTML 与替换次数
/// 流程:
///   1. 逐字符扫描，识别 < > 包裹的标签区域
///   2. 标签外的文本执行替换
///   3. 标签内的内容（含属性值）原样保留
/// 设计依据: 避免引入 HTML 解析器重依赖，手写状态机足够覆盖项目内的简单 HTML
fn replace_in_html(
    content: &str,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
) -> (String, u64) {
    let mut result = String::with_capacity(content.len());
    let mut in_tag = false;
    let mut text_buffer = String::new();
    let mut total_count: u64 = 0;

    for ch in content.chars() {
        if in_tag {
            result.push(ch);
            if ch == '>' {
                in_tag = false;
            }
        } else if ch == '<' {
            // 标签开始前：先处理累积的文本
            if !text_buffer.is_empty() {
                let (new_text, count) = replace_with_count(&text_buffer, query, replacement, case_sensitive);
                result.push_str(&new_text);
                total_count += count;
                text_buffer.clear();
            }
            result.push(ch);
            in_tag = true;
        } else {
            text_buffer.push(ch);
        }
    }
    // 处理末尾残余文本
    if !text_buffer.is_empty() {
        let (new_text, count) = replace_with_count(&text_buffer, query, replacement, case_sensitive);
        result.push_str(&new_text);
        total_count += count;
    }
    (result, total_count)
}

/// 在 JSON front matter 设定文件中执行替换（保留 --- 包裹的 JSON 元数据）
/// 输入:
///   content 设定文件内容
///   query 查找词
///   replacement 替换字符串
///   case_sensitive 是否区分大小写
/// 输出: (String, u64) 替换后的内容与替换次数
/// 流程:
///   1. 检测首行是否为 ---
///   2. 查找第二个 --- 结束标记
///   3. 仅对结束标记后的正文执行替换
///   4. 保留 front matter JSON 不变
fn replace_in_front_matter(
    content: &str,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
) -> (String, u64) {
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() < 3 || lines[0].trim() != "---" {
        // 无 front matter：按纯文本处理
        let count = count_matches(content, query, case_sensitive);
        if count == 0 {
            return (content.to_string(), 0);
        }
        let new_content = if case_sensitive {
            content.replace(query, replacement)
        } else {
            case_insensitive_replace(content, query, replacement)
        };
        return (new_content, count);
    }
    // 查找结束标记 ---
    let mut end_marker_idx: Option<usize> = None;
    for (i, line) in lines[1..].iter().enumerate() {
        if line.trim() == "---" {
            end_marker_idx = Some(i + 1); // 转换回原索引
            break;
        }
    }
    match end_marker_idx {
        Some(idx) => {
            // 分离 front matter 与正文
            let front_matter = lines[..=idx].join("\n");
            let body = lines[idx + 1..].join("\n");
            let (new_body, count) = replace_with_count(&body, query, replacement, case_sensitive);
            if count == 0 {
                return (content.to_string(), 0);
            }
            // 拼接时保留原始换行结构
            let mut result = front_matter;
            if !result.ends_with('\n') {
                result.push('\n');
            }
            result.push_str(&new_body);
            (result, count)
        }
        None => {
            // 无结束标记：按纯文本处理
            let count = count_matches(content, query, case_sensitive);
            if count == 0 {
                return (content.to_string(), 0);
            }
            let new_content = if case_sensitive {
                content.replace(query, replacement)
            } else {
                case_insensitive_replace(content, query, replacement)
            };
            (new_content, count)
        }
    }
}

/// 带计数的字符串替换（区分大小写）
/// 输入: text 原文, query 查找词, replacement 替换字符串, case_sensitive 区分大小写
/// 输出: (String, u64) 替换后的文本与替换次数
fn replace_with_count(
    text: &str,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
) -> (String, u64) {
    if query.is_empty() {
        return (text.to_string(), 0);
    }
    let mut count: u64 = 0;
    let new_text = if case_sensitive {
        let mut result = String::with_capacity(text.len());
        let mut start = 0;
        while let Some(pos) = text[start..].find(query) {
            let abs_pos = start + pos;
            result.push_str(&text[start..abs_pos]);
            result.push_str(replacement);
            count += 1;
            start = abs_pos + query.len();
        }
        result.push_str(&text[start..]);
        result
    } else {
        let lower_text = text.to_lowercase();
        let lower_query = query.to_lowercase();
        let mut result = String::with_capacity(text.len());
        let mut start = 0;
        while let Some(pos) = lower_text[start..].find(&lower_query) {
            let abs_pos = start + pos;
            result.push_str(&text[start..abs_pos]);
            result.push_str(replacement);
            count += 1;
            start = abs_pos + query.len();
        }
        result.push_str(&text[start..]);
        result
    };
    (new_text, count)
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
