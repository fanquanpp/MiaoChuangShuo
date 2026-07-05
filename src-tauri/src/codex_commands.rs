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
///   3. .txt/.html 文件读取内容并查找实体名称
///   4. 记录出现次数和上下文预览
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
            // 仅处理 .txt 和 .html 文件
            let is_text = path
                .extension()
                .map(|e| e == "txt" || e == "html")
                .unwrap_or(false);
            if !is_text {
                continue;
            }

            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let mut total_count: u32 = 0;
            let mut first_preview = String::new();

            for name in names {
                if name.is_empty() {
                    continue;
                }
                // 查找名称在文件中的位置
                if let Some(pos) = content.find(name) {
                    // 统计该名称在文件中的总出现次数
                    total_count += content.matches(name).count() as u32;

                    // 提取首次出现的上下文预览（前 20 字符 + 名称 + 后 40 字符）
                    if first_preview.is_empty() {
                        let start = pos.saturating_sub(20);
                        let end = (pos + name.len() + 40).min(content.len());
                        let raw_preview = &content[start..end];
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
    pub entity_type: String,
    /// 创建时间（ISO 8601 格式）
    pub created: String,
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

    // 生成默认元数据
    let meta = CodexMeta {
        id: Uuid::new_v4().to_string(),
        name: fallback_name.to_string(),
        aliases,
        entity_type: fallback_type.to_string(),
        created: chrono::Utc::now().to_rfc3339(),
    };

    (meta, body)
}

/// 扫描设定目录，返回所有结构化设定实体
///
/// 输入: project_path 项目根目录绝对路径
/// 输出: Result<Vec<CodexEntity>, String> 实体列表（按类型分组后按名称排序）
/// 流程:
///   1. 遍历 CODEX_DIRS 中定义的标准目录与兼容目录
///   2. 对每个存在的目录，扫描其下 .txt 文件
///   3. 解析每个文件的 front matter + 正文
///   4. 返回结构化实体列表
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
            // 仅处理 .txt 文件（设定文件统一为 .txt，正文才用 .pmd/.html）
            let is_txt = path
                .extension()
                .map(|e| e == "txt")
                .unwrap_or(false);
            if !is_txt {
                continue;
            }

            let file_name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            // 过滤模板文件和名册文件
            let lower = file_name.to_lowercase();
            if lower.contains("模板")
                || lower.contains("名册")
                || lower.contains("template")
                || lower.contains("roster")
                || lower.contains("readme")
            {
                continue;
            }

            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let (meta, body) =
                parse_codex_file(&content, &file_name, fallback_type);

            let rel_path = path
                .strip_prefix(&root)
                .unwrap_or(&path)
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
