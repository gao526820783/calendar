#!/usr/bin/env node
/**
 * 基线契约静态校验（配合 D:\weather\BASELINE.md）
 *
 * 目的：任何改动之后，一条命令确认「原本设定的功能与 UI 交互」未被破坏。
 *   node scripts/check-baseline.mjs
 *
 * 退出码 0 = 全部通过；1 = 存在基线破坏项。
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCitiesJson } from './lib/city-data.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const APP = join(ROOT, 'desktop-widget');

const read = (p) => {
  const abs = join(APP, p);
  if (!existsSync(abs)) return '';
  return readFileSync(abs, 'utf8');
};
const json = (p) => JSON.parse(read(p) || '{}');

/* ------------------------------------------------------------------ */
/* 断言框架                                                            */
/* ------------------------------------------------------------------ */
let pass = 0;
const failures = [];
const warns = [];

function ok(label) {
  pass++;
  console.log(`  \x1b[32m✔\x1b[0m ${label}`);
}
function fail(label, detail) {
  failures.push({ label, detail });
  console.log(`  \x1b[31m✘\x1b[0m ${label}${detail ? `\n      \x1b[31m${detail}\x1b[0m` : ''}`);
}
function warn(label, detail) {
  warns.push({ label, detail });
  console.log(`  \x1b[33m!\x1b[0m ${label}${detail ? `\n      ${detail}` : ''}`);
}

/** 词边界匹配（CSS 类名含 `-`，需按非标识符字符切分） */
function hasToken(src, token) {
  if (!src) return false;
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_-])${esc}([^A-Za-z0-9_-]|$)`).test(src);
}

/** 断言文件里存在某个 token */
function expectToken(file, token, label = token) {
  const src = read(file);
  if (!src) return fail(`${label}`, `文件不存在：${file}`);
  hasToken(src, token) ? ok(label) : fail(label, `在 ${file} 中找不到 "${token}"`);
}

/** 取 <template> 区块（DOM 类名契约只应在此校验，避免被 scoped CSS 同名掩盖）
 *  注意：组件内部可能有 <template v-if> 条件片段，结束标签必须取最后一个 */
function readTpl(file) {
  const src = read(file);
  const i = src.indexOf('\n<template>');
  const j = src.lastIndexOf('</template>');
  return i >= 0 && j > i ? src.slice(i, j) : '';
}

/** 断言 template 区块内存在某个类名 token */
function expectTplToken(file, token, label = token) {
  const tpl = readTpl(file);
  if (!tpl) return fail(`${label}`, `未在 ${file} 中找到 <template> 区块`);
  hasToken(tpl, token) ? ok(label) : fail(label, `在 ${file} 的 template 中找不到 "${token}"`);
}

/** 断言文件里不存在某个 token（红线） */
function forbidToken(file, token, label = `${file} 不应包含 "${token}"`) {
  const src = read(file);
  if (!src) return;
  hasToken(src, token) ? fail(label, `${file} 中出现了 "${token}"`) : ok(label);
}

/** 断言给定文本里不存在某个 token（红线） */
function forbidIn(src, token, label = `不应包含 "${token}"`) {
  hasToken(src, token) ? fail(label, `出现了 "${token}"`) : ok(label);
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

/* ------------------------------------------------------------------ */
/* 1. 窗口与外壳                                                       */
/* ------------------------------------------------------------------ */
section('1. 窗口与外壳契约');
{
  const conf = json('src-tauri/tauri.conf.json');
  const win = (conf.app?.windows || []).find((w) => w.label === 'main');
  if (!win) fail('主窗口 label="main" 存在');
  else {
    const checks = [
      ['width', win.width, 320],
      ['height', win.height, 480],
      ['resizable', win.resizable, false],
      ['decorations', win.decorations, false],
      ['visible', win.visible, false],
      ['skipTaskbar', win.skipTaskbar, true],
      ['title', win.title, '天气 · 日历 · 新闻'],
    ];
    for (const [k, got, want] of checks) {
      got === want ? ok(`窗口 ${k} = ${JSON.stringify(want)}`) : fail(`窗口 ${k}`, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`);
    }
  }

  const idx = read('index.html');
  hasToken(idx, 'boot') ? ok('index.html 保留 #boot 占位骨架（防白屏）') : fail('index.html 保留 #boot 占位骨架');
  hasToken(read('src/main.ts'), 'app-ready') ? ok('main.ts emit("app-ready") 握手存在') : fail('main.ts emit("app-ready") 握手存在');
  hasToken(read('src-tauri/src/main.rs'), 'app-ready') ? ok('Rust 端监听 app-ready') : fail('Rust 端监听 app-ready');
  hasToken(read('src-tauri/src/main.rs'), 'prevent_close') ? ok('关闭窗口 = 隐藏到托盘（prevent_close）') : fail('关闭窗口 = 隐藏到托盘（prevent_close）');
}

