<script setup lang="ts">
/**
 * 全局 Toast 宿主 —— 队列的唯一渲染出口。
 * 常驻 Teleport 到 body：层级独立于面板，样式真源在 app.css 的 .dsh-tip 族。
 * 锚定提示（attachTip）不走这里——那些要定位/翻转，留在 useTip.ts。
 */
import { useToastQueue, type ToastType } from '@/src/composables/useToast';

const { items } = useToastQueue();

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'i',
  loading: '◌',
};
</script>

<template>
  <Teleport to="body">
    <TransitionGroup name="toast" tag="div" class="dsh-tip-toasts" aria-live="polite">
      <div
        v-for="item in items"
        :key="item.id"
        class="dsh-tip"
        :class="['dsh-tip--' + item.type, 'dsh-tip--visible']"
        :role="item.type === 'error' ? 'alert' : 'status'"
      >
        <span class="dsh-tip__icon" aria-hidden="true">{{ ICONS[item.type] }}</span>
        <span class="dsh-tip__text">{{ item.message }}</span>
      </div>
    </TransitionGroup>
  </Teleport>
</template>
