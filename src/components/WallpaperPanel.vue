<script setup lang="ts">
import { log } from '@/src/lib/log';
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
 * 打开时机：legacy openWallpaperPanel 在网格为空时首搜 'Nature'（v1.8.1:js/app.js:636-646），
 * 这里用 watch(isOpen) 等价实现；面板按钮接线由主线程收口。
 * 401 处理：legacy onAuthError = () => openSettingsPanel()（v1.8.1:js/app.js:123），挂载时注入
 * open('settings')、卸载时还原 null；legacy 还会回显 Key/天气输入，Vue 设置面板
 * 自持表单状态（回显降级）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { usePanels } from '@/src/composables/usePanels';
import GlassPanel from '@/src/components/common/GlassPanel.vue';
import { resolveFetchUrl } from '@/src/lib/http';
import {
  CATEGORIES,
  LOCAL_LIBRARY_MAX_ENTRIES,
  useWallpaper,
  type WallpaperPhoto,
} from '@/src/composables/useWallpaper';
import { t } from '@/src/composables/useI18n';

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
  setLocalWallpaper,
  savedWallpaperId,
  localLibrary,
  refreshLocalLibrary,
  applyLocalWallpaper,
  removeLocalWallpaper,
  closeWallpaperPanel,
  setAuthErrorHandler,
} = useWallpaper();

/** 跳页输入值（#jump-to-page-input，type=number，校验在 handleJumpSubmit）。 */
const jumpInput = ref('');
const jumpInputEl = ref<HTMLInputElement | null>(null);

// ---------- 本地图片壁纸（v2.1.1） ----------
/** 上传/压缩结果提示（几秒后自动消失，避免常驻占行）。 */
const localMsg = ref('');
const localBusy = ref(false);
/** 右侧内容视图：在线壁纸库 / 本地壁纸（由左侧分类栏切换）。 */
const viewMode = ref<'online' | 'local'>('online');
let localMsgTimer: ReturnType<typeof setTimeout> | null = null;

const activeLocalId = computed(() => {
  const id = savedWallpaperId.value;
  return typeof id === 'string' && id.startsWith('local:') ? id : '';
});
/** 本地库是否已满：影响上传占位文案与容量提示。 */
const localFull = computed(() => localLibrary.value.length >= LOCAL_LIBRARY_MAX_ENTRIES);

/** 库缩略图整块点击：应用该本地壁纸（写五键哨兵直出）。 */
async function onApplyLocal(entryId: string): Promise<void> {
  await applyLocalWallpaper(entryId);
  flashLocalMsg(t('wallpaper_toast_local_applied'));
}

/** × 点击：从库里删除；删的正是当前壁纸会一并撤回随机图。 */
async function onRemoveLocal(entryId: string): Promise<void> {
  await removeLocalWallpaper(entryId);
  await refreshLocalLibrary();
  flashLocalMsg(t('wallpaper_toast_local_removed'));
}

function flashLocalMsg(text: string): void {
  localMsg.value = t(text);
  if (localMsgTimer) clearTimeout(localMsgTimer);
  localMsgTimer = setTimeout(() => (localMsg.value = ''), 3500);
}

async function onLocalFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files && input.files[0];
  // 同名同文件也要能重传：先清 value 再处理
  input.value = '';
  if (!file || localBusy.value) return;
  localBusy.value = true;
  flashLocalMsg(t('wallpaper_toast_processing'));
  const result = await setLocalWallpaper(file);
  if (result.ok) await refreshLocalLibrary();
  localBusy.value = false;
  flashLocalMsg(result.message);
}

/** 左侧「本地壁纸」入口：切到本地视图。 */
function switchToLocal(): void {
  viewMode.value = 'local';
}

/** 分类点击：先回到在线视图，再执行原有分类检索。 */
function selectCategory(category: Parameters<typeof handleCategoryClick>[0]): void {
  viewMode.value = 'online';
  handleCategoryClick(category);
}

