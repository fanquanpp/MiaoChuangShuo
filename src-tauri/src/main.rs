// 防止 Windows 释放控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    novelforge_lib::run()
}
