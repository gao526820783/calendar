// 验证新闻面板：展开条目后是否渲染出「查看全文 →」可点击链接（带原文 link）
const PORT = Number(process.argv[2] || 9222);
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

// 轮询等待新闻真正加载（真实 RSS 拉取需要时间）
let items = 0;
for (let i = 0; i < 40; i++) {
  items = await ev(`document.querySelectorAll('.news-item').length`);
  if (Number(items) > 0) break;
  await new Promise((r) => setTimeout(r, 500));
}

// 展开第一条，使其渲染 .n-full 与 .n-origin（若有 link）
await ev(`document.querySelector('.news-item')?.click()`);
await new Promise((r) => setTimeout(r, 400));

const out = await ev(`(() => {
  const it = document.querySelector('.news-item');
  return JSON.stringify({
    itemCount: document.querySelectorAll('.news-item').length,
    firstOpen: it ? it.classList.contains('open') : false,
    originCount: document.querySelectorAll('.n-origin').length,
    originText: [...document.querySelectorAll('.n-origin')].map(e => e.textContent.trim()),
  });
})()`);
console.log('RESULT:', out);
process.exit(0);
