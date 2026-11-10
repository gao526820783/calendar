<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { useSettingsStore, COLOR_SCHEMES, REMINDER_MAX, RSS_MAX } from '../stores/settings';
import { useThemeStore } from '../stores/theme';

const emit = defineEmits<{ (e: 'close'): void }>();
const settings = useSettingsStore();
const theme = useThemeStore();

const s = computed(() => settings.settings);

// ===== 实时时钟（对应原型 set-time） =====
const now = ref(new Date());
let clockTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  clockTimer = setInterval(() => { now.value = new Date(); }, 1000);
});
onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer);
});
const clockText = computed(() => {
  const d = now.value;
  const wk = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${wk}`;
});

// ===== 开机自启 =====
const autostartOn = ref(false);
const autostartSupported = ref(true);
onMounted(async () => {
  autostartOn.value = await settings.getAutostart();
  try {
    await import('@tauri-apps/plugin-autostart');
  } catch {
    autostartSupported.value = false; // 浏览器预览环境
  }
});
async function onAutostartToggle() {
  if (!autostartSupported.value) return;
  autostartOn.value = await settings.setAutostart(!autostartOn.value);
}

// ===== 便签提醒（时间提醒总开关） =====
const anyReminderOn = computed(() => s.value.timeReminders.some((r) => r.on));
function toggleAllReminders() {
  const next = !anyReminderOn.value;
  s.value.timeReminders.forEach((r) => { r.on = next; });
  settings.save();
}
// 明细列表默认折叠，保持弹窗密度与原型一致
const showRemList = ref(false);

// ===== 更多设置折叠 =====
const showMore = ref(false);

// ===== 预设时间提醒 =====
const remErr = ref('');
const newRemTime = ref('09:00');
async function addReminder() {
  remErr.value = '';
  const err = await settings.addReminder(newRemTime.value);
  if (err) { remErr.value = cleanErr(err); return; }
}
function cleanErr(e: string): string {
  return e.replace(/.*error:? */i, '').replace(/"/g, '');
}

// ===== RSS 订阅 =====
const rssInput = ref('');
const rssErr = ref('');
async function addRss() {
  rssErr.value = '';
  if (!rssInput.value.trim()) return;
  const err = await settings.addRss(rssInput.value.trim());
  if (err) { rssErr.value = cleanErr(err); return; }
  rssInput.value = '';
}

// ===== 节日皮肤开关 =====
function onFestivalToggle() {
  settings.toggle('festivalSkinEnabled');
  theme.refreshFestival(settings.settings.festivalSkinEnabled);
}

function close(e: Event) {
  if (e.target === e.currentTarget) emit('close');
}
</script>

<template>
  <div class="set-mask" @click="close">
    <div class="set-sheet">
      <h3 class="set-title">桌面设置</h3>

      <!-- 时间 -->
      <div class="set-row">
        <div class="lbl">时间<small>年月日星期显示</small></div>
        <span class="set-time">{{ clockText }}</span>
      </div>

      <!-- 日历显示农历 -->
      <div class="set-row">
        <div class="lbl">日历显示农历</div>
        <div class="switch" :class="{ on: s.showLunar }" @click="settings.toggle('showLunar')"></div>
      </div>

      <!-- 日期显示周/日 -->
      <div class="set-row">
        <div class="lbl">日期显示周/日</div>
        <div class="switch" :class="{ on: s.showWeekLabel }" @click="settings.toggle('showWeekLabel')"></div>
      </div>

      <!-- 开机自动启动 -->
      <div class="set-row" v-if="autostartSupported">
        <div class="lbl">开机自动启动</div>
        <div class="switch" :class="{ on: autostartOn }" @click="onAutostartToggle"></div>
      </div>

      <!-- 便签提醒（预设时间提醒） -->
      <div class="set-row">
        <div class="lbl" @click="showRemList = !showRemList">
          便签提醒<small>定时推送天气通知{{ showRemList ? '' : ' · 点此展开明细' }}</small>
        </div>
        <div class="row-actions">
          <span class="expander" @click.stop="showRemList = !showRemList">{{ showRemList ? '▴' : '▾' }}</span>
          <div class="switch" :class="{ on: anyReminderOn }" @click="toggleAllReminders"></div>
        </div>
      </div>

      <!-- 定时提醒明细 -->
      <div class="rem-list" v-if="showRemList && s.timeReminders.length">
        <div v-for="(r, i) in s.timeReminders" :key="i" class="rem-item">
          <input type="time" :value="r.time" @change="settings.setReminderTime(i, ($event.target as HTMLInputElement).value)" />
          <span class="rem-label" @click="settings.toggleReminderSummary(i)">{{ r.summary ? '含详情' : '仅标题' }}</span>
          <div class="switch sm" :class="{ on: r.on }" @click="settings.toggleReminderEnabled(i)"></div>
          <span class="del" @click="settings.removeReminder(i)">✕</span>
        </div>
      </div>

      <!-- 窗口颜色 -->
      <div class="set-row">
        <div class="lbl">窗口颜色<small>自动=跟随天气</small></div>
        <div class="swatches">
          <div
            v-for="c in COLOR_SCHEMES"
            :key="c.key"
            class="swatch"
            :class="{ on: s.colorScheme === c.key }"
            :style="{ background: c.color }"
            :title="c.name"
            @click="settings.setColorScheme(c.key)"
          ></div>
        </div>
      </div>

      <!-- 更多设置 -->
      <div class="more-toggle" @click="showMore = !showMore">
        <span>{{ showMore ? '收起更多设置' : '更多设置' }}</span>
        <span>{{ showMore ? '▲' : '▼' }}</span>
      </div>

      <div v-if="showMore" class="more-body">
        <div class="set-group-title">天气变化提醒</div>
        <div class="set-row">
          <div class="lbl">下雨提醒</div>
          <div class="switch" :class="{ on: s.reminders.rain }" @click="settings.toggleReminderFlag('rain')"></div>
        </div>
        <div class="set-row">
          <div class="lbl">下雪提醒</div>
          <div class="switch" :class="{ on: s.reminders.snow }" @click="settings.toggleReminderFlag('snow')"></div>
        </div>
        <div class="set-row">
          <div class="lbl">降温提醒</div>
          <div class="switch" :class="{ on: s.reminders.tempDrop }" @click="settings.toggleReminderFlag('tempDrop')"></div>
        </div>
        <div class="set-row">
          <div class="lbl">恶劣天气提醒</div>
          <div class="switch" :class="{ on: s.reminders.severe }" @click="settings.toggleReminderFlag('severe')"></div>
        </div>

        <div class="set-group-title">
          <span>新增定时提醒（最多 {{ REMINDER_MAX }} 条）</span>
        </div>
        <div class="rss-add-row">
          <input type="time" class="sel rss-input" v-model="newRemTime" />
          <button class="mini-btn" :disabled="s.timeReminders.length >= REMINDER_MAX" @click="addReminder">添加</button>
        </div>
        <div v-if="remErr" class="field-err">{{ remErr }}</div>

        <div class="set-group-title">固定新闻源</div>
        <div class="set-row" v-for="(src, i) in s.fixedSources" :key="src.name">
          <div class="lbl">{{ src.name }}</div>
          <div class="switch" :class="{ on: src.on }" @click="settings.toggleFixedSource(i)"></div>
        </div>

        <div class="set-group-title">RSS 订阅（最多 {{ RSS_MAX }} 个）</div>
        <div class="rss-add-row">
          <input class="sel rss-input" v-model="rssInput" placeholder="粘贴 RSS 地址" @keyup.enter="addRss" />
          <button class="mini-btn" :disabled="s.rssFeeds.length >= RSS_MAX" @click="addRss">添加</button>
        </div>
        <div v-if="rssErr" class="field-err">{{ rssErr }}</div>
        <div v-if="s.rssFeeds.length === 0" class="list-empty">暂无 RSS 订阅</div>
        <div v-for="(f, i) in s.rssFeeds" :key="f" class="set-row feed-row">
          <span class="feed-url">{{ f }}</span>
          <span class="del" @click="settings.removeRss(i)">✕</span>
        </div>

        <div class="set-group-title">外观</div>
        <div class="set-row">
          <div class="lbl">节日皮肤<small>春节 / 中秋 / 国庆 等</small></div>
          <div class="switch" :class="{ on: s.festivalSkinEnabled }" @click="onFestivalToggle"></div>
        </div>
      </div>

      <button class="done-btn" @click="emit('close')">完成</button>
    </div>
  </div>
</template>

<style scoped>
/* ===== 设置弹窗：毛玻璃遮罩 + 玻璃面板（对应原型 .mask/.sheet） ===== */
.set-mask {
  position: absolute; inset: 0;
  z-index: 100;
  display: flex; align-items: center; justify-content: center;
  background: rgba(15, 23, 42, 0.35);
  -webkit-backdrop-filter: blur(8px) saturate(120%);
  backdrop-filter: blur(8px) saturate(120%);
  border-radius: var(--radius-card);
  overflow: hidden;
}
.set-sheet {
  width: 272px;
  max-height: 94%;
  overflow-y: auto;
  padding: 13px 14px 11px;
  border-radius: 18px;
  color: var(--text-primary);
  background: var(--glass-tint-strong);
  -webkit-backdrop-filter: blur(26px) saturate(180%);
  backdrop-filter: blur(26px) saturate(180%);
  border: 1px solid var(--glass-border);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.32), inset 0 1px 0 var(--glass-inner-hi);
  scrollbar-width: thin;
  scrollbar-color: rgba(120, 130, 145, 0.4) transparent;
}
.set-sheet::-webkit-scrollbar { width: 4px; }
.set-sheet::-webkit-scrollbar-thumb { background: rgba(120, 130, 145, 0.35); border-radius: 4px; }

.set-title {
  font-size: 16px; font-weight: 600; color: var(--text-primary);
  margin: 0 0 3px; text-align: center;
}
.set-time { font-size: 12px; color: var(--accent); font-weight: 600; flex: none; }

.set-group-title {
  font-size: 11px; font-weight: 700; color: var(--text-muted);
  letter-spacing: 0.4px; margin: 12px 0 2px;
  display: flex; justify-content: space-between; align-items: center;
}

/* ===== 原型行式设置项 ===== */
.set-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--divider);
  font-size: 13px; color: var(--text-primary); gap: 8px;
}
.set-row:last-child { border-bottom: none; }
.set-row .lbl { flex: 1; min-width: 0; cursor: default; }
.set-row .lbl small { display: block; font-size: 10px; color: var(--text-muted); margin-top: 2px; }
.row-actions { display: flex; align-items: center; gap: 6px; flex: none; }
.expander {
  font-size: 10px; color: var(--text-muted); cursor: pointer;
  padding: 2px 4px; border-radius: 6px;
}
.expander:hover { color: var(--accent); background: var(--glass-tint-weak); }

.sel {
  padding: 6px 8px; border-radius: var(--radius-control);
  border: 1px solid var(--glass-border);
  background: var(--control-bg);
  color: var(--text-primary); font-size: 12px;
  font-family: inherit;
}
.sel option { color: #1f2937; background: #f7f9fc; }

/* ===== 原型开关：40×22 胶囊 + 圆点 ===== */
.switch {
  width: 40px; height: 22px; border-radius: 999px;
  background: var(--switch-bg);
  position: relative; cursor: pointer; transition: background 0.2s; flex: none;
}
.switch.on { background: var(--accent); }
.switch::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 18px; height: 18px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: left 0.2s;
}
.switch.on::after { left: 20px; }
.switch.sm { width: 32px; height: 18px; }
.switch.sm::after { width: 14px; height: 14px; }
.switch.sm.on::after { left: 16px; }

/* ===== 窗口颜色色板 ===== */
.swatches { display: flex; gap: 7px; flex: none; }
.swatch {
  width: 22px; height: 22px; border-radius: 50%;
  cursor: pointer; border: 2px solid transparent;
  transition: transform 0.15s, border-color 0.15s;
}
.swatch:hover { transform: scale(1.12); }
.swatch.on { border-color: var(--text-primary); }

/* ===== 更多设置折叠 ===== */
.more-toggle {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; color: var(--accent); font-weight: 600;
  padding: 10px 0 2px; cursor: pointer; user-select: none;
}
.more-toggle:hover { opacity: 0.8; }
.more-body { animation: fade-in 0.2s ease; }
@keyframes fade-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

/* ===== 提醒明细 / RSS ===== */
.rem-list { padding: 2px 0 4px; }
.rem-item {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 0;
}
.rem-item input[type="time"] {
  padding: 4px 6px; border-radius: 8px;
  border: 1px solid var(--glass-border);
  background: var(--control-bg); color: var(--text-primary);
  font-size: 12px; font-family: inherit;
}
.rem-label {
  font-size: 10px; color: var(--text-secondary); cursor: pointer;
  padding: 2px 6px; border-radius: 999px;
  background: var(--glass-tint-weak);
  border: 1px solid var(--glass-border-weak);
  white-space: nowrap;
}
.rss-add-row { display: flex; gap: 6px; margin: 6px 0; }
.rss-add-row .rss-input { flex: 1; min-width: 0; }
.mini-btn {
  padding: 5px 10px; border-radius: 8px; border: none;
  background: var(--accent); color: var(--accent-ink); font-size: 11px;
  cursor: pointer; white-space: nowrap; flex: none;
}
.mini-btn:hover { opacity: 0.9; }
.mini-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.list-empty { font-size: 11px; color: var(--text-muted); padding: 4px 0; }
.feed-url { flex: 1; word-break: break-all; font-size: 11px; color: var(--text-primary); }
.del { color: #e05555; cursor: pointer; font-size: 13px; padding: 0 4px; flex-shrink: 0; }
.field-err { font-size: 11px; color: #e05555; margin-top: 4px; }

/* ===== 完成按钮 ===== */
.done-btn {
  width: 100%; height: 38px; margin-top: 12px;
  border-radius: 12px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--accent-ink); font-weight: 700; font-size: 14px; cursor: pointer;
  font-family: inherit;
  transition: filter 0.15s;
}
.done-btn:hover { filter: brightness(1.08); }
</style>
