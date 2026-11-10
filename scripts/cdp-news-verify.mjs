// 验证新闻展开后：列表区自身可滚、panel 不再整体滚、查看更多按钮始终可见
const PORT = Number(process.argv[2] || 9231);
const res = await fetch(`http://127.0.0.1:${PORT}/json`);
const page = (await res.json()).find((t) => t.type === 'page');
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

function snap(tag) {
  return ev(`(() => {
    const p = document.querySelector('.panel.active');
    const list = document.querySelector('.news-list');
    const more = document.querySelector('.news-more');
    const items = [...document.querySelectorAll('.news-item')];
    const last = items[items.length-1];
    const lr = last?.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    return JSON.stringify({
      tag: ${JSON.stringify(tag)},
      shown: items.length,
      moreVisible: more ? getComputedStyle(more).display !== 'none' : false,
      moreText: more?.textContent.trim(),
      panelCanScroll: p.scrollHeight > p.clientHeight + 1,
      listCanScroll: list.scrollHeight > list.clientHeight + 1,
      listClientH: list.clientHeight,
      listScrollH: list.scrollHeight,
      lastItemBottom: lr ? Math.round(lr.bottom) : null,
      panelBottom: Math.round(pr.bottom),
      lastBelowViewport: lr ? lr.bottom > pr.bottom : null,
      sbThumb: getComputedStyle(list).getPropertyValue('scrollbar-width') || 'webkit',
    });
  })()`);
}

console.log(await snap('折叠(默认)'));

// 点"查看更多"展开
await ev(`(() => { document.querySelector('.news-more')?.click(); return 'OK'; })()`);
await new Promise((r) => setTimeout(r, 600));
console.log(await snap('展开全部'));

// 确保处于展开态，再滚到底确认末条可见
const scrollTest = await ev(`(() => {
  const more = document.querySelector('.news-more');
  if (more && more.textContent.trim() === '查看更多 ▼') more.click();
  const list = document.querySelector('.news-list');
  list.scrollTop = list.scrollHeight;
  const items = [...document.querySelectorAll('.news-item')];
  const last = items[items.length-1];
  const lr = last.getBoundingClientRect();
  const listR = list.getBoundingClientRect();
  return JSON.stringify({
    total: items.length,
    lastItemBottom: Math.round(lr.bottom),
    listBottom: Math.round(listR.bottom),
    lastVisible: lr.bottom <= listR.bottom + 1,
    scrolledToEnd: list.scrollTop + list.clientHeight >= list.scrollHeight - 2,
  });
})()`);
console.log('展开并滚到底:', scrollTest);
process.exit(0);
