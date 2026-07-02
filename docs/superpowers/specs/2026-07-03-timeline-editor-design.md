# 剧情时间线编辑器 - 设计规格文档

| 项 | 值 |
|---|---|
| 文档版本 | 1.0 |
| 创建日期 | 2026-07-03 |
| 状态 | 待实施 |
| 关联版本 | 26.7.8 |
| 技术栈 | Tauri 2.0 + React + TypeScript + Zustand + Tailwind CSS |
| 核心依赖 | @xyflow/react ^12.3.0, @dagrejs/dagre ^1.1.4, zundo ^2.2.0 |

---

## 1. 概述

### 1.1 目标

为 MiaoChuangShuo 小说创作软件新增「剧情时间线编辑器」功能模块。提供可视化画布,允许作者以节点卡片形式组织主线/分支/事件/结局,支持拖拽、连线、折叠、自动布局、撤销重做等交互。

### 1.2 范围

**包含**:
- 可视化画布(基于 React Flow)
- 四类节点(主线/分支/事件/结局)
- 自动布局(dagre)
- 撤销/重做(zundo + Zustand)
- 节点详情抽屉编辑
- 折叠/展开分支
- 右键菜单创建节点
- 本地持久化(JSON + txt 摘要)
- 快捷键(Ctrl+S/L/Z/Y, Alt+9)

**不包含**:
- 与正文章节的双向同步(远期规划)
- AI 辅助生成节点
- 多人协作
- 在线云同步

### 1.3 设计原则

1. 离线优先: 所有依赖纯前端 npm 包,零 CDN 依赖
2. 三层架构: UI / Service / Data 单向依赖
3. 类型安全: 零 any/unknown,完整泛型
4. 中文工程注释: 所有函数 JSDoc / Rust docstring 完整
5. FANDEX 设计 token: 颜色/字体/间距全部对齐项目设计规范

---

## 2. 核心数据结构

### 2.1 节点类型枚举

```typescript
// src/lib/stores/timelineTypes.ts

/**
 * 剧情时间线节点类型枚举
 * - Main: 主线节点(卷/章, 主轴水平排列)
 * - Branch: 分支节点(番外/间章/支线, 垂直分布主轴上下)
 * - Event: 事件节点(关键情节标记, 依附主线节点)
 * - Ending: 结局节点(多结局小说的终点)
 */
export type TimelineNodeType = "main" | "branch" | "event" | "ending";

/** 节点状态枚举(用于状态徽章与统计) */
export type NodeStatus = "planned" | "writing" | "done";
```

### 2.2 前端 TS 类型(React Flow 适配)

```typescript
import type { Node, Edge } from "@xyflow/react";

/**
 * 剧情节点业务数据载荷
 * 与 React Flow Node.data 字段对接,承载所有业务字段
 */
export interface TimelineNodeData {
  /** 节点标题(必填,显示在卡片顶部) */
  title: string;
  /** 节点类型(必填,决定视觉样式与布局位置) */
  nodeType: TimelineNodeType;
  /** 剧情摘要(节点详细描述,200 字内) */
  summary: string;
  /** 核心冲突(本节点的主要矛盾) */
  coreConflict: string;
  /** 伏笔备注(埋设/回收的伏笔标记) */
  foreshadowing: string;
  /** 节点状态(决定状态徽章颜色) */
  status: NodeStatus;
  /** 排序序号(同一主轴位置内的顺序) */
  order: number;
  /** 折叠状态(仅 main 节点有效,true 表示其子分支已折叠) */
  collapsed?: boolean;
  /** 子节点数量(折叠时显示为数字角标) */
  childCount?: number;
  /** 创建时间 ISO 8601 */
  createdAt: string;
  /** 最后修改时间 ISO 8601 */
  updatedAt: string;
}

/** React Flow 节点类型(带泛型,禁用 any/unknown) */
export type TimelineNode = Node<TimelineNodeData, "storyNode">;

/**
 * React Flow 边类型
 * 注意: 自定义边数据必须包裹在 data 字段内,与后端 PersistedEdge.data 对齐
 */
export type TimelineEdge = Edge<{ edgeKind: TimelineNodeType }, "storyEdge">;
```

### 2.3 持久化 JSON 结构

```typescript
/**
 * 剧情图谱持久化文件结构
 * 存储于 {project_root}/剧情图谱/timeline.json
 */
export interface TimelineGraph {
  /** 文件格式版本(用于未来迁移) */
  schemaVersion: 1;
  /** 项目唯一标识(取自项目路径,用于内部关联) */
  projectId: string;
  /** 项目名称(冗余字段,便于离线识别) */
  projectName: string;
  /** 最后修改时间 ISO 8601 */
  updatedAt: string;
  /** 节点列表(包含位置信息,与 React Flow nodes 一一对应) */
  nodes: TimelineNode[];
  /** 边列表 */
  edges: TimelineEdge[];
}
```

### 2.4 Rust 后端序列化结构

```rust
// src-tauri/src/timeline_commands.rs

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

/// 边业务数据载荷(与前端 Edge.data 字段一致,必须包裹在 data 内)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedEdgeData {
    pub edge_kind: TimelineNodeType,
}

/// 持久化边结构(匹配 React Flow Edge 结构,含 data 包裹层)
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
```

### 2.5 txt 摘要生成格式

```text
# 剧情时间线摘要 (schema v1)

项目:{projectName}
生成时间:{updatedAt}
节点总数:{nodes.length}  连线数:{edges.length}

## 一、主线脉络(按 order 排序)

[1] {title}
    状态:{status}  摘要:{summary}
    核心冲突:{coreConflict}
    伏笔:{foreshadowing}

[2] ...

## 二、分支剧情

[番外] {title}
    摘要:{summary}

## 三、关键事件

[事件] {title}
    摘要:{summary}

## 四、结局

[结局] {title}
    摘要:{summary}

## 五、连线关系

{source.title} → {target.title}  类型:{edgeKind}
```

### 2.6 命名规范

| 项 | 规范 |
|---|---|
| 目录名 | `剧情图谱`(中文,与项目其他目录一致) |
| 主数据文件 | `timeline.json`(单文件,避免文件碎片) |
| 摘要文件 | `_剧情时间线摘要.txt`(下划线前缀表示自动生成) |
| schema 版本 | `1`(整数,未来迁移通过版本号判定) |
| projectId 取值 | 取自项目根路径(路径即唯一标识,与 codex_commands 模式一致) |

---

## 3. 架构分层实现

### 3.1 三层架构总览

```
+-----------------------------------------------------------+
| UI 层 (src/components/)                                   |
|  TimelinePanel.tsx        画布容器 + 工具栏              |
|  TimelineNode.tsx          自定义节点组件                 |
|  TimelineEdge.tsx          自定义连线组件                 |
|  TimelineDrawer.tsx        节点详情抽屉                   |
|  TimelineContextMenu.tsx   右键菜单                      |
|  TimelineEmpty.tsx         空状态提示                     |
+---------------------------+-------------------------------+
                            | 仅通过 Service 层调用,禁直连后端
+---------------------------v-------------------------------+
| Service 层 (src/lib/)                                    |
|  timelineApi.ts           Tauri 命令封装(含错误处理)     |
|  stores/timelineStore.ts  Zustand + zundo 状态管理        |
|  stores/timelineTypes.ts  类型定义                        |
|  dagreLayout.ts           自动布局算法封装                |
+---------------------------+-------------------------------+
                            | invoke 调用 Tauri 命令
+---------------------------v-------------------------------+
| Data 层 (src-tauri/src/)                                |
|  timeline_commands.rs     Rust 命令实现(CRUD + 摘要)     |
|  lib.rs                   命令注册                        |
|  剧情图谱/timeline.json    本地持久化                     |
|  剧情图谱/_剧情时间线摘要.txt  自动生成摘要               |
+-----------------------------------------------------------+
```

### 3.2 Data 层 - Rust 后端命令

```rust
// src-tauri/src/timeline_commands.rs

use std::fs;
use std::path::{Path, PathBuf};
use chrono::Local;
use serde::{Deserialize, Serialize};

// (此处省略 2.4 节已定义的类型: TimelineNodeType/NodeStatus/TimelineNodeData/
//  NodePosition/PersistedNode/PersistedEdgeData/PersistedEdge/TimelineGraph)

const LATEST_SCHEMA_VERSION: i32 = 1;

/// 构建剧情图谱目录路径
/// 输入: project_root 项目根路径
/// 输出: 剧情图谱目录的完整路径
fn timeline_dir(project_root: &str) -> PathBuf {
    Path::new(project_root).join("剧情图谱")
}

/// 构建 timeline.json 文件路径
fn timeline_json_path(project_root: &str) -> PathBuf {
    timeline_dir(project_root).join("timeline.json")
}

/// 构建 _剧情时间线摘要.txt 文件路径
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

    // 清理崩溃残留的临时文件
    if tmp_path.exists() {
        let _ = fs::remove_file(&tmp_path);
    }

    if !json_path.exists() {
        return Ok(TimelineGraph::default());
    }

    let content = fs::read_to_string(&json_path)
        .map_err(|e| format!("读取时间线失败: {}", e))?;

    let graph: TimelineGraph = serde_json::from_str(&content)
        .map_err(|e| format!("解析时间线 JSON 失败: {}", e))?;

    // 自动 schema 迁移
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
    // 保存前校验数据完整性(含环检测)
    validate_graph(&graph)?;

    let dir = timeline_dir(&project_root);
    fs::create_dir_all(&dir).map_err(|e| format!("创建剧情图谱目录失败: {}", e))?;

    graph.updated_at = Local::now().to_rfc3339();

    let json = serde_json::to_string_pretty(&graph)
        .map_err(|e| format!("序列化时间线失败: {}", e))?;

    let json_path = timeline_json_path(&project_root);
    let tmp_path = json_path.with_extension("json.tmp");

    // 步骤1: 写入临时文件
    fs::write(&tmp_path, &json)
        .map_err(|e| format!("写入临时文件失败: {}", e))?;

    // 步骤2: 原子 rename(Windows NTFS 与 Linux ext4 均支持原子 rename)
    fs::rename(&tmp_path, &json_path)
        .map_err(|e| format!("原子重命名失败: {}", e))?;

    // 步骤3: 生成 txt 摘要(失败不影响主流程)
    let summary = generate_summary(&graph);
    let _ = fs::write(timeline_summary_path(&project_root), summary);

    Ok(())
}

/// 删除整个剧情图谱(清空操作,需前端二次确认)
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
/// 流程: 按 main/branch/event/ending 分类汇总,输出可读文本
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
                _ => {}  // Black = 已处理,跳过
            }
        }
        colors.insert(u, Color::Black);
        false
    }

    for node in &graph.nodes {
        if colors.get(node.id.as_str()) == Some(&Color::White) {
            if dfs(&node.id, &adj, &mut colors) {
                return Err("图谱中存在环形依赖,请检查连线".to_string());
            }
        }
    }

    Ok(())
}

/// schema 版本迁移函数
/// 输入: graph 原始图谱, target_version 目标版本
/// 输出: Result<TimelineGraph, String> 迁移后的图谱
/// 流程: 按版本号顺序应用迁移函数
/// 注: 当前仅版本 1,预留迁移框架
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
```

