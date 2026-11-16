<script setup lang="ts">
/**
 * SideCard —— 左右翼四张迷你卡的外壳（通用组件）
 * --------------------------------------------------------------------
 * 抽离四张卡逐字重复的三件事：
 *   1. v-show=visible(cardId) 的三态显隐
 *   2. 展开按钮：记录 panelOrigin 后 toggle 面板（expandId 被 usePanels 的选择器依赖，必须保留）
 *   3. .side-card-header 结构（标题 + 可选徽标 + 展开按钮）
 * 卡片主体走默认 slot。生成的 DOM 与抽离前逐字等价，CSS / 选择器零改动。
 */
import { useSideCards, type SideCardId } from '@/src/composables/useSideCards';
import { setPanelOriginFromEvent, usePanels } from '@/src/composables/usePanels';

const props = withDefaults(
  defineProps<{
    cardId: SideCardId;
    elementId: string;
    title: string;
    badge?: number | string;
    badgeId?: string;
    expandId: string;
    expandTitle?: string;
  }>(),
  { expandTitle: '打开完整面板' },
);

const { visible } = useSideCards();
const { toggle } = usePanels();

function openPanel(ev: MouseEvent): void {
  setPanelOriginFromEvent(props.cardId, ev);
  toggle(props.cardId);
}
</script>

<!-- prettier-ignore -->
<template>
    <section v-show="visible(cardId)" class="side-card" :id="elementId">
        <header class="side-card-header">
            <h3>{{ title }}<span v-if="badge !== undefined" :id="badgeId" class="side-badge">{{ badge }}</span></h3>
            <button :id="expandId" class="side-expand-btn" :title="expandTitle" @click="openPanel">⤢</button>
        </header>
        <slot />
    </section>
</template>
