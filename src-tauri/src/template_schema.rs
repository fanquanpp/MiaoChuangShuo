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
// 5. 通过 include_str! 宏在编译时嵌入 10 个预设 TOML 模板，运行时解析加载
// 6. 提供 get_templates / render_template / 自定义模板 CRUD 命令（内置+自定义模板合并查询）
//
// 数据外置说明：
// 10 个预设模板原硬编码于本文件，现已迁移至 src-tauri/templates/*.toml。
// 编译时通过 include_str! 嵌入二进制，避免运行时文件依赖；
// 同时保留 verify_template_integrity() 函数用于完整性自检（便于排查编译期遗漏）。

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

// ===== 完整模板结构 =====

/// 完整模板定义
/// 由基础字段 + 可选模块组成，用户创建文件时选择模板并勾选模块
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateSchema {
    /// 模板唯一标识
    pub id: String,
    /// 模板显示名
    pub name: String,
    /// 模板所属分类（character/worldview/glossary/outline）
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

// ===== 预设模板加载器（外置 TOML 数据，编译期嵌入）=====

/// 预设模板清单
/// 列出 10 个内置模板的标识与编译期嵌入的 TOML 内容
/// 任何新增/删除/重命名预设模板都需同步更新本清单
const PRESET_TEMPLATES: &[(&str, &str)] = &[
    // (模板文件名, 编译期嵌入的 TOML 字符串)
    ("character_standard.toml", include_str!("../templates/character_standard.toml")),
    ("character_fantasy.toml", include_str!("../templates/character_fantasy.toml")),
    ("character_scifi.toml", include_str!("../templates/character_scifi.toml")),
    ("character_romance.toml", include_str!("../templates/character_romance.toml")),
    ("character_mystery.toml", include_str!("../templates/character_mystery.toml")),
    ("worldview_standard.toml", include_str!("../templates/worldview_standard.toml")),
    ("worldview_fantasy.toml", include_str!("../templates/worldview_fantasy.toml")),
    ("glossary_standard.toml", include_str!("../templates/glossary_standard.toml")),
    ("outline_standard.toml", include_str!("../templates/outline_standard.toml")),
    ("outline_chapter.toml", include_str!("../templates/outline_chapter.toml")),
];

/// 验证预设模板完整性
/// 在加载前对编译期嵌入的 TOML 数据进行自检：
/// 1. 检查清单数量是否为 10
/// 2. 逐个解析每个 TOML 字符串，确认格式合法
/// 3. 任何解析失败返回错误信息，便于开发者定位遗漏
/// 输入: 无
/// 输出: 成功返回 Ok(()), 失败返回错误描述字符串
/// 流程: 遍历 PRESET_TEMPLATES, 逐个 toml::from_str 解析校验
fn verify_template_integrity() -> Result<(), String> {
    // 完整性约束 1: 预设模板数量必须为 10
    const EXPECTED_PRESET_COUNT: usize = 10;
    if PRESET_TEMPLATES.len() != EXPECTED_PRESET_COUNT {
        return Err(format!(
            "预设模板数量异常：期望 {} 个，实际 {} 个",
            EXPECTED_PRESET_COUNT,
            PRESET_TEMPLATES.len()
        ));
    }

    // 完整性约束 2: 逐个解析 TOML 内容，确认格式合法且能反序列化为 TemplateSchema
    for (file_name, toml_content) in PRESET_TEMPLATES {
        match toml::from_str::<TemplateSchema>(toml_content) {
            Ok(_) => continue,
            Err(e) => {
                return Err(format!(
                    "预设模板 [{}] 解析失败: {}",
                    file_name, e
                ));
            }
        }
    }

    Ok(())
}

/// 加载所有预设模板
/// 输入: 无
/// 输出: 预设模板列表（按 PRESET_TEMPLATES 顺序）
/// 流程:
///   1. 调用 verify_template_integrity() 自检
///   2. 自检失败则记录错误日志并返回空列表（不阻塞应用启动）
///   3. 逐个解析 TOML 并收集为 TemplateSchema 列表
/// 注意:
///   - 自检失败仅记录日志不 panic，避免影响应用启动
///   - 单个模板解析失败时跳过该模板，其余模板仍正常加载
fn load_preset_templates() -> Vec<TemplateSchema> {
    // 编译期嵌入的 TOML 数据理论上不会解析失败，但运行时仍做防御性校验
    if let Err(e) = verify_template_integrity() {
        eprintln!("[template_schema] 预设模板完整性校验失败: {}", e);
        return Vec::new();
    }

    let mut templates = Vec::with_capacity(PRESET_TEMPLATES.len());
    for (file_name, toml_content) in PRESET_TEMPLATES {
        match toml::from_str::<TemplateSchema>(toml_content) {
            Ok(template) => templates.push(template),
            Err(e) => {
                // 单个模板解析失败：记录错误日志并跳过，不影响其他模板加载
                eprintln!(
                    "[template_schema] 预设模板 [{}] 解析失败: {}",
                    file_name, e
                );
            }
        }
    }
    templates
}

/// 获取所有预设模板
/// 返回按 PRESET_TEMPLATES 顺序组织的模板列表
pub fn get_all_templates() -> Vec<TemplateSchema> {
    load_preset_templates()
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

// ===== 单元测试 =====

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试预设模板完整性校验通过
    /// 验证 10 个 TOML 模板均能正确解析
    #[test]
    fn test_verify_template_integrity_pass() {
        assert!(
            verify_template_integrity().is_ok(),
            "预设模板完整性校验应通过"
        );
    }

    /// 测试加载预设模板返回 10 个模板
    #[test]
    fn test_load_preset_templates_count() {
        let templates = load_preset_templates();
        assert_eq!(
            templates.len(),
            10,
            "应加载 10 个预设模板，实际: {}",
            templates.len()
        );
    }

    /// 测试所有预设模板 id 不为空且唯一
    #[test]
    fn test_preset_template_ids_unique() {
        let templates = load_preset_templates();
        let mut ids: Vec<&str> = templates.iter().map(|t| t.id.as_str()).collect();
        ids.sort();
        let original_len = ids.len();
        ids.dedup();
        assert_eq!(
            ids.len(),
            original_len,
            "预设模板 id 不应重复"
        );
    }

    /// 测试所有预设模板的关键字段完整性
    /// - id/name/category/description/icon 非空
    /// - base_fields 至少 1 个
    #[test]
    fn test_preset_template_fields_complete() {
        let templates = load_preset_templates();
        assert!(!templates.is_empty(), "预设模板列表不应为空");
        for t in &templates {
            assert!(!t.id.is_empty(), "模板 id 不应为空");
            assert!(!t.name.is_empty(), "模板 name 不应为空");
            assert!(!t.category.is_empty(), "模板 category 不应为空");
            assert!(!t.description.is_empty(), "模板 description 不应为空");
            assert!(!t.icon.is_empty(), "模板 icon 不应为空");
            assert!(
                !t.base_fields.is_empty(),
                "模板 [{}] base_fields 不应为空",
                t.id
            );
        }
    }

    /// 测试按分类查询模板
    #[test]
    fn test_get_templates_by_category() {
        let character_templates = get_templates_by_category_merged("character");
        assert_eq!(
            character_templates.len(),
            5,
            "角色分类应有 5 个预设模板"
        );

        let worldview_templates = get_templates_by_category_merged("worldview");
        assert_eq!(
            worldview_templates.len(),
            2,
            "世界观分类应有 2 个预设模板"
        );

        let glossary_templates = get_templates_by_category_merged("glossary");
        assert_eq!(
            glossary_templates.len(),
            1,
            "术语分类应有 1 个预设模板"
        );

        let outline_templates = get_templates_by_category_merged("outline");
        assert_eq!(
            outline_templates.len(),
            2,
            "大纲分类应有 2 个预设模板"
        );
    }

    /// 测试按 id 查询模板
    #[test]
    fn test_get_template_by_id() {
        let template = get_template_by_id_merged("char-standard");
        assert!(template.is_some(), "应能查到 char-standard 模板");
        let t = template.unwrap();
        assert_eq!(t.name, "标准角色");
        assert_eq!(t.category, "character");
    }

    /// 测试派生模板（character_fantasy）的字段累积正确
    /// character_fantasy 应继承 character_standard 的全部基础字段与模块
    /// 并扩展 race/class 基础字段与 magic_system/combat 模块
    #[test]
    fn test_fantasy_template_extension() {
        let template = get_template_by_id_merged("char-fantasy").expect("char-fantasy 应存在");
        // 基础字段应为 7 个：标准 5 个 + race + class
        assert_eq!(
            template.base_fields.len(),
            7,
            "奇幻角色基础字段应为 7 个"
        );
        // 可选模块应为 8 个：标准 6 个 + magic_system + combat
        assert_eq!(
            template.optional_modules.len(),
            8,
            "奇幻角色可选模块应为 8 个"
        );
        // 默认启用模块应包含 magic_system
        assert!(
            template.default_enabled_modules.contains(&"magic_system".to_string()),
            "奇幻角色默认应启用 magic_system 模块"
        );
    }

    /// 测试模板渲染功能
    #[test]
    fn test_render_template() {
        let result = render_template(
            "char-standard".to_string(),
            vec!["personality".to_string()],
            "测试角色.txt".to_string(),
        );
        assert!(result.is_ok(), "模板渲染应成功");
        let content = result.unwrap();
        assert!(content.contains("测试角色"), "渲染结果应包含文件名");
        assert!(content.contains("【基础信息】"), "渲染结果应包含基础信息区块");
        assert!(content.contains("【性格档案】"), "渲染结果应包含性格档案区块");
        assert!(content.contains("姓名"), "渲染结果应包含姓名字段");
    }
}
