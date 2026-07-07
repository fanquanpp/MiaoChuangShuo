// 智能设定库（Codex）命令模块
//
// 功能概述：
// 提供 Codex 设定库的后端能力：设定文件结构化解析、实体出现位置追踪。
// 支持 JSON front matter 元数据解析，兼容旧版纯文本设定文件。
//
// 模块职责：
// 1. 解析设定文件的 JSON front matter（id/name/aliases/type/created）
// 2. 兼容旧版"别名: A,B,C"首行格式与无元数据的纯文本文件
// 3. 扫描设定目录（含旧版兼容目录名）返回结构化实体列表
// 4. 扫描正文目录下所有 .txt/.html/.pmd 文件追踪实体出现
// 5. 统计出现次数、提取上下文预览
//
// 设计说明：
// 元数据格式采用 JSON front matter（--- 包裹的 JSON 对象），相比 YAML：
// 1. 零新增依赖（serde_json 已在依赖中）
// 2. 前端原生 JSON.parse 支持
// 3. 避免 YAML 缩进敏感导致的解析崩溃
// 格式示例：
// ---
// {"id":"uuid","name":"角色名","aliases":["别名1"],"type":"character","created":"2026-07-04T12:00:00Z"}
// ---
// 正文内容...

use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::text_extractor;

/// 实体出现位置（单文件维度）
#[derive(Debug, Clone, Serialize)]
pub struct EntityMention {
    /// 文件相对路径（相对于正文目录）
    pub file_path: String,
    /// 文件名（含扩展名）
    pub file_name: String,
    /// 在该文件中的出现总次数
    pub count: u32,
    /// 首次出现的上下文预览（前后各约 20 字符）
    pub preview: String,
}

/// 扫描实体在正文中的出现
/// 输入:
///   project_path - 项目根目录绝对路径
///   entity_name - 实体名称（主名称）
///   aliases - 别名列表（可空）
/// 输出: Result<Vec<EntityMention>, String> 出现位置列表（按出现次数降序）
/// 流程:
///   1. 拼接正文目录路径
///   2. 递归遍历所有 .txt/.html 文件
///   3. 对每个文件查找实体名称及别名的出现
///   4. 统计次数并提取首次出现的上下文预览
///   5. 按出现次数降序排序返回
#[tauri::command]
pub fn scan_entity_mentions(
    project_path: String,
    entity_name: String,
    aliases: Option<Vec<String>>,
) -> Result<Vec<EntityMention>, String> {
    let root = PathBuf::from(&project_path);
    let manuscript_dir = root.join("正文");
    if !manuscript_dir.exists() {
        return Ok(vec![]);
    }

    // 合并主名称与别名为搜索关键词列表
    let mut names = vec![entity_name];
    if let Some(alias_list) = aliases {
        names.extend(alias_list);
    }
    // 过滤空字符串
    names.retain(|s| !s.is_empty());

    if names.is_empty() {
        return Ok(vec![]);
    }

    let mut mentions = Vec::new();
    scan_dir_for_mentions(&manuscript_dir, &names, &root, &mut mentions)?;

    // 按出现次数降序排序
    mentions.sort_by_key(|b| std::cmp::Reverse(b.count));
    Ok(mentions)
}

