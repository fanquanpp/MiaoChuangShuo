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
///   2. .txt 文件优先探测 ProseMirror JSON (Task 2.7 修复):
///      若首字符为 { 且能解析为 JSON 含 type 字段, 视为误存的 PmdJson
///   3. .txt 文件检查首行是否为 ---（JSON front matter）
///   4. .txt 文件检查是否含 HTML 标签
///   5. 其余按 PlainText 处理
pub fn detect_format(file_name: &str, content: &str) -> ContentFormat {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".pmd") {
        ContentFormat::PmdJson
    } else if lower.ends_with(".html") || lower.ends_with(".htm") {
        ContentFormat::Html
    } else if lower.ends_with(".txt") {
        // Task 2.7: 探测是否为误存的 ProseMirror JSON
        // 场景: .pmd 文件被误重命名为 .txt, 或旧版本导出 .txt 时写入了 JSON 内容
        // 判定条件: 去除前导空白后首字符为 { 且能解析为 JSON 且含 type 字段
        let trimmed = content.trim_start();
        if trimmed.starts_with('{') {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                if val.get("type").is_some() {
                    return ContentFormat::PmdJson;
                }
            }
        }

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
/// 输入: content ProseMirror JSON 字符串(可能含 YAML front matter 头)
/// 输出: String 纯文本（所有 text 节点按文档顺序拼接，块级节点间换行）
/// 流程:
///   1. 若文件顶部含 YAML front matter(--- 包裹),先剥离 front matter 取正文
///   2. 解析正文 JSON 为 serde_json::Value
///   3. 递归遍历 doc 节点树
///   4. 收集 text 节点的 text 属性
///   5. 块级节点（paragraph/heading/sceneBreak 等）后追加换行
/// 设计说明: Task 1.3 后章节/大纲 .pmd 文件顶部注入 YAML front matter,
///          需先剥离 front matter 才能正确解析 ProseMirror JSON 正文
fn extract_text_from_pmd(content: &str) -> String {
    // 先剥离 YAML front matter(若存在),取正文部分再解析 JSON
    let body = extract_front_matter(content)
        .map(|(_, body)| body)
        .unwrap_or_else(|| content.to_string());

    let parsed: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => {
            // JSON 解析失败，降级为纯文本返回(返回剥离 front matter 后的正文)
            return body;
        }
    };

    let mut result = String::new();
    collect_text_from_node(&parsed, &mut result, true);
    result.trim_end().to_string()
}

