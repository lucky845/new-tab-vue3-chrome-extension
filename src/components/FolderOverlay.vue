<script setup lang="ts">
import { log } from '@/src/lib/log';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { safeOpen } from '@/src/lib/urlSafe';
import { useQuickAccess } from '@/src/composables/useQuickAccess';
import type { QuickAccessNode } from '@/src/lib/defaultSites';
import { quickAccessBridge } from '@/src/composables/useQuickAccessBridge';
import GlassPanel from '@/src/components/common/GlassPanel.vue';
import { useDialog } from '@/src/composables/useDialog';
import { toast } from '@/src/composables/useToast';
import AppIcon from '@/src/components/AppIcon.vue';

/**
 * 文件夹浮层 + 右键菜单 + 拖拽合并（经典脚本 → Vue3 组件）。
 *
 * 迁移边界：只搬 app.js 的「文件夹域」，数据层走 useQuickAccess() 模块级单例。
 * 站点格子仍用命令式 DOM 构建：IconSafe.createIconNode 返回 DOM Node，且 Sortable
 * 直接操纵真实节点 —— 与 QuickAccessBlock.vue 保留分页 DOM 所有权同理，避免和
 * 第三方拖拽库抢节点所有权。Vue 自持外壳、标题/空态与右键菜单。
 */

// ---------- 自持状态 ----------
const folderOpen = ref(false);
const folderIndex = ref<number | null>(null);
const folderTitle = ref('文件夹');
const emptyHintHidden = ref(true);
const dragOut = ref(false);

const gridEl = ref<HTMLElement | null>(null);
const popoverEl = ref<HTMLElement | null>(null);

// 抽屉式布局：每页 9 格（3×3），超出分页而不是把弹层撑长
const FOLDER_PAGE_SIZE = 9;
const folderPage = ref(1);
const folderSites = computed<QuickAccessNode[]>(() => {
  const mgr = manager();
  const idx = folderIndex.value;
  if (idx === null || !mgr) return [];
  const folder = mgr.getSites()[idx];
  return folder && folder.isFolder ? folder.items || [] : [];
});
const folderTotalPages = computed(() => Math.max(1, Math.ceil(folderSites.value.length / FOLDER_PAGE_SIZE)));
const folderPageItems = computed(() => {
  const start = (folderPage.value - 1) * FOLDER_PAGE_SIZE;
  return folderSites.value.slice(start, start + FOLDER_PAGE_SIZE);
});

interface MenuRow {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
  small?: boolean;
}
interface ContextMenuState {
  css: string;
  rows: MenuRow[];
}
const contextMenu = ref<ContextMenuState | null>(null);
const menuCss = computed<string>(() => contextMenu.value?.css ?? '');
const menuRows = computed<MenuRow[]>(() => contextMenu.value?.rows ?? []);

// 逐字迁移 newtab.html:240-254 的静态文案/按钮字符
const EMPTY_HINT_TEXT = '空文件夹 — 点右上角 ＋ 添加，或右键其他快捷方式「移入文件夹」。';
const CLOSE_BTN_TEXT = '✕';

// 文件夹内拖拽运行时句柄
let folderDragSource: HTMLElement | null = null;
let folderDragName: string | null = null;
let menuCloseHandler: ((ev: MouseEvent) => void) | null = null;

function manager(): ReturnType<typeof useQuickAccess> {
  return useQuickAccess();
}
function dialog() {
  return useDialog();
}

/** 每次数据变更后：分页重绘 + Vue 侧网格刷新桥。 */
function renderAndNotify() {
  manager().renderQuickAccess();
  quickAccessBridge().refreshGrid?.();
}

/** 添加/编辑快捷方式弹窗已由 Vue3 QuickAccessDialog.vue 接管，统一走合并桥。 */
function openEditQuickAccessModal(index: number) {
  quickAccessBridge().openEdit?.(index);
}

