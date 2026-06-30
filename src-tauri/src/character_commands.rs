// 角色与正文的联动模块
//
// 功能概述：
// 提供"角色 ↔ 正文"双向数据联动能力，是 NovelForge 模块联动的核心组成。
// 包含两个高价值能力：
// 1. 角色出场统计：扫描项目内所有 .txt 文件，统计每个角色名的出现次数与分布
// 2. 全局改名：在项目所有 .txt 文件中批量替换角色名，解决作家改名时的痛苦
//
// 模块职责：
// 1. 递归扫描项目内 .txt 文件（跳过 .novelforge 元数据目录）
// 2. 统计角色名出现次数，返回按文件分布的详细数据
// 3. 批量替换角色名，返回修改文件数与替换次数
// 4. 全程路径沙箱内操作，确保不越界

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// 单个文件中角色出场统计
#[derive(Debug, Clone, Serialize)]
pub struct AppearanceFile {
    /// 相对项目根的路径
    pub path: String,
    /// 该文件中出现次数
    pub count: u64,
    /// 是否位于"正文"目录
    pub is_manuscript: bool,
}

/// 单个角色的出场统计汇总
#[derive(Debug, Clone, Serialize)]
pub struct CharacterAppearance {
    /// 角色名
    pub name: String,
    /// 总出现次数
    pub total_count: u64,
    /// 出现在的文件数
    pub file_count: u64,
    /// 出现的文件列表（按出现次数降序）
    pub files: Vec<AppearanceFile>,
}

/// 全局改名结果
#[derive(Debug, Clone, Serialize)]
pub struct RenameResult {
    /// 修改的文件数
    pub files_modified: u64,
    /// 替换的总次数
    pub occurrences: u64,
    /// 修改的文件相对路径列表
    pub renamed_files: Vec<String>,
}

/**
 * 递归收集项目内所有 .txt 文件路径
 * 输入: dir 当前目录, project_root 项目根目录, files 输出列表
 * 流程:
 *   1. 读取目录条目
 *   2. 跳过 .novelforge 等隐藏目录
 *   3. 子目录递归处理
 *   4. .txt 文件加入列表
 */
fn collect_txt_files(dir: &Path, files: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // 跳过 .novelforge 等以点开头的隐藏/元数据目录
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if name.starts_with('.') {
                continue;
            }
            collect_txt_files(&path, files);
        } else if path.extension().map(|e| e == "txt").unwrap_or(false) {
            files.push(path);
        }
    }
}

/**
 * 判断文件路径是否位于"正文"目录下
 * 输入: relative_path 相对项目根的路径
 * 输出: 是否在正文目录
 */
fn is_manuscript_file(relative_path: &str) -> bool {
    let normalized = relative_path.replace('\\', "/");
    normalized.starts_with("正文/") || normalized == "正文"
}

/**
 * 统计角色在项目所有 .txt 文件中的出场情况
 * 输入: project_path 项目根路径, names 待统计的角色名列表
 * 输出: Result<Vec<CharacterAppearance>, String> 每个角色的出场统计
 * 流程:
 *   1. canonicalize 项目根路径
 *   2. 递归收集所有 .txt 文件
 *   3. 读取每个文件内容，统计每个角色名出现次数
 *   4. 按角色汇总，返回按总次数降序的结果
 */
#[tauri::command]
pub fn count_character_appearances(
    project_path: String,
    names: Vec<String>,
) -> Result<Vec<CharacterAppearance>, String> {
    let root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;

    if !root.exists() || !root.is_dir() {
        return Err("项目路径不存在或不是目录".to_string());
    }

    // 过滤空角色名，避免误匹配
    let valid_names: Vec<String> = names
        .into_iter()
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .collect();
    if valid_names.is_empty() {
        return Ok(Vec::new());
    }

    // 收集所有 .txt 文件
    let mut txt_files: Vec<PathBuf> = Vec::new();
    collect_txt_files(&root, &mut txt_files);

    // 初始化每个角色的统计
    let mut appearances: Vec<CharacterAppearance> = valid_names
        .iter()
        .map(|name| CharacterAppearance {
            name: name.clone(),
            total_count: 0,
            file_count: 0,
            files: Vec::new(),
        })
        .collect();

    // 遍历文件统计
    for file_path in &txt_files {
        let content = match fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => continue, // 跳过无法读取的文件（如编码问题）
        };

        // 计算相对路径
        let relative = file_path
            .strip_prefix(&root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let is_mscript = is_manuscript_file(&relative);

        for (idx, name) in valid_names.iter().enumerate() {
            let count = content.matches(name.as_str()).count() as u64;
            if count > 0 {
                appearances[idx].total_count += count;
                appearances[idx].file_count += 1;
                appearances[idx].files.push(AppearanceFile {
                    path: relative.clone(),
                    count,
                    is_manuscript: is_mscript,
                });
            }
        }
    }

    // 每个角色的文件列表按出现次数降序
    for app in &mut appearances {
        app.files.sort_by_key(|f| std::cmp::Reverse(f.count));
    }

    // 角色按总出场次数降序
    appearances.sort_by_key(|a| std::cmp::Reverse(a.total_count));

    Ok(appearances)
}

