/**
 * 城市表构建逻辑（生成脚本与基线校验共用）
 *
 * 抽成独立模块的原因：基线校验需要「用同一套规则重算一遍 cities.json」，
 * 才能发现有人手改生成物、或改了源数据却忘了重新生成。
 * 两边共用同一份实现，校验才有意义。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 省级：去掉「省 / 市 / 自治区 / 特别行政区」等后缀 */
const PROVINCE_ALIAS = {
  内蒙古自治区: '内蒙古',
  广西壮族自治区: '广西',
  西藏自治区: '西藏',
  宁夏回族自治区: '宁夏',
  新疆维吾尔自治区: '新疆',
  香港特别行政区: '香港',
  澳门特别行政区: '澳门',
  台湾省: '台湾',
};

export function provinceName(raw) {
  if (PROVINCE_ALIAS[raw]) return PROVINCE_ALIAS[raw];
  return raw.replace(/(省|市|特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区)$/u, '');
}

/** 市级简称：去掉「市 / 地区 / 盟 / 自治州 / 林区 / 县」等后缀 */
export function cityName(raw) {
  let n = raw;
  if (/自治州|自治县/u.test(n)) {
    const m = n.match(/^(.+?)(?:族|自治州)/u);
    if (m && m[1]) n = m[1];
  }
  n = n.replace(/(市辖区|地区|盟|自治州|自治县|林区|县|市)$/u, '');
  return n || raw;
}

/** 自动截断不够准确的简称，手工覆盖 */
export const CITY_ALIAS = {
  延边朝鲜族自治州: '延边',
  恩施土家族苗族自治州: '恩施',
  湘西土家族苗族自治州: '湘西',
  西双版纳傣族自治州: '西双版纳',
  德宏傣族景颇族自治州: '德宏',
  大理白族自治州: '大理',
  楚雄彝族自治州: '楚雄',
  红河哈尼族彝族自治州: '红河',
  文山壮族苗族自治州: '文山',
  怒江傈僳族自治州: '怒江',
  迪庆藏族自治州: '迪庆',
  黔东南苗族侗族自治州: '黔东南',
  黔南布依族苗族自治州: '黔南',
  黔西南布依族苗族自治州: '黔西南',
  阿坝藏族羌族自治州: '阿坝',
  甘孜藏族自治州: '甘孜',
  凉山彝族自治州: '凉山',
  临夏回族自治州: '临夏',
  甘南藏族自治州: '甘南',
  海北藏族自治州: '海北',
  黄南藏族自治州: '黄南',
  海南藏族自治州: '海南州',
  果洛藏族自治州: '果洛',
  玉树藏族自治州: '玉树',
  海西蒙古族藏族自治州: '海西',
  昌吉回族自治州: '昌吉',
  博尔塔拉蒙古自治州: '博尔塔拉',
  巴音郭楞蒙古自治州: '巴音郭楞',
  克孜勒苏柯尔克孜自治州: '克孜勒苏',
  伊犁哈萨克自治州: '伊犁',
  神农架林区: '神农架',
  大兴安岭地区: '大兴安岭',
  阿里地区: '阿里',
  白沙黎族自治县: '白沙',
  昌江黎族自治县: '昌江',
  乐东黎族自治县: '乐东',
  陵水黎族自治县: '陵水',
  保亭黎族苗族自治县: '保亭',
  琼中黎族苗族自治县: '琼中',
};

/** 直辖市 / 特别行政区：自身即一个「城市」 */
const SELF_CITY_PROVINCES = new Set(['北京', '天津', '上海', '重庆', '香港', '澳门']);

/** 省级下拉顺序（固定，避免每次生成顺序抖动） */
export const PROVINCE_ORDER = [
  '北京', '天津', '上海', '重庆',
  '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
  '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南',
  '广东', '广西', '海南',
  '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆',
  '台湾', '香港', '澳门',
];

/**
 * 由源数据构建 cities.json 的完整内容字符串。
 * @param {string} root 项目根目录
 * @returns {string} 与写入磁盘完全一致的内容
 */
export function buildCitiesJson(root) {
  const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
  const upstream = readJson('scripts/data/regions-upstream.json');
  const extra = readJson('scripts/data/regions-extra.json');

  const provinces = [];
  for (const node of Object.values(upstream)) {
    const pName = provinceName(node.name);
    const children = node.children || [];
    if (SELF_CITY_PROVINCES.has(pName)) {
      provinces.push({
        name: pName,
        cities: [{ name: pName, lat: node.center[1], lon: node.center[0] }],
      });
      continue;
    }
    provinces.push({
      name: pName,
      cities: children.map((c) => ({
        name: CITY_ALIAS[c.name] || cityName(c.name),
        lat: c.center[1],
        lon: c.center[0],
      })),
    });
  }

  // 补充：上游缺失的台湾下级行政区
  for (const [provRaw, list] of Object.entries(extra)) {
    const pName = provinceName(provRaw);
    const target = provinces.find((p) => p.name === pName);
    const cities = list.map((c) => ({ name: c.name, lat: c.center[1], lon: c.center[0] }));
    if (target) target.cities.push(...cities);
    else provinces.push({ name: pName, cities });
  }

  provinces.sort((a, b) => {
    const ia = PROVINCE_ORDER.indexOf(a.name);
    const ib = PROVINCE_ORDER.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const out = {
    source: '行政区划中心点数据（上游快照 scripts/data/regions-upstream.json）+ 补充 scripts/data/regions-extra.json',
    generatedBy: 'scripts/gen-city-data.mjs',
    provinces,
  };
  return JSON.stringify(out, null, 0) + '\n';
}

/**
 * 校验构建结果，抛错说明问题。
 * @param {string} root 项目根目录
 */
export function validateCities(root) {
  const content = buildCitiesJson(root);
  const { provinces } = JSON.parse(content);

  const errors = [];
  if (provinces.length !== 34) errors.push(`省级单位数量应为 34，实际 ${provinces.length}`);
  for (const p of provinces) {
    if (!p.cities.length) errors.push(`${p.name} 没有任何城市`);
  }
  const seen = new Map();
  for (const p of provinces) {
    for (const c of p.cities) {
      if (seen.has(c.name)) {
        errors.push(`城市名重复："${c.name}" 同时出现在 ${seen.get(c.name)} 与 ${p.name}`);
      } else {
        seen.set(c.name, p.name);
      }
      if (!(c.lat >= -90 && c.lat <= 90 && c.lon >= -180 && c.lon <= 180)) {
        errors.push(`${p.name}/${c.name} 坐标非法：${c.lat},${c.lon}`);
      }
    }
  }
  for (const p of provinces) {
    if (!PROVINCE_ORDER.includes(p.name)) errors.push(`未知省级单位：${p.name}`);
  }
  return { errors, provinces, content };
}
