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

mod fs_commands;
mod project_template;
mod snapshot_commands;
mod character_commands;
mod template_schema;
mod codex_commands;
mod timeline_commands;
mod character_graph_commands;
mod word_count;
mod editor_preferences;
mod text_extractor;
mod pmd_migration;
mod tantivy_indexer;
mod tantivy_search;
mod ai_context;
mod legacy_migration;

/// 应用入口函数
/// 输入: 无
/// 输出: 无
/// 流程:
///   1. 创建 Tauri 应用构建器
///   2. 注册 dialog/fs/shell 插件
///   3. 注册文件系统命令
///   4. 注册版本快照命令
///   5. 启动应用
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            // 项目管理命令
            fs_commands::create_project,
            fs_commands::scan_projects,
            fs_commands::import_project,
            fs_commands::pick_directory,
            fs_commands::delete_project,
            fs_commands::update_project_meta,
            // 文件操作命令
            fs_commands::read_project_tree,
            fs_commands::is_legacy_project,
            fs_commands::read_file,
            fs_commands::write_file,
            fs_commands::create_file,
            fs_commands::delete_path,
            fs_commands::rename_path,
            fs_commands::copy_file,
            // 搜索与统计命令
            fs_commands::search_in_project,
            fs_commands::replace_in_project,
            fs_commands::get_writing_stats,
            // 分卷章节生成命令
            fs_commands::generate_volume_chapters,
            // 项目导入导出命令
            fs_commands::export_project,
            fs_commands::import_archive,
            // 自定义模板管理命令
            fs_commands::list_custom_templates,
            fs_commands::save_custom_template,
            fs_commands::delete_custom_template,
            // 版本快照命令
            snapshot_commands::create_snapshot,
            snapshot_commands::list_snapshots,
            snapshot_commands::read_snapshot,
            snapshot_commands::restore_snapshot,
            snapshot_commands::delete_snapshot,
            snapshot_commands::clear_snapshots,
            snapshot_commands::get_snapshot_stats,
            // 角色联动命令
            character_commands::count_character_appearances,
            character_commands::rename_character_in_project,
            character_commands::read_character_summary,
            // 模块化模板系统命令
            template_schema::get_templates,
            template_schema::render_template,
            template_schema::save_custom_file_template,
            template_schema::delete_custom_file_template,
            template_schema::list_custom_file_templates,
            // 智能设定库（Codex）命令
            codex_commands::scan_entity_mentions,
            codex_commands::batch_scan_entities,
            codex_commands::list_codex_entities,
            codex_commands::inject_codex_front_matter,
            // 剧情时间线编辑器命令
            timeline_commands::read_timeline,
            timeline_commands::save_timeline,
            timeline_commands::clear_timeline,
            // 人物关系图编辑器命令
            character_graph_commands::read_character_graph,
            character_graph_commands::save_character_graph,
            character_graph_commands::clear_character_graph,
            // 编辑器偏好配置命令
            editor_preferences::get_user_preferences,
            editor_preferences::set_user_preferences,
            editor_preferences::get_project_config,
            editor_preferences::set_project_config,
            // .pmd 格式迁移命令
            pmd_migration::migrate_project_to_pmd,
            pmd_migration::get_migration_state,
            pmd_migration::clear_migration_state,
            // 全文索引与搜索命令（Tantivy + jieba 中文分词）
            tantivy_search::search_project,
            tantivy_search::build_project_index,
            tantivy_search::get_project_index_stats,
            tantivy_search::update_file_index,
            tantivy_search::remove_file_index,
            // AI 上下文提取命令（AI-Ready: 接口定义阶段，返回 Mock 空数据）
            ai_context::get_scene_context,
            ai_context::get_character_context,
            ai_context::get_project_context,
            // 旧版项目目录结构迁移命令
            legacy_migration::migrate_legacy_project,
        ])
        .setup(|_app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("运行 喵创说 应用时发生错误");
}
