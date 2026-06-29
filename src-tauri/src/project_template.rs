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
/// 流程: 定义八种创作题材类型
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
    /// 武侠江湖
    Wuxia,
    /// 科幻未来
    Scifi,
    /// 悬疑推理
    Mystery,
    /// 言情都市
    Romance,
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
            "wuxia" => ProjectType::Wuxia,
            "scifi" => ProjectType::Scifi,
            "mystery" => ProjectType::Mystery,
            "romance" => ProjectType::Romance,
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

/// 通用预设文件（纯文本 .txt 格式）
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
        ("大纲/总体大纲.txt", "总体大纲\n\n故事梗概\n\n主要冲突\n\n结局走向\n"),
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
        ProjectType::Wuxia => vec![
            "江湖势力",    // 门派与帮派势力
            "武学体系",    // 武功招式与内功
            "地理图志",    // 江湖地理与场景
            "门派设定",    // 门派详细设定
            "江湖规矩",    // 江湖道义与规矩
            "兵器谱",      // 兵器与法宝
        ],
        ProjectType::Scifi => vec![
            "科技设定",    // 科技与发明
            "星际地图",    // 星系与航路
            "物种图鉴",    // 外星物种
            "文明等级",    // 文明分级体系
            "时间悖论",    // 时间线与悖论记录
            "装备载具",    // 装备与载具
        ],
        ProjectType::Mystery => vec![
            "案件档案",    // 案件卷宗
            "线索追踪",    // 线索与证据链
            "嫌疑人列表",  // 嫌疑人档案
            "时间推演",    // 案发时间线还原
            "诡计设计",    // 核心诡计与手法
            "推理逻辑",    // 推理链条
        ],
        ProjectType::Romance => vec![
            "情感线",      // 情感发展脉络
            "场景地图",    // 约会与关键场景
            "人物关系",    // 角色关系网络
            "约会记录",    // 约会情节记录
            "情感节点",    // 情感转折点
            "对话集锦",    // 经典对话收集
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
                "势力编年史/势力总览.txt",
                "势力总览\n\n主要势力\n\n势力名 / 领袖 / 阵营 / 核心理念\n\n\n势力关系\n\n".to_string(),
            ),
            (
                "魔法体系/体系说明.txt",
                "魔法体系\n\n能力来源\n\n等级划分\n\n限制与代价\n\n已知技能\n".to_string(),
            ),
            (
                "种族设定/种族列表.txt",
                "种族列表\n\n种族名称\n\n外貌特征:\n寿命:\n文化特点:\n特殊能力:\n".to_string(),
            ),
        ],
        ProjectType::Standard => vec![
            (
                "伏笔记录/伏笔追踪.txt",
                "伏笔追踪表\n\n编号 / 伏笔内容 / 埋设章节 / 揭示章节 / 状态\nF001 / / / / 待埋设\n".to_string(),
            ),
            (
                "卷宗/分卷规划.txt",
                "分卷规划\n\n第一卷\n\n核心主线:\n预计字数:\n关键事件:\n".to_string(),
            ),
        ],
        ProjectType::Essay => vec![
            (
                "灵感碎片/灵感本.txt",
                "灵感本\n\n随时记录闪现的灵感与片段\n\n".to_string(),
            ),
        ],
        ProjectType::Script => vec![
            (
                "分幕大纲/幕次结构.txt",
                "幕次结构\n\n第一幕\n\n场景:\n出场人物:\n核心冲突:\n结尾悬念:\n".to_string(),
            ),
            (
                "角色/角色名册.txt",
                "角色名册\n\n此文件用于剧本台词人名预设，每行一个角色名\n\n主角\n配角A\n配角B\n".to_string(),
            ),
        ],
        ProjectType::Wuxia => vec![
            (
                "江湖势力/势力总览.txt",
                "江湖势力总览\n\n正道\n门派 / 掌门 / 势力范围 / 武学特色\n\n\n邪道\n门派 / 掌门 / 势力范围 / 武学特色\n\n\n中立\n势力 / 首领 / 立场 / 备注\n\n".to_string(),
            ),
            (
                "武学体系/武学总纲.txt",
                "武学总纲\n\n内功心法\n名称 / 品阶 / 修炼条件 / 威力描述\n\n\n招式剑法\n名称 / 品阶 / 招式特点 / 破绽\n\n\n轻功身法\n名称 / 品阶 / 速度描述 / 特殊效果\n\n".to_string(),
            ),
            (
                "门派设定/门派模板.txt",
                "门派设定模板\n\n门派名称\n\n创始人:\n现任掌门:\n门派驻地:\n核心武学:\n门规戒律:\n势力等级:\n友盟关系:\n仇敌关系:\n\n主要成员\n姓名 / 身份 / 武功 / 性格\n\n".to_string(),
            ),
            (
                "兵器谱/兵器列表.txt",
                "兵器谱\n\n排名 / 兵器名 / 持有者 / 材质 / 特殊能力\n第一 / / / /\n第二 / / / /\n第三 / / / /\n".to_string(),
            ),
        ],
        ProjectType::Scifi => vec![
            (
                "科技设定/科技树.txt",
                "科技树\n\n能源技术\n技术名 / 等级 / 应用领域 / 副作用\n\n\n信息技术\n技术名 / 等级 / 应用领域 / 副作用\n\n\n航天技术\n技术名 / 等级 / 应用领域 / 副作用\n\n".to_string(),
            ),
            (
                "星际地图/星系概览.txt",
                "星系概览\n\n已知星系\n星系名 / 坐标 / 文明等级 / 资源 / 状态\n\n\n航路网络\n起点 / 终点 / 距离(光年) / 航行时间 / 安全等级\n\n".to_string(),
            ),
            (
                "文明等级/文明分级.txt",
                "文明分级体系\n\n文明等级定义\n等级 / 名称 / 特征 / 代表文明\nI / 行星文明 / 可利用母星全部能源 /\nII / 恒星文明 / 可建造戴森球 /\nIII / 星系文明 / 可星际旅行 /\nIV / 超星系文明 / 可跨星系航行 /\n".to_string(),
            ),
        ],
        ProjectType::Mystery => vec![
            (
                "案件档案/案件模板.txt",
                "案件档案模板\n\n案件编号: CASE-001\n\n案件概述\n案发时间:\n案发地点:\n案件类型: 谋杀/盗窃/失踪/其他\n受害者:\n报案人:\n\n案发现场\n现场描述\n\n物证清单\n编号 / 物证 / 位置 / 备注\nE001 / / /\n\n嫌疑人\n姓名 / 动机 / 不在场证明 / 疑点\n\n".to_string(),
            ),
            (
                "线索追踪/线索总表.txt",
                "线索追踪总表\n\n编号 / 线索内容 / 发现章节 / 关联嫌疑人 / 真伪 / 状态\nC001 / / / / 待验证 / 未使用\n\n证据链\n链条一: C001 -> C003 -> C007 -> 真相\n链条二: C002 -> C005 -> C009 -> 真相\n".to_string(),
            ),
            (
                "诡计设计/诡计核心.txt",
                "核心诡计设计\n\n诡计类型\n[ ] 密室诡计\n[ ] 不可能犯罪\n[ ] 身份诡计\n[ ] 时间诡计\n[ ] 心理诡计\n[ ] 机械诡计\n\n诡计详情\n核心手法\n实施条件\n误导方向\n揭示方式\n\n参考作品\n\n".to_string(),
            ),
        ],
        ProjectType::Romance => vec![
            (
                "情感线/情感脉络.txt",
                "情感发展脉络\n\n情感阶段\n阶段 / 章节 / 事件 / 情感变化 / 温度\n初遇 / / / 陌生 -> 好奇 / 10\n暧昧 / / / 好奇 -> 心动 / 30\n表白 / / / 心动 -> 相爱 / 60\n考验 / / / 相爱 -> 挣扎 / 40\n确认 / / / 挣扎 -> 认定 / 90\n\n情感转折点\n1.\n2.\n3.\n".to_string(),
            ),
            (
                "人物关系/关系网络.txt",
                "人物关系网络\n\n主角关系\n角色 / 与主角关系 / 态度 / 影响\n/ 情敌 / 敌对 / 阻碍\n/ 闺蜜/兄弟 / 支持 / 助力\n/ 长辈 / 反对 / 压力\n\n关系图谱\n主角A --- 相爱 --- 主角B\n  |                    |\n 情敌C              情敌D\n  |                    |\n 联合                联合\n  |                    |\n  +------ 阻碍 ------+\n".to_string(),
            ),
            (
                "情感节点/节点清单.txt",
                "情感节点清单\n\n关键节点\n编号 / 节点类型 / 描述 / 章节 / 情感温度\nN001 / 初遇 / / / 10\nN002 / 误会 / / / 20\nN003 / 心动 / / / 40\nN004 / 表白 / / / 70\nN005 / 危机 / / / 30\nN006 / 和好 / / / 80\nN007 / 确认 / / / 100\n".to_string(),
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
