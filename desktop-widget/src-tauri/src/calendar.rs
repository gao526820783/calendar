// 农历/节气计算沿用前端 lunar-javascript（PRD 指定），后端此模块保留备用扩展点。
// 如需纯后端农历，可引入 lunar-rust。
#![allow(dead_code)]

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct LunarInfo {
    pub lunar: String,
    pub term: String,
    pub festival: String,
}

pub fn placeholder(_date: &str) -> LunarInfo {
    LunarInfo {
        lunar: String::new(),
        term: String::new(),
        festival: String::new(),
    }
}
