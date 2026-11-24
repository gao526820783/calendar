<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { useWeatherStore } from './stores/weather';
import { useCalendarStore } from './stores/calendar';
import { useNewsStore } from './stores/news';
import { useSettingsStore, COLOR_SCHEMES } from './stores/settings';
import { useThemeStore } from './stores/theme';
import WeatherCard from './components/WeatherCard.vue';
import CalendarCard from './components/CalendarCard.vue';
import NewsCard from './components/NewsCard.vue';
import SettingsPanel from './components/SettingsPanel.vue';

const weather = useWeatherStore();
const calendar = useCalendarStore();
const news = useNewsStore();
const settings = useSettingsStore();
const theme = useThemeStore();

const activeTab = ref<'weather' | 'calendar' | 'news'>('weather');
const showSettings = ref(false);

// 深链：#calendar / #news 直达对应面板，#settings 打开设置弹窗
// #theme=night|sunny|cloudy|rain|snow|thunder 可临时切换皮肤（调试 / 预览用）
const themeLocked = ref(false);

function themeFromHash(): string {
  const raw = location.hash.replace('#', '');
  const [name, arg] = raw.split('=');
  return name === 'theme' && arg ? arg : '';
}

function applyHash() {
  const name = location.hash.replace('#', '').split('=')[0];
  const t = themeFromHash();
  if (t) {
    themeLocked.value = true;
    theme.set(t as never);
    return;
  }
  if (name === 'calendar' || name === 'news' || name === 'weather') activeTab.value = name;
  if (name === 'settings') showSettings.value = true;
}
applyHash();
window.addEventListener('hashchange', applyHash);

const themeName = computed(() => theme.theme);
// 节日皮肤：命中的节日样式 key（关闭皮肤或无节日时为 null，回退天气主题）
const festivalStyle = computed(() => theme.activeFestivalStyle);
const festivalName = computed(() =>
  theme.festival && settings.settings.festivalSkinEnabled ? theme.festival.name : '',
);
// 节日装饰大图标（对应原型 .deco）
const decoEmoji = computed(() =>
  theme.festival && settings.settings.festivalSkinEnabled ? theme.festival.deco : '',
);

// 窗口配色（对应原型「窗口颜色」色板）：
// auto = 跟随天气主题；固定色则覆盖强调色；节日皮肤优先级最高（由 CSS 类提供，不被内联覆盖）
const accentStyle = computed(() => {
  if (festivalStyle.value) return {};               // 节日皮肤优先
  const key = settings.settings.colorScheme;
  if (!key || key === 'auto') return {};             // 跟随天气主题
  const scheme = COLOR_SCHEMES.find((c) => c.key === key);
  return scheme ? { '--accent': scheme.color } : {};
});

function switchTab(tab: 'weather' | 'calendar' | 'news') {
  activeTab.value = tab;
}

// 窗口拖拽：整个窗口按住空白处都能拖，不用 data-tauri-drag-region。
// Tauri 2 中该属性直接标在按钮上会吞掉 click（Tab 点了没反应），标在容器上又盖不住按钮。
// 改用官方「手动拖拽」：按下后位移超过阈值才 startDragging，纯点击放行 click。
// 排除：预报条（自己横向拖）、设置弹层（自己滚动/点击）、输入控件（原生选字/下拉）。
let dragOrigin: { x: number; y: number } | null = null;
let dragActive = false;
let swallowClick = false;
let startDragFn: (() => Promise<void>) | null = null;

function isDragBlocked(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest('.w-strip')) return true;                  // 预报条自己横向拖动
  if (el.closest('.set-mask')) return true;                 // 设置弹层：点击关闭 + 面板内滚动
  if (el.closest('input, textarea, select')) return true;   // 原生输入 / 下拉
  return false;
}

function onDragDown(e: PointerEvent) {
  swallowClick = false;
  if (e.button !== 0) return; // 仅左键
  if (isDragBlocked(e.target)) { dragOrigin = null; return; }
  dragOrigin = { x: e.clientX, y: e.clientY };
  dragActive = false;
}
async function onDragMove(e: PointerEvent) {
  if (!dragOrigin || dragActive) return;
  if (Math.hypot(e.clientX - dragOrigin.x, e.clientY - dragOrigin.y) < 4) return;
  dragActive = true;
  swallowClick = true; // 拖动后的 click 不应切换 Tab / 打开设置
  try {
    if (!startDragFn) {
      startDragFn = async () => {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().startDragging();
      };
    }
    await startDragFn();
  } catch {
    // 纯浏览器预览环境没有 Tauri API，忽略
  }
}
function onDragUp() {
  dragOrigin = null;
}
// 捕获阶段统一吞掉拖动后的那次 click，覆盖所有子元素（不只 Tab / 齿轮）。
function onClickCapture(e: MouseEvent) {
  if (!swallowClick) return;
  e.stopPropagation();
  e.preventDefault();
  swallowClick = false;
}
function clickAllowed(): boolean {
  if (!swallowClick) return true;
  swallowClick = false;
  return false;
}
function onTabClick(tab: 'weather' | 'calendar' | 'news') {
  if (!clickAllowed()) return;
  switchTab(tab);
}
function onGearClick() {
  if (!clickAllowed()) return;
  showSettings.value = true;
}

