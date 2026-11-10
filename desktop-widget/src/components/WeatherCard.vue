<script setup lang="ts">
import { computed, h, defineComponent, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useWeatherStore, windDirText, windLevel } from '../stores/weather';
import { useSettingsStore, PROVINCES, provinceOf } from '../stores/settings';
import { CITY_SEARCH_INDEX } from '../data/cities';
import { describeWeather } from '../stores/theme';
import { useDragScroll } from '../composables/useDragScroll';

const weather = useWeatherStore();
const settings = useSettingsStore();

// 逐时图标：按 WMO 代码渲染
const WeatherIcon = defineComponent({
  props: { code: { type: Number, required: true } },
  setup(props) {
    return () => h('span', describeWeather(props.code).icon);
  },
});

// ===== 省市二级联动 =====
const province = ref<string>(provinceOf(settings.settings.city));

// 当前省份下的城市列表
const cities = computed<string[]>(() => PROVINCES[province.value] ?? []);

// 省份下拉选项
const provinceNames = computed<string[]>(() => Object.keys(PROVINCES));

// 省份变化 → 城市切到该省第一个可用城市
async function onProvinceChange() {
  const list = PROVINCES[province.value] ?? [];
  if (!list.includes(settings.settings.city)) {
    await applyCity(list[0] ?? '');
  }
}

async function onCityChange(e: Event) {
  await applyCity((e.target as HTMLSelectElement).value);
}

async function applyCity(city: string) {
  if (!city) return;
  await settings.setCity(city);
  await weather.fetch(city);
}

// ===== 城市搜索（全国 391 城，支持中文名与拼音首字母） =====
// 原生 <select> 在 391 项里翻找成本高，这里提供模糊匹配：
// 输入「西双」「xsbn」「西双版纳」都能定位到目标城市。
const keyword = ref<string>('');
const searchOpen = ref<boolean>(false);

const matches = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return [];
  const hits = CITY_SEARCH_INDEX.filter(
    (c) => c.name.includes(q) || c.initials.startsWith(q) || c.province.includes(q),
  );
  return hits.slice(0, 40);
});

// 搜索命中后自动把省份切到该城市所在省（省下拉需同步）
async function chooseCity(name: string) {
  const p = provinceOf(name);
  if (p !== province.value) province.value = p;
  keyword.value = '';
  searchOpen.value = false;
  await applyCity(name);
}

function onSearchInput() {
  searchOpen.value = keyword.value.trim().length > 0;
}

function closeSearch() {
  searchOpen.value = false;
}