// ---------- app.js:1645 handleItemMerge(draggedIndex, targetIndex) ----------
async function handleItemMerge(draggedIndex: number, targetIndex: number): Promise<boolean> {
  const mgr = manager();
  const target = mgr?.getNodeByIndex?.(targetIndex);
  if (!mgr || !target) return false;

  let folderName: string | null = null;
  if (!target.isFolder) {
    const dragged = mgr.getNodeByIndex(draggedIndex);
    const suggest = mgr.suggestFolderName([target, dragged].filter((n): n is QuickAccessNode => n != null));
    // 统一对话框替代原生 prompt：校验直接内联提示，不再弹 toast 打断
    const input = await dialog()?.prompt?.('新建文件夹', suggest, {
      confirmText: '创建',
      validate: (value: string) => {
        const check = mgr.validateName(value);
        return check.valid ? null : check.message;
      },
    });
    if (input === null || input === undefined) return false;
    folderName = input;
  }

  const result = await mgr.mergeIntoFolder(draggedIndex, targetIndex, folderName);
  if (!result) return false;

  renderAndNotify();
  toast(target.isFolder ? `已移入「${result.name}」` : `已创建文件夹「${result.name}」`, 'success', 1800);
  return true;
}

// ---------- app.js:1984 createFolderAndMove(siteIndex = null) ----------
async function createFolderAndMove(siteIndex: number | null = null) {
  const mgr = manager();
  const trimmed = await dialog()?.prompt?.('新建文件夹', '', {
    confirmText: '创建',
    validate: (value: string) => {
      const check = mgr.validateName(value);
      return check.valid ? null : check.message;
    },
  });
  if (trimmed === null || trimmed === undefined) return;
  const folder = await mgr.addFolder(trimmed);
  if (siteIndex !== null && siteIndex >= 0) {
    const fi = mgr.getSites().indexOf(folder);
    await mgr.moveSiteToFolder(siteIndex, fi);
  }
  renderAndNotify();
  toast(`已创建文件夹「${trimmed}」`, 'success', 1800);
}

// ---------- app.js:2005 renameQuickFolder(index) ----------
async function renameQuickFolder(index: number) {
  const mgr = manager();
  const folder = mgr?.getSites?.()[index];
  if (!folder || !folder.isFolder) return;
  const trimmed = await dialog()?.prompt?.('重命名文件夹', folder.name, {
    confirmText: '保存',
    validate: (value: string) => {
      const check = mgr.validateName(value);
      return check.valid ? null : check.message;
    },
  });
  if (trimmed === null || trimmed === undefined) return;
  await mgr.renameFolder(index, trimmed);
  renderAndNotify();
  renderFolderOverlay();
}

// ---------- app.js:2024 dissolveQuickFolder(index) ----------
async function dissolveQuickFolder(index: number) {
  const mgr = manager();
  const folder = mgr?.getSites?.()[index];
  if (!folder || !folder.isFolder) return;
  const items = (await mgr.dissolveFolder(index)) || [];
  renderAndNotify();
  closeFolder();
  toast(`已解散文件夹，${items.length} 个站点已回到主面板`, 'success', 2200);
}

// ---------- app.js:2035 moveQuickItemToFolder(siteIndex, folderIndex) ----------
async function moveQuickItemToFolder(siteIndex: number, targetFolderIndex: number) {
  const mgr = manager();
  const ok = await mgr.moveSiteToFolder(siteIndex, targetFolderIndex);
  if (ok) {
    renderAndNotify();
    const folder = mgr.getSites()[targetFolderIndex];
    toast(`已移入「${folder ? folder.name : '文件夹'}」`, 'success', 1800);
  }
}

// ---------- app.js:2046 openFolderOverlay / 2054 closeFolderOverlay ----------
function openFolder(index: number) {
  folderIndex.value = index;
  folderPage.value = 1;
  folderOpen.value = true;
  renderFolderOverlay();
}
function closeFolder() {
  folderOpen.value = false;
  folderIndex.value = null;
  folderPage.value = 1;
}
function goToFolderPage(page: number) {
  folderPage.value = Math.min(Math.max(1, page), folderTotalPages.value);
}

// ---------- 文件夹内容：模板声明式渲染，这里只同步标题/空态 ----------
function renderFolderOverlay() {
  const idx = folderIndex.value;
  if (idx === null) return;
  const folder = manager()?.getNodeByIndex?.(idx);
  if (!folder || !folder.isFolder) {
    closeFolder();
    return;
  }
  folderTitle.value = folder.name;
  emptyHintHidden.value = (folder.items || []).length > 0;
  // 内容变少时把页码收回到有效范围
  folderPage.value = Math.min(folderPage.value, folderTotalPages.value);
  void nextTick(() => {
    if (gridEl.value) initFolderSortable(gridEl.value);
  });
}

