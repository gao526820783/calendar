#!/usr/bin/env node
// 通过 CDP 驱动 WebView2 页面，验证拖动与视图切换。
// Node 22 内置 WebSocket，无需额外依赖。

const PORT = process.env.CDP_PORT || 9222;

async function findPage() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  const list = await res.json();
  const page = list.find((t) => t.type === 'page' && t.url.includes('1420'));
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

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
}

// ---------- 1. 基础状态（先重置到逐时视图，保证断言起点一致）----------
await evalJs(ws, `(() => {
  const b = [...document.querySelectorAll('.seg-btn')].find(x => x.textContent.includes('逐时'));
  if (b) b.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 400));

const base = await evalJs(ws, `(() => {
  const strip = document.querySelector('.w-strip');
  const panel = document.querySelector('.panel.active');
  return {
    hasStrip: !!strip,
    stripScrollWidth: strip?.scrollWidth ?? 0,
    stripClientWidth: strip?.clientWidth ?? 0,
    cardCount: strip?.children.length ?? 0,
    scrollbarHidden: strip ? getComputedStyle(strip).scrollbarWidth : null,
    activeTab: document.querySelector('.tab.active')?.textContent?.trim(),
    forecastLabels: [...(strip?.querySelectorAll('.w-hr .t') ?? [])].slice(0, 5).map(e => e.textContent.trim()),
  };
})()`);
log('预报条存在且有溢出', base.hasStrip && base.stripScrollWidth > base.stripClientWidth, base);
log('卡片数量(逐时=24)', base.cardCount === 24, { cardCount: base.cardCount });
log('滚动条已隐藏', base.scrollbarHidden === 'none', { scrollbarWidth: base.scrollbarHidden });

// ---------- 2. 视图切换 ----------
await evalJs(ws, `(() => {
  const btns = [...document.querySelectorAll('.seg-btn')];
  const daily = btns.find(b => b.textContent.includes('未来7天'));
  daily.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 400));

const dailyState = await evalJs(ws, `(() => {
  const strip = document.querySelector('.w-strip');
  const labels = [...strip.querySelectorAll('.w-hr .t')].map(e => e.textContent.trim());
  const cards = [...strip.querySelectorAll('.w-hr')];
  return {
    count: cards.length,
    labels,
    firstCardText: cards[0]?.innerText.replace(/\\n/g, ' | '),
    hiLo: cards.slice(0,3).map(c => [...c.querySelectorAll('.d span')].map(s => s.textContent.trim())),
  };
})()`);
log('未来7天视图有7张卡', dailyState.count === 7, { count: dailyState.count });
log('7天视图首日显示「今天」', dailyState.labels[0] === '今天', { labels: dailyState.labels });
log('7天卡片含最高/最低温', dailyState.hiLo.every(p => p.length === 2), { hiLo: dailyState.hiLo });

// ---------- 3. 鼠标拖动（真实 pointer 事件）----------
const dragResult = await evalJs(ws, `(async () => {
  const strip = document.querySelector('.w-strip');
  strip.scrollLeft = 0;               // 复位，保证每次从起点开始拖
  await new Promise(r2 => requestAnimationFrame(r2));
  const before = strip.scrollLeft;
  const r = strip.getBoundingClientRect();
  const y = r.top + r.height / 2;
  const startX = r.right - 20;
  const endX = r.left + 20;

  const fire = (type, x) => strip.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
    clientX: x, clientY: y,
  }));

  fire('pointerdown', startX);
  for (let i = 1; i <= 12; i++) {
    fire('pointermove', startX + (endX - startX) * i / 12);
    await new Promise(r2 => requestAnimationFrame(r2));
  }
  fire('pointerup', endX);
  await new Promise(r2 => setTimeout(r2, 250));
  const after = strip.scrollLeft;
  // 视觉位置：滚动后第一张卡是否已移出容器可视区左侧
  const cards = [...strip.querySelectorAll('.w-hr')];
  const stripRect = strip.getBoundingClientRect();
  const firstRect = cards[0].getBoundingClientRect();
  return {
    before, after, moved: after - before,
    firstCardLeft: Math.round(firstRect.left - stripRect.left),
    lastCardRight: Math.round(cards[cards.length-1].getBoundingClientRect().right - stripRect.right),
  };
})()`);
log('拖动使 scrollLeft 增大', dragResult.moved > 50, dragResult);
log(
  '拖动后首卡移出可视区（视觉位置验证）',
  dragResult.firstCardLeft < 0,
  { firstCardLeft: dragResult.firstCardLeft },
);

// ---------- 4. 反向拖动 ----------
const dragBack = await evalJs(ws, `(async () => {
  const strip = document.querySelector('.w-strip');
  const before = strip.scrollLeft;
  const r = strip.getBoundingClientRect();
  const y = r.top + r.height / 2;
  const startX = r.left + 20, endX = r.right - 20;
  const fire = (type, x) => strip.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
    clientX: x, clientY: y,
  }));
  fire('pointerdown', startX);
  for (let i = 1; i <= 12; i++) {
    fire('pointermove', startX + (endX - startX) * i / 12);
    await new Promise(r2 => requestAnimationFrame(r2));
  }
  fire('pointerup', endX);
  await new Promise(r2 => setTimeout(r2, 250));
  const stripRect = strip.getBoundingClientRect();
  const firstRect = strip.querySelector('.w-hr').getBoundingClientRect();
  return {
    before, after: strip.scrollLeft,
    firstCardLeft: Math.round(firstRect.left - stripRect.left),
    firstLabel: strip.querySelector('.w-hr .t')?.textContent.trim(),
  };
})()`);
log(
  '反向拖动可回到开头',
  dragBack.after < dragBack.before - 50 && dragBack.firstCardLeft >= -1,
  dragBack,
);

// ---------- 5. 切回逐时 ----------
await evalJs(ws, `(() => {
  const btns = [...document.querySelectorAll('.seg-btn')];
  btns.find(b => b.textContent.includes('逐时')).click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 400));
const hourlyState = await evalJs(ws, `(() => {
  const strip = document.querySelector('.w-strip');
  return {
    count: strip.querySelectorAll('.w-hr').length,
    firstLabel: strip.querySelector('.w-hr .t')?.textContent.trim(),
    scrollLeft: strip.scrollLeft,
    overflowing: strip.scrollWidth > strip.clientWidth,
  };
})()`);
log('切回逐时有24张卡', hourlyState.count === 24, hourlyState);
log('逐时列表可横向溢出', hourlyState.overflowing, { sw: hourlyState.overflowing });

// ---------- 6. 拖动不触发 select 展开 ----------
const selectSafe = await evalJs(ws, `(() => {
  const sel = document.querySelector('select.sel');
  return { hasSelect: !!sel, open: sel ? sel.matches(':focus') : null };
})()`);
log('拖动未使下拉框获得焦点', !selectSafe.open, selectSafe);

// ---------- 7. 面板纵向滚动未被破坏 ----------
const scrollCheck = await evalJs(ws, `(() => {
  const panel = document.querySelector('.panel.active');
  const cs = getComputedStyle(panel);
  return { overflowY: cs.overflowY, overflowX: cs.overflowX };
})()`);
log('面板仍可纵向滚动', scrollCheck.overflowY === 'auto' || scrollCheck.overflowY === 'scroll', scrollCheck);

console.log('\n===== 汇总 =====');
const failed = results.filter(r => !r.ok);
console.log(`通过 ${results.length - failed.length}/${results.length}`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach(f => console.log('  - ' + f.name + ' ' + JSON.stringify(f.detail)));
}
ws.close();
process.exit(failed.length ? 1 : 0);
