// 项目级 manifest.json 统一索引模块
//
// 功能概述：
// 维护项目内所有数据实体(章节/大纲/设定库/图谱节点/时间线节点/伏笔)的
// UUID 与 sourceFile 映射,以及反向索引(codexId → graphNodeIds /
// codexId → chapterIds / chapterId → timelineNodeIds),作为后续数据孤岛
// 优化(章节删除联动清理、设定库卡片清理 Mention 等)的基础设施。
//
// 模块职责：
// 1. 定义 Manifest / ManifestEntity / ManifestEntities / ReverseIndex 结构体
// 2. 提供 load_manifest / save_manifest 原子读写函数
// 3. 提供 register_entity / unregister_entity 实体增删函数
// 4. 提供 update_reverse_index 反向索引维护函数
// 5. 提供 try_register_chapter / try_unregister_by_source_file /
//    try_rename_source_file 三个"忽略错误"版本,供文件 IO 命令在主操作
//    成功后同步 manifest 使用(失败仅记录日志,不影响主操作)
// 6. 暴露 get_manifest / update_manifest_entity 两个 Tauri 命令供前端调用
//
// 存储位置：<project>/.novelforge/manifest.json
// 写入策略：原子写入(先写 .tmp 临时文件,再 rename 替换),防止写入中途
//          崩溃导致 JSON 损坏

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// 当前 manifest schema 版本
///
/// 后续 schema 变更时递增此值,配合 migrate_manifest 函数实现版本升级
const SCHEMA_VERSION: u32 = 1;

/// 反向索引操作类型枚举
///
/// 用于 update_reverse_index 函数,标识是追加还是移除一条反向引用
//
// 注:本类型为 Task 1.2.4 要求实现的基础设施,实际调用点在后续
// Task 4.3(章节删除联动清理)/ Task 4.4(设定库卡片清理 Mention)中
// 接入,故暂时标记 #[allow(dead_code)]
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReverseIndexAction {
    /// 追加一条引用(已存在则幂等忽略)
    Add,
    /// 移除一条引用(不存在则幂等忽略,Vec 空时清理 key)
    Remove,
}

/// 顶层 Manifest 结构
///
/// 项目级统一索引,记录所有数据实体的 UUID 与 sourceFile 映射 + 反向索引
/// 通过 #[serde(rename_all = "camelCase")] 输出 camelCase 字段名,与前端
/// TypeScript 类型保持一致
/// Task 1.7.2: 派生 JsonSchema 用于自动生成前端 TS 类型与 CI 一致性校验
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    /// manifest schema 版本号,用于未来 schema 迁移
    pub schema_version: u32,
    /// 项目唯一标识(UUID v4)
    pub project_id: String,
    /// 最后更新时间(ISO 8601)
    pub updated_at: String,
    /// 实体集合,按 6 种实体类型分组
    pub entities: ManifestEntities,
    /// 反向索引,支持 codexId/chapterId → 关联实体 ID 列表的反向查找
    #[serde(default)]
    pub reverse_index: ReverseIndex,
}

/// Manifest 实体集合
///
/// 6 种实体类型分别对应项目中的 6 类数据对象,
/// 每种类型独立维护一个 Vec<ManifestEntity>,便于按类型遍历
/// Task 1.7.2: 派生 JsonSchema 用于自动生成前端 TS 类型与 CI 一致性校验
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntities {
    /// 章节实体(正文目录下的 .pmd/.txt 文件)
    #[serde(default)]
    pub chapters: Vec<ManifestEntity>,
    /// 大纲实体(大纲目录下的 .pmd 文件)
    #[serde(default)]
    pub outlines: Vec<ManifestEntity>,
    /// 设定库实体(设定目录下的卡片文件)
    #[serde(default)]
    pub codex: Vec<ManifestEntity>,
    /// 人物图谱节点实体
    #[serde(default)]
    pub graph_nodes: Vec<ManifestEntity>,
    /// 时间线节点实体
    #[serde(default)]
    pub timeline_nodes: Vec<ManifestEntity>,
    /// 伏笔实体
    #[serde(default)]
    pub foreshadowings: Vec<ManifestEntity>,
}

/// Manifest 单条实体记录
///
/// 通过 extra 字段存储 volumeId / outlineId / order / wordCount 等扩展字段,
/// 避免核心结构体频繁变动
/// Task 1.7.2: 派生 JsonSchema 用于自动生成前端 TS 类型与 CI 一致性校验
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntity {
    /// 实体唯一标识(UUID v4)
    pub id: String,
    /// 源文件相对路径(相对项目根,统一使用正斜杠)
    pub source_file: String,
    /// 实体类型标识(如 "chapter" / "outline" / "codex" 等)
    pub entity_type: String,
    /// 实体标题(可选,通常为文件名或卡片名)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// 扩展字段(可选,JSON 对象,存储 volumeId/outlineId/order/wordCount 等)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<serde_json::Value>,
}

/// 反向索引结构
///
/// 维护三类反向引用关系,支持快速查找某 codexId/chapterId 被哪些实体引用,
/// 用于章节/设定库删除时联动清理悬挂引用
/// Task 1.7.2: 派生 JsonSchema 用于自动生成前端 TS 类型与 CI 一致性校验
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReverseIndex {
    /// codexId → 图谱节点 ID 列表(设定库卡片被哪些图谱节点引用)
    #[serde(default)]
    pub codex_to_graph_nodes: HashMap<String, Vec<String>>,
    /// codexId → 章节 ID 列表(设定库卡片被哪些章节 Mention)
    #[serde(default)]
    pub codex_to_chapters: HashMap<String, Vec<String>>,
    /// chapterId → 时间线节点 ID 列表(章节被哪些时间线节点关联)
    #[serde(default)]
    pub chapter_to_timeline_nodes: HashMap<String, Vec<String>>,
}

/// 实现 Manifest 的默认构造
///
/// 生成新 projectId(UUID v4)与当前时间戳,所有实体数组与反向索引为空,
/// 用于 create_project 初始化与 manifest 文件缺失时返回默认值
impl Default for Manifest {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            project_id: uuid::Uuid::new_v4().to_string(),
            updated_at: chrono::Local::now().to_rfc3339(),
            entities: ManifestEntities::default(),
            reverse_index: ReverseIndex::default(),
        }
    }
}

// ===== 内部辅助函数 =====

/// 根据 entity_type 字符串获取对应实体数组的可变引用
///
/// 输入:
///   entities - 实体集合可变引用
///   entity_type - 实体类型字符串("chapter"/"outline"/"codex"/"graph_node"/
///                 "timeline_node"/"foreshadowing")
/// 输出: Option<&mut Vec<ManifestEntity>> 对应数组可变引用,未知类型返回 None
fn select_entity_vec_mut<'a>(
    entities: &'a mut ManifestEntities,
    entity_type: &str,
) -> Option<&'a mut Vec<ManifestEntity>> {
    match entity_type {
        "chapter" => Some(&mut entities.chapters),
        "outline" => Some(&mut entities.outlines),
        "codex" => Some(&mut entities.codex),
        "graph_node" => Some(&mut entities.graph_nodes),
        "timeline_node" => Some(&mut entities.timeline_nodes),
        "foreshadowing" => Some(&mut entities.foreshadowings),
        _ => None,
    }
}

/// 路径字符串标准化为正斜杠格式
///
/// 输入: 任意路径字符串(可能含反斜杠或正斜杠混合)
/// 输出: 统一使用正斜杠的路径字符串
/// 说明: sourceFile 字段持久化时统一为正斜杠,保证跨平台一致匹配
fn normalize_to_forward_slash(path: &str) -> String {
    path.replace('\\', "/")
}

/// 判断相对路径是否为正文章节文件
///
/// 输入: relative_path 相对项目根的路径
/// 输出: 是否为正文目录下的 .pmd / .txt 文件
/// 流程:
///   1. 路径分隔符统一为正斜杠
///   2. 检查是否以 "正文/" 开头
///   3. 检查扩展名是否为 pmd 或 txt
fn is_chapter_file(relative_path: &str) -> bool {
    is_chapter_file_relative(relative_path)
}

