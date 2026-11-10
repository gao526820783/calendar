// 入口：初始化插件、注册命令、启动常驻托盘、启动后端提醒定时器、防白屏握手。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod calendar;
mod commands;
mod config;
mod news;
mod reminders;
mod tray;
mod weather;

use commands::SettingsState;
use std::sync::Arc;
use tauri::{Emitter, Listener, Manager};
use tokio::sync::RwLock;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let handle = app.handle().clone();

            // 加载本地配置
            let settings = config::load_settings(&handle);
            app.manage::<SettingsState>(Arc::new(RwLock::new(settings)));

            // 常驻托盘
            tray::build_tray(&handle)?;

            // 防白屏握手：前端首帧渲染完成后 emit("app-ready")，这里才 show 窗口
            let h = handle.clone();
            handle.listen("app-ready", move |_event| {
                if let Some(win) = h.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            });

            // 处理托盘「刷新天气」「设置」事件转发给前端
            let h_tray = handle.clone();
            handle.listen("tray-refresh", move |_| {
                let _ = h_tray.emit("refresh-weather", ());
            });
            let h_set = handle.clone();
            handle.listen("tray-settings", move |_| {
                let _ = h_set.emit("open-settings", ());
            });

            // 后端提醒定时器（每分钟检查天气变化 + 预设时间摘要）
            // 注意：.setup() 中不能用原生 tokio::spawn（runtime 未就绪会 panic），
            // 必须用 tauri::async_runtime::spawn 调度到 Tauri 管理的 Tokio runtime。
            let reminder_state = Arc::new(RwLock::new(reminders::ReminderState::new()));
            let h2 = handle.clone();
            tauri::async_runtime::spawn(async move {
                reminders::run_loop(h2, reminder_state).await;
            });

            // 每 30 分钟通知前端刷新天气（PRD 5.3）
            let h3 = handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut iv = tokio::time::interval(std::time::Duration::from_secs(1800));
                iv.tick().await; // 跳过首次立即触发
                loop {
                    iv.tick().await;
                    let _ = h3.emit("refresh-weather", ());
                }
            });

            // 每 30 分钟刷新新闻（PRD 8.2）：后端清缓存 + 通知前端重拉
            let h4 = handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut iv = tokio::time::interval(std::time::Duration::from_secs(1800));
                iv.tick().await; // 跳过首次立即触发
                loop {
                    iv.tick().await;
                    news::invalidate_news_cache();
                    let _ = h4.emit("refresh-news", ());
                }
            });

            Ok(())
        })
        // 关闭窗口 = 隐藏到托盘（常驻），真正退出走托盘「退出」
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::fetch_weather,
            commands::fetch_news,
            commands::get_settings,
            commands::set_settings,
            commands::validate_rss,
            commands::add_time_reminder,
            commands::open_url,
            news::invalidate_news_cache
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {});
}
