// src-tauri/src/character_graph_commands.rs
//
// 人物关系图编辑器 Data 层 Rust 命令实现模块
// 提供 read_character_graph / save_character_graph / clear_character_graph 三个 Tauri 命令,
// 实现原子写入、崩溃恢复、schema 迁移、数据完整性校验。
// Task 6.4: 摘要不再随保存硬编码写入 .txt 文件, 改由 generate_graph_summary 命令按需生成;
//           generate_graph_summary 命令统一处理 timeline / character_graph 两种图谱类型。
//
// 架构复用: 与 timeline_commands.rs 保持一致的实现模式, 仅业务字段替换为角色/关系领域。

use std::fs;
use std::path::{Path, PathBuf};
use chrono::Local;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// 关系类型说明:
/// 后端不再使用枚举, relation_type 字段为 String, 支持用户自定义关系类型.
/// 前端维护内置关系类型列表(BUILTIN_RELATION_TYPES)与自定义关系类型(localStorage 持久化),
/// 序列化时存储关系类型的标识字符串(如 "master"/"enemy"/自定义 id).
/// 此设计避免后端枚举无法反序列化自定义值的问题, 同时保留前端类型安全(内置类型仍为联合字面量).

/// 角色节点业务数据载荷(与前端 CharacterGraphNodeData 字段一致)
/// serde rename_all = "camelCase": 前端 TS 接口使用驼峰命名(accentColor/sourceFile/codexId/createdAt/updatedAt),
///   Rust 端字段使用 snake_case, 通过此属性自动双向转换, 保证反序列化不报 "missing field" 错误。
/// Task 1.7.2: 派生 JsonSchema 用于自动生成前端 TS 类型与 CI 一致性校验
/// Task 4.1.2: 新增 codex_id 字段(Option<String>), 作为节点与设定库卡片的强关联主键,
///             替代旧版仅依赖 source_file 字符串路径的弱关联方式, 解决数据孤岛问题。
///             保留 source_file 用于抽屉中的只读显示, codex_id 为业务联动主键。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CharacterNodeData {
    pub name: String,
    #[serde(default)]
    pub identity: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub brief: String,
    #[serde(default = "default_accent_color")]
    pub accent_color: String,
    #[serde(default)]
    pub source_file: String,
    /// 关联的设定库卡片 UUID(Task 4.1.2 新增)
    /// 通过 manifest 反向索引实现节点与设定库卡片的双向联动;
    /// None 表示未关联(旧数据迁移时由 read_character_graph 通过 source_file 反查 manifest 填充)
    #[serde(default)]
    pub codex_id: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

/// 默认强调色(主色蓝 #6EA8FE, 与前端 DEFAULT_NODE_ACCENT 一致)
fn default_accent_color() -> String {
    "#6EA8FE".to_string()
}

/// 节点坐标(React Flow position 字段)
/// Task 1.7.2: 派生 JsonSchema 用于自动生成前端 TS 类型与 CI 一致性校验
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct NodePosition {
    pub x: f64,
    pub y: f64,
}

/// 持久化节点结构(包含位置与业务数据)
/// rename_all = "camelCase" 与前端 React Flow Node 结构对齐
/// Task 1.7.2: 派生 JsonSchema 用于自动生成前端 TS 类型与 CI 一致性校验
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PersistedNode {
    pub id: String,
    pub position: NodePosition,
    pub data: CharacterNodeData,
    /// 节点类型标识(前端 React Flow Node.type, 如 "characterNode")
    /// 使用 default + skip_serializing_if 保证旧数据(无此字段)可读取, 且不写出空值
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
}

/// 边业务数据载荷(与前端 Edge.data 字段一致, 必须包裹在 data 内)
/// rename_all = "camelCase": relation_type ↔ relationType 双向匹配
/// Task 1.7.2: 派生 JsonSchema 用于自动生成前端 TS 类型与 CI 一致性校验
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PersistedEdgeData {
    pub relation_type: String,
    #[serde(default)]
    pub description: String,
}

