// 提醒模块：后端定时器驱动，每分钟检查天气，触发通知。
// PRD 7.1/7.2：下雨/下雪/降温/恶劣天气 + 预设时间天气摘要。每种每天最多推送一次。
#![allow(dead_code)]

use crate::config::AppSettings;
use crate::weather::{self, WeatherData};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::RwLock;

pub struct ReminderState {
    // 每类天气提醒"当天已推送"标记，key: (类型, 日期)
    sent: HashMap<String, String>,
    last_weather: Option<WeatherData>,
    // 当天已触发的预设时间提醒集合（time|日期），支持多条各自每天一次
    preset_fired: HashSet<String>,
}

impl ReminderState {
    pub fn new() -> Self {
        Self {
            sent: HashMap::new(),
            last_weather: None,
            preset_fired: HashSet::new(),
        }
    }
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn already_sent(state: &mut ReminderState, kind: &str) -> bool {
    let key = format!("{}|{}", kind, today());
    state.sent.get(kind).map(|v| v.as_str()) == Some(key.as_str())
}

fn mark_sent(state: &mut ReminderState, kind: &str) {
    state.sent.insert(kind.to_string(), format!("{}|{}", kind, today()));
}

fn is_precip_code(code: i64, snow: bool) -> bool {
    if snow {
        matches!(code, 71 | 73 | 75 | 77 | 85 | 86)
    } else {
        matches!(code, 51 | 53 | 55 | 61 | 63 | 65 | 80 | 81 | 82 | 95 | 96 | 99)
    }
}

fn future_codes(w: &WeatherData, hours: usize) -> Vec<i64> {
    w.hourly.iter().take(hours).map(|h| h.weather_code).collect()
}

pub fn evaluate(w: &WeatherData, settings: &AppSettings) -> Vec<String> {
    let mut msgs = Vec::new();
    let codes2h = future_codes(w, 2);
    let r = &settings.reminders;

    if r.rain && codes2h.iter().any(|&c| is_precip_code(c, false)) {
        msgs.push("未来 2 小时有降水，记得带伞 ☔".into());
    }
    if r.snow && codes2h.iter().any(|&c| is_precip_code(c, true)) {
        msgs.push("未来 2 小时可能下雪，注意保暖 ❄️".into());
    }
    if r.severe && codes2h.iter().any(|&c| matches!(c, 95 | 96 | 99)) {
        msgs.push("未来 2 小时有雷暴等恶劣天气，注意安全 ⛈️".into());
    }
    // 降温：未来 6 小时温差下降超过阈值（默认 5°C）
    if r.temp_drop && w.hourly.len() >= 6 {
        let t0 = w.hourly[0].temperature;
        let t5 = w.hourly[5].temperature;
        if t0 - t5 >= 5.0 {
            msgs.push(format!("未来 6 小时降温约 {:.0}°C，注意添衣 🧥", t0 - t5));
        }
    }
    msgs
}

pub async fn run_loop(app: AppHandle, state: Arc<RwLock<ReminderState>>) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
    loop {
        interval.tick().await;
        let settings = {
            let cfg = app.state::<Arc<RwLock<AppSettings>>>();
            let val = cfg.read().await.clone();
            val
        };
        let client = reqwest::Client::new();
        let w = match weather::fetch_weather(&client, &settings.city).await {
            Ok(w) => w,
            Err(_) => continue,
        };

        // 触发天气变化提醒
        let msgs = evaluate(&w, &settings);
        let mut st = state.write().await;
        st.last_weather = Some(w.clone());
        for m in msgs {
            let kind = kind_of(&m);
            if !already_sent(&mut st, kind) {
                send_notification(&app, &settings.city, &m);
                mark_sent(&mut st, kind);
            }
        }
        drop(st);

        // 预设时间提醒（多条，各自每天最多一次）
        let now_hm = chrono::Local::now().format("%H:%M").to_string();
        let day = today();
        // 收集本轮要触发的提醒（时间匹配 + 已启用）
        let due: Vec<crate::config::TimeReminder> = settings
            .time_reminders
            .iter()
            .filter(|r| r.on && r.time == now_hm)
            .cloned()
            .collect();
        let mut st = state.write().await;
        for r in due {
            let key = format!("{}|{}", r.time, day);
            if !st.preset_fired.contains(&key) {
                let body = if r.summary { preset_summary(&w) } else { preset_title(&w) };
                send_notification(&app, &settings.city, &body);
                st.preset_fired.insert(key);
            }
        }
        // 清理过期标记（非当天）
        st.preset_fired.retain(|k| k.ends_with(&day));
    }
}

fn kind_of(msg: &str) -> &'static str {
    if msg.contains("雨") { "rain" }
    else if msg.contains("雪") { "snow" }
    else if msg.contains("雷暴") || msg.contains("恶劣") { "severe" }
    else if msg.contains("降温") { "temp_drop" }
    else { "other" }
}

fn preset_summary(w: &WeatherData) -> String {
    use crate::weather::{wind_dir_text, wind_level};
    let now = chrono::Local::now();
    let date = now.format("%-m月%-d日").to_string();
    // %u: 1=周一..7=周日 → 转成 日一二三四五六 的索引
    let week_idx = match now.format("%u").to_string().parse::<usize>().unwrap_or(7) {
        1 => 1, 2 => 2, 3 => 3, 4 => 4, 5 => 5, 6 => 6, _ => 0,
    };
    let wd = ["日", "一", "二", "三", "四", "五", "六"][week_idx];
    let desc = w_code_desc(w.current.weather_code);
    let precip = if future_codes(w, 2).iter().any(|&c| is_precip_code(c, false)) {
        "未来 2 小时有降水"
    } else {
        "未来 2 小时无降水"
    };
    format!(
        "{} 星期{}\n{} {:.0}°C，{} {} 级\n{}",
        date,
        wd,
        desc,
        w.current.temperature,
        wind_dir_text(w.current.wind_direction),
        wind_level(w.current.wind_speed),
        precip
    )
}

// 精简版提醒：只给一句温度与现象（对应设置里的「仅提醒」）
fn preset_title(w: &WeatherData) -> String {
    let desc = w_code_desc(w.current.weather_code);
    format!("{} {:.0}°C", desc, w.current.temperature)
}

fn w_code_desc(code: i64) -> &'static str {
    match code {
        0 => "晴",
        1 | 2 => "多云",
        3 => "阴",
        45 | 48 => "雾",
        51 | 53 | 55 => "毛毛雨",
        61 => "小雨",
        63 => "中雨",
        65 => "大雨",
        71 => "小雪",
        73 => "中雪",
        75 => "大雪",
        77 => "雪粒",
        80 | 81 | 82 => "阵雨",
        85 | 86 => "阵雪",
        95 | 96 | 99 => "雷暴",
        _ => "未知",
    }
}

fn send_notification(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
    // 同时向前端发事件，便于界面联动（可选）
    let _ = app.emit("weather-reminder", body);
}