onUnmounted(() => {
  if (localMsgTimer) clearTimeout(localMsgTimer);
});

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
  void refreshLocalLibrary();
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
  log.log('已保存并缓存壁纸 (ID: ' + photo.id + ')');
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
  <GlassPanel
    panelId="wallpaper"
    :open="isOpen('wallpaper')"
    variant="settings"
    elementId="wallpaper-panel"
    labelled-by="wallpaper-panel-title"
    :dismissable="false"
    @dismiss="close('wallpaper')"
  >
    <div class="wallpaper-content settings-content">
      <button id="close-wallpaper-btn" class="close-panel-btn" type="button" :title="t('common_close')" :aria-label="t('common_close')" @click="close('wallpaper')">✕</button>
      <div id="wallpaper-categories-sidebar" class="wallpaper-categories-sidebar">
        <div class="wallpaper-categories-scroll">
          <h4>{{ t('wallpaper_categories_title') }}</h4>
          <ul>
            <li
              v-for="category in CATEGORIES"
              :key="category.query"
              :data-category="category.query"
              :class="{ active: activeCategory === category.query }"
              @click="selectCategory(category)"
            >
              {{ t(category.nameKey) }}
            </li>
          </ul>
          <div class="wallpaper-sidebar-divider"></div>
          <button
            class="wallpaper-local-entry"
            :class="{ active: viewMode === 'local' }"
            type="button"
            :disabled="categoryUnsupported"
            :title="categoryUnsupported ? t('wallpaper_category_unsupported_title') : undefined"
            @click="switchToLocal"
          >
            {{ t('wallpaper_local_tab') }}
            <span class="wallpaper-local-entry-count">{{ localLibrary.length }}/{{ LOCAL_LIBRARY_MAX_ENTRIES }}</span>
          </button>
        </div>
      </div>
      <div class="wallpaper-main">
        <div class="wallpaper-header">
          <div class="wallpaper-header-row">
            <h2 id="wallpaper-panel-title">{{ t('wallpaper_panel_title') }}</h2>
            <div class="wallpaper-search-box">
              <input
                type="text"
                id="wallpaper-search-input"
                v-model="wallpaperSearchQuery"
                :placeholder="t('wallpaper_search_placeholder')"
                @keydown.enter="handleSearch"
              />
              <button id="wallpaper-search-btn" @click="handleSearch">{{ t('wallpaper_search') }}</button>
            </div>
          </div>
          <div v-if="localMsg && viewMode === 'local'" class="wallpaper-local-msg">{{ localMsg }}</div>
        </div>
        <p v-if="categoryUnsupported" class="wallpaper-category-hint">
                    {{ t('wallpaper_category_hint') }}
        </p>

        <!-- 本地壁纸视图：主屏式网格 + + 占位上传，删除靠缩略图 hover 的 × -->
        <div v-show="viewMode === 'local'" class="wallpaper-local-view">
          <p class="wallpaper-local-capacity">
            {{ t('wallpaper_local_cap', { n: LOCAL_LIBRARY_MAX_ENTRIES }) }}
            <template v-if="localFull"> · {{ t('wallpaper_local_full_suffix') }}</template>
            <template v-else> · {{ t('wallpaper_local_count', { n: localLibrary.length }) }}</template>
          </p>
          <div class="wallpaper-local-grid">
            <div
              v-for="item in localLibrary"
              :key="item.id"
              class="wallpaper-local-tile"
              :class="{ 'is-active': item.id === activeLocalId }"
              :title="item.name"
              @click="onApplyLocal(item.id)"
            >
              <img :src="item.dataUrl" :alt="item.name" />
              <button
                class="wallpaper-local-tile-remove"
                type="button"
                :title="t('wallpaper_remove_title')"
                :aria-label="t('wallpaper_remove')"
                @click.stop="onRemoveLocal(item.id)"
              >
                ×
              </button>
              <span v-if="item.id === activeLocalId" class="wallpaper-local-tile-badge">{{ t('wallpaper_current') }}</span>
            </div>
            <label
              class="wallpaper-local-tile wallpaper-local-add"
              :class="{ 'u-disabled': localBusy, 'is-full': localFull }"
              :title="localFull ? t('wallpaper_upload_full_title') : t('wallpaper_upload_title')"
            >
              <span class="wallpaper-local-add-plus">+</span>
              <span class="wallpaper-local-add-text">{{ localBusy ? t('wallpaper_processing') : (localFull ? t('wallpaper_replace_earliest') : t('wallpaper_upload')) }}</span>
              <input type="file" accept="image/*" hidden @change="onLocalFile" />
            </label>
          </div>
        </div>

        <!-- 在线壁纸视图 -->
        <div v-show="viewMode === 'online'" class="wallpaper-online-view">
          <div id="wallpaper-grid" class="wallpaper-grid">
            <div v-if="loadFailed" class="wallpaper-empty-hint">
                    {{ t('wallpaper_gallery_failed') }}<br />{{ t('wallpaper_gallery_proxy_hint') }}
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
            <div class="loading-text">{{ t('wallpaper_loading') }}</div>
          </div>
          <div id="wallpaper-pagination" class="wallpaper-pagination">
          <div id="pagination-buttons" class="pagination-buttons">
            <button :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">{{ t('common_prev_page') }}</button>
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
            <button :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">{{ t('common_next_page') }}</button>
          </div>
          <div class="pagination-info">
            <span id="total-results-info">{{ totalResultsInfo }}</span>
            <div class="jump-to-page">
              <span>{{ t('wallpaper_jump_to') }}</span>
              <input
                type="number"
                id="jump-to-page-input"
                ref="jumpInputEl"
                v-model="jumpInput"
                min="1"
                :max="totalPages"
                @keydown.enter="onJumpEnter"
              />
              <span>{{ t('wallpaper_page_unit') }}</span>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  </GlassPanel>
</template>
