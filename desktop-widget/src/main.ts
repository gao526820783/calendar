import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './style.css';

const app = createApp(App);
app.use(createPinia());
app.mount('#app');

// 防白屏握手：首帧渲染完成后移除启动占位，并通知 Rust 显示窗口。
const boot = document.getElementById('boot');
if (boot) boot.remove();

import { emit } from '@tauri-apps/api/event';
emit('app-ready').catch(() => {
  // 非桌面环境（如纯浏览器 dev 预览）忽略
});
