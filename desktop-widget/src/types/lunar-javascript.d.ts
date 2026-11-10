// lunar-javascript 无官方类型，提供最小声明。
declare module 'lunar-javascript' {
  export interface Lunar {
    getMonth(): number;
    getDay(): number;
    getMonthInChinese(): string;
    getDayInChinese(): string;
    getJieQi(): string;
    getFestivals(): string[];
  }
  export interface Solar {
    getMonth(): number;
    getDay(): number;
    getFestivals(): string[];
  }
  export const Lunar: { fromDate(d: Date): Lunar };
  export const Solar: { fromDate(d: Date): Solar };
}
