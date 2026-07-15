// ProseMirror JSON 公共解析模块
//
// 功能概述：
// 提供 ProseMirror 文档 JSON 的解析与文本提取能力，作为 ai_context 与其他模块的公共依赖。
//
// 模块职责：
// 1. split_doc_into_scenes: 按场景分隔节点切分 ProseMirror 文档
// 2. extract_text_from_nodes: 从节点列表递归提取纯文本
// 3. extract_character_ids_from_nodes: 从节点列表提取角色 ID（去重）
//
// 设计说明：
// - 本模块为无状态纯函数模块，所有函数均不可变借用输入参数
// - SceneSlice 结构对外公开，便于调用方按场景索引访问节点
// - 递归函数 collect_text_from_node 与 collect_character_ids 为模块内部实现细节，不对外暴露

use serde_json::Value;
use std::collections::HashSet;

/// 场景切片（一组顶层节点，由场景分隔节点划分）
///
/// 由 split_doc_into_scenes 返回，每个切片对应一个场景的顶层节点集合
/// （不含 sceneBreak / horizontalRule 分隔节点本身）
#[derive(Debug, Clone)]
pub struct SceneSlice {
    /// 场景内的顶层节点列表（不含分隔节点本身）
    pub nodes: Vec<Value>,
}

/// 将 ProseMirror JSON 文档按场景分隔节点切分
///
/// 输入: doc_json ProseMirror JSON 文档（顶层 type=="doc"）
/// 输出: Vec<SceneSlice> 场景切片列表
/// 流程:
///   1. 读取 doc.content 数组（顶层节点列表）
///   2. 遍历节点，遇到 sceneBreak / horizontalRule 时开启新场景
///   3. 第一个分隔节点之前的内容视为"前导场景"（场景 0）
///   4. 无分隔节点时，整个文档视为单一场景
///   5. 若第一场景为空且有多场景，移除空的前导场景
pub fn split_doc_into_scenes(doc_json: &Value) -> Vec<SceneSlice> {
    // 初始化时已包含 1 个空 SceneSlice，保证返回值至少 1 个元素
    let mut slices: Vec<SceneSlice> = vec![SceneSlice { nodes: vec![] }];
    let content = doc_json.get("content").and_then(|c| c.as_array());
    if let Some(nodes) = content {
        for node in nodes {
            let node_type = node.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if node_type == "sceneBreak" || node_type == "horizontalRule" {
                // 遇到分隔节点: 开启新场景
                slices.push(SceneSlice { nodes: vec![] });
            } else {
                // 普通节点: 追加到当前场景
                // 防御性说明: slices 初始化时已包含 1 个空 SceneSlice, 理论上 last_mut() 必返回 Some;
                // 但为遵循生产代码禁用 unwrap 的规范, 改用 if let 安全模式,
                // 若 slices 异常为空则丢弃当前节点, 保证流程不中断
                if let Some(last) = slices.last_mut() {
                    last.nodes.push(node.clone());
                }
            }
        }
    }
    // 若第一场景为空且有多场景，移除空的前导场景
    if slices.len() > 1 && slices[0].nodes.is_empty() {
        slices.remove(0);
    }
    slices
}

/// 从节点列表递归提取纯文本
///
/// 输入: nodes ProseMirror 节点 JSON 数组
/// 输出: String 拼接后的纯文本（首尾空白已 trim）
/// 流程: 遍历节点调用 collect_text_from_node 递归收集文本，最后 trim
/// 说明: 本函数仅返回文本，scene_id 跟踪结果被丢弃，保持向后兼容
pub fn extract_text_from_nodes(nodes: &[Value]) -> String {
    let mut text = String::new();
    // scene_id 在此函数中不需要返回，使用本地变量接收后丢弃
    let mut current_scene_id: Option<String> = None;
    for node in nodes {
        collect_text_from_node(node, &mut text, &mut current_scene_id);
    }
    text.trim().to_string()
}

