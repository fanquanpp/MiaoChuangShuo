// 智能设定库（Codex）- 文件解析子模块
//
// 功能概述：
// 提供设定文件的 JSON front matter 解析能力，兼容旧版纯文本格式。
// 定义设定实体的元数据结构与目录名映射常量。
//
// 模块职责：
// 1. 定义设定实体的元数据结构（CodexMeta / CodexEntity / CodexMetaPatch）
// 2. 解析设定文件的 JSON front matter（id/name/aliases/type/created）
// 3. 兼容旧版"别名: A,B,C"首行格式与无元数据的纯文本文件
// 4. 剥离 .pmd 文件的 front matter，返回 ProseMirror JSON 字符串
// 5. 定义设定目录名映射常量（CODEX_DIRS）
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

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 设定文件元数据（JSON front matter 解析结果）
///
/// 存储于设定文件首部，以 --- 包裹的 JSON 对象形式存在。
/// 旧版文件无 front matter 时，由解析器自动生成默认值并补全。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
/// 包含元数据 + 来源文件路径 + 正文内容（纯文本，已剥离 front matter）
#[derive(Debug, Clone, Serialize)]
pub struct CodexEntity {
    /// 元数据
    pub meta: CodexMeta,
    /// 来源文件相对路径（相对于项目根）
    pub source_file: String,
    /// 正文内容（纯文本，已剥离 front matter）
    pub content: String,
}

/// 待合并的元数据补丁（与 CodexMeta 字段对应，所有字段可选）
///
/// 前端传入 JSON 对象，仅包含需要更新的字段。
/// 未传入的字段保持原值不变，实现部分更新语义。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexMetaPatch {
    pub name: Option<String>,
    pub aliases: Option<Vec<String>>,
    pub entity_type: Option<String>,
    pub summary: Option<String>,
    pub tags: Option<Vec<String>>,
    pub avatar: Option<Option<String>>,
    pub sort_order: Option<i32>,
}

/// 设定目录名映射（标准目录 + 旧版兼容目录）
///
/// 标准目录为"设定"，兼容旧版的 角色/人物/世界观/术语/名词/素材/资料。
/// 迁移专项完成后旧目录名将不再出现。
///
/// Task 1.8: 此常量作为 codex_dirs 配置的回退默认值
/// - 新建项目: ProjectMeta.codex_dirs 由 default_codex_dirs() 填充本表所有目录
/// - 旧项目: ProjectMeta.codex_dirs 为空,扫描时回退到本表
/// - 自定义项目: 用户可指定任意目录,未知目录的 fallback_type 为 "unknown"
pub(super) const CODEX_DIRS: &[(&str, &str)] = &[
    ("设定", "unknown"),       // 标准目录，类型由 front matter 决定
    ("角色", "character"),     // 旧版兼容
    ("人物", "character"),     // 旧版兼容
    ("世界观", "worldview"),   // 旧版兼容
    ("术语", "glossary"),      // 旧版兼容
    ("名词", "glossary"),      // 旧版兼容
    ("素材", "material"),      // 旧版兼容
    ("资料", "material"),      // 旧版兼容
];

/// 查询设定目录对应的 fallback_type(Task 1.8)
///
/// 输入: dir_name 目录名
/// 输出: &'static str fallback 类型字符串(unknown/character/worldview/glossary/material)
/// 流程: 在 CODEX_DIRS 中查找同名目录,未找到时返回 "unknown"
/// 设计说明: 自定义 codex_dirs 中的新目录(如 "Characters")未在 CODEX_DIRS 中,
///           统一回退为 "unknown",由 front matter 决定具体类型
pub fn codex_dir_fallback_type(dir_name: &str) -> &'static str {
    CODEX_DIRS
        .iter()
        .find(|(name, _)| *name == dir_name)
        .map(|(_, ty)| *ty)
        .unwrap_or("unknown")
}

/// 构建有效的 codex 扫描目录列表(Task 1.8)
///
/// 输入:
///   codex_dirs_from_meta - ProjectMeta.codex_dirs 字段(可能为空)
/// 输出: Vec<(String, &'static str)> 目录名 + fallback_type 列表
/// 流程:
///   1. codex_dirs_from_meta 非空:对每个目录名查询 fallback_type,构建 Vec
///   2. codex_dirs_from_meta 为空:回退到 CODEX_DIRS 常量(旧项目兼容)
/// 设计说明: 此函数解耦 ProjectMeta 配置与 CODEX_DIRS 常量,供 crud.rs 复用
pub fn build_effective_codex_dirs(
    codex_dirs_from_meta: &[String],
) -> Vec<(String, &'static str)> {
    if codex_dirs_from_meta.is_empty() {
        // 旧项目无 codex_dirs 配置,回退到 CODEX_DIRS 常量
        CODEX_DIRS
            .iter()
            .map(|(name, ty)| (name.to_string(), *ty))
            .collect()
    } else {
        // 新项目或自定义项目:使用 ProjectMeta 配置
        codex_dirs_from_meta
            .iter()
            .map(|name| (name.clone(), codex_dir_fallback_type(name)))
            .collect()
    }
}

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

/// 剥离 .pmd 文件的 JSON front matter，返回 ProseMirror JSON 字符串
/// 输入: content .pmd 文件完整内容
/// 输出: String ProseMirror JSON 字符串（已剥离 front matter）
/// 流程:
///   1. 检测首行是否为 "---"（front matter 起始标记）
///   2. 若是，查找下一个 "---" 结束标记，返回其后内容
///   3. 若否，返回原内容（可能是纯 ProseMirror JSON 或旧格式）
pub(super) fn strip_pmd_front_matter(content: &str) -> String {
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
