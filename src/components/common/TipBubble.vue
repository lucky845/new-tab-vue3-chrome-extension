<script setup lang="ts">
/**
 * 单条提示的气泡内容（图标 / 正文 / 动作按钮 / 关闭按钮 / 箭头）。
 * 只负责画，不负责定位与计时——那些在 <TipHost> 与 useTip 队列里。
 */
import { TIP_ICONS, type TipItem } from '@/src/composables/useTip';
import { t } from '@/src/composables/useI18n';

const props = defineProps<{ item: TipItem }>();
const emit = defineEmits<{ close: [] }>();

function runAction(): void {
  const action = props.item.action;
  if (!action) return;
  action.onClick();
  emit('close');
}
</script>

<!-- prettier-ignore -->
<template>
    <span class="dsh-tip__icon" aria-hidden="true">{{ TIP_ICONS[item.type] ?? '' }}</span>
    <span class="dsh-tip__text">{{ item.message }}</span>
    <button
        v-if="item.action"
        type="button"
        class="dsh-tip__action"
        :title="item.action.title"
        @click="runAction"
    >{{ item.action.label }}</button>
    <button
        v-if="item.closable"
        type="button"
        class="dsh-tip__close"
        :aria-label="t('common_close')"
        @click="emit('close')"
    >×</button>
    <span v-if="item.arrow && item.anchor" class="dsh-tip__arrow" />
</template>
