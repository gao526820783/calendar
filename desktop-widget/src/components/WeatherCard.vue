<script setup lang="ts">
import { computed, h, defineComponent, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
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
// 搜索框默认收起，仅在点击城市右侧的搜索图标时以浮层展开
const searchVisible = ref<boolean>(false);
const searchInput = ref<HTMLInputElement | null>(null);

function toggleSearch() {
  searchVisible.value = !searchVisible.value;
  if (searchVisible.value) {
    nextTick(() => searchInput.value?.focus());
  } else {
    keyword.value = '';
    searchOpen.value = false;
  }
}

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
  searchVisible.value = false;
  await applyCity(name);
}

function onSearchInput() {
  searchOpen.value = keyword.value.trim().length > 0;
}

function closeSearch() {
  searchOpen.value = false;
  searchVisible.value = false;
  keyword.value = '';
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
      <!-- 城市搜索默认收起，点击放大镜才展开浮层（不挤压下方内容） -->
      <div class="city-search" ref="searchWrap">
        <button
          class="search-toggle"
          :class="{ on: searchVisible }"
          title="搜索城市（支持中文名或拼音首字母）"
          @click="toggleSearch"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2" />
            <line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
        <div v-if="searchVisible" class="search-pop">
          <input
            ref="searchInput"
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
          <div v-else class="search-hint">输入城市名或拼音首字母</div>
        </div>
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
/* 当前天气 + 指标并排成一条信息带：左温度、右指标，靠细线分组而不是卡片堆叠 */
.weather-panel {
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  align-items: center;
}
.city-row, .fc-bar, .w-strip { grid-column: 1 / -1; }

/* 搜索默认收起：城市下拉右侧只留放大镜，点击后浮层覆盖内容而不挤压布局 */
.city-row { position: relative; margin-bottom: 10px; }
.city-search { position: relative; flex: 0 0 32px; margin-bottom: 0; }
.search-toggle {
  width: 32px; height: 31px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-control);
  border: 1px solid var(--hairline);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.search-toggle:hover { background: var(--control-bg-hover); border-color: var(--accent); color: var(--accent); }
.search-toggle.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.search-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  width: 244px;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid var(--glass-border);
  /* 用不透明主题底色，避免浮层透出后面的指标文字影响阅读 */
  background: var(--bg1);
  box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-inner-hi);
}
.search-input { width: 100%; }
.search-panel {
  position: static;
  margin-top: 5px;
  max-height: 176px;
  border: none;
  background: transparent;
  box-shadow: none;
  padding: 0;
  /* 长列表必须能看出还能滚，否则用户以为只有眼前几条 */
  scrollbar-width: thin;
  scrollbar-color: rgba(120, 130, 145, 0.55) transparent;
}
.search-panel::-webkit-scrollbar { width: 6px; }
.search-panel::-webkit-scrollbar-track { background: transparent; }
.search-panel::-webkit-scrollbar-thumb { background: rgba(120, 130, 145, 0.55); border-radius: 6px; }
.search-panel::-webkit-scrollbar-thumb:hover { background: rgba(120, 130, 145, 0.75); }
:deep(.widget[data-weather="night"]) .search-panel::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.3); }
.search-hint { font-size: 10px; color: var(--text-secondary); padding: 4px 2px 0; }

/* ===== 当前天气（左半列） ===== */
.w-main {
  grid-column: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  align-content: center;
  column-gap: 7px;
  row-gap: 2px;
  padding-left: 2px;
  min-width: 0;
}
.w-icon {
  font-size: 28px;
  line-height: 1;
  filter: drop-shadow(0 4px 10px rgba(15, 23, 42, 0.18));
}
.w-temp {
  flex: 1;
  font-size: 30px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.05;
  letter-spacing: -1px;
  font-variant-numeric: tabular-nums;
}
.w-temp small { font-size: 13px; font-weight: 400; color: var(--text-secondary); margin-left: 2px; letter-spacing: 0; }
.w-desc {
  flex: 0 0 100%;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 5px;
}
.stale { opacity: 0.65; font-size: 9px; }
.w-updated {
  font-size: 10px;
  color: var(--text-secondary);
  padding: 0 4px;
  border-radius: 999px;
  background: var(--glass-tint-weak);
  border: 1px solid var(--glass-border-weak);
}

/* ===== 四格指标（右半列 2×2 文本行，顺序仍为 湿度 → 风向 → 风力 → 体感） ===== */
.w-grid {
  grid-column: 2;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 14px;
  row-gap: 2px;
  align-self: stretch;
  align-content: center;
  padding-left: 14px;
  border-left: 1px solid var(--hairline);
}
.w-cell {
  display: flex;
  flex-direction: row-reverse;
  align-items: baseline;
  justify-content: space-between;
  gap: 5px;
  min-width: 0;
  padding: 5px 0 6px;
  border-bottom: 1px solid var(--hairline);
}
.w-cell .v {
  font-size: 13px; font-weight: 600; color: var(--text-primary);
  white-space: nowrap; font-variant-numeric: tabular-nums;
}
.w-cell .k { font-size: 10px; color: var(--text-secondary); white-space: nowrap; }

/* ===== 预报区标题行 ===== */
.fc-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 12px 0 6px;
  padding-top: 10px;
  border-top: 1px solid var(--hairline);
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
  padding-bottom: 6px;
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
  min-width: 56px;
  text-align: center;
  background: transparent;
  border-right: 1px solid var(--hairline);
  border-radius: 0;
  padding: 6px 8px;
  flex-shrink: 0;
  transition: background 0.18s ease;
}
.w-hr:hover { background: var(--glass-tint-weak); border-radius: 8px; }
.w-hr .t { font-size: 11px; color: var(--text-secondary); white-space: nowrap; }
.w-hr .i { font-size: 19px; margin: 3px 0; }
.w-hr .d {
  font-size: 12px; font-weight: 600; color: var(--text-primary);
  white-space: nowrap; font-variant-numeric: tabular-nums;
}
.w-hr .d .hi { color: var(--text-primary); }
.w-hr .d .lo { color: var(--text-muted); font-weight: 400; margin-left: 4px; }
/* 双温度（未来 7 天）需要更宽一点 */
.w-hr.wide { min-width: 62px; }
.w-hr:last-of-type { border-right: none; }
.w-hr .p {
  font-size: 10px;
  color: var(--accent);
  margin-top: 2px;
  white-space: nowrap;
}
</style>
