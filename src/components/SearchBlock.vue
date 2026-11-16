<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { applyGlass, releaseGlass } from '@/src/lib/glass';
import EngineIcon from '@/src/components/EngineIcon.vue';
import { UrlSafe } from '@/src/lib/urlSafe';
import { useSearch } from '@/src/composables/useSearch';

/**
 * 搜索框。
 *
 * 这里接管的是旧 app.js 的 bindSearchEvents / renderSearchInterface / 历史下拉
 * 三条链路。引擎下拉与历史列表的**视觉**仍由旧 app.css 描述（迁移期间不重画），
 * 但节点的创建、显示、隐藏、键盘交互全部在 Vue 里完成。
 *
 * 与旧实现的差异（都是明确的行为修正）：
 *   - 旧代码用 setTimeout 把「点外部关闭下拉」的监听延后一拍，靠时间差躲开同一
 *     次点击；这里改成判断 event target 是否在容器内，行为确定。
 *   - 旧代码每次展开历史都重建整个列表并重绑事件；这里用 v-for + 响应式数据。
 *   - 旧代码的引擎下拉在 storage 回填后需要手动「补刷一次」，现在是 watch 驱动。
 */

interface Engine {
    name: string;
    url: string;
    icon?: string;
    logo?: string;
    isCustom?: boolean;
}

const keyword = ref('');
const engines = ref<Engine[]>([]);
const history = ref<string[]>([]);
const engineOpen = ref(false);
const historyOpen = ref(false);

/**
 * 历史内搜索：输入关键词时只显示包含关键词的记录（不区分大小写）。
 * 行对象带原始 index —— 过滤后数组的下标不能直接喂给 removeFromHistory。
 */
const historyRows = computed(() => {
    const kw = keyword.value.trim().toLowerCase();
    const rows = history.value.map((entry, index) => ({ entry, index }));
    if (!kw) return rows;
    return rows.filter(row => row.entry.toLowerCase().includes(kw));
});

const barEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);

const searchManager = computed(() => useSearch());

/**
 * 当前引擎。
 *
 * SearchManager 的真实接口是 getSearchEngines() / getCurrentSearchEngine() /
 * setCurrentSearchEngine(name)，引擎**以 name 为键**（不是 id）——
 * 自定义引擎的名字由用户在设置面板里填，天然唯一。
 *
 * 为什么要单独存一份 currentName：manager 是个普通对象，不是响应式数据。
 * 直接 computed 读 mgr.getCurrentSearchEngine() 只在首次求值那一刻成立 ——
 * 引擎是 app.init() 读完 chrome.storage 之后才切换的，那时 computed 已经
 * 缓存了 Baidu（searchEngines[0]），设置里的 Bing 永远显示不出来。
 */
const currentName = ref('');
const currentEngine = computed<Engine | null>(() => {
    return engines.value.find(e => e.name === currentName.value) ?? engines.value[0] ?? null;
});

/**
 * 代码里主动把焦点还给输入框时置位：焦点事件照常发生，但不弹历史下拉。
 * 只活在一次事件循环里 —— 真正的用户点击一定在下一个任务里，不会误吞。
 */
let suppressHistory = false;
function focusInputQuietly(): void {
    suppressHistory = true;
    inputEl.value?.focus({ preventScroll: true });
    setTimeout(() => {
        suppressHistory = false;
    }, 0);
}

function refreshEngines() {
    const mgr = searchManager.value;
    if (!mgr) return;
    const list = mgr.getSearchEngines?.() ?? [];
    engines.value = Array.isArray(list) ? list : [];
}

/** 从 manager 拉一次真值（引擎列表 + 当前选中），storage 回填后必须重跑 */
function syncFromManager() {
    refreshEngines();
    const current: Engine | undefined = searchManager.value?.getCurrentSearchEngine?.();
    if (current?.name) currentName.value = current.name;
}

function refreshHistory() {
    const mgr = searchManager.value;
    if (!mgr) return;
    const list = mgr.getSearchHistory?.() ?? [];
    history.value = Array.isArray(list) ? list : [];
}