/// 判断相对路径是否为正文章节文件(公共 API,供 file_io_commands 调用)
///
/// 输入: relative_path 相对项目根的路径
/// 输出: 是否为正文目录下的 .pmd / .txt 文件
/// 用途: Task 1.3.2 中 file_io_commands::create_file 调用此函数判断
///       是否需要注入 front matter 与注册 manifest 实体
pub fn is_chapter_file_relative(relative_path: &str) -> bool {
    let normalized = normalize_to_forward_slash(relative_path);
    if !normalized.starts_with("正文/") {
        return false;
    }
    let ext = Path::new(&normalized)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    matches!(ext.to_lowercase().as_str(), "pmd" | "txt")
}

/// 判断相对路径是否为大纲文件(公共 API,供 file_io_commands 调用)
///
/// 输入:
///   relative_path - 相对项目根的路径
///   outline_dir - 大纲目录名(从 ProjectMeta.outline_dir 读取,默认"大纲")
/// 输出: 是否为大纲目录下的 .pmd 文件
/// 用途: Task 4.8.1 中 file_io_commands::create_file 调用此函数判断
///       是否需要为大纲文件注入 front matter(id / chapterId 字段)
/// 设计说明:
///   - 大纲文件仅识别 .pmd 扩展名(阶段一已完成 .txt → .pmd 迁移)
///   - 大纲目录名从 ProjectMeta 读取,兼容自定义目录配置(Task 1.8)
///   - chapterId 字段在创建时为 null,由前端大纲编辑器在用户关联章节时回填
pub fn is_outline_file_relative(relative_path: &str, outline_dir: &str) -> bool {
    let normalized = normalize_to_forward_slash(relative_path);
    let prefix = format!("{}/", outline_dir);
    if !normalized.starts_with(&prefix) {
        return false;
    }
    let ext = Path::new(&normalized)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    matches!(ext.to_lowercase().as_str(), "pmd")
}

/// 计算文件绝对路径相对于项目根的相对路径字符串(正斜杠格式)
///
/// 输入:
///   project_root - 项目根目录
///   abs_path - 文件绝对路径
/// 输出: Option<String> 相对路径字符串;若 abs_path 不在 project_root 内返回 None
fn relative_to_project(project_root: &Path, abs_path: &Path) -> Option<String> {
    abs_path
        .strip_prefix(project_root)
        .ok()
        .map(|p| normalize_to_forward_slash(&p.to_string_lossy()))
}

/// 在数组中按 source_file 字段移除匹配记录
///
/// 输入:
///   arr - 实体数组可变引用
///   source_file - 待移除的 source_file 值(正斜杠格式)
/// 输出: bool 是否有记录被移除
fn retain_by_source_file(arr: &mut Vec<ManifestEntity>, source_file: &str) -> bool {
    let before = arr.len();
    arr.retain(|e| e.source_file != source_file);
    before != arr.len()
}

/// 在数组中按 source_file 字段更新匹配记录的新路径
///
/// 输入:
///   arr - 实体数组可变引用
///   old_rel - 旧 source_file 值
///   new_rel - 新 source_file 值
/// 输出: bool 是否有记录被更新
fn update_source_file(arr: &mut Vec<ManifestEntity>, old_rel: &str, new_rel: &str) -> bool {
    let mut changed = false;
    for e in arr.iter_mut() {
        if e.source_file == old_rel {
            e.source_file = new_rel.to_string();
            changed = true;
        }
    }
    changed
}

// ===== 核心 API:load / save / register / unregister / update_reverse_index =====

/// 加载 manifest
///
/// 输入: project_path 项目根目录路径
/// 输出: Result<Manifest, AppError> manifest 对象或错误
/// 流程:
///   1. 拼接 manifest 文件路径 <project>/.novelforge/manifest.json
///   2. 文件不存在时返回默认空 Manifest(生成新 projectId)
///   3. 文件存在时读取并反序列化,反序列化失败返回错误
pub fn load_manifest(project_path: &Path) -> Result<Manifest, AppError> {
    let manifest_path = project_path.join(".novelforge").join("manifest.json");
    if !manifest_path.exists() {
        return Ok(Manifest::default());
    }
    let content = fs::read_to_string(&manifest_path)
        .map_err(|e| AppError::io_error(e, "读取 manifest 失败"))?;
    let manifest: Manifest = serde_json::from_str(&content)
        .map_err(|e| AppError::serialize_error(e, "解析 manifest 失败"))?;
    // Task 1.9.1: 加载后执行 schema 迁移,保证内存中的 manifest 始终为最新版本
    let manifest = migrate_manifest(manifest);
    Ok(manifest)
}

/// manifest schema 迁移函数(Task 1.9.1)
///
/// 输入: manifest 待迁移的 manifest 对象
/// 输出: Manifest 迁移后的 manifest 对象(schema_version 已升级至 SCHEMA_VERSION)
/// 流程:
///   1. 检测 manifest.schema_version 是否低于当前 SCHEMA_VERSION
///   2. 低于时按版本号逐步执行迁移逻辑(当前 v1 为初始版本,无更低版本需迁移)
///   3. 高于 SCHEMA_VERSION 时视为非法版本,重置为 SCHEMA_VERSION(向前兼容降级)
///   4. 迁移完成后将 schema_version 更新为 SCHEMA_VERSION
/// 设计说明:
///   - 当前 SCHEMA_VERSION = 1,无历史版本需迁移,此函数为预留骨架
///   - 未来 v2 发布时在此追加 `if version < 2 { migrate_v1_to_v2(&mut manifest); }` 分支
///   - 迁移仅在内存中完成,下次 save_manifest 时写入磁盘,避免 load 产生副作用 IO
pub fn migrate_manifest(mut manifest: Manifest) -> Manifest {
    // 当前为 v1 初始版本,无更低版本迁移逻辑
    // 预留迁移分支示例(未来启用):
    // if manifest.schema_version < 2 {
    //     migrate_v1_to_v2(&mut manifest);
    // }
    if manifest.schema_version != SCHEMA_VERSION {
        manifest.schema_version = SCHEMA_VERSION;
    }
    manifest
}

/// 保存 manifest(原子写入)
///
/// 输入:
///   project_path - 项目根目录路径
///   manifest - manifest 可变引用(函数内会更新 updatedAt 时间戳)
/// 输出: Result<(), AppError> 成功或错误
/// 流程:
///   1. 更新 updatedAt 为当前时间(ISO 8601)
///   2. 拼接 manifest 文件路径,确保父目录存在
///   3. 序列化为 pretty JSON
///   4. 先写入 .json.tmp 临时文件
///   5. rename 替换原文件(rename 失败时清理临时文件)
///
/// 设计说明：
/// 【Skill 偏差报备】原任务规范建议签名为 `save_manifest(project_path, &Manifest)`,
/// 但同时要求"更新 updatedAt"。&Manifest 不可变引用无法在函数内修改字段,
/// 故调整为 `&mut Manifest`,以更准确表达"保存时更新时间戳"的语义,
/// 并避免每次保存都克隆整个 manifest。差异已记录。
pub fn save_manifest(project_path: &Path, manifest: &mut Manifest) -> Result<(), AppError> {
    // 更新最后修改时间(ISO 8601)
    manifest.updated_at = chrono::Local::now().to_rfc3339();

    let manifest_path = project_path.join(".novelforge").join("manifest.json");
    // 确保父目录存在(兼容首次创建项目的场景)
    if let Some(parent) = manifest_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AppError::io_error(e, "创建 manifest 父目录失败"))?;
    }

    // 序列化为 pretty JSON(便于人工排查与 git diff 可读)
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| AppError::serialize_error(e, "序列化 manifest 失败"))?;

    // 原子写入:先写临时文件,再 rename 替换,防止写入中途崩溃导致 JSON 损坏
    let tmp_path = manifest_path.with_extension("json.tmp");
    fs::write(&tmp_path, &json)
        .map_err(|e| AppError::io_error(e, "写入 manifest 临时文件失败"))?;
    fs::rename(&tmp_path, &manifest_path).map_err(|e| {
        // rename 失败时清理临时文件,避免残留
        let _ = fs::remove_file(&tmp_path);
        AppError::io_error(e, "替换 manifest 文件失败")
    })?;
    Ok(())
}

