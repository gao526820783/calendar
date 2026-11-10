// 用 CDP Page.captureScreenshot 截图（能抓到 fixed 覆盖层，PrintWindow 抓不到）
// 用法: node scripts/cdp-shot.mjs <输出路径> [port]
import { writeFileSync } from 'node:fs';

const out = process.argv[2] || 'D:/weather/preview/cdp-shot.png';
const PORT = Number(process.argv[3] || process.env.CDP_PORT || 9230);

const res = await fetch(`http://127.0.0.1:${PORT}/json`);
const list = await res.json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('NO_PAGE'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));

let id = 0;
const send = (method, params = {}) => new Promise((resolve) => {
  const mid = ++id;
  const onMsg = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id === mid) { ws.removeEventListener('message', onMsg); resolve(m.result); }
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id: mid, method, params }));
});

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
if (!shot?.data) { console.error('NO_DATA'); process.exit(1); }
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('saved', out);
process.exit(0);