/** 打开站点：统一走 UrlSafe，只放行 http(s) + noopener。 */
function openFolderSite(url: string | undefined) {
  if (!url || !safeOpen(url)) {
    log.warn('[快捷访问] 已跳过不支持的地址协议:', url);
  }
}

/** 从文件夹移回主面板。 */
async function removeFromFolder(itemIndex: number) {
  const folderIndexAtClick = folderIndex.value;
  if (folderIndexAtClick === null) return;
  const moved = await manager().moveFromFolderToRoot(folderIndexAtClick, itemIndex);
  renderAndNotify();
  const stillFolder = manager().getNodeByIndex(folderIndexAtClick);
  if (stillFolder && stillFolder.isFolder) {
    folderTitle.value = stillFolder.name;
    emptyHintHidden.value = (stillFolder.items || []).length > 0;
    folderPage.value = Math.min(folderPage.value, Math.max(1, Math.ceil((stillFolder.items || []).length / FOLDER_PAGE_SIZE)));
  } else {
    closeFolder();
  }
  if (moved) toast(`「${moved.name}」已移回主面板`, 'success', 1800);
}

/**
 * 文件夹内部的拖拽（指针事件，和主页同一套思路：拖拽期间一行 DOM 不动）。
 *
 * 旧实现用 SortableJS：它自己搬真实 DOM，再回头让数据按 DOM 顺序重排，
 * 和主页那边是同一类 bug 的来源。这里只做两件事——
 * 跟着指针画一个拖影、松手时用「落在哪个格子 / 是否落在弹层外」解释意图。
 */
const FOLDER_DRAG_THRESHOLD = 4;
let folderDragBound = false;
let folderDragPending: { el: HTMLElement; x: number; y: number; pointerId: number } | null = null;
let folderGhostEl: HTMLElement | null = null;

function folderCellAt(x: number, y: number): HTMLElement | null {
  const element = document.elementFromPoint(x, y);
  const cell = element?.closest?.('.folder-site');
  return cell instanceof HTMLElement ? cell : null;
}

function moveFolderGhost(x: number, y: number): void {
  if (!folderGhostEl) return;
  folderGhostEl.style.left = x + 'px';
  folderGhostEl.style.top = y + 'px';
}

function onFolderPointerMove(event: PointerEvent): void {
  if (!folderDragPending) return;
  if (!folderDragSource) {
    if (Math.hypot(event.clientX - folderDragPending.x, event.clientY - folderDragPending.y) < FOLDER_DRAG_THRESHOLD) {
      return;
    }
    // 越过阈值：进入拖拽态，造拖影
    folderDragSource = folderDragPending.el;
    folderDragName = folderDragSource.querySelector('.folder-site-name')?.textContent?.trim() || null;
    const ghost = folderDragSource.cloneNode(true) as HTMLElement;
    ghost.classList.add('folder-site-ghost');
    ghost.removeAttribute('id');
    folderGhostEl = ghost;
    document.body.appendChild(ghost);
    folderDragSource.classList.add('is-source');
    document.body.classList.add('icon-dragging');
  }
  moveFolderGhost(event.clientX, event.clientY);
  const over = folderCellAt(event.clientX, event.clientY);
  gridEl.value?.querySelectorAll('.folder-site').forEach((el) => {
    el.classList.toggle('merge-target', el === over && el !== folderDragSource);
  });
  // 指针离开弹层 → 提示「拖出文件夹」
  const popover = popoverEl.value;
  if (popover) {
    const r = popover.getBoundingClientRect();
    dragOut.value =
      event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
  }
}

function cleanupFolderDrag(): void {
  window.removeEventListener('pointermove', onFolderPointerMove, true);
  window.removeEventListener('pointerup', onFolderPointerUp, true);
  window.removeEventListener('pointercancel', cancelFolderDrag, true);
  window.removeEventListener('keydown', onFolderKeyDown, true);
  folderDragPending = null;
  folderGhostEl?.remove();
  folderGhostEl = null;
  folderDragSource?.classList.remove('is-source');
  folderDragSource = null;
  folderDragName = null;
  dragOut.value = false;
  gridEl.value?.querySelectorAll('.merge-target').forEach((el) => el.classList.remove('merge-target'));
  document.body.classList.remove('icon-dragging');
}

