// 项目模板与目录结构定义模块
//
// 功能概述：
// 定义 喵创说 支持的小说文体类型及其对应的目录结构与预设文件。
// 采用 3 标准文体（Novel/Script/Essay）+ 统一 5 一级目录结构，
// 题材（玄幻/科幻/言情等）作为次级可选项存储在 ProjectMeta.genre 中。
//
// 模块职责：
// 1. 定义标准文体类型枚举（StandardProjectType）
// 2. 定义统一一级目录结构
// 3. 生成项目元数据（含题材字段）
// 4. 提供模板变量渲染能力

use serde::{Deserialize, Serialize};
use schemars::JsonSchema;

// ===== 模板变量系统 =====
// 模板内支持以下变量占位符，在创建项目时由 render_template 统一替换：
//   {{项目名}}        - 项目名称
//   {{作者名}}        - 作者名
//   {{当前日期}}      - 创建日期（YYYY-MM-DD）
//   {{当前时间}}      - 创建时间（HH:MM）
//   {{当前年份}}      - 创建年份（YYYY）
//   {{当前月份}}      - 创建月份（MM）
//   {{文体类型}}      - 文体中文名
//   {{题材}}          - 题材分类
//   {{项目描述}}      - 项目描述
//   {{章节起始编号}}  - 默认为 1
// 作者开箱即用，无需手动替换

/// 模板变量集合
pub struct TemplateVars {
    pub project_name: String,
    pub author: String,
    pub date: String,
    pub time: String,
    pub year: String,
    pub month: String,
    pub project_type_label: String,
    pub genre: String,
    pub description: String,
}

/**
 * 渲染模板：将模板字符串中的 {{变量}} 占位符替换为实际值
 * 输入: content 模板字符串, vars 变量集合
 * 输出: 替换后的字符串
 * 流程: 逐个替换预定义的变量占位符
 */
pub fn render_template(content: &str, vars: &TemplateVars) -> String {
    content
        .replace("{{项目名}}", &vars.project_name)
        .replace("{{作者名}}", &vars.author)
        .replace("{{当前日期}}", &vars.date)
        .replace("{{当前时间}}", &vars.time)
        .replace("{{当前年份}}", &vars.year)
        .replace("{{当前月份}}", &vars.month)
        .replace("{{文体类型}}", &vars.project_type_label)
        .replace("{{题材}}", &vars.genre)
        .replace("{{项目描述}}", &vars.description)
}

/// 项目元数据结构
/// 存储在项目根目录的 .novelforge/project.json 中
/// Task 1.7.2: 派生 JsonSchema 用于自动生成前端 TS 类型与 CI 一致性校验
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    /// 项目名称
    pub name: String,
    /// 项目文体类型
    /// 注：通过 alias = "type" 兼容旧 meta.json 中的 "type" 字段名
    #[serde(alias = "type")]
    pub project_type: String,
    /// 题材（可选，如玄幻/科幻/言情等）
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub genre: String,
    /// 创建时间(ISO 8601)
    /// 注：通过 alias 兼容旧 meta.json 中的 snake_case 字段名
    #[serde(alias = "created_at")]
    pub created_at: String,
    /// 最后修改时间(ISO 8601)
    /// 注：通过 alias 兼容旧 meta.json 中的 snake_case 字段名
    #[serde(alias = "updated_at")]
    pub updated_at: String,
    /// 项目版本
    pub version: String,
    /// 作者
    pub author: String,
    /// 项目描述
    pub description: String,
    /// 总字数
    /// 注：通过 alias 兼容旧 meta.json 中的 snake_case 字段名
    #[serde(alias = "word_count")]
    pub word_count: u64,
    /// 设定库扫描目录列表(Task 1.8)
    /// 标准目录为 ["设定"],兼容旧版可附加 ["角色","人物","世界观","术语","名词","素材","资料"]
    /// 后端 codex 扫描时读取此字段决定扫描范围,空时回退到 CODEX_DIRS 默认值
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub codex_dirs: Vec<String>,
    /// 大纲目录名(Task 1.8)
    /// 默认 "大纲",旧项目反序列化时此字段缺失则取默认值
    #[serde(default = "default_outline_dir", skip_serializing_if = "is_default_outline_dir")]
    pub outline_dir: String,
    /// 正文目录名(Task 1.8)
    /// 默认 "正文",旧项目反序列化时此字段缺失则取默认值
    #[serde(default = "default_manuscript_dir", skip_serializing_if = "is_default_manuscript_dir")]
    pub manuscript_dir: String,
    /// 草稿箱目录名(Task 1.8)
    /// 默认 "草稿箱",旧项目反序列化时此字段缺失则取默认值
    #[serde(default = "default_draft_dir", skip_serializing_if = "is_default_draft_dir")]
    pub draft_dir: String,
}

