// src-tauri/src/character_graph_commands.rs
//
// 人物关系图编辑器 Data 层 Rust 命令实现模块
// 提供 read_character_graph / save_character_graph / clear_character_graph 三个 Tauri 命令,
// 实现原子写入、崩溃恢复、schema 迁移、数据完整性校验、txt 摘要生成。
//
// 架构复用: 与 timeline_commands.rs 保持一致的实现模式, 仅业务字段替换为角色/关系领域。

use std::fs;
use std::path::{Path, PathBuf};
use chrono::Local;
use serde::{Deserialize, Serialize};

/// 角色关系类型枚举(与前端 RelationType 一一对应)
/// 注意: 关系类型枚举值序列化为小写字符串(如 "master"/"enemy"),
///       与前端 TS 联合类型字面量完全匹配, 不使用 camelCase 转换。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RelationType {
    Master,
    Enemy,
    Family,
    Friend,
    Lover,
    Subordinate,
    Fellow,
    Other,
}

impl RelationType {
    /// 显式字符串映射(避免 format!("{:?}", variant).to_lowercase() 丢失下划线)
    /// 输入: &self
    /// 输出: &'static str
    pub fn to_str(&self) -> &'static str {
        match self {
            Self::Master => "师徒",
            Self::Enemy => "敌对",
            Self::Family => "亲属",
            Self::Friend => "朋友",
            Self::Lover => "恋人",
            Self::Subordinate => "上下级",
            Self::Fellow => "同门",
            Self::Other => "其他",
        }
    }
}

/// 角色节点业务数据载荷(与前端 CharacterGraphNodeData 字段一致)
/// serde rename_all = "camelCase": 前端 TS 接口使用驼峰命名(accentColor/sourceFile/createdAt/updatedAt),
///   Rust 端字段使用 snake_case, 通过此属性自动双向转换, 保证反序列化不报 "missing field" 错误。
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodePosition {
    pub x: f64,
    pub y: f64,
}

/// 持久化节点结构(包含位置与业务数据)
/// rename_all = "camelCase" 与前端 React Flow Node 结构对齐
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedEdgeData {
    pub relation_type: RelationType,
    #[serde(default)]
    pub description: String,
}

/// 持久化边结构(匹配 React Flow Edge 结构, 含 data 包裹层)
/// rename_all = "camelCase" 统一处理 sourceHandle/targetHandle 与 type 字段,
///   移除单独的 rename 属性, 由 rename_all 统一管理, 避免属性重复。
/// source_handle/target_handle: Handle 唯一标识(如 "left-target"/"right-source"),
///   用于精确追踪连线参与的具体 Handle, 支持同向端点连接的渲染。
///   使用 #[serde(default)] 保证旧版数据(无此字段)可正常反序列化。
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// 构建 _人物关系图摘要.txt 文件路径
/// 输入: project_root 项目根路径
/// 输出: 摘要文件完整路径
fn character_graph_summary_path(project_root: &str) -> PathBuf {
    character_graph_dir(project_root).join("_人物关系图摘要.txt")
}

/// 读取人物关系图谱(含崩溃恢复与 schema 迁移)
/// 输入: project_root 项目根路径
/// 输出: Result<CharacterGraph, String> 图谱数据或错误信息
/// 流程:
///   1. 检查并清理 character_graph.json.tmp 残留(上次写入崩溃)
///   2. 文件不存在时返回空图谱(兼容新项目)
///   3. 读取并反序列化 JSON
///   4. 自动迁移到最新 schema 版本(当前为 1)
#[tauri::command]
pub fn read_character_graph(project_root: String) -> Result<CharacterGraph, String> {
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
        .map_err(|e| format!("读取人物关系图失败: {}", e))?;

    let graph: CharacterGraph = serde_json::from_str(&content)
        .map_err(|e| format!("解析人物关系图 JSON 失败: {}", e))?;

    // 步骤4: 自动 schema 迁移
    let graph = if graph.schema_version < LATEST_SCHEMA_VERSION {
        migrate_schema(graph, LATEST_SCHEMA_VERSION)?
    } else if graph.schema_version > LATEST_SCHEMA_VERSION {
        return Err(format!(
            "不支持的 schema 版本: {}(当前最高支持版本 {})",
            graph.schema_version, LATEST_SCHEMA_VERSION
        ));
    } else {
        graph
    };

    Ok(graph)
}