### 3.3 命令注册

```rust
// src-tauri/src/lib.rs (新增 timeline_commands 模块)

mod timeline_commands;

// invoke_handler 内新增注册
timeline_commands::read_timeline,
timeline_commands::save_timeline,
timeline_commands::clear_timeline,
```

### 3.4 Service 层 - API 封装

```typescript
// src/lib/timelineApi.ts

import { invoke } from "@tauri-apps/api/core";
import type { TimelineGraph, TimelineNode, TimelineEdge } from "./stores/timelineTypes";

/**
 * 读取项目剧情图谱
 * 输入: projectRoot 项目根路径(同时作为 projectId)
 * 输出: Promise<TimelineGraph> 图谱数据(不存在时返回空图谱)
 * 流程: 调用 Tauri read_timeline 命令,统一错误处理
 */
export async function readTimeline(projectRoot: string): Promise<TimelineGraph> {
  try {
    return await invoke<TimelineGraph>("read_timeline", { projectRoot });
  } catch (err) {
    throw new Error(`读取剧情图谱失败: ${String(err)}`);
  }
}

/**
 * 保存剧情图谱(自动生成 txt 摘要)
 * 输入: projectRoot 项目根路径, graph 图谱数据
 * 输出: Promise<void>
 * 流程: 调用 Tauri save_timeline 命令(含数据校验与原子写入)
 */
export async function saveTimeline(projectRoot: string, graph: TimelineGraph): Promise<void> {
  try {
    await invoke("save_timeline", { projectRoot, graph });
  } catch (err) {
    throw new Error(`保存剧情图谱失败: ${String(err)}`);
  }
}

/**
 * 清空剧情图谱(含目录删除)
 * 输入: projectRoot 项目根路径
 * 输出: Promise<void>
 * 流程: 调用 Tauri clear_timeline 命令(前端需二次确认)
 */
export async function clearTimeline(projectRoot: string): Promise<void> {
  try {
    await invoke("clear_timeline", { projectRoot });
  } catch (err) {
    throw new Error(`清空剧情图谱失败: ${String(err)}`);
  }
}

/**
 * 从 React Flow nodes/edges 数组构造 TimelineGraph 持久化结构
 * 输入: nodes React Flow 节点, edges React Flow 边,
 *       projectRoot 项目根路径(作为 projectId), projectName 项目名
 * 输出: TimelineGraph 持久化数据
 * 流程: 提取节点位置与业务数据,组装为后端可序列化结构
 */
export function buildPersistedGraph(
  nodes: TimelineNode[],
  edges: TimelineEdge[],
  projectRoot: string,
  projectName: string
): TimelineGraph {
  return {
    schemaVersion: 1,
    projectId: projectRoot,
    projectName,
    updatedAt: new Date().toISOString(),
    nodes,
    edges,
  };
}
```

### 3.5 Service 层 - Zustand Store + zundo

```typescript
// src/lib/stores/timelineStore.ts

import { create } from "zustand";
import { temporal } from "zundo";
import { applyNodeChanges, applyEdgeChanges } from "@xyflow/react";
import type { NodeChange, EdgeChange, Connection } from "@xyflow/react";
import type { TimelineNode, TimelineEdge, TimelineNodeData } from "./timelineTypes";
import { readTimeline, saveTimeline, buildPersistedGraph } from "../timelineApi";

/**
 * 时间线编辑器状态接口
 * 通过 zundo temporal 中间件包装,获得撤销/重做能力
 */
interface TimelineState {
  /** 节点列表(与 React Flow nodes 同步) */
  nodes: TimelineNode[];
  /** 边列表 */
  edges: TimelineEdge[];
  /** 当前选中节点 ID(用于抽屉联动) */
  selectedNodeId: string | null;
  /** 是否正在加载 */
  loading: boolean;
  /** 是否正在保存(防抖期间为 true) */
  saving: boolean;
  /** 保存错误信息 */
  error: string | null;

  /** 从后端加载图谱 */
  loadGraph: (projectRoot: string) => Promise<void>;
  /** 防抖保存(500ms 内多次操作合并为一次保存) */
  debouncedSave: (projectRoot: string, projectName: string) => void;
  /** 立即保存(Ctrl+S 触发) */
  saveNow: (projectRoot: string, projectName: string) => Promise<void>;
  /** 应用 React Flow 节点变更(onNodesChange 回调直接传入) */
  onNodesChange: (changes: NodeChange[]) => void;
  /** 应用 React Flow 边变更 */
  onEdgesChange: (changes: EdgeChange[]) => void;
  /** 创建新连线(onConnect 回调,含自环/重复校验) */
  addEdge: (connection: Connection) => void;
  /** 更新节点业务数据(抽屉编辑提交) */
  updateNodeData: (nodeId: string, patch: Partial<TimelineNodeData>) => void;
  /** 选中节点 */
  selectNode: (id: string | null) => void;
  /** 撤销(取消待保存 → undo → 触发新的防抖保存) */
  undo: () => void;
  /** 重做 */
  redo: () => void;
}

/** 防抖定时器引用(模块级单例) */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 500;

export const useTimelineStore = create<TimelineState>()(
  temporal(
    (set, get) => ({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      loading: false,
      saving: false,
      error: null,

      loadGraph: async (projectRoot) => {
        set({ loading: true, error: null });
        try {
          const graph = await readTimeline(projectRoot);
          set({ nodes: graph.nodes, edges: graph.edges, loading: false });
        } catch (err) {
          set({ loading: false, error: String(err) });
        }
      },

      debouncedSave: (projectRoot, projectName) => {
        if (saveTimer) clearTimeout(saveTimer);
        set({ saving: true });
        saveTimer = setTimeout(async () => {
          try {
            const { nodes, edges } = get();
            const graph = buildPersistedGraph(nodes, edges, projectRoot, projectName);
            await saveTimeline(projectRoot, graph);
            set({ saving: false, error: null });
          } catch (err) {
            set({ saving: false, error: String(err) });
          }
        }, SAVE_DEBOUNCE_MS);
      },

      saveNow: async (projectRoot, projectName) => {
        if (saveTimer) clearTimeout(saveTimer);
        try {
          const { nodes, edges } = get();
          const graph = buildPersistedGraph(nodes, edges, projectRoot, projectName);
          await saveTimeline(projectRoot, graph);
          set({ saving: false, error: null });
        } catch (err) {
          set({ saving: false, error: String(err) });
        }
      },

      onNodesChange: (changes) => {
        set((state) => ({
          nodes: applyNodeChanges(changes, state.nodes) as TimelineNode[],
        }));
      },

      onEdgesChange: (changes) => {
        set((state) => ({
          edges: applyEdgeChanges(changes, state.edges) as TimelineEdge[],
        }));
      },

      addEdge: (connection) => {
        // 拒绝自环
        if (connection.source === connection.target) return;
        // 拒绝重复连线
        const { edges } = get();
        const exists = edges.some(
          (e) => e.source === connection.source && e.target === connection.target
        );
        if (exists) return;

        const newEdge: TimelineEdge = {
          id: `edge_${crypto.randomUUID()}`,
          source: connection.source,
          target: connection.target,
          type: "storyEdge",
          data: { edgeKind: "main" },
        };
        set((state) => ({ edges: [...state.edges, newEdge] }));
      },

      updateNodeData: (nodeId, patch) => {
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, ...patch, updatedAt: new Date().toISOString() } }
              : n
          ),
        }));
      },

      selectNode: (id) => set({ selectedNodeId: id }),

      undo: () => {
        // 撤销前取消待执行的防抖保存,避免旧状态被写入磁盘
        if (saveTimer) clearTimeout(saveTimer);
        useTimelineStore.temporal.getState().undo();
      },

      redo: () => {
        if (saveTimer) clearTimeout(saveTimer);
        useTimelineStore.temporal.getState().redo();
      },
    }),
    {
      // zundo 配置: 仅追踪 nodes 与 edges 变化(不追踪 loading/saving 等瞬态)
      partialize: (state) => ({ nodes: state.nodes, edges: state.edges }),
      // 历史记录上限 100 步
      limit: 100,
    }
  )
);
```

### 3.6 Service 层 - dagre 布局封装

