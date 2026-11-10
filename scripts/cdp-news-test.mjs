// 新闻面板实测：检查"查看更多"点击后能否真正看到全部条目
// 用法: node scripts/cdp-news-test.mjs [port]
const PORT = Number(process.argv[2] || process.env.CDP_PORT || 9230);

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

// 切到新闻 tab
await evaluate(`(() => {
  [...document.querySelectorAll('.tabs .tab')].find(b => b.textContent.trim() === '新闻')?.click();
  return 'OK';
})()`);
await new Promise((r) => setTimeout(r, 1500));

const before = await evaluate(`(() => {
  const p = document.querySelector('.panel.active');
  const items = document.querySelectorAll('.news-item');
  const more = document.querySelector('.news-more');
  return JSON.stringify({
    totalItems: items.length,
    moreText: more?.textContent.trim(),
    moreVisible: more ? getComputedStyle(more).display !== 'none' : false,
    panelScrollH: p?.scrollHeight, panelClientH: p?.clientHeight,
    canScroll: p ? p.scrollHeight > p.clientHeight + 1 : false,
  });
})()`);
console.log('展开前:', before);

// 点击"查看更多"
const click = await evaluate(`(() => {
  const more = document.querySelector('.news-more');
  if (!more) return 'NO_MORE_BTN';
  more.click();
  return 'CLICKED';
})()`);
console.log('点击:', click);
await new Promise((r) => setTimeout(r, 800));

const after = await evaluate(`(() => {
  const p = document.querySelector('.panel.active');
  const items = document.querySelectorAll('.news-item');
  const more = document.querySelector('.news-more');
  const last = items[items.length - 1];
  const lr = last?.getBoundingClientRect();
  const pr = p?.getBoundingClientRect();
  // 最后一条底部是否在 panel 可视区之外
  const lastBelowViewport = lr ? (lr.bottom > pr.bottom) : null;
  return JSON.stringify({
    shownItems: items.length,
    moreText: more?.textContent.trim(),
    panelScrollH: p?.scrollHeight, panelClientH: p?.clientHeight,
    canScroll: p ? p.scrollHeight > p.clientHeight + 1 : false,
    lastItemBottom: lr ? Math.round(lr.bottom) : null,
    panelBottom: pr ? Math.round(pr.bottom) : null,
    lastBelowViewport,
    scrollbarWidth: getComputedStyle(p).scrollbarWidth,
  });
})()`);
console.log('展开后:', after);
process.exit(0);