/// 持久化边结构(匹配 React Flow Edge 结构, 含 data 包裹层)
/// rename_all = "camelCase" 统一处理 sourceHandle/targetHandle 与 type 字段,
///   移除单独的 rename 属性, 由 rename_all 统一管理, 避免属性重复。
/// source_handle/target_handle: Handle 唯一标识(如 "left-target"/"right-source"),
///   用于精确追踪连线参与的具体 Handle, 支持同向端点连接的渲染。
///   使用 #[serde(default)] 保证旧版数据(无此字段)可正常反序列化。
/// Task 1.7.2: 派生 JsonSchema 用于自动生成前端 TS 类型与 CI 一致性校验
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PersistedEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_handle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_handle: Option<String>,
    pub data: PersistedEdgeData,
    /// 边类型标识(前端 React Flow Edge.type, 如 "characterEdge")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
}

/// 人物关系图谱根结构(对应 character_graph.json 文件)
/// rename_all = "camelCase": 前端 CharacterGraph 接口使用 schemaVersion/projectId/projectName/updatedAt,
///   Rust 端字段使用 snake_case, 通过此属性自动双向转换。
/// Task 1.7.2: 派生 JsonSchema 用于自动生成前端 TS 类型与 CI 一致性校验
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CharacterGraph {
    pub schema_version: i32,
    pub project_id: String,
    pub project_name: String,
    pub updated_at: String,
    pub nodes: Vec<PersistedNode>,
    pub edges: Vec<PersistedEdge>,
}

impl Default for CharacterGraph {
    fn default() -> Self {
        Self {
            schema_version: 1,
            project_id: String::new(),
            project_name: String::new(),
            updated_at: Local::now().to_rfc3339(),
            nodes: Vec::new(),
            edges: Vec::new(),
        }
    }
}

/// 当前支持的 schema 版本(用于迁移判定)
const LATEST_SCHEMA_VERSION: i32 = 1;

/// 构建人物关系图目录路径
/// 输入: project_root 项目根路径
/// 输出: 人物关系图目录的完整路径
fn character_graph_dir(project_root: &str) -> PathBuf {
    Path::new(project_root).join("人物关系图")
}

/// 构建 character_graph.json 文件路径
/// 输入: project_root 项目根路径
/// 输出: character_graph.json 完整路径
fn character_graph_json_path(project_root: &str) -> PathBuf {
    character_graph_dir(project_root).join("character_graph.json")
}

/// 读取人物关系图谱(含崩溃恢复与 schema 迁移)
/// 输入: project_root 项目根路径
/// 输出: Result<CharacterGraph, AppError> 图谱数据或错误信息
/// 流程:
///   1. 检查并清理 character_graph.json.tmp 残留(上次写入崩溃)
///   2. 文件不存在时返回空图谱(兼容新项目)
///   3. 读取并反序列化 JSON
///   4. 自动迁移到最新 schema 版本(当前为 1)
///   5. Task 4.1.4: 对没有 codexId 的节点, 通过 sourceFile 反查 manifest 填充 codexId
///      (manifest 中无对应记录则留空, 不报错; 反查失败仅记录日志, 不影响主流程)
#[tauri::command]
pub fn read_character_graph(project_root: String) -> Result<CharacterGraph, AppError> {
    let json_path = character_graph_json_path(&project_root);
    let tmp_path = json_path.with_extension("json.tmp");

    // 步骤1: 清理崩溃残留的临时文件
    if tmp_path.exists() {
        let _ = fs::remove_file(&tmp_path);
    }

    // 步骤2: 文件不存在时返回空图谱
    if !json_path.exists() {
        return Ok(CharacterGraph::default());
    }

    // 步骤3: 读取并反序列化
    let content = fs::read_to_string(&json_path)
        .map_err(|e| AppError::io_error(e, "读取人物关系图失败"))?;

    let graph: CharacterGraph = serde_json::from_str(&content)
        .map_err(|e| AppError::serialize_error(e, "解析人物关系图 JSON 失败"))?;

    // 步骤4: 自动 schema 迁移
    let mut graph = if graph.schema_version < LATEST_SCHEMA_VERSION {
        migrate_schema(graph, LATEST_SCHEMA_VERSION)?
    } else if graph.schema_version > LATEST_SCHEMA_VERSION {
        return Err(AppError::config_error(format!(
            "不支持的 schema 版本: {}(当前最高支持版本 {})",
            graph.schema_version, LATEST_SCHEMA_VERSION
        )));
    } else {
        graph
    };

    // 步骤5: Task 4.1.4 旧数据迁移 - 对没有 codexId 的节点通过 sourceFile 反查 manifest 填充
    // 设计说明:
    //   - 仅对 codex_id 为 None 或空且 source_file 非空的节点执行反查, 避免无谓 IO
    //   - 反查失败(manifest 加载失败或无匹配记录)时静默跳过, 保留原 None 值
    //   - 此迁移仅在内存中完成, 不主动落盘; 待用户下次编辑触发 save_character_graph 时持久化
    migrate_codex_id_from_manifest(&project_root, &mut graph);

    Ok(graph)
}