```typescript
// src/lib/dagreLayout.ts

import dagre from "@dagrejs/dagre";
import type { TimelineNode, TimelineEdge } from "./stores/timelineTypes";

/** 主轴固定 Y 坐标(垂直居中) */
const MAIN_AXIS_Y = 300;
/** 主轴节点水平间距 */
const MAIN_GAP_X = 320;

/**
 * 自动布局: 主轴水平排列, 分支上下分布
 * 输入: nodes 节点列表, edges 边列表
 * 输出: 布局后的节点列表(位置已更新)
 * 流程:
 *   1. 用 dagre 计算初始位置(LR 方向)
 *   2. 主线节点 Y 坐标强制固定为 MAIN_AXIS_Y
 *   3. 分支节点按 dagre 计算结果上下分布
 */
export function autoLayout(nodes: TimelineNode[], edges: TimelineEdge[]): TimelineNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 80, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    const width = node.data.nodeType === "main" ? 256 : 180;
    const height = node.data.nodeType === "main" ? 120 : 90;
    g.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const dagreNode = g.node(node.id);
    if (!dagreNode) return node;

    let y = dagreNode.y;
    if (node.data.nodeType === "main") {
      y = MAIN_AXIS_Y;
    }

    return {
      ...node,
      position: { x: dagreNode.x, y },
    };
  });
}
```

### 3.7 UI 层组件清单

| 组件 | 路径 | 职责 |
|---|---|---|
| `TimelinePanel.tsx` | `src/components/` | 画布容器,集成 ReactFlow,工具栏,快捷键 |
| `TimelineNode.tsx` | `src/components/` | 自定义节点渲染(统一卡片+颜色边框) |
| `TimelineEdge.tsx` | `src/components/` | 自定义连线渲染(贝塞尔曲线+颜色区分) |
| `TimelineDrawer.tsx` | `src/components/` | 右侧抽屉,节点详情编辑表单 |
| `TimelineContextMenu.tsx` | `src/components/` | 右键菜单(节点右键+画布右键) |
| `TimelineEmpty.tsx` | `src/components/` | 空状态提示组件 |

### 3.8 分类注册扩展

```typescript
// src/lib/store.ts (新增 timeline 分类枚举值)

export type SidebarCategory =
  | "manuscript"
  | "outline"
  | "codex"
  | "volumes"
  | "stats"
  | "search"
  | "timeline";  // 新增

export const CATEGORY_NAMES: Record<SidebarCategory, string> = {
  // ...原有
  timeline: "剧情图谱",
};

export const CATEGORY_DIRS: Record<SidebarCategory, string> = {
  // ...原有
  timeline: "剧情图谱",
};

export const CATEGORY_ICONS: Record<SidebarCategory, string> = {
  // ...原有
  timeline: "GitBranch",
};
```

```typescript
// src/lib/categoryRegistry.ts (新增 timeline PanelType)

export type PanelType = "editor" | "codex" | "stats" | "search" | "volume" | "timeline";

const CATEGORY_CONFIG: Record<SidebarCategory, CategoryConfig> = {
  // ...原有
  timeline: { panelType: "timeline", showFileList: false },
};
```

```typescript
// src/components/Workspace.tsx (Alt+9 快捷键 + 面板渲染)

const ALT_CATEGORY_MAP: Record<string, SidebarCategory> = {
  "1": "manuscript",
  "2": "outline",
  "3": "codex",
  "4": "stats",
  "5": "search",
  "6": "volumes",
  "9": "timeline",  // Alt+9
};

// renderMiddlePanel 新增分支
case "timeline":
  return <TimelinePanel />;
```

### 3.9 项目模板清理

```rust
// src-tauri/src/project_template.rs

// common_directories() 移除 "时间线" 目录, 新增 "剧情图谱" 目录
pub fn common_directories() -> Vec<&'static str> {
    vec![
        "角色",
        "世界观",
        "术语",
        "剧情图谱",   // 新增(替代原"时间线")
        "正文",
        "大纲",
        "素材",
        ".novelforge",
    ]
}

// common_files() 移除 "时间线/时间线.txt" 与 "时间线/关键事件追踪.txt" 预设文件
// 剧情图谱目录由 timeline_commands 在首次保存时自动创建,无需预设文件
```

### 3.10 依赖安装

```json
// package.json dependencies 新增
"@xyflow/react": "^12.3.0",
"@dagrejs/dagre": "^1.1.4",
"zundo": "^2.2.0"
```

---

## 4. 关键交互流程

### 4.1 右键菜单创建节点 - 完整数据流

#### 4.1.1 时序图

```
用户            TimelinePanel     timelineStore    timelineApi    Rust 后端
 |                   |                  |               |             |
 | 1.右键画布         |                  |               |             |
 |------------------>|                  |               |             |
 |                   |                  |               |             |
 |                   | 2.打开ContextMenu|               |             |
 | 3.点击"添加主线后继"|                  |               |             |
 |------------------>|                  |               |             |
 |                   |                  |               |             |
 |                   | 4.计算新节点位置  |               |             |
 |                   |   (source.x+320, |               |             |
 |                   |    MAIN_AXIS_Y)  |               |             |
 |                   |                  |               |             |
 |                   | 5.addNode+addEdge|               |             |
 |                   |----------------->|               |             |
 |                   |                  | 6.set nodes/edges           |
 |                   |                  |   (zundo自动入栈)            |
 |                   |                  |               |             |
 |                   |                  | 7.debouncedSave             |
 |                   |                  |-------------->|             |
 |                   |                  |               | 8.500ms 后   |
 |                   |                  |               |   buildGraph |
 |                   |                  |               |   +invoke   |
 |                   |                  |               |------------>|
 |                   |                  |               |             | 9.原子写入
 |                   |                  |               |             |   timeline.json
 |                   |                  |               |             |   +生成txt摘要
 |                   |                  |               |<------------|
 |                   |                  | 10.saving=false             |
 |                   |                  |<--------------|             |
 |                   | 11.React 重渲染  |               |             |
 |                   |   (nodes已更新) |               |             |
 |                   |<-----------------|               |             |
 | 12.画布显示新节点  |                  |               |             |
 |<------------------|                  |               |             |
```

#### 4.1.2 右键菜单选项矩阵

| 右键位置 | 菜单项 | 行为 |
|---|---|---|
| 画布空白 | 添加主线节点 | 在点击位置创建 main 节点(无连线) |
| 画布空白 | 添加分支节点 | 在点击位置创建 branch 节点(无连线) |
| 画布空白 | 添加事件节点 | 在点击位置创建 event 节点(无连线) |
| 画布空白 | 添加结局节点 | 在点击位置创建 ending 节点(无连线) |
| main 节点 | 添加主线后继 | 在 source 右侧 +320px 创建 main 节点,自动连线(main 边) |
| main 节点 | 添加向上分支 | 在 source 上方 -150px 创建 branch 节点,自动连线(branch 边) |
| main 节点 | 添加向下分支 | 在 source 下方 +150px 创建 branch 节点,自动连线(branch 边) |
| main 节点 | 添加事件节点 | 在 source 右上 -100px 创建 event 节点,自动连线(event 边) |
| branch 节点 | 添加分支后继 | 在 source 右侧 +280px 创建 branch 节点,连线(branch 边) |
| 任意节点 | 编辑详情 | 触发双击抽屉 |
| 任意节点 | 删除节点 | 二次确认后删除节点+关联边 |
| 任意边 | 删除连线 | 删除选中边(无确认) |

#### 4.1.3 新节点默认数据工厂

```typescript
/**
 * 创建新节点的工厂函数
 * 输入: type 节点类型, position 坐标
 * 输出: TimelineNode 完整节点(含默认值)
 * 注: ID 使用 crypto.randomUUID() 避免快速创建时重复
 */
function createNode(type: TimelineNodeType, position: { x: number; y: number }): TimelineNode {
  const now = new Date().toISOString();
  return {
    id: `node_${crypto.randomUUID()}`,
    type: "storyNode",
    position,
    data: {
      title: getDefaultTitle(type),  // "新主线节点" / "新分支" / "新事件" / "新结局"
      nodeType: type,
      summary: "",
      coreConflict: "",
      foreshadowing: "",
      status: "planned",
      order: 0,
      collapsed: false,
      childCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  };
}
```

### 4.2 双击抽屉编辑 - 表单绑定与防抖保存

#### 4.2.1 时序图

```
用户   TimelineNode   TimelineDrawer   timelineStore
 |         |               |                 |
 | 1.双击节点              |                 |
 |-------->|               |                 |
 |         | 2.onNodeDoubleClick              |
 |         |-------------->|                 |
 |         |               | 3.selectNode(id)|
 |         |               |---------------->|
 |         |               |                 |
 |         |               | 4.渲染抽屉      |
 |         |               |   (读取 selectedNodeId |
 |         |               |    对应 node.data)      |
 |         |               |                 |
 | 5.编辑"摘要"            |                 |
 |------------------------>|                 |
 |         |               | 6.本地 ref 暂存|
 |         |               |   (debouncedLocal)|
 |         |               |                 |
 |         |               | 7.失焦/300ms 防抖|
 |         |               |---------------->|
 |         |               |                 | 8.updateNodeData(id,patch)
 |         |               |                 |   (zundo 入栈)
 |         |               |                 |
 |         |               |                 | 9.debouncedSave
 |         |               |                 |   (500ms 后写盘)
 |         |               |                 |
 |         |               | 10.关闭抽屉按钮 |
 |         |               |<----------------|
 |         | 11.抽屉关闭    |                 |
 |         |<--------------|                 |
```

#### 4.2.2 抽屉表单字段配置

```typescript
// src/components/TimelineDrawer.tsx

interface DrawerField {
  key: keyof TimelineNodeData;
  label: string;
  type: "text" | "textarea" | "select";
  placeholder?: string;
  options?: { value: string; label: string }[];
}

/** 抽屉表单字段配置 */
const DRAWER_FIELDS: DrawerField[] = [
  { key: "title", label: "节点标题", type: "text", placeholder: "请输入节点标题" },
  {
    key: "status",
    label: "节点状态",
    type: "select",
    options: [
      { value: "planned", label: "未开始" },
      { value: "writing", label: "写作中" },
      { value: "done", label: "完稿" },
    ],
  },
  { key: "summary", label: "剧情摘要", type: "textarea", placeholder: "简述本节点剧情内容(200字内)" },
  { key: "coreConflict", label: "核心冲突", type: "textarea", placeholder: "本节点的主要矛盾" },
  { key: "foreshadowing", label: "伏笔备注", type: "textarea", placeholder: "埋设/回收的伏笔标记" },
];
```

