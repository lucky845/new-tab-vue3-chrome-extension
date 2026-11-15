import '@/src/lib/preview-shim';
import { createApp } from 'vue';
import App from '@/src/App.vue';
import '@/src/styles/tailwind.css';
import '@/src/styles/shell.css';
import '@/src/styles/glass.css';
import { vGlass } from '@/src/lib/glass-directive';
import { attachPanelGlass } from '@/src/core/glass-panels';
import { useSearch } from '@/src/composables/useSearch';

/**
 * 新标签页挂载入口（全 ESM）。
 *
 * 启动顺序：
 *   1. theme-preboot.js 已在 <head> 同步设好 data-theme（防白闪）
 *   2. preview-shim 保证非扩展上下文也有 chrome.storage 兜底
 *   3. useSearch().init() 读回引擎/历史；其余域由各自 composable/组件自持
 *   4. DOMContentLoaded 挂载 Vue → 首屏三块同步画出来
 *   5. 下一帧启动面板玻璃，避免和 Vue 抢同一时刻的主线程
 */

void useSearch().init().catch((error: unknown) => {
  console.error('[boot] 搜索数据层初始化失败:', error);
});

function mount(): void {
  const app = createApp(App, { dataReady: true });
  app.directive('glass', vGlass);
  app.mount('#app');
  console.debug('[boot] Vue 挂载完成');
  requestAnimationFrame(() => attachPanelGlass());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
