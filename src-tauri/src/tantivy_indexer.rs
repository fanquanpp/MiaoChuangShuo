// 全文索引核心模块（Tantivy + jieba 中文分词）
//
// 功能概述：
// 基于 Tantivy 构建项目级全文索引，支持中文分词（jieba）。
// 提供文档写入、索引提交、索引重建能力，供 tantivy_search 模块查询使用。
//
// 模块职责：
// 1. 定义索引 Schema（文件路径/相对路径/文件名/正文/章节号/更新时间）
// 2. 将正文按段落切分为 Chunk，每个 Chunk 作为一篇文档
// 3. 集成 tantivy-jieba 分词器，支持中文按词切分
// 4. 提供索引构建、增量更新、损坏重建机制
// 5. 索引目录位于 .novelforge/index/，与项目元数据隔离
//
// 设计说明：
// - 索引按"段落 Chunk"粒度建立，避免单文件过大导致查询结果缺失上下文
// - 文本字段使用 jieba 分词器，文件路径字段使用 raw tokenizer（精确匹配）
// - 索引损坏时（加载失败）自动重建，保证可用性
// - Windows HVCI 限制：本模块不使用 Command::output()，全部基于 Tauri 事件推送进度

use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tantivy::collector::TopDocs;
use tantivy::doc;
use tantivy::query::QueryParser;
use tantivy::schema::{Field, Schema, INDEXED, STORED, STRING, TEXT, Value};
use tantivy::tokenizer::TokenizerManager;
use tantivy::Index;
use tantivy_jieba::JiebaTokenizer;

use crate::text_extractor::{detect_format, extract_plain_text};

/// 索引目录名（位于 .novelforge/ 下）
const INDEX_DIR_NAME: &str = "index";

/// 单 Chunk 最大字符数（超出则按段落切分）
/// 设计依据：单段落通常 200-800 字，1000 字上限可保证查询结果具备完整语义
const CHUNK_MAX_CHARS: usize = 1000;

/// 索引文档结构（对应 Schema 字段）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexedChunk {
    /// 文件相对路径（相对于项目根，含"正文/"前缀）
    pub file_path: String,
    /// 文件名（含扩展名）
    pub file_name: String,
    /// Chunk 在文件中的序号（从 0 开始）
    pub chunk_index: u32,
    /// Chunk 文本内容
    pub text: String,
    /// 文件最后修改时间（ISO 8601）
    pub updated_at: String,
}

/// 索引构建进度事件 payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexProgress {
    /// 已处理文件数
    pub processed: usize,
    /// 总文件数
    pub total: usize,
    /// 当前处理文件名
    pub current_file: String,
    /// 进度百分比（0-100）
    pub percent: u8,
    /// 阶段：scan / index / commit / done / error
    pub stage: String,
}

/// 索引统计信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStats {
    /// 索引文档总数（Chunk 粒度）
    pub doc_count: u64,
    /// 已索引文件数
    pub file_count: u64,
    /// 索引大小（字节）
    pub index_size: u64,
    /// 最后构建时间（ISO 8601）
    pub last_built_at: String,
}

/// 索引 Schema 字段集合
///
/// 字段说明：
/// - file_path: 文件相对路径，raw tokenizer，用于按文件路径过滤
/// - file_name: 文件名，raw tokenizer，用于按文件名检索
/// - chunk_index: Chunk 序号，INDEXED，用于结果定位
/// - text: 正文文本，jieba 分词，全文检索主字段
/// - updated_at: 更新时间，STORED，用于结果展示
/// - scene_id: 场景标识（AI-Ready），关联 sceneBreak 节点的 id，用于按场景语义召回
/// - chunk_type: Chunk 类型（AI-Ready），manuscript/setting/outline，用于 AI 按类型过滤
pub struct IndexSchema {
    pub file_path: Field,
    pub file_name: Field,
    pub chunk_index: Field,
    pub text: Field,
    pub updated_at: Field,
    pub scene_id: Field,
    pub chunk_type: Field,
}

impl IndexSchema {
    /// 构建索引 Schema
    /// 输出: (Schema, IndexSchema) Tantivy Schema 与字段集合
    /// 流程: 逐字段注册到 SchemaBuilder，text 字段使用 TEXT（分词）
    pub fn build() -> (Schema, Self) {
        let mut builder = Schema::builder();
        let file_path = builder.add_text_field("file_path", STRING | STORED);
        let file_name = builder.add_text_field("file_name", STRING | STORED);
        let chunk_index = builder.add_u64_field("chunk_index", INDEXED | STORED);
        let text = builder.add_text_field("text", TEXT | STORED);
        let updated_at = builder.add_text_field("updated_at", STORED);
        let scene_id = builder.add_text_field("scene_id", STRING | STORED);
        let chunk_type = builder.add_text_field("chunk_type", STRING | STORED);
        let schema = builder.build();
        (
            schema,
            Self {
                file_path,
                file_name,
                chunk_index,
                text,
                updated_at,
                scene_id,
                chunk_type,
            },
        )
    }
}