#### 4.2.3 抽屉双层防抖架构

```
+-----------------------------------------------------------+
| 双层防抖架构                                               |
+-----------------------------------------------------------+
| 第一层: 抽屉本地 state 防抖(300ms)                         |
|   用户每次按键更新 localDraft, 300ms 后 commit 到 store    |
|   避免: 每个字符触发一次 store 更新导致 React Flow 重渲染  |
|                                                            |
| 第二层: store 到磁盘防抖(500ms)                           |
|   store 数据变化后 500ms 触发 debouncedSave 写盘           |
|   避免: 快速连续操作产生频繁磁盘 I/O                       |
+-----------------------------------------------------------+
```

#### 4.2.4 抽屉本地防抖实现(组件实例级)

```typescript
// src/components/TimelineDrawer.tsx

import { useRef, useEffect } from "react";

const LOCAL_DEBOUNCE_MS = 300;

/**
 * 抽屉本地草稿提交到 store(防抖 300ms)
 * 关键: 定时器绑定 useRef,避免多实例互相干扰
 *      组件卸载时清理定时器,避免内存泄漏
 */
function useDebouncedCommit(nodeId: string) {
  const localCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // 组件卸载时清理定时器
    return () => {
      if (localCommitTimer.current) clearTimeout(localCommitTimer.current);
    };
  }, []);

  const commitToStore = (patch: Partial<TimelineNodeData>) => {
    if (localCommitTimer.current) clearTimeout(localCommitTimer.current);
    localCommitTimer.current = setTimeout(() => {
      updateNodeData(nodeId, patch);  // 调用 store.updateNodeData
    }, LOCAL_DEBOUNCE_MS);
  };

  return commitToStore;
}
```

### 4.3 分支折叠/展开 - 子节点显隐与 childCount 角标

#### 4.3.1 折叠语义定义

```
折叠规则:
  - 仅 main 节点支持 collapsed 字段(branch 节点不可折叠)
  - 折叠 main 节点时,隐藏其所有可达子分支节点(任意深度)
  - childCount = 直接子节点数(branch + event 之和)
  - 展开后恢复显示,子节点位置不变

边界:
  - main 节点折叠时,连向子分支的边一并隐藏
  - 主线 main→main 的边不受折叠影响(始终保持显示)
  - 折叠的 main 节点本身仍可见(显示在画布上带角标)
  - 删除子分支时,若 childCount 归零,自动设置 collapsed=false
```

#### 4.3.2 折叠时序图

```
用户    TimelineNode    timelineStore    React Flow
 |          |                 |               |
 | 1.点击折叠按钮              |               |
 |--------->|                 |               |
 |          | 2.toggleCollapse(nodeId)        |
 |          |---------------->|               |
 |          |                 | 3.更新 main 节点 |
 |          |                 |   collapsed=true |
 |          |                 |   (zundo 入栈)   |
 |          |                 |               |
 |          |                 | 4.计算可见节点   |
 |          |                 |   (filterCollapsed BFS)|
 |          |                 |-------------->|       |
 |          |                 |               | 5.隐藏子分支
 |          |                 |               |   +关联边
 |          |                 |               |
 |          |                 | 6.显示角标     |
 |          |                 |   [+3 间章]    |
 |          |<----------------|               |
 |          |                 |               |
 | 7.画布更新|                 |               |
 |<---------|                 |               |
```

#### 4.3.3 可见性过滤算法(BFS 可达性分析)

```typescript
// src/lib/stores/timelineStore.ts

/**
 * 计算折叠后实际显示的节点与边(可达性分析)
 * 输入: nodes 全部节点, edges 全部边
 * 输出: { visibleNodes, visibleEdges } 过滤后的可见集合
 * 流程:
 *   1. 找出所有 collapsed=true 的 main 节点
 *   2. 从所有"未折叠的 main 节点"出发,沿边方向 BFS
 *   3. 遍历过程中跳过"已折叠的 main 节点"(不穿透其子树)
 *   4. 所有被 BFS 访问到的节点为可见节点
 *   5. 两端均可见的边为可见边
 *
 * 关键: BFS 处理任意深度的级联隐藏,避免"悬浮孤岛"问题
 */
export function filterCollapsed(
  nodes: TimelineNode[],
  edges: TimelineEdge[]
): {
  visibleNodes: TimelineNode[];
  visibleEdges: TimelineEdge[];
} {
  const collapsedMainIds = new Set(
    nodes
      .filter((n) => n.data.nodeType === "main" && n.data.collapsed)
      .map((n) => n.id)
  );

  if (collapsedMainIds.size === 0) {
    return { visibleNodes: nodes, visibleEdges: edges };
  }

  // 构建邻接表(source → target[])
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source)!.push(edge.target);
  }

  // BFS: 从所有未折叠的 main 节点出发
  const visited = new Set<string>();
  const queue: string[] = [];

  for (const node of nodes) {
    if (node.data.nodeType === "main" && !node.data.collapsed) {
      visited.add(node.id);
      queue.push(node.id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    // 如果当前节点是已折叠的 main,不穿透其子节点
    if (collapsedMainIds.has(current)) continue;

    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // 过滤: 仅保留可达节点 + 两端均可达的边
  const visibleNodes = nodes.filter((n) => visited.has(n.id));
  const visibleEdges = edges.filter(
    (e) => visited.has(e.source) && visited.has(e.target)
  );

  return { visibleNodes, visibleEdges };
}
```

#### 4.3.4 childCount 自动维护

```typescript
/**
 * 更新所有 main 节点的 childCount 字段
 * 输入: nodes 节点列表, edges 边列表
 * 输出: 更新后的节点列表
 * 流程: 遍历边,统计每个 main 节点的非 main 子节点数
 * 边界: childCount 归零时自动取消折叠
 */
function recalcChildCount(nodes: TimelineNode[], edges: TimelineEdge[]): TimelineNode[] {
  const childCountMap = new Map<string, number>();

  for (const edge of edges) {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);
    if (sourceNode?.data.nodeType === "main" && targetNode?.data.nodeType !== "main") {
      childCountMap.set(
        sourceNode.id,
        (childCountMap.get(sourceNode.id) ?? 0) + 1
      );
    }
  }

  return nodes.map((n) => {
    const count = childCountMap.get(n.id) ?? 0;
    if (n.data.nodeType === "main" && n.data.childCount !== count) {
      return {
        ...n,
        data: {
          ...n.data,
          childCount: count,
          // childCount 归零时自动取消折叠
          collapsed: count === 0 ? false : n.data.collapsed,
        },
      };
    }
    return n;
  });
}
```

### 4.4 zundo 撤销/重做 - 各操作行为一致性

#### 4.4.1 可撤销操作分类

| 操作类型 | 是否入栈 | 粒度 | 说明 |
|---|---|---|---|
| 创建节点 | 是 | 单步 | 一次创建一个节点(含连线)为一步 |
| 删除节点 | 是 | 单步 | 删除节点+关联边为一步 |
| 拖拽节点 | 是 | 拖拽结束 | onNodeDragStop 时入栈(用 pause/resume 合并中间帧) |
| 连线创建 | 是 | 单步 | onConnect 创建一条边为一步 |
| 连线删除 | 是 | 单步 | 删除一条边为一步 |
| 抽屉编辑 | 是 | 提交一次 | 一次 commitToStore 为一步(300ms 防抖内合并) |
| 折叠/展开 | 是 | 单步 | toggleCollapse 为一步 |
| 整理布局 | 是 | 单步 | Ctrl+L 全量位置更新为一步 |
| 选中节点 | 否 | - | 纯 UI 状态,不影响数据 |
| 视图缩放/平移 | 否 | - | React Flow 内部状态,不入栈 |

#### 4.4.2 拖拽优化(zundo pause/resume 机制)

```typescript
// src/components/TimelinePanel.tsx

/**
 * 拖拽性能优化(zundo pause/resume)
 * 原理:
 *   1. onNodeDragStart: 暂停 zundo 历史追踪
 *   2. onNodeDrag: 正常应用位置变更到 store(保证 UI 流畅)
 *   3. onNodeDragStop: 恢复 zundo 追踪 → 手动标记当前状态为历史节点
 * 效果: 拖拽过程产生 60+ 次 position 更新,但仅入栈 1 条历史记录
 *
 * 关键: 受控模式下必须正常更新 store,否则节点会弹回原位
 */
const handleNodeDragStart = useCallback(() => {
  // 暂停 zundo 追踪: 后续的 set() 调用不会产生历史记录
  useTimelineStore.temporal.getState().pause();
}, []);

const handleNodeDragStop = useCallback(
  () => {
    // 恢复 zundo 追踪
    useTimelineStore.temporal.getState().resume();
    // 将当前状态(含最终位置)作为一步入栈
    useTimelineStore.temporal.getState().set();
    // 触发防抖保存
    if (currentProject) {
      debouncedSave(currentProject.path, currentProject.meta.name);
    }
  },
  [currentProject, debouncedSave]
);

<ReactFlow
  onNodeDragStart={handleNodeDragStart}
  onNodeDragStop={handleNodeDragStop}
  onNodesChange={onNodesChange}  // 正常处理所有变更(含拖拽中的 position 变更)
/>
```

#### 4.4.3 撤销/重做持久化策略

zundo 的 temporal 中间件不提供 `onStateChange` 回调。通过 Zustand 原生 `subscribe(selector, listener)` 在组件层监听 nodes/edges 变化,任何变化(含 undo/redo 触发的)都触发防抖保存。