function cancelFolderDrag(): void {
  cleanupFolderDrag();
}

function onFolderKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') cancelFolderDrag();
}

function onFolderPointerUp(event: PointerEvent): void {
  if (!folderDragPending) return;
  const dragged = folderDragSource;
  const name = folderDragName;
  const popover = popoverEl.value;
  const inside = popover
    ? (() => {
        const r = popover.getBoundingClientRect();
        return !(
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        );
      })()
    : true;
  const overCell = inside ? folderCellAt(event.clientX, event.clientY) : null;
  const cells = Array.from(gridEl.value?.querySelectorAll('.folder-site') || []);
  const from = dragged ? cells.indexOf(dragged) : -1;
  const to = overCell ? cells.indexOf(overCell) : -1;
  cleanupFolderDrag();

  if (!dragged) return;
  if (!inside) {
    if (name) void dropItemOutOfFolder(name);
    return;
  }
  if (from < 0 || to < 0 || from === to) return;
  // 先按新顺序把名字排好，再交给数据层（它按名字重排，不依赖 DOM）
  const names = cells.map((el) => el.querySelector('.folder-site-name')?.textContent?.trim() || '');
  const [moved] = names.splice(from, 1);
  names.splice(to, 0, moved);
  if (folderIndex.value == null) return;
  Promise.resolve(manager().reorderFolderItems(folderIndex.value, names))
    .then(() => renderAndNotify())
    .catch((error: unknown) => log.error('文件夹内排序保存失败:', error));
}

function onFolderPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  const cell = (event.target as HTMLElement | null)?.closest?.('.folder-site');
  if (!(cell instanceof HTMLElement)) return;
  // 点「移出」按钮不算拖拽
  if ((event.target as HTMLElement | null)?.closest?.('.folder-site-remove')) return;
  if (folderDragPending) cleanupFolderDrag();
  folderDragPending = { el: cell, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  window.addEventListener('pointermove', onFolderPointerMove, true);
  window.addEventListener('pointerup', onFolderPointerUp, true);
  window.addEventListener('pointercancel', cancelFolderDrag, true);
  window.addEventListener('keydown', onFolderKeyDown, true);
}

/** 只在挂载时绑一次（格子由 v-for 渲染，事件委托到网格上） */
function bindFolderGrid(grid: HTMLElement): void {
  if (folderDragBound) return;
  folderDragBound = true;
  grid.addEventListener('pointerdown', onFolderPointerDown);
}

function initFolderSortable(grid: HTMLElement) {
  if (!grid || !gridEl.value) return;
  bindFolderGrid(grid);
}

// ---------- app.js:2246 dropItemOutOfFolder(name) ----------
async function dropItemOutOfFolder(name: string) {
  const mgr = manager();
  const fIndex = folderIndex.value;
  if (fIndex == null) return;
  const folder = mgr?.getNodeByIndex?.(fIndex);
  if (!folder || !folder.isFolder) return;
  const itemIndex = (folder.items || []).findIndex((item: QuickAccessNode) => item.name === name);
  if (itemIndex === -1) return;

  await mgr.moveFromFolderToRoot(fIndex, itemIndex);
  closeFolder();
  renderAndNotify();
  toast(`「${name}」已移到主面板`, 'success', 1800);
}

// ---------- app.js:2261 confirmDeleteQuickAccess(index, siteName) ----------
async function confirmDeleteQuickAccess(index: number, siteName: string) {
  const ok = await dialog()?.confirm?.(
    '确认删除',
    `您确定要删除「${siteName}」吗？此操作无法撤销。`,
    { confirmText: '删除', danger: true }
  );
  if (!ok) return;
  await manager().deleteSite(index);
  renderAndNotify();
}