/// 保存人物关系图谱(原子写入 + 自动生成 txt 摘要)
/// 输入: project_root 项目根路径, graph 图谱数据
/// 输出: Result<(), String> 成功或错误信息
/// 流程:
///   1. 校验数据完整性(节点 ID 唯一性 / 边引用)
///   2. 确保"人物关系图"目录存在
///   3. 更新 updatedAt 时间戳
///   4. 写入 character_graph.json.tmp 临时文件
///   5. 原子 rename 到 character_graph.json
///   6. 调用 generate_summary 生成 txt 摘要(失败不阻塞)
/// 注: 人物关系图允许环存在(如 A 与 B 互为朋友), 不进行环检测
#[tauri::command]
pub fn save_character_graph(project_root: String, mut graph: CharacterGraph) -> Result<(), String> {
    // 步骤1: 保存前校验数据完整性(节点 ID 唯一性 + 边引用有效性, 不做环检测)
    validate_graph(&graph)?;

    // 步骤2: 确保目录存在
    let dir = character_graph_dir(&project_root);
    fs::create_dir_all(&dir).map_err(|e| format!("创建人物关系图目录失败: {}", e))?;

    // 步骤3: 更新时间戳
    graph.updated_at = Local::now().to_rfc3339();

    // 步骤4: 序列化 JSON
    let json = serde_json::to_string_pretty(&graph)
        .map_err(|e| format!("序列化人物关系图失败: {}", e))?;

    let json_path = character_graph_json_path(&project_root);
    let tmp_path = json_path.with_extension("json.tmp");

    // 步骤5: 写入临时文件
    fs::write(&tmp_path, &json)
        .map_err(|e| format!("写入临时文件失败: {}", e))?;

    // 步骤6: 原子 rename(Windows NTFS 与 Linux ext4 均支持原子 rename)
    fs::rename(&tmp_path, &json_path)
        .map_err(|e| format!("原子重命名失败: {}", e))?;

    // 步骤7: 生成 txt 摘要(失败不影响主流程)
    let summary = generate_summary(&graph);
    let _ = fs::write(character_graph_summary_path(&project_root), summary);

    Ok(())
}

/// 删除整个人物关系图(清空操作, 需前端二次确认)
/// 输入: project_root 项目根路径
/// 输出: Result<(), String> 成功或错误信息
#[tauri::command]
pub fn clear_character_graph(project_root: String) -> Result<(), String> {
    let dir = character_graph_dir(&project_root);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("删除人物关系图目录失败: {}", e))?;
    }
    Ok(())
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
            e.data.relation_type.to_str(),
            desc
        ));
    }

    out
}

/// 校验图谱数据完整性
/// 输入: graph 待校验图谱
/// 输出: Result<(), String> 校验通过或错误信息
/// 流程:
///   1. 检查节点 ID 唯一性
///   2. 检查边引用的节点 ID 是否存在
///   3. 不做环检测(人物关系允许环存在, 如 A 与 B 互为朋友)
pub fn validate_graph(graph: &CharacterGraph) -> Result<(), String> {
    use std::collections::HashSet;

    // 1. 节点 ID 唯一性
    let mut node_ids: HashSet<&str> = HashSet::new();
    for node in &graph.nodes {
        if !node_ids.insert(node.id.as_str()) {
            return Err(format!("重复的节点 ID: {}", node.id));
        }
    }

    // 2. 边引用有效性
    for edge in &graph.edges {
        if !node_ids.contains(edge.source.as_str()) {
            return Err(format!("边 {} 的 source 节点 {} 不存在", edge.id, edge.source));
        }
        if !node_ids.contains(edge.target.as_str()) {
            return Err(format!("边 {} 的 target 节点 {} 不存在", edge.id, edge.target));
        }
    }

    Ok(())
}

/// schema 版本迁移函数
/// 输入: graph 原始图谱, target_version 目标版本
/// 输出: Result<CharacterGraph, String> 迁移后的图谱
/// 流程:
///   1. 若当前版本 >= 目标版本, 无需迁移直接返回
///   2. 若当前版本 < 目标版本, 按版本号匹配迁移函数
///   3. 当前仅支持 schema v1, 无更低版本迁移路径, 低版本数据返回错误
/// 注: 未来新增版本时, 在 match 中补充对应的 migrate_vN_to_vN+1 函数
pub fn migrate_schema(graph: CharacterGraph, target_version: i32) -> Result<CharacterGraph, String> {
    let current = graph;

    // 当前版本已达目标, 无需迁移
    if current.schema_version >= target_version {
        return Ok(current);
    }

    // 按版本号匹配迁移函数
    match current.schema_version {
        v => Err(format!(
            "无法从版本 {} 迁移到 {}（无可用迁移路径）",
            v, target_version
        )),
    }
}