/// 递归扫描目录下文件中的实体出现
/// 输入:
///   dir - 当前扫描目录
///   names - 实体名称及别名列表
///   project_root - 项目根目录（用于计算相对路径，含"正文/"前缀）
///   mentions - 出现位置结果列表（可变引用，累加结果）
/// 输出: Result<(), String> 扫描成功或错误
/// 流程:
///   1. 遍历目录条目
///   2. 子目录递归扫描
///   3. 支持文档(.txt/.pmd/.html/.htm)读取内容并提取纯文本后查找实体名称
///   4. 记录出现次数和上下文预览（预览为纯文本，无 HTML 标签污染）
fn scan_dir_for_mentions(
    dir: &Path,
    names: &[String],
    project_root: &Path,
    mentions: &mut Vec<EntityMention>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // 递归扫描子目录
            scan_dir_for_mentions(&path, names, project_root, mentions)?;
        } else {
            // 支持文档格式：.txt/.pmd/.html/.htm
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let is_supported = matches!(ext.to_lowercase().as_str(), "txt" | "pmd" | "html" | "htm");
            if !is_supported {
                continue;
            }

            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            // 接入 text_extractor 统一层：提取纯文本，避免 HTML 标签/JSON 结构污染匹配
            let file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let format = text_extractor::detect_format(&file_name, &content);
            let plain = text_extractor::extract_plain_text(&content, format);

            let mut total_count: u32 = 0;
            let mut first_preview = String::new();

            for name in names {
                if name.is_empty() {
                    continue;
                }
                // 在纯文本中查找名称位置（避免匹配到 HTML 标签内部）
                if let Some(pos) = plain.find(name) {
                    // 统计该名称在纯文本中的总出现次数
                    total_count += plain.matches(name).count() as u32;

                    // 提取首次出现的上下文预览（前 20 字符 + 名称 + 后 40 字符，纯文本无标签污染）
                    if first_preview.is_empty() {
                        let start = pos.saturating_sub(20);
                        let end = (pos + name.len() + 40).min(plain.len());
                        let raw_preview = &plain[start..end];
                        // 去除换行符，保留可读预览
                        first_preview = format!("...{}...", raw_preview.replace('\n', " ").replace('\r', ""));
                    }
                }
            }

            if total_count > 0 {
                // 计算相对于项目根的路径（含"正文/"前缀），便于前端直接用于文件跳转
                let rel_path = path
                    .strip_prefix(project_root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();
                let file_name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();

                mentions.push(EntityMention {
                    file_path: rel_path,
                    file_name,
                    count: total_count,
                    preview: first_preview,
                });
            }
        }
    }

    Ok(())
}

/// 批量扫描多个实体在正文中的出现
/// 输入:
///   project_path - 项目根目录
///   entities - 实体列表，每项包含 name 和 aliases
/// 输出: Result<Vec<(String, u32, Vec<EntityMention>)>, String>
///   每个实体对应 (实体名, 总出现次数, 出现位置列表)
/// 流程: 对每个实体调用 scan_entity_mentions 并汇总
#[tauri::command]
pub fn batch_scan_entities(
    project_path: String,
    entities: Vec<(String, Vec<String>)>,
) -> Result<Vec<(String, u32, Vec<EntityMention>)>, String> {
    let root = PathBuf::from(&project_path);
    let manuscript_dir = root.join("正文");
    if !manuscript_dir.exists() {
        return Ok(vec![]);
    }

    let mut results = Vec::new();
    for (name, aliases) in entities {
        let mentions = scan_entity_mentions(
            project_path.clone(),
            name.clone(),
            Some(aliases),
        )?;
        let total: u32 = mentions.iter().map(|m| m.count).sum();
        results.push((name, total, mentions));
    }

    // 按总出现次数降序排序
    results.sort_by_key(|b| std::cmp::Reverse(b.1));
    Ok(results)
}

// ===== 设定文件结构化解析（JSON front matter） =====

/// 设定文件元数据（JSON front matter 解析结果）
///
/// 存储于设定文件首部，以 --- 包裹的 JSON 对象形式存在。
/// 旧版文件无 front matter 时，由解析器自动生成默认值并补全。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexMeta {
    /// 实体唯一标识（UUID v4，旧文件迁移时自动生成）
    pub id: String,
    /// 实体显示名（默认取文件名去扩展）
    pub name: String,
    /// 别名列表（可为空）
    #[serde(default)]
    pub aliases: Vec<String>,
    /// 实体类型：character / worldview / glossary / material
    /// 注：对应方案中的 card_type，保留 entity_type 以向后兼容旧 front matter
    pub entity_type: String,
    /// 创建时间（ISO 8601 格式）
    pub created: String,
    /// 一句话简介（用于 Hover 预览和 AI 快速读取）
    #[serde(default)]
    pub summary: String,
    /// 标签数组（如 ["主角","骑士"]）
    #[serde(default)]
    pub tags: Vec<String>,
    /// 头像/图标 URL（可选）
    #[serde(default)]
    pub avatar: Option<String>,
    /// 排序权重（数字越小越靠前，默认 0）
    #[serde(default)]
    pub sort_order: i32,
    /// 更新时间（ISO 8601 格式，首次创建时与 created 相同）
    #[serde(default)]
    pub updated_at: String,
}