/// 旧图谱数据迁移: 通过 sourceFile 反查 manifest 填充 codexId(Task 4.1.4)
///
/// 输入:
///   project_root - 项目根路径
///   graph - 图谱可变引用(函数内对节点 codex_id 字段做就地填充)
/// 输出: 无(直接修改 graph.nodes 中各节点的 codex_id 字段)
/// 流程:
///   1. 遍历 graph.nodes, 筛选 codex_id 为 None/空且 source_file 非空的节点
///   2. 对每个待迁移节点, 调用 manifest::find_codex_id_by_source_file 反查 codex UUID
///   3. 反查成功则填充 codex_id; 失败则静默跳过(保留原值)
/// 设计说明:
///   - 仅对需要迁移的节点执行反查, 减少不必要的 manifest IO
///   - manifest 加载失败时 find_codex_id_by_source_file 返回 None, 静默跳过
///   - 此函数不抛错, 保证 read_character_graph 主流程不受 manifest 异常影响
fn migrate_codex_id_from_manifest(project_root: &str, graph: &mut CharacterGraph) {
    let project_path = Path::new(project_root);
    let mut migrated_count: u32 = 0;

    for node in graph.nodes.iter_mut() {
        // 跳过已有 codexId 的节点(包括 Some(空字符串) 视为已关联, 不重复反查)
        let already_has_codex = node
            .data
            .codex_id
            .as_ref()
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        if already_has_codex {
            continue;
        }

        // sourceFile 为空时无法反查, 跳过
        let source_file = node.data.source_file.as_str();
        if source_file.is_empty() {
            continue;
        }

        // 调用 manifest 反查 codex UUID, 失败时静默跳过
        if let Some(codex_id) = crate::manifest::find_codex_id_by_source_file(project_path, source_file) {
            node.data.codex_id = Some(codex_id);
            migrated_count += 1;
        }
    }

    if migrated_count > 0 {
        eprintln!(
            "[character_graph] Task 4.1.4: 已通过 sourceFile 反查 manifest 为 {} 个节点填充 codexId",
            migrated_count
        );
    }
}