```typescript
// src/components/TimelinePanel.tsx

/**
 * 监听 nodes/edges 变化(含 undo/redo 触发的变化),自动触发防抖保存
 * 原理: Zustand 的 subscribe(selector, listener) 在选中字段变化时触发
 *       zundo 的 undo/redo 通过 set() 更新 nodes/edges,同样会触发 subscribe
 */
function useAutoSave() {
  const debouncedSave = useTimelineStore((s) => s.debouncedSave);
  const currentProject = useAppStore((s) => s.currentProject);

  // 用 ref 避免闭包陈旧引用
  const projectRef = useRef(currentProject);
  projectRef.current = currentProject;

  useEffect(() => {
    const unsub = useTimelineStore.subscribe(
      (state) => ({ nodes: state.nodes, edges: state.edges }),
      () => {
        const proj = projectRef.current;
        if (proj) {
          debouncedSave(proj.path, proj.meta.name);
        }
      }
    );
    return unsub;
  }, [debouncedSave]);
}
```

撤销/重做前必须取消待执行的防抖保存,避免旧状态被写入磁盘(已在 3.5 节 store 实现中体现)。

#### 4.4.4 撤销栈溢出处理

```
zundo limit: 100
超过 100 步时,最旧的记录被自动丢弃

边界场景:
1. 快速拖拽: onNodeDragStop 仅在拖拽结束时入栈,避免拖拽过程产生大量记录
2. 连续编辑: 抽屉 300ms 防抖内多次编辑合并为一步,避免字符级入栈
3. 整理布局: Ctrl+L 全量位置更新为一步,不产生 100 条位置变化记录
```

### 4.5 Ctrl+L 整理布局时序

```
用户    TimelinePanel    dagreLayout    timelineStore
 |          |                 |               |
 | 1.Ctrl+L |                 |               |
 |--------->|                 |               |
 |          | 2.读取当前 nodes/edges          |
 |          |                 |               |
 |          | 3.autoLayout(nodes,edges)       |
 |          |---------------->|               |
 |          |                 | 4.dagre 计算  |
 |          |                 |   新位置       |
 |          |                 |               |
 |          | 5.返回布局后的 nodes             |
 |          |<----------------|               |
 |          |                 |               |
 |          | 6.setNodes(一次性更新)          |
 |          |                 |-------------->|
 |          |                 |               | 7.zundo 入栈(单步)
 |          |                 |               | 8.debouncedSave(500ms 后写盘)
 |          |                 |               |
 |          | 9.fitView(适应屏幕)              |
 |          |                 |               |
 | 10.画布重排|                |               |
 |<---------|                 |               |
```

---

## 5. Tauri 离线约束与视觉规范

### 5.1 Tauri 拖拽冲突隔离

#### 5.1.1 问题根源

Tauri 自定义标题栏通过 `data-tauri-drag-region` 属性标识可拖拽区域。React Flow 画布的拖拽(节点拖拽、画布平移、框选)若与该属性重叠,会导致:
- 拖拽节点时整个窗口被拖动
- 画布平移触发窗口移动
- Handle 锚点无法正常连线

#### 5.1.2 隔离方案

```tsx
// src/components/TimelinePanel.tsx

/**
 * 时间线画布容器
 * 关键点: data-tauri-drag-region="false" 显式禁用窗口拖拽
 *         阻止事件冒泡,避免 Tauri 标题栏拖拽逻辑拦截画布事件
 */
export default function TimelinePanel() {
  return (
    <div
      className="h-full w-full relative"
      data-tauri-drag-region="false"
      onDragStart={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <ReactFlow ...>
        {/* 子组件 */}
      </ReactFlow>
    </div>
  );
}
```

#### 5.1.3 冲突检测矩阵

| 操作 | 期望行为 | 隔离措施 |
|---|---|---|
| 拖拽节点 | 节点移动,窗口不动 | `data-tauri-drag-region="false"` + `stopPropagation` |
| 画布平移(空格+拖拽) | 画布移动,窗口不动 | 同上 |
| 框选节点 | 绘制选框,窗口不动 | 同上 |
| Handle 拖拽连线 | 创建连线,窗口不动 | React Flow 内部 `pointer-events: auto` |
| 滚轮缩放 | 画布缩放,窗口不动 | React Flow 内部拦截 `wheel` 事件 |
| 点击节点 | 选中节点 | React Flow `onNodeClick` |

### 5.2 FANDEX 设计 token 集成

#### 5.2.1 节点类型颜色映射

```typescript
// src/lib/stores/timelineTypes.ts (新增)

/** 节点类型对应的 FANDEX 颜色 token */
export const NODE_TYPE_COLORS: Record<TimelineNodeType, {
  border: string;
  bg: string;
  text: string;
  badge: string;
}> = {
  // 主线: 主色 #6EA8FE
  main: {
    border: "border-fandex-primary",
    bg: "bg-fandex-primary/10",
    text: "text-fandex-primary",
    badge: "bg-fandex-primary",
  },
  // 分支: 次色 #55EFC4
  branch: {
    border: "border-fandex-secondary",
    bg: "bg-fandex-secondary/10",
    text: "text-fandex-secondary",
    badge: "bg-fandex-secondary",
  },
  // 事件: 三色 #F09070
  event: {
    border: "border-fandex-tertiary",
    bg: "bg-fandex-tertiary/10",
    text: "text-fandex-tertiary",
    badge: "bg-fandex-tertiary",
  },
  // 结局: 灰色 zinc-400
  ending: {
    border: "border-zinc-400",
    bg: "bg-zinc-400/10",
    text: "text-zinc-300",
    badge: "bg-zinc-400",
  },
};

/** 节点状态徽章文案与颜色 */
export const NODE_STATUS_MAP: Record<NodeStatus, { label: string; color: string }> = {
  planned: { label: "未开始", color: "bg-zinc-500" },
  writing: { label: "写作中", color: "bg-fandex-tertiary" },
  done: { label: "完稿", color: "bg-fandex-secondary" },
};

/** 边类型颜色映射 */
export const EDGE_TYPE_COLORS: Record<TimelineNodeType, string> = {
  main: "#6EA8FE",
  branch: "#55EFC4",
  event: "#F09070",
  ending: "#a1a1aa",
};
```

#### 5.2.2 节点卡片组件

```tsx
// src/components/TimelineNode.tsx

import { Handle, Position, useNodesData, type NodeProps } from "@xyflow/react";
import { NODE_TYPE_COLORS, NODE_STATUS_MAP } from "../lib/stores/timelineTypes";
import type { TimelineNode, TimelineNodeData } from "../lib/stores/timelineTypes";

/**
 * 自定义节点组件(性能优化版)
 * 输入: NodeProps<TimelineNodeData>
 * 输出: JSX 节点卡片
 * 流程:
 *   1. 通过 useNodesData 按 ID 订阅,避免全量重渲染
 *   2. 读取节点类型对应的颜色配置
 *   3. 渲染卡片边框、背景、标题、状态徽章
 *   4. 渲染折叠角标(仅 main 节点且 collapsed=true)
 *   5. 渲染 Handle 锚点(左侧 target, 右侧 source)
 *
 * 关键: 泛型参数传入完整 TimelineNode 类型(Node 类型,而非 Data 类型)
 */
export default function TimelineNode({ id, selected }: NodeProps<TimelineNodeData>) {
  // 仅订阅当前节点的 data 字段变化(避免其他节点变化触发重渲染)
  const nodeData = useNodesData<TimelineNode>(id);
  if (!nodeData) return null;

  const { data } = nodeData;
  const colors = NODE_TYPE_COLORS[data.nodeType];
  const statusInfo = NODE_STATUS_MAP[data.status];
  const showFoldBadge = data.nodeType === "main" && data.collapsed && data.childCount > 0;

  return (
    <div
      className={`
        relative px-4 py-3 rounded-lg border-2 shadow-md transition-all duration-fast
        ${colors.border} ${colors.bg}
        ${selected ? "ring-2 ring-fandex-primary/50 scale-[1.02]" : "hover:shadow-lg"}
      `}
      style={{ width: data.nodeType === "main" ? 256 : 180 }}
    >
      {/* 输入锚点 - 左侧 */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-fandex-primary !border-2 !border-nf-bg"
      />

      {/* 标题 */}
      <div className={`text-sm font-bold font-display ${colors.text} truncate mb-1`}>
        {data.title}
      </div>

      {/* 节点类型标签 + 状态徽章 */}
      <div className="flex items-center gap-1.5">
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${colors.badge} text-white`}>
          {data.nodeType === "main" && "主线"}
          {data.nodeType === "branch" && "分支"}
          {data.nodeType === "event" && "事件"}
          {data.nodeType === "ending" && "结局"}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusInfo.color} text-white`}>
          {statusInfo.label}
        </span>
      </div>

      {/* 摘要预览(仅显示前 50 字) */}
      {data.summary && (
        <div className="mt-2 text-xs text-nf-text-tertiary line-clamp-2">
          {data.summary}
        </div>
      )}

      {/* 输出锚点 - 右侧 */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-fandex-primary !border-2 !border-nf-bg"
      />

      {/* 折叠角标(仅 main 节点折叠时显示) */}
      {showFoldBadge && (
        <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-fandex-tertiary text-white text-[10px] font-bold flex items-center justify-center shadow-md">
          +{data.childCount}
        </div>
      )}
    </div>
  );
}
```

#### 5.2.3 连线组件

```tsx
// src/components/TimelineEdge.tsx

import { type EdgeProps, getBezierPath } from "@xyflow/react";
import { EDGE_TYPE_COLORS } from "../lib/stores/timelineTypes";
import type { TimelineEdge } from "../lib/stores/timelineTypes";

/**
 * 自定义连线组件
 * 输入: EdgeProps<TimelineEdge> React Flow 边属性(引用统一类型)
 * 输出: SVG 路径(统一平滑曲线 + 颜色区分)
 * 流程:
 *   1. 读取边类型对应颜色
 *   2. 调用 getBezierPath 计算贝塞尔路径
 *   3. 渲染路径(无动画,符合"统一曲线+颜色区分"决策)
 *
 * 关键: 泛型引用统一 TimelineEdge 类型,避免与后端结构脱节
 */
export default function TimelineEdgeComponent(props: EdgeProps<TimelineEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } = props;

  const edgeKind = data?.edgeKind ?? "main";
  const color = EDGE_TYPE_COLORS[edgeKind];

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <path
      id={id}
      d={edgePath}
      stroke={color}
      strokeWidth={selected ? 3 : 2}
      fill="none"
      opacity={selected ? 1 : 0.7}
      style={{ transition: "stroke-width 0.15s ease, opacity 0.15s ease" }}
    />
  );
}
```

