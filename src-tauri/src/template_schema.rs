// 模块化模板系统
//
// 功能概述：
// 定义可组合的字段 Schema，支持用户在新建文件时自主勾选所需字段模块。
// 模板由"基础字段（强制）+ 可选模块（用户勾选）"组成，打破硬编码模板限制。
// 参考 Novelcrafter Codex、Campfire Writing、Notion Database 的设计思路。
//
// 模块职责：
// 1. 定义字段类型枚举（FieldType）
// 2. 定义字段定义结构（FieldDef）
// 3. 定义可选模块结构（TemplateModule）
// 4. 定义完整模板结构（TemplateSchema）
// 5. 提供预设模板库（角色/世界观/术语/大纲等多分类多模板）
// 6. 提供 get_templates / render_template / 自定义模板 CRUD 命令（内置+自定义模板合并查询）

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;

// ===== 字段类型系统 =====

/// 字段类型枚举
/// 参考 Notion Property Types + Airtable 字段类型 + Novelcrafter 四分类法
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FieldType {
    /// 单行文本
    Text,
    /// 富文本（多行，支持 TipTap 编辑）
    RichText,
    /// 数字
    Number,
    /// 日期
    Date,
    /// 单选下拉
    Select,
    /// 多选标签
    MultiSelect,
    /// 布尔开关
    Boolean,
    /// URL 链接
    Url,
    /// 引用其他条目
    Reference,
}

/// 字段定义结构
/// 描述单个字段的元信息，用于前端渲染对应编辑器
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldDef {
    /// 字段唯一标识（英文 key，如 "name"、"age"）
    pub key: String,
    /// 字段显示名（中文，如"姓名"、"年龄"）
    pub label: String,
    /// 字段类型
    pub field_type: FieldType,
    /// 是否必填
    #[serde(default)]
    pub required: bool,
    /// 占位提示文本
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    /// 默认值
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
    /// 单选/多选的选项列表
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    /// 帮助说明
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help_text: Option<String>,
}

impl FieldDef {
    /// 快捷构造函数：创建文本字段
    pub fn text(key: &str, label: &str) -> Self {
        Self {
            key: key.to_string(),
            label: label.to_string(),
            field_type: FieldType::Text,
            required: false,
            placeholder: None,
            default: None,
            options: vec![],
            help_text: None,
        }
    }

    /// 快捷构造函数：创建富文本字段
    pub fn richtext(key: &str, label: &str) -> Self {
        Self {
            key: key.to_string(),
            label: label.to_string(),
            field_type: FieldType::RichText,
            required: false,
            placeholder: None,
            default: None,
            options: vec![],
            help_text: None,
        }
    }

    /// 快捷构造函数：创建单选字段
    pub fn select(key: &str, label: &str, options: Vec<&str>) -> Self {
        Self {
            key: key.to_string(),
            label: label.to_string(),
            field_type: FieldType::Select,
            required: false,
            placeholder: None,
            default: None,
            options: options.into_iter().map(String::from).collect(),
            help_text: None,
        }
    }

    /// 设置为必填
    pub fn required(mut self) -> Self {
        self.required = true;
        self
    }

    /// 设置占位提示
    pub fn placeholder(mut self, text: &str) -> Self {
        self.placeholder = Some(text.to_string());
        self
    }

    /// 设置帮助说明
    pub fn help(mut self, text: &str) -> Self {
        self.help_text = Some(text.to_string());
        self
    }
}

// ===== 模板模块系统 =====

/// 可选模块结构
/// 一组相关字段的打包组合，用户可在新建文件时勾选启用
/// 参考 Campfire Writing 的模块化 Panel 系统
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateModule {
    /// 模块唯一标识
    pub id: String,
    /// 模块显示名（如"角色弧光"、"魔法体系"）
    pub name: String,
    /// 模块描述
    pub description: String,
    /// 模块图标（lucide-react 图标名）
    pub icon: String,
    /// 模块包含的字段列表
    pub fields: Vec<FieldDef>,
}

impl TemplateModule {
    /// 快捷构造函数
    pub fn new(id: &str, name: &str, icon: &str, fields: Vec<FieldDef>) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            description: String::new(),
            icon: icon.to_string(),
            fields,
        }
    }

    /// 设置描述
    pub fn desc(mut self, desc: &str) -> Self {
        self.description = desc.to_string();
        self
    }
}

