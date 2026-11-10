<script setup lang="ts">
import { computed } from 'vue';
import { useCalendarStore, WEEKDAYS } from '../stores/calendar';
import { useSettingsStore } from '../stores/settings';

const cal = useCalendarStore();
const settings = useSettingsStore();

// 年份下拉选项（近 10 年 ~ 未来 10 年）
const yearOptions = computed(() => {
  const now = new Date().getFullYear();
  const years: number[] = [];
  for (let y = now - 10; y <= now + 10; y++) years.push(y);
  return years;
});

// 周标题：设置项「日期显示周/日」切换「日」↔「周日」
const weekLabels = computed(() =>
  settings.settings.showWeekLabel
    ? WEEKDAYS.map((w) => `周${w}`)
    : WEEKDAYS,
);

// 年月下拉切换
function onYearChange(e: Event) {
  cal.gotoMonth(Number((e.target as HTMLSelectElement).value), cal.viewMonth);
}
function onMonthChange(e: Event) {
  cal.gotoMonth(cal.viewYear, Number((e.target as HTMLSelectElement).value) - 1);
}

// 日期格悬浮提示：农历/节气 + 节日 + 假日/补班状态
function dayTitle(cell: {
  lunarText: string;
  term?: string;
  festival?: string;
  isHoliday?: boolean;
  isMakeupWorkday?: boolean;
}): string {
  let t = cell.lunarText;
  if (cell.term && cell.term !== cell.lunarText) t += ` · ${cell.term}`;
  if (cell.festival) t += ` · ${cell.festival}`;
  if (cell.isHoliday) t += ' · 法定假日';
  else if (cell.isMakeupWorkday) t += ' · 调休上班';
  return t;
}
</script>

<template>
  <div class="cal-panel">
    <!-- 头部：前后翻月 + 年月下拉 + 今天 -->
    <div class="cal-head">
      <button class="cal-nav" title="上个月" @click="cal.changeMonth(-1)">◀</button>
      <select class="sel" :value="cal.viewYear" title="选择年份" @change="onYearChange">
        <option v-for="y in yearOptions" :key="y" :value="y">{{ y }}年</option>
      </select>
      <select class="sel" :value="cal.viewMonth + 1" title="选择月份" @change="onMonthChange">
        <option v-for="i in 12" :key="i" :value="i">{{ i }}月</option>
      </select>
      <button class="cal-nav today" title="回到今天" @click="cal.backToToday()">今</button>
      <button class="cal-nav" title="下个月" @click="cal.changeMonth(1)">▶</button>
    </div>

    <!-- 周标题：周日开头 -->
    <div class="cal-week">
      <span v-for="w in weekLabels" :key="w">{{ w }}</span>
    </div>

    <!-- 日期网格 -->
    <div class="cal-grid">
      <div
        v-for="cell in cal.cells"
        :key="cell.iso"
        class="cal-cell"
        :class="{
          dim: !cell.isCurrentMonth,
          today: cell.isToday,
          sel: cell.iso === cal.selectedIso,
          fest: !!cell.festival,
          off: cell.isCurrentMonth && cell.isHoliday && !cell.isToday,
        }"
        :title="dayTitle(cell)"
        @click="cal.selectDay(cell.iso, cell.isCurrentMonth)"
      >
        <span class="d">{{ cell.day }}</span>
        <span v-if="settings.settings.showLunar" class="lu">
          {{ cell.term || (cell.lunarText === '初一' ? cell.lunarText : cell.lunarText) }}
        </span>
        <span v-if="cell.isCurrentMonth && cell.isMakeupWorkday && !cell.isToday" class="dot work"></span>
        <span v-else-if="cell.isCurrentMonth && cell.isHoliday && !cell.isToday" class="dot off"></span>
      </div>
    </div>

    <!-- 底部：今天农历 + 图例 -->
    <div class="cal-extra">
      <span class="cal-lunar-text">
        农历{{ cal.todayLunar }}<template v-if="cal.todayTerm"> · {{ cal.todayTerm }}</template>
      </span>
      <div class="cal-legend">
        <span class="cal-legend-item"><span class="dot today"></span>今天</span>
        <span class="cal-legend-item"><span class="dot off"></span>法定假日</span>
        <span class="cal-legend-item"><span class="dot work"></span>调休上班</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cal-panel { display: flex; flex-direction: column; }

/* ===== 头部：前后翻月 + 年月下拉 + 今天 ===== */
.cal-head {
  display: flex;
  gap: 5px;
  align-items: center;
  margin-bottom: 10px;
}
.cal-head .sel {
  flex: 1 1 0;
  min-width: 0;
  text-align: center;
  font-size: 12px;
  padding: 7px 4px;
}
/* 年份下拉内容更长，给它多一点宽度 */
.cal-head .sel:nth-of-type(1) { flex: 1.3 1 0; }
.cal-nav {
  width: 28px; height: 30px;
  flex: none;
  overflow: hidden;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-control);
  background: var(--control-bg);
  -webkit-backdrop-filter: blur(var(--glass-blur-sm));
  backdrop-filter: blur(var(--glass-blur-sm));
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 11px;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.cal-nav:hover { background: var(--control-bg-hover); color: var(--accent); }
.cal-nav.today { color: var(--accent); font-weight: 600; width: 30px; font-size: 12px; }

/* ===== 周标题行（日开头） ===== */
.cal-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.cal-week span { padding: 3px 0; font-weight: 500; }

/* ===== 日期网格 ===== */
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
  width: 100%;
}
.cal-cell {
  position: relative;
  min-width: 0;
  min-height: 38px;
  padding: 3px 0;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}
.cal-cell .d { line-height: 1.1; }
.cal-cell .lu {
  font-size: 9px;
  color: var(--text-secondary);
  margin-top: 1px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 相邻月淡化 */
.cal-cell.dim { color: var(--text-muted); opacity: 0.45; }
/* 今天：强调色描边 */
.cal-cell.today {
  color: var(--accent);
  font-weight: 700;
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
/* 选中：强调色实心 */
.cal-cell.sel {
  background: var(--accent);
  color: var(--accent-ink);
  box-shadow: 0 4px 12px var(--accent-soft);
}
.cal-cell.sel .lu { color: var(--accent-ink); opacity: 0.85; }
/* 节日：农历用节日色 */
.cal-cell.fest .lu { color: var(--festival); font-weight: 600; }
.cal-cell.sel.fest .lu { color: var(--accent-ink); }
.cal-cell.off .d { color: #e05252; }
.cal-cell.sel.off .d { color: var(--accent-ink); }

/* 假日 / 调休小圆点 */
.dot {
  position: absolute;
  bottom: 3px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px; height: 4px;
  border-radius: 50%;
}
.dot.off { background: #e05252; }
.dot.work { background: var(--text-muted); }
.dot.today { background: var(--accent); }

/* ===== 底部：今天农历 + 图例 ===== */
.cal-extra {
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--divider);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.cal-lunar-text { font-size: 11px; color: var(--text-secondary); }
.cal-legend {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 10px;
  color: var(--text-muted);
}
.cal-legend-item { display: inline-flex; align-items: center; gap: 4px; }
.cal-legend .dot { position: static; transform: none; }
</style>
