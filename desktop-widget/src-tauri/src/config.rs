use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ReminderFlags {
    pub rain: bool,
    pub snow: bool,
    pub temp_drop: bool,
    pub severe: bool,
}

impl Default for ReminderFlags {
    fn default() -> Self {
        Self { rain: true, snow: true, temp_drop: false, severe: false }
    }
}

// 单条预设时间提醒
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimeReminder {
    pub time: String,     // "07:30"
    pub summary: bool,    // 系统通知是否附带天气详情
    pub on: bool,         // 是否启用
}

// 固定新闻源（内置，可逐个开关）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FixedSource {
    pub name: String,
    pub url: String,
    pub on: bool,
}

pub fn default_fixed_sources() -> Vec<FixedSource> {
    vec![
        FixedSource { name: "少数派".into(), url: "https://sspai.com/feed".into(), on: true },
        FixedSource { name: "36氪".into(), url: "https://36kr.com/feed".into(), on: true },
        FixedSource { name: "V2EX".into(), url: "https://www.v2ex.com/index.xml".into(), on: true },
        FixedSource { name: "Hacker News".into(), url: "https://hnrss.org/frontpage".into(), on: false },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub city: String,
    pub reminders: ReminderFlags,
    // 多条预设时间提醒（上限 5）
    pub time_reminders: Vec<TimeReminder>,
    // RSS 用户自填源（上限 5）
    pub rss_feeds: Vec<String>,
    // 固定新闻源（内置，逐个开关）
    pub fixed_sources: Vec<FixedSource>,
    pub festival_skin_enabled: bool,
    // ===== 视图偏好（原型版设置面板） =====
    // 日历是否显示农历
    pub show_lunar: bool,
    // 日期显示「周日」而非「日」
    pub show_week_label: bool,
    // 窗口配色方案（blue/green/orange/gray）
    pub color_scheme: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            city: "南昌".into(),
            reminders: ReminderFlags::default(),
            time_reminders: vec![
                TimeReminder { time: "07:30".into(), summary: true, on: true },
                TimeReminder { time: "21:00".into(), summary: false, on: true },
            ],
            rss_feeds: vec!["https://sspai.com/feed".into()],
            fixed_sources: default_fixed_sources(),
            festival_skin_enabled: true,
            show_lunar: true,
            show_week_label: false,
            color_scheme: "blue".into(),
        }
    }
}

pub const REMINDER_MAX: usize = 5;
pub const RSS_MAX: usize = 5;

pub fn config_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&dir);
    dir.join("settings.json")
}

pub fn load_settings(app: &tauri::AppHandle) -> AppSettings {
    let path = config_path(app);
    match fs::read_to_string(&path) {
        Ok(txt) => serde_json::from_str(&txt).unwrap_or_default(),
        Err(_) => AppSettings::default(),
    }
}

pub fn save_settings(app: &tauri::AppHandle, settings: &AppSettings) {
    let path = config_path(app);
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(path, json);
    }
}