/// 注册实体到 manifest
///
/// 输入:
///   project_path - 项目根目录路径
///   entity_type - 实体类型字符串
///   entity - 待注册的实体记录
/// 输出: Result<(), AppError> 成功或错误
/// 流程:
///   1. 加载当前 manifest
///   2. 按 entity_type 选取对应数组
///   3. 检查 id 是否已存在(幂等:已存在直接返回 Ok)
///   4. 追加到数组末尾
///   5. 保存 manifest
///
/// 错误处理:未知 entity_type 返回 ConfigError
pub fn register_entity(
    project_path: &Path,
    entity_type: &str,
    entity: ManifestEntity,
) -> Result<(), AppError> {
    let mut manifest = load_manifest(project_path)?;
    let target_vec = select_entity_vec_mut(&mut manifest.entities, entity_type)
        .ok_or_else(|| AppError::config_error(format!("未知的实体类型: {}", entity_type)))?;
    // 幂等检查:同 id 已存在则不重复追加
    if target_vec.iter().any(|e| e.id == entity.id) {
        return Ok(());
    }
    target_vec.push(entity);
    save_manifest(project_path, &mut manifest)
}

/// 注销实体(按 id 移除)
///
/// 输入:
///   project_path - 项目根目录路径
///   entity_type - 实体类型字符串
///   entity_id - 待注销的实体 ID
/// 输出: Result<(), AppError> 成功或错误
/// 流程:
///   1. 加载当前 manifest
///   2. 按 entity_type 选取对应数组
///   3. retain 过滤掉 id 匹配的记录
///   4. 若有记录被移除,保存 manifest(无变化则跳过 IO)
///
/// 错误处理:未知 entity_type 返回 ConfigError;id 不存在幂等返回 Ok
pub fn unregister_entity(
    project_path: &Path,
    entity_type: &str,
    entity_id: &str,
) -> Result<(), AppError> {
    let mut manifest = load_manifest(project_path)?;
    let target_vec = select_entity_vec_mut(&mut manifest.entities, entity_type)
        .ok_or_else(|| AppError::config_error(format!("未知的实体类型: {}", entity_type)))?;
    let before = target_vec.len();
    target_vec.retain(|e| e.id != entity_id);
    // 仅在数据变化时才落盘,避免无谓 IO
    if target_vec.len() != before {
        save_manifest(project_path, &mut manifest)?;
    }
    Ok(())
}

/// 维护反向索引
///
/// 输入:
///   manifest - manifest 可变引用
///   codex_id - 反向索引的 key(对 graph_node/chapter 类型为 codexId,
///              对 timeline_node 类型实际为 chapterId)
///   action - Add 追加 / Remove 移除
///   target_type - 目标实体类型("graph_node"/"chapter"/"timeline_node")
///   target_id - 目标实体 ID
/// 输出: 无(直接修改 manifest 反向索引)
/// 流程:
///   1. 按 target_type 选取对应 HashMap
///   2. Add:在 key 对应 Vec 中追加 target_id(去重)
///   3. Remove:从 key 对应 Vec 中移除 target_id;Vec 空时移除 key
///
/// 设计说明:未知 target_type 静默忽略,保持向前兼容
//
// 注:本函数为 Task 1.2.4 要求实现的基础设施,实际调用点在后续
// Task 4.3(章节删除联动清理)/ Task 4.4(设定库卡片清理 Mention)中
// 接入,故暂时标记 #[allow(dead_code)]
#[allow(dead_code)]
pub fn update_reverse_index(
    manifest: &mut Manifest,
    codex_id: &str,
    action: ReverseIndexAction,
    target_type: &str,
    target_id: &str,
) {
    let target_map = match target_type {
        "graph_node" => &mut manifest.reverse_index.codex_to_graph_nodes,
        "chapter" => &mut manifest.reverse_index.codex_to_chapters,
        "timeline_node" => &mut manifest.reverse_index.chapter_to_timeline_nodes,
        _ => return,
    };

    match action {
        ReverseIndexAction::Add => {
            let vec = target_map.entry(codex_id.to_string()).or_default();
            // 去重:已存在则不重复追加
            if !vec.iter().any(|id| id == target_id) {
                vec.push(target_id.to_string());
            }
        }
        ReverseIndexAction::Remove => {
            if let Some(vec) = target_map.get_mut(codex_id) {
                vec.retain(|id| id != target_id);
                // Vec 空时移除 key,避免反向索引膨胀
                if vec.is_empty() {
                    target_map.remove(codex_id);
                }
            }
        }
    }
}

// ===== 文件 IO 同步辅助函数(忽略错误版本) =====

/// 同步注册章节文件到 manifest(失败仅记录日志,不影响主操作)
///
/// 输入:
///   project_path - 项目根目录路径
///   relative_path - 文件相对项目根的路径
///   file_name - 文件名(用于提取标题)
///   entity_id - 实体 UUID(与 front matter 中的 id 保持一致,由调用方生成)
/// 输出: 无
/// 流程:
///   1. 校验是否为正文目录下的 .pmd/.txt 文件,非章节文件直接返回
///   2. canonicalize 项目路径(失败记录日志返回)
///   3. 构造 ManifestEntity(id=entity_id, source_file=正斜杠路径,
///      entity_type="chapter", title=文件名去扩展名)
///   4. 调用 register_entity 注册(失败记录日志返回)
/// Task 1.3.2: entity_id 由 create_file 生成并注入 front matter,
///            此处复用同一 UUID 保证 manifest 与 front matter 的 id 一致
pub fn try_register_chapter(
    project_path: &str,
    relative_path: &str,
    file_name: &str,
    entity_id: &str,
) {
    // 仅处理正文目录下的 .pmd / .txt 文件
    if !is_chapter_file(relative_path) {
        return;
    }

    let project_root = match PathBuf::from(project_path).canonicalize() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[manifest] 解析项目路径失败: {}", e);
            return;
        }
    };

    // 提取文件名(去扩展名)作为标题
    let title = Path::new(file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let entity = ManifestEntity {
        id: entity_id.to_string(),
        source_file: normalize_to_forward_slash(relative_path),
        entity_type: "chapter".to_string(),
        title: Some(title),
        extra: None,
    };

    if let Err(e) = register_entity(&project_root, "chapter", entity) {
        eprintln!("[manifest] 注册章节实体失败: {}", e);
    }
}

/// 同步注册大纲文件到 manifest(失败仅记录日志,不影响主操作)(Task 4.8.1)
///
/// 输入:
///   project_path - 项目根目录路径
///   relative_path - 文件相对项目根的路径
///   file_name - 文件名(用于提取标题)
///   entity_id - 大纲实体 UUID(与 front matter 中的 id 保持一致,由调用方生成)
/// 输出: 无
/// 流程:
///   1. 校验是否为大纲目录下的 .pmd 文件,非大纲文件直接返回
///   2. canonicalize 项目路径(失败记录日志返回)
///   3. 读取 ProjectMeta 获取大纲目录名,验证 relative_path 是否属于大纲目录
///   4. 构造 ManifestEntity(id=entity_id, source_file=正斜杠路径,
///      entity_type="outline", title=文件名去扩展名, extra 含 chapterId=null)
///   5. 调用 register_entity 注册(失败记录日志返回)
/// 设计说明:
///   - extra.chapterId 初始为 null,前端大纲编辑器在用户关联章节时回填
///   - 大纲目录名从 ProjectMeta 读取,兼容自定义目录配置
pub fn try_register_outline(
    project_path: &str,
    relative_path: &str,
    file_name: &str,
    entity_id: &str,
) {
    let project_root = match PathBuf::from(project_path).canonicalize() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[manifest] 解析项目路径失败: {}", e);
            return;
        }
    };

    // 读取 ProjectMeta 获取大纲目录名,失败时回退到默认"大纲"
    let outline_dir = crate::commands::read_project_meta(&project_root)
        .map(|meta| meta.outline_dir)
        .unwrap_or_else(|_| "大纲".to_string());

    if !is_outline_file_relative(relative_path, &outline_dir) {
        return;
    }

    // 提取文件名(去扩展名)作为标题
    let title = Path::new(file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    // extra 字段预置 chapterId: null,前端在用户关联章节时回填
    let mut extra_map = serde_json::Map::new();
    extra_map.insert(
        "chapterId".to_string(),
        serde_json::Value::Null,
    );

    let entity = ManifestEntity {
        id: entity_id.to_string(),
        source_file: normalize_to_forward_slash(relative_path),
        entity_type: "outline".to_string(),
        title: Some(title),
        extra: Some(serde_json::Value::Object(extra_map)),
    };

    if let Err(e) = register_entity(&project_root, "outline", entity) {
        eprintln!("[manifest] 注册大纲实体失败: {}", e);
    }
}

