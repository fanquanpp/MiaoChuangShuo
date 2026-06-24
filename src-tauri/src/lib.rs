use tauri::Manager;

/// 应用入口
/// 输入: 无
/// 输出: 运行 Tauri 应用
/// 流程: 初始化 Tauri 应用并注册插件
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|_app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("运行 NovelForge 应用时发生错误");
}
