import { defineStore } from 'pinia';
import { Lunar, Solar } from 'lunar-javascript';
import { getDayDetail, getHolidaysInRange, isInLieu } from 'chinese-days';
import { solarTermOfDay } from './solarTerm';

export interface DayCell {
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  lunarText: string;
  festival?: string;
  term?: string;
  // 法定节假日（放假）
  isHoliday?: boolean;
  // 调休补班日（周末但需上班）
  isMakeupWorkday?: boolean;
  // 该格对应的日期（YYYY-MM-DD），用于选中态比对
  iso: string;
}

function isoOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 用 chinese-days 判断某天的法定假日/补班状态（离线数据，含调休）
//
// 注意：chinese-days 的 isHoliday() 语义是「非工作日」，普通周末也返回 true，
// 因此不能直接用它判定法定假日。这里按库的原始数据结构精确区分三种状态：
//   - 法定节假日（holidays 映射）→ 放假，红点
//   - 调休放假日（inLieuDays 映射）→ 放假，红点
//   - 调休上班日（workdays 映射）→ 周末但要上班，灰点
function holidayStatus(date: Date): { isHol: boolean; isMakeup: boolean } {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const ds = `${y}-${m}-${d}`;
  try {
    const dow = date.getDay();
    const isWeekend = dow === 0 || dow === 6;
    // 法定节假日：getHolidaysInRange(includeWeekends=false) 只返回 holidays 映射里的日期
    const official = getHolidaysInRange(ds, ds, false).length > 0;
    // 调休放假日
    const inLieu = isInLieu(ds);
    // 调休上班日：周末却排在工作日
    const isMakeup = isWeekend && getDayDetail(ds).work;
    return { isHol: official || inLieu, isMakeup };
  } catch {
    return { isHol: false, isMakeup: false };
  }
}

function lunarLabel(date: Date): { text: string; festival?: string; term?: string } {
  const solar = Solar.fromDate(date);
  const lunar = Lunar.fromDate(date);
  // 节气改用 chinese-days 同源计算（1900–2100）
  const term = solarTermOfDay(date);
  const lunarFestivals = lunar.getFestivals();
  const solarFestivals = solar.getFestivals();
  let festival: string | undefined;
  if (lunarFestivals.length > 0) festival = lunarFestivals[0];
  else if (solarFestivals.length > 0) festival = solarFestivals[0];

  let text = lunar.getDayInChinese() === '初一'
    ? lunar.getMonthInChinese() + '月'
    : lunar.getDayInChinese();
  if (term) text = term;

  return { text, festival, term: term || undefined };
}

// 周日开头（对应原型 .cal-week 的「日 一 二 三 四 五 六」）
export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// 计算某天在「周日开头」网格中的列索引（0=周日 ... 6=周六）
function sundayIndex(date: Date): number {
  return date.getDay();
}

export const useCalendarStore = defineStore('calendar', {
  state: () => ({
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(), // 0-based
    cells: [] as DayCell[],
    todayLunar: '' as string,
    todayTerm: '' as string,
    todayFestival: '' as string,
    // 当前选中日期（对应原型 .cal-cell.sel）
    selectedIso: isoOf(new Date()),
  }),
  actions: {
    init() {
      const now = new Date();
      this.viewYear = now.getFullYear();
      this.viewMonth = now.getMonth();
      const info = lunarLabel(now);
      const lunar = Lunar.fromDate(now);
      this.todayLunar = `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`;
      this.todayTerm = info.term ?? '';
      this.todayFestival = info.festival ?? '';
      this.render();
    },
    render() {
      const y = this.viewYear;
      const m = this.viewMonth;
      // 周日开头：首列偏移 = 1 号是星期几
      const firstDay = sundayIndex(new Date(y, m, 1));
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const daysInPrev = new Date(y, m, 0).getDate();
      const today = new Date();
      const cells: DayCell[] = [];

      for (let i = firstDay - 1; i >= 0; i--) {
        const day = daysInPrev - i;
        const date = new Date(y, m - 1, day);
        const lbl = lunarLabel(date);
        const st = holidayStatus(date);
        cells.push({ day, isCurrentMonth: false, isToday: false, lunarText: lbl.text, isHoliday: st.isHol, isMakeupWorkday: st.isMakeup, iso: isoOf(date) });
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(y, m, d);
        const isToday =
          d === today.getDate() && m === today.getMonth() && y === today.getFullYear();
        const lbl = lunarLabel(date);
        const st = holidayStatus(date);
        cells.push({
          day: d,
          isCurrentMonth: true,
          isToday,
          lunarText: lbl.text,
          festival: lbl.festival,
          term: lbl.term,
          isHoliday: st.isHol,
          isMakeupWorkday: st.isMakeup,
          iso: isoOf(date),
        });
      }
      const rem = 7 - (cells.length % 7);
      if (rem < 7) {
        for (let d = 1; d <= rem; d++) {
          const date = new Date(y, m + 1, d);
          const lbl = lunarLabel(date);
          const st = holidayStatus(date);
          cells.push({ day: d, isCurrentMonth: false, isToday: false, lunarText: lbl.text, isHoliday: st.isHol, isMakeupWorkday: st.isMakeup, iso: isoOf(date) });
        }
      }
      this.cells = cells;
    },
    // 选中某一天（点击日期格）
    selectDay(iso: string, isCurrentMonth: boolean) {
      this.selectedIso = iso;
      // 点到相邻月 → 视图跟随切换
      const [y, m] = iso.split('-').map(Number);
      if (!isCurrentMonth) {
        this.viewYear = y;
        this.viewMonth = m - 1;
        this.render();
      }
    },
    changeMonth(delta: number) {
      let m = this.viewMonth + delta;
      if (m < 0) { m = 11; this.viewYear -= 1; }
      else if (m > 11) { m = 0; this.viewYear += 1; }
      this.viewMonth = m;
      this.render();
    },
    // 翻月时跨年（Win10 日历上/下箭头）
    changeYear(delta: number) {
      this.viewYear += delta;
      this.render();
    },
    // 直达指定年月（下拉用）
    gotoMonth(year: number, month: number) {
      this.viewYear = year;
      this.viewMonth = month;
      this.render();
    },
    // 回到今天
    backToToday() {
      const now = new Date();
      this.viewYear = now.getFullYear();
      this.viewMonth = now.getMonth();
      this.selectedIso = isoOf(now);
      this.render();
    },
  },
});
