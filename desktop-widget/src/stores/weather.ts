import { defineStore } from 'pinia';
import { useThemeStore } from './theme';
import { describeWeather } from './theme';

export interface CurrentWeather {
  temperature: number;
  humidity: number;
  weatherCode: number;
  windSpeed: number;
  windDirection: number;
  isDay: boolean;
}

export interface HourlyItem {
  time: string;
  temperature: number;
  weatherCode: number;
  precipitationProbability: number;
}

export interface DailyItem {
  date: string;           // "2026-11-09"
  weatherCode: number;
  tempMax: number;
  tempMin: number;
  precipitationProbability: number;
}

export interface WeatherData {
  current: CurrentWeather;
  hourly: HourlyItem[];
  daily: DailyItem[];
  updatedAt: string; // "HH:mm"
  city: string;
}

export const WIND_DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

export function windDirText(deg: number): string {
  return WIND_DIRS[Math.round(deg / 45) % 8] + '风';
}

export function windLevel(speedKmh: number): number {
  // 简化的蒲福风级近似
  const levels = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 117];
  let lvl = 0;
  for (let i = 0; i < levels.length; i++) {
    if (speedKmh >= levels[i]) lvl = i + 1;
  }
  return lvl;
}

// 体感温度（Steadman 公式，澳大利亚气象局标准）
// AT = T + 0.33e - 0.70ws - 4.00，e = rh/100 * 6.105 * exp(17.27T / (237.7 + T))
export function feelsLike(temperature: number, humidity: number, windSpeedKmh: number): number {
  const rh = Math.min(100, Math.max(0, humidity));
  const e = (rh / 100) * 6.105 * Math.exp((17.27 * temperature) / (237.7 + temperature));
  const at = temperature + 0.33 * e - 0.7 * windSpeedKmh - 4.0;
  return Math.round(at);
}

// 城市经纬度（与 Rust 端共用同一数据源 src/data/cities.json）
export { CITY_COORDS } from '../data/cities';

export const useWeatherStore = defineStore('weather', {
  state: () => ({
    data: null as WeatherData | null,
    loading: false,
    error: '' as string,
  }),
  getters: {
    currentDesc(state): string {
      if (!state.data) return '--';
      const { weatherCode, isDay } = state.data.current;
      return describeWeather(weatherCode, !isDay).text;
    },
    currentIcon(state): string {
      if (!state.data) return '🌡️';
      const { weatherCode, isDay } = state.data.current;
      return describeWeather(weatherCode, !isDay).icon;
    },
    // 体感温度（前端按 Steadman 公式计算）
    feelsLike(state): number | null {
      if (!state.data) return null;
      const c = state.data.current;
      return feelsLike(c.temperature, c.humidity, c.windSpeed);
    },
  },
  actions: {
    async fetch(city: string) {
      this.loading = true;
      this.error = '';
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const d = await invoke<WeatherData>('fetch_weather', { city });
        this.data = d;
        useThemeStore().updateFromCode(d.current.weatherCode);
      } catch (e) {
        this.error = String(e);
        // 失败时保留上一次成功数据（PRD 5.3）
      } finally {
        this.loading = false;
      }
    },
    // 浏览器原型预览用的演示数据（正式实现走后端 fetch_weather）
    useDemo(city: string) {
      const code = 61;
      this.data = {
        current: { temperature: 14, humidity: 82, weatherCode: code, windSpeed: 12, windDirection: 45, isDay: true },
        hourly: [13, 14, 15, 16, 17, 18, 19, 20].map((h, i) => ({
          time: `${String(h).padStart(2, '0')}:00`,
          temperature: 14 - i,
          weatherCode: [61, 63, 61, 80, 3, 3, 61, 63][i % 8],
          precipitationProbability: [30, 40, 35, 55, 20, 15, 30, 45][i % 8],
        })),
        daily: ['11-09', '11-10', '11-11', '11-12', '11-13', '11-14', '11-15'].map((d, i) => ({
          date: `2026-${d}`,
          weatherCode: [61, 80, 3, 0, 2, 61, 95][i],
          tempMax: 17 - i,
          tempMin: 11 - i,
          precipitationProbability: [40, 55, 20, 5, 15, 45, 70][i],
        })),
        updatedAt: new Date().toTimeString().slice(0, 5),
        city,
      };
      useThemeStore().updateFromCode(code);
    },
  },
});
