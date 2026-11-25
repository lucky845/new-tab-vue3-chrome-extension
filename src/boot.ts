import '@/src/lib/preview-shim';
import { installCanvasReadbackHint } from '@/src/lib/canvas-readback';
import { log } from '@/src/lib/log';
import { createApp, watch } from 'vue';
import App from '@/src/App.vue';
import '@/src/styles/tailwind.css';
import '@/src/styles/shell.css';
import '@/src/styles/glass.css';
import { vGlass } from '@/src/lib/glass-directive';
import { attachPanelGlass } from '@/src/core/glass-panels';
import { applyStaticI18n } from '@/src/lib/static-i18n';
import { useSearch } from '@/src/composables/useSearch';
import { registerCatalog, setLocalePref, locale, t } from '@/src/composables/useI18n';
import { catalog } from '@/src/locales/catalog';
import { readSettings } from '@/src/composables/useSettings';

/**
 * 新标签页挂载入口（全 ESM）。
 *
 * 启动顺序：
 *   1. theme-preboot.js 已在 <head> 同步设好 data-theme（防白闪）
 *   2. preview-shim 保证非扩展上下文也有 chrome.storage 兜底
 *   3. 给离屏 2d canvas 装 willReadFrequently（见 canvas-readback.ts 的成因说明）
 *   4. useSearch().init() 读回引擎/历史；其余域由各自 composable/组件自持
 *   5. DOMContentLoaded 挂载 Vue → 首屏三块同步画出来
 *   6. 下一帧启动面板玻璃，避免和 Vue 抢同一时刻的主线程
 */

// 必须早于任何 canvas 读回（玻璃镜片图的 PNG 编码在挂载前后都会发生）
installCanvasReadbackHint();

// 全文案表必须先于任何组件渲染注册，否则首帧会闪 key 名
registerCatalog(catalog);

// 语言偏好读回失败不能阻断启动：t() 内部还有 DEFAULT_LOCALE 兜底
void readSettings()
  .then((settings) => setLocalePref(settings.locale))
  .catch((error: unknown) => {
    log.error('[boot] 语言偏好读取失败，使用跟随系统:', error);
  });

void useSearch().init().catch((error: unknown) => {
  log.error('[boot] 搜索数据层初始化失败:', error);
});

function mount(): void {
  // 静态 DOM 的 title/aria-label（newtab.html 手写的那几个按钮）在 Vue 之外，
  // 用 data-i18n-* 声明、这里回填；语言切换时再回填一次（watch locale）。
  applyStaticI18n(t);
  watch(locale, () => applyStaticI18n(t));
  const app = createApp(App, { dataReady: true });
  app.directive('glass', vGlass);
  app.mount('#app');
  log.debug('[boot] Vue 挂载完成');
  requestAnimationFrame(() => attachPanelGlass());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
