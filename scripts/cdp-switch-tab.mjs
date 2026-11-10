// 切换到指定 Tab（通过点击真实按钮，触发完整交互链路）
// 用法: node scripts/cdp-switch-tab.mjs <weather|calendar|news> [port]
const PORT = Number(process.argv[3] || process.env.CDP_PORT || 9230);
const TAB = process.argv[2] || 'weather';

const res = await fetch(`http://127.0.0.1:${PORT}/json`);
const list = await res.json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('NO_PAGE'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));

const evaluate = (expression) => new Promise((resolve) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id === id) { ws.removeEventListener('message', onMsg); resolve(m.result?.result?.value); }
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
});

// 点击 Tab 按钮（原生 click，Vue 监听能捕获）
const label = { weather: '天气', calendar: '日历', news: '新闻' }[TAB];
const clicked = await evaluate(`(() => {
  const btns = [...document.querySelectorAll('.tabs .tab')];
  const btn = btns.find(b => b.textContent.trim() === ${JSON.stringify(label)});
  if (!btn) return 'NO_BTN:' + btns.map(b => b.textContent.trim()).join(',');
  btn.click();
  return 'CLICKED';
})()`);
console.log('tab switch:', clicked);

// 等面板渲染
await new Promise((r) => setTimeout(r, 2500));

const state = await evaluate(`(() => {
  const p = document.querySelector('.panel');
  return JSON.stringify({
    hash: location.hash,
    activeTab: document.querySelector('.tabs .tab.active')?.textContent.trim(),
    panelScrollH: p?.scrollHeight, panelClientH: p?.clientHeight,
    needScroll: p ? p.scrollHeight > p.clientHeight + 1 : null,
  });
})()`);
console.log('state:', state);
process.exit(0);
