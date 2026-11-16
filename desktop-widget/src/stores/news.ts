import { defineStore } from 'pinia';

export interface NewsItem {
  title: string;
  time: string;
  summary?: string; // 正文摘要（列表展示用）
  link?: string; // 原文链接（「查看全文」跳源站网页）
}

export const useNewsStore = defineStore('news', {
  state: () => ({
    items: [] as NewsItem[],
    visibleCount: 6, // 分页显示条数，点「加载更多」递增
    loading: false, // 正在刷新（供刷新按钮显示转圈/禁用）
  }),
  getters: {
    visibleItems(state): NewsItem[] {
      return state.items.slice(0, state.visibleCount);
    },
    hasMore(state): boolean {
      return state.items.length > state.visibleCount;
    },
  },
  actions: {
    loadMore() {
      this.visibleCount += 6;
    },
    /** 首次加载：复用后端 30 分钟缓存（定时/启动时的默认路径） */
    async fetch() {
      await this.doFetch();
    },
    /** 手动刷新：清后端缓存重新拉取，并重置分页 */
    async refresh() {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('invalidate_news_cache');
      } catch { /* 后端不可用时忽略，仍会重新拉取 */ }
      await this.doFetch();
    },
    async doFetch() {
      const { invoke } = await import('@tauri-apps/api/core');
      // 清空旧数据，重置分页，准备逐块接收
      this.items = [];
      this.visibleCount = 6;
      this.loading = true;
      // 订阅后端的逐源推送：每有一个 RSS 源抓到就渲染一块（不被最慢的源拖住）
      let unlisten: (() => void) | null = null;
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<NewsItem[]>('news-chunk', (e) => {
          this.items = e.payload;
        });
      } catch { /* 浏览器预览环境无事件系统，退回一次性结果 */ }
      try {
        const result = await invoke<NewsItem[]>('fetch_news');
        this.items = result;
      } catch {
        // 后端不可用时使用演示数据
        if (this.items.length === 0) {
          this.items = [
            { title: 'AI 生成视频工具更新：支持更长片段与角色一致性', time: '10 分钟前', summary: '最新版本将单次生成时长提升至数分钟，并引入角色一致性技术，让同一角色在不同镜头中保持外观稳定。' },
            { title: 'Tauri 2 桌面应用开发实践分享', time: '1 小时前', summary: '开发者分享了使用 Tauri 2 构建跨平台桌面应用的实践经验，涵盖系统托盘、自动启动与性能优化等要点。' },
            { title: '南昌今日小雨，未来 2 小时仍有降水，记得带伞', time: '2 小时前', summary: '受弱冷空气影响，南昌今日出现小雨，气象部门预计未来两小时仍有降水，提醒市民外出携带雨具注意路面湿滑。' },
            { title: 'Rust 1.82 发布，性能进一步提升', time: '5 小时前', summary: 'Rust 1.82 正式发布，带来编译性能优化与若干语言特性改进，进一步巩固其在系统编程领域的高性能优势。' },
            { title: '开源社区最新动态汇总', time: '昨天', summary: '本周开源社区活跃，多个知名项目发布重要版本更新，涵盖开发工具、框架与基础设施等多个方向。' },
          ];
        }
      } finally {
        // 一次性结果已到位，取消逐块订阅
        if (unlisten) unlisten();
        this.loading = false;
      }
    },
    toggleExpand() {
      this.visibleCount = this.visibleCount >= this.items.length ? 6 : this.items.length;
    },
  },
});
