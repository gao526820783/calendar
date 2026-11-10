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

onMounted(async () => {
  await settings.load();
  calendar.init();
  // 新闻列表
  await news.fetch();
  // 正式实现：由天气数据驱动皮肤；后端不可用时用演示数据预览
  await weather.fetch(settings.settings.city);
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
  <div class="widget" :data-weather="themeName" :data-festival="festivalStyle" :style="accentStyle">
    <!-- 天气微动效层（流云/雨丝/雪花/星空）—— 作为毛玻璃的被模糊底层 -->
    <div class="weather-anim" aria-hidden="true">
      <div class="weather-anim-cloud"></div>
      <div class="weather-anim-cloud"></div>
      <div class="weather-anim-cloud"></div>
      <div class="weather-anim-rain"></div>
      <div class="weather-anim-snow"></div>
      <div class="weather-anim-stars"></div>
    </div>

    <!-- 毛玻璃主面板 -->
    <div class="app">
      <!-- 节日装饰（右下角大图标） -->
      <div class="deco" aria-hidden="true">{{ decoEmoji }}</div>

      <!-- 顶栏（可拖拽区域） -->
      <div class="header" data-tauri-drag-region>
        <div class="header-left" data-tauri-drag-region>
          <span class="header-title" data-tauri-drag-region>天气 · 日历 · 新闻</span>
        </div>
        <div class="header-actions" data-tauri-drag-region>
          <span v-if="festivalName" class="festival-badge">{{ festivalName }}</span>
          <button class="gear" title="设置" @click="showSettings = true">⚙</button>
        </div>
      </div>

      <!-- Tab 栏 -->
      <div class="tabs">
        <button class="tab" :class="{ active: activeTab === 'weather' }" @click="switchTab('weather')">天气</button>
        <button class="tab" :class="{ active: activeTab === 'calendar' }" @click="switchTab('calendar')">日历</button>
        <button class="tab" :class="{ active: activeTab === 'news' }" @click="switchTab('news')">新闻</button>
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
