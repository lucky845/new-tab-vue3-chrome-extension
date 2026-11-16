<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import {
    destroyIconDrag,
    onIconDragStart,
    onIconDrop,
    onIconHover,
    shouldSuppressIconClick,
    startIconDrag,
} from '@/src/composables/useIconDrag';
import { UrlSafe } from '@/src/lib/urlSafe';
import { useQuickAccess } from '@/src/composables/useQuickAccess';
import type { QuickAccessNode } from '@/src/lib/defaultSites';
import { applyGlass } from '@/src/lib/glass';
import { quickAccessBridge } from '@/src/composables/useQuickAccessBridge';
import AppIcon from '@/src/components/AppIcon.vue';
import IconDragGhost from '@/src/components/IconDragGhost.vue';

/**
 * 快捷访问事件桥统一走 ESM 单例（useQuickAccessBridge.ts）：
 * 本组件只合并注册自己提供的 refreshGrid，不覆盖弹窗/浮层已注册的方法。
 */

const qa = useQuickAccess();
// 分页容量与 CSS 网格列数联动：断点是 5/4/3 列，每页固定两行。
// legacy 固定 10 项/页（5×2）；窄屏 CSS 降到 4/3 列后固定 10 会挤出第三行。
const columnsForWidth = (width: number): number => {
    if (width <= 700) return 3;
    if (width <= 920) return 5; // 两翼隐藏，中间恢复 5 列
    if (width <= 980) return 3;
    if (width <= 1180) return 4;
    return 5;
};
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1440);
const itemsPerPage = computed(() => columnsForWidth(viewportWidth.value) * 2);

const rootEl = ref<HTMLElement | null>(null);
const gridEl = ref<HTMLElement | null>(null);
const ready = ref(false);
const glassEls = new Set<HTMLElement>();
const currentPage = ref(1);
/**
 * 网格里每个格子的稳定身份（Vue key 也用它）。
 * 站点按「名称+URL」，文件夹按「名称+成员」—— 文件夹被拖动时不至于换掉整个预览子树。
 * 渲染期实时取，拖拽快照、动画配对都读同一个函数，三处不会各算一套。
 */
function cellKey(node: QuickAccessNode): string {
    return node.isFolder
        ? `folder:${node.name}:${(node.items || []).map(it => it.name).join(',')}`
        : `site:${node.name}|${node.url ?? ''}`;
}

const renderNonce = ref(0);

const getBridge = () => quickAccessBridge();

const list = computed<QuickAccessNode[]>(() => qa.sites.value);
const totalPages = computed(() => {
    const len = list.value.length;
    const size = itemsPerPage.value;
    const pagesFromItems = Math.ceil(len / size);
    // 条目刚好填满一页时需要第二页来放置添加按钮
    if (len > 0 && len % size === 0) return pagesFromItems + 1;
    return Math.max(pagesFromItems, 1);
});
/**
 * 当前页的条目（模板按它渲染）。
 * shallowRef 而非 ref：pageItems 只是 list（已经是 reactive）的一段切片，
 * 用 deep ref 会把每个节点再包一层 proxy —— 外面拿到的 node 和 sites 里不是同一个对象，
 * 拖拽时 indexOf 找不到来源，换位本身也就成了空操作。
 */
const pageItems = shallowRef<QuickAccessNode[]>([]);
watch(
    [list, currentPage, itemsPerPage, renderNonce],
    () => {
        const startIndex = (currentPage.value - 1) * itemsPerPage.value;
        pageItems.value = list.value.slice(startIndex, startIndex + itemsPerPage.value);
    },
    { immediate: true }
);
const pageButtons = computed(() => {
    const startPage = Math.max(1, currentPage.value - 2);
    const endPage = Math.min(totalPages.value, currentPage.value + 2);
    const out: number[] = [];
    for (let i = startPage; i <= endPage; i += 1) out.push(i);
    return out;
});