// ---------- app.js:1876 showContextMenu(e, item) ----------
function showContextMenu(e: MouseEvent, item: HTMLElement) {
  e.preventDefault();

  // 旧菜单由 Teleport + contextMenu ref 自持，置空即让 Vue 卸载，无需查 DOM
  contextMenu.value = null;

  const index = parseInt(item.dataset.index ?? '', 10);
  const mgr = manager();
  const site = mgr?.getSites?.()[index];
  if (!site) return;

  const rows: MenuRow[] = [];
  const addMenuRow = (
    label: string,
    onClick: () => void,
    { danger = false, disabled = false, small = false }: { danger?: boolean; disabled?: boolean; small?: boolean } = {}
  ) => {
    rows.push({ label, action: onClick, danger, disabled, small });
  };

  if (site.isFolder) {
    addMenuRow('打开文件夹', () => openFolder(index));
    addMenuRow('重命名文件夹', () => void renameQuickFolder(index));
    addMenuRow('解散文件夹', () => void dissolveQuickFolder(index));
    addMenuRow('删除文件夹', () => void confirmDeleteQuickAccess(index, site.name), { danger: true });
  } else {
    addMenuRow('编辑', () => openEditQuickAccessModal(index));
    addMenuRow('新建文件夹…', () => void createFolderAndMove(index === -1 ? null : index));
    const folders = mgr.getFolders();
    if (folders.length > 0) {
      addMenuRow('移入文件夹', () => {}, { disabled: true });
      folders.forEach((folder: QuickAccessNode, i: number) => {
        addMenuRow(
          '　' + folder.name + '（' + (folder.items || []).length + '）',
          () => void moveQuickItemToFolder(index, i),
          { small: true }
        );
      });
    }
    addMenuRow('删除', () => void confirmDeleteQuickAccess(index, site.name), { danger: true });
  }

  // app.js:1890-1903 菜单容器 cssText + 1967-1968 定位，逐字保留令牌与视口钳制
  const css = [
    'position: fixed',
    'background: var(--glass-popover-fill)',
    '-webkit-backdrop-filter: blur(var(--glass-blur))',
    'backdrop-filter: blur(var(--glass-blur))',
    'border: 1px solid var(--glass-rim)',
    'border-radius: 8px',
    'padding: 6px 0',
    'box-shadow: var(--glass-shadow)',
    'z-index: 10000',
    'min-width: 140px',
    'font-size: 14px',
    'color: var(--text-primary)',
    'left: ' + Math.min(e.clientX, window.innerWidth - 180) + 'px',
    'top: ' + Math.min(e.clientY, window.innerHeight - 200) + 'px',
  ].join('; ') + ';';

  contextMenu.value = { css, rows };
  scheduleMenuClose();
}

// app.js:1971-1977 外部点击关闭（延迟 100ms 注册，避开本次 contextmenu）
function scheduleMenuClose() {
  if (menuCloseHandler) document.removeEventListener('click', menuCloseHandler);
  const handler = (ev: MouseEvent) => {
    const target = ev.target as HTMLElement | null;
    if (!target || !target.closest('.context-menu')) {
      contextMenu.value = null;
      document.removeEventListener('click', handler);
      if (menuCloseHandler === handler) menuCloseHandler = null;
    }
  };
  menuCloseHandler = handler;
  window.setTimeout(() => {
    if (menuCloseHandler === handler && contextMenu.value) {
      document.addEventListener('click', handler);
    }
  }, 100);
}

// app.js:1912-1925 行内 cssText，逐字保留 danger/disabled/small 分支
function rowCss(row: MenuRow): string {
  return [
    'padding: ' + (row.small ? '6px 16px 6px 28px' : '8px 16px'),
    'cursor: ' + (row.disabled ? 'default' : 'pointer'),
    'transition: background-color 0.2s',
    'color: ' + (row.danger
      ? 'var(--color-error)'
      : row.disabled
        ? 'rgb(var(--ink) / calc(0.38 * var(--text-k)))'
        : 'var(--text-primary)'),
    'font-size: ' + (row.small ? '13px' : '14px'),
    'white-space: nowrap',
  ].join('; ') + ';';
}
function onRowOver(e: Event, row: MenuRow) {
  if (row.disabled) return;
  (e.currentTarget as HTMLElement).style.backgroundColor = row.danger
    ? 'rgb(var(--danger) / 0.12)'
    : 'rgb(var(--ink) / calc(0.08 * var(--wash-k)))';
}
function onRowOut(e: Event, row: MenuRow) {
  if (row.disabled) return;
  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
}
function onRowClick(row: MenuRow) {
  if (row.disabled) return;
  contextMenu.value = null; // app.js:1933 menu.remove()
  if (menuCloseHandler) {
    document.removeEventListener('click', menuCloseHandler);
    menuCloseHandler = null;
  }
  row.action();
}

