// NovelForge 应用入口模块
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
mod foreshadowing_commands;
mod template_schema;
mod codex_commands;
mod scene_commands;
mod ai_commands;

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
            // 文件操作命令
            fs_commands::read_project_tree,
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
            // 伏笔追踪命令
            foreshadowing_commands::scan_foreshadowing,
            // 模块化模板系统命令
            template_schema::get_templates,
            template_schema::render_template,
            template_schema::save_custom_file_template,
            template_schema::delete_custom_file_template,
            template_schema::list_custom_file_templates,
            // 智能设定库（Codex）命令
            codex_commands::scan_entity_mentions,
            codex_commands::batch_scan_entities,
            // 场景化叙事工作台命令
            scene_commands::list_scenes,
            scene_commands::save_scenes,
            scene_commands::update_scene_field,
            scene_commands::list_scene_files,
            // AI 辅助创作命令（接口预留，不实装）
            ai_commands::ai_continue_writing,
            ai_commands::ai_summarize,
            ai_commands::ai_polish,
            ai_commands::ai_generate_outline,
            ai_commands::ai_character_suggest,
            ai_commands::ai_check_consistency,
            ai_commands::get_ai_config,
            ai_commands::save_ai_config,
        ])
        .setup(|_app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("运行 NovelForge 应用时发生错误");
}