const safeHref = (url: string | undefined): string => UrlSafe.href(url || '');

function goToPage(page: number): void {
    if (page < 1 || page > totalPages.value) return;
    currentPage.value = page;
    renderNonce.value += 1;
}
function previousPage(): void {
    if (currentPage.value > 1) goToPage(currentPage.value - 1);
}
function nextPage(): void {
    if (currentPage.value < totalPages.value) goToPage(currentPage.value + 1);
}

const pageStart = (): number => (currentPage.value - 1) * itemsPerPage.value;

// ---------- 事件桥委托（与 app.js:343-373 bindQuickAccessEvents 逐字同构） ----------
function onGridClick(e: MouseEvent): void {
    const target = e.target as Element | null;
    if (!target) return;
    // 拖拽松手后浏览器还会补一次 click：这一次不算点击
    if (shouldSuppressIconClick()) {
        e.preventDefault();
        return;
    }
    if (target.closest('.add-quick-access-btn')) {
        getBridge().openAdd?.();
        return;
    }
    const folder = target.closest<HTMLElement>('.folder-item');
    if (folder) {
        e.preventDefault();
        getBridge().openFolder?.(parseInt(folder.dataset.index || '', 10));
    }
}
function onGridContextMenu(e: MouseEvent): void {
    const target = e.target as Element | null;
    const item = target?.closest<HTMLElement>('.quick-access-item');
    if (item && !item.classList.contains('add-quick-access-btn')) {
        getBridge().showContextMenu?.(e, item);
    }
}

function attachGlass(el: HTMLElement): void {
    if (glassEls.has(el)) return;
    // 液态玻璃只挂在图标方块上：外层格子是布局容器，名称落在壁纸上、不参与玻璃层。
    const square = el.querySelector<HTMLElement>('.icon-square, .icon-wrapper, .folder-preview');
    const target = square || el;
    applyGlass(target, { square: true, radius: 18, specular: 0.5 });
    glassEls.add(target === el ? el : target);
}
function hydrateAll(root?: HTMLElement | null): void {
    const scope = root || gridEl.value;
    if (!scope) return;
    // 玻璃卡是本站的设计语言：格子统一挂库玻璃，图标与文字在卡内按手机 App 的比例摆放。
    scope
        .querySelectorAll<HTMLElement>('.quick-access-item, .add-quick-access-btn')
        .forEach(attachGlass);
    if (scope.matches('.quick-access-item, .add-quick-access-btn')) attachGlass(scope);
}

// ---------- 拖拽：指针事件 + 数据层解释落点（对齐 OopsLauncher 的做法） ----------
// 拖拽期间一行真实 DOM 都不动：只有一个 fixed 拖影跟指针走，松手时用 elementFromPoint 取落点。
// 落点只有两种含义：
//   落在文件夹格 → 把拖起来的那条并进去（③ 拖入文件夹 / ④ 两图标新建文件夹）
//   落在站点格   → 两者交换位置（① / ②）
function nodeIndexOfCell(cell: HTMLElement | null): number {
    const raw = cell?.dataset.nodeIndex;
    if (raw === undefined) return -1;
    const index = parseInt(raw, 10);
    return Number.isInteger(index) ? index : -1;
}

let observer: MutationObserver | null = null;
let hoverEl: HTMLElement | null = null;
/** 拖拽期间挂上去的所有实时标记（原位、可合并提示），任何收尾路径都要清干净 */
function clearLiveMarks(): void {
    const grid = gridEl.value;
    if (!grid) return;
    grid.querySelectorAll('.merge-ready').forEach(el => el.classList.remove('merge-ready'));
    grid.querySelectorAll('.merge-target').forEach(el => el.classList.remove('merge-target'));
    grid.querySelectorAll('.is-source').forEach(el => el.classList.remove('is-source'));
}
/** 悬停在另一个站点上多久才认为「要合并」（文件夹立刻认，站点要停住） */
const MERGE_DWELL_MS = 600;
let hoverSince = 0;

