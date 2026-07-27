// 桌面应用入口。
// 释放构建下使用 windows_subsystem = "windows" 以隐藏控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    xhs_pic_lib::run();
}
