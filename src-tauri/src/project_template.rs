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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
/// 4 个标准目录 + 1 个隐藏元数据目录：
/// - 正文：所有正文内容
/// - 设定：所有设定文件（角色/世界观/术语/素材统一存放，通过 front matter 区分类型）
/// - 大纲：大纲与构思
/// - 草稿箱：废弃章节与草稿
/// - .novelforge：应用元数据目录（config.json、index/ 等）
pub fn universal_directories() -> Vec<&'static str> {
    vec![
        "正文",
        "设定",
        "大纲",
        "草稿箱",
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
    }

    /// 测试新 meta.json 序列化为 "projectType" 字段名（camelCase）
    ///
    /// 验证 BREAKING 变更的正向行为：
    /// - 新写入的 meta.json 使用 "projectType" 字段名（camelCase）
    /// - 不再输出旧版的 "type" 字段名
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
    }
}