// ===== 完整模板结构 =====

/// 完整模板定义
/// 由基础字段 + 可选模块组成，用户创建文件时选择模板并勾选模块
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateSchema {
    /// 模板唯一标识
    pub id: String,
    /// 模板显示名
    pub name: String,
    /// 模板所属分类（character/worldview/glossary/outline/foreshadowing）
    pub category: String,
    /// 模板描述
    pub description: String,
    /// 模板图标
    pub icon: String,
    /// 基础字段（强制启用，所有该模板创建的文件必备）
    pub base_fields: Vec<FieldDef>,
    /// 可选模块列表
    pub optional_modules: Vec<TemplateModule>,
    /// 默认启用的模块 ID 列表
    pub default_enabled_modules: Vec<String>,
}

// ===== 预设模板库 =====

/// 获取所有预设模板
/// 返回按分类组织的模板列表
pub fn get_all_templates() -> Vec<TemplateSchema> {
    vec![
        // ── 角色模板 ──
        character_standard_template(),
        character_fantasy_template(),
        character_scifi_template(),
        character_romance_template(),
        character_mystery_template(),
        // ── 世界观模板 ──
        worldview_standard_template(),
        worldview_fantasy_template(),
        // ── 术语模板 ──
        glossary_standard_template(),
        // ── 大纲模板 ──
        outline_standard_template(),
        outline_chapter_template(),
    ]
}

// ===== 角色模板预设 =====

/// 标准角色模板
fn character_standard_template() -> TemplateSchema {
    TemplateSchema {
        id: "char-standard".to_string(),
        name: "标准角色".to_string(),
        category: "character".to_string(),
        description: "通用角色模板，包含基础信息与性格设定".to_string(),
        icon: "User".to_string(),
        base_fields: vec![
            FieldDef::text("name", "姓名").required().placeholder("角色的全名"),
            FieldDef::text("age", "年龄").placeholder("如：25"),
            FieldDef::select("gender", "性别", vec!["男", "女", "其他"]),
            FieldDef::text("identity", "身份/职业").placeholder("如：剑客/学者/商人"),
            FieldDef::richtext("appearance", "外貌描述").placeholder("体型、面容、穿着、标志性特征"),
        ],
        optional_modules: vec![
            TemplateModule::new(
                "personality",
                "性格档案",
                "Heart",
                vec![
                    FieldDef::text("core_trait", "核心特质").placeholder("如：执着、温柔、阴鸷"),
                    FieldDef::text("strengths", "优点"),
                    FieldDef::text("weaknesses", "缺点"),
                    FieldDef::text("habit", "口头禅/习惯动作"),
                ],
            ).desc("角色的核心性格特征与行为习惯"),
            TemplateModule::new(
                "background",
                "背景故事",
                "BookOpen",
                vec![
                    FieldDef::richtext("origin", "出身来历"),
                    FieldDef::richtext("key_experience", "关键经历"),
                    FieldDef::richtext("personality_cause", "性格成因"),
                ],
            ).desc("角色的过去经历与性格形成原因"),
            TemplateModule::new(
                "motivation",
                "动机与目标",
                "Target",
                vec![
                    FieldDef::text("inner_motivation", "内在动机").help("角色内心真正想要什么"),
                    FieldDef::text("outer_goal", "外在目标").help("角色表面上要做什么"),
                    FieldDef::text("core_conflict", "核心冲突").help("什么阻碍角色达成目标"),
                ],
            ).desc("驱动角色行动的内在动机与外在目标"),
            TemplateModule::new(
                "arc",
                "成长弧光",
                "TrendingUp",
                vec![
                    FieldDef::text("arc_start", "起点状态"),
                    FieldDef::text("arc_turning", "转折契机"),
                    FieldDef::text("arc_end", "终点蜕变"),
                ],
            ).desc("角色在故事中的成长轨迹与转变"),
            TemplateModule::new(
                "relations",
                "人物关系",
                "Users",
                vec![
                    FieldDef::richtext("relationships", "关系网络").placeholder("与其他角色的关系描述"),
                ],
            ).desc("角色与其他人物的关系网络"),
            TemplateModule::new(
                "quotes",
                "经典台词",
                "Quote",
                vec![
                    FieldDef::richtext("classic_quotes", "金句与标志性台词").placeholder("收集角色的代表性台词"),
                ],
            ).desc("角色的标志性台词与金句集合"),
        ],
        default_enabled_modules: vec![
            "personality".to_string(),
            "background".to_string(),
            "motivation".to_string(),
        ],
    }
}

