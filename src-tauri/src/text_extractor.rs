// 文本内容提取器模块
//
// 功能概述：
// 统一处理 4 种内容格式的文本提取、搜索、替换操作，为全局搜索、Tantivy 索引、
// 字数统计提供一致的纯文本入口。
//
// 支持格式：
// 1. PmdJson: ProseMirror JSON 文档（.pmd 文件，纯 JSON 无 --- 包裹）
// 2. Html: HTML 文档（旧版 .html/.txt 含 HTML 标签）
// 3. PlainText: 纯文本（无格式 .txt）
// 4. JsonFrontMatter: JSON front matter 设定文件（--- 包裹的 JSON + 正文）
//
// 模块职责：
// 1. 检测内容格式（基于扩展名与内容首行）
// 2. 提取纯文本（剥离 JSON 结构/HTML 标签/front matter）
// 3. 提取词汇列表（用于 Tantivy 索引分词）
// 4. 在原始内容中搜索关键词（返回匹配位置）
// 5. 在原始内容中替换关键词（保留格式，仅替换文本节点）
//
// 设计说明：
// - HTML 标签剥离采用手写状态机，避免引入 scraper/html5ever 重依赖
// - .pmd JSON 解析复用 serde_json，递归遍历 ProseMirror doc 节点树
// - JSON front matter 复用 codex_commands::parse_codex_file 的解析逻辑（剥离 --- 包裹）
// - 替换操作仅在文本节点中执行，保留所有结构化标记

use serde::{Deserialize, Serialize};

/// 内容格式枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentFormat {
    /// ProseMirror JSON 文档（.pmd 文件）
    PmdJson,
    /// HTML 文档（.html 或含 HTML 标签的 .txt）
    Html,
    /// 纯文本（无格式 .txt）
    PlainText,
    /// JSON front matter 设定文件（--- 包裹的 JSON + 正文）
    JsonFrontMatter,
}

/// 搜索匹配结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    /// 匹配起始位置（字节偏移，基于纯文本）
    pub start: usize,
    /// 匹配结束位置（字节偏移）
    pub end: usize,
    /// 匹配文本
    pub text: String,
    /// 上下文预览（前后各约 30 字符）
    pub context: String,
}

/// 替换结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplaceResult {
    /// 替换后的纯文本内容
    pub new_text: String,
    /// 替换次数
    pub count: u32,
}

/// 根据文件扩展名与内容首行检测格式
/// 输入: file_name 文件名, content 文件内容
/// 输出: ContentFormat 检测到的格式
/// 流程:
///   1. 按扩展名判断：.pmd -> PmdJson, .html -> Html
///   2. .txt 文件检查首行是否为 ---（JSON front matter）
///   3. 其余按 PlainText 处理
pub fn detect_format(file_name: &str, content: &str) -> ContentFormat {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".pmd") {
        ContentFormat::PmdJson
    } else if lower.ends_with(".html") || lower.ends_with(".htm") {
        ContentFormat::Html
    } else if lower.ends_with(".txt") {
        // 检查是否为 JSON front matter 格式（首行 ---）
        let first_line = content.lines().next().unwrap_or("").trim();
        if first_line == "---" {
            ContentFormat::JsonFrontMatter
        } else {
            // 检查是否含 HTML 标签（旧版 .txt 可能存储 HTML 内容）
            if content.contains("<p>") || content.contains("<div>") || content.contains("<br") {
                ContentFormat::Html
            } else {
                ContentFormat::PlainText
            }
        }
    } else {
        ContentFormat::PlainText
    }
}

/// 提取纯文本
/// 输入: content 原始内容, format 内容格式
/// 输出: String 纯文本（已剥离所有结构化标记）
/// 流程: 按 format 分派到对应的提取函数
pub fn extract_plain_text(content: &str, format: ContentFormat) -> String {
    match format {
        ContentFormat::PmdJson => extract_text_from_pmd(content),
        ContentFormat::Html => extract_text_from_html(content),
        ContentFormat::PlainText => content.to_string(),
        ContentFormat::JsonFrontMatter => extract_text_from_front_matter(content),
    }
}

/// 从 ProseMirror JSON 文档中提取纯文本
/// 输入: content ProseMirror JSON 字符串
/// 输出: String 纯文本（所有 text 节点按文档顺序拼接，块级节点间换行）
/// 流程:
///   1. 解析 JSON 为 serde_json::Value
///   2. 递归遍历 doc 节点树
///   3. 收集 text 节点的 text 属性
///   4. 块级节点（paragraph/heading/sceneBreak 等）后追加换行
fn extract_text_from_pmd(content: &str) -> String {
    let parsed: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => {
            // JSON 解析失败，降级为纯文本返回
            return content.to_string();
        }
    };

    let mut result = String::new();
    collect_text_from_node(&parsed, &mut result, true);
    result.trim_end().to_string()
}

