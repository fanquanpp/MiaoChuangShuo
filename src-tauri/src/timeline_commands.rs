// src-tauri/src/timeline_commands.rs
//
// 剧情时间线编辑器 Data 层 Rust 命令实现模块
// 提供 read_timeline / save_timeline / clear_timeline 三个 Tauri 命令,
// 实现原子写入、崩溃恢复、schema 迁移、数据完整性校验、txt 摘要生成。

use std::fs;
use std::path::{Path, PathBuf};
use chrono::Local;
use serde::{Deserialize, Serialize};

/// 剧情节点类型枚举(与前端 TimelineNodeType 一一对应)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TimelineNodeType {
    Main,
    Branch,
    Event,
    Ending,
}

impl TimelineNodeType {
    /// 显式字符串映射(避免 format!("{:?}", variant).to_lowercase() 丢失下划线)
    /// 输入: &self
    /// 输出: &'static str
    pub fn to_str(&self) -> &'static str {
        match self {
            Self::Main => "main",
            Self::Branch => "branch",
            Self::Event => "event",
            Self::Ending => "ending",
        }
    }
}

/// 节点状态枚举
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NodeStatus {
    Planned,
    Writing,
    Done,
}

/// 剧情节点业务数据载荷(与前端 TimelineNodeData 字段一致)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineNodeData {
    pub title: String,
    pub node_type: TimelineNodeType,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub core_conflict: String,
    #[serde(default = "default_empty_string")]
    pub foreshadowing: String,
    pub status: NodeStatus,
    pub order: i32,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub child_count: i32,
    pub created_at: String,
    pub updated_at: String,
}

/// 默认空字符串(用于 serde default 属性)
fn default_empty_string() -> String {
    String::new()
}

/// 节点坐标(React Flow position 字段)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodePosition {
    pub x: f64,
    pub y: f64,
}

/// 持久化节点结构(包含位置与业务数据)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedNode {
    pub id: String,
    pub position: NodePosition,
    pub data: TimelineNodeData,
}

/// 边业务数据载荷(与前端 Edge.data 字段一致, 必须包裹在 data 内)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedEdgeData {
    pub edge_kind: TimelineNodeType,
}

/// 持久化边结构(匹配 React Flow Edge 结构, 含 data 包裹层)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub data: PersistedEdgeData,
}

/// 剧情图谱根结构(对应 timeline.json 文件)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineGraph {
    pub schema_version: i32,
    pub project_id: String,
    pub project_name: String,
    pub updated_at: String,
    pub nodes: Vec<PersistedNode>,
    pub edges: Vec<PersistedEdge>,
}