/// 读取大纲文件的 front matter,返回 (meta 键值对, 正文)(Task 4.8.2 内部辅助)
///
/// 输入: outline_path 大纲文件绝对路径
/// 输出: Option<(Vec<(String, String)>, String)> front matter 键值对与正文;无 front matter 或读取失败返回 None
/// 用途: 供 sync_outline_title_to_chapter 与 try_sync_outline_title_on_chapter_rename 读取/更新大纲 front matter
fn read_outline_front_matter(outline_path: &Path) -> Option<(Vec<(String, String)>, String)> {
    let content = fs::read_to_string(outline_path).ok()?;
    crate::text_extractor::extract_front_matter(&content)
}

/// 将更新后的 front matter 键值对与正文写回大纲文件(原子写入)(Task 4.8.2 内部辅助)
///
/// 输入:
///   outline_path - 大纲文件绝对路径
///   meta - 新的 front matter 键值对列表
///   body - 正文内容
/// 输出: Result<(), AppError> 写入结果
/// 流程:
///   1. 调用 inject_front_matter 重新拼接 front matter + body
///   2. 原子写入(.tmp → rename)
fn write_outline_with_front_matter(
    outline_path: &Path,
    meta: &[(String, String)],
    body: &str,
) -> Result<(), AppError> {
    let new_content = crate::text_extractor::inject_front_matter(body, meta);
    let tmp_path = outline_path.with_extension("pmd.tmp");
    fs::write(&tmp_path, &new_content)
        .map_err(|e| AppError::io_error(e, "写入大纲临时文件失败"))?;
    fs::rename(&tmp_path, outline_path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        AppError::io_error(e, "重命名大纲临时文件失败")
    })
}

/// 在 front matter 键值对中更新指定 key 的 value(若 key 不存在则追加)
///
/// 输入:
///   meta - front matter 键值对列表(可变引用)
///   key - 待更新的键
///   value - 新值
/// 流程: 遍历 meta,找到 key 则更新 value;未找到则追加 (key, value)
fn upsert_meta_field(meta: &mut Vec<(String, String)>, key: &str, value: &str) {
    for (k, v) in meta.iter_mut() {
        if k == key {
            *v = value.to_string();
            return;
        }
    }
    meta.push((key.to_string(), value.to_string()));
}

/// 同步注销 manifest 中 sourceFile 匹配的实体(失败仅记录日志)
///
/// 输入:
///   project_path - 项目根目录路径
///   abs_path - 被删除文件的绝对路径
/// 输出: 无
/// 流程:
///   1. canonicalize 项目路径
///   2. 计算文件相对路径(正斜杠格式)
///   3. 加载 manifest
///   4. 遍历所有 6 类实体数组,移除 sourceFile 匹配的记录
///   5. 有变化时保存 manifest
/// 说明:遍历所有类型是因为删除可能涉及设定/大纲/伏笔等任意文件
pub fn try_unregister_by_source_file(project_path: &str, abs_path: &Path) {
    let project_root = match PathBuf::from(project_path).canonicalize() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[manifest] 解析项目路径失败: {}", e);
            return;
        }
    };

    let rel = match relative_to_project(&project_root, abs_path) {
        Some(r) => r,
        None => return,
    };

    let mut manifest = match load_manifest(&project_root) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[manifest] 加载 manifest 失败: {}", e);
            return;
        }
    };

    // 遍历所有实体类型数组,移除 sourceFile 匹配的记录
    let mut changed = false;
    changed |= retain_by_source_file(&mut manifest.entities.chapters, &rel);
    changed |= retain_by_source_file(&mut manifest.entities.outlines, &rel);
    changed |= retain_by_source_file(&mut manifest.entities.codex, &rel);
    changed |= retain_by_source_file(&mut manifest.entities.graph_nodes, &rel);
    changed |= retain_by_source_file(&mut manifest.entities.timeline_nodes, &rel);
    changed |= retain_by_source_file(&mut manifest.entities.foreshadowings, &rel);

    if changed {
        if let Err(e) = save_manifest(&project_root, &mut manifest) {
            eprintln!("[manifest] 保存 manifest 失败: {}", e);
        }
    }
}

/// 同步更新 manifest 中 sourceFile 路径(失败仅记录日志)
///
/// 输入:
///   project_path - 项目根目录路径
///   old_abs - 旧文件绝对路径
///   new_abs - 新文件绝对路径
/// 输出: 无
/// 流程:
///   1. canonicalize 项目路径
///   2. 计算 old/new 相对路径(正斜杠格式)
///   3. 加载 manifest
///   4. 遍历所有实体数组,将 sourceFile=old_rel 更新为 new_rel
///   5. 有变化时保存 manifest
pub fn try_rename_source_file(project_path: &str, old_abs: &Path, new_abs: &Path) {
    let project_root = match PathBuf::from(project_path).canonicalize() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[manifest] 解析项目路径失败: {}", e);
            return;
        }
    };

    let old_rel = match relative_to_project(&project_root, old_abs) {
        Some(r) => r,
        None => return,
    };
    let new_rel = match relative_to_project(&project_root, new_abs) {
        Some(r) => r,
        None => return,
    };

    let mut manifest = match load_manifest(&project_root) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[manifest] 加载 manifest 失败: {}", e);
            return;
        }
    };

    // 遍历所有实体数组,更新 sourceFile 路径
    let mut changed = false;
    changed |= update_source_file(&mut manifest.entities.chapters, &old_rel, &new_rel);
    changed |= update_source_file(&mut manifest.entities.outlines, &old_rel, &new_rel);
    changed |= update_source_file(&mut manifest.entities.codex, &old_rel, &new_rel);
    changed |= update_source_file(&mut manifest.entities.graph_nodes, &old_rel, &new_rel);
    changed |= update_source_file(&mut manifest.entities.timeline_nodes, &old_rel, &new_rel);
    changed |= update_source_file(&mut manifest.entities.foreshadowings, &old_rel, &new_rel);

    if changed {
        if let Err(e) = save_manifest(&project_root, &mut manifest) {
            eprintln!("[manifest] 保存 manifest 失败: {}", e);
        }
    }
}

// ===== Task 1.3.4: 章节字数同步到 manifest =====

/// 更新 manifest 中指定章节实体的 wordCount(Task 1.3.4)
///
/// 输入:
///   project_path - 项目根目录路径
///   source_file - 章节文件相对路径(正斜杠格式,与 manifest 中 sourceFile 字段匹配)
///   word_count - 最新字数
/// 输出: Result<(), AppError> 更新结果
/// 流程:
///   1. 加载 manifest
///   2. 在 chapters 数组中按 source_file 查找匹配实体
///   3. 更新 entity.extra 字段,写入/覆盖 wordCount 键值
///   4. 保存 manifest
/// 设计说明:
///   - extra 字段为 Option<serde_json::Value>,存储 volumeId/outlineId/order/wordCount 等扩展信息
///   - wordCount 作为 JSON 对象的一个键存在,不影响其他扩展字段
///   - 未找到匹配实体时静默返回 Ok(幂等,章节可能尚未注册到 manifest)
pub fn update_entity_word_count(
    project_path: &Path,
    source_file: &str,
    word_count: u64,
) -> Result<(), AppError> {
    let mut manifest = load_manifest(project_path)?;
    let normalized = normalize_to_forward_slash(source_file);

    let mut found = false;
    for entity in manifest.entities.chapters.iter_mut() {
        if entity.source_file == normalized {
            // 更新 extra 字段: 若已有 JSON 对象则追加 wordCount,否则创建新对象
            let mut extra = match entity.extra.take() {
                Some(serde_json::Value::Object(map)) => map,
                _ => serde_json::Map::new(),
            };
            extra.insert(
                "wordCount".to_string(),
                serde_json::Value::Number(word_count.into()),
            );
            entity.extra = Some(serde_json::Value::Object(extra));
            found = true;
            break;
        }
    }

    // 未找到匹配实体时静默返回(章节可能尚未注册,幂等不报错)
    if found {
        save_manifest(project_path, &mut manifest)?;
    }
    Ok(())
}

