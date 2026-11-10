// 全国省市数据（单一数据源）
//
// 原始数据：desktop-widget/src/data/cities.json
//   由 scripts/gen-city-data.mjs 生成，覆盖 34 个省级单位、391 个城市，
//   后端 weather.rs 通过 include_str! 读取同一份文件，两端不再各自维护副本。
//
// 如需新增/修正城市：改 scripts/data/ 下的源数据后重新运行
//   node scripts/gen-city-data.mjs
// 不要直接手改 cities.json（会被下次生成覆盖）。

import cityData from './cities.json';

export interface CityEntry {
  name: string;
  lat: number;
  lon: number;
}

export interface ProvinceEntry {
  name: string;
  cities: CityEntry[];
}

interface CitiesFile {
  provinces: ProvinceEntry[];
}

const file = cityData as CitiesFile;

/** 全部省级单位（顺序固定：直辖市 → 省 → 自治区 → 特别行政区） */
export const PROVINCE_LIST: ProvinceEntry[] = file.provinces;

/** 省市二级联动表：省 → 该省城市列表 */
export const PROVINCES: Record<string, string[]> = Object.fromEntries(
  file.provinces.map((p) => [p.name, p.cities.map((c) => c.name)]),
);

/** 扁平城市列表（由省份表推导） */
export const CITIES: string[] = file.provinces.flatMap((p) => p.cities.map((c) => c.name));

/** 城市坐标表：城市名 → 经纬度 */
export const CITY_COORDS: Record<string, { lat: number; lon: number }> = Object.fromEntries(
  file.provinces.flatMap((p) => p.cities.map((c) => [c.name, { lat: c.lat, lon: c.lon }])),
);

/* ------------------------------------------------------------------ */
/* 拼音首字母：支持「xsbn」命中「西双版纳」                              */
/* ------------------------------------------------------------------ */

import { PINYIN_INITIALS } from './pinyin-initials';

/** 取名称的拼音首字母（西双版纳 → xsbn） */
export function pinyinInitials(name: string): string {
  let out = '';
  for (const ch of name) out += PINYIN_INITIALS[ch] ?? ch;
  return out.toLowerCase();
}

/** 城市检索索引：名称 + 拼音首字母 */
export interface CitySearchItem {
  name: string;
  province: string;
  initials: string;
}

export const CITY_SEARCH_INDEX: CitySearchItem[] = file.provinces.flatMap((p) =>
  p.cities.map((c) => ({
    name: c.name,
    province: p.name,
    initials: pinyinInitials(c.name),
  })),
);

// 反查城市所属省份
export function provinceOf(city: string): string {
  for (const [p, list] of Object.entries(PROVINCES)) {
    if (list.includes(city)) return p;
  }
  return Object.keys(PROVINCES)[0];
}