/// 设定实体（前端展示用结构化数据）
///
/// 包含元数据 + 来源文件路径 + 出现追踪（懒加载）
#[derive(Debug, Clone, Serialize)]
pub struct CodexEntity {
    /// 元数据
    pub meta: CodexMeta,
    /// 来源文件相对路径（相对于项目根）
    pub source_file: String,
    /// 正文内容（纯文本，已剥离 front matter）
    pub content: String,
}

/// 设定目录名映射（标准目录 + 旧版兼容目录）
///
/// 标准目录为"设定"，兼容旧版的 角色/人物/世界观/术语/名词/素材/资料。
/// 迁移专项完成后旧目录名将不再出现。
const CODEX_DIRS: &[(&str, &str)] = &[
    ("设定", "unknown"),       // 标准目录，类型由 front matter 决定
    ("角色", "character"),     // 旧版兼容
    ("人物", "character"),     // 旧版兼容
    ("世界观", "worldview"),   // 旧版兼容
    ("术语", "glossary"),      // 旧版兼容
    ("名词", "glossary"),      // 旧版兼容
    ("素材", "material"),      // 旧版兼容
    ("资料", "material"),      // 旧版兼容
];

/// 解析设定文件内容，提取 JSON front matter 元数据与正文
///
/// 输入: content 文件完整内容, fallback_name 元数据缺失时的回退名称, fallback_type 回退类型
/// 输出: (CodexMeta 元数据, String 正文内容)
/// 流程:
///   1. 检测首行是否为 "---"（front matter 起始标记）
///   2. 若是，查找下一个 "---" 结束标记，解析中间的 JSON
///   3. 若否，回退解析旧版"别名: A,B,C"首行格式
///   4. 无任何元数据时生成默认值（UUID + 文件名 + 推断类型 + 当前时间）
pub fn parse_codex_file(
    content: &str,
    fallback_name: &str,
    fallback_type: &str,
) -> (CodexMeta, String) {
    let lines: Vec<&str> = content.lines().collect();

    // 情况1：JSON front matter 格式（--- 包裹的 JSON 对象）
    if lines.len() >= 3 && lines[0].trim() == "---" {
        // 查找结束标记 ---
        let end_idx = lines[1..]
            .iter()
            .position(|l| l.trim() == "---")
            .map(|i| i + 1);

        if let Some(end) = end_idx {
            let json_str = lines[1..end].join("\n");
            if let Ok(meta) = serde_json::from_str::<CodexMeta>(&json_str) {
                let body = lines[end + 1..].join("\n");
                return (meta, body.trim_start().to_string());
            }
            // JSON 解析失败，降级到旧版格式解析
        }
    }

    // 情况2：旧版"别名: A,B,C"首行格式
    let mut aliases: Vec<String> = Vec::new();
    let mut body_start = 0;
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed
            .strip_prefix("别名")
            .map(|s| s.trim_start())
            .and_then(|s| {
                if s.starts_with(':') || s.starts_with('：') {
                    Some(s[1..].trim())
                } else {
                    None
                }
            })
        {
            aliases = rest
                .split([',', '，', '、'])
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            body_start = i + 1;
            break;
        }
        // 首行非别名行，停止扫描
        if i > 0 {
            break;
        }
    }

    let body = if body_start > 0 {
        lines[body_start..].join("\n").trim_start().to_string()
    } else {
        content.to_string()
    };

    // 生成默认元数据（新字段使用默认值，向后兼容旧文件）
    let now = chrono::Utc::now().to_rfc3339();
    let meta = CodexMeta {
        id: Uuid::new_v4().to_string(),
        name: fallback_name.to_string(),
        aliases,
        entity_type: fallback_type.to_string(),
        created: now.clone(),
        summary: String::new(),
        tags: Vec::new(),
        avatar: None,
        sort_order: 0,
        updated_at: now,
    };

    (meta, body)
}

// ===== 设定文件 .pmd 迁移辅助函数 =====