/// 通过 source_file 反查设定库实体的 UUID(Task 4.1.4)
///
/// 输入:
///   project_path - 项目根目录路径
///   source_file - 设定库卡片文件相对路径(正斜杠格式)
/// 输出: Option<String> 找到的 codex 实体 UUID;未找到返回 None
/// 流程:
///   1. 加载 manifest(失败时返回 None,不抛错,保证调用方主流程不受影响)
///   2. 在 entities.codex 数组中按 source_file 字段精确匹配
///   3. 返回匹配实体的 id 字段
/// 用途: 供 character_graph_commands::read_character_graph 在加载旧图谱数据时,
///       对没有 codexId 的节点通过 sourceFile 反查 manifest 填充 codexId,
///       实现旧数据向新关联方式的平滑迁移
/// 设计说明:
///   - manifest 中无对应记录时返回 None,调用方应将 None 视为"未关联",保留原值不报错
///   - 路径匹配前统一标准化为正斜杠,保证跨平台一致
pub fn find_codex_id_by_source_file(project_path: &Path, source_file: &str) -> Option<String> {
    let manifest = load_manifest(project_path).ok()?;
    let normalized = normalize_to_forward_slash(source_file);
    manifest
        .entities
        .codex
        .iter()
        .find(|e| e.source_file == normalized)
        .map(|e| e.id.clone())
}

/// 同步更新章节字数到 manifest(失败仅记录日志,不影响主操作)
///
/// 输入:
///   project_path - 项目根目录路径
///   source_file - 章节文件相对路径
///   word_count - 最新字数
/// 输出: 无
/// 用途: 供 write_file 命令在写入正文文件后调用,增量更新 manifest 中的 wordCount
pub fn try_update_chapter_word_count(project_path: &str, source_file: &str, word_count: u64) {
    let project_root = match PathBuf::from(project_path).canonicalize() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[manifest] 解析项目路径失败: {}", e);
            return;
        }
    };
    if let Err(e) = update_entity_word_count(&project_root, source_file, word_count) {
        eprintln!("[manifest] 更新章节字数失败: {}", e);
    }
}

// ===== Task 4.8.2: 大纲标题同步到章节 =====

/// 将大纲标题同步到关联章节的标题字段(Task 4.8.2 Tauri 命令)
///
/// 输入:
///   project_path - 项目根目录路径
///   outline_path - 大纲文件绝对路径
///   chapter_id - 关联章节的 UUID
///   new_title - 新章节标题
/// 输出: Result<(), AppError> 同步结果
/// 流程:
///   1. 校验项目路径与大纲文件存在
///   2. 加载 manifest,在 chapters 数组中按 id 查找章节实体
///   3. 未找到章节实体时返回 PathValidationError(关联已失效)
///   4. 找到章节实体后,更新其 title 字段为 new_title
///   5. 重命名章节文件(以 new_title 为新文件名,保留原扩展名)
///   6. 同步更新 manifest 中章节实体的 sourceFile 与 title
///   7. 更新大纲 front matter 的 chapterId 字段(确认关联关系)
/// 设计说明:
///   - 章节文件名以 new_title 命名,保留原扩展名(.pmd / .txt)
///   - 重命名失败时返回错误,manifest 已更新的 title 字段在下一次重命名时纠正
///   - 此命令由前端大纲编辑器在用户确认同步后调用
#[tauri::command]
pub fn sync_outline_title_to_chapter(
    project_path: String,
    outline_path: String,
    chapter_id: String,
    new_title: String,
) -> Result<(), AppError> {
    let project_root = crate::commands::validate_project_path(&project_path)?;
    let outline_abs = validate_path_in_project_internal(&outline_path, &project_root)?;

    if !outline_abs.exists() {
        return Err(AppError::path_validation_error("大纲文件不存在"));
    }

    let mut manifest = load_manifest(&project_root)?;

    // 在 chapters 数组中按 id 查找章节实体
    let chapter_entity = manifest
        .entities
        .chapters
        .iter()
        .find(|c| c.id == chapter_id)
        .cloned()
        .ok_or_else(|| {
            AppError::path_validation_error(format!(
                "未找到 ID 为 {} 的章节实体,关联可能已失效",
                chapter_id
            ))
        })?;

    // 计算新文件路径(以 new_title 为文件名,保留原扩展名)
    let old_source = &chapter_entity.source_file;
    let old_abs = project_root.join(old_source);
    let ext = old_abs
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_else(|| "pmd".to_string());
    // 文件名清洗: 去除文件名非法字符
    let cleaned_title = sanitize_file_name(&new_title);
    let new_file_name = format!("{}.{}", cleaned_title, ext);
    let new_abs = old_abs
        .parent()
        .map(|p| p.join(&new_file_name))
        .unwrap_or_else(|| project_root.join(&new_file_name));

    // 重命名章节文件(若新旧路径相同则跳过)
    if old_abs != new_abs {
        if new_abs.exists() {
            return Err(AppError::path_validation_error(format!(
                "目标文件已存在: {}",
                new_file_name
            )));
        }
        fs::rename(&old_abs, &new_abs)
            .map_err(|e| AppError::io_error(e, "重命名章节文件失败"))?;
    }

    // 同步 manifest: 更新章节实体的 source_file 与 title
    let new_source = relative_to_project(&project_root, &new_abs)
        .unwrap_or_else(|| new_file_name.clone());
    for entity in manifest.entities.chapters.iter_mut() {
        if entity.id == chapter_id {
            entity.source_file = new_source.clone();
            entity.title = Some(new_title.clone());
            break;
        }
    }

    // 同步索引: 更新 Tantivy 索引(删除旧路径 + 添加新路径)
    crate::index_sync::try_sync_index_rename(&project_path, &old_abs, &new_abs);

    save_manifest(&project_root, &mut manifest)?;

    // 更新大纲 front matter 的 chapterId 字段(确认关联关系)
    if let Some((mut meta, body)) = read_outline_front_matter(&outline_abs) {
        upsert_meta_field(&mut meta, "chapterId", &chapter_id);
        // 同步大纲 title 字段为新章节标题
        upsert_meta_field(&mut meta, "title", &new_title);
        write_outline_with_front_matter(&outline_abs, &meta, &body)?;
    }

    Ok(())
}

// ===== Task 4.8.3: 章节重命名时反向更新大纲 front matter title =====

