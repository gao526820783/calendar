import { getSolarTerms } from 'chinese-days';

// 日期字符串（YYYY-MM-DD）→ 节气名。跨模块共享缓存。
const termCache = new Map<string, string>();

// 加载某年前后共 3 年的节气到缓存（12 月/1 月视图可能跨年）
function loadTerms(year: number) {
  if (termCache.size > 0 && termHasYear(year)) return;
  const start = `${year - 1}-01-01`;
  const end = `${year + 1}-12-31`;
  try {
    const terms = getSolarTerms(start, end);
    for (const t of terms) {
      termCache.set(t.date, t.name);
    }
  } catch {
    // 数据缺失时静默忽略
  }
}

function termHasYear(year: number): boolean {
  // 粗略判断：缓存里是否有该年 6 月附近的节气
  const probe = `${year}-06-`;
  for (const key of termCache.keys()) {
    if (key.startsWith(probe)) return true;
  }
  return false;
}

// 返回某天的节气名；非节气当天返回空字符串。
export function solarTermOfDay(date: Date): string {
  const y = date.getFullYear();
  loadTerms(y);
  const ds = `${y}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return termCache.get(ds) ?? '';
}

// 返回某月每一天的节气名（用于日历格子显示）
export function solarTermsInMonth(year: number, month0: number): Record<number, string> {
  loadTerms(year);
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const map: Record<number, string> = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const name = solarTermOfDay(new Date(year, month0, d));
    if (name) map[d] = name;
  }
  return map;
}