function setHover(cell: HTMLElement | null): void {
    if (!cell) clearLiveMarks();
    if (hoverEl === cell) return;
    hoverEl?.classList.remove('merge-target');
    hoverEl?.classList.remove('merge-ready');
    hoverEl = null;
    hoverSince = cell ? Date.now() : 0;
    if (!cell) return;
    hoverEl = cell;
    hoverEl.classList.add('merge-target');
    hoverEl.classList.remove('merge-ready');
    window.setTimeout(
        () => {
            if (hoverEl === cell && hoverReady(cell)) cell.classList.add('merge-ready');
        },
        cell.dataset.isFolder === 'true' ? 0 : MERGE_DWELL_MS
    );
}

/** 这个落点是否已经「停够了」：文件夹立刻可落，普通格子要停留 MERGE_DWELL_MS */
function hoverReady(cell: HTMLElement | null): boolean {
    if (!cell || cell !== hoverEl) return false;
    if (cell.dataset.isFolder === 'true') return true;
    return Date.now() - hoverSince >= MERGE_DWELL_MS;
}

/**
 * 两个元素对调位置：落点滑到 dragged 原来的格子，dragged 滑到落点原来的格子。
 * 内容立刻变（视觉上就是两个图标对调），位置跟着用 transform 动画过渡过去。
 * 返回的 Promise 在动画结束后 resolve —— 这时候才允许写盘。
 */
function swapWithSlide(
    all: QuickAccessNode[],
    from: number,
    to: number,
    dragged: QuickAccessNode,
    target: QuickAccessNode
): Promise<void> {
    const before = captureCellRects();
    // 顺序：先拍快照 → 改数据 → 等 Vue 把 DOM 换成新顺序 → 再播放「从旧位置滑过来」的动画。
    // 不能在同一次同步里先改数据就马上量 DOM：那时补丁还没跑，量到的还是旧矩形，位移恒为 0。
    const next = all.slice();
    next[from] = target;
    next[to] = dragged;
    qa.setSites(next);
    return nextTick().then(() => playSwapAnimation(before));
}

let pendingDrop: Promise<void> | null = null;

/**
 * 换位后让两个格子「飞」到新位置：Vue 会按 key 复用节点，节点本身瞬移。
 * 这里记下换位前的位置，换位后先反向位移再过渡回 0 —— 视觉上就是滑过去。
 */
function captureCellRects(): Map<string, DOMRect> {
    const map = new Map<string, DOMRect>();
    // 记录的是「此刻这一格装着谁、在哪个位置」。重排后要按同样口径回查，
    // 不能拿位置当身份（index 参与 key 时节点会被整段复用，位置根本不会变）。
    gridEl.value?.querySelectorAll<HTMLElement>('.quick-access-item').forEach(el => {
        const node = pageItems.value[parseInt(el.dataset.index || '', 10) - pageStart()];
        if (node) map.set(cellKey(node), el.getBoundingClientRect());
    });
    return map;
}

const SWAP_MS = 360;
/** 落点滑过来的节奏：先快后慢，和面板展开同一个手感 */
const SWAP_EASING = 'cubic-bezier(0.34, 0.06, 0.2, 1)';

function playSwapAnimation(before: Map<string, DOMRect>): Promise<void> {
    const grid = gridEl.value;
    if (!grid) return Promise.resolve();
    const jobs: Animation[] = [];
    gridEl.value?.querySelectorAll<HTMLElement>('.quick-access-item').forEach(el => {
        const node = pageItems.value[parseInt(el.dataset.index || '', 10) - pageStart()];
        if (!node) return;
        const old = before.get(cellKey(node));
        if (!old) return;
        const now = el.getBoundingClientRect();
        const dx = old.left - now.left;
        const dy = old.top - now.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        try {
            jobs.push(
                el.animate(
                    [
                        { transform: `translate(${dx}px, ${dy}px)` },
                        { transform: 'translate(0, 0)' },
                    ],
                    { duration: SWAP_MS, easing: SWAP_EASING }
                )
            );
        } catch {
            // 极少数环境不支持 WAAPI：跳过动画，位置已经对了
        }
    });
    if (!jobs.length) return Promise.resolve();
    return Promise.allSettled(jobs.map(job => job.finished)).then(() => undefined);
}