/// 章节重命名时反向同步大纲 front matter title(失败仅记录日志,不影响主操作)
///
/// 输入:
///   project_path - 项目根目录路径
///   old_chapter_abs - 旧章节文件绝对路径
///   new_chapter_abs - 新章节文件绝对路径
/// 输出: 无
/// 流程:
///   1. canonicalize 项目路径
///   2. 计算 old/new 相对路径(正斜杠格式)
///   3. 加载 manifest
///   4. 在 chapters 数组中按 source_file == old_rel 查找章节实体,获取其 id 与新 title
///      (注: rename_path 主操作已更新 manifest,此处需用 new_rel 查找以获取最新实体)
///   5. 遍历 outlines 数组,查找 extra.chapterId == chapter_id 的大纲实体
///   6. 对每个匹配的大纲实体:
///      a. 读取大纲文件 front matter
///      b. 更新 title 字段为新章节标题(从 new_abs 文件名提取)
///      c. 原子写回大纲文件
///   7. 同步更新 manifest 中大纲实体的 title 字段
/// 设计说明:
///   - 此函数在 rename_path 主操作(文件重命名 + manifest sourceFile 更新)成功后调用
///   - 失败仅记录日志,不影响重命名主操作
///   - 通过 manifest 反向索引查找关联的大纲文件,无需扫描整个大纲目录
pub fn try_sync_outline_title_on_chapter_rename(
    project_path: &str,
    // 旧章节路径保留用于日志诊断与未来扩展(如 manifest 未及时更新时的回退查找)
    _old_chapter_abs: &Path,
    new_chapter_abs: &Path,
) {
    let project_root = match PathBuf::from(project_path).canonicalize() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[manifest] 解析项目路径失败: {}", e);
            return;
        }
    };

    let new_rel = match relative_to_project(&project_root, new_chapter_abs) {
        Some(r) => r,
        None => return,
    };

    let mut manifest = match load_manifest(&project_root) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[manifest] 加载 manifest 失败: {}", e);
            return;
        }
    };

    // 在 chapters 数组中按新 source_file 查找章节实体
    // 注: rename_path 主操作已更新 manifest,故此处用 new_rel 查找
    let chapter_entity = manifest
        .entities
        .chapters
        .iter()
        .find(|c| c.source_file == new_rel)
        .cloned();

    let chapter_id = match chapter_entity {
        Some(ref e) => e.id.clone(),
        None => return,
    };

    // 从新文件名提取章节标题(去扩展名)
    let new_title = new_chapter_abs
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    if new_title.is_empty() {
        return;
    }

    // 遍历 outlines,查找 extra.chapterId == chapter_id 的大纲实体
    let mut outline_changed = false;
    for outline_entity in manifest.entities.outlines.iter_mut() {
        let chapter_id_in_extra = outline_entity
            .extra
            .as_ref()
            .and_then(|v| v.get("chapterId"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        if chapter_id_in_extra.as_deref() != Some(&chapter_id) {
            continue;
        }

        // 读取大纲文件,更新 front matter title 字段
        let outline_abs = project_root.join(&outline_entity.source_file);
        if let Some((mut meta, body)) = read_outline_front_matter(&outline_abs) {
            upsert_meta_field(&mut meta, "title", &new_title);
            if let Err(e) = write_outline_with_front_matter(&outline_abs, &meta, &body) {
                eprintln!(
                    "[manifest] 更新大纲 front matter title 失败 ({}): {}",
                    outline_entity.source_file, e
                );
                continue;
            }
            // 同步更新 manifest 中大纲实体的 title 字段
            outline_entity.title = Some(new_title.clone());
            outline_changed = true;
        }
    }

    if outline_changed {
        if let Err(e) = save_manifest(&project_root, &mut manifest) {
            eprintln!("[manifest] 保存 manifest 失败: {}", e);
        }
    }
}

/// 内部辅助: 路径沙箱校验(复用 commands::validate_path_in_project)
///
/// 输入:
///   path - 待校验路径字符串
///   project_root - 项目根目录(已 canonicalize)
/// 输出: Result<PathBuf, AppError> 校验后的绝对路径
fn validate_path_in_project_internal(path: &str, project_root: &Path) -> Result<PathBuf, AppError> {
    crate::commands::validate_path_in_project(path, &project_root.to_string_lossy())
}

/// 文件名清洗: 去除 Windows / Unix 文件名非法字符(Task 4.8.2 内部辅助)
///
/// 输入: raw 待清洗的文件名
/// 输出: String 清洗后的文件名(仅去除非法字符,不改变其他内容)
fn sanitize_file_name(raw: &str) -> String {
    raw.trim()
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

// ===== Task 1.3.3: 大纲文件迁移 .txt → .pmd =====

/// 将纯文本转换为 ProseMirror JSON 文档字符串(内部辅助)
///
/// 输入: text 纯文本内容
/// 输出: String ProseMirror JSON 字符串(每行一个 paragraph 节点)
/// 流程:
///   1. 按换行符分割文本(兼容 Windows CRLF)
///   2. 非空行转为含 text 节点的 paragraph
///   3. 空行转为空 paragraph
///   4. 包装为 doc 根节点并序列化为 JSON 字符串
/// 设计说明: 复用 codex::migration::convert_codex_text_to_pmd 的转换逻辑,
///          因该函数为 codex 模块私有,此处独立实现避免跨模块暴露
fn convert_text_to_pmd_json(text: &str) -> String {
    let mut content = Vec::new();
    for line in text.split('\n').map(|l| l.trim_end_matches('\r')) {
        if line.is_empty() {
            content.push(serde_json::json!({"type": "paragraph"}));
        } else {
            content.push(serde_json::json!({
                "type": "paragraph",
                "content": [{"type": "text", "text": line}]
            }));
        }
    }
    // 空文档至少保留一个空段落,避免 ProseMirror 解析失败
    if content.is_empty() {
        content.push(serde_json::json!({"type": "paragraph"}));
    }
    let doc = serde_json::json!({"type": "doc", "content": content});
    serde_json::to_string(&doc).unwrap_or_else(|_| {
        "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}".to_string()
    })
}

/// 原子写入文件(临时文件 + rename,内部辅助)
///
/// 输入: path 目标路径, content 文件内容
/// 输出: Result<(), AppError> 写入结果
/// 流程: 写 .tmp 临时文件 → rename 替换 → 失败时清理临时文件
fn atomic_write_file(path: &Path, content: &str) -> Result<(), AppError> {
    let tmp_path = path.with_extension("pmd.tmp");
    fs::write(&tmp_path, content).map_err(|e| AppError::io_error(e, "写入临时文件失败"))?;
    fs::rename(&tmp_path, path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        AppError::io_error(e, "重命名临时文件失败")
    })
}

/// 将大纲目录下的 .txt 文件迁移为 .pmd 格式(Task 1.3.3)
///
/// 输入: project_path 项目根目录路径
/// 输出: Result<(), AppError> 迁移结果
/// 流程:
///   1. 读取 ProjectMeta 获取大纲目录名(默认"大纲")
///   2. 递归扫描大纲目录下所有 .txt 文件
///   3. 对每个 .txt 文件:
///      a. 读取内容,生成 UUID v4
///      b. 将纯文本转换为 ProseMirror JSON
///      c. 注入 front matter(id/title 字段)
///      d. 原子写入 .pmd 文件
///      e. 将旧 .txt 重命名为 .bak 作为备份(Task 1.3.5)
///      f. 注册 outline 实体到 manifest
///   4. 已存在 .pmd 文件的 .txt 跳过(避免重复迁移)
/// 设计说明:
///   - 保留 .txt 为 .bak 而非删除,确保迁移失败时可回滚(Task 1.3.5)
///   - .pmd 已存在时跳过,支持增量迁移(中断后重跑安全)
///   - 大纲目录名从 ProjectMeta 读取,兼容自定义目录配置(Task 1.8)
pub fn migrate_outline_to_pmd(project_path: &Path) -> Result<(), AppError> {
    // 读取 ProjectMeta 获取大纲目录名,失败时回退到默认"大纲"
    let outline_dir_name = crate::commands::read_project_meta(project_path)
        .map(|meta| meta.outline_dir)
        .unwrap_or_else(|_| "大纲".to_string());
    let outline_dir = project_path.join(&outline_dir_name);

    // 大纲目录不存在时无需迁移
    if !outline_dir.exists() {
        return Ok(());
    }

    // 递归扫描大纲目录下的 .txt 文件
    for entry in walkdir::WalkDir::new(&outline_dir)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "txt" {
            continue;
        }

        // .pmd 已存在时跳过(已迁移过,避免重复)
        let pmd_path = path.with_extension("pmd");
        if pmd_path.exists() {
            continue;
        }

        // 读取 .txt 内容
        let content = fs::read_to_string(path)
            .map_err(|e| AppError::io_error(e, format!("读取大纲文件失败: {}", path.display())))?;

        // 生成 UUID v4
        let entity_id = uuid::Uuid::new_v4().to_string();

        // 提取文件名(去扩展名)作为标题
        let title = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        // 将纯文本转换为 ProseMirror JSON
        let pmd_content = convert_text_to_pmd_json(&content);

        // 注入 front matter(id/title 字段)
        let meta = vec![
            ("id".to_string(), entity_id.clone()),
            ("title".to_string(), title.clone()),
        ];
        let pmd_file_content = crate::text_extractor::inject_front_matter(&pmd_content, &meta);

        // 原子写入 .pmd 文件
        atomic_write_file(&pmd_path, &pmd_file_content)?;

        // 将旧 .txt 重命名为 .bak 作为备份(Task 1.3.5)
        let bak_path = path.with_extension("bak");
        // .bak 已存在时先删除(历史残留)
        if bak_path.exists() {
            let _ = fs::remove_file(&bak_path);
        }
        fs::rename(path, &bak_path).map_err(|e| {
            AppError::io_error(e, format!("备份旧大纲文件失败: {}", path.display()))
        })?;

        // 注册 outline 实体到 manifest
        let rel_path = relative_to_project(project_path, &pmd_path)
            .unwrap_or_default();
        let entity = ManifestEntity {
            id: entity_id,
            source_file: rel_path,
            entity_type: "outline".to_string(),
            title: Some(title),
            extra: None,
        };
        if let Err(e) = register_entity(project_path, "outline", entity) {
            eprintln!("[manifest] 注册大纲实体失败: {}", e);
        }
    }

    Ok(())
}