/**
 * 在项目所有 .txt 文件中全局替换角色名
 * 输入: project_path 项目根路径, old_name 旧角色名, new_name 新角色名
 * 输出: Result<RenameResult, String> 修改文件数与替换次数
 * 流程:
 *   1. 校验新旧名称非空且不同
 *   2. canonicalize 项目根路径
 *   3. 递归收集所有 .txt 文件
 *   4. 逐文件读取、替换、写回（仅在有变更时写入）
 *   5. 返回修改的文件列表与替换总次数
 * 安全说明: 替换为简单字符串替换，存在子串误伤风险（如"林"会误伤"林中"），
 *   建议前端提示作者改名前先保存以创建版本快照，便于回滚
 */
#[tauri::command]
pub fn rename_character_in_project(
    project_path: String,
    old_name: String,
    new_name: String,
) -> Result<RenameResult, String> {
    let old_name = old_name.trim().to_string();
    let new_name = new_name.trim().to_string();

    if old_name.is_empty() {
        return Err("原角色名不能为空".to_string());
    }
    if new_name.is_empty() {
        return Err("新角色名不能为空".to_string());
    }
    if old_name == new_name {
        return Err("新旧角色名相同，无需修改".to_string());
    }

    let root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;

    if !root.exists() || !root.is_dir() {
        return Err("项目路径不存在或不是目录".to_string());
    }

    // 收集所有 .txt 文件
    let mut txt_files: Vec<PathBuf> = Vec::new();
    collect_txt_files(&root, &mut txt_files);

    let mut files_modified: u64 = 0;
    let mut occurrences: u64 = 0;
    let mut renamed_files: Vec<String> = Vec::new();

    for file_path in &txt_files {
        let content = match fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // 统计替换次数
        let count = content.matches(old_name.as_str()).count() as u64;
        if count == 0 {
            continue;
        }

        let new_content = content.replace(old_name.as_str(), new_name.as_str());

        // 写回文件
        if let Err(e) = fs::write(file_path, &new_content) {
            // 写入失败立即返回错误，中断整体流程（保证数据一致性）
            let relative = file_path
                .strip_prefix(&root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            return Err(format!("写入文件失败 {}: {}", relative, e));
        }

        let relative = file_path
            .strip_prefix(&root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();

        files_modified += 1;
        occurrences += count;
        renamed_files.push(relative);
    }

    Ok(RenameResult {
        files_modified,
        occurrences,
        renamed_files,
    })
}

/**
 * 角色摘要信息结构
 * 用于正文悬停卡片，展示角色的关键设定
 */
#[derive(Debug, Clone, Serialize)]
pub struct CharacterSummary {
    /// 角色名
    pub name: String,
    /// 角色设定文件相对路径
    pub source_file: String,
    /// 身份/职业（从【基础信息】提取）
    pub identity: String,
    /// 核心特质（从【性格】提取）
    pub personality: String,
    /// 一句话简介（从设定文件首段提取）
    pub brief: String,
    /// 是否找到角色设定文件
    pub found: bool,
}

/**
 * 读取指定角色的摘要信息
 * 输入: project_path 项目根路径, character_name 角色名
 * 输出: Result<CharacterSummary, String> 角色摘要
 * 流程:
 *   1. 扫描角色目录下所有 .txt 文件
 *   2. 检查每个文件首行是否匹配角色名
 *   3. 匹配成功则解析身份、性格、简介字段
 *   4. 未匹配则返回 found=false 的空摘要
 */
#[tauri::command]
pub fn read_character_summary(
    project_path: String,
    character_name: String,
) -> Result<CharacterSummary, String> {
    let root = PathBuf::from(&project_path)
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {}", e))?;

    if !root.exists() || !root.is_dir() {
        return Err("项目路径不存在或不是目录".to_string());
    }

    let name = character_name.trim().to_string();
    if name.is_empty() {
        return Err("角色名不能为空".to_string());
    }

    let char_dir = root.join("角色");
    if !char_dir.exists() {
        return Ok(CharacterSummary {
            name: name.clone(),
            source_file: String::new(),
            identity: String::new(),
            personality: String::new(),
            brief: String::new(),
            found: false,
        });
    }

    // 遍历角色目录，查找首行匹配角色名的文件
    let entries = fs::read_dir(&char_dir)
        .map_err(|e| format!("读取角色目录失败: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() || path.extension().map(|e| e != "txt").unwrap_or(true) {
            continue;
        }
        let file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let lower = file_name.to_lowercase();
        if lower.contains("模板") || lower.contains("名册") ||
           lower.contains("template") || lower.contains("roster") ||
           lower.contains("readme") || lower.contains("汇总") || lower.contains("关系表") {
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // 检查首行是否为该角色名（跳过注释行和分隔线）
        let first_line = content.lines()
            .map(|l| l.trim())
            .find(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("---") && !l.starts_with("==="));

        if first_line != Some(name.as_str()) {
            continue;
        }

        // 匹配成功，解析摘要字段
        let relative = path
            .strip_prefix(&root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();

        let identity = extract_field(&content, &["身份", "职业", "身份/职业"]);
        let personality = extract_field(&content, &["核心特质", "性格", "性格关键词"]);
        let brief = extract_brief(&content, &name);

        return Ok(CharacterSummary {
            name: name.clone(),
            source_file: relative,
            identity,
            personality,
            brief,
            found: true,
        });
    }

    // 未找到匹配的角色设定文件
    Ok(CharacterSummary {
        name: name.clone(),
        source_file: String::new(),
        identity: String::new(),
        personality: String::new(),
        brief: String::new(),
        found: false,
    })
}

/**
 * 从角色设定文件内容中提取指定字段的值
 * 输入: content 文件内容, field_names 可能的字段名列表（按优先级）
 * 输出: 字段值（去除前缀后的纯文本）
 * 流程:
 *   1. 遍历每一行，查找以"字段名："或"字段名:"开头的行
 *   2. 返回第一个匹配的字段值
 */
fn extract_field(content: &str, field_names: &[&str]) -> String {
    for line in content.lines() {
        let trimmed = line.trim();
        for field in field_names {
            // 匹配 "字段：" 或 "字段:" 格式（支持全角/半角冒号）
            let prefix_colon = format!("{}：", field);
            let prefix_colon_half = format!("{}:", field);
            let prefix_bracket = format!("【{}", field);
            if trimmed.starts_with(&prefix_colon) {
                return trimmed[prefix_colon.len()..].trim().to_string();
            }
            if trimmed.starts_with(&prefix_colon_half) {
                return trimmed[prefix_colon_half.len()..].trim().to_string();
            }
            // 匹配 【字段】 后跟值的格式
            if trimmed.starts_with(&prefix_bracket) {
                // 整行作为字段标题，下一行可能是值，这里跳过
                continue;
            }
        }
    }
    // 对于【字段】格式，查找紧跟的下一行值
    let lines: Vec<&str> = content.lines().collect();
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        for field in field_names {
            let bracket = format!("【{}】", field);
            if trimmed == bracket && i + 1 < lines.len() {
                let val = lines[i + 1].trim();
                if !val.is_empty() && !val.starts_with('【') {
                    return val.to_string();
                }
            }
        }
    }
    String::new()
}

/**
 * 从角色设定文件内容中提取一句话简介
 * 输入: content 文件内容, name 角色名
 * 输出: 简介文本（取设定文件中第一段非标题、非字段标记的描述性文字）
 */
fn extract_brief(content: &str, _name: &str) -> String {
    let mut in_section = false;
    let mut brief_parts: Vec<String> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        // 跳过空行
        if trimmed.is_empty() {
            continue;
        }
        // 跳过标题行（首行已作为角色名）
        // 跳过字段标记行
        if trimmed.starts_with('【') {
            in_section = true;
            continue;
        }
        // 跳过字段值行（含冒号的视为字段值）
        if in_section && (trimmed.contains('：') || trimmed.contains(':')) {
            continue;
        }
        // 跳过分隔线
        if trimmed.starts_with("---") || trimmed.starts_with("===") {
            continue;
        }
        // 收集描述性文字
        if in_section {
            brief_parts.push(trimmed.to_string());
            if brief_parts.len() >= 2 {
                break;
            }
        }
    }

    brief_parts.join(" ")
}
