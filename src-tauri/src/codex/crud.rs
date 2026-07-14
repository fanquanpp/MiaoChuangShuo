// 智能设定库（Codex）- CRUD 子模块
//
// 功能概述：
// 提供设定实体的增删改查能力，支持 .pmd 与 .txt 自动迁移。
//
// 模块职责：
// 1. 扫描设定目录返回结构化实体列表（支持 .pmd 与 .txt 自动迁移）
// 2. 更新单个设定卡片的元数据与正文（.pmd 文件）
// 3. 为旧版设定文件注入 JSON front matter（迁移命令）
//
// 设计说明：
//   - .txt 文件在扫描时自动迁移为 .pmd（一次性、透明、用户无感）
//   - name 变更时文件重命名由后端统一处理，前端无需关心文件路径变化
//   - 原子写入保证更新过程中断不会损坏文件

use std::fs;
use std::path::PathBuf;

use super::parser::{CodexEntity, CodexMeta, CodexMetaPatch, CODEX_DIRS, parse_codex_file};
use super::migration::{atomic_write_codex, migrate_codex_txt_to_pmd};

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