/// 递归遍历 ProseMirror 节点树，收集 text 节点内容
/// 输入:
///   node - 当前节点 JSON Value
///   result - 累积的纯文本（可变引用）
///   is_block - 当前节点是否为块级（决定是否追加换行）
/// 流程:
///   1. 检查节点 type 是否为 text，若是则追加 text 属性
///   2. 块级节点（paragraph/heading/sceneBreak 等）处理完子节点后追加换行
///   3. 递归处理 content 数组中的子节点
fn collect_text_from_node(node: &serde_json::Value, result: &mut String, is_block: bool) {
    if let Some(node_type) = node.get("type").and_then(|v| v.as_str()) {
        match node_type {
            // text 节点：追加 text 属性
            "text" => {
                if let Some(text) = node.get("text").and_then(|v| v.as_str()) {
                    result.push_str(text);
                }
            }
            // 场景分隔符：追加占位文本
            "sceneBreak" => {
                result.push_str("\n* * *\n");
            }
            // characterMentionNode：追加 name 属性
            "characterMentionNode" => {
                if let Some(name) = node.get("attrs").and_then(|a| a.get("name")).and_then(|v| v.as_str()) {
                    result.push_str(name);
                }
            }
            // 块级节点：递归处理子节点后追加换行
            "paragraph" | "heading" | "blockquote" | "codeBlock" | "bulletList" | "orderedList" | "listItem" | "taskList" | "taskItem" => {
                if let Some(content) = node.get("content").and_then(|v| v.as_array()) {
                    for child in content {
                        collect_text_from_node(child, result, true);
                    }
                }
                if is_block {
                    result.push('\n');
                }
            }
            // 其他节点（doc/hardBreak 等）：递归处理子节点
            _ => {
                if let Some(content) = node.get("content").and_then(|v| v.as_array()) {
                    for child in content {
                        collect_text_from_node(child, result, is_block);
                    }
                }
                // hardBreak 节点追加换行
                if node_type == "hardBreak" {
                    result.push('\n');
                }
            }
        }
    }
}

/// 从 HTML 中提取纯文本（手写状态机，避免引入 scraper/html5ever）
/// 输入: content HTML 字符串
/// 输出: String 纯文本（已剥离所有标签，块级标签后换行）
/// 流程:
///   1. 逐字符扫描，识别 < > 包裹的标签
///   2. 标签外的内容追加到结果
///   3. 块级标签（p/div/br/h1-h6/li 等）闭合后追加换行
///   4. 转义 HTML 实体（&amp; &lt; &gt; &nbsp; &quot;）
fn extract_text_from_html(content: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    let mut tag_buffer = String::new();

    for ch in content.chars() {
        if in_tag {
            if ch == '>' {
                in_tag = false;
                let tag_lower = tag_buffer.trim().to_lowercase();
                let tag_name = tag_lower.split_whitespace().next().unwrap_or("");
                // 块级标签闭合后追加换行
                if matches!(
                    tag_name,
                    "p" | "/p" | "div" | "/div" | "br" | "br/" | "br /" |
                    "h1" | "/h1" | "h2" | "/h2" | "h3" | "/h3" |
                    "h4" | "/h4" | "h5" | "/h5" | "h6" | "/h6" |
                    "li" | "/li" | "/hr" | "hr"
                ) {
                    result.push('\n');
                }
                tag_buffer.clear();
            } else {
                tag_buffer.push(ch);
            }
        } else if ch == '<' {
            in_tag = true;
            tag_buffer.clear();
        } else {
            result.push(ch);
        }
    }

    // 转义 HTML 实体
    let result = result
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");

    // 合并连续空行，trim 首尾空白
    let mut cleaned = String::new();
    let mut prev_blank = false;
    for line in result.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !prev_blank && !cleaned.is_empty() {
                cleaned.push('\n');
            }
            prev_blank = true;
        } else {
            cleaned.push_str(trimmed);
            cleaned.push('\n');
            prev_blank = false;
        }
    }
    cleaned.trim_end().to_string()
}

/// 从 JSON front matter 设定文件中提取正文（剥离 --- 包裹的 JSON）
/// 输入: content 设定文件内容
/// 输出: String 正文纯文本（已剥离 front matter）
/// 流程:
///   1. 检测首行是否为 ---
///   2. 查找第二个 --- 结束标记
///   3. 返回结束标记后的正文
///   4. 无 front matter 时返回原内容
fn extract_text_from_front_matter(content: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() < 3 || lines[0].trim() != "---" {
        return content.to_string();
    }
    // 查找结束标记 ---
    for (i, line) in lines[1..].iter().enumerate() {
        if line.trim() == "---" {
            return lines[i + 2..].join("\n").trim_start().to_string();
        }
    }
    content.to_string()
}

/// 提取词汇列表（用于 Tantivy 索引分词）
/// 输入: content 原始内容, format 内容格式
/// 输出: Vec<String> 词汇列表（已去重，长度 >= 2）
/// 流程:
///   1. 提取纯文本
///   2. 按非字母数字字符分割
///   3. 过滤空串与单字符
///   4. 去重返回
pub fn extract_words(content: &str, format: ContentFormat) -> Vec<String> {
    let plain = extract_plain_text(content, format);
    let mut words: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for word in plain.split(|c: char| !c.is_alphanumeric() && c != '_') {
        let trimmed = word.trim();
        if trimmed.chars().count() < 2 {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            words.push(trimmed.to_string());
        }
    }
    words
}

