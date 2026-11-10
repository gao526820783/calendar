#!/usr/bin/env node
// 通过 CDP 验证省市二级联动。
// 用法：node scripts/cdp-city-test.mjs
//
// 分工：
//   数据完整性（34 省 / 391 城）由 Node 侧直接读 cities.json 校验；
//   CDP 侧只验证界面真实呈现：省级下拉项、各省城市下拉项数、切换城市后天气刷新。

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = process.env.CDP_PORT || 9222;

/* ---------- Node 侧：数据源完整性 ---------- */
const file = JSON.parse(readFileSync(join(ROOT, 'desktop-widget/src/data/cities.json'), 'utf8'));
const provinces = file.provinces;

let pass = 0;
const fails = [];
function log(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${name}  ${JSON.stringify(detail ?? '')}`); }
  else { fails.push(name); console.log(`FAIL  ${name}  ${JSON.stringify(detail ?? '')}`); }
}

const allCities = provinces.flatMap((p) => p.cities.map((c) => c.name));
log('省级单位 34 个', provinces.length === 34, { count: provinces.length });
log('城市 391 个', allCities.length === 391, { count: allCities.length });

const zeroCities = provinces.filter((p) => !p.cities.length).map((p) => p.name);
log('没有省份的城市列表为空', zeroCities.length === 0, { zeroCities });

const dupNames = allCities.filter((n, i) => allCities.indexOf(n) !== i);
log('城市名全局唯一', dupNames.length === 0, { dup: dupNames });

const expectedProv = ['北京','天津','上海','重庆','河北','山西','内蒙古','辽宁','吉林','黑龙江',
  '江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','广西','海南',
  '四川','贵州','云南','西藏','陕西','甘肃','青海','宁夏','新疆','台湾','香港','澳门'];
const missingProv = expectedProv.filter((p) => !provinces.some((x) => x.name === p));
log('34 个省级单位全部存在', missingProv.length === 0, { missing: missingProv });

const mustHave = ['石家庄','呼和浩特','乌鲁木齐','台北','香港','澳门','西双版纳','神农架','阿里','鄂尔多斯','喀什','儋州'];
const missingCity = mustHave.filter((c) => !allCities.includes(c));
log('关键城市均在列表内', missingCity.length === 0, { missing: missingCity });

/* ---------- CDP 侧：界面呈现 ---------- */
async function findPage() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  const list = await res.json();
  const page = list.find((t) => t.type === 'page' && (t.url.includes('1420') || t.url.includes('tauri')));
  if (!page) throw new Error('page not found');
  return page;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', reject);
  });
}

let id = 0;
function send(ws, method, params = {}) {
  const mid = ++id;
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === mid) {
        ws.removeEventListener('message', onMsg);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

async function evalJs(ws, expr) {
  const r = await send(ws, 'Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error('JS error: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
}

const page = await findPage();
const ws = await connect(page.webSocketDebuggerUrl);
await send(ws, 'Runtime.enable');

// 1) DOM 结构：仍是两个 select
const dom = await evalJs(ws, `(() => {
  const row = document.querySelector('.city-row');
  if (!row) return { ok: false };
  const sels = [...row.querySelectorAll('select.sel')];
  return {
    ok: sels.length === 2,
    count: sels.length,
    provinces: sels[0] ? sels[0].options.length : 0,
    cities: sels[1] ? sels[1].options.length : 0,
  };
})()`);
log('省市二级联动仍是两个 select.sel', dom.ok && dom.count === 2, dom);
log('省级下拉 34 项', dom.provinces === 34, { count: dom.provinces });

// 2) 省级下拉内容与数据源一致
const domProv = await evalJs(ws, `(() => {
  const s = document.querySelectorAll('.city-row select.sel')[0];
  return [...s.options].map(o => o.text);
})()`);
const sameOrder = domProv.length === provinces.length && domProv.every((n, i) => n === provinces[i].name);
log('省级下拉内容与数据源一致（含顺序）', sameOrder, { dom: domProv.slice(0, 5), src: provinces.slice(0, 5).map((p) => p.name) });

// 3) 抽查若干省的城市下拉项数
const samples = ['新疆', '广东', '台湾', '江苏', '海南', '北京'];
for (const p of samples) {
  const n = await evalJs(ws, `(() => {
    const sels = document.querySelectorAll('.city-row select.sel');
    const p = sels[0], c = sels[1];
    p.value = ${JSON.stringify(p)};
    p.dispatchEvent(new Event('change', { bubbles: true }));
    return new Promise(res => setTimeout(() => res(c.options.length), 250));
  })()`);
  const expect = provinces.find((x) => x.name === p).cities.length;
  log(`${p} 的城市下拉 ${expect} 项`, n === expect, { got: n, expect });
}

// 4) 选一个城市 → 天气数据应更新
const pick = await evalJs(ws, `(() => {
  const sels = document.querySelectorAll('.city-row select.sel');
  const p = sels[0], c = sels[1];
  p.value = '云南';
  p.dispatchEvent(new Event('change', { bubbles: true }));
  return new Promise(res => setTimeout(() => {
    const target = [...c.options].find(o => o.text === '西双版纳');
    if (target) { c.value = target.value; c.dispatchEvent(new Event('change', { bubbles: true })); }
    res({ found: !!target });
  }, 250));
})()`);
await new Promise((r) => setTimeout(r, 3000));
const after = await evalJs(ws, `(() => {
  const c = document.querySelectorAll('.city-row select.sel')[1];
  return {
    selected: c.options[c.selectedIndex]?.text,
    temp: document.querySelector('.w-temp span')?.textContent?.trim(),
    desc: document.querySelector('.w-desc')?.textContent?.trim().slice(0, 40),
    updated: document.querySelector('.w-updated')?.textContent?.trim(),
    stale: !!document.querySelector('.stale'),
  };
})()`);
log('可选中「西双版纳」（自治州简称）', pick.found && after.selected === '西双版纳', after);
log('切换城市后天气已刷新且非缓存', after.temp && after.temp !== '--' && !after.stale, after);

console.log('\n' + '─'.repeat(50));
if (fails.length === 0) {
  console.log(`\x1b[32m全部通过\x1b[0m  ${pass} 项`);
} else {
  console.log(`\x1b[31m失败 ${fails.length} 项\x1b[0m（通过 ${pass} 项）`);
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
process.exit(0);
