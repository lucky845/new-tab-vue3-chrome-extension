<script setup lang="ts">
/**
 * 锚定提示的渲染出口 —— useTip 队列的唯一消费者。
 * 常驻 Teleport 到 body：定位是 fixed，层级独立于面板。
 * 队列只存数据；这里负责量尺寸、算位置、跟随滚动/缩放/尺寸变化，
 * 以及悬停暂停计时（closable || action 的提示才需要）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue';
import {
  closeTipByKey,
  computePosition,
  pauseTip,
  resumeTip,
  useTipQueue,
  type TipItem,
} from '@/src/composables/useTip';
import TipBubble from '@/src/components/common/TipBubble.vue';

const { items } = useTipQueue();
// attachTip 必须给锚点（无锚点提示走 ToastHost 的 toast 队列），所以这里只接锚定提示。
// 不另建 .dsh-tip-toasts 容器：那类名归 ToastHost，两个 fixed 容器会互相叠住。
const anchored = computed(() => items.filter((t) => t.anchor));

/** 已挂载的根节点：定位要量 offsetWidth/offsetHeight */
const els = new Map<number, HTMLElement>();

function setEl(id: number, el: unknown): void {
  if (el instanceof HTMLElement) els.set(id, el);
  else els.delete(id);
}

function positionOne(item: TipItem): void {
  const el = els.get(item.id);
  const anchor = item.anchor;
  if (!el || !anchor || !anchor.isConnected) return;
  const p = computePosition(
    anchor.getBoundingClientRect(),
    el.offsetWidth,
    el.offsetHeight,
    item.placement,
  );
  el.style.top = p.top + 'px';
  el.style.left = p.left + 'px';
  el.dataset.dshTipPlacement = p.placement;
  const arrow = el.querySelector<HTMLElement>('.dsh-tip__arrow');
  if (arrow) {
    arrow.style.left = p.arrowX + 'px';
    arrow.style.top = p.arrowY + 'px';
  }
}

function positionAll(): void {
  for (const item of items) if (item.anchor) positionOne(item);
}

async function positionAfterRender(): Promise<void> {
  await nextTick();
  syncObserver();
  positionAll();
}

let observer: ResizeObserver | null = null;

function syncObserver(): void {
  if (typeof ResizeObserver === 'undefined') return;
  observer ??= new ResizeObserver(() => positionAll());
  observer.disconnect();
  for (const item of items) {
    const el = els.get(item.id);
    if (el) observer.observe(el);
    if (item.anchor) observer.observe(item.anchor);
  }
}

watch(
  () => items.map((t) => t.id + (t.visible ? '+' : '-')).join(','),
  () => {
    void positionAfterRender();
  },
);

const onViewportChange = (): void => positionAll();

/** 关闭按钮：走按 key 关闭，同 key 的其他提示一并收起（与原实现一致） */
function closeOne(item: TipItem): void {
  closeTipByKey(item.key);
}

function onEnter(item: TipItem): void {
  pauseTip(item.id);
}

function onLeave(item: TipItem): void {
  resumeTip(item.id);
}

onMounted(() => {
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);
  void positionAfterRender();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange, true);
  observer?.disconnect();
  observer = null;
  els.clear();
});
</script>

<!-- prettier-ignore -->
<template>
    <Teleport to="body">
        <div
            v-for="item in anchored"
            :key="item.id"
            :ref="(el) => setEl(item.id, el)"
            class="dsh-tip"
            :class="['dsh-tip--' + item.type, { 'dsh-tip--visible': item.visible }]"
            :role="item.type === 'error' ? 'alert' : 'status'"
            @mouseenter="onEnter(item)"
            @mouseleave="onLeave(item)"
        >
            <TipBubble :item="item" @close="closeOne(item)" />
        </div>
    </Teleport>
</template>