/**
 * 提交搜索。
 *
 * 不用 SearchManager.performSearch()：它内部直接 window.open，把「跳哪儿」这件事
 * 埋进了数据层。这里自己拼 URL，好处是能先过一遍协议白名单 —— 自定义引擎的 url
 * 存在 chrome.storage 里、还能从备份文件导入，是**不可信输入**，
 * 不校验就 window.open 等于把 javascript:/data: 交给浏览器执行。
 */
function submit(text?: string) {
    const value = (text ?? keyword.value).trim();
    if (!value) return;
    const mgr = searchManager.value;
    if (!mgr) return;

    mgr.addToHistory?.(value);

    const encoded = encodeURIComponent(value);
    const template: string = currentEngine.value?.url ?? 'https://www.bing.com/search?q=';
    let url = template.includes('%s') ? template.replace('%s', encoded) : template + encoded;

    const ok = UrlSafe.isHttp(url);
    if (!ok) {
        console.warn('[搜索] 引擎地址协议不受支持，回落到默认引擎:', template);
        url = 'https://www.bing.com/search?q=' + encoded;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
    keyword.value = '';
}

/** 引擎下拉的开合（两个下拉的互斥在 toggleEngine 与 onFocusInput 里各自收口） */
function toggleEngineDropdown() {
    engineOpen.value = !engineOpen.value;
}

function pickEngine(name: string) {
    // 选引擎不是「要搜索」：历史下拉要么没开、要么立刻收起，别盖住刚展开的列表
    historyOpen.value = false;
    // setEngine 既改内存又写 chrome.storage：下次打开新标签页还是这个引擎
    void searchManager.value.setEngine(name);
    currentName.value = name;
    engineOpen.value = false;
    // 把焦点还给输入框，但别弹历史 —— 用户刚选完引擎，不是要搜索
    focusInputQuietly();
}

function clearInput() {
    keyword.value = '';
    focusInputQuietly();
}

function clearHistory() {
    searchManager.value?.clearHistory?.();
    history.value = [];
    historyOpen.value = false;
}

function removeHistory(index: number) {
    // 只走 manager 的单条删除：history 与 manager 共享同一数组引用，本地再 splice 会变成双删
    void searchManager.value.removeFromHistory(index).then(() => {
        // 历史内搜索视角下删到没有匹配（或删光）就收起，别让「没有匹配」挂在屏上
        if (historyRows.value.length === 0) historyOpen.value = false;
    });
}

/** 任意 storage 变更都可能是设置/自定义引擎/历史变了，全部重读一遍最省心 */
function onStorageChanged() {
    syncFromManager();
    refreshHistory();
}

/** 打字时进入「历史内搜索」：有匹配的记录就继续显示，没有匹配才收起 */
function onInput() {
    historyOpen.value = historyRows.value.length > 0;
}

function onFocusInput() {
    // 每次聚焦都重读一遍：搜索历史是异步从 chrome.storage 补载的，
    // 首屏那次 refreshHistory() 很可能读到空数组（那时 init() 还没 await 回来）。
    refreshHistory();
    // 点了搜索按钮回来的那次聚焦不算「用户想搜索」，历史不该盖上去
    if (suppressHistory) {
        suppressHistory = false;
        return;
    }
    historyOpen.value = historyRows.value.length > 0;
    // 两个下拉叠在同一条竖线上，同时开着会互相盖住：谁最后出现谁独占
    if (historyOpen.value) engineOpen.value = false;
}

function onDocPointerDown(event: PointerEvent) {
    if (!barEl.value) return;
    const target = event.target as Node;
    if (!barEl.value.contains(target)) {
        engineOpen.value = false;
        historyOpen.value = false;
    }
}

onMounted(() => {
    syncFromManager();
    refreshHistory();
    // 打开新标签页第一件事就是打字：首屏直接聚焦，不弹历史下拉（suppressHistory 会在下一个任务前复位）。
    // 面板打开时由面板自己抢焦点，那时这里已经跑完了，不会互相抢。
    focusInputQuietly();
    document.addEventListener('pointerdown', onDocPointerDown);
    const el = barEl.value;
    if (el)
        // dispersion 归零：圆角处红/蓝通道错位就是那圈彩虹边（同 AppIcon 的注释）
        applyGlass(el, { refraction: 0.5, dispersion: 0, frost: 0 });

    // boot.ts 已在模块加载时调用 useSearch().init()；异步回填由下面的响应式 watch 兜住，
    // 不再用定时器猜时间。
    try {
        chrome.storage.onChanged.addListener(onStorageChanged);
    } catch {
        /* 非扩展环境（本地 http 预览）没有 chrome.storage，忽略 */
    }
});

onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onDocPointerDown);
    try {
        chrome.storage.onChanged.removeListener(onStorageChanged);
    } catch {
        /* 同上 */
    }
    if (barEl.value) releaseGlass(barEl.value);
});

