use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NewsItem {
    pub title: String,
    pub time: String,
    // 正文摘要（前端展示 + 语音播报），已清洗 HTML 标签、剥离源站尾注
    #[serde(default)]
    pub summary: String,
    // 原文链接：优先取 RSS item 的 <link>，缺失时回退到正文里「查看全文」等尾注链接
    #[serde(default)]
    pub link: String,
}

fn rel_time(seconds_ago: u64) -> String {
    if seconds_ago < 60 {
        "刚刚".into()
    } else if seconds_ago < 3600 {
        format!("{} 分钟前", seconds_ago / 60)
    } else if seconds_ago < 86400 {
        format!("{} 小时前", seconds_ago / 3600)
    } else {
        format!("{} 天前", seconds_ago / 86400)
    }
}

// 校验 RSS 地址合法性（PRD 8.2：必须 http/https 开头）
pub fn is_valid_feed(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

// 从 RSS description 提取用于语音播报的正文纯文本：
// 去 HTML 标签、还原常见 HTML 实体、压缩空白、剥离源站尾注，并截断到合理长度。
fn extract_summary(raw: &str) -> String {
    let mut s = raw.to_string();

    // 1) 去掉 CDATA 包裹（rss 库一般已处理，这里兜底）
    if let Some(start) = s.find("<![CDATA[") {
        if let Some(rest) = s[start..].find("]]>") {
            let inner = s[start + 9..start + rest].to_string();
            s = inner;
        }
    }

    // 2) 去掉所有 HTML 标签
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }

    // 3) 还原常见 HTML 实体
    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");

    // 4) 压缩空白：换行/制表符转空格，多空格合并
    let mut cleaned = String::new();
    let mut prev_space = false;
    for ch in decoded.chars() {
        if ch.is_whitespace() {
            if !prev_space && !cleaned.is_empty() {
                cleaned.push(' ');
            }
            prev_space = true;
        } else {
            cleaned.push(ch);
            prev_space = false;
        }
    }

    // 5) 剥离 RSS 源尾注（如「查看全文」「阅读更多」等）：这些本是源站跳原文的
    //    链接文字，去标签后只剩纯文本，既误导点击又对小组件无意义，剔除之。
    let cleaned = strip_tail_note(&cleaned);

    // 6) 截断：语音播报单条不宜过长，取前 200 字符
    if cleaned.chars().count() > 200 {
        let truncated: String = cleaned.chars().take(200).collect();
        format!("{}...", truncated)
    } else {
        cleaned
    }
}

// RSS 源常见尾注关键词：源站常用这些词做跳原文的链接文字
const TAIL_NOTES: &[&str] = &[
    "查看全文",
    "阅读全文",
    "阅读更多",
    "查看详情",
    "查看原文",
    "阅读原文",
    "全文阅读",
    "Read more",
    "Read More",
    "READ MORE",
    "Continue reading",
    "Continue Reading",
    "Read the full article",
    "Full article",
];

// 从摘要末尾剥离尾注文字（只处理末尾，避免误伤正文）
fn strip_tail_note(s: &str) -> String {
    let mut s = s.trim().to_string();
    loop {
        let mut matched = false;
        for n in TAIL_NOTES.iter() {
            // 只在「末尾附近」处理尾注：关键词之后仅含标点/空白，避免误伤正文里的尾注词
            if let Some(idx) = s.rfind(n) {
                let after = &s[idx + n.len()..];
                let after_trimmed: String = after
                    .trim_matches(|c: char| {
                        c.is_whitespace() || "。.．>»→:：)）".contains(c)
                    })
                    .to_string();
                if after_trimmed.is_empty() {
                    s = s[..idx].trim_end().to_string();
                    matched = true;
                    break;
                }
            }
        }
        if !matched || s.is_empty() {
            break;
        }
    }
    s
}

// 从原始 HTML 中提取尾注链接（「查看全文」等指向的原文 URL）。
// 优先返回关键词前最近的 href；找不到返回空串。RSS 中引号常被转义为 &#34;，先还原。
fn extract_tail_link(raw: &str) -> String {
    let raw = raw
        .replace("&#34;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");

    let mut pos: Option<usize> = None;
    for k in TAIL_NOTES.iter() {
        if let Some(p) = raw.find(*k) {
            pos = Some(pos.map_or(p, |q| q.min(p)));
        }
    }
    let p = match pos {
        Some(p) => p,
        None => return String::new(),
    };
    let head = &raw[..p];
    // 找 head 中最后一个 href="..." 或 href='...'
    if let Some(hp) = head.rfind("href=") {
        let rest = &head[hp + 5..];
        let (start, delim) = if rest.starts_with('"') {
            (1, '"')
        } else if rest.starts_with('\'') {
            (1, '\'')
        } else {
            (0, '"')
        };
        if let Some(end) = rest[start..].find(delim) {
            let url = &rest[start..start + end];
            if is_valid_feed(url) {
                return url.to_string();
            }
        }
    }
    String::new()
}