/** 松手：把「拖到哪」交给数据层去解释 */
async function onDrop(dragged: QuickAccessNode, targetCell: HTMLElement): Promise<void> {
    // 上一次交接的滑动还没走完就开始新一次拖拽：顺序以最后一次为准，先前那次不再写盘
    if (pendingDrop) await pendingDrop.catch(() => undefined);
    const targetIndex = nodeIndexOfCell(targetCell);
    if (targetIndex < 0) return;
    const all = qa.getSites();
    const from = all.indexOf(dragged);
    if (from < 0 || from === targetIndex) return;
    const target = all[targetIndex];
    if (!target) return;

    if (!hoverReady(targetCell)) {
        // 没停够：落点自己滑到这个格子来，拖起来的那条滑到落点原来的位置（0.36s）。
        // 动画结束前不写盘，否则列表先重排、动画就没了；期间连拖由 pendingDrop 挡住。
        pendingDrop = (async () => {
            await swapWithSlide(all, from, targetIndex, dragged, target);
            await qa.saveSites();
        })();
        try {
            await pendingDrop;
        } finally {
            pendingDrop = null;
        }
        return;
    }
    // 停够了：并进文件夹 / 两个站点合并成新文件夹，都交给同一条链路
    const bridge = getBridge();
    if (bridge.handleItemMerge) {
        await Promise.resolve(bridge.handleItemMerge(from, targetIndex));
    } else {
        await qa.mergeIntoFolder(from, targetIndex, null);
    }
}

/** 按下登记候选；位移超过 4px 才开始真正的拖拽（单击不受影响） */
function onItemPointerDown(node: QuickAccessNode, event: PointerEvent): void {
    startIconDrag(node, event);
}

// ---------- 事件桥委托（与 app.js:343-373 bindQuickAccessEvents 逐字同构） ----------
// ---------- 桥方法：外部改完数据后强制按数据重绘 ----------
function refreshGrid(): void {
    const max = totalPages.value;
    if (currentPage.value > max) currentPage.value = max;
    renderNonce.value += 1;
    void nextTick(() => {
        hydrateAll();
    });
}

function setupObserver(): void {
    const grid = gridEl.value;
    if (!grid) return;
    observer = new MutationObserver(records => {
        for (const rec of records) {
            rec.addedNodes.forEach(node => {
                if (!(node instanceof HTMLElement)) return;
                if (node.matches('.quick-access-item, .add-quick-access-btn')) attachGlass(node);
                node.querySelectorAll<HTMLElement>(
                    '.quick-access-item, .add-quick-access-btn'
                ).forEach(attachGlass);
            });
        }
    });
    observer.observe(grid, { childList: true, subtree: true });
}

watch(totalPages, max => {
    if (currentPage.value > max) currentPage.value = max;
});

function updatePageSize(): void {
    viewportWidth.value = typeof window !== 'undefined' ? window.innerWidth : 1440;
}

