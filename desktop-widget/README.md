# 桌面天气 · 日历 · 新闻小组件

基于 **Tauri 2 + Vue 3 + TypeScript** 的 Windows 桌面常驻小组件，聚合天气、农历日历与新闻。

> ⚠️ **改动前必读 [`../BASELINE.md`](../BASELINE.md)**
> 本文件描述「怎么跑起来」，`../BASELINE.md` 描述「不许改的契约」（功能清单、DOM 类名、交互时序、设计令牌、后端命令与事件、托盘行为）。
> 改动后必须运行 `node ../scripts/check-baseline.mjs` 确认基线未被破坏。

## ✅ 已内置「防白屏」方案

启动白屏的根因是「窗口先显示 → WebView 再加载内容」的时序差。本工程已内置完整解法：

| 手段 | 实现位置 |
|---|---|
| 窗口默认隐藏启动 | `tauri.conf.json` → `"visible": false` |
| 启动背景色（非白块） | `index.html` 内联 `html, body { background: #f4f6f9 }` |
| 首屏关键 CSS 内联 | `index.html` 内联 `#boot` 骨架样式 |
| 首帧渲染完成握手 | 前端 `main.ts` emit `app-ready` → `main.rs` 监听后 `show()` |
| 常驻托盘复用进程 | 关窗 = 隐藏到托盘（`on_window_event`），再次显示即时无白屏 |

启动时序：`后台启动 → 隐藏窗口加载前端 → 首帧完成 → emit(app-ready) → Rust show()`，窗口出现时内容已就绪。

## 功能