// 去重后合并源列表；启用源上限 8 个，避免小组件并发请求过多（PRD 8.2）
fn collect_feeds(rss_feeds: &[String], fixed_sources: &[crate::config::FixedSource]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut feeds = Vec::new();
    for u in rss_feeds.iter().chain(fixed_sources.iter().filter(|s| s.on).map(|s| &s.url)) {
        if !is_valid_feed(u) {
            continue;
        }
        if seen.insert(u.clone()) {
            feeds.push(u.clone());
        }
        if feeds.len() >= 8 {
            break;
        }
    }
    feeds
}

// 新闻缓存状态：30 分钟内复用上次结果，避免频繁拉取（PRD 8.2：启动和每 30 分钟刷新）
static NEWS_CACHE: std::sync::Mutex<Option<(std::time::Instant, Vec<NewsItem>)>> =
    std::sync::Mutex::new(None);
const NEWS_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(30 * 60);

// 强制刷新时清空缓存（由前端下拉/手动刷新调用）
#[tauri::command]
pub fn invalidate_news_cache() {
    if let Ok(mut c) = NEWS_CACHE.lock() {
        *c = None;
    }
}

pub async fn fetch_news(
    client: &reqwest::Client,
    rss_feeds: &[String],
    fixed_sources: &[crate::config::FixedSource],
) -> Result<Vec<NewsItem>, String> {
    // 命中缓存直接返回
    if let Ok(c) = NEWS_CACHE.lock() {
        if let Some((at, items)) = c.as_ref() {
            if at.elapsed() < NEWS_CACHE_TTL && !items.is_empty() {
                return Ok(items.clone());
            }
        }
    }

    let feeds = collect_feeds(rss_feeds, fixed_sources);
    if feeds.is_empty() {
        return Ok(Vec::new());
    }

    let mut items: Vec<NewsItem> = Vec::new();
    for feed in &feeds {
        let body = match client.get(feed.as_str()).send().await {
            Ok(r) => match r.text().await {
                Ok(t) => t,
                Err(_) => continue,
            },
            Err(_) => continue,
        };
        if let Ok(channel) = rss::Channel::read_from(body.as_bytes()) {
            for it in channel.items().iter().take(20) {
                let title = it.title().unwrap_or("").to_string();
                if title.is_empty() {
                    continue;
                }
                // 提取正文摘要（优先 content:encoded，回退 description），清洗后用于展示与语音播报
                let raw_content = it
                    .content()
                    .filter(|c| !c.trim().is_empty())
                    .or_else(|| it.description())
                    .unwrap_or("");
                let summary = extract_summary(raw_content);
                // 原文链接：优先 item 级 <link>，缺失时回退正文尾注链接
                let link = it
                    .link()
                    .filter(|l| !l.trim().is_empty())
                    .map(|l| l.to_string())
                    .unwrap_or_else(|| extract_tail_link(raw_content));
                let time = it
                    .pub_date()
                    .map(|d| {
                        chrono::DateTime::parse_from_rfc2822(d)
                            .map(|dt| {
                                let secs = (chrono::Utc::now() - dt.with_timezone(&chrono::Utc))
                                    .num_seconds()
                                    .max(0) as u64;
                                rel_time(secs)
                            })
                            .unwrap_or_else(|_| "最近".into())
                    })
                    .unwrap_or_else(|| "最近".into());
                items.push(NewsItem { title, time, summary, link });
            }
        }
    }
    items.truncate(20);
    // 写入缓存（仅非空结果，避免缓存空列表）
    if !items.is_empty() {
        if let Ok(mut c) = NEWS_CACHE.lock() {
            *c = Some((std::time::Instant::now(), items.clone()));
        }
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_tail_note_chinese() {
        let raw = "这是一段正文，讲述了旅途中的见闻。查看全文";
        assert_eq!(extract_summary(raw), "这是一段正文，讲述了旅途中的见闻。");
    }

    #[test]
    fn strips_tail_note_with_punct_and_symbol() {
        let raw = "正文内容。查看全文 »";
        assert_eq!(extract_summary(raw), "正文内容。");
    }

    #[test]
    fn does_not_strip_mid_text() {
        let raw = "文中提到了阅读更多相关内容，但这是正文的一部分。";
        assert_eq!(
            extract_summary(raw),
            "文中提到了阅读更多相关内容，但这是正文的一部分。"
        );
    }

    #[test]
    fn extracts_tail_link_from_html() {
        let raw = r#"正文。<a href="https://sspai.com/post/123" target="_blank">查看全文</a>"#;
        assert_eq!(extract_tail_link(raw), "https://sspai.com/post/123");
    }

    #[test]
    fn extracts_tail_link_from_entity_quotes() {
        let raw = r#"正文。<a href=&#34;https://example.com/a&#34; target=&#34;_blank&#34;>查看全文</a>"#;
        assert_eq!(extract_tail_link(raw), "https://example.com/a");
    }

    #[test]
    fn tail_link_returns_empty_when_absent() {
        assert_eq!(extract_tail_link("纯文本，没有链接。"), "");
    }
}