/// 奇幻角色模板
fn character_fantasy_template() -> TemplateSchema {
    let mut template = character_standard_template();
    template.id = "char-fantasy".to_string();
    template.name = "奇幻角色".to_string();
    template.description = "适用于玄幻/奇幻/仙侠题材，包含种族与魔法体系".to_string();
    template.base_fields.push(FieldDef::select("race", "种族", vec!["人族", "精灵", "兽人", "龙族", "魔族", "神族", "其他"]));
    template.base_fields.push(FieldDef::text("class", "阶级/职业").placeholder("如：法师/战士/游侠"));
    template.optional_modules.push(
        TemplateModule::new(
            "magic_system",
            "魔法体系",
            "Sparkles",
            vec![
                FieldDef::select("magic_type", "魔法类型", vec!["元素", "精神", "神圣", "黑暗", "召唤", "时空", "其他"]),
                FieldDef::text("magic_level", "强度等级").placeholder("如：S级/9阶/元婴期"),
                FieldDef::richtext("magic_cost", "代价与限制").help("施法的代价、冷却、副作用"),
                FieldDef::richtext("special_abilities", "特殊能力"),
            ],
        ).desc("角色的魔法能力与修炼体系"),
    );
    template.optional_modules.push(
        TemplateModule::new(
            "combat",
            "战斗能力",
            "Sword",
            vec![
                FieldDef::text("weapon", "武器专精"),
                FieldDef::text("fighting_style", "战斗风格"),
                FieldDef::select("handedness", "惯用手", vec!["左手", "右手", "双手"]),
            ],
        ).desc("角色的战斗技能与武器配置"),
    );
    template.default_enabled_modules.push("magic_system".to_string());
    template
}

/// 科幻角色模板
fn character_scifi_template() -> TemplateSchema {
    let mut template = character_standard_template();
    template.id = "char-scifi".to_string();
    template.name = "科幻角色".to_string();
    template.description = "适用于科幻题材，包含物种与科技装备".to_string();
    template.base_fields.push(FieldDef::text("species", "物种").placeholder("如：人类/合成人/外星种族"));
    template.base_fields.push(FieldDef::text("origin_galaxy", "所属星系/文明"));
    template.optional_modules.push(
        TemplateModule::new(
            "tech",
            "科技装备",
            "Cpu",
            vec![
                FieldDef::richtext("implants", "改造植入").placeholder("义体/神经接口/纳米注入"),
                FieldDef::richtext("equipment", "装备清单"),
                FieldDef::text("ship", "专属星舰"),
            ],
        ).desc("角色的科技装备与改造植入"),
    );
    template.optional_modules.push(
        TemplateModule::new(
            "faction",
            "阵营派系",
            "Flag",
            vec![
                FieldDef::text("faction_name", "所属阵营"),
                FieldDef::select("faction_role", "阵营职位", vec!["领袖", "核心成员", "普通成员", "边缘人"]),
                FieldDef::richtext("faction_relation", "阵营关系"),
            ],
        ).desc("角色所属的政治或军事阵营"),
    );
    template
}

/// 言情角色模板
fn character_romance_template() -> TemplateSchema {
    let mut template = character_standard_template();
    template.id = "char-romance".to_string();
    template.name = "言情角色".to_string();
    template.description = "适用于言情/都市/情感题材，包含情感弧光".to_string();
    template.optional_modules.push(
        TemplateModule::new(
            "romance_arc",
            "情感弧光",
            "Heart",
            vec![
                FieldDef::text("love_language", "爱的语言").placeholder("如：服务行动/肯定言语/陪伴"),
                FieldDef::text("chemistry", "化学反应对象").placeholder("与谁的化学反应"),
                FieldDef::select("relationship_status", "关系状态", vec!["单身", "暧昧", "恋爱中", "已婚", "分手"]),
                FieldDef::richtext("emotional_arc", "情感转变轨迹"),
            ],
        ).desc("角色的情感发展轨迹"),
    );
    template.default_enabled_modules.push("romance_arc".to_string());
    template
}