#### 5.2.4 空状态组件

```tsx
// src/components/TimelineEmpty.tsx

import { MousePointerClick } from "lucide-react";
import { useI18n } from "../lib/i18n";

/**
 * 空状态提示组件
 * 输入: 无
 * 输出: JSX 居中提示文字 + 图标
 * 流程: 显示"右键画布添加第一个节点"提示,无引导图示
 */
export default function TimelineEmpty() {
  const { t } = useI18n();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
      <MousePointerClick className="w-12 h-12 text-nf-text-tertiary opacity-40 mb-3" />
      <p className="text-sm text-nf-text-tertiary">
        {t("timeline.emptyHint")}
      </p>
      <p className="text-xs text-nf-text-tertiary mt-1 opacity-70">
        {t("timeline.emptySubHint")}
      </p>
    </div>
  );
}
```

### 5.3 快捷键全局注册与冲突检测

#### 5.3.1 快捷键清单

| 快捷键 | 作用 | 注册位置 | 冲突检测 |
|---|---|---|---|
| Alt+9 | 唤起时间线编辑器 | Workspace.tsx | 与现有 Alt+1~6 同系列,无冲突 |
| Ctrl+S | 手动保存当前图谱 | TimelinePanel.tsx | 需拦截编辑器原生 Ctrl+S |
| Ctrl+L | 整理画布布局 | TimelinePanel.tsx | 与浏览器/Ctrl+K 命令面板不冲突 |
| Ctrl+Z | 撤销 | TimelinePanel.tsx | 需拦截编辑器原生 Ctrl+Z |
| Ctrl+Y / Ctrl+Shift+Z | 重做 | TimelinePanel.tsx | 同上 |

#### 5.3.2 快捷键实现(含焦点守卫与运算符优先级修正)

```tsx
// src/components/TimelinePanel.tsx

/**
 * 快捷键监听与冲突检测
 * 输入: 无
 * 输出: useEffect 注册的全局 keydown 监听器
 * 流程:
 *   1. 仅在 activeCategory === "timeline" 时注册(作用域限定)
 *   2. Ctrl+S 始终拦截(保存是全局行为,含输入框聚焦时)
 *   3. Ctrl+Z/Y/L 仅在非输入框聚焦时拦截(放行输入框原生撤销)
 *   4. Escape 关闭抽屉/右键菜单
 *   5. 统一使用 e.key.toLowerCase() 消除大小写干扰
 *
 * 关键修正:
 *   - 运算符优先级: 用显式括号 && 组合,避免 || 与 && 混淆
 *   - macOS 兼容: isMod = e.ctrlKey || e.metaKey
 *   - 焦点守卫: 检测 INPUT/TEXTAREA/contentEditable 放行原生行为
 */
useEffect(() => {
  if (activeCategory !== "timeline") return;

  const handler = (e: KeyboardEvent) => {
    const isMod = e.ctrlKey || e.metaKey;  // 兼容 Windows Ctrl / macOS Cmd
    const key = e.key.toLowerCase();

    // 焦点元素判断: 输入框聚焦时不拦截 Ctrl+Z/Y/L(放行原生撤销/重做/定位)
    const target = e.target as HTMLElement;
    const isInputFocused =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable;

    // Ctrl+S 始终拦截(保存是全局行为)
    if (isMod && !e.shiftKey && key === "s") {
      e.preventDefault();
      e.stopPropagation();
      saveNow(currentProject.path, currentProject.meta.name);
      return;
    }

    // 以下快捷键仅在非输入框聚焦时拦截
    if (isInputFocused) return;

    // Ctrl+L 整理布局
    if (isMod && !e.shiftKey && key === "l") {
      e.preventDefault();
      e.stopPropagation();
      handleAutoLayout();
      return;
    }

    // Ctrl+Z 撤销(无 Shift)
    if (isMod && !e.shiftKey && key === "z") {
      e.preventDefault();
      e.stopPropagation();
      undo();
      return;
    }

    // Ctrl+Shift+Z 或 Ctrl+Y 重做
    if (isMod && (
      (e.shiftKey && key === "z") ||
      (!e.shiftKey && key === "y")
    )) {
      e.preventDefault();
      e.stopPropagation();
      redo();
      return;
    }

    // Escape 关闭抽屉
    if (e.key === "Escape") {
      selectNode(null);
      return;
    }
  };

  // 使用 capture 阶段拦截,确保在编辑器/其他组件之前处理
  window.addEventListener("keydown", handler, true);
  return () => window.removeEventListener("keydown", handler, true);
}, [activeCategory, currentProject, saveNow, undo, redo, selectNode, handleAutoLayout]);
```

#### 5.3.3 冲突检测矩阵

| 快捷键 | 冲突对象 | 检测时机 | 处理方式 |
|---|---|---|---|
| Alt+9 | 无(与其他 Alt+N 同系列) | Workspace.tsx 注册时 | 无冲突 |
| Ctrl+S | NovelEditor 编辑器原生保存 | keydown capture 阶段 | `e.preventDefault()` 拦截 |
| Ctrl+Z | NovelEditor 编辑器原生撤销 | keydown capture 阶段 + 焦点守卫 | 输入框聚焦时放行,否则拦截 |
| Ctrl+Y | 无(NovelEditor 用 Ctrl+Y 重做) | keydown capture 阶段 | 仅在 timeline 分类下生效 |
| Ctrl+L | 无(无其他 Ctrl+L 绑定) | keydown capture 阶段 | 无冲突 |
| Escape | CommandPalette/抽屉 | keydown capture 阶段 | 优先关闭抽屉 |

#### 5.3.4 作用域限定

```typescript
// 关键: 快捷键仅在 activeCategory === "timeline" 时生效
// 避免与其他分类的快捷键冲突(如 manuscript 分类的编辑器快捷键)

useEffect(() => {
  if (activeCategory !== "timeline") return;  // 作用域限定
  // ... 注册快捷键
}, [activeCategory]);
```

### 5.4 离线资源约束

#### 5.4.1 依赖本地化清单

| 依赖 | 类型 | 离线策略 |
|---|---|---|
| `@xyflow/react` | npm 包 | Vite 打包,无 CDN |
| `@dagrejs/dagre` | npm 包 | Vite 打包,无 CDN |
| `zundo` | npm 包 | Vite 打包,无 CDN |
| React Flow 样式 | CSS | `import "@xyflow/react/dist/style.css"` 由 Vite 处理 |
| lucide-react 图标 | npm 包 | 已在项目中使用 |

#### 5.4.2 CSP 策略验证

```json
// src-tauri/tauri.conf.json (无需修改)
{
  "app": {
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: https://asset.localhost data:; font-src 'self'; connect-src 'self' https://api.github.com"
    }
  }
}
```

验证点:
- `default-src 'self'`: React Flow 的内联 SVG 与 SVG path 无需额外授权(SVG 不受 CSP 限制)
- `style-src 'self' 'unsafe-inline'`: React Flow 的动态样式(节点位置 transform)需要 `unsafe-inline`
- `img-src 'self' data:`: 节点图标使用 lucide-react(SVG 组件),无 img 标签
- 无需修改现有 CSP 配置

#### 5.4.3 字体与图标

```
节点卡片使用的字体与图标均来自项目本地
字体: Tailwind 默认 system sans-serif(无需外部字体)
图标: lucide-react(已在项目中使用)

无需额外引入 Google Fonts 或 iconfont CDN
```

### 5.5 路径规范与目录结构

#### 5.5.1 项目目录变更

```
{project_root}/
+-- 角色/
+-- 世界观/
+-- 术语/
+-- 剧情图谱/                    # 新增(替代原"时间线"目录)
|   +-- timeline.json            # 主数据文件(Rust 原子写入)
|   +-- _剧情时间线摘要.txt       # 自动生成的只读摘要
+-- 正文/
+-- 大纲/
+-- 素材/
+-- .novelforge/
    +-- project.json
```

#### 5.5.2 前端文件组织

```
src/
+-- components/
|   +-- TimelinePanel.tsx        # 画布容器
|   +-- TimelineNode.tsx          # 自定义节点
|   +-- TimelineEdge.tsx          # 自定义连线
|   +-- TimelineDrawer.tsx        # 节点详情抽屉
|   +-- TimelineContextMenu.tsx   # 右键菜单
|   +-- TimelineEmpty.tsx         # 空状态
+-- lib/
|   +-- timelineApi.ts            # Tauri 命令封装
|   +-- dagreLayout.ts            # 自动布局算法
|   +-- stores/
|       +-- timelineTypes.ts      # 类型定义
|       +-- timelineStore.ts      # Zustand + zundo store
```

#### 5.5.3 Rust 后端文件

```
src-tauri/src/
+-- lib.rs                       # 注册 timeline_commands 模块
+-- timeline_commands.rs          # 时间线 CRUD + 摘要生成
+-- project_template.rs          # 移除"时间线"目录, 新增"剧情图谱"
```

### 5.6 i18n 国际化扩展