/// Task 1.8: ProjectMeta 默认目录名常量与判断函数
/// 通过 serde(default = "...") 实现旧项目反序列化时自动填充默认值,保证向后兼容

fn default_outline_dir() -> String {
    "大纲".to_string()
}

fn default_manuscript_dir() -> String {
    "正文".to_string()
}

fn default_draft_dir() -> String {
    "草稿箱".to_string()
}

fn is_default_outline_dir(s: &str) -> bool {
    s == "大纲"
}

fn is_default_manuscript_dir(s: &str) -> bool {
    s == "正文"
}

fn is_default_draft_dir(s: &str) -> bool {
    s == "草稿箱"
}

/// Task 1.8: 默认 codex_dirs 列表(用于新建项目时填充)
///
/// 设计说明:
///   标准目录为"设定",向后兼容旧版的 角色/人物/世界观/术语/名词/素材/资料 7 个目录
///   旧项目反序列化时此字段缺失,通过 #[serde(default)] 取空 Vec
///   后端扫描时若 codex_dirs 为空,回退到 CODEX_DIRS 常量,保证旧项目行为不变
pub fn default_codex_dirs() -> Vec<String> {
    vec![
        "设定".to_string(),
        "角色".to_string(),
        "人物".to_string(),
        "世界观".to_string(),
        "术语".to_string(),
        "名词".to_string(),
        "素材".to_string(),
        "资料".to_string(),
    ]
}

/// 获取当前本地时间的 ISO 8601 字符串
fn chrono_now_iso() -> String {
    use chrono::Local;
    Local::now().to_rfc3339()
}

/// 标准文体类型枚举
///
/// 3 种文体覆盖所有创作场景：
/// - Novel：长短篇小说（含日记体、多卷本、武侠、科幻等）
/// - Script：剧本与脚本（含影视脚本、对话体、舞台剧本等）
/// - Essay：散文与文章（含散文、随笔、诗歌、杂文等）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum StandardProjectType {
    /// 长短篇小说
    Novel,
    /// 剧本与脚本
    Script,
    /// 散文与文章
    Essay,
}

impl StandardProjectType {
    /// 从字符串解析标准文体类型
    ///
    /// 输入: s 文体字符串
    /// 输出: StandardProjectType 标准文体枚举
    /// 流程:
    ///   1. 转小写后匹配新版 3 种文体
    ///   2. 未知字符串默认归入 Novel
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "novel" => StandardProjectType::Novel,
            "script" => StandardProjectType::Script,
            "essay" => StandardProjectType::Essay,
            _ => StandardProjectType::Novel,
        }
    }

    /// 将枚举转换为 snake_case 字符串
    pub fn to_str(&self) -> &'static str {
        match self {
            StandardProjectType::Novel => "novel",
            StandardProjectType::Script => "script",
            StandardProjectType::Essay => "essay",
        }
    }

    /// 获取文体的中文显示名
    pub fn label(&self) -> &'static str {
        match self {
            StandardProjectType::Novel => "长短篇小说",
            StandardProjectType::Script => "剧本与脚本",
            StandardProjectType::Essay => "散文与文章",
        }
    }
}

/// 统一一级目录列表（所有文体共享）
///
/// 5 个标准目录 + 1 个隐藏元数据目录：
/// - 正文：所有正文内容
/// - 设定：所有设定文件（角色/世界观/术语/素材统一存放，通过 front matter 区分类型）
/// - 大纲：大纲与构思
/// - 草稿箱：废弃章节与草稿
/// - 伏笔：伏笔追踪数据（与正文/设定/大纲/草稿箱并列）
/// - .novelforge：应用元数据目录（config.json、manifest.json、index/ 等）
pub fn universal_directories() -> Vec<&'static str> {
    vec![
        "正文",
        "设定",
        "大纲",
        "草稿箱",
        "伏笔",
        ".novelforge",
    ]
}

/// 获取标准文体的预设引导文件
///
/// 输入: project_type 标准文体类型
/// 输出: Vec<(相对路径, 文件内容)> 预设文件列表
/// 流程: 按文体类型返回对应的预设引导文件
/// 说明: 已按要求清空所有预设 txt, 新建项目仅创建目录结构, 不写入任何预设文件
pub fn standard_template_files(_project_type: &StandardProjectType) -> Vec<(&'static str, String)> {
    Vec::new()
}

