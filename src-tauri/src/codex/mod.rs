// 智能设定库（Codex）命令模块
//
// 功能概述：
// 提供 Codex 设定库的后端能力：设定文件结构化解析、格式迁移、实体 CRUD 与出现位置追踪。
// 支持 JSON front matter 元数据解析，兼容旧版纯文本设定文件。
//
// 模块组织（按职责拆分）：
// - parser:    文件解析与元数据结构定义（CodexMeta / CodexEntity / CodexMetaPatch）
// - migration: 格式迁移（.txt → .pmd）与原子写入工具
// - crud:      设定实体增删改查（list / update / inject）
// - scan:      实体出现位置扫描与失效提及检测
//
// 模块依赖关系（无循环依赖）：
//   parser（基础）
//     ↑
//   migration → parser
//   crud      → parser + migration
//   scan      → parser + crate::text_extractor

mod parser;
mod migration;
// crud 与 scan 含 #[tauri::command] 函数，需 pub mod 使 generate_handler!
// 能通过 codex::scan::function 路径定位宏生成的 __cmd__ 隐藏项
pub mod crud;
pub mod scan;

// ===== 对外公共接口 re-export =====
// 保持与原 codex_commands 模块兼容的对外接口，
// 使调用方仍可通过 codex::CodexMeta / codex::parse_codex_file 等路径访问。
// 注: lib.rs 的 invoke_handler 使用完整子模块路径（codex::scan::fn）以定位
//     Tauri 宏生成的 __cmd__ 隐藏项；此处 re-export 供其他模块按需使用。
//     以下项在 crate 内部可能无直接引用（lib.rs 走子模块路径），故抑制 unused_imports。
#[allow(unused_imports)]
// 解析层：元数据结构与解析函数
// Task 1.8: 新增 build_effective_codex_dirs / codex_dir_fallback_type 用于按 ProjectMeta 配置扫描
pub use parser::{
    CodexMeta, CodexEntity, CodexMetaPatch, parse_codex_file,
    build_effective_codex_dirs, codex_dir_fallback_type,
};

#[allow(unused_imports)]
// CRUD 层：设定实体增删改查命令
pub use crud::{list_codex_entities, update_codex_entity, inject_codex_front_matter};

#[allow(unused_imports)]
// 扫描层：实体出现位置追踪与失效提及检测命令
pub use scan::{EntityMention, InvalidMention, scan_entity_mentions, batch_scan_entities, scan_invalid_mentions};
