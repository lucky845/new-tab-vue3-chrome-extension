<script setup lang="ts">
/**
 * 右上角侧卡天气展示 —— markup 逐字拷贝自 entrypoints/newtab.html:101-145（#weather-widget side-card 区域）。
 *
 * legacy weather-manager.js 的 DOM 产出映射（weather-manager.js → 本组件）：
 * - #temperature/#weather-desc/#location 文本 ← displayWeather/showError（1151-1191/1388-1432）→ 计算属性
 * - #weather-svg 图标 ← updateWeatherIcon/getWeatherIconSvg（1196-1283）→ watchEffect + createIconNode 安全注入
 *   （legacy 用 innerHTML 直塞，这里走 IconSafe 白名单管线，DOM 产物一致：id="weather-svg" 保留）
 * - .loading/.is-stale ← showLoading/markStale（566-580/1368-1383）→ :class
 * - 点击卡片 500ms 后刷新、点设置按钮不触发刷新 ← bindWeatherWidgetEvents（169-191）→ @click
 * - weather-settings-btn 打开天气设置面板（v1.8.1:js/app.js bindWeatherEvents 同款）→ @click.stop
 */
import { computed, onUnmounted, ref, watchEffect } from 'vue';
import { setPanelOriginFromEvent, usePanels } from '@/src/composables/usePanels';
import {
  getIconTypeForAmap,
  getWeatherIconSvg,
  resolveWeatherIconType,
  useWeather,
} from '@/src/composables/useWeather';
import { createIconNode } from '@/src/lib/iconSafe';
import { t } from '@/src/composables/useI18n';

const { open } = usePanels();

/** 展开原点：天气设置面板从齿轮按钮长出来。 */
function openWithOrigin(id: Parameters<typeof open>[0], ev: MouseEvent): void {
  setPanelOriginFromEvent(id, ev);
  open(id);
}
const {
  weatherData,
  isLoading,
  isStale,
  staleTitle,
  error,
  temperatureUnit,
  refresh,
  startAutoUpdate,
} = useWeather();

const iconHost = ref<HTMLElement | null>(null);

// legacy displayWeather：单位换算 + 拼接；showError/初始态：--°C
const temperatureText = computed(() => {
  const data = weatherData.value;
  if (!data || !Number.isFinite(data.temperature)) return '--°C';
  if (temperatureUnit.value === 'fahrenheit') {
    return `${Math.round((data.temperature * 9) / 5 + 32)}°F`;
  }
  return `${data.temperature}°C`;
});

const descText = computed(() => {
  const data = weatherData.value;
  // data.description 存的是 weather_desc_* key（见 useWeather 的天气码表），渲染时翻译
  if (data) return t(data.description);
  // error.short 是 i18n key（见 lib/weather-error.ts），渲染时才翻译
  return error.value ? t(error.value.short) : t('weather_loading');
});

const descTitle = computed(() => {
  const data = weatherData.value;
  // legacy：错误时 weather-desc.title = 完整原因（成功渲染后 legacy 不清 title，这里顺手清掉陈旧提示）
  return data ? undefined : error.value?.message;
});

// 位置行（country 可能为空，如 Open-Meteo 定位路径）：[city, country].filter(Boolean).join(', ')
const locationText = computed(() => {
  const data = weatherData.value;
  // city 可能是 key（weather_current_location）也可能是用户输入的城市名：t() 查不到就原样返回，
  // 所以这里统一过一遍 t() 即可，不需要区分两种来源。
  if (data) {
    const city = String(data.city ?? '');
    // 「当前位置」以字面量持久化在 cacheKey / weatherCity 里（见 useWeather 的哨兵逻辑），
    // 语言切换后它仍是中文 —— 这里按字面量识别再译，不依赖 key 转换。
    const cityText = city === '当前位置' || city === 'weather_current_location' ? t('weather_current_location') : city;
    return [cityText, data.country].filter(Boolean).join(', ');
  }
  return error.value ? t(error.value.locationHint) : t('weather_locating');
});

// legacy bindWeatherWidgetEvents 设 title='点击刷新天气信息'，但首次成功渲染即被 clearStale 移除，
// 终态 = 仅缓存态有 title（markStale 文案），这里按终态实现
const widgetTitle = computed(() => (isStale.value ? staleTitle.value : undefined));

function onWidgetClick(event: MouseEvent): void {
  const target = event.target as Element | null;
  // 如果点击的是设置按钮，不触发刷新（legacy closest 判断；按钮自身已 @click.stop，这里是同款兜底）
  if (target && target.closest('.weather-settings-btn')) return;
  // 延迟刷新，避免频繁点击（legacy setTimeout 500ms 同款）
  window.setTimeout(() => {
    void refresh();
  }, 500);
}

function openWeatherSettings(ev: MouseEvent): void {
  openWithOrigin('weather-settings', ev);
}

// 图标渲染：legacy updateWeatherIcon 是 svgElement.innerHTML = getWeatherIconSvg(type)；
// 这里经 createIconNode（DOMParser + 白名单重建）注入，产物 DOM 与 legacy 一致（含 id="weather-svg"）。
// 无数据时用 legacy 静态默认图标同款 sunny。
watchEffect(() => {
  const host = iconHost.value;
  if (!host) return;
  const data = weatherData.value;
  const iconCode = data ? getIconTypeForAmap(data.description) : 'sunny';
  const type = resolveWeatherIconType(iconCode);
  const markup =
    '<svg id="weather-svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    getWeatherIconSvg(type) +
    '</svg>';
  const node = createIconNode(markup);
  host.replaceChildren(...(node ? [node] : []));
});

// 定时刷新（30 分钟）与首次 init：组件存活期间持有，卸载时清理定时器
const stopAutoUpdate = startAutoUpdate();
onUnmounted(() => stopAutoUpdate());
</script>

<template>
  <!-- 天气信息组件（markup 逐字拷贝自 entrypoints/newtab.html:101-145，仅 onclick → @click 与状态绑定两处改动） -->
  <div
    id="weather-widget"
    class="weather-widget"
    :class="{ loading: isLoading, 'is-stale': isStale }"
    :title="widgetTitle"
    v-glass="{ square: false, refraction: 0.5, dispersion: 0.12, frost: 0 }"
    @click="onWidgetClick"
  >
    <div class="weather-content">
      <div class="weather-icon" ref="iconHost">
        <!-- 默认天气图标（newtab.html:105-124 的静态 sunny svg；数据到达后由 watchEffect 注入对应图标） -->
        <svg
            id="weather-svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
        >
            <!-- 默认天气图标 -->
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      </div>
      <div class="weather-info">
        <div class="temperature" id="temperature">{{ temperatureText }}</div>
        <div class="weather-desc" id="weather-desc" :title="descTitle">{{ descText }}</div>
        <div class="location" id="location">{{ locationText }}</div>
      </div>
      <button
        id="weather-settings-btn"
        class="weather-settings-btn"
        :title="t('weather_settings')"
        :aria-label="t('weather_settings')"
        @click.stop="openWeatherSettings($event)"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"></path>
        </svg>
      </button>
    </div>
  </div>
</template>
