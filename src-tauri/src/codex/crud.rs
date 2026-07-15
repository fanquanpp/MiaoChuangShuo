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

use serde_json::Value;

use super::parser::{CodexEntity, CodexMeta, CodexMetaPatch, parse_codex_file, build_effective_codex_dirs};
use super::migration::{atomic_write_codex, migrate_codex_txt_to_pmd};
use crate::commands::read_project_meta;
use crate::error::AppError;
use crate::manifest::{find_chapter_paths_by_codex_id, purge_codex_from_manifest};

/// 扫描设定目录，返回所有结构化设定实体（支持 .pmd 与 .txt 自动迁移）
///
/// 输入: project_path 项目根目录绝对路径
/// 输出: Result<Vec<CodexEntity>, String> 实体列表（按类型分组后按名称排序）
/// 流程:
///   1. 读取 ProjectMeta.codex_dirs(Task 1.8),空时回退到 CODEX_DIRS 常量
///   2. 对每个存在的目录，扫描其下 .pmd 与 .txt 文件
///   3. .txt 文件自动迁移为 .pmd（一次性、透明、用户无感）
///   4. 解析每个 .pmd 文件的 front matter + ProseMirror JSON 正文
///   5. 返回结构化实体列表
#[tauri::command]
pub fn list_codex_entities(project_path: String) -> Result<Vec<CodexEntity>, String> {
    let root = PathBuf::from(&project_path);
    let mut entities = Vec::new();

    // Task 1.8: 优先使用 ProjectMeta.codex_dirs 配置,ProjectMeta 读取失败或字段为空时回退到默认 CODEX_DIRS
    let codex_dirs_from_meta = read_project_meta(&root)
        .map(|meta| meta.codex_dirs)
        .unwrap_or_default();
    let effective_dirs = build_effective_codex_dirs(&codex_dirs_from_meta);

    for (dir_name, fallback_type) in &effective_dirs {
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
///   1. 读取 ProjectMeta.codex_dirs(Task 1.8),空时回退到默认 CODEX_DIRS
///   2. 扫描所有兼容目录下的 .txt 文件
///   3. 对无 front matter 的文件，解析旧格式并注入 front matter
///   4. 原子写入（先写 .tmp 再 rename）
#[tauri::command]
pub fn inject_codex_front_matter(project_path: String) -> Result<u32, String> {
    let root = PathBuf::from(&project_path);
    let mut count = 0u32;

    // Task 1.8: 优先使用 ProjectMeta.codex_dirs 配置
    let codex_dirs_from_meta = read_project_meta(&root)
        .map(|meta| meta.codex_dirs)
        .unwrap_or_default();
    let effective_dirs = build_effective_codex_dirs(&codex_dirs_from_meta);

    for (dir_name, fallback_type) in &effective_dirs {
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

// ===== Task 4.4: 设定库删除卡片时自动清理 Mention =====

/// 分离 .pmd 文件的 JSON front matter 与 ProseMirror JSON 正文(Task 4.4 内部辅助)
///
/// 输入: content .pmd 文件完整内容
/// 输出: Option<(front_matter_block, body)> 返回 (front matter 完整块含首尾 ---, ProseMirror JSON 正文)
///       无 front matter 时返回 None
/// 流程:
///   1. 检测首行是否为 "---"
///   2. 查找下一个 "---" 作为结束标记
///   3. 返回从首行到结束标记(含)的完整块 与 结束标记后的正文
/// 设计说明:
///   - 保留 front matter 原始文本(而非解析为 CodexMeta 后重新序列化),
///     避免因 CodexMeta 字段缺失导致 front matter 信息丢失
///   - body 部分按原格式返回,不进行 trim_start 以保留可能的格式约定
fn separate_pmd_front_matter(content: &str) -> Option<(String, String)> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() < 3 || lines[0].trim() != "---" {
        return None;
    }
    // 查找结束标记 ---
    let end_idx = lines[1..]
        .iter()
        .position(|l| l.trim() == "---")
        .map(|i| i + 1)?;
    let front_matter = lines[..=end_idx].join("\n");
    let body = lines[end_idx + 1..].join("\n");
    Some((front_matter, body))
}

/// 递归移除 ProseMirror JSON 中匹配 codexId 的 characterMentionNode(Task 4.4 内部辅助)
///
/// 输入:
///   node - ProseMirror 节点的 JSON Value(可变引用)
///   codex_id - 待移除的设定卡片 UUID
/// 输出: u64 本次调用替换的 Mention 节点数量(递归累加)
/// 流程:
///   1. 若 node 是 characterMentionNode 且 attrs.characterId == codex_id:
///      - 将节点替换为包含 attrs.name 文本的 text 节点
///      - 返回 1 表示替换了一处
///   2. 若 node 含 content 数组,递归处理每个子节点
///   3. 替换策略:保留 mention 的文本内容(name 字段),避免正文语义丢失
/// 设计说明:
///   - 使用 Value::Object 可变引用直接修改节点字段,实现就地替换
///   - content 数组中的元素替换通过索引赋值完成
fn remove_mentions_in_node(node: &mut Value, codex_id: &str) -> u64 {
    let mut count: u64 = 0;

    // 检查当前节点是否为匹配的 characterMentionNode
    if let Some(obj) = node.as_object() {
        let node_type = obj.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if node_type == "characterMentionNode" {
            let attrs_match = obj
                .get("attrs")
                .and_then(|a| a.get("characterId"))
                .and_then(|c| c.as_str())
                .map(|id| id == codex_id)
                .unwrap_or(false);
            if attrs_match {
                // 提取 mention 的 name 字段作为保留文本
                let name = obj
                    .get("attrs")
                    .and_then(|a| a.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                // 替换为 text 节点,保留原文不丢内容
                *node = serde_json::json!({
                    "type": "text",
                    "text": name
                });
                count += 1;
                return count;
            }
        }
    }

    // 递归处理 content 数组中的子节点
    if let Some(content) = node.get_mut("content").and_then(|c| c.as_array_mut()) {
        for child in content.iter_mut() {
            count += remove_mentions_in_node(child, codex_id);
        }
    }

    count
}

/// 移除正文章节中引用指定 codexId 的 Mention 节点(Task 4.4.2)
///
/// 输入:
///   project_path - 项目根目录路径
///   chapter_paths - 待清理的章节文件相对路径列表(相对项目根,正斜杠格式)
///   codex_id - 设定库卡片 UUID
/// 输出: Result<u32, AppError> 实际清理的 Mention 节点总数
/// 流程:
///   1. 校验项目路径
///   2. 遍历每个 chapter_path:
///      a. 拼接绝对路径并校验存在性
///      b. 读取 .pmd 文件内容
///      c. 分离 front matter 与 ProseMirror JSON 正文
///      d. 解析正文为 JSON Value,递归移除匹配的 characterMentionNode
///      e. 重新序列化 JSON,组合 front matter + 新正文,原子写入
///   3. 累加返回清理总数
/// 设计说明:
///   - 无 front matter 的章节文件(旧版 .txt)直接跳过,不进行 Mention 清理
///   - body 部分非合法 JSON 时跳过该文件,记录日志不阻断整体流程
///   - 原子写入保证清理过程中断不会损坏文件
#[tauri::command]
pub fn remove_mentions_from_chapters(
    project_path: String,
    chapter_paths: Vec<String>,
    codex_id: String,
) -> Result<u32, AppError> {
    let root = crate::commands::validate_project_path(&project_path)?;

    let mut total_removed: u32 = 0;
    for chapter_rel in &chapter_paths {
        // 路径穿越校验:禁止 .. 与绝对路径
        if chapter_rel.contains("..") || chapter_rel.starts_with('/') {
            return Err(AppError::path_validation_error(format!(
                "非法的章节路径: {}",
                chapter_rel
            )));
        }
        let chapter_abs = root.join(chapter_rel);
        if !chapter_abs.exists() {
            // 章节文件不存在(可能已被删除),跳过不阻断
            continue;
        }

        let content = match fs::read_to_string(&chapter_abs) {
            Ok(c) => c,
            Err(e) => {
                eprintln!(
                    "[codex] 警告: 读取章节文件失败 {}: {}",
                    chapter_abs.display(),
                    e
                );
                continue;
            }
        };

        // 分离 front matter 与 ProseMirror JSON 正文
        let (front_matter, body) = match separate_pmd_front_matter(&content) {
            Some(parts) => parts,
            None => {
                // 无 front matter,可能是旧版 .txt 或纯 JSON,跳过 front matter 保留
                // 直接将整个内容作为 body 处理
                (String::new(), content.clone())
            }
        };

        // 解析 body 为 JSON Value
        let mut doc: Value = match serde_json::from_str(&body) {
            Ok(v) => v,
            Err(e) => {
                eprintln!(
                    "[codex] 警告: 章节 {} 正文非合法 ProseMirror JSON,跳过: {}",
                    chapter_rel,
                    e
                );
                continue;
            }
        };

        // 递归移除匹配的 characterMentionNode
        let removed = remove_mentions_in_node(&mut doc, &codex_id);
        if removed == 0 {
            // 该章节无匹配 Mention,跳过写回避免无谓 IO
            continue;
        }
        total_removed += removed as u32;

        // 重新序列化为 JSON 字符串(紧凑格式,与项目其他 .pmd 文件保持一致)
        let new_body = serde_json::to_string(&doc)
            .map_err(|e| AppError::serialize_error(e, "序列化 ProseMirror JSON 失败"))?;

        // 组合 front matter + 新正文,原子写入
        let new_content = if front_matter.is_empty() {
            new_body
        } else {
            format!("{}\n{}", front_matter, new_body)
        };

        atomic_write_codex(&chapter_abs, &new_content).map_err(AppError::from)?;
    }

    Ok(total_removed)
}

/// 删除设定库卡片并联动清理 Mention 引用(Task 4.4.1)
///
/// 输入:
///   project_path - 项目根目录路径
///   source_file - 卡片文件相对路径(如 "角色/亚瑟.pmd")
/// 输出: Result<u32, AppError> 实际清理的 Mention 节点总数(供前端提示)
/// 流程:
///   1. 校验项目路径与 source_file 合法性
///   2. 拼接卡片绝对路径并校验存在性
///   3. 读取 .pmd 文件 front matter 获取 codex_id(UUID)
///   4. 通过 manifest 反向索引查找引用该 codexId 的章节文件路径列表
///   5. 调用 remove_mentions_from_chapters 清理这些章节的 Mention 节点
///   6. 删除卡片文件(移至系统回收站,可恢复)
///   7. 调用 purge_codex_from_manifest 清理 manifest 中的 codex 实体与反向索引
/// 设计说明:
///   - 文件删除使用 trash::delete 移至回收站,与 delete_path 命令保持一致策略
///   - codex_id 缺失时仅清理 source_file 匹配的 manifest 记录,跳过 Mention 清理
///   - 任一步骤失败立即返回错误,保证数据一致性
#[tauri::command]
pub fn delete_codex_entity(
    project_path: String,
    source_file: String,
) -> Result<u32, AppError> {
    let root = crate::commands::validate_project_path(&project_path)?;

    // 安全校验:source_file 必须为相对路径,禁止路径穿越
    if source_file.contains("..") || source_file.starts_with('/') || source_file.contains(':') {
        return Err(AppError::path_validation_error("非法的来源文件路径"));
    }

    let card_abs = root.join(&source_file);
    if !card_abs.exists() {
        return Err(AppError::path_validation_error(format!(
            "设定文件不存在: {}",
            source_file
        )));
    }

    // 读取卡片 front matter 获取 codex_id
    let content = fs::read_to_string(&card_abs)
        .map_err(|e| AppError::io_error(e, "读取设定文件失败"))?;
    let file_name = card_abs
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let (meta, _body) = parse_codex_file(&content, &file_name, "unknown");
    let codex_id = meta.id.clone();

    // 通过 manifest 反向索引查找引用该 codexId 的章节路径列表
    let chapter_paths = if codex_id.is_empty() {
        Vec::new()
    } else {
        find_chapter_paths_by_codex_id(&root, &codex_id).unwrap_or_default()
    };

    // 清理章节中的 Mention 节点
    let mut removed_mentions: u32 = 0;
    if !chapter_paths.is_empty() && !codex_id.is_empty() {
        removed_mentions = remove_mentions_from_chapters(
            project_path.clone(),
            chapter_paths.clone(),
            codex_id.clone(),
        )?;
    }

    // 删除卡片文件(优先 trash 移至回收站,失败时回退到永久删除)
    if let Err(e) = trash::delete(&card_abs) {
        eprintln!(
            "[codex] 警告: 移至回收站失败 {}: {},回退到永久删除",
            card_abs.display(),
            e
        );
        fs::remove_file(&card_abs)
            .map_err(|err| AppError::io_error(err, "删除设定文件失败"))?;
    }

    // 清理 manifest 中的 codex 实体记录与反向索引
    if !codex_id.is_empty() {
        purge_codex_from_manifest(&root, &codex_id, &source_file)?;
    }

    Ok(removed_mentions)
}

/// AppError 与 String 错误的转换trait(供 atomic_write_codex 的 String 错误转换)
impl From<String> for AppError {
    fn from(err: String) -> Self {
        AppError::config_error(err)
    }
}