/// 保存人物关系图谱(原子写入)
/// 输入: project_root 项目根路径, graph 图谱数据
/// 输出: Result<(), AppError> 成功或错误信息
/// 流程:
///   1. 校验数据完整性(节点 ID 唯一性 / 边引用)
///   2. 确保"人物关系图"目录存在
///   3. 更新 updatedAt 时间戳
///   4. 写入 character_graph.json.tmp 临时文件
///   5. 原子 rename 到 character_graph.json
/// 注: 人物关系图允许环存在(如 A 与 B 互为朋友), 不进行环检测
/// Task 1.9.2: 保存时强制写入 LATEST_SCHEMA_VERSION,确保后续 load 可正确识别版本
/// Task 6.4: 删除保存时自动写入 _人物关系图摘要.txt 的逻辑, 摘要改由 generate_graph_summary 命令按需生成
#[tauri::command]
pub fn save_character_graph(project_root: String, mut graph: CharacterGraph) -> Result<(), AppError> {
    // 步骤1: 保存前校验数据完整性(节点 ID 唯一性 + 边引用有效性, 不做环检测)
    validate_graph(&graph)?;

    // 步骤2: 确保目录存在
    let dir = character_graph_dir(&project_root);
    fs::create_dir_all(&dir).map_err(|e| AppError::io_error(e, "创建人物关系图目录失败"))?;

    // 步骤3: 更新时间戳与 schema 版本号
    // Task 1.9.2: 强制写入最新 schema_version,保证文件落盘时即标记为当前版本,
    //            后续 read_character_graph 加载时无需再触发迁移路径
    graph.updated_at = Local::now().to_rfc3339();
    graph.schema_version = LATEST_SCHEMA_VERSION;

    // 步骤4: 序列化 JSON
    let json = serde_json::to_string_pretty(&graph)
        .map_err(|e| AppError::serialize_error(e, "序列化人物关系图失败"))?;

    let json_path = character_graph_json_path(&project_root);
    let tmp_path = json_path.with_extension("json.tmp");

    // 步骤5: 写入临时文件
    fs::write(&tmp_path, &json)
        .map_err(|e| AppError::io_error(e, "写入临时文件失败"))?;

    // 步骤6: 原子 rename(Windows NTFS 与 Linux ext4 均支持原子 rename)
    fs::rename(&tmp_path, &json_path)
        .map_err(|e| AppError::io_error(e, "原子重命名失败"))?;

    Ok(())
}

/// 删除整个人物关系图(清空操作, 需前端二次确认)
/// 输入: project_root 项目根路径
/// 输出: Result<(), AppError> 成功或错误信息
#[tauri::command]
pub fn clear_character_graph(project_root: String) -> Result<(), AppError> {
    let dir = character_graph_dir(&project_root);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| AppError::io_error(e, "删除人物关系图目录失败"))?;
    }
    Ok(())
}

/// 按需生成图谱摘要文本(Task 6.4.3)
///
/// 替代旧版 save_timeline / save_character_graph 保存时硬编码写入 _摘要.txt 的污染行为,
/// 改为由前端在需要展示摘要时(如导出、预览、统计面板)显式调用此命令获取纯文本字符串。
///
/// 输入:
///   project_path - 项目根路径
///   graph_type - 图谱类型标识:
///     "timeline"        - 剧情时间线, 读取 剧情图谱/timeline.json 并调用时间线摘要生成函数
///     "character_graph" - 人物关系图, 读取 人物关系图/character_graph.json 并调用人物关系图摘要生成函数
/// 输出:
///   Result<String, AppError> 格式化后的摘要文本(失败返回错误信息)
/// 流程:
///   1. 匹配 graph_type 参数, 不支持的类型返回配置错误
///   2. 调用对应模块的 read 函数加载图谱数据(含崩溃恢复与 schema 迁移)
///   3. 调用对应模块的 generate_summary 函数生成纯文本摘要
///   4. 仅返回字符串, 不写入任何文件
#[tauri::command]
pub fn generate_graph_summary(project_path: String, graph_type: String) -> Result<String, AppError> {
    match graph_type.as_str() {
        "timeline" => {
            // 读取剧情时间线数据(含崩溃恢复与 schema 迁移)
            let graph = crate::timeline_commands::read_timeline(project_path)?;
            // 调用时间线摘要生成函数(已改为 pub 供此命令调用)
            Ok(crate::timeline_commands::generate_summary(&graph))
        }
        "character_graph" => {
            // 读取人物关系图数据(含崩溃恢复、schema 迁移与 codexId 反查填充)
            let graph = read_character_graph(project_path)?;
            // 调用本模块摘要生成函数
            Ok(generate_summary(&graph))
        }
        other => Err(AppError::config_error(format!(
            "不支持的图谱类型: \"{}\"(仅支持 \"timeline\" 或 \"character_graph\")",
            other
        ))),
    }
}