impl Default for TimelineGraph {
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

/// 构建剧情图谱目录路径
/// 输入: project_root 项目根路径
/// 输出: 剧情图谱目录的完整路径
fn timeline_dir(project_root: &str) -> PathBuf {
    Path::new(project_root).join("剧情图谱")
}

/// 构建 timeline.json 文件路径
/// 输入: project_root 项目根路径
/// 输出: timeline.json 完整路径
fn timeline_json_path(project_root: &str) -> PathBuf {
    timeline_dir(project_root).join("timeline.json")
}

/// 构建 _剧情时间线摘要.txt 文件路径
/// 输入: project_root 项目根路径
/// 输出: 摘要文件完整路径
fn timeline_summary_path(project_root: &str) -> PathBuf {
    timeline_dir(project_root).join("_剧情时间线摘要.txt")
}

/// 读取剧情图谱(含崩溃恢复与 schema 迁移)
/// 输入: project_root 项目根路径
/// 输出: Result<TimelineGraph, String> 图谱数据或错误信息
/// 流程:
///   1. 检查并清理 timeline.json.tmp 残留(上次写入崩溃)
///   2. 文件不存在时返回空图谱(兼容新项目)
///   3. 读取并反序列化 JSON
///   4. 自动迁移到最新 schema 版本(当前为 1)
#[tauri::command]
pub fn read_timeline(project_root: String) -> Result<TimelineGraph, String> {
    let json_path = timeline_json_path(&project_root);
    let tmp_path = json_path.with_extension("json.tmp");

    // 步骤1: 清理崩溃残留的临时文件
    if tmp_path.exists() {
        let _ = fs::remove_file(&tmp_path);
    }

    // 步骤2: 文件不存在时返回空图谱
    if !json_path.exists() {
        return Ok(TimelineGraph::default());
    }

    // 步骤3: 读取并反序列化
    let content = fs::read_to_string(&json_path)
        .map_err(|e| format!("读取时间线失败: {}", e))?;

    let graph: TimelineGraph = serde_json::from_str(&content)
        .map_err(|e| format!("解析时间线 JSON 失败: {}", e))?;

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

/// 保存剧情图谱(原子写入 + 自动生成 txt 摘要)
/// 输入: project_root 项目根路径, graph 图谱数据
/// 输出: Result<(), String> 成功或错误信息
/// 流程:
///   1. 校验数据完整性(节点 ID 唯一性 / 边引用 / 环检测)
///   2. 确保"剧情图谱"目录存在
///   3. 更新 updatedAt 时间戳
///   4. 写入 timeline.json.tmp 临时文件
///   5. 原子 rename 到 timeline.json
///   6. 调用 generate_summary 生成 txt 摘要(失败不阻塞)
#[tauri::command]
pub fn save_timeline(project_root: String, mut graph: TimelineGraph) -> Result<(), String> {
    // 步骤1: 保存前校验数据完整性(含环检测)
    validate_graph(&graph)?;

    // 步骤2: 确保目录存在
    let dir = timeline_dir(&project_root);
    fs::create_dir_all(&dir).map_err(|e| format!("创建剧情图谱目录失败: {}", e))?;

    // 步骤3: 更新时间戳
    graph.updated_at = Local::now().to_rfc3339();

    // 步骤4: 序列化 JSON
    let json = serde_json::to_string_pretty(&graph)
        .map_err(|e| format!("序列化时间线失败: {}", e))?;

    let json_path = timeline_json_path(&project_root);
    let tmp_path = json_path.with_extension("json.tmp");

    // 步骤5: 写入临时文件
    fs::write(&tmp_path, &json)
        .map_err(|e| format!("写入临时文件失败: {}", e))?;

    // 步骤6: 原子 rename(Windows NTFS 与 Linux ext4 均支持原子 rename)
    fs::rename(&tmp_path, &json_path)
        .map_err(|e| format!("原子重命名失败: {}", e))?;

    // 步骤7: 生成 txt 摘要(失败不影响主流程)
    let summary = generate_summary(&graph);
    let _ = fs::write(timeline_summary_path(&project_root), summary);

    Ok(())
}

/// 删除整个剧情图谱(清空操作, 需前端二次确认)
/// 输入: project_root 项目根路径
/// 输出: Result<(), String> 成功或错误信息
#[tauri::command]
pub fn clear_timeline(project_root: String) -> Result<(), String> {
    let dir = timeline_dir(&project_root);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("删除剧情图谱目录失败: {}", e))?;
    }
    Ok(())
}