- **天气**：Open-Meteo 实时天气 + **24 小时逐时预报 / 未来 7 天预报**（横向拖动浏览，无滚动条），30 分钟自动刷新，失败保留缓存并标注「（缓存）」。
- **省市联动**：覆盖全国 **34 个省级单位、391 个城市**，全部内置经纬度坐标（前后端共用同一份 `src/data/cities.json`，由 `scripts/gen-city-data.mjs` 生成）；另有**城市搜索框**，支持中文名与拼音首字母（如「西双」「xsbn」→「西双版纳」）。
- **天气主题皮肤**（PRD 5.4）：主窗口背景按 WMO 代码 + 白天/夜间自动切换渐变皮肤，毛玻璃分区叠加，`data-weather` 驱动 CSS 变量过渡。
- **节日皮肤**（PRD 5.5）：公历 + 农历混合匹配（春节/元宵/端午/中秋/国庆/记者节/圣诞），节日当天自动叠加专属背景，**优先级高于天气皮肤**（`data-festival` 规则在 CSS 中后置覆盖），顶部显示「XX快乐」角标，可在设置关闭，关闭回退天气主题。
- **日历**：`lunar-javascript` 计算真实农历、节气、节日，标准 7 列月历可切换月份，**节日日期带小圆点标记**。
- **法定节假日 + 调休**（PRD 第 6 节）：接入 [`chinese-days`](https://www.npmjs.com/package/chinese-days)（MIT，数据自动同步国务院公告），日历格标注「休」= 法定假日（红）、「班」= 调休补班日（周末需上班），底部带图例。数据打包进应用，**离线可用**，覆盖 2004–2026。
- **新闻**：RSS 订阅（用户自填，上限 5，后端校验 http/https + 去重）+ 固定源（少数派/36氪/V2EX/HN 逐个开关），默认折叠 3 条 + 查看更多，点击条目展开正文摘要。
- **提醒**：后端定时器每分钟检查，下雨/下雪/降温/恶劣天气 + **多条预设时间提醒**（上限 5 条，每条时间 + 通知是否含详情 + 删除，各自每天最多一次），走系统通知。
- **托盘**：左键弹出工具菜单（显示主窗口 / 刷新天气 / 设置），右键弹出退出菜单（显示主窗口 / ─── / 退出程序）。
- **设置**：**主窗口内毛玻璃弹层**，含省市二级联动、窗口配色、日历农历、日期周/日、天气提醒开关、多条时间提醒、RSS 列表、固定源开关、节日皮肤开关、开机自启，保存到本地 JSON。

> 小组件定位是「瞥一眼」，故**不提供语音播报**：离线神经语音需常驻占用 CPU/内存并打包数十 MB 模型，与小工具的轻量目标冲突。

## 本地运行

前置：安装 [Node.js](https://nodejs.org) 与 [Rust](https://rustup.rs)（含 Windows MSVC 工具链 + WebView2）。

```bash
cd desktop-widget
npm install          # 安装前端依赖
npm run tauri dev    # 开发模式（首次会编译 Rust，较久）
```

打包发布：

```bash
npm run tauri build
```

## 改动与回归（必读）

本项目已建立**基线契约**，目的是保证后续任何改动都不会破坏「原本设定的功能与 UI 页面交互」。

| 文件 | 作用 |
|---|---|
| [`../BASELINE.md`](../BASELINE.md) | **权威契约**：红线清单、窗口/外壳、三个面板的 DOM 与交互、设计令牌、后端命令与事件、托盘行为、改动准入规则、回归自检清单 |
| [`../scripts/check-baseline.mjs`](../scripts/check-baseline.mjs) | 静态校验上述契约是否仍成立（294 项断言），退出码非 0 即为基线破坏 |

### 城市表维护（单一数据源）

省市表**不是手写表**，而是生成物。改城市要走这条链路：

```bash
# 1) 改源数据（上游快照 + 补充）
#    ../scripts/data/regions-upstream.json   行政区划中心点（含经纬度）
#    ../scripts/data/regions-extra.json     上游缺失项（如台湾下级行政区）
# 2) 重新生成
node ../scripts/gen-city-data.mjs
#    → src/data/cities.json            34 省 / 391 城，前后端共用
#    → src/data/pinyin-initials.ts     城市用字的拼音首字母（仅生成期用 pinyin-pro）
```

> ⚠️ **不要直接手改 `src/data/cities.json`** —— 基线红线 R11 会比对生成物与源数据，手改必红。
> 前端 `src/data/cities.ts` 与后端 `src-tauri/src/weather.rs` 都从这一份 JSON 派生，不存在副本漂移。

### 标准改动流程

```bash
# 0) 改动前：读 ../BASELINE.md，确认要动的类名 / 命令 / 字段的既有语义
# 1) 改代码
# 2) 改完先跑基线校验（必须退出码 0）
node ../scripts/check-baseline.mjs

# 3) 类型检查 + 构建 + Rust 测试
npx vue-tsc --noEmit && npm run build
cd src-tauri && cargo test

# 4) 交互回归（需带调试端口启动 dev）
#    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" npm run tauri dev
node ../scripts/cdp-test.mjs
node ../scripts/cdp-city-test.mjs     # 省市联动：34 省 / 391 城
node ../scripts/cdp-search-test.mjs    # 城市搜索：中文名 + 拼音首字母

# 5) 发布
npm run tauri build
```

### 红线（碰了就是回归）

1. 不得引入任何**语音播报 / TTS** 能力
2. 不得恢复**底部状态栏**（footer）
3. 设置必须是**窗口内弹层**，不得新开独立窗口
4. 主窗口宽度**固定 320px**
5. 天气 / 新闻请求必须在 **Rust 后端**
6. 提醒逻辑必须在**后端定时器**
7. 不得硬编码 API Key
8. **毛玻璃**（`backdrop-filter`）不得降级
9. 不得引入重型依赖
10. 同一时刻只能跑一个实例（验证发布版前先杀 dev 实例）

> 若确实需要改变基线内容（例如新增一个 Tab），必须**同时**修改
> `../BASELINE.md`（文字契约）+ `../scripts/check-baseline.mjs`（断言）+ `../PRD.md`（产品描述），三处缺一则校验必红。

## 目录结构（对应 PRD 第 12 节）

```
desktop-widget/
  src/                    # Vue 3 前端
    components/           # WeatherCard / CalendarCard / NewsCard / SettingsPanel
    stores/               # weather / calendar / news / settings / theme (Pinia)
    composables/          # useDragScroll（横向拖动滚动）
    data/                 # 城市数据（生成物，勿手改）
      cities.json         #   34 省 / 391 城，前后端共用
      cities.ts           #   从 JSON 派生 PROVINCES / CITIES / CITY_COORDS
      pinyin-initials.ts  #   城市用字拼音首字母（搜索用）
    App.vue  main.ts  style.css
  src-tauri/              # Rust 后端
    src/
      main.rs             # 入口：插件、托盘、定时器、防白屏握手
      commands.rs         # 前端可调用命令
      weather.rs          # Open-Meteo 请求 + 内置城市坐标表（后端）
      reminders.rs        # 提醒定时器（后端）
      news.rs             # RSS/固定源拉取（后端）
      config.rs           # 本地 JSON 配置
      tray.rs             # 常驻托盘
    tauri.conf.json       # 防白屏核心配置
    capabilities/         # 权限声明

../BASELINE.md            # 功能与 UI 交互基线契约（改动前必读）
../scripts/
  check-baseline.mjs      # 基线契约静态校验（改动后必跑）
  gen-city-data.mjs       # 城市表生成脚本（改城市跑这个）
  lib/city-data.mjs       # 城市表构建逻辑（生成与校验共用）
  data/                   # 城市表源数据（regions-upstream / regions-extra）
  cdp-test.mjs            # CDP 交互回归（拖动 / 视图切换）
  cdp-city-test.mjs       # CDP 省市联动回归
  cdp-search-test.mjs     # CDP 城市搜索回归
  shots.mjs               # 预览截图
  capture.ps1             # Win32 PrintWindow 抓真实窗口
```

> 天气请求、提醒定时器、新闻拉取均在 Rust 后端，前端只负责 UI 与交互（符合 PRD 第 13 节）。
