// 项目模板与目录结构定义模块
//
// 功能概述：
// 定义 NovelForge 支持的四种小说项目类型及其对应的目录结构。
// 每种类型除通用目录外，还包含独特的子目录与预设文件。
//
// 模块职责：
// 1. 定义项目类型枚举
// 2. 定义通用目录结构
// 3. 定义各类型专属目录结构
// 4. 生成项目元数据

use serde::{Deserialize, Serialize};

/// 小说项目类型枚举
/// 输入: 无
/// 输出: 项目类型枚举值
/// 流程: 定义四种创作题材类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectType {
    /// 西幻史诗
    Epic,
    /// 标准长篇
    Standard,
    /// 散文随笔
    Essay,
    /// 舞台剧本
    Script,
}

impl ProjectType {
    /// 从字符串解析项目类型
    /// 输入: 类型字符串
    /// 输出: 对应的 ProjectType 枚举值
    /// 流程: 匹配字符串返回枚举值，默认返回 Standard
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "epic" => ProjectType::Epic,
            "essay" => ProjectType::Essay,
            "script" => ProjectType::Script,
            _ => ProjectType::Standard,
        }
    }
}

/// 项目元数据结构
/// 存储在项目根目录的 .novelforge/project.json 中
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMeta {
    /// 项目名称
    pub name: String,
    /// 项目类型
    #[serde(rename = "type")]
    pub project_type: String,
    /// 创建时间(ISO 8601)
    pub created_at: String,
    /// 最后修改时间(ISO 8601)
    pub updated_at: String,
    /// 项目版本
    pub version: String,
    /// 作者
    pub author: String,
    /// 项目描述
    pub description: String,
    /// 总字数
    pub word_count: u64,
}

/// 通用目录列表
/// 所有项目类型都包含的基础目录
/// 输入: 无
/// 输出: 目录名向量
/// 流程: 返回通用目录名列表
pub fn common_directories() -> Vec<&'static str> {
    vec![
        "角色",       // 角色设计
        "世界观",     // 世界观设定
        "名词",       // 专有名词库
        "时间线",     // 时间线与思维导图
        "正文",       // 正文内容
        "大纲",       // 大纲与构思
        "素材",       // 参考资料
        ".novelforge", // 应用元数据目录
    ]
}

/// 通用预设文件
/// 输入: 无
/// 输出: (相对路径, 内容) 元组向量
/// 流程: 返回通用预设文件列表
pub fn common_files() -> Vec<(&'static str, &'static str)> {
    vec![
        // 角色目录说明
        ("角色/.gitkeep", ""),
        // 世界观目录说明
        ("世界观/.gitkeep", ""),
        // 名词目录说明
        ("名词/.gitkeep", ""),
        // 时间线目录说明
        ("时间线/.gitkeep", ""),
        // 大纲模板
        ("大纲/总体大纲.md", "# 总体大纲\n\n## 故事梗概\n\n## 主要冲突\n\n## 结局走向\n"),
        // 素材目录占位
        ("素材/.gitkeep", ""),
    ]
}

/// 获取特定类型的专属目录
/// 输入: 项目类型
/// 输出: 专属目录名向量
/// 流程: 根据类型返回对应的专属子目录列表
pub fn type_specific_directories(project_type: &ProjectType) -> Vec<&'static str> {
    match project_type {
        ProjectType::Epic => vec![
            "势力编年史",  // 势力与组织历史
            "地图设定",    // 地理与地图
            "魔法体系",    // 魔法/能力系统
            "种族设定",    // 种族与物种
            "历史年表",    // 历史时间线
            "语言文字",    // 自创语言体系
        ],
        ProjectType::Standard => vec![
            "卷宗",        // 分卷管理
            "章节存档",    // 废弃章节存档
            "伏笔记录",    // 伏笔追踪
            "人物关系图",  // 人物关系网络
        ],
        ProjectType::Essay => vec![
            "灵感碎片",    // 零散灵感记录
            "配图素材",    // 插图素材
            "引用集锦",    // 引用与摘录
        ],
        ProjectType::Script => vec![
            "场景设定",    // 场景与布景
            "道具清单",    // 道具管理
            "音效提示",    // 音效与配乐
            "分幕大纲",    // 分幕结构
        ],
    }
}

/// 获取特定类型的专属预设文件
/// 输入: 项目类型
/// 输出: (相对路径, 内容) 元组向量
/// 流程: 根据类型返回对应的专属预设文件
pub fn type_specific_files(project_type: &ProjectType) -> Vec<(&'static str, String)> {
    match project_type {
        ProjectType::Epic => vec![
            (
                "势力编年史/势力总览.md",
                "# 势力总览\n\n## 主要势力\n\n| 势力名 | 领袖 | 阵营 | 核心理念 |\n|--------|------|------|----------|\n| | | | |\n\n## 势力关系\n\n".to_string(),
            ),
            (
                "魔法体系/体系说明.md",
                "# 魔法体系\n\n## 能力来源\n\n## 等级划分\n\n## 限制与代价\n\n## 已知技能\n".to_string(),
            ),
            (
                "种族设定/种族列表.md",
                "# 种族列表\n\n## 种族名称\n\n- 外貌特征:\n- 寿命:\n- 文化特点:\n- 特殊能力:\n".to_string(),
            ),
        ],
        ProjectType::Standard => vec![
            (
                "伏笔记录/伏笔追踪.md",
                "# 伏笔追踪表\n\n| 编号 | 伏笔内容 | 埋设章节 | 揭示章节 | 状态 |\n|------|----------|----------|----------|------|\n| F001 | | | | 待埋设 |\n".to_string(),
            ),
            (
                "卷宗/分卷规划.md",
                "# 分卷规划\n\n## 第一卷\n\n- 核心主线:\n- 预计字数:\n- 关键事件:\n".to_string(),
            ),
        ],
        ProjectType::Essay => vec![
            (
                "灵感碎片/灵感本.md",
                "# 灵感本\n\n> 随时记录闪现的灵感与片段\n\n---\n\n".to_string(),
            ),
        ],
        ProjectType::Script => vec![
            (
                "分幕大纲/幕次结构.md",
                "# 幕次结构\n\n## 第一幕\n\n- 场景:\n- 出场人物:\n- 核心冲突:\n- 结尾悬念:\n".to_string(),
            ),
            (
                "角色/角色名册.md",
                "# 角色名册\n\n> 此文件用于剧本台词人名预设，每行一个角色名\n\n主角\n配角A\n配角B\n".to_string(),
            ),
        ],
    }
}

/// 生成项目元数据
/// 输入: 项目名称、类型、作者、描述
/// 输出: ProjectMeta 结构体
/// 流程: 用当前时间戳创建元数据
pub fn create_project_meta(
    name: &str,
    project_type: &ProjectType,
    author: &str,
    description: &str,
) -> ProjectMeta {
    let now = chrono_now_iso();
    ProjectMeta {
        name: name.to_string(),
        project_type: format!("{:?}", project_type).to_lowercase(),
        created_at: now.clone(),
        updated_at: now,
        version: "1.0.0".to_string(),
        author: author.to_string(),
        description: description.to_string(),
        word_count: 0,
    }
}

/// 获取当前时间的 ISO 8601 字符串
/// 输入: 无
/// 输出: 时间字符串
/// 流程: 使用 chrono 生成 RFC 3339 格式时间戳
fn chrono_now_iso() -> String {
    use chrono::Local;
    Local::now().to_rfc3339()
}