/// 获取索引目录路径
/// 输入: project_root 项目根目录
/// 输出: PathBuf 索引目录路径（.novelforge/index/）
pub fn get_index_dir(project_root: &Path) -> PathBuf {
    project_root.join(".novelforge").join(INDEX_DIR_NAME)
}

/// 打开或创建索引
/// 输入: project_root 项目根目录
/// 输出: Result<(Index, IndexSchema), String> 索引实例与字段集合
/// 流程:
///   1. 构建索引目录路径
///   2. 目录存在且可加载时打开已有索引
///   3. 目录不存在或加载失败时创建新索引
///   4. 注册 jieba 分词器到 TokenizerManager
///   5. 索引损坏（加载失败）时删除并重建
pub fn open_or_create_index(project_root: &Path) -> Result<(Index, IndexSchema), String> {
    let index_dir = get_index_dir(project_root);
    let (schema, schema_fields) = IndexSchema::build();

    // 确保父目录存在
    if let Some(parent) = index_dir.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建索引父目录失败: {}", e))?;
    }

    // 尝试打开已有索引，失败则重建
    let index = if index_dir.exists() {
        match Index::open_in_dir(&index_dir) {
            Ok(idx) => idx,
            Err(e) => {
                // 索引损坏：删除旧索引目录后重建
                // 触发条件：加载失败（schema 不匹配/文件损坏/版本不一致）
                // 记录错误原因便于排查（不中断流程，自动重建）
                eprintln!("索引损坏，将重建: {}", e);
                let _ = fs::remove_dir_all(&index_dir);
                fs::create_dir_all(&index_dir)
                    .map_err(|rebuild_e| format!("重建索引目录失败: {}", rebuild_e))?;
                Index::create_in_dir(&index_dir, schema.clone())
                    .map_err(|create_e| format!("创建索引失败: {}", create_e))?
            }
        }
    } else {
        fs::create_dir_all(&index_dir).map_err(|e| format!("创建索引目录失败: {}", e))?;
        Index::create_in_dir(&index_dir, schema.clone())
            .map_err(|e| format!("创建索引失败: {}", e))?
    };

    // 注册 jieba 分词器（中文按词切分）
    let tokenizer_manager: &TokenizerManager = index.tokenizers();
    tokenizer_manager.register("jieba", JiebaTokenizer);

    Ok((index, schema_fields))
}

/// 将文本按段落切分为 Chunk
/// 输入: text 原始文本
/// 输出: Vec<String> Chunk 列表
/// 流程:
///   1. 按换行符分割段落
///   2. 累积段落至超过 CHUNK_MAX_CHARS 时切出 Chunk
///   3. 末尾不足一个 Chunk 的剩余文本作为最后一个 Chunk
///   4. 空文本返回单个空段落 Chunk（保证至少一篇文档）
pub fn split_into_chunks(text: &str) -> Vec<String> {
    if text.is_empty() {
        return vec![String::new()];
    }

    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::with_capacity(CHUNK_MAX_CHARS);

    // 按换行分割段落，兼容 Windows CRLF
    for line in text.split('\n').map(|l| l.trim_end_matches('\r')) {
        // 当前 Chunk 已满且非空，先推入结果
        if current.len() + line.len() + 1 > CHUNK_MAX_CHARS && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push('\n');
        }
        current.push_str(line);
    }

    // 推入最后一个 Chunk
    if !current.is_empty() {
        chunks.push(current);
    }

    // 极端情况：全部为空行，返回单个空段落
    if chunks.is_empty() {
        chunks.push(String::new());
    }

    chunks
}

