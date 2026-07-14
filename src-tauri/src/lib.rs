// 喵创说 应用入口模块
//
// 功能概述：
// 初始化 Tauri 应用，注册文件系统插件、项目管理命令与版本快照命令。
//
// 模块职责：
// 1. 声明子模块
// 2. 注册 Tauri 插件(dialog/fs/shell)
// 3. 注册文件系统命令
// 4. 注册版本快照命令
// 5. 启动应用

mod commands;
mod index_sync;
mod project_template;
mod snapshot_commands;
mod character_commands;
mod template_schema;
mod codex;
mod timeline_commands;
mod character_graph_commands;
mod word_count;
mod editor_preferences;
mod text_extractor;
mod tantivy_indexer;
mod tantivy_search;
mod ai_context;
mod prosemirror_parser;
mod ai_config;
mod ai_commands;
mod error;
pub use error::AppError;

/// 应用入口函数
/// 输入: 无
/// 输出: 无
/// 流程:
///   1. 创建 Tauri 应用构建器
///   2. 注册 dialog/fs/shell 插件
///   3. 注册文件系统命令
///   4. 注册版本快照命令
///   5. 启动应用
///
/// 命令注册说明:
///   Tauri 2.0 的 `invoke_handler` 采用 builder 模式,内部以 `Option<F>` 存储处理器,
///   多次调用会覆盖前一次设置而非累加。因此所有命令必须集中在单一
///   `generate_handler!` 宏中注册。此处按业务模块分组组织,使用分节注释
///   保持可读性,命令路径与模块结构一一对应。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            // ============================================================
            // 项目管理命令 (6 项) - commands::project_commands
            // 职责: 项目 CRUD、目录选择、元数据更新
            // ============================================================
            commands::project_commands::create_project,
            commands::project_commands::scan_projects,
            commands::project_commands::import_project,
            commands::project_commands::pick_directory,
            commands::project_commands::delete_project,
            commands::project_commands::update_project_meta,

            // ============================================================
            // 文件 IO 命令 (7 项) - commands::file_io_commands
            // 职责: 项目树读取、文件读写、路径操作
            // ============================================================
            commands::file_io_commands::read_project_tree,
            commands::file_io_commands::read_file,
            commands::file_io_commands::write_file,
            commands::file_io_commands::create_file,
            commands::file_io_commands::delete_path,
            commands::file_io_commands::rename_path,
            commands::file_io_commands::copy_file,

            // ============================================================
            // 搜索与统计命令 (3 项) - commands::search_replace_commands / writing_stats_commands
            // 职责: 全文搜索、批量替换、字数统计
            // ============================================================
            commands::search_replace_commands::search_in_project,
            commands::search_replace_commands::replace_in_project,
            commands::writing_stats_commands::get_writing_stats,

            // ============================================================
            // 项目导入导出命令 (2 项) - commands::archive_commands
            // 职责: 项目归档导出与导入
            // ============================================================
            commands::archive_commands::export_project,
            commands::archive_commands::import_archive,

            // ============================================================
            // 自定义模板管理命令 (3 项) - commands::custom_template_commands
            // 职责: 自定义模板的列表、保存、删除
            // ============================================================
            commands::custom_template_commands::list_custom_templates,
            commands::custom_template_commands::save_custom_template,
            commands::custom_template_commands::delete_custom_template,

            // ============================================================
            // 版本快照命令 (7 项) - snapshot_commands
            // 职责: 快照的创建、读取、恢复、删除、清理、统计
            // ============================================================
            snapshot_commands::create_snapshot,
            snapshot_commands::list_snapshots,
            snapshot_commands::read_snapshot,
            snapshot_commands::restore_snapshot,
            snapshot_commands::delete_snapshot,
            snapshot_commands::clear_snapshots,
            snapshot_commands::get_snapshot_stats,

            // ============================================================
            // 角色联动命令 (3 项) - character_commands
            // 职责: 角色出现次数统计、全局重命名、角色摘要读取
            // ============================================================
            character_commands::count_character_appearances,
            character_commands::rename_character_in_project,
            character_commands::read_character_summary,

            // ============================================================
            // 模块化模板系统命令 (5 项) - template_schema
            // 职责: 模板列表、渲染、自定义文件模板 CRUD
            // ============================================================
            template_schema::get_templates,
            template_schema::render_template,
            template_schema::save_custom_file_template,
            template_schema::delete_custom_file_template,
            template_schema::list_custom_file_templates,

            // ============================================================
            // 智能设定库 (Codex) 命令 (6 项) - codex::scan / codex::crud
            // 职责: 实体提及扫描、CRUD、front matter 注入、无效提及检测
            // ============================================================
            codex::scan::scan_entity_mentions,
            codex::scan::batch_scan_entities,
            codex::crud::list_codex_entities,
            codex::crud::inject_codex_front_matter,
            codex::crud::update_codex_entity,
            codex::scan::scan_invalid_mentions,

            // ============================================================
            // 剧情时间线编辑器命令 (3 项) - timeline_commands
            // 职责: 时间线的读取、保存、清空
            // ============================================================
            timeline_commands::read_timeline,
            timeline_commands::save_timeline,
            timeline_commands::clear_timeline,

            // ============================================================
            // 人物关系图编辑器命令 (3 项) - character_graph_commands
            // 职责: 人物关系图的读取、保存、清空
            // ============================================================
            character_graph_commands::read_character_graph,
            character_graph_commands::save_character_graph,
            character_graph_commands::clear_character_graph,

            // ============================================================
            // 编辑器偏好配置命令 (4 项) - editor_preferences
            // 职责: 用户级偏好与项目级配置的读写
            // ============================================================
            editor_preferences::get_user_preferences,
            editor_preferences::set_user_preferences,
            editor_preferences::get_project_config,
            editor_preferences::set_project_config,

            // ============================================================
            // 全文索引与搜索命令 (5 项) - tantivy_search
            // 职责: 基于 Tantivy + jieba 的中文全文索引与检索
            // ============================================================
            tantivy_search::search_project,
            tantivy_search::build_project_index,
            tantivy_search::get_project_index_stats,
            tantivy_search::update_file_index,
            tantivy_search::remove_file_index,

            // ============================================================
            // AI 上下文提取命令 (3 项) - ai_context
            // 职责: 场景、角色、项目级上下文提取 (AI-Ready 接口阶段)
            // ============================================================
            ai_context::get_scene_context,
            ai_context::get_character_context,
            ai_context::get_project_context,

            // ============================================================
            // AI 配置管理命令 (3 项) - ai_config
            // 职责: BYOK 模式下的 API Key/Base URL/Model 持久化与连通性测试
            // ============================================================
            ai_config::get_ai_config,
            ai_config::set_ai_config,
            ai_config::test_ai_connection,

            // ============================================================
            // AI 流式聊天命令 (2 项) - ai_commands
            // 职责: OpenAI 兼容协议的 SSE 流式推送与取消
            // ============================================================
            ai_commands::chat_completion_stream,
            ai_commands::cancel_chat_completion,
            // ============================================================
            // 命令注册总计: 65 项,按 16 个业务模块分组
            // ============================================================
        ])
        .setup(|_app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("运行 喵创说 应用时发生错误");
}
