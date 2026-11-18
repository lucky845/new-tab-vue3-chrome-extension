<script setup lang="ts">
/**
 * GlassPanel —— 统一弹窗外壳（通用组件 / L1）
 * --------------------------------------------------------------------
 * 承载三件所有浮层都要做的事：
 *   1. 根 class 按 variant 映射（settings-panel / widget-panel / folder-overlay）
 *   2. panelOriginStyle(panelId) 注入「从点击处长出来」的 CSS 变量
 *   3. open=false → u-hidden 隐藏；点击遮罩自身 / 按 Esc → emit('dismiss')
 * 内容层（.settings-content / .widget-content / .folder-popover）与各处 ref 仍由
 * 调用方写在 slot 里，DOM 结构与抽离前完全等价——不打断 popoverEl / scrollEl 测量。
 * 玻璃材质本身由 app.css:801-820 一处统一，本组件不重复写 backdrop-filter。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { panelOriginStyle, type PanelId } from '@/src/composables/usePanels';
import { registerEscapeTarget } from '@/src/composables/useEscapeClose';
import { ESCAPE_Z_BY_VARIANT } from '@/src/lib/escapeClose';
import { registerFocusTrap } from '@/src/composables/useFocusTrap';

const props = withDefaults(
  defineProps<{
    /** 面板身份，决定 --panel-origin-* 动画原点 */
    panelId: PanelId;
    /** 是否展示；false 时挂 u-hidden */
    open: boolean;
    /** 根容器形态，默认 settings 风格 */
    variant?: 'settings' | 'widget' | 'folder';
    /** 保留原 DOM id，供外部 querySelector / 测试定位 */
    elementId?: string;
    /** 点击遮罩是否触发 dismiss（壁纸/天气面板原本就不关，传 false） */
    dismissable?: boolean;
    /** 面板标题元素的 id：提供后根节点用 aria-labelledby 指过去，屏幕阅读器念得出面板名 */
    labelledBy?: string;
  }>(),
  { variant: 'settings', dismissable: true },
);

const emit = defineEmits<{ dismiss: [] }>();

const rootClass = computed(() =>
  props.variant === 'widget'
    ? 'widget-panel'
    : props.variant === 'folder'
      ? 'folder-overlay'
      : 'settings-panel',
);

/**
 * Esc 关闭：外壳统一登记，调用方已有的 @dismiss 全部自动生效。
 *
 * 为什么不在各个面板里各写一个 keydown：9 个面板各挂一个，按一次 Esc 会关一串；
 * 而层级（谁最靠上、对话框/拖拽是否在抢 Esc）的判断只有集中在一处才做得对。
 * 详见 src/composables/useEscapeClose.ts。
 *
 * 注意 Esc 不受 dismissable 约束：壁纸/天气面板遮罩点击不关（避免误触），
 * 但 Esc 是用户明确的「退出」意图，属于键盘惯性，应当能关。
 */
let unregisterEscape: (() => void) | null = null;
watch(
  () => props.open,
  open => {
    unregisterEscape?.();
    unregisterEscape = null;
    if (!open) return;
    unregisterEscape = registerEscapeTarget(props.panelId, ESCAPE_Z_BY_VARIANT[props.variant], () =>
      emit('dismiss'),
    );
  },
  { immediate: true },
);
/** 面板根节点：焦点陷阱的兜底容器（面板内没有可聚焦元素时落在这里） */
const rootEl = ref<HTMLElement | null>(null);

/** 焦点陷阱：打开时把焦点收进面板、Tab 在面板内循环，关闭时把焦点还给触发元素。
 * 层级与打开顺序复用 Esc 那套登记模型，保证 Tab 和 Esc 关掉的是同一层。 */
let unregisterTrap: (() => void) | null = null;
watch(
  () => props.open,
  open => {
    unregisterTrap?.();
    unregisterTrap = null;
    if (!open || !rootEl.value) return;
    unregisterTrap = registerFocusTrap(props.panelId, ESCAPE_Z_BY_VARIANT[props.variant], rootEl.value);
  },
  { immediate: true },
);
/**
 * 兜底：若组件挂载时 open 已经为 true，setup 阶段的 immediate watch 拿不到 rootEl，
 * 焦点陷阱不会登记。onMounted 时补一次，保证「打开态挂载」也能收焦点。
 */
onMounted(() => {
  if (props.open && rootEl.value) {
    unregisterTrap = registerFocusTrap(props.panelId, ESCAPE_Z_BY_VARIANT[props.variant], rootEl.value);
  }
});
onUnmounted(() => {
  unregisterEscape?.();
  unregisterEscape = null;
  unregisterTrap?.();
  unregisterTrap = null;
});
</script>

<template>
  <div
    :id="elementId"
    :style="panelOriginStyle(panelId)"
    :class="[rootClass, { 'u-hidden': !open }]"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="labelledBy || undefined"
    ref="rootEl"
    tabindex="-1"
    @click.self="dismissable && emit('dismiss')"
  >
    <slot />
  </div>
</template>