/// 将纯文本正文转换为 ProseMirror JSON 文档字符串
/// 输入: text 纯文本内容
/// 输出: String ProseMirror JSON 字符串（每行一个 paragraph）
/// 流程:
///   1. 按换行符分割文本（兼容 Windows CRLF 与 Unix LF）
///   2. 非空行转为含 text 节点的 paragraph
///   3. 空行转为空 paragraph
///   4. 包装为 doc 根节点并序列化为 JSON 字符串
fn convert_codex_text_to_pmd(text: &str) -> String {
    let mut content = Vec::new();
    for line in text.split('\n').map(|l| l.trim_end_matches('\r')) {
        if line.is_empty() {
            content.push(serde_json::json!({"type": "paragraph"}));
        } else {
            content.push(serde_json::json!({
                "type": "paragraph",
                "content": [{"type": "text", "text": line}]
            }));
        }
    }
    // 空文档至少保留一个空段落，避免 ProseMirror 解析失败
    if content.is_empty() {
        content.push(serde_json::json!({"type": "paragraph"}));
    }
    let doc = serde_json::json!({"type": "doc", "content": content});
    serde_json::to_string(&doc).unwrap_or_else(|_| "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}".to_string())
}

/// 原子写入文件（临时文件 + 重命名，保证写入原子性）
/// 输入: path 目标文件路径, content 文件内容
/// 输出: Result<(), String> 写入结果
/// 流程:
///   1. 写入 .tmp 临时文件（同目录，保证同一文件系统以支持原子重命名）
///   2. 重命名为目标文件
///   3. 失败时清理临时文件
fn atomic_write_codex(path: &Path, content: &str) -> Result<(), String> {
    let tmp_path = PathBuf::from(format!("{}.tmp", path.to_string_lossy()));
    fs::write(&tmp_path, content).map_err(|e| format!("写入临时文件失败: {}", e))?;
    match fs::rename(&tmp_path, path) {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp_path);
            Err(format!("重命名文件失败: {}", e))
        }
    }
}

/// 将旧版 .txt 设定文件迁移为 .pmd 格式
/// 输入:
///   txt_path - 旧版 .txt 文件路径
///   fallback_type - 回退实体类型（用于无 front matter 的旧文件）
/// 输出: Result<PathBuf, String> 迁移后的 .pmd 文件路径
/// 流程:
///   1. 读取 .txt 文件内容
///   2. 解析 front matter + 纯文本正文
///   3. 将正文转换为 ProseMirror JSON
///   4. 构造 .pmd 文件内容（front matter + ProseMirror JSON）
///   5. 原子写入 .pmd 文件
///   6. 删除旧 .txt 文件（迁移成功后）
/// 设计说明:
///   - .pmd 格式 = front matter（JSON 元数据）+ ProseMirror JSON（富文本正文）
///   - 迁移是一次性的、透明的，用户无感
///   - 原子写入保证迁移过程中断不会损坏文件
fn migrate_codex_txt_to_pmd(txt_path: &Path, fallback_type: &str) -> Result<PathBuf, String> {
    let content = fs::read_to_string(txt_path)
        .map_err(|e| format!("读取设定文件失败: {}", e))?;

    let file_name = txt_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    let (meta, body) = parse_codex_file(&content, &file_name, fallback_type);

    // 将纯文本正文转换为 ProseMirror JSON
    let pmd_content = convert_codex_text_to_pmd(&body);

    // 构造 .pmd 文件内容：front matter + ProseMirror JSON
    let meta_json = serde_json::to_string(&meta)
        .map_err(|e| format!("序列化设定元数据失败: {}", e))?;
    let pmd_file_content = format!("---\n{}\n---\n{}", meta_json, pmd_content);

    // 原子写入 .pmd 文件（与原 .txt 同目录）
    let pmd_path = txt_path.with_extension("pmd");
    atomic_write_codex(&pmd_path, &pmd_file_content)?;

    // 迁移成功后删除旧 .txt 文件
    // 失败不阻断流程（.pmd 已写入），仅记录警告
    if let Err(e) = fs::remove_file(txt_path) {
        eprintln!("[codex] 警告: 删除旧 .txt 文件失败: {}", e);
    }

    Ok(pmd_path)
}