/// 悬疑角色模板
fn character_mystery_template() -> TemplateSchema {
    let mut template = character_standard_template();
    template.id = "char-mystery".to_string();
    template.name = "悬疑角色".to_string();
    template.description = "适用于悬疑/推理/犯罪题材，包含秘密与动机层次".to_string();
    template.optional_modules.push(
        TemplateModule::new(
            "secrets",
            "秘密档案",
            "EyeOff",
            vec![
                FieldDef::richtext("hidden_secret", "隐藏秘密"),
                FieldDef::richtext("past_lies", "谎言清单"),
                FieldDef::richtext("unsolved_past", "未公开过去"),
            ],
        ).desc("角色不为人知的秘密与谎言"),
    );
    template.optional_modules.push(
        TemplateModule::new(
            "suspect",
            "嫌疑人档案",
            "Search",
            vec![
                FieldDef::select("suspect_level", "嫌疑等级", vec!["证人", "次要嫌疑人", "主要嫌疑人", "真凶"]),
                FieldDef::text("alibi", "不在场证明"),
                FieldDef::richtext("motive_layers", "动机层次").help("表层动机/深层动机/真实动机"),
                FieldDef::richtext("clue_chain", "线索链"),
            ],
        ).desc("角色的嫌疑程度与相关线索"),
    );
    template
}

// ===== 世界观模板预设 =====

/// 标准世界观模板
fn worldview_standard_template() -> TemplateSchema {
    TemplateSchema {
        id: "world-standard".to_string(),
        name: "标准世界观".to_string(),
        category: "worldview".to_string(),
        description: "通用世界观模板，包含地理、历史、社会、文化等维度".to_string(),
        icon: "Globe".to_string(),
        base_fields: vec![
            FieldDef::text("world_name", "世界名称").required().placeholder("如：九州/中土/艾泽拉斯"),
            FieldDef::richtext("overview", "世界概述").placeholder("一句话概括这个世界"),
        ],
        optional_modules: vec![
            TemplateModule::new(
                "geography",
                "地理环境",
                "Map",
                vec![
                    FieldDef::richtext("terrain", "地形地貌"),
                    FieldDef::richtext("climate", "气候特征"),
                    FieldDef::richtext("landmarks", "重要地标"),
                    FieldDef::richtext("transport", "交通与通道"),
                    FieldDef::richtext("resources", "资源分布"),
                ],
            ).desc("世界的地理环境与自然资源"),
            TemplateModule::new(
                "history",
                "历史背景",
                "Clock",
                vec![
                    FieldDef::text("era_system", "纪年体系"),
                    FieldDef::richtext("major_events", "重大历史事件"),
                    FieldDef::richtext("dynasties", "朝代/时期划分"),
                ],
            ).desc("世界的历史发展脉络"),
            TemplateModule::new(
                "society",
                "社会结构",
                "Building",
                vec![
                    FieldDef::richtext("social_hierarchy", "社会阶层"),
                    FieldDef::richtext("political_system", "政治制度"),
                    FieldDef::richtext("economic_system", "经济体系"),
                    FieldDef::richtext("legal_system", "法律与禁忌"),
                ],
            ).desc("世界的社会组织与权力结构"),
            TemplateModule::new(
                "culture",
                "文化体系",
                "Palette",
                vec![
                    FieldDef::richtext("religion", "宗教信仰"),
                    FieldDef::richtext("language", "语言文字"),
                    FieldDef::richtext("customs", "风俗习惯"),
                    FieldDef::richtext("art", "艺术与美学"),
                ],
            ).desc("世界的文化传统与精神生活"),
            TemplateModule::new(
                "power_system",
                "力量体系",
                "Zap",
                vec![
                    FieldDef::text("power_source", "力量来源"),
                    FieldDef::text("power_levels", "等级划分"),
                    FieldDef::richtext("cultivation", "修炼进阶"),
                    FieldDef::richtext("power_cost", "限制与代价"),
                    FieldDef::richtext("special_abilities", "特殊能力"),
                ],
            ).desc("世界的魔法/修炼/科技力量体系"),
            TemplateModule::new(
                "factions",
                "势力阵营",
                "Flag",
                vec![
                    FieldDef::richtext("major_factions", "主要势力"),
                    FieldDef::richtext("faction_relations", "阵营关系"),
                    FieldDef::richtext("conflicts", "核心冲突"),
                ],
            ).desc("世界的政治势力与阵营对立"),
        ],
        default_enabled_modules: vec![
            "geography".to_string(),
            "history".to_string(),
        ],
    }
}