section('2. 外壳 DOM 契约');
{
  const f = 'src/App.vue';
  const must = ['widget', 'weather-anim', 'app', 'deco', 'header', 'header-title', 'gear',
    'festival-badge', 'tabs', 'tab', 'panel-wrap', 'panel', 'activeTab', 'switchTab'];
  for (const t of must) expectTplToken(f, t);
  hasToken(read(f), 'data-tauri-drag-region') ? ok('顶栏保留拖拽区 data-tauri-drag-region') : fail('顶栏保留拖拽区 data-tauri-drag-region');
  const app = readTpl(f);
  const tabOrder = ['天气', '日历', '新闻'];
  const idxs = tabOrder.map((t) => app.indexOf(`>${t}</button>`));
  idxs.every((v, i) => v >= 0 && (i === 0 || v > idxs[i - 1]))
    ? ok('Tab 顺序 = 天气 → 日历 → 新闻')
    : fail('Tab 顺序 = 天气 → 日历 → 新闻', `位置：${idxs.join(', ')}`);
  hasToken(app, '天气 · 日历 · 新闻') ? ok('顶栏标题文案「天气 · 日历 · 新闻」') : fail('顶栏标题文案「天气 · 日历 · 新闻」');
  // R2：底栏
  forbidToken(f, 'footer', 'App.vue 不含底栏 footer（R2）');
  forbidToken('src/style.css', 'footer', 'style.css 不含底栏 footer（R2）');
}

/* ------------------------------------------------------------------ */
/* 3. 天气面板                                                         */
/* ------------------------------------------------------------------ */
section('3. 天气面板契约');
{
  const f = 'src/components/WeatherCard.vue';
  const must = ['weather-panel', 'city-row', 'sel', 'w-main', 'w-icon', 'w-temp', 'w-desc',
    'stale', 'w-updated', 'w-grid', 'w-cell', 'fc-bar', 'seg', 'seg-btn', 'drag-tip',
    'w-strip', 'w-hr', 'wide', 'list-empty',
    // 城市搜索（391 城快速定位）
    'city-search', 'search-input', 'search-panel', 'search-item', 'search-empty'];
  for (const t of must) expectTplToken(f, t);
  const src = read(f);
  const tpl = readTpl(f);
  for (const t of ['t', 'i', 'd', 'hi', 'lo', 'p']) {
    tpl.includes(`class="${t}"`) ? ok(`预报卡内层 .${t}`) : fail(`预报卡内层 .${t}`, `找不到 class="${t}"`);
  }
  ['湿度', '风向', '风力', '体感'].forEach((label, i, arr) => {
    const pos = src.indexOf(`label: '${label}'`);
    const ordered = arr.every((l, j) => {
      if (j === i) return true;
      const p = src.indexOf(`label: '${l}'`);
      return j < i ? p < pos : p > pos;
    });
    pos >= 0 && ordered ? ok(`四格指标含「${label}」且顺序正确`) : fail(`四格指标顺序`, `「${label}」位置异常`);
  });
  hasToken(src, 'useDragScroll') ? ok('预报条绑定 useDragScroll') : fail('预报条绑定 useDragScroll');
  // 省市二级联动必须仍是两个 select（搜索是增量功能，不能取代下拉）
  {
    const rowStart = tpl.indexOf('class="city-row"');
    const rowEnd = tpl.indexOf('class="city-search"');
    const cityRow = rowStart >= 0 && rowEnd > rowStart ? tpl.slice(rowStart, rowEnd) : '';
    const selCount = (cityRow.match(/<select/g) || []).length;
    selCount === 2
      ? ok('省市联动仍是两个 <select>（搜索为增量功能）')
      : fail('省市联动仍是两个 <select>（搜索为增量功能）', `.city-row 内有 ${selCount} 个 select`);
  }
  // 搜索必须支持拼音首字母
  hasToken(read('src/data/cities.ts'), 'pinyinInitials')
    ? ok('城市搜索支持拼音首字母（pinyinInitials）')
    : fail('城市搜索支持拼音首字母（pinyinInitials）');
  hasToken(read('src/data/cities.ts'), 'CITY_SEARCH_INDEX')
    ? ok('城市搜索索引存在（CITY_SEARCH_INDEX）')
    : fail('城市搜索索引存在（CITY_SEARCH_INDEX）');
  hasToken(src, '24') && hasToken(src, 'hourly') ? ok('逐时数据源 hourly') : fail('逐时数据源 hourly');
  hasToken(src, 'daily') ? ok('多日数据源 daily') : fail('多日数据源 daily');
  // 视图切换必须复用同一容器（不能两个 v-show 挂同一 ref）
  const stripRefs = (src.match(/ref="stripRef"/g) || []).length;
  stripRefs === 1 ? ok('.w-strip 只有一个 ref 绑定（两种视图复用同一容器）') : fail('.w-strip 只有一个 ref 绑定', `出现 ${stripRefs} 次`);
  // 拖动 composable 契约
  const drag = read('src/composables/useDragScroll.ts');
  const dragMust = ['threshold = 4', 'friction = 0.94', 'scrollLeft', 'wheel', 'shiftKey', 'setPointerCapture'];
  for (const t of dragMust) expectToken('src/composables/useDragScroll.ts', t);
  hasToken(drag, '0.35') ? ok('惯性触发阈值 0.35 px/ms') : fail('惯性触发阈值 0.35 px/ms');
  const css = read('src/style.css');
  const stripCss = src.slice(src.indexOf('<style scoped>'));
  hasToken(stripCss, 'scrollbar-width: none') ? ok('预报条滚动条隐藏 scrollbar-width: none') : fail('预报条滚动条隐藏 scrollbar-width: none');
  stripCss.includes('::-webkit-scrollbar') && stripCss.includes('display: none')
    ? ok('预报条 WebKit 滚动条隐藏')
    : fail('预报条 WebKit 滚动条隐藏');
  const wcCss = stripCss;
  hasToken(wcCss, 'mask-image') ? fail('预报条不得使用 mask-image 边缘渐隐（会裁掉首卡）') : ok('预报条无 mask-image 边缘渐隐');
}

