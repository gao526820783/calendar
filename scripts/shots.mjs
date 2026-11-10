#!/usr/bin/env node
// 通过 CDP 切换视图并截图，产出最终预览图。
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const OUT_DIR = process.env.OUT_DIR || 'D:/weather/preview';

const res = await fetch(`http://127.0.0.1:${PORT}/json`);
const list = await res.json();
const page = list.find((t) => t.type === 'page' && t.url.includes('1420'));
if (!page) throw new Error('page not found');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));

let id = 0;
function send(method, params = {}) {
  const mid = ++id;
  return new Promise((resolve, reject) => {
    const h = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === mid) {
        ws.removeEventListener('message', h);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${OUT_DIR}/${name}`, Buffer.from(r.data, 'base64'));
  console.log('saved', `${OUT_DIR}/${name}`);
}

await send('Runtime.enable');
await send('Page.enable');

async function setView(label) {
  await ev(`[...document.querySelectorAll('.seg-btn')].find(b => b.textContent.includes('${label}')).click()`);
  await new Promise((r) => setTimeout(r, 500));
}

await setView('逐时');
await shot('forecast-hourly.png');

await setView('未来7天');
// 复位到列表起点，保证默认视图截图
await ev(`(async () => {
  const strip = document.querySelector('.w-strip');
  strip.scrollLeft = 0;
  await new Promise(r => setTimeout(r, 300));
})()`);
await shot('forecast-daily.png');

// 拖到 7 天列表末尾，验证尾部卡片
await ev(`(async () => {
  const strip = document.querySelector('.w-strip');
  strip.scrollLeft = strip.scrollWidth;
  await new Promise(r => setTimeout(r, 300));
})()`);
await shot('forecast-daily-end.png');

// 逐时列表末尾
await setView('逐时');
await ev(`(async () => {
  const strip = document.querySelector('.w-strip');
  strip.scrollLeft = strip.scrollWidth;
  await new Promise(r => setTimeout(r, 300));
})()`);
await shot('forecast-hourly-end.png');

ws.close();
