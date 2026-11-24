import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './style.css';

const app = createApp(App);
app.use(createPinia());
app.mount('#app');

// 小组件窗口内右键不弹 WebView2 原生菜单（刷新 / 检查元素等）；
// 托盘右键走 Rust 原生 popup_menu，与此事件无关，不受影响。
document.addEventListener('contextmenu', (e) => e.preventDefault());

// 防白屏握手：首帧渲染完成后移除启动占位，并通知 Rust 显示窗口。
const boot = document.getElementById('boot');
if (boot) boot.remove();

import { emit } from '@tauri-apps/api/event';
emit('app-ready').catch(() => {
  // 非桌面环境（如纯浏览器 dev 预览）忽略
});
