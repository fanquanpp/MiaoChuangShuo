// 智能设定库（Codex）- 格式迁移子模块
//
// 功能概述：
// 提供旧版 .txt 设定文件向 .pmd 格式的迁移能力，以及原子写入工具。
//
// 模块职责：
// 1. 将纯文本正文转换为 ProseMirror JSON 文档字符串
// 2. 原子写入文件（临时文件 + 重命名，保证写入原子性）
// 3. 将旧版 .txt 设定文件迁移为 .pmd 格式（front matter + ProseMirror JSON）
//
// 设计说明：
//   - .pmd 格式 = front matter（JSON 元数据）+ ProseMirror JSON（富文本正文）
//   - 迁移是一次性的、透明的，用户无感
//   - 原子写入保证迁移过程中断不会损坏文件

use std::fs;
use std::path::{Path, PathBuf};

use super::parser::parse_codex_file;

/// 将纯文本正文转换为 ProseMirror JSON 文档字符串
/// 输入: text 纯文本内容
/// 输出: String ProseMirror JSON 字符串（每行一个 paragraph）
/// 流程:
///   1. 按换行符分割文本（兼容 Windows CRLF 与 Unix LF）
///   2. 非空行转为含 text 节点的 paragraph
///   3. 空行转为空 paragraph
///   4. 包装为 doc 根节点并序列化为 JSON 字符串
fn convert_codex_text_to_pmd(text: &str) -> String {
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
    // 空文档至少保留一个空段落，避免 ProseMirror 解析失败
    if content.is_empty() {
        content.push(serde_json::json!({"type": "paragraph"}));
    }
    let doc = serde_json::json!({"type": "doc", "content": content});
    serde_json::to_string(&doc).unwrap_or_else(|_| "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}".to_string())
}

/// 原子写入文件（临时文件 + 重命名，保证写入原子性）
/// 输入: path 目标文件路径, content 文件内容
/// 输出: Result<(), String> 写入结果
/// 流程:
///   1. 写入 .tmp 临时文件（同目录，保证同一文件系统以支持原子重命名）
///   2. 重命名为目标文件
///   3. 失败时清理临时文件
pub(super) fn atomic_write_codex(path: &Path, content: &str) -> Result<(), String> {
    let tmp_path = PathBuf::from(format!("{}.tmp", path.to_string_lossy()));
    fs::write(&tmp_path, content).map_err(|e| format!("写入临时文件失败: {}", e))?;
    match fs::rename(&tmp_path, path) {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp_path);
            Err(format!("重命名文件失败: {}", e))
        }
    }
}

/// 将旧版 .txt 设定文件迁移为 .pmd 格式
/// 输入:
///   txt_path - 旧版 .txt 文件路径
///   fallback_type - 回退实体类型（用于无 front matter 的旧文件）
/// 输出: Result<PathBuf, String> 迁移后的 .pmd 文件路径
/// 流程:
///   1. 读取 .txt 文件内容
///   2. 解析 front matter + 纯文本正文
///   3. 将正文转换为 ProseMirror JSON
///   4. 构造 .pmd 文件内容（front matter + ProseMirror JSON）
///   5. 原子写入 .pmd 文件
///   6. 删除旧 .txt 文件（迁移成功后）
pub(super) fn migrate_codex_txt_to_pmd(
    txt_path: &Path,
    fallback_type: &str,
) -> Result<PathBuf, String> {
    let content = fs::read_to_string(txt_path)
        .map_err(|e| format!("读取设定文件失败: {}", e))?;

    let file_name = txt_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    let (meta, body) = parse_codex_file(&content, &file_name, fallback_type);

    // 将纯文本正文转换为 ProseMirror JSON
    let pmd_content = convert_codex_text_to_pmd(&body);

    // 构造 .pmd 文件内容：front matter + ProseMirror JSON
    let meta_json = serde_json::to_string(&meta)
        .map_err(|e| format!("序列化设定元数据失败: {}", e))?;
    let pmd_file_content = format!("---\n{}\n---\n{}", meta_json, pmd_content);

    // 原子写入 .pmd 文件（与原 .txt 同目录）
    let pmd_path = txt_path.with_extension("pmd");
    atomic_write_codex(&pmd_path, &pmd_file_content)?;

    // 迁移成功后删除旧 .txt 文件
    // 失败不阻断流程（.pmd 已写入），仅记录警告
    if let Err(e) = fs::remove_file(txt_path) {
        eprintln!("[codex] 警告: 删除旧 .txt 文件失败: {}", e);
    }

    Ok(pmd_path)
}
