// 文本内容提取器模块
//
// 功能概述：
// 统一处理 4 种内容格式的文本提取，为 Tantivy 索引、字数统计提供一致的纯文本入口。
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
//
// 设计说明：
// - HTML 标签剥离采用手写状态机，避免引入 scraper/html5ever 重依赖
// - .pmd JSON 解析复用 serde_json，递归遍历 ProseMirror doc 节点树
// - JSON front matter 复用 codex::parse_codex_file 的解析逻辑（剥离 --- 包裹）

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
}