/// 生成项目元数据（标准文体版本）
///
/// 输入:
///   name - 项目名称
///   standard_type - 标准文体类型（Novel/Script/Essay）
///   genre - 题材
///   author - 作者
///   description - 描述
/// 输出: ProjectMeta 项目元数据
/// 流程: 用 StandardProjectType::to_str() 写入 project_type 字段
/// Task 1.8: 同时填充 codexDirs/outlineDir/manuscriptDir/draftDir 默认目录扫描配置
pub fn create_project_meta_v2(
    name: &str,
    standard_type: &StandardProjectType,
    genre: &str,
    author: &str,
    description: &str,
) -> ProjectMeta {
    let now = chrono_now_iso();
    ProjectMeta {
        name: name.to_string(),
        project_type: standard_type.to_str().to_string(),
        genre: genre.to_string(),
        created_at: now.clone(),
        updated_at: now,
        version: "1.0.0".to_string(),
        author: author.to_string(),
        description: description.to_string(),
        word_count: 0,
        // Task 1.8: 填充默认目录扫描配置,新建项目默认包含标准目录+所有兼容目录
        codex_dirs: default_codex_dirs(),
        outline_dir: default_outline_dir(),
        manuscript_dir: default_manuscript_dir(),
        draft_dir: default_draft_dir(),
    }
}