/// 索引单个文件（按 Chunk 切分后写入索引）
/// 输入:
///   index_writer - Tantivy 索引写入器
///   schema - 索引字段集合
///   file_path - 文件绝对路径
///   relative_path - 文件相对路径（相对于项目根，含"正文/"前缀）
///   updated_at - 文件最后修改时间（ISO 8601）
///   chunk_type - Chunk 类型（manuscript/setting/outline，AI-Ready 字段）
/// 输出: Result<u32, String> 写入的 Chunk 数量
/// 流程:
///   1. 读取文件内容
///   2. 调用 text_extractor 提取纯文本（自动识别 .txt/.html/.pmd 格式）
///   3. 按段落切分为 Chunk
///   4. 每个 Chunk 作为一篇文档写入索引，scene_id 暂为空（待阶段 3 语义节点填充）
pub fn index_file(
    index_writer: &mut tantivy::IndexWriter,
    schema: &IndexSchema,
    file_path: &Path,
    relative_path: &str,
    updated_at: &str,
    chunk_type: &str,
) -> Result<u32, String> {
    let content = fs::read_to_string(file_path)
        .map_err(|e| format!("读取文件失败 {}: {}", file_path.display(), e))?;

    // 检测格式并提取纯文本（detect_format 需要文件名作为格式判断辅助）
    let file_name_str = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let format = detect_format(&file_name_str, &content);
    let plain_text = extract_plain_text(&content, format);

    // 按 Chunk 切分并写入索引
    let chunks = split_into_chunks(&plain_text);
    let mut chunk_count: u32 = 0;

    for (idx, chunk_text) in chunks.iter().enumerate() {
        let chunk_idx = idx as u64;
        // scene_id 暂为空字符串，待阶段 3 sceneBreak 节点实现后由语义分析填充
        let scene_id = "";
        let doc = doc!(
            schema.file_path => relative_path,
            schema.file_name => file_name_str.as_str(),
            schema.chunk_index => chunk_idx,
            schema.text => chunk_text.as_str(),
            schema.updated_at => updated_at,
            schema.scene_id => scene_id,
            schema.chunk_type => chunk_type,
        );
        index_writer
            .add_document(doc)
            .map_err(|e| format!("写入文档失败: {}", e))?;
        chunk_count += 1;
    }

    Ok(chunk_count)
}

/// 删除指定文件的所有索引文档
/// 输入:
///   index_writer - Tantivy 索引写入器
///   schema - 索引字段集合
///   relative_path - 文件相对路径
/// 输出: Result<(), String> 删除结果
/// 流程: 按 file_path 字段构造 Term 删除所有匹配文档
///       注意: delete_term 返回 u64（删除文档数）而非 Result，无需错误处理
pub fn delete_file_from_index(
    index_writer: &mut tantivy::IndexWriter,
    schema: &IndexSchema,
    relative_path: &str,
) -> Result<(), String> {
    let term = tantivy::Term::from_field_text(schema.file_path, relative_path);
    // Tantivy 0.22 API: delete_term 返回 u64（实际删除的文档数），不返回 Result
    let _deleted_count = index_writer.delete_term(term);
    Ok(())
}

/// 构建项目全文索引（全量重建）
/// 输入:
///   project_root - 项目根目录
///   emit - 进度事件发射器（可选，传 None 则不推送进度）
/// 输出: Result<IndexStats, String> 索引统计信息
/// 流程:
///   1. 打开或创建索引
///   2. 清空旧索引（delete_all_documents）
///   3. 扫描正文目录下所有 .txt/.html/.pmd 文件
///   4. 逐文件提取文本、切分 Chunk、写入索引
///   5. 每处理 10 个文件推送一次进度
///   6. 提交索引并返回统计信息
pub fn build_full_index<F>(
    project_root: &Path,
    emit: F,
) -> Result<IndexStats, String>
where
    F: Fn(IndexProgress),
{
    let (index, schema) = open_or_create_index(project_root)?;
    let mut index_writer = index
        .writer(50_000_000)
        .map_err(|e| format!("创建索引写入器失败: {}", e))?;

    // 清空旧索引
    index_writer
        .delete_all_documents()
        .map_err(|e| format!("清空旧索引失败: {}", e))?;

    let manuscript_dir = project_root.join("正文");
    if !manuscript_dir.exists() {
        // 空项目：直接提交并返回空统计
        index_writer
            .commit()
            .map_err(|e| format!("提交索引失败: {}", e))?;
        return Ok(IndexStats {
            doc_count: 0,
            file_count: 0,
            index_size: 0,
            last_built_at: chrono::Local::now().to_rfc3339(),
        });
    }

    // 扫描待索引文件
    let files = collect_indexable_files(&manuscript_dir, project_root)?;
    let total = files.len();

    emit(IndexProgress {
        processed: 0,
        total,
        current_file: String::new(),
        percent: 0,
        stage: "scan".to_string(),
    });

    let mut file_count: u64 = 0;
    let mut doc_count: u64 = 0;

    for (idx, (abs_path, rel_path)) in files.iter().enumerate() {
        let file_name = abs_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        emit(IndexProgress {
            processed: idx,
            total,
            current_file: file_name.clone(),
            percent: ((idx as f64 / total.max(1) as f64) * 100.0) as u8,
            stage: "index".to_string(),
        });

        // 获取文件修改时间
        let updated_at = abs_path
            .metadata()
            .and_then(|m| m.modified())
            .map(|t| {
                let dt: chrono::DateTime<chrono::Local> = t.into();
                dt.to_rfc3339()
            })
            .unwrap_or_default();

        match index_file(
            &mut index_writer,
            &schema,
            abs_path,
            rel_path,
            &updated_at,
            infer_chunk_type(rel_path),
        ) {
            Ok(chunks) => {
                doc_count += chunks as u64;
                file_count += 1;
            }
            Err(e) => {
                // 单文件失败不中断整体流程，记录错误继续
                eprintln!("索引文件失败 {}: {}", rel_path, e);
            }
        }

        // 每 10 个文件推送一次进度
        if idx % 10 == 0 {
            emit(IndexProgress {
                processed: idx,
                total,
                current_file: file_name,
                percent: ((idx as f64 / total.max(1) as f64) * 100.0) as u8,
                stage: "index".to_string(),
            });
        }
    }

    emit(IndexProgress {
        processed: total,
        total,
        current_file: String::new(),
        percent: 100,
        stage: "commit".to_string(),
    });

    index_writer
        .commit()
        .map_err(|e| format!("提交索引失败: {}", e))?;

    // 计算索引大小
    let index_size = calculate_dir_size(&get_index_dir(project_root));

    emit(IndexProgress {
        processed: total,
        total,
        current_file: String::new(),
        percent: 100,
        stage: "done".to_string(),
    });

    Ok(IndexStats {
        doc_count,
        file_count,
        index_size,
        last_built_at: chrono::Local::now().to_rfc3339(),
    })
}