/// 从 ProseMirror JSON 文档提取首个场景 ID
///
/// 输入: doc_json ProseMirror JSON 文档（顶层 type=="doc"）
/// 输出: Option<String> 场景 ID（首个 sceneBreak 节点的 attrs.id，无 sceneBreak 时为 None）
/// 流程: 深度优先遍历文档节点树，返回首个 sceneBreak 节点的 attrs.id
/// 用途: 供 tantivy_indexer 在索引 .pmd 文件时提取 scene_id 写入索引字段
pub fn extract_scene_id_from_doc(doc_json: &Value) -> Option<String> {
    extract_scene_id_recursive(doc_json)
}

/// 递归查找首个 sceneBreak 节点的场景 ID
///
/// 输入:
///   node - 当前节点 JSON
/// 输出: Option<String> 场景 ID（找到时返回 Some，未找到返回 None）
/// 流程:
///   1. 当前节点为 sceneBreak 时返回 attrs.id
///   2. 递归遍历 content 子节点，返回首个非 None 结果
fn extract_scene_id_recursive(node: &Value) -> Option<String> {
    let node_type = node.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if node_type == "sceneBreak" {
        // 提取 attrs.id 作为 scene_id
        return node
            .get("attrs")
            .and_then(|a| a.get("id"))
            .and_then(|i| i.as_str())
            .map(|s| s.to_string());
    }
    // 递归遍历 content 子节点
    if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
        for child in content {
            if let Some(id) = extract_scene_id_recursive(child) {
                return Some(id);
            }
        }
    }
    None
}

/// 递归从单个节点收集文本的公共核心函数
///
/// Task 6.2.1 抽取: 统一 prosemirror_parser 与 text_extractor 的节点遍历逻辑,
/// 消除两处重复的 match 分派实现,通过 collect_scene_id 参数控制是否收集场景 ID。
///
/// 输入:
///   node - ProseMirror 节点 JSON
///   out - 输出文本缓冲区（可变引用）
///   collect_scene_id - 是否收集 scene_id（为 true 时遇到 sceneBreak 更新 scene_id）
///   scene_id - 当前场景 ID（可变引用，仅在 collect_scene_id=true 时被更新）
/// 流程: 按节点 type 分派处理
///   - text: 追加 text 属性
///   - sceneBreak: collect_scene_id=true 时提取 attrs.id 更新 scene_id,追加场景分隔占位符
///   - horizontalRule: 追加场景分隔占位符（不更新 scene_id）
///   - characterMentionNode: 追加 attrs.name
///   - hardBreak: 追加换行
///   - paragraph / heading 等块级节点: 递归子节点后追加换行
///   - 列表节点: 递归子节点后追加换行
///   - 其他节点: 递归 content 数组
pub(crate) fn collect_text_from_node_core(
    node: &Value,
    out: &mut String,
    collect_scene_id: bool,
    scene_id: &mut Option<String>,
) {
    let node_type = node.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match node_type {
        "text" => {
            if let Some(t) = node.get("text").and_then(|t| t.as_str()) {
                out.push_str(t);
            }
        }
        "sceneBreak" => {
            // 仅当 collect_scene_id 为 true 时提取 attrs.id 更新场景标识
            // ProseMirror sceneBreak 节点结构: { "type": "sceneBreak", "attrs": { "id": "scene_xxx" } }
            if collect_scene_id {
                if let Some(id) = node
                    .get("attrs")
                    .and_then(|a| a.get("id"))
                    .and_then(|i| i.as_str())
                {
                    *scene_id = Some(id.to_string());
                }
            }
            out.push_str("\n* * *\n");
        }
        "horizontalRule" => {
            out.push_str("\n* * *\n");
        }
        "characterMentionNode" => {
            // 角色提及节点: 优先使用 attrs.name
            if let Some(name) = node
                .get("attrs")
                .and_then(|a| a.get("name"))
                .and_then(|n| n.as_str())
            {
                out.push_str(name);
            }
        }
        "hardBreak" => {
            out.push('\n');
        }
        "paragraph" | "heading" | "blockquote" | "codeBlock" => {
            if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
                for child in content {
                    collect_text_from_node_core(child, out, collect_scene_id, scene_id);
                }
            }
            out.push('\n');
        }
        "bulletList" | "orderedList" | "taskList" | "listItem" | "taskItem" => {
            if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
                for child in content {
                    collect_text_from_node_core(child, out, collect_scene_id, scene_id);
                }
            }
            out.push('\n');
        }
        _ => {
            // 其他节点: 递归处理 content 数组
            if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
                for child in content {
                    collect_text_from_node_core(child, out, collect_scene_id, scene_id);
                }
            }
        }
    }
}

