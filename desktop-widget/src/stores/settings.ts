import { defineStore } from 'pinia';

// 本地配置结构，与 Rust 端 config.rs 保持一致。
export interface ReminderFlags {
  rain: boolean;
  snow: boolean;
  tempDrop: boolean;
  severe: boolean;
}

export interface TimeReminder {
  time: string;   // "07:30"
  summary: boolean;
  on: boolean;
}

export interface FixedSource {
  name: string;
  url: string;
  on: boolean;
}

export interface AppSettings {
  city: string;
  reminders: ReminderFlags;
  timeReminders: TimeReminder[];
  rssFeeds: string[];
  fixedSources: FixedSource[];
  festivalSkinEnabled: boolean;
  // 视图偏好（纯前端显示项，不影响数据管线）
  showLunar: boolean;      // 日历显示农历
  showWeekLabel: boolean;  // 日期显示「周日」而非「日」
  colorScheme: string;     // 窗口配色方案
}

export const REMINDER_MAX = 5;
export const RSS_MAX = 5;

// 窗口配色方案（对应原型 .swatches）
// auto = 跟随天气主题；其余为固定强调色，覆盖天气主题的强调色（节日皮肤优先级最高）
export const COLOR_SCHEMES = [
  { key: 'auto', name: '自动', color: 'linear-gradient(135deg,#3b82f6,#22c55e)' },
  { key: 'blue', name: '蓝色', color: '#3b82f6' },
  { key: 'green', name: '绿色', color: '#22c55e' },
  { key: 'orange', name: '橙色', color: '#f59e0b' },
  { key: 'gray', name: '灰色', color: '#64748b' },
] as const;

// 省市二级联动表（对应原型 REGION）。
// 数据来自单一数据源 src/data/cities.json（由 scripts/gen-city-data.mjs 生成），
// 后端 weather.rs 读取同一份文件，前后端不再各自维护副本。
import { provinceOf } from '../data/cities';
export {
  PROVINCES,
  CITIES,
  CITY_COORDS,
  provinceOf,
} from '../data/cities';

const DEFAULT_SETTINGS: AppSettings = {
  city: '南昌',
  reminders: { rain: true, snow: true, tempDrop: false, severe: false },
  timeReminders: [
    { time: '07:30', summary: true, on: true },
    { time: '21:00', summary: false, on: true },
  ],
  rssFeeds: ['https://sspai.com/feed'],
  fixedSources: [
    { name: '少数派', url: 'https://sspai.com/feed', on: true },
    { name: '36氪', url: 'https://36kr.com/feed', on: true },
    { name: 'V2EX', url: 'https://www.v2ex.com/index.xml', on: true },
    { name: 'Hacker News', url: 'https://hnrss.org/frontpage', on: false },
  ],
  festivalSkinEnabled: true,
  showLunar: true,
  showWeekLabel: false,
  colorScheme: 'auto',
};

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: { ...DEFAULT_SETTINGS } as AppSettings,
    loaded: false,
  }),
  getters: {
    // 当前城市所属省份
    province(state): string {
      return provinceOf(state.settings.city);
    },
  },
  actions: {
    async load() {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const s = await invoke<AppSettings>('get_settings');
        this.settings = { ...DEFAULT_SETTINGS, ...s };
      } catch {
        this.settings = { ...DEFAULT_SETTINGS };
      } finally {
        this.loaded = true;
      }
    },
    async save() {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_settings', { settings: this.settings });
      } catch {
        // 忽略：非桌面环境
      }
    },
    async setCity(city: string) {
      this.settings.city = city;
      await this.save();
    },
    // 新增 RSS（后端校验合法性/去重/上限）
    async addRss(url: string): Promise<string | null> {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const clean = await invoke<string>('validate_rss', { url });
        this.settings.rssFeeds.push(clean);
        await this.save();
        return null;
      } catch (e) {
        return String(e);
      }
    },
    removeRss(i: number) {
      this.settings.rssFeeds.splice(i, 1);
      this.save();
    },
    // 新增一条时间提醒（后端校验格式/去重/上限）
    async addReminder(time: string): Promise<string | null> {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const list = await invoke<TimeReminder[]>('add_time_reminder', { time });
        this.settings.timeReminders = list;
        return null;
      } catch (e) {
        return String(e);
      }
    },
    removeReminder(i: number) {
      this.settings.timeReminders.splice(i, 1);
      this.save();
    },
    toggleReminderSummary(i: number) {
      const r = this.settings.timeReminders[i];
      if (r) r.summary = !r.summary;
      this.save();
    },
    toggleReminderEnabled(i: number) {
      const r = this.settings.timeReminders[i];
      if (r) r.on = !r.on;
      this.save();
    },
    setReminderTime(i: number, time: string) {
      const r = this.settings.timeReminders[i];
      if (r) r.time = time;
      this.save();
    },
    toggleFixedSource(i: number) {
      const s = this.settings.fixedSources[i];
      if (s) s.on = !s.on;
      this.save();
    },
    toggleReminderFlag(key: 'rain' | 'snow' | 'tempDrop' | 'severe') {
      this.settings.reminders[key] = !this.settings.reminders[key];
      this.save();
    },
    toggle(key: 'festivalSkinEnabled' | 'showLunar' | 'showWeekLabel') {
      this.settings[key] = !this.settings[key];
      this.save();
    },
    // 窗口配色方案切换（auto = 跟随天气主题）
    setColorScheme(key: string) {
      this.settings.colorScheme = key;
      this.save();
    },
    // ===== 开机自启（tauri-plugin-autostart） =====
    async getAutostart(): Promise<boolean> {
      try {
        const { isEnabled } = await import('@tauri-apps/plugin-autostart');
        return await isEnabled();
      } catch {
        return false;
      }
    },
    async setAutostart(on: boolean): Promise<boolean> {
      try {
        const { enable, disable } = await import('@tauri-apps/plugin-autostart');
        if (on) await enable();
        else await disable();
        return on;
      } catch {
        return !on;
      }
    },
  },
});
