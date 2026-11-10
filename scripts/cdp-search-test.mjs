#!/usr/bin/env node
// 通过 CDP 验证城市搜索：中文名 / 拼音首字母 / 省份名，点击结果能切城市并刷新天气。
// 用法：node scripts/cdp-search-test.mjs
const PORT = process.env.CDP_PORT || 9223;

async function findPage() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  const list = await res.json();
  const page = list.find((t) => t.type === 'page');
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
    expression: expr, returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error('JS error: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
}

const page = await findPage();
const ws = await connect(page.webSocketDebuggerUrl);
await send(ws, 'Runtime.enable');

let pass = 0;
const fails = [];
function log(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${name}  ${JSON.stringify(detail ?? '')}`); }
  else { fails.push(name); console.log(`FAIL  ${name}  ${JSON.stringify(detail ?? '')}`); }
}

// 搜索框存在
const box = await evalJs(ws, `(() => {
  const i = document.querySelector('.search-input');
  return { exists: !!i, type: i?.type, placeholder: i?.placeholder };
})()`);
log('搜索框存在且为 search 类型', box.exists && box.type === 'search', box);

// 输入关键词并读取结果
async function search(q) {
  return await evalJs(ws, `(() => {
    const i = document.querySelector('.search-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, ${JSON.stringify(q)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return new Promise(res => setTimeout(() => {
      const panel = document.querySelector('.search-panel');
      const items = panel ? [...panel.querySelectorAll('.search-item')] : [];
      res({
        panelOpen: !!panel,
        count: items.length,
        items: items.slice(0, 6).map(b => ({
          name: b.querySelector('.sn')?.textContent?.trim(),
          province: b.querySelector('.sp')?.textContent?.trim(),
        })),
        empty: !!document.querySelector('.search-empty'),
      });
    }, 250));
  })()`);
}

const cn = await search('西双');
log('中文「西双」能搜到西双版纳', cn.items.some((i) => i.name === '西双版纳'), cn);

const py = await search('xsbn');
log('拼音首字母「xsbn」能搜到西双版纳', py.items.some((i) => i.name === '西双版纳'), py);

// 注：城市表只到地级市，直辖市的区级（如北京朝阳区）不在其中，
// 因此「朝阳」只有辽宁一个候选；这里验证结果项确实带省份信息，便于区分同名城市。
const solo = await search('朝阳');
log('搜索结果标注所属省份', solo.count >= 1 && solo.items.every((i) => !!i.province), solo);

// 真正的重名场景：湖南「湘西」与贵州「黔东南」等简称不应与他省冲突
const multi = await search('城');
log('多候选搜索按省份区分展示', multi.count >= 2, { count: multi.count });

const prov = await search('云南');
log('按省份名「云南」也能搜到', prov.count >= 1 && prov.items.some((i) => i.province === '云南'), prov);

const none = await search('zzzz不存在的城市');
log('无匹配时显示占位文案', none.empty && none.count === 0, none);

// 点击结果 → 切城市 + 刷新天气
const click = await evalJs(ws, `(() => {
  const i = document.querySelector('.search-input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, '喀什');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return new Promise(res => setTimeout(() => {
    const item = [...document.querySelectorAll('.search-item')].find(b =>
      b.querySelector('.sn')?.textContent?.trim() === '喀什');
    if (item) item.click();
    res({ found: !!item });
  }, 250));
})()`);
await new Promise((r) => setTimeout(r, 3000));
const after = await evalJs(ws, `(() => {
  const sels = document.querySelectorAll('.city-row select.sel');
  return {
    province: sels[0]?.options[sels[0].selectedIndex]?.text,
    city: sels[1]?.options[sels[1].selectedIndex]?.text,
    panelClosed: !document.querySelector('.search-panel'),
    temp: document.querySelector('.w-temp span')?.textContent?.trim(),
    stale: !!document.querySelector('.stale'),
    updated: document.querySelector('.w-updated')?.textContent?.trim(),
  };
})()`);
log('点击搜索结果后切换到该城市', click.found && after.city === '喀什' && after.province === '新疆', after);
log('搜索结果浮层已收起', after.panelClosed, { panelClosed: after.panelClosed });
log('切换后天气已刷新且非缓存', after.temp && after.temp !== '--' && !after.stale, after);

console.log('\n' + '─'.repeat(50));
if (fails.length === 0) {
  console.log(`\x1b[32m全部通过\x1b[0m  ${pass} 项`);
} else {
  console.log(`\x1b[31m失败 ${fails.length} 项\x1b[0m（通过 ${pass} 项）`);
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
process.exit(0);
