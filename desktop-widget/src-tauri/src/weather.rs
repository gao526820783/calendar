use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

/// 全国省市数据（与前端 src/data/cities.json 为同一份文件）
///
/// 编译期直接嵌入二进制：既省掉运行时读文件/打包资源的麻烦，
/// 也保证前后端坐标表永远一致（此前是两份手工副本，容易不同步）。
/// 数据更新方式：改 scripts/data/ 下的源数据 → node scripts/gen-city-data.mjs
const CITIES_JSON: &str = include_str!("../../src/data/cities.json");

#[derive(Debug, Deserialize)]
struct CitiesFile {
    provinces: Vec<ProvinceNode>,
}

#[derive(Debug, Deserialize)]
struct ProvinceNode {
    #[allow(dead_code)]
    name: String,
    cities: Vec<CityNode>,
}

#[derive(Debug, Deserialize)]
struct CityNode {
    name: String,
    lat: f64,
    lon: f64,
}

/// 城市名 → (纬度, 经度)，进程内懒加载一次
fn city_coords() -> &'static HashMap<String, (f64, f64)> {
    static TABLE: OnceLock<HashMap<String, (f64, f64)>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let Ok(file) = serde_json::from_str::<CitiesFile>(CITIES_JSON) else {
            return HashMap::new();
        };
        file.provinces
            .into_iter()
            .flat_map(|p| p.cities)
            .map(|c| (c.name, (c.lat, c.lon)))
            .collect()
    })
}

/// 内置城市坐标查询；未命中时由调用方走地理编码接口。
pub fn builtin_coords(city: &str) -> Option<(f64, f64)> {
    city_coords().get(city).copied()
}

pub const WIND_DIRS: [&str; 8] = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];

pub fn wind_dir_text(deg: f64) -> String {
    let idx = ((deg / 45.0).round() as usize) % 8;
    format!("{}风", WIND_DIRS[idx])
}