/// 生成人物关系图文本摘要
/// 输入: graph 图谱数据
/// 输出: String 格式化的摘要文本
/// 流程: 列出所有角色与关系, 输出可读文本
fn generate_summary(graph: &CharacterGraph) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "# 人物关系图摘要 (schema v{})\n\n项目:{}\n生成时间:{}\n角色总数:{}  关系数:{}\n\n",
        graph.schema_version,
        graph.project_name,
        graph.updated_at,
        graph.nodes.len(),
        graph.edges.len()
    ));

    // 角色列表
    out.push_str("## 一、角色列表\n\n");
    for (i, n) in graph.nodes.iter().enumerate() {
        let tags_str = if n.data.tags.is_empty() {
            String::new()
        } else {
            format!("[{}]", n.data.tags.join(", "))
        };
        out.push_str(&format!(
            "[{}] {}  身份:{}  {}\n    简介:{}\n\n",
            i + 1,
            n.data.name,
            n.data.identity,
            tags_str,
            n.data.brief
        ));
    }

    // 关系列表
    out.push_str("## 二、人物关系\n\n");
    let find_name = |id: &str, g: &CharacterGraph| -> String {
        g.nodes.iter().find(|n| n.id == id)
            .map(|n| n.data.name.clone())
            .unwrap_or_else(|| id.to_string())
    };
    for e in &graph.edges {
        let desc = if e.data.description.is_empty() {
            String::new()
        } else {
            format!("  备注:{}", e.data.description)
        };
        out.push_str(&format!(
            "{} → {}  关系:{}{}\n",
            find_name(&e.source, graph),
            find_name(&e.target, graph),
            &e.data.relation_type,
            desc
        ));
    }

    out
}

/// 校验图谱数据完整性
/// 输入: graph 待校验图谱
/// 输出: Result<(), AppError> 校验通过或错误信息
/// 流程:
///   1. 检查节点 ID 唯一性
///   2. 检查边引用的节点 ID 是否存在
///   3. 不做环检测(人物关系允许环存在, 如 A 与 B 互为朋友)
pub fn validate_graph(graph: &CharacterGraph) -> Result<(), AppError> {
    use std::collections::HashSet;

    // 1. 节点 ID 唯一性
    let mut node_ids: HashSet<&str> = HashSet::new();
    for node in &graph.nodes {
        if !node_ids.insert(node.id.as_str()) {
            return Err(AppError::config_error(format!("重复的节点 ID: {}", node.id)));
        }
    }

    // 2. 边引用有效性
    for edge in &graph.edges {
        if !node_ids.contains(edge.source.as_str()) {
            return Err(AppError::config_error(format!(
                "边 {} 的 source 节点 {} 不存在",
                edge.id, edge.source
            )));
        }
        if !node_ids.contains(edge.target.as_str()) {
            return Err(AppError::config_error(format!(
                "边 {} 的 target 节点 {} 不存在",
                edge.id, edge.target
            )));
        }
    }

    Ok(())
}

/// schema 版本迁移函数
/// 输入: graph 原始图谱, target_version 目标版本
/// 输出: Result<CharacterGraph, AppError> 迁移后的图谱
/// 流程:
///   1. 若当前版本 >= 目标版本, 无需迁移直接返回
///   2. 若当前版本 < 目标版本, 按版本号匹配迁移函数
///   3. 当前仅支持 schema v1, 无更低版本迁移路径, 低版本数据返回错误
/// 注: 未来新增版本时, 在 match 中补充对应的 migrate_vN_to_vN+1 函数
pub fn migrate_schema(graph: CharacterGraph, target_version: i32) -> Result<CharacterGraph, AppError> {
    let current = graph;

    // 当前版本已达目标, 无需迁移
    if current.schema_version >= target_version {
        return Ok(current);
    }

    // 按版本号匹配迁移函数
    match current.schema_version {
        v => Err(AppError::config_error(format!(
            "无法从版本 {} 迁移到 {}（无可用迁移路径）",
            v, target_version
        ))),
    }
}