/// 扫描设定目录，返回所有结构化设定实体（支持 .pmd 与 .txt 自动迁移）
///
/// 输入: project_path 项目根目录绝对路径
/// 输出: Result<Vec<CodexEntity>, String> 实体列表（按类型分组后按名称排序）
/// 流程:
///   1. 遍历 CODEX_DIRS 中定义的标准目录与兼容目录
///   2. 对每个存在的目录，扫描其下 .pmd 与 .txt 文件
///   3. .txt 文件自动迁移为 .pmd（一次性、透明、用户无感）
///   4. 解析每个 .pmd 文件的 front matter + ProseMirror JSON 正文
///   5. 返回结构化实体列表
#[tauri::command]
pub fn list_codex_entities(project_path: String) -> Result<Vec<CodexEntity>, String> {
    let root = PathBuf::from(&project_path);
    let mut entities = Vec::new();

    for (dir_name, fallback_type) in CODEX_DIRS {
        let dir = root.join(dir_name);
        if !dir.exists() {
            continue;
        }

        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                continue;
            }

            // 获取文件扩展名，决定处理方式
            let extension = path
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();

            // 根据扩展名决定处理路径：.txt 迁移为 .pmd，.pmd 直接处理，其他跳过
            let pmd_path = if extension == "txt" {
                // 旧版 .txt 文件：先过滤模板/名册文件，再迁移为 .pmd
                let file_name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                let lower = file_name.to_lowercase();
                if lower.contains("模板")
                    || lower.contains("名册")
                    || lower.contains("template")
                    || lower.contains("roster")
                    || lower.contains("readme")
                {
                    continue;
                }

                // 迁移 .txt 为 .pmd（失败时跳过该文件，不阻断整体扫描）
                match migrate_codex_txt_to_pmd(&path, fallback_type) {
                    Ok(p) => p,
                    Err(e) => {
                        eprintln!("[codex] 警告: 迁移设定文件失败 {}: {}", path.display(), e);
                        continue;
                    }
                }
            } else if extension == "pmd" {
                // 新版 .pmd 文件：直接处理
                path.clone()
            } else {
                // 其他扩展名跳过
                continue;
            };

            // 读取 .pmd 文件内容
            let content = match fs::read_to_string(&pmd_path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let file_name = pmd_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            // 过滤模板文件和名册文件（.pmd 也需检查）
            let lower = file_name.to_lowercase();
            if lower.contains("模板")
                || lower.contains("名册")
                || lower.contains("template")
                || lower.contains("roster")
                || lower.contains("readme")
            {
                continue;
            }

            let (meta, body) = parse_codex_file(&content, &file_name, fallback_type);

            let rel_path = pmd_path
                .strip_prefix(&root)
                .unwrap_or(&pmd_path)
                .to_string_lossy()
                .replace('\\', "/");

            entities.push(CodexEntity {
                meta,
                source_file: rel_path,
                content: body,
            });
        }
    }

    // 按类型分组，组内按名称排序
    entities.sort_by(|a, b| {
        let type_order = ["character", "worldview", "glossary", "material", "unknown"];
        let ta = type_order
            .iter()
            .position(|&t| t == a.meta.entity_type.as_str())
            .unwrap_or(usize::MAX);
        let tb = type_order
            .iter()
            .position(|&t| t == b.meta.entity_type.as_str())
            .unwrap_or(usize::MAX);
        if ta != tb {
            return ta.cmp(&tb);
        }
        a.meta.name.cmp(&b.meta.name)
    });

    Ok(entities)
}

