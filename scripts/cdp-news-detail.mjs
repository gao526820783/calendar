// 精确测量新闻面板布局
const PORT = Number(process.argv[2] || 9230);
const res = await fetch(`http://127.0.0.1:${PORT}/json`);
const list = await res.json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
const ev = (e) => new Promise((res) => {
  const id = Math.floor(Math.random() * 1e6);
  const on = (m) => { const x = JSON.parse(m.data); if (x.id === id) { ws.removeEventListener('message', on); res(x.result?.result?.value); } };
  ws.addEventListener('message', on);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true } }));
});

await ev(`(() => { [...document.querySelectorAll('.tabs .tab')].find(b => b.textContent.trim()==='新闻')?.click(); return 'OK'; })()`);
await new Promise((r) => setTimeout(r, 1500));

const detail = await ev(`(() => {
  const p = document.querySelector('.panel.active');
  const items = [...document.querySelectorAll('.news-item')];
  const heights = items.map(el => Math.round(el.getBoundingClientRect().height));
  const pRect = p.getBoundingClientRect();
  const lastR = items[items.length-1]?.getBoundingClientRect();
  return JSON.stringify({
    panelClientH: p.clientHeight,
    panelScrollH: p.scrollHeight,
    panelScrollTop: p.scrollTop,
    panelTop: Math.round(pRect.top),
    panelBottom: Math.round(pRect.bottom),
    itemCount: items.length,
    itemHeights: heights,
    sumItemH: heights.reduce((a,b)=>a+b,0),
    lastItemBottom: lastR ? Math.round(lastR.bottom) : null,
    newsListOverflowY: getComputedStyle(document.querySelector('.news-list')).overflowY,
    listScrollH: document.querySelector('.news-list')?.scrollHeight,
    listClientH: document.querySelector('.news-list')?.clientHeight,
  });
})()`);
console.log(detail);
process.exit(0);