```typescript
// src/lib/i18n.tsx 新增 timeline 命名空间

export const TIMELINE_I18N = {
  "timeline.emptyHint": "右键画布添加第一个节点",
  "timeline.emptySubHint": "或使用 Ctrl+L 整理布局",
  "sidebar.timeline": "剧情图谱",
  "timeline.ctx.addMain": "添加主线节点",
  "timeline.ctx.addBranch": "添加分支节点",
  "timeline.ctx.addEvent": "添加事件节点",
  "timeline.ctx.addEnding": "添加结局节点",
  "timeline.ctx.addMainSuccessor": "添加主线后继",
  "timeline.ctx.addBranchUp": "添加向上分支",
  "timeline.ctx.addBranchDown": "添加向下分支",
  "timeline.ctx.addEventChild": "添加事件节点",
  "timeline.ctx.editDetail": "编辑详情",
  "timeline.ctx.deleteNode": "删除节点",
  "timeline.ctx.deleteEdge": "删除连线",
  "timeline.drawer.title": "节点详情",
  "timeline.drawer.titleLabel": "节点标题",
  "timeline.drawer.statusLabel": "节点状态",
  "timeline.drawer.summaryLabel": "剧情摘要",
  "timeline.drawer.conflictLabel": "核心冲突",
  "timeline.drawer.foreshadowingLabel": "伏笔备注",
  "timeline.drawer.save": "保存",
  "timeline.drawer.close": "关闭",
  "timeline.status.planned": "未开始",
  "timeline.status.writing": "写作中",
  "timeline.status.done": "完稿",
  "timeline.nodeType.main": "主线",
  "timeline.nodeType.branch": "分支",
  "timeline.nodeType.event": "事件",
  "timeline.nodeType.ending": "结局",
  "timeline.toast.saved": "剧情图谱已保存",
  "timeline.toast.saveFailed": "保存失败,请重试",
  "timeline.toast.deleted": "节点已删除",
  "timeline.toast.deleteConfirm": "确定删除此节点及其关联连线吗?",
  "timeline.toast.layoutApplied": "布局已整理",
  "timeline.toast.cleared": "剧情图谱已清空",
  "timeline.toast.clearConfirm": "确定清空所有剧情节点吗?此操作不可撤销",
} as const;
```

### 5.7 视觉规范总结

#### 5.7.1 节点卡片视觉规格

```
+-----------------------------------------+
| ●  节点标题                      [+]    |  <- 标题 + 折叠角标(仅 main)
| [主线] [写作中]                         |  <- 类型标签 + 状态徽章
|                                         |
| 摘要内容预览,最多两行...                |  <- 摘要预览(50字内)
+-----------------------------------------+
   ^                                  ^
  Handle                            Handle
  (target, 左)                    (source, 右)
```

尺寸规范:
- main 节点: 256px 宽 × 自适应高(约 120px)
- branch/event/ending 节点: 180px 宽 × 自适应高(约 90px)
- 圆角: `rounded-lg`
- 边框: 2px
- 阴影: `shadow-md`(默认) / `shadow-lg`(hover)

#### 5.7.2 连线视觉规格

| 边类型 | 颜色 | 粗细 | 样式 |
|---|---|---|---|
| main | #6EA8FE | 2px | 实线 |
| branch | #55EFC4 | 2px | 实线 |
| event | #F09070 | 2px | 实线 |
| ending | #a1a1aa | 2px | 实线 |
| 选中态 | 对应类型色 | 3px | opacity=1 |
| 默认态 | 对应类型色 | 2px | opacity=0.7 |

#### 5.7.3 画布视觉规格

- 背景: 点阵(`BackgroundVariant.Dots`),gap=16, size=1
- MiniMap: 右下角,圆角,半透明背景
- Controls: 左下角,垂直排列

---

## 6. 性能与边界

### 6.1 性能基线评估

```
节点规模评估:
  - 小型项目: 10-30 节点(单卷小说)
  - 中型项目: 50-100 节点(多卷长篇)
  - 大型项目: 100-300 节点(系列小说 + 复杂分支)
  - 极端场景: 500+ 节点(理论极限,实际罕见)

React Flow 性能基线:
  - 100 节点: 流畅 60fps
  - 300 节点: 仍可交互,偶有卡顿
  - 500 节点: 需优化才能保持流畅
```

### 6.2 选择性订阅(核心优化)

问题: 默认 `useTimelineStore((s) => s.nodes)` 订阅整个 nodes 数组,任何节点变化都触发全量重渲染。

方案: React Flow 12.x 内置 `useNodesData` 钩子,支持按节点 ID 选择性订阅。

```tsx
// src/components/TimelineNode.tsx

// 仅订阅当前节点的 data 字段变化
// 泛型参数传入完整 TimelineNode 类型(Node 类型)
const nodeData = useNodesData<TimelineNode>(id);
if (!nodeData) return null;
const { data } = nodeData;  // data 类型为 TimelineNodeData
```

### 6.3 视口外节点虚拟化

```tsx
// src/components/TimelinePanel.tsx

<ReactFlow
  nodes={visibleNodes}
  edges={visibleEdges}
  nodeTypes={nodeTypes}
  edgeTypes={edgeTypes}
  onlyRenderVisibleElements={true}  // 视口裁剪
  minZoom={0.1}
  maxZoom={2}
  defaultEdgeOptions={{ type: "storyEdge" }}
>
  <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
  <MiniMap
    nodeColor={(node) => NODE_TYPE_COLORS[node.data?.nodeType ?? "main"].badge}
    maskColor="rgba(0,0,0,0.4)"
  />
  <Controls />
</ReactFlow>
```

### 6.4 性能优化清单

| 优化项 | 实现方式 | 收益 |
|---|---|---|
| 选择性订阅 | `useNodesData<TimelineNode>(id)` | 节点变化仅重渲染自身 |
| 视口裁剪 | `onlyRenderVisibleElements` | 100 节点仅渲染可见 20-30 个 |
| 拖拽优化 | zundo pause/resume + onNodeDragStop 单次入栈 | 避免拖拽过程产生 100+ 历史记录 |
| 边渲染优化 | 自定义 `TimelineEdge` 简单 SVG path | 减少边组件复杂度 |
| 折叠优化 | `filterCollapsed` 减少可见节点数 | 折叠 50 分支后仅渲染 5 main |
| 防抖保存 | 500ms 防抖 | 避免 100 次操作产生 100 次 I/O |
| useCallback | 回调函数 memoize | 避免子组件无谓重渲染 |

### 6.5 崩溃恢复策略

#### 6.5.1 原子写入保障

```rust
// src-tauri/src/timeline_commands.rs (save_timeline 内)

let json_path = timeline_json_path(&project_root);
let tmp_path = json_path.with_extension("json.tmp");

// 步骤1: 写入临时文件
fs::write(&tmp_path, &json)
    .map_err(|e| format!("写入临时文件失败: {}", e))?;

// 步骤2: 原子 rename(Windows NTFS 与 Linux ext4 均支持原子 rename)
fs::rename(&tmp_path, &json_path)
    .map_err(|e| format!("原子重命名失败: {}", e))?;
```

#### 6.5.2 临时文件残留清理

`read_timeline` 时检查并清理 `timeline.json.tmp` 残留(详见 3.2 节)。

#### 6.5.3 schema 版本迁移

`read_timeline` 时自动检测 schema 版本,低于 `LATEST_SCHEMA_VERSION` 时调用 `migrate_schema` 升级;高于则报错(详见 3.2 节)。

### 6.6 边界情况处理

| 场景 | 处理方式 | 验收标准 |
|---|---|---|
| 空图谱首次打开 | 显示空状态提示 | 无报错,显示 TimelineEmpty |
| 单节点无连线 | 正常显示,无连线渲染 | 节点可见,Handle 可用 |
| 删除最后节点 | 弹出确认,删除后显示空状态 | 二次确认,删除后切空状态 |
| 删除节点关联边 | 自动级联删除关联边 | 无悬浮边残留 |
| 删除折叠节点的子节点 | 重新计算 childCount | childCount 正确,归零取消折叠 |
| 拖拽超出画布 | React Flow 自动滚动画布 | 节点可拖回 |
| 连线自环(source=target) | onConnect 拦截 | 不创建自环边 |
| 重复连线 | 检查已存在同 source→target | 提示已存在连线 |
| undo 到空状态 | 允许撤销到 nodes=[] | 显示空状态,无报错 |
| redo 超过 future 栈 | 无操作(future 为空) | 无报错 |
| 500ms 内快速操作 | 防抖合并保存 | 仅最后一次写盘 |
| Rust 后端不可达 | invoke 失败,显示错误 toast | 不崩溃,显示错误信息 |
| timeline.json 损坏 | 反序列化失败,显示错误 | 不崩溃,提示用户 |
| .tmp 文件残留 | read 时自动清理 | 不影响读取 |

---

## 7. 实施计划

### 7.1 阶段划分

```
阶段 1: 基础设施(前置准备)
+-- 1.1 安装依赖(@xyflow/react, @dagrejs/dagre, zundo)
+-- 1.2 创建类型定义文件(timelineTypes.ts)
+-- 1.3 创建 Rust 后端命令骨架(timeline_commands.rs)
+-- 1.4 注册 Tauri 命令(lib.rs)
+-- 1.5 项目模板更新(移除"时间线", 新增"剧情图谱")
+-- 1.6 分类注册扩展(store.ts, categoryRegistry.ts, i18n.tsx)

阶段 2: Service 层
+-- 2.1 timelineApi.ts(Tauri 命令封装)
+-- 2.2 dagreLayout.ts(自动布局算法)
+-- 2.3 timelineStore.ts(Zustand + zundo store)

阶段 3: UI 层 - 画布基础
+-- 3.1 TimelinePanel.tsx(画布容器 + ReactFlow 集成)
+-- 3.2 TimelineNode.tsx(自定义节点组件)
+-- 3.3 TimelineEdge.tsx(自定义连线组件)
+-- 3.4 TimelineEmpty.tsx(空状态组件)
+-- 3.5 Workspace.tsx 接入(renderMiddlePanel 分支)

阶段 4: UI 层 - 交互
+-- 4.1 TimelineContextMenu.tsx(右键菜单)
+-- 4.2 TimelineDrawer.tsx(节点详情抽屉)
+-- 4.3 折叠/展开逻辑(BFS 可达性)
+-- 4.4 快捷键注册(Alt+9/Ctrl+S/L/Z/Y)
+-- 4.5 Tauri 拖拽冲突隔离

阶段 5: 性能与边界
+-- 5.1 选择性订阅(useNodesData)
+-- 5.2 视口裁剪(onlyRenderVisibleElements)
+-- 5.3 拖拽优化(zundo pause/resume)
+-- 5.4 崩溃恢复(原子写入 + .tmp 清理)
+-- 5.5 数据完整性校验
+-- 5.6 边界情况测试

阶段 6: 集成与验收
+-- 6.1 端到端测试(创建/编辑/折叠/撤销/保存)
+-- 6.2 性能测试(100/300 节点压测)
+-- 6.3 tsc --noEmit 类型检查
+-- 6.4 cargo check Rust 检查
+-- 6.5 vite build 构建校验
+-- 6.6 tauri build 安装包生成
```

