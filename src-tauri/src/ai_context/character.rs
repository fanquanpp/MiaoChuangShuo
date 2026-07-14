// 角色级 AI 上下文模块
//
// 功能概述：
// 提供角色级上下文数据，用于 AI 角色一致性校验。从设定库读取角色完整设定，
// 结合 Tantivy 索引检索出场记录与人物关系图读取关系列表，组装角色上下文。
//
// 模块职责：
// 1. 定义 CharacterContext / AppearanceRecord / RelationshipBrief 数据结构
// 2. 实现 get_character_context Tauri 命令（Sprint 6 真实数据组装）
// 3. 提供角色出场记录收集、角色关系收集等辅助函数
//
// 设计说明：
// - get_character_context (Sprint 6) 已实现真实数据组装:
//     从设定库读取角色全文 + Tantivy 检索出场记录 + 人物关系图读取关系
// - 所有上下文结构使用 #[serde(rename_all = "camelCase")] 匹配前端 camelCase JSON

use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::character_graph_commands::read_character_graph;
use crate::codex::list_codex_entities;
use crate::tantivy_indexer::search as tantivy_search;

/// 角色上下文（AI 角色一致性校验的核心数据）
///
/// AI 价值：当 AI 生成角色对话或行为时，需要参考角色的完整设定与历史出场记录，
/// 避免"角色幻觉"（如把 A 的性格安在 B 身上）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterContext {
    /// 角色 ID（设定库 UUID）
    pub character_id: String,
    /// 角色名称
    pub name: String,
    /// 角色别名列表
    pub aliases: Vec<String>,
    /// 角色设定全文（从设定库读取）
    pub full_profile: String,
    /// 角色出场记录（从 Tantivy 索引检索，按时间倒序）
    pub appearance_records: Vec<AppearanceRecord>,
    /// 角色关系列表（从人物关系图读取）
    pub relationships: Vec<RelationshipBrief>,
}

/// 角色出场记录
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceRecord {
    /// 文件路径
    pub file_path: String,
    /// 文件名
    pub file_name: String,
    /// 出场文本片段（匹配的 Chunk 文本）
    pub excerpt: String,
    /// AI-Ready: 场景 ID（关联 sceneBreak 节点）
    /// 用于 AI 按场景分析角色出场脉络
    pub scene_id: Option<String>,
}

/// 角色关系简要
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipBrief {
    /// 目标角色 ID
    pub target_id: String,
    /// 目标角色名称
    pub target_name: String,
    /// 关系类型（朋友/敌人/师徒/恋人等）
    pub relation_type: String,
    /// 关系描述
    pub description: String,
}

/// 获取角色上下文命令（Sprint 6 已实现真实数据组装）
///
/// 输入:
///   project_path - 项目根路径
///   character_id - 角色 ID（设定库 UUID）
/// 输出: Result<CharacterContext, String> 角色上下文
/// 流程:
///   1. 从设定库读取角色完整设定（full_profile + aliases + name）
///   2. 从 Tantivy 索引检索角色出场记录（按名称 + 别名查询，合并去重，取前 5 条）
///   3. 从人物关系图读取角色关系列表（匹配 source 或 target 为该角色的边）
///   4. 组装角色上下文返回
/// 容错策略:
///   - 角色未在设定库中找到: 返回空字段 CharacterContext（不阻塞 AI 调用）
///   - Tantivy 索引未建立或查询失败: appearance_records 返回空数组
///   - 人物关系图文件不存在: relationships 返回空数组
#[tauri::command]
pub async fn get_character_context(
    project_path: String,
    character_id: String,
) -> Result<CharacterContext, String> {
    let project_root = Path::new(&project_path);

    // 步骤1: 从设定库读取角色完整设定
    let entities = list_codex_entities(project_path.clone()).unwrap_or_default();
    let character_entity = entities
        .iter()
        .find(|e| e.meta.id == character_id && e.meta.entity_type == "character");

    // 角色未找到时返回空上下文（保持向后兼容，不阻塞 AI 调用）
    let (name, aliases, full_profile) = match character_entity {
        Some(entity) => (
            entity.meta.name.clone(),
            entity.meta.aliases.clone(),
            entity.content.clone(),
        ),
        None => {
            return Ok(CharacterContext {
                character_id,
                name: String::new(),
                aliases: vec![],
                full_profile: String::new(),
                appearance_records: vec![],
                relationships: vec![],
            });
        }
    };

    // 步骤2: 从 Tantivy 索引检索角色出场记录
    // 用角色名 + 别名作为查询词，合并结果并去重（按 file_path + chunk_index）
    let appearance_records = collect_appearance_records(project_root, &name, &aliases);

    // 步骤3: 从人物关系图读取角色关系列表
    let relationships = collect_character_relationships(&project_path, &character_id);

    Ok(CharacterContext {
        character_id,
        name,
        aliases,
        full_profile,
        appearance_records,
        relationships,
    })
}