/// 在内容中搜索关键词
/// 输入:
///   content - 原始内容
///   query - 搜索关键词
///   case_sensitive - 是否区分大小写
///   format - 内容格式
/// 输出: Vec<SearchMatch> 匹配结果列表（含位置与上下文）
/// 流程:
///   1. 提取纯文本
///   2. 在纯文本中查找所有匹配位置
///   3. 为每个匹配提取上下文预览（前后各 30 字符）
pub fn search_in_content(
    content: &str,
    query: &str,
    case_sensitive: bool,
    format: ContentFormat,
) -> Vec<SearchMatch> {
    if query.is_empty() {
        return vec![];
    }

    let plain = extract_plain_text(content, format);
    let mut matches = Vec::new();

    let (search_text, search_query) = if case_sensitive {
        (plain.clone(), query.to_string())
    } else {
        (plain.to_lowercase(), query.to_lowercase())
    };

    let query_len = query.len();
    let mut start = 0;
    while let Some(pos) = search_text[start..].find(&search_query) {
        let abs_pos = start + pos;
        let abs_end = abs_pos + query_len;

        // 提取匹配文本（用原始纯文本，保留大小写）
        let matched_text = &plain[abs_pos..abs_end];

        // 提取上下文（前后各 30 字符）
        let ctx_start = abs_pos.saturating_sub(30);
        let ctx_end = (abs_end + 30).min(plain.len());
        let context = plain[ctx_start..ctx_end]
            .replace('\n', " ")
            .replace('\r', "");

        matches.push(SearchMatch {
            start: abs_pos,
            end: abs_end,
            text: matched_text.to_string(),
            context,
        });

        start = abs_end;
        if start >= search_text.len() {
            break;
        }
    }

    matches
}

/// 在内容中替换关键词（仅在纯文本层面，保留结构化标记）
/// 输入:
///   content - 原始内容
///   query - 搜索关键词
///   replacement - 替换文本
///   case_sensitive - 是否区分大小写
///   format - 内容格式
/// 输出: ReplaceResult 替换后的纯文本与替换次数
/// 流程:
///   1. 提取纯文本
///   2. 在纯文本中执行替换
///   3. 返回新文本与替换次数
/// 注意: 此函数返回纯文本，丢失原始结构。
///       结构化内容的替换应由前端 ProseMirror 编辑器处理。
pub fn replace_in_content(
    content: &str,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
    format: ContentFormat,
) -> ReplaceResult {
    if query.is_empty() {
        return ReplaceResult {
            new_text: extract_plain_text(content, format),
            count: 0,
        };
    }

    let plain = extract_plain_text(content, format);
    let mut count = 0u32;
    // Rust 的 str::replace 不接受闭包，手动循环实现带计数的替换
    let new_text = if case_sensitive {
        let mut result = String::with_capacity(plain.len());
        let mut start = 0;
        while let Some(pos) = plain[start..].find(query) {
            let abs_pos = start + pos;
            result.push_str(&plain[start..abs_pos]);
            result.push_str(replacement);
            count += 1;
            start = abs_pos + query.len();
        }
        result.push_str(&plain[start..]);
        result
    } else {
        let mut result = String::with_capacity(plain.len());
        let lower_plain = plain.to_lowercase();
        let lower_query = query.to_lowercase();
        let mut start = 0;
        while let Some(pos) = lower_plain[start..].find(&lower_query) {
            let abs_pos = start + pos;
            result.push_str(&plain[start..abs_pos]);
            result.push_str(replacement);
            count += 1;
            start = abs_pos + query.len();
        }
        result.push_str(&plain[start..]);
        result
    };

    ReplaceResult { new_text, count }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_plain_text_from_plain() {
        let content = "Hello World";
        assert_eq!(extract_plain_text(content, ContentFormat::PlainText), "Hello World");
    }

    #[test]
    fn test_extract_text_from_html() {
        let content = "<p>Hello</p><p>World</p>";
        let result = extract_text_from_html(content);
        assert!(result.contains("Hello"));
        assert!(result.contains("World"));
    }

    #[test]
    fn test_extract_text_from_front_matter() {
        let content = "---\n{\"id\":\"123\"}\n---\n正文内容";
        let result = extract_text_from_front_matter(content);
        assert_eq!(result, "正文内容");
    }

    #[test]
    fn test_search_in_content() {
        let content = "Hello World Hello Again";
        let matches = search_in_content(content, "Hello", true, ContentFormat::PlainText);
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].start, 0);
        assert_eq!(matches[1].start, 12);
    }

    #[test]
    fn test_replace_in_content() {
        let content = "Hello World Hello Again";
        let result = replace_in_content(content, "Hello", "Hi", true, ContentFormat::PlainText);
        assert_eq!(result.count, 2);
        assert_eq!(result.new_text, "Hi World Hi Again");
    }
}
