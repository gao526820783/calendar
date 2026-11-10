// 后端命令：天气请求、新闻拉取、配置读写均在此暴露给前端。
use crate::config::{self, AppSettings};
use crate::news::{self, NewsItem};
use crate::weather::{self, WeatherData};
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::RwLock;

pub type SettingsState = Arc<RwLock<AppSettings>>;

#[tauri::command]
pub async fn fetch_weather(city: String) -> Result<WeatherData, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    weather::fetch_weather(&client, &city).await
}

#[tauri::command]
pub async fn fetch_news(state: State<'_, SettingsState>) -> Result<Vec<NewsItem>, String> {
    let s = state.read().await.clone();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    news::fetch_news(&client, &s.rss_feeds, &s.fixed_sources).await
}

// 校验并规范化用户提交的 RSS 地址：合法性 + 去重 + 上限。返回 Ok(规范化地址) 或 Err(原因)。
#[tauri::command]
pub fn validate_rss(state: State<'_, SettingsState>, url: String) -> Result<String, String> {
    let url = url.trim().to_string();
    if !news::is_valid_feed(&url) {
        return Err("请输入以 http(s):// 开头的 RSS Feed 地址".into());
    }
    let s = state.blocking_read();
    if s.rss_feeds.iter().any(|u| u == &url) {
        return Err("该地址已添加".into());
    }
    if s.rss_feeds.len() >= config::RSS_MAX {
        return Err(format!("最多订阅 {} 个 RSS 源", config::RSS_MAX));
    }
    Ok(url)
}

// 新增一条预设时间提醒：校验时间格式、去重、上限。成功返回新列表（后端权威）。
#[tauri::command]
pub fn add_time_reminder(
    app: AppHandle,
    state: State<'_, SettingsState>,
    time: String,
) -> Result<Vec<config::TimeReminder>, String> {
    let t = time.trim().to_string();
    // 简单 HH:MM 校验
    let ok = {
        let parts: Vec<&str> = t.split(':').collect();
        parts.len() == 2
            && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
            && t.len() == 5
    };
    if !ok {
        return Err("时间格式应为 HH:MM".into());
    }
    let mut s = state.blocking_write();
    if s.time_reminders.iter().any(|r| r.time == t) {
        return Err("该时间提醒已存在".into());
    }
    if s.time_reminders.len() >= config::REMINDER_MAX {
        return Err(format!("最多添加 {} 条时间提醒", config::REMINDER_MAX));
    }
    s.time_reminders.push(config::TimeReminder { time: t, summary: false, on: true });
    config::save_settings(&app, &s);
    Ok(s.time_reminders.clone())
}

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> AppSettings {
    state.blocking_read().clone()
}

#[tauri::command]
pub fn set_settings(app: AppHandle, state: State<'_, SettingsState>, settings: AppSettings) {
    let cfg = state.clone();
    *cfg.blocking_write() = settings.clone();
    config::save_settings(&app, &settings);
}

// 用系统默认浏览器打开外部链接（新闻「查看全文」跳原文）。
// 仅允许 http(s)，避免任意协议被调起。
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !news::is_valid_feed(&url) {
        return Err("仅支持 http(s) 链接".into());
    }
    open::that(&url).map_err(|e| format!("打开链接失败：{}", e))?;
    Ok(())
}