// ---------- app.js:411-433 bindQuickAccessEvents（浮层三键 + 遮罩 + Esc） ----------
function onAddSite() {
  const fi = folderIndex.value;
  closeFolder();
  // 预选文件夹由 openAdd(preselect) 经 QuickAccessDialog 的 v-model 完成，无需伪造 change 事件
  quickAccessBridge().openAdd?.(fi === null ? -1 : fi);
}
function onEscape(e: KeyboardEvent) {
  if (e.key === 'Escape') closeFolder();
}

onMounted(() => {
  // 桥必须合并不能覆盖：弹窗注册 openAdd/openEdit/closeDialog，
  // 网格注册 refreshGrid；本组件只补自己这四个键。
  Object.assign(quickAccessBridge(), { openFolder, closeFolder, handleItemMerge, showContextMenu });
  document.addEventListener('keydown', onEscape);
});

onUnmounted(() => {
  // 只删自己这四个键，保留其它组件注册到同一桥上的方法
  const bridge = quickAccessBridge();
  if (bridge) {
    delete bridge.openFolder;
    delete bridge.closeFolder;
    delete bridge.handleItemMerge;
    delete bridge.showContextMenu;
  }
  cancelFolderDrag();
  if (menuCloseHandler) document.removeEventListener('click', menuCloseHandler);
  menuCloseHandler = null;
  document.removeEventListener('keydown', onEscape);
});
</script>

<template>
    <GlassPanel
        panelId="folder"
        :open="folderOpen"
        variant="folder"
        elementId="folder-overlay"
        @dismiss="closeFolder"
      >
        <div class="folder-popover" ref="popoverEl" :class="{ 'drag-out': dragOut }">
            <div class="folder-popover-header">
                <h3 id="folder-overlay-title">{{ folderTitle }}</h3>
            </div>
            <div id="folder-items-grid" class="folder-items-grid" ref="gridEl">
                <div
                    v-for="(site, i) in folderPageItems"
                    :key="site.id || site.name || i"
                    class="folder-site"
                    :title="site.url"
                    :data-url="site.url"
                    @click="openFolderSite(site.url)"
                >
                    <AppIcon :name="site.name" :url="site.url" :icon="site.icon" />
                    <span class="folder-site-name">{{ site.name }}</span>
                    <button
                        type="button"
                        class="folder-site-remove"
                        title="移出文件夹（回到主面板）"
                        @click.stop="removeFromFolder((folderPage - 1) * 9 + i)"
                    >{{ CLOSE_BTN_TEXT }}</button>
                </div>
                <!-- 与主页同一个「添加」格：第 10 格起另起一页，所以只在当前页未满时出现 -->
                <div
                    v-if="folderPageItems.length < FOLDER_PAGE_SIZE"
                    class="folder-site add-quick-access-btn"
                    title="向文件夹添加"
                    @click="onAddSite"
                >
                    <div class="icon-wrapper" aria-hidden="true">＋</div>
                    <span class="folder-site-name">添加</span>
                </div>
            </div>
            <div v-if="folderTotalPages > 1" class="folder-pager">
                <button class="page-btn prev-btn" :disabled="folderPage === 1" @click="goToFolderPage(folderPage - 1)">‹</button>
                <button
                    v-for="p in folderTotalPages"
                    :key="p"
                    class="page-btn"
                    :class="{ active: p === folderPage }"
                    @click="goToFolderPage(p)"
                >{{ p }}</button>
                <button class="page-btn next-btn" :disabled="folderPage === folderTotalPages" @click="goToFolderPage(folderPage + 1)">›</button>
            </div>
            <p id="folder-empty-hint" class="folder-empty-hint" :class="{ 'u-hidden': emptyHintHidden }">{{ EMPTY_HINT_TEXT }}</p>
        </div>
    </GlassPanel>

    <Teleport to="body">
        <div v-if="contextMenu" class="context-menu" :style="menuCss">
            <div
                v-for="(row, i) in menuRows"
                :key="i"
                :style="rowCss(row)"
                @mouseover="onRowOver($event, row)"
                @mouseout="onRowOut($event, row)"
                @click="onRowClick(row)"
            >{{ row.label }}</div>
        </div>
    </Teleport>
</template>
