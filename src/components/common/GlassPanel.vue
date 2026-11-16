<script setup lang="ts">
/**
 * GlassPanel —— 统一弹窗外壳（通用组件 / L1）
 * --------------------------------------------------------------------
 * 承载三件所有浮层都要做的事：
 *   1. 根 class 按 variant 映射（settings-panel / widget-panel / folder-overlay）
 *   2. panelOriginStyle(panelId) 注入「从点击处长出来」的 CSS 变量
 *   3. open=false → u-hidden 隐藏；点击遮罩自身 → emit('dismiss')
 * 内容层（.settings-content / .widget-content / .folder-popover）与各处 ref 仍由
 * 调用方写在 slot 里，DOM 结构与抽离前完全等价——不打断 popoverEl / scrollEl 测量。
 * 玻璃材质本身由 app.css:801-820 一处统一，本组件不重复写 backdrop-filter。
 */
import { computed } from 'vue';
import { panelOriginStyle, type PanelId } from '@/src/composables/usePanels';

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
</script>

<template>
  <div
    :id="elementId"
    :style="panelOriginStyle(panelId)"
    :class="[rootClass, { 'u-hidden': !open }]"
    @click.self="dismissable && emit('dismiss')"
  >
    <slot />
  </div>
</template>