onMounted(async () => {
  await settings.load();
  calendar.init();
  // 天气、新闻互不依赖 → 并行请求，各自就绪各自渲染（日历为本地计算，已在上方瞬时完成）
  await Promise.allSettled([
    weather.fetch(settings.settings.city),
    news.fetch(),
  ]);
  // 正式实现：由天气数据驱动皮肤；后端不可用时用演示数据预览
  if (!weather.data) {
    weather.useDemo(settings.settings.city);
  }
  // 调试：手动指定皮肤时不被天气码覆盖
  if (themeLocked.value) {
    const t = themeFromHash();
    if (t) theme.set(t as never);
  }
  // 节日皮肤初始化（PRD 5.5）
  theme.refreshFestival(settings.settings.festivalSkinEnabled);

  // 监听托盘菜单转发的事件（PRD 9：刷新天气 / 设置）
  const { listen } = await import('@tauri-apps/api/event');
  unlistenFns.push(await listen('refresh-weather', () => { void weather.fetch(settings.settings.city); }));
  unlistenFns.push(await listen('open-settings', () => { showSettings.value = true; }));
  // 后端提醒联动（可选：通知前端展示）
  unlistenFns.push(await listen<string>('weather-reminder', () => { /* 通知已由系统托盘弹出 */ }));
  unlistenFns.push(await listen('refresh-news', () => { void news.fetch(); }));
});

const unlistenFns: Array<() => void> = [];
onBeforeUnmount(() => {
  unlistenFns.forEach((fn) => fn());
  window.removeEventListener('hashchange', applyHash);
});
</script>

<template>
  <div
    class="widget"
    :data-weather="themeName"
    :data-festival="festivalStyle"
    :style="accentStyle"
    @pointerdown="onDragDown"
    @pointermove="onDragMove"
    @pointerup="onDragUp"
    @pointercancel="onDragUp"
    @click.capture="onClickCapture"
  >
    <!-- 雨丝/雪花/星空 —— 叠在天空壁纸之上的动态纹理（放在 .app 之外，作为面板半透明填充下的背景） -->
    <div class="weather-anim" aria-hidden="true">
      <div class="weather-anim-rain"></div>
      <div class="weather-anim-snow"></div>
      <div class="weather-anim-stars"></div>
    </div>

    <!-- 毛玻璃主面板 -->
    <div class="app">
      <!-- 流云层：放在面板「内部」最底层，轮廓清晰；
           位于 header/tabs/panel 之下（内容 z-index≥1），低透明度不遮文字 -->
      <div class="weather-clouds" aria-hidden="true">
        <div class="weather-anim-cloud"></div>
        <div class="weather-anim-cloud"></div>
        <div class="weather-anim-cloud"></div>
      </div>

      <!-- 节日装饰（右下角大图标） -->
      <div class="deco" aria-hidden="true">{{ decoEmoji }}</div>

      <!-- 顶栏 = Tab + 设置入口。整窗拖拽监听在根 .widget 上，按钮 click 不受影响 -->
      <div class="header">
        <div class="tabs">
          <button class="tab" :class="{ active: activeTab === 'weather' }" @click="onTabClick('weather')">天气</button>
          <button class="tab" :class="{ active: activeTab === 'calendar' }" @click="onTabClick('calendar')">日历</button>
          <button class="tab" :class="{ active: activeTab === 'news' }" @click="onTabClick('news')">新闻</button>
        </div>
        <div class="header-actions">
          <span v-if="festivalName" class="festival-badge">{{ festivalName }}</span>
          <button class="gear" title="设置" @click="onGearClick">⚙</button>
        </div>
      </div>

      <!-- 面板容器 -->
      <div class="panel-wrap">
        <div class="panel" :class="{ active: activeTab === 'weather' }">
          <WeatherCard />
        </div>
        <div class="panel" :class="{ active: activeTab === 'calendar' }">
          <CalendarCard />
        </div>
        <div class="panel" :class="{ active: activeTab === 'news' }">
          <NewsCard />
        </div>
      </div>
    </div>

    <!-- 设置面板：覆盖在毛玻璃面板之上 -->
    <SettingsPanel v-if="showSettings" @close="showSettings = false" />
  </div>
</template>