/// 为旧版设定文件注入 JSON front matter（迁移命令）
///
/// 输入: project_path 项目根目录
/// 输出: Result<u32, String> 迁移的文件数量
/// 流程:
///   1. 扫描所有兼容目录下的 .txt 文件
///   2. 对无 front matter 的文件，解析旧格式并注入 front matter
///   3. 原子写入（先写 .tmp 再 rename）
#[tauri::command]
pub fn inject_codex_front_matter(project_path: String) -> Result<u32, String> {
    let root = PathBuf::from(&project_path);
    let mut count = 0u32;

    for (dir_name, fallback_type) in CODEX_DIRS {
        let dir = root.join(dir_name);
        if !dir.exists() {
            continue;
        }

        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                continue;
            }
            let is_txt = path
                .extension()
                .map(|e| e == "txt")
                .unwrap_or(false);
            if !is_txt {
                continue;
            }

            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            // 跳过已有 front matter 的文件
            if content.lines().next().map(|l| l.trim() == "---").unwrap_or(false) {
                continue;
            }

            let file_name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let (meta, body) =
                parse_codex_file(&content, &file_name, fallback_type);

            // 构造 front matter
            let meta_json = serde_json::to_string(&meta)
                .map_err(|e| format!("序列化元数据失败: {}", e))?;
            let new_content = format!("---\n{}\n---\n{}", meta_json, body);

            // 原子写入
            let tmp_path = path.with_extension("tmp");
            fs::write(&tmp_path, &new_content)
                .map_err(|e| format!("写入临时文件失败: {}", e))?;
            fs::rename(&tmp_path, &path).map_err(|e| {
                let _ = fs::remove_file(&tmp_path);
                format!("重命名临时文件失败: {}", e)
            })?;

            count += 1;
        }
    }

    Ok(count)
}

// ===== Sprint 2 任务 2.1：单卡片更新命令 =====

/// 待合并的元数据补丁（与 CodexMeta 字段对应，所有字段可选）
///
/// 前端传入 JSON 对象，仅包含需要更新的字段。
/// 未传入的字段保持原值不变，实现部分更新语义。
#[derive(Debug, Clone, Deserialize)]
pub struct CodexMetaPatch {
    pub name: Option<String>,
    pub aliases: Option<Vec<String>>,
    pub entity_type: Option<String>,
    pub summary: Option<String>,
    pub tags: Option<Vec<String>>,
    pub avatar: Option<Option<String>>,
    pub sort_order: Option<i32>,
}