/// 根据文件相对路径推断 Chunk 类型（AI-Ready 字段）
/// 输入: rel_path 文件相对路径（如 "正文/第一章.txt"、"设定/角色.md"）
/// 输出: &'static str Chunk 类型字符串
/// 流程:
///   1. 路径以"正文/"开头 → manuscript
///   2. 路径以"设定/"开头 → setting
///   3. 路径以"大纲/"开头 → outline
///   4. 其他 → manuscript（默认归为正文，保证未知路径不丢失索引）
/// 设计依据: AI 按场景语义召回时需要区分正文/设定/大纲三类知识源
pub fn infer_chunk_type(rel_path: &str) -> &'static str {
    if rel_path.starts_with("正文/") || rel_path.starts_with("正文\\") {
        "manuscript"
    } else if rel_path.starts_with("设定/") || rel_path.starts_with("设定\\") {
        "setting"
    } else if rel_path.starts_with("大纲/") || rel_path.starts_with("大纲\\") {
        "outline"
    } else {
        // 默认归为正文类型，保证未知路径的文件仍可被索引
        "manuscript"
    }
}

/// 递归收集可索引文件（.txt/.html/.pmd）
/// 输入:
///   dir - 当前扫描目录
///   project_root - 项目根目录（用于计算相对路径）
/// 输出: Result<Vec<(PathBuf, String)>, String> 文件绝对路径与相对路径列表
fn collect_indexable_files(
    dir: &Path,
    project_root: &Path,
) -> Result<Vec<(PathBuf, String)>, String> {
    let mut result = Vec::new();
    collect_files_recursive(dir, project_root, &mut result)?;
    Ok(result)
}

/// 递归收集文件辅助函数
fn collect_files_recursive(
    dir: &Path,
    project_root: &Path,
    result: &mut Vec<(PathBuf, String)>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files_recursive(&path, project_root, result)?;
        } else {
            // 仅索引 .txt/.html/.htm/.pmd 文件
            let is_indexable = path
                .extension()
                .map(|e| {
                    let ext = e.to_string_lossy().to_lowercase();
                    ext == "txt" || ext == "html" || ext == "htm" || ext == "pmd"
                })
                .unwrap_or(false);
            if is_indexable {
                let rel_path = path
                    .strip_prefix(project_root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                result.push((path, rel_path));
            }
        }
    }
    Ok(())
}

/// 计算目录大小（字节）
fn calculate_dir_size(dir: &Path) -> u64 {
    let mut total: u64 = 0;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                total += calculate_dir_size(&path);
            } else if let Ok(meta) = path.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

