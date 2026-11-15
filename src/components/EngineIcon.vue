<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { IconSafe, firstCharOf, isDataImage } from '@/src/lib/iconSafe';

/**
 * 搜索引擎图标：logo 图 / 品牌 SVG / 首字兜底，三选一（互斥分支，任何时刻只有一个节点）。
 *
 * 优先级：logo（用户裁的图 > 站点 favicon，两者都是 data URL，由 useSearch 合成）
 * > 品牌 SVG（内置引擎自带）> 名字首字。
 *
 * 之前 SVG 走命令式 replaceChildren、logo 走模板 v-if，两支抢同一个槽位，渲染
 * 时序一乱就空白；现在写死成 v-if / v-else-if / v-else，就不会再出现空槽。
 */
const props = withDefaults(
    defineProps<{
        /** 内置引擎的品牌 SVG；没有 logo 时才显示 */
        icon?: string;
        /** 用户在设置里裁的图，或从站点抓的 favicon（data URL） */
        logo?: string;
        /** 两者都没有时的首字来源 */
        name?: string;
    }>(),
    { icon: '', logo: '', name: '' },
);

const svgText = computed(() => (props.icon || '').trim());
const isSvg = computed(() => svgText.value.toLowerCase().startsWith('<svg'));
/** 有 logo 就用 logo；logo 是 data:image 才认（远程地址一律不收） */
const logoSrc = computed(() => (isDataImage(props.logo) ? props.logo.trim() : ''));
const showSvg = computed(() => !logoSrc.value && isSvg.value);
const fallbackChar = computed(() => firstCharOf(props.name));

/** SVG 节点由 IconSafe 逐节点重建后挂进占位 span（v-html 不能用于用户输入） */
const svgHost = ref<HTMLElement | null>(null);

function mountSvg(): void {
    const host = svgHost.value;
    if (!host) return;
    host.replaceChildren();
    if (!showSvg.value) return;
    const node = IconSafe.createIconNode(svgText.value);
    if (node) host.appendChild(node);
}

onMounted(mountSvg);
watch([svgText, showSvg], () => void nextTick(mountSvg));
</script>

<template>
    <span class="engine-icon-slot">
        <!-- 用户裁好的 logo / 站点 favicon -->
        <img v-if="logoSrc" class="engine-logo" :src="logoSrc" alt="" draggable="false" />
        <!-- 内置引擎的品牌 SVG -->
        <span v-else-if="showSvg" ref="svgHost" class="engine-svg"></span>
        <!-- 首字 -->
        <span v-else class="engine-fallback">{{ fallbackChar }}</span>
    </span>
</template>

<style scoped>
/* 槽位尺寸由使用方决定（搜索框 22px、下拉 18px、设置列表 26px）：
   这里只负责「图/字居中且不出框」，尺寸通过 --engine-icon-size 传进来 */
.engine-icon-slot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--engine-icon-size, 22px);
    height: var(--engine-icon-size, 22px);
    flex: 0 0 var(--engine-icon-size, 22px);
    line-height: 0;
    overflow: hidden;
}

.engine-logo {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
    border-radius: 22%;
}

.engine-svg,
.engine-svg :deep(svg) {
    width: 100%;
    height: 100%;
    display: block;
}

.engine-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    border-radius: 22%;
    background-color: rgb(var(--ink) / calc(0.16 * var(--wash-k)));
    color: var(--text-primary);
    font-size: calc(var(--engine-icon-size, 22px) * 0.56);
    font-weight: 600;
    line-height: 1;
    user-select: none;
}
</style>