/// 更新单个设定卡片的元数据与正文（.pmd 文件）
///
/// 输入:
///   project_path - 项目根目录绝对路径
///   source_file - 卡片来源文件相对路径（如 "角色/亚瑟.pmd"）
///   meta_patch - 元数据补丁（JSON 字符串，仅含待更新字段）
///   content - 正文内容（ProseMirror JSON 字符串，空字符串表示不更新正文）
/// 输出: Result<CodexMeta, String> 更新后的完整元数据
/// 流程:
///   1. 拼接目标文件绝对路径并校验存在性
///   2. 读取并解析 .pmd 文件，得到原 meta 与 body
///   3. 反序列化 meta_patch 为 CodexMetaPatch
///   4. 将 patch 字段合并到原 meta，更新 updated_at 时间戳
///   5. 若 content 非空，替换正文；否则保留原 body
///   6. 若 name 发生变更，同步重命名文件（atomic rename）
///   7. 原子写入新内容到目标文件
/// 设计说明:
///   - name 变更时文件重命名由后端统一处理，前端无需关心文件路径变化
///   - 重命名后返回的 meta 包含新 name，前端据以更新 Store 中的 sourceFile
///   - 原子写入保证更新过程中断不会损坏文件
#[tauri::command]
pub fn update_codex_entity(
    project_path: String,
    source_file: String,
    meta_patch: String,
    content: String,
) -> Result<CodexMeta, String> {
    let root = PathBuf::from(&project_path);
    // 安全校验：source_file 必须为相对路径，禁止路径穿越
    if source_file.contains("..") || source_file.starts_with('/') || source_file.contains(':') {
        return Err("非法的来源文件路径".to_string());
    }
    let file_path = root.join(&source_file);
    if !file_path.exists() {
        return Err(format!("设定文件不存在: {}", source_file));
    }

    // 读取并解析现有 .pmd 文件
    let raw = fs::read_to_string(&file_path)
        .map_err(|e| format!("读取设定文件失败: {}", e))?;
    let file_name = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let (mut meta, original_body) = parse_codex_file(&raw, &file_name, "unknown");

    // 反序列化并合并 meta_patch
    let patch: CodexMetaPatch = if meta_patch.is_empty() {
        // 空补丁：仅更新正文（若提供）
        CodexMetaPatch {
            name: None,
            aliases: None,
            entity_type: None,
            summary: None,
            tags: None,
            avatar: None,
            sort_order: None,
        }
    } else {
        serde_json::from_str(&meta_patch)
            .map_err(|e| format!("解析元数据补丁失败: {}", e))?
    };

    // 逐字段合并（Option<T>：Some 表示更新，None 表示保留原值）
    if let Some(name) = patch.name {
        meta.name = name;
    }
    if let Some(aliases) = patch.aliases {
        meta.aliases = aliases;
    }
    if let Some(entity_type) = patch.entity_type {
        meta.entity_type = entity_type;
    }
    if let Some(summary) = patch.summary {
        meta.summary = summary;
    }
    if let Some(tags) = patch.tags {
        meta.tags = tags;
    }
    // avatar 使用 Option<Option<String>>：外层 Some 表示需要更新，内层 None 表示清空
    if let Some(avatar) = patch.avatar {
        meta.avatar = avatar;
    }
    if let Some(sort_order) = patch.sort_order {
        meta.sort_order = sort_order;
    }
    // 更新时间戳
    meta.updated_at = chrono::Utc::now().to_rfc3339();

    // 确定正文内容：content 非空则替换，空则保留原 body
    let final_body = if content.is_empty() { original_body } else { content };

    // 序列化并原子写入
    let meta_json = serde_json::to_string(&meta)
        .map_err(|e| format!("序列化元数据失败: {}", e))?;
    let new_file_content = format!("---\n{}\n---\n{}", meta_json, final_body);

    // 若 name 变更，需要重命名文件（同步文件名与显示名）
    let final_path = if meta.name != file_name {
        let parent = file_path.parent().ok_or("无法获取父目录")?;
        let new_name = format!("{}.pmd", meta.name);
        let new_path = parent.join(&new_name);
        // 若目标文件已存在（同目录下有重名卡片），拒绝覆盖
        if new_path.exists() && new_path != file_path {
            return Err(format!("目标文件已存在: {}", new_name));
        }
        new_path
    } else {
        file_path.clone()
    };

    // 原子写入到最终路径
    atomic_write_codex(&final_path, &new_file_content)?;

    // 若文件重命名了，删除旧文件
    if final_path != file_path {
        if let Err(e) = fs::remove_file(&file_path) {
            eprintln!("[codex] 警告: 删除旧文件失败 {}: {}", file_path.display(), e);
        }
    }

    Ok(meta)
}

// ===== Sprint 2 任务 2.5：删除失效检测 =====

/// 失效提及位置（单文件维度）
/// 用于删除卡片前检测正文中引用该卡片的 characterMentionNode 数量
#[derive(Debug, Clone, Serialize)]
pub struct InvalidMention {
    /// 文件相对路径（相对于项目根，含"正文/"前缀）
    pub file_path: String,
    /// 文件名（含扩展名）
    pub file_name: String,
    /// 该文件中引用该卡片的 characterMentionNode 数量
    pub count: u32,
}

/// 扫描正文中引用指定卡片的 characterMentionNode 数量
/// 输入:
///   project_path - 项目根目录绝对路径
///   card_id - 待检测的卡片 UUID（characterMentionNode.attrs.characterId）
/// 输出: Result<Vec<InvalidMention>, String> 引用该卡片的文件列表（按数量降序）
/// 流程:
///   1. 遍历正文目录下所有 .pmd 文件
///   2. 剥离 front matter 后解析 ProseMirror JSON
///   3. 递归查找 type == "characterMentionNode" 且 attrs.characterId == card_id 的节点
///   4. 按文件汇总数量返回
/// 设计说明:
///   - 仅扫描 .pmd 文件（characterMentionNode 仅存在于 ProseMirror JSON 格式中）
///   - .txt/.html 旧文件不含 characterMentionNode，跳过
///   - 删除卡片前调用，返回值用于前端弹出失效提示
#[tauri::command]
pub fn scan_invalid_mentions(
    project_path: String,
    card_id: String,
) -> Result<Vec<InvalidMention>, String> {
    let root = PathBuf::from(&project_path);
    let manuscript_dir = root.join("正文");
    if !manuscript_dir.exists() {
        return Ok(vec![]);
    }

    let mut results = Vec::new();
    scan_dir_for_invalid_mentions(&manuscript_dir, &card_id, &root, &mut results)?;

    // 按数量降序排序
    results.sort_by_key(|b| std::cmp::Reverse(b.count));
    Ok(results)
}