/// 项目数据迁移命令(Task 1.3.3)
///
/// 输入: project_path 项目根目录路径
/// 输出: Result<(), AppError> 迁移结果
/// 流程:
///   1. 校验项目路径
///   2. 调用 migrate_outline_to_pmd 迁移大纲文件
///   3. (未来可扩展其他迁移步骤)
/// 用途: 旧项目首次打开时由前端调用,自动将旧格式数据迁移到新格式
#[tauri::command]
pub fn migrate_project_data(project_path: String) -> Result<(), AppError> {
    let path = crate::commands::validate_project_path(&project_path)?;
    migrate_outline_to_pmd(&path)
}

// ===== Tauri 命令 =====

/// 读取项目 manifest
///
/// 输入: project_path 项目根目录路径
/// 输出: Result<Manifest, AppError> manifest 对象或错误
/// 流程:
///   1. 校验项目路径存在且为目录
///   2. 调用 load_manifest 加载(文件不存在返回默认空 Manifest)
#[tauri::command]
pub fn get_manifest(project_path: String) -> Result<Manifest, AppError> {
    let path = crate::commands::validate_project_path(&project_path)?;
    load_manifest(&path)
}

/// 更新 manifest 实体(增/删/改)
///
/// 输入:
///   project_path - 项目根目录路径
///   entity_type - 实体类型字符串
///   entity - 实体记录(add/update 时携带完整字段,remove 时仅需 id)
///   action - 操作类型:"add" 追加 / "remove" 按 id 移除 / "update" 替换
/// 输出: Result<(), AppError> 成功或错误
/// 流程:
///   1. 校验项目路径
///   2. 按 action 分发:
///      - "add": 调用 register_entity(id 重复幂等返回)
///      - "remove": 调用 unregister_entity(按 entity.id 移除)
///      - "update": 加载 manifest → 按 id 移除旧记录 → 追加新记录 → 保存
///   3. 未知 action 返回 ConfigError
#[tauri::command]
pub fn update_manifest_entity(
    project_path: String,
    entity_type: String,
    entity: ManifestEntity,
    action: String,
) -> Result<(), AppError> {
    let path = crate::commands::validate_project_path(&project_path)?;
    match action.as_str() {
        "add" => register_entity(&path, &entity_type, entity),
        "remove" => unregister_entity(&path, &entity_type, &entity.id),
        "update" => {
            let mut manifest = load_manifest(&path)?;
            let target_vec = select_entity_vec_mut(&mut manifest.entities, &entity_type)
                .ok_or_else(|| {
                    AppError::config_error(format!("未知的实体类型: {}", entity_type))
                })?;
            // 先移除同 id 旧记录,再追加新记录,实现替换
            target_vec.retain(|e| e.id != entity.id);
            target_vec.push(entity);
            save_manifest(&path, &mut manifest)
        }
        _ => Err(AppError::config_error(format!("未知的 action: {}", action))),
    }
}

/// 章节删除联动清理结果(Task 4.3)
///
/// 返回被删章节关联的反向索引信息,供前端进一步联动清理 timeline / graph 等模块
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterCleanupResult {
    /// 被删除章节的实体 UUID(空字符串表示 manifest 中未找到对应记录)
    pub chapter_id: String,
    /// 需要前端清理 chapterId 引用的时间线节点 ID 列表
    pub timeline_node_ids: Vec<String>,
    /// 需要前端清理 sourceFile 引用的人物图谱节点 ID 列表
    pub graph_node_ids: Vec<String>,
}

/// 清理章节删除后残留的反向索引与 manifest 实体记录(Task 4.3)
///
/// 输入:
///   project_path - 项目根目录路径
///   chapter_source_file - 被删除章节的 source_file 路径(相对项目根,正斜杠格式)
/// 输出: Result<ChapterCleanupResult, AppError> 清理结果,包含需要前端进一步联动清理的节点 ID 列表
/// 流程:
///   1. 校验项目路径并加载 manifest
///   2. 在 entities.chapters 中按 source_file 查找章节实体,获取 chapter_id
///   3. 未找到章节实体时返回空结果(幂等,允许重复调用)
///   4. 从 entities.chapters 中移除该记录
///   5. 从 chapter_to_timeline_nodes 中取出该 chapter_id 关联的时间线节点 ID 列表
///   6. 扫描 graph_nodes 中 extra 字段引用了该 chapter_id 或 source_file 的节点 ID
///   7. 从 codex_to_chapters 反向索引中清理引用此 chapter_id 的条目(空 Vec 自动清 key)
///   8. 移除 chapter_to_timeline_nodes 中的 chapter_id 条目
///   9. 原子保存 manifest
///   10. 返回 timeline_node_ids / graph_node_ids 供前端联动清理
/// 设计说明:
///   - 后端只负责 manifest 数据层清理,前端模块数据(timeline.json / graph.json)由前端自行更新
///   - graph_node 的 sourceFile 通常关联设定库文件而非章节,扫描 extra 兼容未来扩展
#[tauri::command]
pub fn clean_chapter_reverse_indices(
    project_path: String,
    chapter_source_file: String,
) -> Result<ChapterCleanupResult, AppError> {
    let path = crate::commands::validate_project_path(&project_path)?;
    let mut manifest = load_manifest(&path)?;
    let normalized = normalize_to_forward_slash(&chapter_source_file);

    // 查找被删章节对应的实体 ID
    let chapter_id = match manifest
        .entities
        .chapters
        .iter()
        .find(|c| c.source_file == normalized)
        .map(|c| c.id.clone())
    {
        Some(id) => id,
        None => {
            // manifest 中无对应记录(可能为旧项目未注册),返回空结果保证幂等
            return Ok(ChapterCleanupResult {
                chapter_id: String::new(),
                timeline_node_ids: Vec::new(),
                graph_node_ids: Vec::new(),
            });
        }
    };

    // 从 chapters 数组中移除该记录
    manifest.entities.chapters.retain(|c| c.id != chapter_id);

    // 取出该 chapter_id 关联的时间线节点 ID 列表
    let timeline_node_ids = manifest
        .reverse_index
        .chapter_to_timeline_nodes
        .get(&chapter_id)
        .cloned()
        .unwrap_or_default();

    // 扫描 graph_nodes 中 extra 字段引用了该 chapter_id 或被删 source_file 的节点
    let graph_node_ids: Vec<String> = manifest
        .entities
        .graph_nodes
        .iter()
        .filter_map(|node| {
            let extra = node.extra.as_ref()?;
            let obj = extra.as_object()?;
            // extra.chapterId 引用被删章节 UUID
            let matches_chapter_id = obj
                .get("chapterId")
                .and_then(|v| v.as_str())
                .map(|id| id == chapter_id)
                .unwrap_or(false);
            // extra.sourceFile 引用被删章节文件路径
            let matches_source_file = obj
                .get("sourceFile")
                .and_then(|v| v.as_str())
                .map(|sf| sf == normalized)
                .unwrap_or(false);
            if matches_chapter_id || matches_source_file {
                Some(node.id.clone())
            } else {
                None
            }
        })
        .collect();

    // 从 codex_to_chapters 中清理引用此 chapter_id 的条目
    for vec in manifest.reverse_index.codex_to_chapters.values_mut() {
        vec.retain(|id| id != &chapter_id);
    }
    // 清理空 Vec 的 key,避免反向索引膨胀
    manifest
        .reverse_index
        .codex_to_chapters
        .retain(|_, v| !v.is_empty());

    // 移除 chapter_to_timeline_nodes 中的 chapter_id 条目
    manifest
        .reverse_index
        .chapter_to_timeline_nodes
        .remove(&chapter_id);

    save_manifest(&path, &mut manifest)?;

    Ok(ChapterCleanupResult {
        chapter_id,
        timeline_node_ids,
        graph_node_ids,
    })
}

