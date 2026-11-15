<script setup lang="ts">
/**
 * 壁纸面板（Vue3 移植）——markup 逐字来自 entrypoints/newtab.html L398-438（#wallpaper-panel）。
 *
 * 允许的改动（映射规则与 TodoPanel.vue 一致）：
 *  - onclick/动态行为 → @click/@keydown.enter；classList toggle → :class；
 *  - 动态插入区（分类/缩略图/页码/loading 显隐）→ v-for/v-if/插值；
 *  - 根元素 u-hidden 由 usePanels 驱动（legacy openWallpaperPanel/closeWallpaperPanel
 *    的 classList.add/remove('u-hidden') 等价物）。根元素是全屏遮罩层（工作面），
 *    不挂 v-glass：库会接管背景与 backdrop-filter，把它改写成全屏折射玻璃盖住按钮
 *    （bug m00309-2）。遮罩层现在完全透明，层级只由 .settings-content 的磨砂玻璃提供。
 *
 * 打开时机：legacy openWallpaperPanel 在网格为空时首搜 'Nature'（app.js L1435-1441），
 * 这里用 watch(isOpen) 等价实现；面板按钮接线由主线程收口。
 * 401 处理：legacy onAuthError = () => openSettingsPanel()（app.js:123），挂载时注入
 * open('settings')、卸载时还原 null；legacy 还会回显 Key/天气输入，Vue 设置面板
 * 自持表单状态（回显降级）。
 */
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { panelOriginStyle, usePanels } from '@/src/composables/usePanels';
import { resolveFetchUrl } from '@/src/lib/http';
import {
  CATEGORIES,
  useWallpaper,
  type WallpaperPhoto,
} from '@/src/composables/useWallpaper';

const { isOpen, open, close } = usePanels();
const {
  photos,
  isSearching,
  loadFailed,
  categoryUnsupported,
  activeCategory,
  wallpaperSearchQuery,
  currentPage,
  totalPages,
  paginationItems,
  totalResultsInfo,
  searchWallpapers,
  handleSearch,
  handleCategoryClick,
  goToPage,
  handleJumpSubmit,
  applyPexelsWallpaper,
  closeWallpaperPanel,
  setAuthErrorHandler,
} = useWallpaper();

/** 跳页输入值（#jump-to-page-input，type=number，校验在 handleJumpSubmit）。 */
const jumpInput = ref('');
const jumpInputEl = ref<HTMLInputElement | null>(null);

// legacy openWallpaperPanel：面板显示且网格为空时首次搜索 'Nature'。
// 失败态也沿用 legacy：占位提示使 childElementCount>0 → 重开不自动重试。
watch(
  () => isOpen('wallpaper'),
  (openNow) => {
    if (openNow && photos.value.length === 0 && !loadFailed.value) {
      void searchWallpapers('Nature', 1);
    }
  }
);

onMounted(() => {
  setAuthErrorHandler(() => open('settings'));
});
onUnmounted(() => {
  setAuthErrorHandler(null);
});

/**
 * 缩略图地址：本地调试开了反代时走同源 /__api/...，<img> 才不会撞 CORS；
 * 生产构建里 resolveFetchUrl 原样返回（DEV_API_PREFIX 恒为 undefined）。
 */
function thumbSrc(url: string): string {
  return resolveFetchUrl(url);
}

/** 缩略图点击（legacy renderWallpaperGrid 的 img onclick）：应用并保存，随后关面板。 */
async function pick(photo: WallpaperPhoto): Promise<void> {
  await applyPexelsWallpaper(photo, true);
  console.log('已保存并缓存壁纸 (ID: ' + photo.id + ')');
  closeWallpaperPanel();
}

/** 跳页 Enter：合法则续搜 + 清空 + blur；非法 toast 由 handleJumpSubmit 负责。 */
async function onJumpEnter(): Promise<void> {
  const ok = await handleJumpSubmit(jumpInput.value);
  if (ok) {
    jumpInput.value = '';
    jumpInputEl.value?.blur();
  }
}
</script>

<template>
  <div
    id="wallpaper-panel"
    :style="panelOriginStyle('wallpaper')"
    class="settings-panel"
    :class="{ 'u-hidden': !isOpen('wallpaper') }"
  >
    <div class="wallpaper-content settings-content">
      <button id="close-wallpaper-btn" class="close-panel-btn" type="button" title="关闭" @click="close('wallpaper')">✕</button>
      <div id="wallpaper-categories-sidebar" class="wallpaper-categories-sidebar">
        <h4>推荐分类</h4>
        <ul>
          <li
            v-for="category in CATEGORIES"
            :key="category.query"
            :data-category="category.query"
            :class="{ active: activeCategory === category.query }"
            @click="handleCategoryClick(category)"
          >
            {{ category.name }}
          </li>
        </ul>
        <p v-if="categoryUnsupported" class="wallpaper-category-hint">
          提示：当前图源不支持按分类筛选，分类将改为浏览模式。到设置里切换为 Wallhaven 可按分类出图。
        </p>
      </div>
      <div class="wallpaper-main">
        <div class="wallpaper-header">
          <h2>壁纸库</h2>
          <div class="wallpaper-search-box">
            <input
              type="text"
              id="wallpaper-search-input"
              v-model="wallpaperSearchQuery"
              placeholder="搜索壁纸，例如 'Forest'"
              @keydown.enter="handleSearch"
            />
            <button id="wallpaper-search-btn" @click="handleSearch">搜索</button>
          </div>
        </div>
        <div id="wallpaper-grid" class="wallpaper-grid">
          <div v-if="loadFailed" class="wallpaper-empty-hint">
            图库加载失败，请检查网络连接后重试。<br />若使用代理，请确认代理节点可用。
          </div>
          <img
            v-for="photo in photos"
            :key="photo.id"
            loading="lazy"
            decoding="async"
            :src="thumbSrc(photo.src.medium)"
            :alt="photo.alt"
            @click="pick(photo)"
          />
        </div>
        <div id="wallpaper-loading" class="wallpaper-loading" :class="{ 'u-hidden': !isSearching }">
          <div class="loading-spinner"></div>
          <div class="loading-text">正在加载壁纸...</div>
        </div>
        <div id="wallpaper-pagination" class="wallpaper-pagination">
          <div id="pagination-buttons" class="pagination-buttons">
            <button :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">上一页</button>
            <template v-for="(item, index) in paginationItems" :key="'page-' + index">
              <span v-if="item.type === 'ellipsis'">...</span>
              <button
                v-else
                :class="{ active: item.value === currentPage }"
                @click="goToPage(item.value)"
              >
                {{ item.value }}
              </button>
            </template>
            <button :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">下一页</button>
          </div>
          <div class="pagination-info">
            <span id="total-results-info">{{ totalResultsInfo }}</span>
            <div class="jump-to-page">
              <span>跳至</span>
              <input
                type="number"
                id="jump-to-page-input"
                ref="jumpInputEl"
                v-model="jumpInput"
                min="1"
                :max="totalPages"
                @keydown.enter="onJumpEnter"
              />
              <span>页</span>
            </div>
          </div>
        </div>
      </div>
      <button id="close-wallpaper-panel-btn" class="close-panel-btn" @click="closeWallpaperPanel">✕</button>
    </div>
  </div>
</template>
