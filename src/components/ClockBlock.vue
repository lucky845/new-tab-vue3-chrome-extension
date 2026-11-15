<script setup lang="ts">
import { computed } from 'vue';
import { useClock } from '@/src/lib/use-clock';
import { useStored } from '@/src/lib/storage';

/**
 * 时钟块。
 *
 * 标语（tagline）存在 settings.tagline（设置面板写入）；经 useStored 响应式读取，
 * 设置保存后立即生效，无需刷新。壁纸域整体移交 Vue（useWallpaper）后，
 * 标语不再依赖壁纸管理器实例。
 */
const { time, date, greeting } = useClock();
const settings = useStored<Record<string, unknown>>('settings', {});
const tagline = computed(() => String((settings.value as { tagline?: unknown })?.tagline ?? ''));
</script>

<template>
    <section class="clock-container" aria-label="时钟">
        <div id="clock-time" class="clock-time">{{ time }}</div>
        <div id="clock-date" class="clock-date">{{ date }}</div>
        <div id="clock-greeting" class="clock-greeting">{{ greeting }}</div>
        <div id="tagline" class="tagline">{{ tagline }}</div>
    </section>
</template>
