// NovelForge 应用入口模块
//
// 功能概述：
// 初始化 Tauri 应用，注册文件系统插件与项目管理命令。
//
// 模块职责：
// 1. 声明子模块
// 2. 注册 Tauri 插件(dialog/fs/shell)
// 3. 注册文件系统命令
// 4. 启动应用

mod fs_commands;
mod project_template;

/// 应用入口函数
/// 输入: 无
/// 输出: 无
/// 流程:
///   1. 创建 Tauri 应用构建器
///   2. 注册 dialog/fs/shell 插件
///   3. 注册文件系统命令
///   4. 启动应用
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
            // 文件操作命令
            fs_commands::read_project_tree,
            fs_commands::read_file,
            fs_commands::write_file,
            fs_commands::create_file,
            fs_commands::delete_path,
        ])
        .setup(|_app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("运行 NovelForge 应用时发生错误");
}