// 点击面板外部时收起搜索结果
const searchWrap = ref<HTMLElement | null>(null);
function onDocClick(e: MouseEvent) {
  if (searchWrap.value && !searchWrap.value.contains(e.target as Node)) closeSearch();
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

// 外部（托盘/设置）改了城市 → 同步省份下拉
watch(
  () => settings.settings.city,
  (c) => {
    const p = provinceOf(c);
    if (p !== province.value) province.value = p;
  },
);

// ===== 主信息 =====
const temp = computed(() =>
  weather.data ? Math.round(weather.data.current.temperature) : '--',
);

// 四格指标：湿度 / 风向 / 风力 / 体感
const cells = computed(() => {
  if (!weather.data) {
    return [
      { label: '湿度', value: '--' },
      { label: '风向', value: '--' },
      { label: '风力', value: '--' },
      { label: '体感', value: '--' },
    ];
  }
  const c = weather.data.current;
  return [
    { label: '湿度', value: `${Math.round(c.humidity)}%` },
    { label: '风向', value: windDirText(c.windDirection) },
    { label: '风力', value: `${windLevel(c.windSpeed)}级` },
    { label: '体感', value: weather.feelsLike !== null ? `${weather.feelsLike}°` : '--' },
  ];
});

// ===== 预报视图切换：逐时 / 多日 =====
type ViewMode = 'hourly' | 'daily';
const view = ref<ViewMode>('hourly');

function setView(v: ViewMode) {
  view.value = v;
}

// 逐时：未来 24 小时
const hourly = computed(() => weather.data?.hourly ?? []);

// 多日：未来 7 天（今天排在最前）
const daily = computed(() => weather.data?.daily ?? []);

function hourLabel(t: string): string {
  return t.slice(11, 16) || t.slice(0, 5);
}

// 逐日：显示「今天 / 明天 / 周三 / 11-12」
const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function dayLabel(date: string, idx: number): string {
  if (idx === 0) return '今天';
  if (idx === 1) return '明天';
  const d = new Date(date + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return date.slice(5);
  // 3 天内显示周几，再往后显示 M/D
  if (idx <= 3) return WEEK_CN[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 两种视图归一化成同一套卡片结构，切换时复用同一个横向滚动容器
interface ForecastCard {
  key: string;
  label: string;
  code: number;
  hi: number;
  lo: number | null;
  pop: number;
}

const forecast = computed<ForecastCard[]>(() => {
  if (view.value === 'hourly') {
    return hourly.value.map((h) => ({
      key: h.time,
      label: hourLabel(h.time),
      code: h.weatherCode,
      hi: Math.round(h.temperature),
      lo: null,
      pop: h.precipitationProbability,
    }));
  }
  return daily.value.map((d, i) => ({
    key: d.date,
    label: dayLabel(d.date, i),
    code: d.weatherCode,
    hi: Math.round(d.tempMax),
    lo: Math.round(d.tempMin),
    pop: d.precipitationProbability,
  }));
});

// 横向拖动容器
const stripRef = ref<HTMLElement | null>(null);
const { dragging } = useDragScroll(stripRef);
</script>

<template>
  <div class="weather-panel">
    <!-- 省市二级联动 -->
    <div class="city-row">
      <select class="sel" v-model="province" @change="onProvinceChange" title="选择省份">
        <option v-for="p in provinceNames" :key="p" :value="p">{{ p }}</option>
      </select>
      <select
        class="sel"
        :value="settings.settings.city"
        title="选择城市"
        @change="onCityChange"
      >
        <option v-for="c in cities" :key="c" :value="c">{{ c }}</option>
      </select>
    </div>

    <!-- 城市搜索：391 城逐项翻找成本高，支持中文名 / 拼音首字母 -->
    <div class="city-search" ref="searchWrap">
      <input
        class="search-input"
        type="search"
        v-model="keyword"
        placeholder="搜索城市：西双 / xsbn"
        title="搜索城市（支持中文名或拼音首字母）"
        @input="onSearchInput"
        @focus="onSearchInput"
        @keydown.escape="closeSearch"
      />
      <div v-if="searchOpen" class="search-panel">
        <div v-if="matches.length === 0" class="search-empty">未找到匹配的城市</div>
        <button
          v-for="m in matches"
          :key="m.province + m.name"
          class="search-item"
          @click="chooseCity(m.name)"
        >
          <span class="sn">{{ m.name }}</span>
          <span class="sp">{{ m.province }}</span>
        </button>
      </div>
    </div>

    <!-- 当前天气：居中大图标 + 大号温度 -->
    <div class="w-main">
      <div class="w-icon">{{ weather.currentIcon }}</div>
      <div class="w-temp"><span>{{ temp }}</span><small>°C</small></div>
      <div class="w-desc">
        {{ weather.currentDesc }}
        <span v-if="weather.error" class="stale">（缓存）</span>
        <span class="w-updated">{{ weather.data?.updatedAt }}</span>
      </div>
    </div>

    <!-- 四格指标 -->
    <div class="w-grid">
      <div v-for="c in cells" :key="c.label" class="w-cell">
        <div class="v">{{ c.value }}</div>
        <div class="k">{{ c.label }}</div>
      </div>
    </div>

    <!-- 预报区：视图切换 + 横向拖动列表 -->
    <div class="fc-bar">
      <div class="seg">
        <button class="seg-btn" :class="{ on: view === 'hourly' }" @click="setView('hourly')">逐时</button>
        <button class="seg-btn" :class="{ on: view === 'daily' }" @click="setView('daily')">未来7天</button>
      </div>
      <span class="drag-tip">按住拖动</span>
    </div>

    <!-- 横向可拖动预报条（逐时 24 小时 / 未来 7 天 复用同一容器） -->
    <div
      ref="stripRef"
      class="w-strip"
      :class="{ dragging }"
    >
      <div v-for="f in forecast" :key="f.key" class="w-hr" :class="{ wide: f.lo !== null }">
        <div class="t">{{ f.label }}</div>
        <div class="i"><WeatherIcon :code="f.code" /></div>
        <div class="d">
          <span class="hi">{{ f.hi }}°</span>
          <span v-if="f.lo !== null" class="lo">{{ f.lo }}°</span>
        </div>
        <div v-if="f.pop > 0" class="p">{{ f.pop }}%</div>
      </div>
      <div v-if="forecast.length === 0" class="list-empty">
        {{ view === 'hourly' ? '暂无逐时数据' : '暂无多日数据' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.weather-panel {
  display: flex;
  flex-direction: column;
}

/* ===== 当前天气：居中大图标 + 大号温度 ===== */
.w-main { text-align: center; padding: 0 0 4px; }
.w-icon {
  font-size: 38px;
  line-height: 1;
  filter: drop-shadow(0 6px 14px rgba(15, 23, 42, 0.18));
}
.w-temp {
  font-size: 32px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.1;
  margin-top: 2px;
  letter-spacing: -1px;
}
.w-temp small { font-size: 16px; font-weight: 400; color: var(--text-secondary); margin-left: 3px; }
.w-desc {
  color: var(--text-secondary);
  font-size: 13px;
  margin-top: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.stale { opacity: 0.65; font-size: 11px; }
.w-updated {
  font-size: 11px;
  color: var(--text-muted);
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--glass-tint-weak);
  border: 1px solid var(--glass-border-weak);
}

/* ===== 四格指标 ===== */
.w-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.w-cell {
  background: var(--glass-tint-strong);
  border: 1px solid var(--glass-border-weak);
  border-radius: var(--radius-cell);
  padding: 6px 4px;
  text-align: center;
  -webkit-backdrop-filter: blur(var(--glass-blur-sm));
  backdrop-filter: blur(var(--glass-blur-sm));
  box-shadow: var(--glass-shadow-sm);
}
.w-cell .v { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.w-cell .k { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }

/* ===== 预报区标题行 ===== */
.fc-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 6px 0 5px;
}
.seg {
  display: inline-flex;
  padding: 2px;
  border-radius: 999px;
  background: var(--glass-tint-weak);
  border: 1px solid var(--glass-border-weak);
}
.seg-btn {
  padding: 3px 10px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.18s, color 0.18s;
}
.seg-btn.on {
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
}
.drag-tip {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.75;
  letter-spacing: 0.2px;
}

/* ===== 横向可拖动预报条 ===== */
.w-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 4px;
  scrollbar-width: none;
  -ms-overflow-style: none;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  scroll-behavior: auto;
}
.w-strip::-webkit-scrollbar { display: none; }
.w-strip.dragging { cursor: grabbing; }

.w-hr {
  min-width: 54px;
  text-align: center;
  background: var(--glass-tint-strong);
  border: 1px solid var(--glass-border-weak);
  border-radius: var(--radius-cell);
  padding: 4px 4px;
  flex-shrink: 0;
  -webkit-backdrop-filter: blur(var(--glass-blur-sm));
  backdrop-filter: blur(var(--glass-blur-sm));
}
.w-hr .t { font-size: 11px; color: var(--text-secondary); white-space: nowrap; }
.w-hr .i { font-size: 17px; margin: 3px 0; }
.w-hr .d { font-size: 12px; font-weight: 600; color: var(--text-primary); white-space: nowrap; }
.w-hr .d .hi { color: var(--text-primary); }
.w-hr .d .lo { color: var(--text-muted); font-weight: 400; margin-left: 4px; }
/* 双温度（未来 7 天）需要更宽一点 */
.w-hr.wide { min-width: 62px; }
.w-hr .p {
  font-size: 9px;
  color: #5b9bd5;
  margin-top: 2px;
  white-space: nowrap;
}
</style>