/// 递归遍历 ProseMirror 节点树，收集 text 节点内容
///
/// Task 6.2.2 重构: 内部委托给 prosemirror_parser::collect_text_from_node_core,
/// 关闭 scene_id 收集并丢弃场景标识,消除重复的节点遍历逻辑。
///
/// 输入:
///   node - 当前节点 JSON Value
///   result - 累积的纯文本（可变引用）
///   _is_block - 已废弃参数,保留仅为向后兼容(核心函数统一采用块级节点追加换行策略)
/// 流程: 委托 collect_text_from_node_core,collect_scene_id=false
fn collect_text_from_node(node: &serde_json::Value, result: &mut String, _is_block: bool) {
    // scene_id 在此函数中不需要,使用本地变量接收后丢弃
    let mut scene_id: Option<String> = None;
    crate::prosemirror_parser::collect_text_from_node_core(node, result, false, &mut scene_id);
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

// ===== Task 1.3.1: YAML 风格 front matter 工具函数 =====
//
// 功能概述：
// 为章节(.pmd/.txt)与大纲(.pmd)文件提供 YAML 风格 front matter 注入与提取能力,
// 用于存储实体 UUID / volumeId / outlineId / order / title 等元数据,
// 作为 manifest.json 的文件级冗余索引,支撑数据孤岛联动优化。
//
// 格式示例（YAML 风格,与 codex JSON front matter 区分）：
// ---
// id: uuid-v4-string
// volumeId: volume-name-or-null
// outlineId: outline-uuid-or-null
// order: 1
// title: 章节标题
// ---
// 正文内容...
//
// 设计说明：
// - 采用简单 key: value 行格式,不引入 YAML 库依赖,避免缩进敏感问题
// - value 不加引号,值中的冒号需调用方自行避免(标题不含冒号)
// - 与 codex 模块的 JSON front matter(parse_codex_file)互不影响,各走各的解析路径

/// 注入 YAML 风格 front matter 到文件内容
///
/// 输入:
///   content - 正文内容(可为 ProseMirror JSON 字符串或纯文本)
///   meta - front matter 字段键值对列表(顺序保留,便于人工阅读)
/// 输出: String 带 front matter 的完整文件内容
/// 流程:
///   1. 构造 front matter 头: `---\n` + 每行 `key: value` + `\n---\n`
///   2. 拼接 front matter 头 + content 正文
///   3. 若 content 为空,front matter 后无正文(仅 front matter)
/// 说明: value 通过 Display trait 格式化,调用方需保证 value 不含换行符
pub fn inject_front_matter(content: &str, meta: &[(String, String)]) -> String {
    let mut result = String::new();
    result.push_str("---\n");
    for (key, value) in meta {
        result.push_str(key);
        result.push_str(": ");
        result.push_str(value);
        result.push('\n');
    }
    result.push_str("---\n");
    result.push_str(content);
    result
}

/// 从文件内容提取 YAML 风格 front matter
///
/// 输入: content 完整文件内容
/// 输出: Option<(Vec<(String, String)> 键值对列表, String 正文内容)>
///       无 front matter 时返回 None
/// 流程:
///   1. 检测首行是否为 `---`(允许首行前后空白),不是则返回 None
///   2. 查找下一个 `---` 结束标记
///   3. 中间内容按行解析为 key: value(简单分割第一个冒号)
///   4. 返回 (键值对列表, 结束标记后的正文)
/// 容错策略:
///   - 中间某行不含 `:` 时跳过该行(不报错,保持解析健壮性)
///   - value 前后空白被 trim
///   - 结束标记后正文 trim_start 换行符,保留正文内部格式
pub fn extract_front_matter(content: &str) -> Option<(Vec<(String, String)>, String)> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() || lines[0].trim() != "---" {
        return None;
    }

    // 查找结束标记 ---
    let end_idx = lines[1..]
        .iter()
        .position(|l| l.trim() == "---")
        .map(|i| i + 1)?;

    let mut meta = Vec::new();
    for line in &lines[1..end_idx] {
        // 跳过空行
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // 按第一个冒号分割为 key: value
        if let Some(colon_pos) = trimmed.find(':') {
            let key = trimmed[..colon_pos].trim().to_string();
            let value = trimmed[colon_pos + 1..].trim().to_string();
            if !key.is_empty() {
                meta.push((key, value));
            }
        }
        // 不含冒号的行跳过(容错,不报错)
    }

    // 结束标记后的正文(去掉前导换行)
    let body = if end_idx + 1 < lines.len() {
        lines[end_idx + 1..].join("\n").trim_start_matches('\n').to_string()
    } else {
        String::new()
    };

    Some((meta, body))
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

    /// Task 1.3.1: 验证 inject_front_matter 注入 YAML 风格 front matter
    #[test]
    fn test_inject_front_matter_basic() {
        let content = "正文内容";
        let meta = vec![
            ("id".to_string(), "uuid-1234".to_string()),
            ("title".to_string(), "第一章".to_string()),
        ];
        let result = inject_front_matter(content, &meta);
        assert!(result.starts_with("---\n"), "应以 --- 开头");
        assert!(result.contains("id: uuid-1234"), "应包含 id 字段");
        assert!(result.contains("title: 第一章"), "应包含 title 字段");
        // 第二个 --- 后应紧跟正文
        assert!(result.contains("---\n正文内容"), "应在 front matter 后拼接正文");
    }

    /// Task 1.3.1: 验证 inject_front_matter 空 meta 时仍生成空 front matter
    #[test]
    fn test_inject_front_matter_empty_meta() {
        let content = "正文";
        let meta: Vec<(String, String)> = Vec::new();
        let result = inject_front_matter(content, &meta);
        assert_eq!(result, "---\n---\n正文");
    }

    /// Task 1.3.1: 验证 extract_front_matter 提取 YAML 风格 front matter
    #[test]
    fn test_extract_front_matter_basic() {
        let content = "---\nid: uuid-1234\ntitle: 第一章\norder: 1\n---\n正文内容";
        let result = extract_front_matter(content);
        assert!(result.is_some(), "应能提取 front matter");
        let (meta, body) = result.unwrap();
        assert_eq!(meta.len(), 3, "应解析出 3 个键值对");
        assert_eq!(meta[0], ("id".to_string(), "uuid-1234".to_string()));
        assert_eq!(meta[1], ("title".to_string(), "第一章".to_string()));
        assert_eq!(meta[2], ("order".to_string(), "1".to_string()));
        assert_eq!(body, "正文内容");
    }

    /// Task 1.3.1: 验证 extract_front_matter 无 front matter 时返回 None
    #[test]
    fn test_extract_front_matter_none() {
        let content = "纯文本内容无 front matter";
        assert!(extract_front_matter(content).is_none());
    }

    /// Task 1.3.1: 验证 extract_front_matter 注入与提取的往返一致性
    #[test]
    fn test_front_matter_roundtrip() {
        let original_body = "{\"type\":\"doc\",\"content\":[]}";
        let meta = vec![
            ("id".to_string(), "abc-xyz".to_string()),
            ("title".to_string(), "测试章节".to_string()),
            ("volumeId".to_string(), "第一卷".to_string()),
        ];
        let injected = inject_front_matter(original_body, &meta);
        let extracted = extract_front_matter(&injected).expect("往返应能提取");
        let (extracted_meta, extracted_body) = extracted;
        assert_eq!(extracted_meta, meta, "往返后 meta 应一致");
        assert_eq!(extracted_body, original_body, "往返后正文应一致");
    }

    /// Task 1.3.1: 验证 extract_text_from_pmd 能剥离 front matter 后正确提取文本
    #[test]
    fn test_extract_text_from_pmd_with_front_matter() {
        // 构造含 front matter 的 .pmd 文件内容
        let pmd_content = "---\nid: uuid-1\ntitle: 测试\n---\n{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"你好世界\"}]}]}";
        let result = extract_text_from_pmd(pmd_content);
        assert_eq!(result, "你好世界", "应剥离 front matter 后提取文本");
    }

    /// Task 1.3.1: 验证 extract_text_from_pmd 无 front matter 时保持原行为
    #[test]
    fn test_extract_text_from_pmd_without_front_matter() {
        let pmd_content = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"测试文本\"}]}]}";
        let result = extract_text_from_pmd(pmd_content);
        assert_eq!(result, "测试文本");
    }

    // ===== Task 2.7.2: detect_format 格式检测单元测试 =====

    /// Task 2.7.2: 验证 .pmd 文件检测为 PmdJson 格式
    #[test]
    fn test_detect_format_pmd() {
        let content = "{\"type\":\"doc\",\"content\":[]}";
        assert_eq!(detect_format("chapter.pmd", content), ContentFormat::PmdJson);
        // 大写扩展名也应正确识别
        assert_eq!(detect_format("CHAPTER.PMD", content), ContentFormat::PmdJson);
    }

    /// Task 2.7.2: 验证 .html/.htm 文件检测为 Html 格式
    #[test]
    fn test_detect_format_html() {
        let content = "<p>内容</p>";
        assert_eq!(detect_format("page.html", content), ContentFormat::Html);
        assert_eq!(detect_format("page.htm", content), ContentFormat::Html);
    }

    /// Task 2.7.2: 验证纯文本 .txt 文件检测为 PlainText 格式
    #[test]
    fn test_detect_format_txt_plain() {
        let content = "这是一段纯文本内容，没有任何结构化标记。";
        assert_eq!(detect_format("notes.txt", content), ContentFormat::PlainText);
    }

    /// Task 2.7.2: 验证含 ProseMirror JSON 内容的 .txt 文件检测为 PmdJson 格式
    ///
    /// 场景: .pmd 文件被误重命名为 .txt, 或旧版本导出时将 JSON 写入 .txt
    /// 修复前: detect_format 返回 PlainText, 导致字数统计将 JSON 结构字符计入
    /// 修复后: detect_format 探测 JSON 内容, 返回 PmdJson, 字数统计只提取文本节点
    #[test]
    fn test_detect_format_txt_with_json_content() {
        // 标准 ProseMirror JSON 文档
        let content = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"你好\"}]}]}";
        assert_eq!(
            detect_format("chapter.txt", content),
            ContentFormat::PmdJson,
            "含 ProseMirror JSON 的 .txt 应检测为 PmdJson"
        );

        // 含前导空白的 JSON 也应正确识别
        let content_with_whitespace = "  {\"type\":\"doc\",\"content\":[]}";
        assert_eq!(
            detect_format("chapter.txt", content_with_whitespace),
            ContentFormat::PmdJson,
            "含前导空白的 JSON .txt 应检测为 PmdJson"
        );

        // 含换行前缀的 JSON 也应正确识别
        let content_with_newline = "\n\n{\"type\":\"doc\",\"content\":[]}";
        assert_eq!(
            detect_format("chapter.txt", content_with_newline),
            ContentFormat::PmdJson,
            "含换行前缀的 JSON .txt 应检测为 PmdJson"
        );
    }

    /// Task 2.7.2: 验证 JSON 但不含 type 字段的 .txt 不误判为 PmdJson
    #[test]
    fn test_detect_format_txt_json_without_type_field() {
        // JSON 但不含 type 字段 (非 ProseMirror 文档), 应保持 PlainText
        let content = "{\"name\":\"测试\",\"value\":123}";
        assert_eq!(
            detect_format("data.txt", content),
            ContentFormat::PlainText,
            "不含 type 字段的 JSON .txt 不应误判为 PmdJson"
        );
    }

    /// Task 2.7.2: 验证 JSON front matter 的 .txt 文件检测为 JsonFrontMatter 格式
    #[test]
    fn test_detect_format_txt_front_matter() {
        let content = "---\n{\"id\":\"123\"}\n---\n正文内容";
        assert_eq!(
            detect_format("codex.txt", content),
            ContentFormat::JsonFrontMatter
        );
    }

    // ===== Task 2.7.3: 字数统计不将 JSON 结构字符计入验证 =====

    /// Task 2.7.3: 验证含 JSON 内容的 .txt 文件字数统计不包含 JSON 结构字符
    ///
    /// 修复前: detect_format 返回 PlainText, extract_plain_text 直接返回原始 JSON 字符串,
    ///         字数统计将 {"type":"doc","content":[{ 等结构字符全部计入
    /// 修复后: detect_format 返回 PmdJson, extract_plain_text 递归提取 text 节点,
    ///         字数统计仅统计实际文本内容
    #[test]
    fn test_word_count_excludes_json_structure() {
        // 构造含文本节点的 ProseMirror JSON
        let content = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"你好世界\"}]}]}";

        // 修复后 detect_format 应识别为 PmdJson
        let format = detect_format("chapter.txt", content);
        assert_eq!(format, ContentFormat::PmdJson, "应检测为 PmdJson 格式");

        // extract_plain_text 应只提取文本节点内容, 不含 JSON 结构字符
        let plain_text = extract_plain_text(content, format);
        assert_eq!(plain_text, "你好世界", "提取的纯文本应只包含 text 节点内容");

        // 验证不包含 JSON 结构字符
        assert!(!plain_text.contains("\"type\""), "纯文本不应包含 JSON 字段名");
        assert!(!plain_text.contains("\"doc\""), "纯文本不应包含 doc 类型标识");
        assert!(!plain_text.contains("{"), "纯文本不应包含 JSON 大括号");
        assert!(!plain_text.contains("["), "纯文本不应包含 JSON 方括号");
    }

    /// Task 2.7.3: 验证多段落 ProseMirror JSON 的文本提取与字数统计
    #[test]
    fn test_word_count_multi_paragraph_json() {
        // 构造含多个段落和文本节点的 ProseMirror JSON
        let content = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"第一段\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"第二段\"}]}]}";

        let format = detect_format("chapter.txt", content);
        assert_eq!(format, ContentFormat::PmdJson);

        let plain_text = extract_plain_text(content, format);
        assert!(plain_text.contains("第一段"), "应包含第一段文本");
        assert!(plain_text.contains("第二段"), "应包含第二段文本");
        // 纯文本不应包含任何 JSON 结构字符
        assert!(!plain_text.contains("\"type\""), "不应包含 JSON 字段名");
    }
}