pub fn wind_level(speed_kmh: f64) -> u32 {
    let levels = [1.0, 6.0, 12.0, 20.0, 29.0, 39.0, 50.0, 62.0, 75.0, 89.0, 103.0, 117.0];
    let mut lvl = 0u32;
    for (i, t) in levels.iter().enumerate() {
        if speed_kmh >= *t {
            lvl = i as u32 + 1;
        }
    }
    lvl
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CurrentWeather {
    pub temperature: f64,
    pub humidity: f64,
    pub weather_code: i64,
    pub wind_speed: f64,
    pub wind_direction: f64,
    pub is_day: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HourlyItem {
    pub time: String,
    pub temperature: f64,
    pub weather_code: i64,
    pub precipitation_probability: i64, // 降水概率 %
}

/// 逐日预报
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DailyItem {
    pub date: String,     // "2026-11-09"
    pub weather_code: i64,
    pub temp_max: f64,
    pub temp_min: f64,
    pub precipitation_probability: i64, // 降水概率 %
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WeatherData {
    pub current: CurrentWeather,
    pub hourly: Vec<HourlyItem>,
    pub daily: Vec<DailyItem>,
    pub updated_at: String,
    pub city: String,
}

// Open-Meteo 响应结构（只取需要的字段）
#[derive(Debug, Deserialize)]
struct OmForecast {
    current: OmCurrent,
    hourly: OmHourly,
    daily: Option<OmDaily>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct OmCurrent {
    temperature_2m: f64,
    relative_humidity_2m: f64,
    weather_code: i64,
    wind_speed_10m: f64,
    wind_direction_10m: f64,
    is_day: i64,
}

#[derive(Debug, Deserialize)]
struct OmHourly {
    time: Vec<String>,
    temperature_2m: Vec<f64>,
    weather_code: Vec<i64>,
    #[serde(default)]
    precipitation_probability: Option<Vec<Option<i64>>>,
}

#[derive(Debug, Deserialize)]
struct OmDaily {
    time: Vec<String>,
    weather_code: Vec<i64>,
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
    #[serde(default)]
    precipitation_probability_max: Option<Vec<Option<i64>>>,
}

pub async fn geocode(client: &reqwest::Client, city: &str) -> Result<(f64, f64), String> {
    if let Some(c) = builtin_coords(city) {
        return Ok(c);
    }
    let url = format!(
        "https://geocoding-api.open-meteo.com/v1/search?name={}&count=1&language=zh&format=json",
        urlencode(city)
    );
    let resp: serde_json::Value = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let first = resp
        .get("results")
        .and_then(|r| r.as_array())
        .and_then(|a| a.first())
        .ok_or_else(|| "城市未找到".to_string())?;
    let lat = first.get("latitude").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let lon = first.get("longitude").and_then(|v| v.as_f64()).unwrap_or(0.0);
    Ok((lat, lon))
}

fn urlencode(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u32),
        })
        .collect()
}

pub async fn fetch_weather(
    client: &reqwest::Client,
    city: &str,
) -> Result<WeatherData, String> {
    let (lat, lon) = geocode(client, city).await?;
    // forecast_days=7：提供 7 天逐日预报；hourly 覆盖 7 天逐时数据供前端取用
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day&hourly=temperature_2m,weather_code,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia/Shanghai&forecast_days=7",
        lat, lon
    );
    let om: OmForecast = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    // 取未来 24 小时（从当前小时开始）
    let now = chrono::Local::now().format("%Y-%m-%dT%H:00").to_string();
    let start = om
        .hourly
        .time
        .iter()
        .position(|t| t.as_str() >= now.as_str())
        .unwrap_or(0);
    let end = (start + 24).min(om.hourly.time.len());
    let hourly = (start..end)
        .map(|i| HourlyItem {
            time: om.hourly.time[i].clone(),
            temperature: om.hourly.temperature_2m[i],
            weather_code: om.hourly.weather_code[i],
            precipitation_probability: om
                .hourly
                .precipitation_probability
                .as_ref()
                .and_then(|v| v.get(i).copied().flatten())
                .unwrap_or(0),
        })
        .collect();

    // 逐日预报（今天起 7 天）
    let daily = om
        .daily
        .as_ref()
        .map(|d| {
            let n = d.time.len();
            (0..n)
                .map(|i| DailyItem {
                    date: d.time[i].clone(),
                    weather_code: d.weather_code.get(i).copied().unwrap_or(0),
                    temp_max: d.temperature_2m_max.get(i).copied().unwrap_or(0.0),
                    temp_min: d.temperature_2m_min.get(i).copied().unwrap_or(0.0),
                    precipitation_probability: d
                        .precipitation_probability_max
                        .as_ref()
                        .and_then(|v| v.get(i).copied().flatten())
                        .unwrap_or(0),
                })
                .collect()
        })
        .unwrap_or_default();

    let updated_at = chrono::Local::now().format("%H:%M").to_string();
    Ok(WeatherData {
        current: CurrentWeather {
            temperature: om.current.temperature_2m,
            humidity: om.current.relative_humidity_2m,
            weather_code: om.current.weather_code,
            wind_speed: om.current.wind_speed_10m,
            wind_direction: om.current.wind_direction_10m,
            is_day: om.current.is_day == 1,
        },
        hourly,
        daily,
        updated_at,
        city: city.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn city_table_loads() {
        let table = city_coords();
        assert!(
            table.len() >= 380,
            "城市坐标表应覆盖全国地级市，实际 {} 个",
            table.len()
        );
    }

    #[test]
    fn builtin_coords_covers_all_provinces() {
        // 34 个省级单位各自的代表城市都必须能查到坐标
        let samples = [
            "北京", "天津", "上海", "重庆", "石家庄", "太原", "呼和浩特", "沈阳",
            "长春", "哈尔滨", "南京", "杭州", "合肥", "福州", "南昌", "济南", "郑州",
            "武汉", "长沙", "广州", "南宁", "海口", "成都", "贵阳", "昆明", "拉萨",
            "西安", "兰州", "西宁", "银川", "乌鲁木齐", "台北", "香港", "澳门",
        ];
        for c in samples {
            assert!(builtin_coords(c).is_some(), "缺少城市坐标：{c}");
        }
    }

    #[test]
    fn builtin_coords_rejects_unknown_city() {
        assert!(builtin_coords("不存在的城市xyz").is_none());
    }

    #[test]
    fn coords_in_valid_range() {
        for (name, &(lat, lon)) in city_coords() {
            assert!(
                (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon),
                "{name} 坐标越界：{lat},{lon}"
            );
        }
    }

    #[tokio::test]
    async fn fetch_real_weather() {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .unwrap();
        match fetch_weather(&client, "昆明").await {
            Ok(d) => {
                println!("hourly={} daily={}", d.hourly.len(), d.daily.len());
                println!("first hourly: {:?}", d.hourly.first());
                println!("first daily: {:?}", d.daily.first());
                println!("last daily: {:?}", d.daily.last());
            }
            Err(e) => println!("ERR: {e}"),
        }
    }
}
