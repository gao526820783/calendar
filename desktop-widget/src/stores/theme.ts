import { defineStore } from 'pinia';
import { Lunar, Solar } from 'lunar-javascript';

// 天气主题皮肤，与 PRD 5.4 对应。
export type WeatherTheme = 'sunny' | 'cloudy' | 'rain' | 'snow' | 'thunder' | 'night';
// 节日皮肤（PRD 5.5）
export type FestivalStyle = 'chunjie' | 'zhongqiu' | 'guoqing' | 'shengdan' | 'jizhe' | 'yuanxiao' | 'duanwu';

// WMO 天气代码 → 主题
function codeToTheme(code: number, isNight: boolean): WeatherTheme {
  if (code === 0 || code === 1 || code === 2 || code === 3 || code === 45 || code === 48) {
    // 晴/多云/雾：夜间切 night，白天为 cloudy（PRD：夜间=晴/多云且夜间）
    return isNight ? 'night' : 'cloudy';
  }
  if (code === 51 || code === 53 || code === 55) return 'rain'; // 毛毛雨
  if (code === 61 || code === 63 || code === 65) return 'rain'; // 雨
  if (code === 71 || code === 73 || code === 75 || code === 77) return 'snow'; // 雪/雪粒
  if (code === 80 || code === 81 || code === 82) return 'rain'; // 阵雨
  if (code === 85 || code === 86) return 'snow'; // 阵雪
  if (code === 95 || code === 96 || code === 99) return 'thunder'; // 雷暴
  return isNight ? 'night' : 'cloudy';
}

export function isNightTime(date = new Date()): boolean {
  const h = date.getHours();
  return h >= 19 || h < 6;
}

// WMO 代码 → 展示文案与图标
const WMO: Record<number, { text: string; icon: string }> = {
  0: { text: '晴', icon: '☀️' },
  1: { text: '多云', icon: '⛅' },
  2: { text: '多云', icon: '⛅' },
  3: { text: '阴', icon: '☁️' },
  45: { text: '雾', icon: '🌫️' },
  48: { text: '雾', icon: '🌫️' },
  51: { text: '毛毛雨', icon: '🌦️' },
  53: { text: '毛毛雨', icon: '🌦️' },
  55: { text: '毛毛雨', icon: '🌦️' },
  61: { text: '小雨', icon: '🌧️' },
  63: { text: '中雨', icon: '🌧️' },
  65: { text: '大雨', icon: '🌧️' },
  71: { text: '小雪', icon: '🌨️' },
  73: { text: '中雪', icon: '❄️' },
  75: { text: '大雪', icon: '❄️' },
  77: { text: '雪粒', icon: '🌨️' },
  80: { text: '阵雨', icon: '🌦️' },
  81: { text: '阵雨', icon: '🌦️' },
  82: { text: '阵雨', icon: '🌦️' },
  85: { text: '阵雪', icon: '🌨️' },
  86: { text: '阵雪', icon: '🌨️' },
  95: { text: '雷暴', icon: '⛈️' },
  96: { text: '雷暴', icon: '⛈️' },
  99: { text: '雷暴', icon: '⛈️' },
};

export function describeWeather(code: number, isNight = false): { text: string; icon: string } {
  if (isNight && code <= 3) {
    return { text: '晴', icon: '🌙' };
  }
  return WMO[code] ?? { text: '未知', icon: '🌡️' };
}

// 内置节日表：公历(M-D) 与 农历(M-D) 混合，通过 lunar-javascript 换算匹配（PRD 5.5）
export interface FestivalDef {
  key: string;
  name: string;
  style: FestivalStyle;
  solar?: string; // "10-1"
  lunar?: string; // "1-1"
  deco: string;   // 面板右下角装饰大图标（对应原型 .deco）
  badge: string;  // 节日祝福语（对应原型 fest-badge）
}

export const FESTIVALS: FestivalDef[] = [
  { key: 'chunjie', name: '春节', style: 'chunjie', lunar: '1-1', deco: '🧧', badge: '新春快乐' },
  { key: 'yuanxiao', name: '元宵节', style: 'yuanxiao', lunar: '1-15', deco: '🏮', badge: '元宵团圆' },
  { key: 'duanwu', name: '端午节', style: 'duanwu', lunar: '5-5', deco: '🐲', badge: '端午安康' },
  { key: 'zhongqiu', name: '中秋节', style: 'zhongqiu', lunar: '8-15', deco: '🌙', badge: '中秋团圆' },
  { key: 'guoqing', name: '国庆节', style: 'guoqing', solar: '10-1', deco: '🇨🇳', badge: '国庆快乐' },
  { key: 'jizhe', name: '记者节', style: 'jizhe', solar: '11-8', deco: '🖊️', badge: '记者节快乐' },
  { key: 'shengdan', name: '圣诞节', style: 'shengdan', solar: '12-25', deco: '🎄', badge: '圣诞快乐' },
];

// 匹配当天节日：返回命中的节日定义或 null
export function matchTodayFestival(date = new Date()): FestivalDef | null {
  const solar = Solar.fromDate(date);
  const lunar = Lunar.fromDate(date);
  const solarKey = `${solar.getMonth()}-${solar.getDay()}`;
  const lunarKey = `${lunar.getMonth()}-${lunar.getDay()}`;
  for (const f of FESTIVALS) {
    if (f.solar && f.solar === solarKey) return f;
    if (f.lunar && f.lunar === lunarKey) return f;
  }
  return null;
}

// 该公历月的每一天是否有节日（用于日历小圆点标记）：返回 day→节日名
export function festivalDaysInMonth(year: number, month0: number): Record<number, string> {
  const map: Record<number, string> = {};
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const f = matchTodayFestival(new Date(year, month0, d));
    if (f) map[d] = f.name;
  }
  return map;
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    theme: 'cloudy' as WeatherTheme,
    // 节日皮肤：命中的节日定义；关闭皮肤时置 null
    festival: null as FestivalDef | null,
  }),
  getters: {
    // 顶层生效皮肤：节日优先，其次天气（PRD 5.5）
    activeFestivalStyle(state): FestivalStyle | null {
      return state.festival ? state.festival.style : null;
    },
  },
  actions: {
    updateFromCode(code: number) {
      this.theme = codeToTheme(code, isNightTime());
    },
    set(theme: WeatherTheme) {
      this.theme = theme;
    },
    // 根据当天日期 + 开关状态刷新节日皮肤
    refreshFestival(enabled: boolean) {
      this.festival = enabled ? matchTodayFestival() : null;
    },
  },
});
