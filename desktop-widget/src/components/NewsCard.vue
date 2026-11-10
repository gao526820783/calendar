<script setup lang="ts">
import { computed, ref } from 'vue';
import { useNewsStore } from '../stores/news';
import { useSettingsStore } from '../stores/settings';
import { useThemeStore } from '../stores/theme';

const news = useNewsStore();
const settings = useSettingsStore();
const theme = useThemeStore();

// 节日祝福语（对应原型 .fest-badge）
const festBadge = computed(() =>
  theme.festival && settings.settings.festivalSkinEnabled ? theme.festival.badge : '',
);

// 展开摘要的条目索引（点击标题切换摘要展开/收起）
const openSummary = ref(-1);

function toggleSummary(i: number) {
  openSummary.value = openSummary.value === i ? -1 : i;
}

// 「查看全文」：用系统浏览器打开源站原文
async function openOrigin(url: string) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_url', { url });
  } catch {
    // 浏览器预览或后端不可用时静默忽略
  }
}
</script>

<template>
  <div class="news-panel">
    <!-- 节日祝福语 -->
    <div v-if="festBadge" class="fest-badge">{{ festBadge }}</div>

    <!-- 新闻列表 -->
    <div class="news-list">
      <div
        v-for="(item, i) in news.visibleItems"
        :key="i"
        class="news-item"
        :class="{ open: openSummary === i }"
        @click="toggleSummary(i)"
      >
        <div class="n-idx">{{ i + 1 }}</div>
        <div class="n-body">
          <div class="n-title">{{ item.title }}</div>
          <div class="n-meta">
            <span class="n-time">{{ item.time }}</span>
            <span v-if="item.summary && openSummary !== i" class="n-sum">{{ item.summary.slice(0, 22) }}…</span>
          </div>
          <div v-if="item.summary && openSummary === i" class="n-full">
            <div class="n-full-text">{{ item.summary }}</div>
            <a
              v-if="item.link"
              class="n-origin"
              @click.stop="openOrigin(item.link)"
            >查看全文 →</a>
          </div>
        </div>
      </div>
      <div v-if="news.items.length === 0" class="news-empty">暂无新闻</div>
    </div>

    <div
      v-if="news.items.length > 3"
      class="news-more"
      @click="news.toggleExpand()"
    >{{ news.expanded ? '收起 ▲' : '查看更多 ▼' }}</div>
  </div>
</template>

<style scoped>
.news-panel { display: flex; flex-direction: column; height: 100%; }

/* ===== 新闻列表：自身可滚动，展开全部时内容在列表区内滚动 ===== */
.news-list { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.news-list::-webkit-scrollbar { width: 7px; }
.news-list::-webkit-scrollbar-track { background: transparent; }
.news-list::-webkit-scrollbar-thumb { background: rgba(100, 110, 125, 0.5); border-radius: 6px; }
.news-list::-webkit-scrollbar-thumb:hover { background: rgba(100, 110, 125, 0.7); }
:deep(.widget[data-weather="night"]) .news-list::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.28); }
:deep(.widget[data-weather="night"]) .news-list::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.42); }

/* ===== 节日祝福语 ===== */
.fest-badge {
  font-size: 11px;
  color: var(--accent-ink);
  background: var(--festival);
  border-radius: 8px;
  padding: 4px 9px;
  display: inline-block;
  margin-bottom: 10px;
  align-self: flex-start;
  font-weight: 600;
}

/* ===== 新闻列表 ===== */
.news-item {
  display: flex;
  gap: 10px;
  padding: 11px 8px;
  border-radius: var(--radius-cell);
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
  z-index: 1;
}
.news-item:hover { background: var(--glass-tint-weak); }
.news-item.open { background: var(--glass-tint-weak); }
.news-item + .news-item { border-top: 1px solid var(--divider); }

/* 编号胶囊 */
.n-idx {
  width: 22px; height: 22px;
  flex: none;
  border-radius: 7px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.n-body { flex: 1; min-width: 0; }
.n-title {
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.n-meta {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.n-time { flex: none; white-space: nowrap; }
.n-sum {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.8;
}

/* 展开后的完整摘要 */
.n-full {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-top: 6px;
  padding: 7px 9px;
  border-radius: 8px;
  background: var(--glass-tint-weak);
  border: 1px solid var(--glass-border-weak);
}
.n-full-text { white-space: pre-wrap; word-break: break-word; }
/* 「查看全文」：跳源站原文，阻止冒泡以免折叠条目 */
.n-origin {
  display: inline-block;
  margin-top: 7px;
  font-size: 11px;
  color: var(--accent);
  cursor: pointer;
  user-select: none;
}
.n-origin:hover { opacity: 0.72; text-decoration: underline; }

/* ===== 查看更多 ===== */
.news-more {
  font-size: 12px;
  color: var(--accent);
  text-align: center;
  padding: 10px 0 2px;
  cursor: pointer;
  user-select: none;
}
.news-more:hover { opacity: 0.75; }
.news-empty { font-size: 12px; color: var(--text-muted); padding: 16px 0; text-align: center; }
</style>