/// 奇幻世界观模板
fn worldview_fantasy_template() -> TemplateSchema {
    let mut template = worldview_standard_template();
    template.id = "world-fantasy".to_string();
    template.name = "奇幻世界观".to_string();
    template.description = "适用于玄幻/奇幻题材，强化魔法体系与种族设定".to_string();
    template.optional_modules.push(
        TemplateModule::new(
            "races",
            "种族设定",
            "Users",
            vec![
                FieldDef::richtext("major_races", "主要种族"),
                FieldDef::richtext("race_relations", "种族关系"),
                FieldDef::richtext("race_traits", "种族特性"),
            ],
        ).desc("世界中的种族分布与特性"),
    );
    template.default_enabled_modules.push("power_system".to_string());
    template.default_enabled_modules.push("races".to_string());
    template
}

// ===== 术语模板预设 =====

/// 标准术语模板
fn glossary_standard_template() -> TemplateSchema {
    TemplateSchema {
        id: "glossary-standard".to_string(),
        name: "标准术语".to_string(),
        category: "glossary".to_string(),
        description: "专有名词解释模板".to_string(),
        icon: "BookOpen".to_string(),
        base_fields: vec![
            FieldDef::text("term", "术语").required().placeholder("要解释的专有名词"),
            FieldDef::richtext("definition", "释义").required().placeholder("术语的含义解释"),
        ],
        optional_modules: vec![
            TemplateModule::new(
                "context",
                "使用场景",
                "MapPin",
                vec![
                    FieldDef::richtext("usage_context", "使用场景").placeholder("该术语在何种情境下使用"),
                ],
            ).desc("术语的使用场景与语境"),
            TemplateModule::new(
                "related",
                "相关条目",
                "Link",
                vec![
                    FieldDef::richtext("related_entries", "相关条目").placeholder("关联的其他术语或概念"),
                ],
            ).desc("与该术语相关的其他条目"),
            TemplateModule::new(
                "etymology",
                "词源考据",
                "History",
                vec![
                    FieldDef::richtext("origin", "词源"),
                    FieldDef::richtext("evolution", "含义演变"),
                ],
            ).desc("术语的词源与含义演变历史"),
        ],
        default_enabled_modules: vec![
            "context".to_string(),
            "related".to_string(),
        ],
    }
}

// ===== 大纲模板预设 =====

/// 标准大纲模板
fn outline_standard_template() -> TemplateSchema {
    TemplateSchema {
        id: "outline-standard".to_string(),
        name: "总体大纲".to_string(),
        category: "outline".to_string(),
        description: "故事总体大纲模板，包含梗概、主题、冲突、结构".to_string(),
        icon: "FileText".to_string(),
        base_fields: vec![
            FieldDef::richtext("logline", "一句话梗概").required().placeholder("用一句话概括故事核心"),
            FieldDef::richtext("theme", "主题立意").placeholder("故事想表达的核心思想"),
        ],
        optional_modules: vec![
            TemplateModule::new(
                "conflict",
                "冲突设定",
                "Swords",
                vec![
                    FieldDef::richtext("main_conflict", "主要冲突"),
                    FieldDef::richtext("character_motivations", "人物动机"),
                ],
            ).desc("故事的核心矛盾与角色动机"),
            TemplateModule::new(
                "structure",
                "情节结构",
                "List",
                vec![
                    FieldDef::richtext("plot_structure", "情节结构").placeholder("如：三幕式/英雄之旅/起承转合"),
                    FieldDef::richtext("act_breakdown", "分幕概要"),
                    FieldDef::richtext("ending", "结局走向"),
                ],
            ).desc("故事的情节组织与结构划分"),
            TemplateModule::new(
                "beats",
                "情节卡点",
                "Milestone",
                vec![
                    FieldDef::text("inciting_incident", "触发事件"),
                    FieldDef::text("first_turn", "第一转折"),
                    FieldDef::text("midpoint", "中点"),
                    FieldDef::text("second_turn", "第二转折"),
                    FieldDef::text("climax", "高潮"),
                    FieldDef::text("resolution", "结局"),
                ],
            ).desc("故事的关键情节节点"),
            TemplateModule::new(
                "character_arcs",
                "人物弧线",
                "TrendingUp",
                vec![
                    FieldDef::richtext("arc_summary", "弧线总览").placeholder("各角色的成长轨迹概要"),
                ],
            ).desc("主要角色的成长弧线规划"),
        ],
        default_enabled_modules: vec![
            "conflict".to_string(),
            "structure".to_string(),
        ],
    }
}