/// 递归扫描目录下 .pmd 文件中的失效提及
/// 输入:
///   dir - 当前扫描目录
///   card_id - 待检测的卡片 UUID
///   project_root - 项目根目录（用于计算相对路径）
///   results - 结果列表（可变引用，累加结果）
/// 输出: Result<(), String> 扫描成功或错误
fn scan_dir_for_invalid_mentions(
    dir: &Path,
    card_id: &str,
    project_root: &Path,
    results: &mut Vec<InvalidMention>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // 递归扫描子目录
            scan_dir_for_invalid_mentions(&path, card_id, project_root, results)?;
        } else {
            // 仅处理 .pmd 文件（characterMentionNode 仅存在于 ProseMirror JSON 格式中）
            let is_pmd = path
                .extension()
                .map(|e| e == "pmd")
                .unwrap_or(false);
            if !is_pmd {
                continue;
            }

            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            // 剥离 .pmd front matter 后解析 ProseMirror JSON
            let json_str = strip_pmd_front_matter(&content);
            let doc = match serde_json::from_str::<serde_json::Value>(&json_str) {
                Ok(v) => v,
                Err(_) => continue,
            };

            // 递归查找 characterMentionNode 节点并统计匹配数量
            let count = count_character_mentions(&doc, card_id);
            if count > 0 {
                let rel_path = path
                    .strip_prefix(project_root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();
                let file_name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                results.push(InvalidMention {
                    file_path: rel_path,
                    file_name,
                    count,
                });
            }
        }
    }

    Ok(())
}

/// 剥离 .pmd 文件的 JSON front matter，返回 ProseMirror JSON 字符串
/// 输入: content .pmd 文件完整内容
/// 输出: String ProseMirror JSON 字符串（已剥离 front matter）
/// 流程:
///   1. 检测首行是否为 "---"（front matter 起始标记）
///   2. 若是，查找下一个 "---" 结束标记，返回其后内容
///   3. 若否，返回原内容（可能是纯 ProseMirror JSON 或旧格式）
fn strip_pmd_front_matter(content: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() >= 3 && lines[0].trim() == "---" {
        // 查找结束标记 ---
        if let Some(end) = lines[1..]
            .iter()
            .position(|l| l.trim() == "---")
            .map(|i| i + 1)
        {
            return lines[end + 1..].join("\n").trim_start().to_string();
        }
    }
    content.to_string()
}

/// 递归统计 ProseMirror JSON 文档中引用指定 characterId 的 characterMentionNode 数量
/// 输入:
///   node - ProseMirror JSON 节点（serde_json::Value）
///   card_id - 待匹配的卡片 UUID
/// 输出: u32 匹配的节点数量
/// 流程:
///   1. 检查当前节点 type 是否为 "characterMentionNode"
///   2. 若是，检查 attrs.characterId 是否等于 card_id，匹配则计数 +1
///   3. 递归检查 content 数组中的子节点
fn count_character_mentions(node: &serde_json::Value, card_id: &str) -> u32 {
    let mut count = 0;

    // 检查当前节点是否为 characterMentionNode
    if let Some(node_type) = node.get("type").and_then(|v| v.as_str()) {
        if node_type == "characterMentionNode" {
            // 检查 attrs.characterId 是否匹配
            if let Some(attrs) = node.get("attrs") {
                if let Some(id) = attrs.get("characterId").and_then(|v| v.as_str()) {
                    if id == card_id {
                        count += 1;
                    }
                }
            }
        }
    }

    // 递归检查子节点（content 数组）
    if let Some(content) = node.get("content").and_then(|v| v.as_array()) {
        for child in content {
            count += count_character_mentions(child, card_id);
        }
    }

    count
}