/// 获取索引统计信息（不重建索引）
/// 输入: project_root 项目根目录
/// 输出: Result<IndexStats, String> 索引统计
/// 流程:
///   1. 打开索引（失败则返回空统计）
///   2. 读取索引 reader 统计文档数
///   3. 计算索引目录大小
pub fn get_index_stats(project_root: &Path) -> Result<IndexStats, String> {
    let index_dir = get_index_dir(project_root);
    if !index_dir.exists() {
        return Ok(IndexStats {
            doc_count: 0,
            file_count: 0,
            index_size: 0,
            last_built_at: String::new(),
        });
    }

    let (index, _schema) = open_or_create_index(project_root)?;
    let reader = index
        .reader()
        .map_err(|e| format!("创建索引 reader 失败: {}", e))?;
    let searcher = reader.searcher();
    let doc_count = searcher.num_docs();

    let index_size = calculate_dir_size(&index_dir);

    // 从索引目录的修改时间推断最后构建时间
    let last_built_at = index_dir
        .metadata()
        .and_then(|m| m.modified())
        .map(|t| {
            let dt: chrono::DateTime<chrono::Local> = t.into();
            dt.to_rfc3339()
        })
        .unwrap_or_default();

    Ok(IndexStats {
        doc_count,
        file_count: 0, // file_count 需要从元数据读取，此处暂返回 0
        index_size,
        last_built_at,
    })
}

/// 简单查询接口（供 tantivy_search 模块调用）
/// 输入:
///   project_root - 项目根目录
///   query_str - 查询字符串
///   limit - 返回结果上限
/// 输出: Result<Vec<SearchResult>, String> 查询结果列表
pub fn search(
    project_root: &Path,
    query_str: &str,
    limit: usize,
) -> Result<Vec<SearchResult>, String> {
    let (index, schema) = open_or_create_index(project_root)?;
    let reader = index
        .reader()
        .map_err(|e| format!("创建索引 reader 失败: {}", e))?;
    let searcher = reader.searcher();

    let query_parser = QueryParser::for_index(&index, vec![schema.text]);
    let query = query_parser
        .parse_query(query_str)
        .map_err(|e| format!("解析查询失败: {}", e))?;

    let top_docs = searcher
        .search(&query, &TopDocs::with_limit(limit))
        .map_err(|e| format!("执行查询失败: {}", e))?;

    let mut results = Vec::new();
    for (_score, doc_address) in top_docs {
        // Tantivy 0.22: searcher.doc() 返回 TantivyDocument 具体类型
        // （Document 是 trait，TantivyDocument 是其默认实现的具体类型）
        let doc: tantivy::TantivyDocument = searcher
            .doc(doc_address)
            .map_err(|e| format!("读取文档失败: {}", e))?;
        let file_path = doc
            .get_first(schema.file_path)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let file_name = doc
            .get_first(schema.file_name)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        // chunk_index 在 schema 中是 u64 字段，使用 as_u64() 而非 as_u32()
        let chunk_index = doc
            .get_first(schema.chunk_index)
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;
        let text = doc
            .get_first(schema.text)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let updated_at = doc
            .get_first(schema.updated_at)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        results.push(SearchResult {
            file_path,
            file_name,
            chunk_index,
            text,
            updated_at,
        });
    }

    Ok(results)
}

/// 查询结果结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    /// 文件相对路径
    pub file_path: String,
    /// 文件名
    pub file_name: String,
    /// Chunk 序号
    pub chunk_index: u32,
    /// 匹配的文本片段
    pub text: String,
    /// 文件更新时间
    pub updated_at: String,
}

// ===== 单元测试 =====
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_into_chunks_empty() {
        let chunks = split_into_chunks("");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], "");
    }

    #[test]
    fn test_split_into_chunks_short() {
        let chunks = split_into_chunks("短文本");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], "短文本");
    }

    #[test]
    fn test_split_into_chunks_long() {
        // 构造超过 CHUNK_MAX_CHARS 的文本
        let long_line = "测试".repeat(CHUNK_MAX_CHARS);
        let text = format!("{}\n第二段", long_line);
        let chunks = split_into_chunks(&text);
        assert!(chunks.len() >= 2);
    }

    #[test]
    fn test_split_into_chunks_paragraphs() {
        let text = "第一段\n\n第二段\n\n第三段";
        let chunks = split_into_chunks(text);
        assert!(!chunks.is_empty());
        // 三段加两个空行，应至少切出一个 Chunk
        assert!(chunks.iter().any(|c| c.contains("第一段")));
    }

    #[test]
    fn test_get_index_dir() {
        let root = Path::new("/tmp/test_project");
        let index_dir = get_index_dir(root);
        assert!(index_dir.to_string_lossy().contains(".novelforge"));
        assert!(index_dir.to_string_lossy().contains("index"));
    }
}