/// 章节大纲模板
fn outline_chapter_template() -> TemplateSchema {
    TemplateSchema {
        id: "outline-chapter".to_string(),
        name: "章节大纲".to_string(),
        category: "outline".to_string(),
        description: "单章大纲模板，用于规划具体章节内容".to_string(),
        icon: "FileText".to_string(),
        base_fields: vec![
            FieldDef::text("chapter_summary", "本章梗概").required().placeholder("这一章发生了什么"),
        ],
        optional_modules: vec![
            TemplateModule::new(
                "characters_scenes",
                "人物与场景",
                "Users",
                vec![
                    FieldDef::text("appearing_characters", "出场人物"),
                    FieldDef::text("scenes", "场景"),
                ],
            ).desc("本章的出场角色与场景设定"),
            TemplateModule::new(
                "plot_points",
                "情节要点",
                "List",
                vec![
                    FieldDef::richtext("key_points", "情节要点"),
                    FieldDef::text("foreshadowing_plant", "埋设伏笔"),
                    FieldDef::text("foreshadowing_payoff", "回收伏笔"),
                ],
            ).desc("本章的情节推进与伏笔安排"),
            TemplateModule::new(
                "target",
                "写作目标",
                "Target",
                vec![
                    FieldDef::text("word_target", "字数目标"),
                    FieldDef::text("emotional_tone", "情感基调"),
                ],
            ).desc("本章的字数与情感基调目标"),
        ],
        default_enabled_modules: vec![
            "plot_points".to_string(),
        ],
    }
}

// ===== 自定义模板管理（去硬编码：支持用户从文件系统加载/保存/删除模板）=====

/// 获取用户自定义模板目录
/// 路径：~/.novelforge/templates/
/// 输入: 无
/// 输出: 自定义模板目录路径，目录不存在时自动创建
/// 流程: 拼接用户主目录 + .novelforge/templates，若不存在则创建
fn get_custom_templates_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
    let dir = home.join(".novelforge").join("templates");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("创建模板目录失败: {}", e))?;
    }
    Ok(dir)
}

/// 从文件系统加载所有自定义模板
/// 输入: 无
/// 输出: 自定义模板列表（JSON 解析失败的单个文件会被跳过，不影响整体）
/// 流程: 遍历 ~/.novelforge/templates/*.json，逐个反序列化为 TemplateSchema
fn load_custom_templates() -> Vec<TemplateSchema> {
    let dir = match get_custom_templates_dir() {
        Ok(d) => d,
        Err(_) => return vec![],
    };

    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };

    let mut templates = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(template) = serde_json::from_str::<TemplateSchema>(&content) {
                    // 确保自定义模板 id 以 custom- 前缀标记，便于前端区分
                    let mut t = template;
                    if !t.id.starts_with("custom-") {
                        t.id = format!("custom-{}", t.id);
                    }
                    templates.push(t);
                }
            }
        }
    }
    templates
}

/// 合并内置模板与自定义模板
/// 输入: 无
/// 输出: 内置 + 自定义的完整模板列表
pub fn get_all_templates_merged() -> Vec<TemplateSchema> {
    let mut all = get_all_templates();
    all.extend(load_custom_templates());
    all
}

/// 按分类获取模板（合并内置与自定义）
pub fn get_templates_by_category_merged(category: &str) -> Vec<TemplateSchema> {
    get_all_templates_merged()
        .into_iter()
        .filter(|t| t.category == category)
        .collect()
}

/// 根据 ID 获取模板（合并内置与自定义）
pub fn get_template_by_id_merged(id: &str) -> Option<TemplateSchema> {
    get_all_templates_merged().into_iter().find(|t| t.id == id)
}

// ===== Tauri 命令 =====

/// 获取指定分类的模板列表（合并内置与自定义）
#[tauri::command]
pub fn get_templates(category: String) -> Vec<TemplateSchema> {
    get_templates_by_category_merged(&category)
}

