// 打开设置弹层（点击顶栏齿轮按钮）
// 用法: node scripts/cdp-open-settings.mjs [port]
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

// 回到天气 tab，再点齿轮
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('.tabs .tab')].find(b => b.textContent.trim() === '天气');
  btn?.click();
  return 'OK';
})()`);
await new Promise((r) => setTimeout(r, 1200));

const clicked = await evaluate(`(() => {
  const cands = [...document.querySelectorAll('button, .icon-btn, [class*="btn"]')];
  const gear = cands.find(b => /设置|⚙|⚡|config|setting/i.test(b.className + ' ' + b.title + ' ' + b.getAttribute('aria-label')));
  if (!gear) return 'NO_GEAR:' + cands.map(b => b.className).slice(0, 20).join(' | ');
  gear.click();
  return 'CLICKED:' + gear.className;
})()`);
console.log('settings:', clicked);
await new Promise((r) => setTimeout(r, 1500));

const state = await evaluate(`(() => {
  const mask = document.querySelector('.set-mask');
  const sheet = document.querySelector('.set-sheet');
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).opacity !== '0';
  return JSON.stringify({
    maskFound: !!mask, sheetFound: !!sheet,
    maskVisible: vis(mask), sheetVisible: vis(sheet),
    rows: document.querySelectorAll('.set-row').length,
    switches: document.querySelectorAll('.set-row .switch').length,
    title: sheet?.querySelector('.set-title')?.textContent?.trim(),
    firstRows: [...document.querySelectorAll('.set-row')].slice(0, 5)
      .map(r => r.querySelector('.lbl')?.innerText?.split('\\n')[0]),
  });
})()`);
console.log('state:', state);
process.exit(0);