/// 递归从单个节点收集文本，同时跟踪当前场景 ID
///
/// 输入:
///   node - ProseMirror 节点 JSON
///   out - 输出文本缓冲区（可变引用）
///   current_scene_id - 当前场景 ID（可变引用，遇到 sceneBreak 时更新为 attrs.id）
/// 流程: 委托给 collect_text_from_node_core,开启 scene_id 收集
fn collect_text_from_node(node: &Value, out: &mut String, current_scene_id: &mut Option<String>) {
    collect_text_from_node_core(node, out, true, current_scene_id);
}

/// 从节点列表中提取角色 ID（characterMentionNode 的 attrs.characterId）
///
/// 输入: nodes ProseMirror 节点 JSON 数组
/// 输出: Vec<String> 角色 ID 列表（已去重，保留首次出现顺序）
/// 流程: 遍历节点调用 collect_character_ids 递归收集，使用 HashSet 去重
pub fn extract_character_ids_from_nodes(nodes: &[Value]) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for node in nodes {
        collect_character_ids(node, &mut ids, &mut seen);
    }
    ids
}

/// 递归收集角色 ID
///
/// 输入:
///   node - 当前节点 JSON
///   ids - 累积的角色 ID 列表（可变引用）
///   seen - 已收集 ID 集合（用于去重，可变引用）
/// 流程:
///   1. 节点为 characterMentionNode 时读取 attrs.characterId，非空且未出现则追加
///   2. 递归处理 content 数组中的子节点
fn collect_character_ids(node: &Value, ids: &mut Vec<String>, seen: &mut HashSet<String>) {
    let node_type = node.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if node_type == "characterMentionNode" {
        if let Some(id) = node
            .get("attrs")
            .and_then(|a| a.get("characterId"))
            .and_then(|c| c.as_str())
        {
            if !id.is_empty() && seen.insert(id.to_string()) {
                ids.push(id.to_string());
            }
        }
    }
    // 递归处理 content 数组
    if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
        for child in content {
            collect_character_ids(child, ids, seen);
        }
    }
}

// ===== 单元测试 =====
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 测试: 从含 sceneBreak 的文档提取首个 scene_id
    #[test]
    fn test_extract_scene_id_from_doc_with_scene_break() {
        let doc = json!({
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "场景一内容"}]
                },
                {
                    "type": "sceneBreak",
                    "attrs": { "id": "scene_001" }
                },
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "场景二内容"}]
                }
            ]
        });
        let scene_id = extract_scene_id_from_doc(&doc);
        assert_eq!(scene_id, Some("scene_001".to_string()));
    }

    /// 测试: 无 sceneBreak 的文档返回 None
    #[test]
    fn test_extract_scene_id_from_doc_without_scene_break() {
        let doc = json!({
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "无场景分隔的文本"}]
                }
            ]
        });
        let scene_id = extract_scene_id_from_doc(&doc);
        assert_eq!(scene_id, None);
    }

    /// 测试: sceneBreak 无 attrs.id 时返回 None
    #[test]
    fn test_extract_scene_id_from_doc_scene_break_without_id() {
        let doc = json!({
            "type": "doc",
            "content": [
                {
                    "type": "sceneBreak",
                    "attrs": {}
                }
            ]
        });
        let scene_id = extract_scene_id_from_doc(&doc);
        assert_eq!(scene_id, None);
    }

    /// 测试: extract_text_from_nodes 保持向后兼容（仅返回文本）
    #[test]
    fn test_extract_text_from_nodes_backward_compatible() {
        let nodes = vec![
            json!({
                "type": "paragraph",
                "content": [{"type": "text", "text": "测试文本"}]
            }),
        ];
        let text = extract_text_from_nodes(&nodes);
        assert_eq!(text, "测试文本");
    }
}