/// 生成剧情时间线文本摘要
/// 输入: graph 图谱数据
/// 输出: String 格式化的摘要文本
/// 流程: 按 main/branch/event/ending 分类汇总, 输出可读文本
fn generate_summary(graph: &TimelineGraph) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "# 剧情时间线摘要 (schema v{})\n\n项目:{}\n生成时间:{}\n节点总数:{}  连线数:{}\n\n",
        graph.schema_version,
        graph.project_name,
        graph.updated_at,
        graph.nodes.len(),
        graph.edges.len()
    ));

    // 主线脉络(按 order 排序)
    let mut mains: Vec<&PersistedNode> = graph.nodes.iter()
        .filter(|n| n.data.node_type == TimelineNodeType::Main)
        .collect();
    mains.sort_by_key(|n| n.data.order);

    out.push_str("## 一、主线脉络\n\n");
    for (i, n) in mains.iter().enumerate() {
        out.push_str(&format!(
            "[{}] {}\n    状态:{}  摘要:{}\n    核心冲突:{}\n    伏笔:{}\n\n",
            i + 1, n.data.title,
            match n.data.status {
                NodeStatus::Planned => "未开始",
                NodeStatus::Writing => "写作中",
                NodeStatus::Done => "完稿",
            },
            n.data.summary, n.data.core_conflict, n.data.foreshadowing
        ));
    }

    out.push_str("## 二、分支剧情\n\n");
    for n in graph.nodes.iter().filter(|n| n.data.node_type == TimelineNodeType::Branch) {
        out.push_str(&format!("[番外] {}\n    摘要:{}\n\n", n.data.title, n.data.summary));
    }

    out.push_str("## 三、关键事件\n\n");
    for n in graph.nodes.iter().filter(|n| n.data.node_type == TimelineNodeType::Event) {
        out.push_str(&format!("[事件] {}\n    摘要:{}\n\n", n.data.title, n.data.summary));
    }

    out.push_str("## 四、结局\n\n");
    for n in graph.nodes.iter().filter(|n| n.data.node_type == TimelineNodeType::Ending) {
        out.push_str(&format!("[结局] {}\n    摘要:{}\n\n", n.data.title, n.data.summary));
    }

    out.push_str("## 五、连线关系\n\n");
    let find_title = |id: &str, g: &TimelineGraph| -> String {
        g.nodes.iter().find(|n| n.id == id)
            .map(|n| n.data.title.clone())
            .unwrap_or_else(|| id.to_string())
    };
    for e in &graph.edges {
        out.push_str(&format!(
            "{} → {}  类型:{}\n",
            find_title(&e.source, graph),
            find_title(&e.target, graph),
            e.data.edge_kind.to_str()
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
///   3. 检查是否存在环(DFS 三色标记法)
pub fn validate_graph(graph: &TimelineGraph) -> Result<(), String> {
    use std::collections::{HashMap, HashSet};

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

    // 3. 环检测(DFS 三色标记法)
    //    White=未访问, Gray=访问中(在当前路径上), Black=已完成
    #[derive(PartialEq)]
    enum Color { White, Gray, Black }

    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in &graph.edges {
        adj.entry(edge.source.as_str())
            .or_default()
            .push(edge.target.as_str());
    }

    let mut colors: HashMap<&str, Color> = HashMap::new();
    for node in &graph.nodes {
        colors.insert(node.id.as_str(), Color::White);
    }

    fn dfs<'a>(
        u: &'a str,
        adj: &HashMap<&'a str, Vec<&'a str>>,
        colors: &mut HashMap<&'a str, Color>,
    ) -> bool {
        colors.insert(u, Color::Gray);
        for &v in adj.get(u).unwrap_or(&vec![]) {
            match colors.get(v) {
                Some(Color::Gray) => return true,  // 后边 → 存在环
                Some(Color::White) => {
                    if dfs(v, adj, colors) { return true; }
                }
                _ => {}  // Black = 已处理, 跳过
            }
        }
        colors.insert(u, Color::Black);
        false
    }

    for node in &graph.nodes {
        if colors.get(node.id.as_str()) == Some(&Color::White) {
            if dfs(&node.id, &adj, &mut colors) {
                return Err("图谱中存在环形依赖, 请检查连线".to_string());
            }
        }
    }

    Ok(())
}

/// schema 版本迁移函数
/// 输入: graph 原始图谱, target_version 目标版本
/// 输出: Result<TimelineGraph, String> 迁移后的图谱
/// 流程: 按版本号顺序应用迁移函数
/// 注: 当前仅版本 1, 预留迁移框架
pub fn migrate_schema(graph: TimelineGraph, target_version: i32) -> Result<TimelineGraph, String> {
    let mut current = graph;
    let mut current_version = current.schema_version;

    while current_version < target_version {
        current = match current_version {
            // 0 => migrate_v0_to_v1(current)?,  // 未来迁移示例
            _ => return Err(format!("无法从版本 {} 迁移", current_version)),
        };
        current_version = current.schema_version;
    }

    current.schema_version = target_version;
    Ok(current)
}