/* ------------------------------------------------------------------ */
/* 4. 日历面板                                                         */
/* ------------------------------------------------------------------ */
section('4. 日历面板契约');
{
  const f = 'src/components/CalendarCard.vue';
  const must = ['cal-panel', 'cal-head', 'cal-nav', 'cal-week', 'cal-grid', 'cal-cell',
    'cal-extra', 'cal-lunar-text', 'cal-legend', 'dot', 'lu', 'dim', 'today', 'sel', 'fest', 'off', 'work'];
  for (const t of must) expectTplToken(f, t);
  hasToken(read(f), 'cal-nav today') ? ok('「今」回到今天按钮 .cal-nav.today') : fail('「今」回到今天按钮 .cal-nav.today');
  const cal = read('src/stores/calendar.ts');
  hasToken(cal, "['日', '一', '二', '三', '四', '五', '六']") ? ok('周标题周日起始') : fail('周标题周日起始', "WEEKDAYS 必须以 '日' 开头");
  hasToken(cal, 'getHolidaysInRange') ? ok('节假日用 getHolidaysInRange 判定') : fail('节假日用 getHolidaysInRange 判定');
  hasToken(cal, 'isInLieu') ? ok('节假日用 isInLieu 判定调休放假') : fail('节假日用 isInLieu 判定调休放假');
  hasToken(cal, 'getDayDetail') ? ok('节假日用 getDayDetail 判定补班') : fail('节假日用 getDayDetail 判定补班');
  // 禁止用 isHoliday 判定法定假日（语义是「非工作日」，会把普通周末标红）
  // 先剥离注释，避免把「说明为什么不用它」的注释误判为调用
  const calCode = cal.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const bad = calCode.match(/\bisHoliday\s*\(/);
  bad ? fail('不得用 chinese-days 的 isHoliday() 判定法定假日', `发现 ${bad[0]}`) : ok('未使用 chinese-days 的 isHoliday() 判定法定假日');
  const imp = cal.match(/import\s*\{([^}]*)\}\s*from\s*['"]chinese-days['"]/);
  if (imp && /isHoliday/.test(imp[1])) fail('不得从 chinese-days 导入 isHoliday', imp[1]);
  else ok('未从 chinese-days 导入 isHoliday');
  hasToken(cal, 'showLunar') || hasToken(read(f), 'showLunar') ? ok('农历显示受 showLunar 控制') : fail('农历显示受 showLunar 控制');
}

/* ------------------------------------------------------------------ */
/* 5. 新闻面板                                                         */
/* ------------------------------------------------------------------ */
section('5. 新闻面板契约');
{
  const f = 'src/components/NewsCard.vue';
  const must = ['news-panel', 'fest-badge', 'news-list', 'news-item', 'n-idx', 'n-body',
    'n-title', 'n-meta', 'n-time', 'n-sum', 'n-full', 'news-more', 'news-empty', 'open'];
  for (const t of must) expectTplToken(f, t);
  const src = read(f);
  const newsTpl = readTpl(f);
  hasToken(src, 'openSummary') ? ok('摘要展开索引 openSummary（一次只展开一条）') : fail('摘要展开索引 openSummary');
  hasToken(src, 'toggleSummary') ? ok('点击条目切换展开 toggleSummary') : fail('点击条目切换展开 toggleSummary');
  const store = read('src/stores/news.ts');
  hasToken(store, 'slice(0, 3)') ? ok('默认显示 3 条') : fail('默认显示 3 条', 'visibleItems 应为 items.slice(0, 3)');
  // 展开全部后由 .news-list 自身滚动承载，主面板不整体滚动；明显滚动条
  const style = read('src/components/NewsCard.vue');
  (style.includes('.news-list') && /news-list[\s\S]*?overflow-y:\s*auto/.test(style))
    ? ok('.news-list 为自身滚动容器（overflow-y:auto），展开全部时列表区滚动')
    : fail('.news-list 为自身滚动容器', 'NewsCard.vue 样式须让 .news-list overflow-y:auto');
  // R1：不得有播报 UI
  ['news-player', 'n-play', 'playing-bg', 'playAll', 'speakSingle', 'isPlayingAll'].forEach((t) => {
    forbidIn(newsTpl, t, `NewsCard.vue 不得包含 "${t}"（R1 播报红线）`);
  });
  forbidIn(src, 'playAll', 'news store 不含 "playAll"（R1 播报红线）');
  forbidIn(src, 'speakSingle', 'news store 不含 "speakSingle"（R1 播报红线）');
  forbidToken('src/style.css', 'news-player', 'style.css 不含 "news-player"（R1 播报红线）');
  forbidToken('src/style.css', 'n-play', 'style.css 不含 "n-play"（R1 播报红线）');
}

/* ------------------------------------------------------------------ */
/* 6. 设置面板                                                         */
/* ------------------------------------------------------------------ */
section('6. 设置面板契约');
{
  const f = 'src/components/SettingsPanel.vue';
  const tplClasses = ['set-mask', 'set-sheet', 'set-title', 'set-time', 'set-row', 'lbl', 'switch',
    'row-actions', 'expander', 'rem-list', 'rem-item', 'rem-label', 'swatches', 'swatch',
    'more-toggle', 'more-body', 'set-group-title', 'rss-add-row', 'rss-input', 'mini-btn',
    'feed-row', 'feed-url', 'del', 'field-err', 'done-btn'];
  for (const t of tplClasses) expectTplToken(f, t);
  ['showRemList', 'showMore'].forEach((t) => expectToken(f, t));
  const src = read(f);
  hasToken(src, '桌面设置') ? ok('设置面板标题「桌面设置」') : fail('设置面板标题「桌面设置」');
  hasToken(src, '完成') ? ok('「完成」按钮存在') : fail('「完成」按钮存在');
  hasToken(src, '宽度') || hasToken(src, '272px') ? ok('设置面板为窗口内弹层（.set-sheet 272px，非独立窗口）') : warn('未找到 .set-sheet 宽度声明');
  // R3：不得新开设置窗口
  forbidToken('src-tauri/src/main.rs', 'WebviewWindowBuilder', '不得新建独立设置窗口（R3）');
  forbidToken('src-tauri/src/main.rs', 'WebviewWindowBuilder', '不得新建独立设置窗口（R3）');
  // 行序检查（只在 template 内比对，避免命中 script 区的注释）
  const tpl = src.slice(src.indexOf('<template>'), src.indexOf('</template>'));
  const order = ['日历显示农历', '日期显示周/日', '开机自动启动', '便签提醒', '窗口颜色', '更多设置'];
  const pos = order.map((t) => tpl.indexOf(t));
  pos.every((v, i) => v >= 0 && (i === 0 || v > pos[i - 1]))
    ? ok('设置项行序 = 农历 → 周/日 → 开机自启 → 便签提醒 → 窗口颜色 → 更多设置')
    : fail('设置项行序', `位置 ${JSON.stringify(order)} → ${pos.join(', ')}`);
  // R1：设置里不得有播报项
  const setTpl = readTpl(f);
  ['播报内容', '新闻提醒'].forEach((t) => forbidIn(setTpl, t, `设置面板不得出现「${t}」行（R1 播报红线）`));
  ['speakDetail', 'ttsEnabled', 'setSpeakDetail'].forEach((t) => forbidIn(src, t, `设置面板不得包含 "${t}"（R1 播报红线）`));
  forbidToken('src/stores/settings.ts', 'speakDetail', 'settings.ts 不含 "speakDetail"（R1 播报红线）');
  forbidToken('src/stores/settings.ts', 'ttsEnabled', 'settings.ts 不含 "ttsEnabled"（R1 播报红线）');
}

/* ------------------------------------------------------------------ */
/* 7. 皮肤与设计令牌                                                   */
/* ------------------------------------------------------------------ */
section('7. 皮肤与设计令牌契约');
{
  const css = read('src/style.css');
  const tokens = ['--text-primary', '--text-secondary', '--text-muted', '--accent', '--accent-soft',
    '--accent-ink', '--glass-blur', '--glass-blur-sm', '--glass-sat', '--glass-tint',
    '--glass-tint-strong', '--glass-tint-weak', '--glass-border', '--glass-border-weak',
    '--glass-inner-hi', '--glass-shadow', '--glass-shadow-sm', '--line', '--divider', '--border',
    '--control-bg', '--control-bg-hover', '--switch-bg', '--radius-card', '--radius-cell',
    '--radius-control', '--bg1', '--bg2', '--bg-glow', '--festival'];
  for (const t of tokens) {
    new RegExp(`${t}\\s*:`).test(css) ? ok(`令牌 ${t}`) : fail(`令牌 ${t}`, `style.css 中未定义`);
  }
  // 毛玻璃不得降级
  const app = read('src/App.vue');
  const setp = read('src/components/SettingsPanel.vue');
  hasToken(css, 'backdrop-filter') ? ok('style.css 保留 backdrop-filter 毛玻璃（R8）') : fail('style.css 保留 backdrop-filter 毛玻璃（R8）');
  hasToken(css, 'saturate') ? ok('毛玻璃保留 saturate() 增色') : fail('毛玻璃保留 saturate() 增色');
  hasToken(setp, 'backdrop-filter') ? ok('设置弹层保留 backdrop-filter（R8）') : fail('设置弹层保留 backdrop-filter（R8）');
  // 皮肤取值
  ['sunny', 'cloudy', 'rain', 'snow', 'thunder', 'night'].forEach((v) => {
    hasToken(css, `data-weather="${v}"`) ? ok(`天气皮肤 data-weather="${v}"`) : fail(`天气皮肤 data-weather="${v}"`);
  });
  ['chunjie', 'yuanxiao', 'duanwu', 'zhongqiu', 'guoqing', 'jizhe', 'shengdan'].forEach((v) => {
    hasToken(css, `data-festival="${v}"`) ? ok(`节日皮肤 data-festival="${v}"`) : fail(`节日皮肤 data-festival="${v}"`);
  });
  const theme = read('src/stores/theme.ts');
  hasToken(theme, 'isNightTime') ? ok('夜间判定函数 isNightTime 存在') : fail('夜间判定函数 isNightTime 存在');
  hasToken(theme, 'FESTIVALS') ? ok('节日表 FESTIVALS 存在') : fail('节日表 FESTIVALS 存在');
  // 节日皮肤优先级高于窗口配色
  hasToken(app, 'festivalStyle') ? ok('节日皮肤优先于窗口配色（App.vue accentStyle）') : fail('节日皮肤优先于窗口配色');
}

/* ------------------------------------------------------------------ */
/* 8. 后端命令 / 事件 / 配置                                            */
/* ------------------------------------------------------------------ */
section('8. 后端契约');
{
  const main = read('src-tauri/src/main.rs');
  const cmds = ['fetch_weather', 'fetch_news', 'get_settings', 'set_settings', 'validate_rss', 'add_time_reminder', 'invalidate_news_cache'];
  for (const c of cmds) {
    hasToken(main, c) ? ok(`命令已注册：${c}`) : fail(`命令已注册：${c}`);
  }
  const events = ['app-ready', 'refresh-weather', 'open-settings', 'refresh-news', 'weather-reminder', 'tray-refresh', 'tray-settings'];
  for (const e of events) {
    const inMain = hasToken(main, e);
    const inApp = hasToken(read('src/App.vue'), e);
    inMain || inApp ? ok(`事件链路存在：${e}`) : fail(`事件链路存在：${e}`);
  }
  // 定时器周期
  hasToken(main, '1800') ? ok('天气/新闻 30 分钟定时刷新（1800s）') : fail('天气/新闻 30 分钟定时刷新（1800s）');
  const rem = read('src-tauri/src/reminders.rs');
  hasToken(rem, 'from_secs(60)') ? ok('提醒循环每 60 秒') : fail('提醒循环每 60 秒');
  // 配置字段
  const cfg = read('src-tauri/src/config.rs');
  const fields = ['city', 'reminders', 'time_reminders', 'rss_feeds', 'fixed_sources', 'festival_skin_enabled', 'show_lunar', 'show_week_label', 'color_scheme'];
  for (const f of fields) {
    new RegExp(`pub\\s+${f}\\s*:`).test(cfg) ? ok(`配置字段 ${f}`) : fail(`配置字段 ${f}`);
  }
  hasToken(cfg, '#[serde(default, rename_all = "camelCase")]') ? ok('AppSettings 容器级 serde(default) + camelCase（旧配置可加载）') : fail('AppSettings 容器级 serde(default) + camelCase（旧配置可加载）');
  hasToken(cfg, 'REMINDER_MAX: usize = 5') ? ok('REMINDER_MAX = 5') : fail('REMINDER_MAX = 5');
  hasToken(cfg, 'RSS_MAX: usize = 5') ? ok('RSS_MAX = 5') : fail('RSS_MAX = 5');
  // 前端 store 字段一致
  const st = read('src/stores/settings.ts');
  ['showLunar', 'showWeekLabel', 'colorScheme'].forEach((f) => {
    hasToken(st, f) ? ok(`前端设置字段 ${f}`) : fail(`前端设置字段 ${f}`);
  });
  hasToken(st, 'REMINDER_MAX = 5') ? ok('前端 REMINDER_MAX = 5') : fail('前端 REMINDER_MAX = 5');
  hasToken(st, 'RSS_MAX = 5') ? ok('前端 RSS_MAX = 5') : fail('前端 RSS_MAX = 5');
  ['auto', 'blue', 'green', 'orange', 'gray'].forEach((k) => {
    hasToken(st, `key: '${k}'`) ? ok(`配色方案 ${k}`) : fail(`配色方案 ${k}`);
  });
  // 城市表：前后端共用同一份 JSON 单一数据源
  const coord = read('src-tauri/src/weather.rs');
  const citiesFile = json('src/data/cities.json');
  const provinces = citiesFile.provinces || [];
  const allCities = provinces.flatMap((p) => p.cities || []);
  hasToken(st, "from '../data/cities'")
    ? ok('前端省市表从 cities.json 派生')
    : fail('前端省市表从 cities.json 派生', "src/stores/settings.ts 未从 '../data/cities' 导入");
  hasToken(coord, "include_str!(\"../../src/data/cities.json\")")
    ? ok('后端 builtin_coords 读同一份 cities.json')
    : fail('后端 builtin_coords 读同一份 cities.json', 'weather.rs 未 include_str! cities.json');
  hasToken(coord, 'builtin_coords') ? ok('后端 builtin_coords 存在') : fail('后端 builtin_coords 存在');
  provinces.length === 34
    ? ok('省级单位覆盖 34 个')
    : fail('省级单位覆盖 34 个', `实际 ${provinces.length} 个`);
  allCities.length >= 380
    ? ok(`城市坐标已内置 ${allCities.length} 个（前后端共用同一数据源）`)
    : fail('城市坐标已内置（前后端共用同一数据源）', `仅 ${allCities.length} 个`);
  // 城市名全局唯一：重名会导致按城市名查坐标时命中错误省份
  {
    const seen = new Map();
    const dup = [];
    for (const p of provinces) {
      for (const c of p.cities || []) {
        if (seen.has(c.name)) dup.push(`${c.name}（${seen.get(c.name)} / ${p.name}）`);
        else seen.set(c.name, p.name);
      }
    }
    dup.length === 0
      ? ok('城市名全局唯一（按名查坐标不会串省）')
      : fail('城市名全局唯一（按名查坐标不会串省）', `重名：${dup.join('、')}`);
  }
  // 坐标范围合法
  {
    const bad = allCities.filter(
      (c) => !(c.lat >= -90 && c.lat <= 90 && c.lon >= -180 && c.lon <= 180),
    );
    bad.length === 0
      ? ok('全部城市坐标在合法范围内')
      : fail('全部城市坐标在合法范围内', `越界：${bad.map((c) => c.name).join('、')}`);
  }
  // 34 个省级单位的代表城市都必须能查到坐标
  {
    const reps = [
      '北京', '天津', '上海', '重庆', '石家庄', '太原', '呼和浩特', '沈阳', '长春',
      '哈尔滨', '南京', '杭州', '合肥', '福州', '南昌', '济南', '郑州', '武汉', '长沙',
      '广州', '南宁', '海口', '成都', '贵阳', '昆明', '拉萨', '西安', '兰州', '西宁',
      '银川', '乌鲁木齐', '台北', '香港', '澳门',
    ];
    const names = new Set(allCities.map((c) => c.name));
    const missing = reps.filter((r) => !names.has(r));
    missing.length === 0
      ? ok('34 个省级单位均有可查城市')
      : fail('34 个省级单位均有可查城市', `缺少：${missing.join('、')}`);
  }
}

/* ------------------------------------------------------------------ */
/* 9. 托盘契约                                                         */
/* ------------------------------------------------------------------ */
section('9. 托盘契约');
{
  const tray = read('src-tauri/src/tray.rs');
  const must = ['show_menu_on_left_click(false)', 'with_inner_tray_icon', 'show_menu',
    '显示主窗口', '刷新天气', '设置', '退出程序', 'PREFIX_RIGHT', 'tray_action', 'set_menu'];
  for (const t of must) expectToken('src-tauri/src/tray.rs', t);
  hasToken(tray, 'menu_id_maps_to_action') ? ok('托盘映射单元测试保留') : fail('托盘映射单元测试保留');
  hasToken(tray, 'x-show') && hasToken(tray, 'x-quit') ? ok('右键菜单 ID 使用 x- 前缀') : fail('右键菜单 ID 使用 x- 前缀');
  hasToken(tray, 'set_menu(Some(exit_menu.clone())') ? ok('左键弹出后恢复退出菜单') : fail('左键弹出后恢复退出菜单');
}

/* ------------------------------------------------------------------ */
/* 10. 红线校验                                                        */
/* ------------------------------------------------------------------ */
section('10. 红线校验');
{
  const walk = (dir, out = []) => {
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'target' || e.name === 'dist' || e.name === '.git') continue;
      const p = join(dir, e.name);
      e.isDirectory() ? walk(p, out) : out.push(p);
    }
    return out;
  };
  const files = [
    ...walk(join(APP, 'src')),
    ...walk(join(APP, 'src-tauri', 'src')),
    join(APP, 'index.html'),
    join(APP, 'src-tauri', 'tauri.conf.json'),
  ].filter((f) => existsSync(f));

  // R1 语音播报
  const ttsRe = /\btts\b|\btts_|_tts\b|sherpa[-_]?onnx/i;
  const ttsHit = files.filter((f) => ttsRe.test(readFileSync(f, 'utf8')));
  ttsHit.length === 0 ? ok('R1：源码中无 TTS / sherpa-onnx 残留') : fail('R1：源码中无 TTS / sherpa-onnx 残留', ttsHit.join(', '));
  // 配置结构体中不得残留播报字段
  const cfgSrc = read('src-tauri/src/config.rs');
  ['tts_enabled', 'speak_detail'].forEach((f) => {
    new RegExp(`pub\\s+${f}\\s*:`).test(cfgSrc)
      ? fail(`R1：AppSettings 不得包含 ${f}`, `${f} 已回到配置结构体`)
      : ok(`R1：AppSettings 无 ${f}`);
  });
  const audioHit = files.filter((f) => /new Audio\(|speechSynthesis|HTMLMediaElement/.test(readFileSync(f, 'utf8')));
  audioHit.length === 0 ? ok('R1：源码中无音频播放 API') : fail('R1：源码中无音频播放 API', audioHit.join(', '));
  const ttsRes = join(APP, 'src-tauri', 'resources', 'tts');
  existsSync(ttsRes) ? fail('R1：TTS 打包资源目录已删除', ttsRes) : ok('R1：TTS 打包资源目录不存在');
  const conf = json('src-tauri/tauri.conf.json');
  const res = JSON.stringify(conf.bundle?.resources || '');
  /tts/i.test(res) ? fail('R1：tauri.conf.json 不再打包 TTS 资源') : ok('R1：tauri.conf.json 不再打包 TTS 资源');

  // R5 网络请求必须在后端
  const netHit = files.filter((f) => {
    const s = readFileSync(f, 'utf8');
    return /XMLHttpRequest|axios|fetch\(\s*['"`]https?:/i.test(s);
  });
  netHit.length === 0 ? ok('R5：前端未直连网络接口') : fail('R5：前端未直连网络接口', netHit.join(', '));

  // R11 城市表必须由脚本生成，禁止手改生成物
  {
    const gen = join(ROOT, 'scripts', 'gen-city-data.mjs');
    const src = join(ROOT, 'scripts', 'data', 'regions-upstream.json');
    const extra = join(ROOT, 'scripts', 'data', 'regions-extra.json');
    if (!existsSync(gen) || !existsSync(src) || !existsSync(extra)) {
      fail('R11：城市表源数据与生成脚本齐备', '缺少 scripts/gen-city-data.mjs 或 scripts/data/*.json');
    } else {
      // 用生成脚本的逻辑重算一遍，与磁盘上的 cities.json 比对
      const expected = buildCitiesJson(ROOT);
      const actual = readFileSync(join(APP, 'src', 'data', 'cities.json'), 'utf8');
      expected === actual
        ? ok('R11：cities.json 与源数据一致（须用生成脚本产出，禁止手改）')
        : fail('R11：cities.json 与源数据一致（须用生成脚本产出，禁止手改）',
            '内容与 scripts/data 源数据不符，请运行 node scripts/gen-city-data.mjs');
    }
  }

  // R12 拼音首字母字典必须覆盖所有城市用字
  {
    const pyFile = read('src/data/pinyin-initials.ts');
    if (!pyFile) {
      fail('R12：拼音字典覆盖所有城市用字', '缺少 src/data/pinyin-initials.ts');
    } else {
      const dict = new Set(
        [...pyFile.matchAll(/"([^"])":\s*"([^"]*)"/g)].map((m) => m[1]),
      );
      const used = new Set();
      for (const p of json('src/data/cities.json').provinces) {
        for (const ch of p.name) used.add(ch);
        for (const c of p.cities) for (const ch of c.name) used.add(ch);
      }
      const missing = [...used].filter((ch) => !dict.has(ch));
      missing.length === 0
        ? ok(`R12：拼音字典覆盖全部 ${used.size} 个城市用字`)
        : fail('R12：拼音字典覆盖所有城市用字', `缺字：${missing.join('、')}`);
      // 运行时不得直接依赖完整拼音库（体积大）
      const pkg = json('package.json');
      const runtimeDeps = Object.keys(pkg.dependencies || {});
      runtimeDeps.includes('pinyin-pro')
        ? fail('R12：运行时依赖不含完整拼音库', 'pinyin-pro 应为 devDependency（仅生成期使用）')
        : ok('R12：运行时依赖不含完整拼音库');
    }
  }

  // R8 毛玻璃
  const css = read('src/style.css');
  hasToken(css, 'backdrop-filter') ? ok('R8：毛玻璃 backdrop-filter 保留') : fail('R8：毛玻璃 backdrop-filter 保留');

  // 依赖体积红线：不得引入重型依赖
  const pkg = json('package.json');
  const deps = Object.keys(pkg.dependencies || {});
  const heavy = deps.filter((d) => /onnx|tensorflow|whisper|torch|tts|ffmpeg/i.test(d));
  heavy.length === 0 ? ok('R9：未引入重型依赖') : fail('R9：未引入重型依赖', heavy.join(', '));
  const cargo = read('src-tauri/Cargo.toml');
  const heavyRust = [...cargo.matchAll(/^([a-zA-Z0-9_-]+)\s*=/gm)].map((m) => m[1])
    .filter((d) => /onnx|tensorflow|whisper|torch|ort|ffmpeg/i.test(d));
  heavyRust.length === 0 ? ok('R9：Cargo.toml 未引入重型依赖') : fail('R9：Cargo.toml 未引入重型依赖', heavyRust.join(', '));
}

/* ------------------------------------------------------------------ */
/* 结果                                                                */
/* ------------------------------------------------------------------ */
console.log(`\n${'─'.repeat(64)}`);
if (failures.length === 0) {
  console.log(`\x1b[32m\x1b[1m基线校验通过\x1b[0m  ${pass} 项断言全部成立${warns.length ? `（${warns.length} 项提示）` : ''}`);
  process.exit(0);
} else {
  console.log(`\x1b[31m\x1b[1m基线校验失败\x1b[0m  ${pass} 项通过，\x1b[31m${failures.length} 项被破坏\x1b[0m`);
  console.log('\n被破坏的基线项（对照 BASELINE.md 确认是否为有意变更）：');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f.label}${f.detail ? ` — ${f.detail}` : ''}`));
  process.exit(1);
}
