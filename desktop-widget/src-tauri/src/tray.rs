// 托盘模块：常驻托盘 + 双菜单
//   · 左键单击 → 弹出「工具菜单」（显示主窗口 / 刷新天气 / 设置）
//   · 右键单击 → 弹出「退出菜单」（显示主窗口 / ─── / 退出程序）
//
// 实现要点（Windows / Tauri 2.12）：
//   系统默认左键与右键会共用同一个托盘菜单，且「换菜单再让系统弹」在异步事件下时序不可靠
//   （实测：左键手动 set_menu + show_menu 会破坏系统右键自动弹出的绑定，导致右击无反应）。
//   因此左右键**统一改为手动弹出**，都走和左键相同、已验证可靠的 show_menu() 机制：
//   1. show_menu_on_left_click(false) 关掉系统自动弹窗，避免重复弹出；
//   2. 在 on_tray_icon_event 里捕获 Left Up / Right Up；
//   3. 先 set_menu(目标菜单) → show_menu()（阻塞直到用户选择/取消）→ set_menu(None) 解绑，
//      休息态保持无菜单挂载，既防止系统重复弹，也避免 set_menu 残留绑定。
#![allow(dead_code)]

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

// 右键菜单项统一加 "x-" 前缀，避免与左键菜单项重名；处理时剥离即可
const PREFIX_RIGHT: &str = "x-";

/// 菜单项 ID 对应的动作
#[derive(Debug, PartialEq, Eq)]
pub enum TrayAction {
    Show,
    Refresh,
    Settings,
    Quit,
    None,
}

/// 把菜单项 ID 映射为动作（左键 / 右键两套菜单共用同一套动作名）
pub fn tray_action(id: &str) -> TrayAction {
    match id.strip_prefix(PREFIX_RIGHT).unwrap_or(id) {
        "show" => TrayAction::Show,
        "refresh" => TrayAction::Refresh,
        "settings" => TrayAction::Settings,
        "quit" => TrayAction::Quit,
        _ => TrayAction::None,
    }
}

pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<TrayIcon<R>> {
    // ===== 左键：工具菜单 =====
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "刷新天气", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let tools_menu = Menu::with_items(app, &[&show, &refresh, &settings])?;

    // ===== 右键：退出菜单 =====
    let show_r = MenuItem::with_id(
        app,
        format!("{PREFIX_RIGHT}show"),
        "显示主窗口",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        app,
        format!("{PREFIX_RIGHT}quit"),
        "退出程序",
        true,
        None::<&str>,
    )?;
    let sep = PredefinedMenuItem::separator(app)?;
    let exit_menu = Menu::with_items(app, &[&show_r, &sep, &quit])?;

    let tools_menu = tools_menu.clone();
    let exit_menu = exit_menu.clone();

    let tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("天气 · 日历 · 新闻")
        // 关掉系统自带的左右键自动弹窗，改由 on_tray_icon_event 手动弹出（见下）
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id: &str = event.id.as_ref();
            match tray_action(id) {
                TrayAction::Show => show_main(app),
                TrayAction::Refresh => {
                    let _ = app.emit("tray-refresh", ());
                }
                TrayAction::Settings => {
                    show_main(app);
                    let _ = app.emit("tray-settings", ());
                }
                TrayAction::Quit => {
                    app.exit(0);
                }
                TrayAction::None => {}
            }
        })
        .on_tray_icon_event(move |tray, event| {
            // 左键 / 右键统一手动弹出对应菜单（Windows 下系统自动弹右键不可靠）
            if let TrayIconEvent::Click {
                button,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                match button {
                    MouseButton::Left => {
                        // 工具菜单
                        let _ = tray.set_menu(Some(tools_menu.clone()));
                        let _ = tray.with_inner_tray_icon(|inner| inner.show_menu());
                        let _ = tray.set_menu::<Menu<R>>(None);
                    }
                    MouseButton::Right => {
                        // 退出菜单
                        let _ = tray.set_menu(Some(exit_menu.clone()));
                        let _ = tray.with_inner_tray_icon(|inner| inner.show_menu());
                        let _ = tray.set_menu::<Menu<R>>(None);
                    }
                    _ => {}
                }
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
    fn menu_id_maps_to_action() {
        // 左键工具菜单
        assert_eq!(tray_action("show"), TrayAction::Show);
        assert_eq!(tray_action("refresh"), TrayAction::Refresh);
        assert_eq!(tray_action("settings"), TrayAction::Settings);
        // 右键退出菜单（带 x- 前缀）
        assert_eq!(tray_action("x-show"), TrayAction::Show);
        assert_eq!(tray_action("x-quit"), TrayAction::Quit);
        // 未知项忽略
        assert_eq!(tray_action("whatever"), TrayAction::None);
    }
}
