<script setup lang="ts">
/**
 * 天气设置面板 —— markup 逐字拷贝自 entrypoints/newtab.html:441-467（#weather-settings-panel）。
 *
 * legacy 行为映射（app.js bindWeatherEvents:600-663 + weather-manager.js setCity/useCurrentLocation/setTemperatureUnit）：
 * - 打开面板时回填当前城市/单位到表单 → watch(isOpen)
 * - 保存：city 有值走 setCity，留空走 useCurrentLocation，再 setTemperatureUnit（legacy 同序）
 * - 成功后关面板并 console.log('天气设置已保存')；失败 console.error 且面板保持打开（legacy 同款）
 * - 关闭按钮仅关面板，不做保存
 */
import { ref, watch } from 'vue';
import { panelOriginStyle, usePanels } from '@/src/composables/usePanels';
import { useWeather } from '@/src/composables/useWeather';

const { isOpen, close } = usePanels();
const { setCity, useCurrentLocation, setTemperatureUnit, currentCity, temperatureUnit } =
  useWeather();

const cityDraft = ref('');
// 表单草稿用 string，保存时归一成 celsius/fahrenheit（与 select 的 value 对齐）
const unitDraft = ref('celsius');

watch(
  () => isOpen('weather-settings'),
  (openNow) => {
    if (!openNow) return;
    // legacy 打开面板时把当前设置回填进表单
    cityDraft.value = currentCity.value;
    unitDraft.value = temperatureUnit.value;
  },
);

async function save(): Promise<void> {
  try {
    const city = cityDraft.value.trim();
    // legacy：有城市名走 setCity，留空回退到定位
    if (city) {
      await setCity(city);
    } else {
      await useCurrentLocation();
    }
    await setTemperatureUnit(unitDraft.value === 'fahrenheit' ? 'fahrenheit' : 'celsius');
    close('weather-settings');
    console.log('天气设置已保存');
  } catch (error) {
    // 失败面板保持打开（legacy 同款）
    console.error('保存天气设置失败:', error);
  }
}
</script>

<template>
  <!-- 天气设置面板 (默认隐藏) markup 逐字拷贝自 entrypoints/newtab.html:441-467 -->
  <div
    id="weather-settings-panel"
    :style="panelOriginStyle('weather-settings')"
    class="settings-panel"
    :class="{ 'u-hidden': !isOpen('weather-settings') }"
  >
    <div class="settings-content">
      <button id="close-weather-settings-btn" class="close-panel-btn" type="button" title="关闭" @click="close('weather-settings')">✕</button>
      <h2>天气设置</h2>
      <div class="setting-item">
        <label for="weather-city-input-panel">城市名称</label>
        <input
          type="text"
          id="weather-city-input-panel"
          placeholder="例如: 北京, 上海, 广州"
          v-model="cityDraft"
        />
        <p class="api-key-description">输入城市名称，留空将使用您的位置。</p>
      </div>
      <div class="setting-item">
        <label for="weather-unit-select">温度单位</label>
        <select id="weather-unit-select" v-model="unitDraft">
          <option value="celsius">摄氏度 (°C)</option>
          <option value="fahrenheit">华氏度 (°F)</option>
        </select>
      </div>
      <div class="settings-actions">
        <button id="save-weather-settings-btn" class="settings-btn" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>