/// 收集角色出场记录（从 Tantivy 索引按名称 + 别名检索，合并去重）
///
/// 输入:
///   project_root - 项目根路径
///   character_name - 角色主名称
///   aliases - 角色别名列表
/// 输出: Vec<AppearanceRecord> 出场记录列表（最多 5 条，按文件名排序）
/// 流程:
///   1. 用主名称调用 tantivy_search 检索
///   2. 对每个别名也调用 tantivy_search 检索
///   3. 合并结果并按 (file_path, chunk_index) 去重
///   4. 截取前 5 条返回
/// 容错: 索引未建立或查询失败时返回空数组（不阻塞 AI 调用）
pub fn collect_appearance_records(
    project_root: &Path,
    character_name: &str,
    aliases: &[String],
) -> Vec<AppearanceRecord> {
    let mut results: Vec<AppearanceRecord> = Vec::new();
    let mut seen: std::collections::HashSet<(String, u32)> = std::collections::HashSet::new();

    // 构造查询词列表（主名称 + 别名，过滤空字符串）
    let mut query_terms = vec![character_name.to_string()];
    query_terms.extend(aliases.iter().cloned());
    query_terms.retain(|s| !s.is_empty());

    for term in &query_terms {
        let search_results = match tantivy_search(project_root, term, 10) {
            Ok(rs) => rs,
            Err(_) => continue, // 索引未建立或查询失败，跳过该词
        };
        for sr in search_results {
            let key = (sr.file_path.clone(), sr.chunk_index);
            if seen.insert(key) {
                // 截取匹配文本片段的前 200 字作为摘录
                let excerpt = if sr.text.chars().count() > 200 {
                    sr.text.chars().take(200).collect::<String>() + "..."
                } else {
                    sr.text.clone()
                };
                results.push(AppearanceRecord {
                    file_path: sr.file_path,
                    file_name: sr.file_name,
                    excerpt,
                    scene_id: None, // Tantivy schema 中 scene_id 当前为空，待后续填充
                });
            }
        }
    }

    // 截取前 5 条（避免 Token 爆炸）
    results.truncate(5);
    results
}

/// 收集角色关系列表（从人物关系图读取）
///
/// 输入:
///   project_path - 项目根路径
///   character_id - 目标角色 UUID
/// 输出: Vec<RelationshipBrief> 关系列表
/// 流程:
///   1. 调用 read_character_graph 读取关系图数据
///   2. 构建 node_id -> node_name 的映射
///   3. 遍历 edges，找到 source 或 target 为 character_id 的边
///   4. 对每条边，识别另一端节点并组装 RelationshipBrief
/// 容错: 关系图文件不存在或解析失败时返回空数组
fn collect_character_relationships(
    project_path: &str,
    character_id: &str,
) -> Vec<RelationshipBrief> {
    let graph = match read_character_graph(project_path.to_string()) {
        Ok(g) => g,
        Err(_) => return vec![],
    };

    // 构建 node_id -> node_name 映射
    let node_map: std::collections::HashMap<String, String> = graph
        .nodes
        .iter()
        .map(|n| (n.id.clone(), n.data.name.clone()))
        .collect();

    let mut relationships = Vec::new();
    for edge in &graph.edges {
        // source 端为当前角色：target 为关系对象
        if edge.source == character_id {
            if let Some(target_name) = node_map.get(&edge.target) {
                relationships.push(RelationshipBrief {
                    target_id: edge.target.clone(),
                    target_name: target_name.clone(),
                    relation_type: edge.data.relation_type.clone(),
                    description: edge.data.description.clone(),
                });
            }
        }
        // target 端为当前角色：source 为关系对象（反向关系）
        else if edge.target == character_id {
            if let Some(target_name) = node_map.get(&edge.source) {
                relationships.push(RelationshipBrief {
                    target_id: edge.source.clone(),
                    target_name: target_name.clone(),
                    relation_type: edge.data.relation_type.clone(),
                    description: edge.data.description.clone(),
                });
            }
        }
    }

    relationships
}