onMounted(async () => {
    Object.assign(getBridge(), { refreshGrid });
    // 拖拽层通过回调把「拖到哪」交回来，自己不认识快捷访问的数据结构
    onIconDrop((node, cell) => {
        void onDrop(node, cell);
    });
    onIconHover(setHover);
    // 拖拽真正开始：原位格子淡下去当占位（拖影是独立层，原格子不跟手）
    onIconDragStart(node => {
        clearLiveMarks();
        // 按业务身份找格子：data-node-index 是整表下标，换页/重排之间会变
        const cell = [
            ...(gridEl.value?.querySelectorAll<HTMLElement>('.quick-access-item') || []),
        ].find(it => it.querySelector('.name')?.textContent === node.name);
        cell?.classList.add('is-source');
    });
    window.addEventListener('pointerup', clearLiveMarks, true);
    updatePageSize();
    window.addEventListener('resize', updatePageSize);
    await qa.init();
    ready.value = true;
    await nextTick();
    hydrateAll();
    setupObserver();
});

onBeforeUnmount(() => {
    window.removeEventListener('pointerup', clearLiveMarks, true);
    destroyIconDrag();
    setHover(null);
    window.removeEventListener('resize', updatePageSize);
    observer?.disconnect();
    observer = null;
    const bridge = getBridge();
    if (bridge.refreshGrid === refreshGrid) delete bridge.refreshGrid;
});
</script>

<template>
    <div
        id="quick-access-grid"
        class="quick-access-grid"
        ref="rootEl"
        @click="onGridClick"
        @contextmenu="onGridContextMenu"
    >
        <IconDragGhost />
        <div class="advanced-pagination" v-if="ready">
            <div class="current-page-container">
                <div class="quick-access-grid" ref="gridEl">
                    <template v-for="(node, i) in pageItems" :key="cellKey(node)">
                        <div
                            v-if="node.isFolder"
                            class="quick-access-item folder-item"
                            :data-index="pageStart() + i"
                            :data-node-index="pageStart() + i"
                            :data-drag-cell="true"
                            data-is-folder="true"
                            :data-page="currentPage"
                            :title="node.name"
                            @pointerdown="onItemPointerDown(node, $event)"
                        >
                            <div class="folder-preview">
                                <!-- 手机文件夹风格：预览格按实际图标数渲染（上限 4），不足不补空占位 -->
                                <AppIcon
                                    v-for="(item, i) in (node.items || []).slice(0, 4)"
                                    :key="i"
                                    class="folder-cell"
                                    :name="item.name"
                                    :url="item.url"
                                    :icon="item.icon"
                                    :glass="false"
                                    :upper="false"
                                />
                            </div>
                            <span class="name">{{ node.name }}</span>
                        </div>
                        <a
                            v-else
                            class="quick-access-item"
                            :href="safeHref(node.url)"
                            target="_blank"
                            rel="noopener noreferrer"
                            :data-index="pageStart() + i"
                            :data-node-index="pageStart() + i"
                            :data-item-id="node.id || pageStart() + i"
                            :data-drag-cell="true"
                            :data-page="currentPage"
                            :draggable="false"
                            @pointerdown="onItemPointerDown(node, $event)"
                        >
                            <AppIcon :name="node.name" :url="node.url" :icon="node.icon" />
                            <span class="name">{{ node.name }}</span>
                        </a>
                    </template>
                    <div
                        v-if="pageItems.length < itemsPerPage"
                        class="add-quick-access-btn"
                        title="添加快捷方式"
                    >
                        <div class="icon-wrapper">＋</div>
                        <span class="name">添加</span>
                    </div>
                </div>
            </div>
            <!-- 只有一页时不渲染：‹ 1 › 会暗示「后面还有」，而点击又没反应 -->
            <div v-if="totalPages > 1" class="pagination-controls">
                <button
                    class="page-btn prev-btn"
                    :disabled="currentPage === 1"
                    @click="previousPage"
                >
                    ‹
                </button>
                <button
                    v-for="p in pageButtons"
                    :key="p"
                    class="page-btn"
                    :class="{ active: p === currentPage }"
                    @click="goToPage(p)"
                >
                    {{ p }}
                </button>
                <button
                    class="page-btn next-btn"
                    :disabled="currentPage === totalPages"
                    @click="nextPage"
                >
                    ›
                </button>
            </div>
        </div>
    </div>
</template>
