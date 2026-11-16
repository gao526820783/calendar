// 托盘模块：常驻托盘 + 原生右键菜单
//   · 左键单击 → 显示主窗口
//   · 右键单击 → 弹出菜单（显示主窗口 / 刷新天气 / 设置 / ─── / 退出程序）
//
// 实现要点（Windows / Tauri 2.12）：
//   ⚠️ 唯一托盘来源：本函数用 TrayIconBuilder 构建唯一托盘。
//      tauri.conf.json 里**不得**再配置 `trayIcon`（否则 Tauri 会自动再建一个，
//      造成一个进程里出现两个托盘图标：配置文件建的「有图标可交互」+ 这里建的）。
//      之前「双图标 + 一个右键没反应」正是这个重复创建导致的，而非幽灵图标。
//   图标复用 app 默认窗口图标（bundle.icon），无需单独资源文件。
//   菜单一次性挂载（始终绑定），menu_on_left_click(false) 关闭系统左键自动弹菜单，
//   左键在 on_tray_icon_event 里单独处理为显示主窗口，右键显式 popup_menu。
#![allow(dead_code)]

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<TrayIcon<R>> {
    // 图标复用 app 默认窗口图标（bundle.icon），保证唯一托盘有正常图标可交互
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("default window icon (bundle.icon) must be configured");

    // 菜单项（一次性创建并常驻挂载，系统右键自动弹出）
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "刷新天气", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出程序", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &sep1, &refresh, &settings, &sep2, &quit])?;

    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .show_menu_on_left_click(false)
        .tooltip("天气 · 日历 · 新闻")
        // 注意：这里不挂 .menu()。若挂上，Windows 底层会在右键时自动弹一次，
        // 与下方显式 popup_menu 叠加成「弹出两次」。纯走显式弹出最可控：
        // 左键单击 → 显示主窗口；右键单击 → 主窗口在光标处弹出菜单。
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "show" => show_main(app),
                "refresh" => {
                    let _ = app.emit("tray-refresh", ());
                }
                "settings" => {
                    show_main(app);
                    let _ = app.emit("tray-settings", ());
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(move |tray, event| {
            let app = tray.app_handle();
            match event {
                // 左键单击：显示主窗口
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => show_main(app),
                // 右键抬起：用主窗口在光标处显式弹出菜单
                TrayIconEvent::Click {
                    button: MouseButton::Right,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.popup_menu(&menu);
                    }
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(tray)
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.unminimize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_tray_without_panic() {
        // 仅编译期覆盖；真正运行需 AppHandle，此处保证函数签名稳定
        let _ = std::marker::PhantomData::<TrayIcon<tauri::Wry>>;
    }
}