### 7.2 阶段验收标准

| 阶段 | 验收标准 | 验证方式 |
|---|---|---|
| 1 | 依赖安装成功,类型定义编译通过,模板目录正确 | `npm ls` + `tsc --noEmit` |
| 2 | Store 单元测试通过,API 调用返回正确数据 | 手动 invoke 测试 |
| 3 | 画布显示空状态,节点组件渲染正确 | 浏览器可视化 |
| 4 | 右键创建节点,抽屉编辑,折叠展开,快捷键全部可用 | 端到端操作 |
| 5 | 300 节点流畅,崩溃后 .tmp 清理,数据校验通过 | 性能测试 + 模拟崩溃 |
| 6 | tsc + cargo + vite + tauri build 全通过 | CI 校验 |

### 7.3 关键依赖关系

```
阶段 1 (基础设施) --> 阶段 2 (Service 层) --> 阶段 3 (画布基础) --> 阶段 4 (交互)
                                                                              |
                                                                              v
                                            阶段 6 (集成验收) <-- 阶段 5 (性能边界)
```

强制顺序:
- 阶段 1 必须先于阶段 2(类型与命令注册)
- 阶段 2 必须先于阶段 3(Store 与 API)
- 阶段 3 必须先于阶段 4(画布基础)
- 阶段 5 可与阶段 4 部分并行(性能优化在交互完成后)
- 阶段 6 必须最后执行(全量验收)

### 7.4 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| React Flow 12.x API 变更 | 低 | 中 | 锁定版本 ^12.3.0,关注 changelog |
| dagre 布局不符合预期 | 中 | 低 | 提供 Ctrl+L 手动整理 + 手动拖拽 |
| zundo 历史栈内存占用 | 低 | 低 | limit:100 限制 |
| Tauri 拖拽冲突残留 | 中 | 高 | `data-tauri-drag-region="false"` + capture 拦截 |
| 300 节点性能下降 | 中 | 中 | 视口裁剪 + 选择性订阅 |
| JSON 损坏数据丢失 | 低 | 高 | 原子写入 + .tmp 清理 + schema 版本 |

### 7.5 版本号同步

按项目硬约束,版本号需同步至以下文件:

| 文件 | 字段 | 当前值 | 新值 |
|---|---|---|---|
| `package.json` | `version` | 26.7.7 | 26.7.8 |
| `src-tauri/Cargo.toml` | `version` | 26.7.7 | 26.7.8 |
| `src-tauri/tauri.conf.json` | `version` | 26.7.7 | 26.7.8 |
| `src/lib/updateChecker.ts` | `FALLBACK_VERSION` | 26.7.7 | 26.7.8 |
| `src/components/Launcher.tsx` | `appVersion` | 26.7.7 | 26.7.8 |
| `src/components/SettingsDialog.tsx` | `currentVersion` | 26.7.7 | 26.7.8 |

---

## 8. 设计决策记录

### 8.1 技术选型决策

**选型**: React Flow + dagre + zundo(方案 A)

**理由**:
1. 与现有 Tauri + React + Zustand + Tailwind 技术栈契合度最高
2. 三个依赖均为离线可用,符合离线优先约束
3. dagre + zundo 直接解决自动布局与撤销/重做两大核心痛点
4. 节点作为 React 组件可完美复用 FANDEX 设计 token

**否决方案**:
- AntV X6: React 封装不丝滑,体积大(800KB),学习曲线高
- 纯手写 SVG: 需从零实现缩放/拖拽/连线/MiniMap,违反"不要造轮子"

### 8.2 视觉规范决策

**节点样式**: 统一矩形卡片 + 颜色边框 + 状态徽章 + 折叠角标 + Handle 锚点

**理由**:
1. 矩形卡片符合桌面应用审美(类似 Figma/VS Code 节点)
2. 颜色边框区分四类型(main=蓝/branch=绿/event=橙/ending=灰)
3. 折叠角标直观显示折叠子节点数量
4. Handle 锚点左侧 target、右侧 source,符合从左到右阅读习惯

**否决方案**:
- 圆形气泡: 信息密度低,不适合显示标题+摘要+状态
- 复杂图形节点: 增加渲染负担,300 节点时性能下降

### 8.3 连线样式决策

**样式**: 统一贝塞尔曲线 + 颜色区分 + 选中态加粗

**理由**:
1. 贝塞尔曲线平滑美观,符合现代图编辑器审美
2. 颜色区分四类型,无需额外图例
3. 选中态加粗(opacity=1)与默认态(opacity=0.7)区分

**否决方案**:
- 折线: 视觉生硬,不符合"平滑曲线"需求
- 带动画的流动光效: 性能开销大,300 边时帧率下降

### 8.4 持久化决策

**方案**: JSON 单文件 + txt 摘要双写

**理由**:
1. JSON 单文件避免文件碎片,读写原子性强
2. txt 摘要满足"双向同步"需求(用户可读+可手动编辑参考)
3. Rust 后端原子写入(.tmp + rename)防崩溃丢数据
4. schema_version 字段为未来迁移预留空间

**否决方案**:
- SQLite: 引入额外依赖,对百级节点规模过度设计
- 多文件节点: 文件碎片化,原子性差

### 8.5 空状态决策

**方案**: 简单文字提示 + 图标,无引导图示

**理由**: 符合项目"无 AI 式文案"约束,工程化简洁风格

### 8.6 辅助功能决策

**方案**: 点阵背景 + MiniMap 右下 + Controls 左下

**理由**:
1. 点阵背景: 视觉引导,辅助定位
2. MiniMap: 大型项目导航必备
3. Controls: 缩放/居中/锁定按钮

---

## 9. 验收标准

### 9.1 功能验收

- [ ] Alt+9 唤起时间线编辑器
- [ ] 空状态显示提示文字
- [ ] 右键画布空白可创建四类型节点
- [ ] 右键 main 节点可创建后继/上下分支/事件
- [ ] 拖拽节点流畅,窗口不动
- [ ] Handle 拖拽创建连线
- [ ] 自环与重复连线被拦截
- [ ] 双击节点打开抽屉
- [ ] 抽屉编辑触发双层防抖保存
- [ ] main 节点折叠/展开,子节点 BFS 隐藏
- [ ] childCount 自动维护,归零取消折叠
- [ ] Ctrl+S 立即保存
- [ ] Ctrl+L 整理布局
- [ ] Ctrl+Z 撤销,Ctrl+Y/Ctrl+Shift+Z 重做
- [ ] 拖拽过程合并为单步历史
- [ ] timeline.json 原子写入
- [ ] _剧情时间线摘要.txt 自动生成
- [ ] 崩溃后 .tmp 自动清理
- [ ] schema 版本自动迁移
- [ ] 数据完整性校验(含环检测)

### 9.2 性能验收

- [ ] 100 节点流畅 60fps
- [ ] 300 节点可交互,偶有卡顿
- [ ] 拖拽过程无掉帧
- [ ] 防抖保存下 I/O 频率 < 2 次/秒

### 9.3 工程验收

- [ ] tsc --noEmit 类型检查通过
- [ ] cargo check Rust 检查通过
- [ ] vite build 构建通过
- [ ] tauri build 生成 MSI + NSIS 安装包
- [ ] 零 any/unknown
- [ ] 所有函数含中文工程注释
- [ ] 版本号 6 文件同步至 26.7.8

---

## 10. 附录

### 10.1 依赖版本

| 依赖 | 版本 | 用途 |
|---|---|---|
| @xyflow/react | ^12.3.0 | React Flow 核心库 |
| @dagrejs/dagre | ^1.1.4 | 自动布局算法 |
| zundo | ^2.2.0 | Zustand 历史中间件 |

### 10.2 文件清单

**新增文件**:
- `src/lib/stores/timelineTypes.ts`
- `src/lib/stores/timelineStore.ts`
- `src/lib/timelineApi.ts`
- `src/lib/dagreLayout.ts`
- `src/components/TimelinePanel.tsx`
- `src/components/TimelineNode.tsx`
- `src/components/TimelineEdge.tsx`
- `src/components/TimelineDrawer.tsx`
- `src/components/TimelineContextMenu.tsx`
- `src/components/TimelineEmpty.tsx`
- `src-tauri/src/timeline_commands.rs`

**修改文件**:
- `package.json`(新增依赖 + 版本号)
- `src-tauri/Cargo.toml`(版本号)
- `src-tauri/tauri.conf.json`(版本号)
- `src-tauri/src/lib.rs`(注册命令)
- `src-tauri/src/project_template.rs`(目录变更)
- `src/lib/store.ts`(新增 timeline 分类)
- `src/lib/categoryRegistry.ts`(新增 PanelType)
- `src/lib/i18n.tsx`(新增 timeline 命名空间)
- `src/components/Workspace.tsx`(Alt+9 + 面板渲染)
- `src/lib/updateChecker.ts`(版本号)
- `src/components/Launcher.tsx`(版本号)
- `src/components/SettingsDialog.tsx`(版本号)

### 10.3 相关文档

- 项目硬约束: `c:\Users\fanqu\.trae-cn\memory\projects\-c-Atian-Project-Trae-project-writing\project_memory.md`
- 用户偏好: `c:\Users\fanqu\.trae-cn\memory\user_profile.md`