// ===== 单元测试 =====

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试旧 meta.json（含 "type" 字段与 snake_case 字段名）能正确反序列化为 ProjectMeta
    ///
    /// 验证 BREAKING 变更的向后兼容性：
    /// - 旧 meta.json 使用 "type" 字段名，新版本通过 #[serde(alias = "type")] 兼容读取
    /// - 旧 meta.json 使用 snake_case 字段名（created_at/updated_at/word_count），
    ///   新版本通过 #[serde(alias = "...")] 兼容读取
    /// - Task 1.8: 旧 meta.json 无 codexDirs/outlineDir/manuscriptDir/draftDir 字段,
    ///   通过 #[serde(default = "...")] 自动填充默认值
    #[test]
    fn test_deserialize_old_meta_with_type_field() {
        let old_json = r#"{
            "name": "测试项目",
            "type": "长篇小说",
            "genre": "奇幻",
            "author": "测试作者",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
            "version": "1.0.0",
            "description": "测试描述",
            "word_count": 0
        }"#;

        let meta: ProjectMeta = serde_json::from_str(old_json)
            .expect("旧 meta.json 应能反序列化");
        assert_eq!(meta.name, "测试项目");
        assert_eq!(meta.project_type, "长篇小说");
        assert_eq!(meta.genre, "奇幻");
        assert_eq!(meta.author, "测试作者");
        assert_eq!(meta.created_at, "2026-01-01T00:00:00Z");
        assert_eq!(meta.updated_at, "2026-01-01T00:00:00Z");
        assert_eq!(meta.version, "1.0.0");
        assert_eq!(meta.description, "测试描述");
        assert_eq!(meta.word_count, 0);
        // Task 1.8: 旧 meta.json 缺失目录字段时,反序列化应填充默认值
        assert!(meta.codex_dirs.is_empty(), "旧 meta 无 codexDirs 应回退为空 Vec");
        assert_eq!(meta.outline_dir, "大纲", "旧 meta 缺 outlineDir 应默认为 大纲");
        assert_eq!(meta.manuscript_dir, "正文", "旧 meta 缺 manuscriptDir 应默认为 正文");
        assert_eq!(meta.draft_dir, "草稿箱", "旧 meta 缺 draftDir 应默认为 草稿箱");
    }

    /// 测试新 meta.json 序列化为 "projectType" 字段名（camelCase）
    ///
    /// 验证 BREAKING 变更的正向行为：
    /// - 新写入的 meta.json 使用 "projectType" 字段名（camelCase）
    /// - 不再输出旧版的 "type" 字段名
    /// - Task 1.8: 默认目录字段在序列化时通过 skip_serializing_if 跳过(避免污染 JSON)
    #[test]
    fn test_serialize_new_meta_with_project_type_field() {
        let meta = ProjectMeta {
            name: "新项目".to_string(),
            project_type: "长篇小说".to_string(),
            genre: "科幻".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            version: "1.0.0".to_string(),
            author: "新作者".to_string(),
            description: "新描述".to_string(),
            word_count: 0,
            codex_dirs: default_codex_dirs(),
            outline_dir: default_outline_dir(),
            manuscript_dir: default_manuscript_dir(),
            draft_dir: default_draft_dir(),
        };

        let json = serde_json::to_string(&meta).expect("序列化应成功");
        assert!(
            json.contains("\"projectType\""),
            "序列化结果应包含 projectType 字段: {}",
            json
        );
        assert!(
            !json.contains("\"type\""),
            "序列化结果不应包含 type 字段: {}",
            json
        );
        assert!(
            json.contains("\"createdAt\""),
            "序列化结果应包含 createdAt 字段: {}",
            json
        );
        assert!(
            json.contains("\"wordCount\""),
            "序列化结果应包含 wordCount 字段: {}",
            json
        );
        // Task 1.8: codexDirs 非默认值应被序列化,而 outlineDir/manuscriptDir/draftDir 为默认值时应被跳过
        assert!(
            json.contains("\"codexDirs\""),
            "序列化结果应包含 codexDirs 字段(非空时不应跳过): {}",
            json
        );
        assert!(
            !json.contains("\"outlineDir\""),
            "默认 outlineDir 应被 skip_serializing_if 跳过: {}",
            json
        );
        assert!(
            !json.contains("\"manuscriptDir\""),
            "默认 manuscriptDir 应被 skip_serializing_if 跳过: {}",
            json
        );
        assert!(
            !json.contains("\"draftDir\""),
            "默认 draftDir 应被 skip_serializing_if 跳过: {}",
            json
        );
    }

    /// 测试新格式 meta.json（camelCase 字段名）能正确反序列化
    ///
    /// 验证新版本读写自身产生的 meta.json 不受影响
    #[test]
    fn test_deserialize_new_meta_with_camel_case() {
        let new_json = r#"{
            "name": "新格式项目",
            "projectType": "散文",
            "genre": "随笔",
            "author": "新作者",
            "createdAt": "2026-02-01T00:00:00Z",
            "updatedAt": "2026-02-01T00:00:00Z",
            "version": "2.0.0",
            "description": "新格式描述",
            "wordCount": 100
        }"#;

        let meta: ProjectMeta = serde_json::from_str(new_json)
            .expect("新格式 meta.json 应能反序列化");
        assert_eq!(meta.name, "新格式项目");
        assert_eq!(meta.project_type, "散文");
        assert_eq!(meta.genre, "随笔");
        assert_eq!(meta.word_count, 100);
        // Task 1.8: 缺失目录字段时也应填充默认值
        assert_eq!(meta.outline_dir, "大纲");
        assert_eq!(meta.manuscript_dir, "正文");
        assert_eq!(meta.draft_dir, "草稿箱");
    }

    /// Task 1.8: 测试自定义目录扫描配置的序列化与反序列化往返一致性
    ///
    /// 验证场景: 用户通过自定义目录配置(如多语言项目使用 "Characters" 替代 "角色"),
    /// 非默认值应被序列化到 JSON,反序列化后能完整恢复
    #[test]
    fn test_custom_dir_config_roundtrip() {
        let meta = ProjectMeta {
            name: "自定义目录项目".to_string(),
            project_type: "novel".to_string(),
            genre: String::new(),
            created_at: "2026-03-01T00:00:00Z".to_string(),
            updated_at: "2026-03-01T00:00:00Z".to_string(),
            version: "1.0.0".to_string(),
            author: "测试".to_string(),
            description: String::new(),
            word_count: 0,
            codex_dirs: vec!["Characters".to_string(), "Worldbuilding".to_string()],
            outline_dir: "Outlines".to_string(),
            manuscript_dir: "Chapters".to_string(),
            draft_dir: "Drafts".to_string(),
        };

        let json = serde_json::to_string(&meta).expect("序列化应成功");
        // 非默认值应被序列化
        assert!(json.contains("\"codexDirs\""), "codexDirs 应被序列化: {}", json);
        assert!(json.contains("\"outlineDir\""), "outlineDir 应被序列化: {}", json);
        assert!(json.contains("\"manuscriptDir\""), "manuscriptDir 应被序列化: {}", json);
        assert!(json.contains("\"draftDir\""), "draftDir 应被序列化: {}", json);

        let restored: ProjectMeta = serde_json::from_str(&json).expect("反序列化应成功");
        assert_eq!(restored.codex_dirs, vec!["Characters".to_string(), "Worldbuilding".to_string()]);
        assert_eq!(restored.outline_dir, "Outlines");
        assert_eq!(restored.manuscript_dir, "Chapters");
        assert_eq!(restored.draft_dir, "Drafts");
    }
}