// init() 异步回填（以及设置面板改自定义引擎）都会改到单例的响应式 ref，
// 这里直接 watch 真值源，首屏不等它们，到位了再更新一次即可。
watch(
    [searchManager.value.engines, searchManager.value.currentName, searchManager.value.history],
    () => {
        syncFromManager();
        refreshHistory();
    }
);
</script>

<template>
    <div class="search-container">
        <div ref="barEl" class="search-bar">
            <div id="search-engine-selector" class="search-engine-selector">
                <button
                    id="selected-engine"
                    class="selected-engine"
                    type="button"
                    :aria-expanded="engineOpen"
                    aria-haspopup="listbox"
                    :aria-label="`搜索引擎：${currentEngine?.name ?? ''}`"
                    :title="currentEngine?.name"
                    @click="toggleEngineDropdown"
                >
                    <EngineIcon
                        class="selected-engine-icon"
                        :icon="currentEngine?.icon"
                        :logo="currentEngine?.logo"
                        :name="currentEngine?.name"
                    />
                    <span class="engine-name">{{ currentEngine?.name }}</span>
                </button>

                <div
                    id="search-engine-dropdown"
                    class="search-engine-dropdown"
                    :class="engineOpen ? '' : 'u-hidden'"
                    role="listbox"
                >
                    <button
                        v-for="engine in engines"
                        :key="engine.name"
                        class="engine-option"
                        type="button"
                        role="option"
                        :aria-selected="engine.name === currentEngine?.name"
                        @click="pickEngine(engine.name)"
                    >
                        <EngineIcon
                            class="engine-icon"
                            :icon="engine.icon"
                            :logo="engine.logo"
                            :name="engine.name"
                        />
                        <span>{{ engine.name }}</span>
                    </button>
                </div>
            </div>

            <input
                id="search-input"
                ref="inputEl"
                v-model="keyword"
                class="search-input"
                type="text"
                placeholder="搜索..."
                autocomplete="off"
                @keydown.enter.prevent="submit()"
                @input="onInput"
                @focus="onFocusInput"
            />

            <button
                id="clear-search-btn"
                class="clear-search-btn"
                :class="{ visible: keyword.length > 0 }"
                type="button"
                title="清空"
                aria-label="清空"
                @click="clearInput"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
            <button
                id="search-submit-btn"
                class="search-submit-btn"
                type="button"
                title="搜索"
                aria-label="搜索"
                @click="submit()"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                >
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
            </button>

            <div
                id="search-history-dropdown"
                class="search-history-dropdown"
                :class="historyOpen ? '' : 'u-hidden'"
            >
                <div id="history-items-container">
                    <!-- 两种空态：真的没有记录 vs 历史内搜索没有匹配 -->
                    <div v-if="history.length === 0" class="history-item empty">暂无搜索记录</div>
                    <div
                        v-else-if="historyRows.length === 0"
                        class="history-item empty"
                    >
                        没有匹配「{{ keyword.trim() }}」的记录
                    </div>
                    <div
                        v-for="row in historyRows"
                        :key="row.entry + '-' + row.index"
                        class="history-item"
                    >
                        <span class="history-text" @click="submit(row.entry)">{{ row.entry }}</span>
                        <button
                            class="delete-history-btn"
                            type="button"
                            :aria-label="'删除搜索记录 ' + row.entry"
                            @click.stop="removeHistory(row.index)"
                        >
                            ×
                        </button>
                    </div>
                </div>
                <div id="clear-history-container" class="clear-history-container">
                    <button
                        id="clear-all-history-btn"
                        class="clear-all-history-btn"
                        type="button"
                        @click="clearHistory"
                    >
                        清空搜索记录
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