/// 渲染指定模板为文本内容（支持内置与自定义模板）
#[tauri::command]
pub fn render_template(
    template_id: String,
    enabled_module_ids: Vec<String>,
    file_name: String,
) -> Result<String, String> {
    let template = get_template_by_id_merged(&template_id)
        .ok_or_else(|| format!("未找到模板: {}", template_id))?;
    render_template_with_modules_from_schema(&template, &enabled_module_ids, &file_name)
}

/// 根据模板结构体直接渲染文本（供自定义模板使用）
/// 输入:
///   template - 模板结构体
///   enabled_module_ids - 用户启用的模块 ID 列表
///   file_name - 文件名（用于标题）
/// 输出: 渲染后的模板文本字符串
fn render_template_with_modules_from_schema(
    template: &TemplateSchema,
    enabled_module_ids: &[String],
    file_name: &str,
) -> Result<String, String> {
    let title = file_name.trim_end_matches(".txt").trim();

    let mut sections: Vec<(String, Vec<&FieldDef>)> = Vec::new();

    // 基础信息区块（强制）
    sections.push(("基础信息".to_string(), template.base_fields.iter().collect()));

    // 启用的可选模块
    for module in &template.optional_modules {
        if enabled_module_ids.contains(&module.id) {
            sections.push((module.name.clone(), module.fields.iter().collect()));
        }
    }

    // 按区块生成文本，确保分行分列、排版清晰
    let mut output = String::new();
    output.push_str(title);
    output.push_str("\n\n");

    for (section_name, fields) in &sections {
        output.push('【');
        output.push_str(section_name);
        output.push_str("】\n");
        for field in fields {
            output.push_str(&field.label);
            output.push('：');
            if let Some(ref p) = field.placeholder {
                output.push_str(p);
            }
            output.push('\n');
        }
        output.push('\n');
    }

    Ok(output)
}

/// 保存自定义文件模板到文件系统
/// 输入:
///   template - 完整的模板结构体，id 不以 custom- 开头时会自动添加前缀
/// 输出: 保存成功后的模板 ID
/// 流程:
///   1. 校验模板 id 和 name 非空
///   2. 确保 id 以 custom- 前缀标记
///   3. 序列化为 JSON 写入 ~/.novelforge/templates/{id}.json
#[tauri::command]
pub fn save_custom_file_template(mut template: TemplateSchema) -> Result<String, String> {
    if template.id.trim().is_empty() {
        return Err("模板 ID 不能为空".to_string());
    }
    if template.name.trim().is_empty() {
        return Err("模板名称不能为空".to_string());
    }

    // 确保自定义模板 id 以 custom- 前缀标记
    if !template.id.starts_with("custom-") {
        template.id = format!("custom-{}", template.id);
    }

    let dir = get_custom_templates_dir()?;
    // 使用安全的文件名：去除前缀后只保留字母数字下划线连字符
    let safe_name = template.id
        .strip_prefix("custom-")
        .unwrap_or(&template.id)
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let file_path = dir.join(format!("{}.json", safe_name));

    let json = serde_json::to_string_pretty(&template)
        .map_err(|e| format!("序列化模板失败: {}", e))?;

    fs::write(&file_path, json).map_err(|e| format!("写入模板文件失败: {}", e))?;

    Ok(template.id)
}

/// 删除自定义文件模板
/// 输入:
///   template_id - 要删除的模板 ID（必须以 custom- 开头）
/// 输出: 成功返回被删除的模板 ID，失败返回错误信息
/// 流程:
///   1. 校验 id 以 custom- 开头（禁止删除内置模板）
///   2. 拼接文件路径并删除
#[tauri::command]
pub fn delete_custom_file_template(template_id: String) -> Result<String, String> {
    if !template_id.starts_with("custom-") {
        return Err("只能删除自定义模板（ID 必须以 custom- 开头）".to_string());
    }

    let dir = get_custom_templates_dir()?;
    let safe_name = template_id
        .strip_prefix("custom-")
        .unwrap_or(&template_id)
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let file_path = dir.join(format!("{}.json", safe_name));

    if !file_path.exists() {
        return Err(format!("模板文件不存在: {}", template_id));
    }

    fs::remove_file(&file_path).map_err(|e| format!("删除模板文件失败: {}", e))?;

    Ok(template_id)
}

/// 获取所有自定义文件模板列表
#[tauri::command]
pub fn list_custom_file_templates() -> Vec<TemplateSchema> {
    load_custom_templates()
}