/// 查找指定 codexId 关联的章节文件路径列表(Task 4.4 内部辅助)
///
/// 输入:
///   project_path - 项目根目录路径
///   codex_id - 设定库卡片 UUID
/// 输出: Result<Vec<String>, AppError> 关联章节的 source_file 列表(正斜杠格式)
/// 流程:
///   1. 加载 manifest
///   2. 从 codex_to_chapters 反向索引中取出 chapter_id 列表
///   3. 在 entities.chapters 中按 id 查找对应的 source_file
///   4. 返回有效(存在)的章节文件路径列表
/// 用途: 供 codex::crud::delete_codex_entity 在删除卡片前确定需要清理 Mention 的章节范围
pub fn find_chapter_paths_by_codex_id(
    project_path: &Path,
    codex_id: &str,
) -> Result<Vec<String>, AppError> {
    let manifest = load_manifest(project_path)?;
    let chapter_ids = manifest
        .reverse_index
        .codex_to_chapters
        .get(codex_id)
        .cloned()
        .unwrap_or_default();

    if chapter_ids.is_empty() {
        return Ok(Vec::new());
    }

    // 在 chapters 实体数组中按 id 查找 source_file
    let paths: Vec<String> = manifest
        .entities
        .chapters
        .iter()
        .filter(|c| chapter_ids.iter().any(|id| id == &c.id))
        .map(|c| c.source_file.clone())
        .collect();
    Ok(paths)
}

/// 清理指定 codexId 在 manifest 中的所有记录(Task 4.4 内部辅助)
///
/// 输入:
///   project_path - 项目根目录路径
///   codex_id - 设定库卡片 UUID
///   source_file - 卡片文件相对路径(用于按 source_file 移除 codex 实体记录)
/// 输出: Result<(), AppError> 清理结果
/// 流程:
///   1. 加载 manifest
///   2. 从 entities.codex 中移除 id 匹配的记录(冗余保护,优先按 id 移除)
///   3. 从 entities.codex 中移除 source_file 匹配的记录(兼容旧数据 id 缺失场景)
///   4. 从 codex_to_graph_nodes 反向索引中移除该 codex_id 条目
///   5. 从 codex_to_chapters 反向索引中移除该 codex_id 条目
///   6. 原子保存 manifest
/// 用途: 供 codex::crud::delete_codex_entity 在删除卡片文件后调用,统一清理 manifest 残留
pub fn purge_codex_from_manifest(
    project_path: &Path,
    codex_id: &str,
    source_file: &str,
) -> Result<(), AppError> {
    let mut manifest = load_manifest(project_path)?;
    let normalized = normalize_to_forward_slash(source_file);

    // 从 codex 数组中移除匹配 id 或 source_file 的记录
    let before = manifest.entities.codex.len();
    manifest
        .entities
        .codex
        .retain(|e| e.id != codex_id && e.source_file != normalized);
    let changed = manifest.entities.codex.len() != before;

    // 清理反向索引
    let removed_graph = manifest
        .reverse_index
        .codex_to_graph_nodes
        .remove(codex_id)
        .is_some();
    let removed_chapters = manifest
        .reverse_index
        .codex_to_chapters
        .remove(codex_id)
        .is_some();

    if changed || removed_graph || removed_chapters {
        save_manifest(project_path, &mut manifest)?;
    }
    Ok(())
}

// ===== 单元测试 =====

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证 Manifest::default 生成合法 projectId 与空实体集合
    #[test]
    fn test_manifest_default() {
        let m = Manifest::default();
        assert_eq!(m.schema_version, SCHEMA_VERSION);
        assert!(!m.project_id.is_empty());
        assert!(m.entities.chapters.is_empty());
        assert!(m.entities.codex.is_empty());
        assert!(m.reverse_index.codex_to_graph_nodes.is_empty());
    }

    /// 验证 select_entity_vec_mut 对 6 种合法类型返回 Some,未知类型返回 None
    #[test]
    fn test_select_entity_vec_mut() {
        let mut entities = ManifestEntities::default();
        assert!(select_entity_vec_mut(&mut entities, "chapter").is_some());
        assert!(select_entity_vec_mut(&mut entities, "outline").is_some());
        assert!(select_entity_vec_mut(&mut entities, "codex").is_some());
        assert!(select_entity_vec_mut(&mut entities, "graph_node").is_some());
        assert!(select_entity_vec_mut(&mut entities, "timeline_node").is_some());
        assert!(select_entity_vec_mut(&mut entities, "foreshadowing").is_some());
        assert!(select_entity_vec_mut(&mut entities, "unknown").is_none());
    }

    /// 验证 is_chapter_file 正确识别正文目录下的章节文件
    #[test]
    fn test_is_chapter_file() {
        assert!(is_chapter_file("正文/第一章.pmd"));
        assert!(is_chapter_file("正文/第一卷/第一章.txt"));
        // Windows 反斜杠路径
        assert!(is_chapter_file("正文\\第一卷\\第一章.pmd"));
        // 非章节文件
        assert!(!is_chapter_file("设定/角色.md"));
        assert!(!is_chapter_file("正文/章节.md"));
        assert!(!is_chapter_file("草稿箱/废弃.txt"));
    }

    /// 验证 update_reverse_index 的 Add/Remove 行为
    #[test]
    fn test_update_reverse_index() {
        let mut m = Manifest::default();

        // Add: 追加一条 graph_node 引用
        update_reverse_index(
            &mut m,
            "codex-1",
            ReverseIndexAction::Add,
            "graph_node",
            "node-1",
        );
        assert_eq!(
            m.reverse_index.codex_to_graph_nodes.get("codex-1"),
            Some(&vec!["node-1".to_string()])
        );

        // Add 重复 id 幂等
        update_reverse_index(
            &mut m,
            "codex-1",
            ReverseIndexAction::Add,
            "graph_node",
            "node-1",
        );
        assert_eq!(
            m.reverse_index.codex_to_graph_nodes.get("codex-1"),
            Some(&vec!["node-1".to_string()])
        );

        // Add 第二个 node
        update_reverse_index(
            &mut m,
            "codex-1",
            ReverseIndexAction::Add,
            "graph_node",
            "node-2",
        );
        assert_eq!(
            m.reverse_index.codex_to_graph_nodes.get("codex-1"),
            Some(&vec!["node-1".to_string(), "node-2".to_string()])
        );

        // Remove 一个 node
        update_reverse_index(
            &mut m,
            "codex-1",
            ReverseIndexAction::Remove,
            "graph_node",
            "node-1",
        );
        assert_eq!(
            m.reverse_index.codex_to_graph_nodes.get("codex-1"),
            Some(&vec!["node-2".to_string()])
        );

        // Remove 最后一个 node,Vec 空时 key 应被清理
        update_reverse_index(
            &mut m,
            "codex-1",
            ReverseIndexAction::Remove,
            "graph_node",
            "node-2",
        );
        assert!(m.reverse_index.codex_to_graph_nodes.get("codex-1").is_none());

        // 未知 target_type 静默忽略
        update_reverse_index(
            &mut m,
            "codex-1",
            ReverseIndexAction::Add,
            "unknown",
            "x",
        );
        assert!(m.reverse_index.codex_to_graph_nodes.is_empty());
    }

    /// 验证 Manifest 序列化为 camelCase 字段名
    #[test]
    fn test_manifest_serializes_camel_case() {
        let m = Manifest::default();
        let json = serde_json::to_string(&m).expect("序列化应成功");
        assert!(json.contains("\"schemaVersion\""), "应包含 schemaVersion");
        assert!(json.contains("\"projectId\""), "应包含 projectId");
        assert!(json.contains("\"updatedAt\""), "应包含 updatedAt");
        assert!(json.contains("\"reverseIndex\""), "应包含 reverseIndex");
        assert!(
            json.contains("\"codexToGraphNodes\""),
            "应包含 codexToGraphNodes"
        );
    }
}
