#!/usr/bin/env node
/**
 * 生成全国省市单一数据源：desktop-widget/src/data/cities.json
 *
 * 目的：省市表此前是「前端 settings.ts 的 PROVINCES」+「后端 weather.rs 的 builtin_coords」
 *   两份手工维护的副本，缺一个省/市就要改两处，极易不同步。
 *   本脚本把两者合并为一份 JSON，前后端都从它派生，从此不存在副本漂移。
 *
 * 输入：
 *   scripts/data/regions-upstream.json  上游行政区划快照（name / center / children）
 *   scripts/data/regions-extra.json    补充数据（上游缺失的台湾下级行政区）
 *
 * 输出：
 *   desktop-widget/src/data/cities.json
 *
 * 重新生成：node scripts/gen-city-data.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCitiesJson, validateCities } from './lib/city-data.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const { errors, provinces, content } = validateCities(ROOT);
if (errors.length) {
  console.error('\x1b[31m生成失败：\x1b[0m');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const dest = join(ROOT, 'desktop-widget/src/data/cities.json');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, content, 'utf8');

const total = provinces.reduce((a, p) => a + p.cities.length, 0);
console.log(`\x1b[32m✔\x1b[0m 已生成 ${dest}`);
console.log(`  省级单位 ${provinces.length} 个，城市 ${total} 个`);

/* ------------------------------------------------------------------ */
/* 拼音首字母字典：只保留城市名实际用到的字（约 400 个），避免引入      */
/* 完整拼音库带来的数百 KB 体积                                         */
/* ------------------------------------------------------------------ */
try {
  // pinyin-pro 装在 desktop-widget 下（devDependency），从子目录解析
  const { pinyin } = await import(
    new URL('../desktop-widget/node_modules/pinyin-pro/dist/index.mjs', import.meta.url).href
  );
  const chars = new Set();
  for (const p of provinces) {
    for (const ch of p.name) chars.add(ch);
    for (const c of p.cities) for (const ch of c.name) chars.add(ch);
  }
  const map = {};
  for (const ch of [...chars].sort()) {
    const r = pinyin(ch, { pattern: 'first', toneType: 'none', type: 'array' });
    map[ch] = (r[0] || ch).toLowerCase();
  }
  const pinyinDest = join(ROOT, 'desktop-widget/src/data/pinyin-initials.ts');
  const pinyinOut =
    '// 城市名用字 → 拼音首字母（由 scripts/gen-city-data.mjs 从 pinyin-pro 生成，仅含实际用字）\n' +
    `export const PINYIN_INITIALS: Record<string, string> = ${JSON.stringify(map)};\n`;
  writeFileSync(pinyinDest, pinyinOut, 'utf8');
  console.log(`\x1b[32m✔\x1b[0m 已生成 ${pinyinDest}（${chars.size} 个用字）`);
} catch {
  console.log('\x1b[33m!\x1b[0m 未找到 pinyin-pro，跳过拼音字典生成');
}
