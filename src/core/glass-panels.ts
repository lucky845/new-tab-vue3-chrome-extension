import { applyGlass } from '@/src/lib/glass';

/**
 * 面板层的液态玻璃挂载。
 *
 * 面板本体已全部由 Vue3 SFC 经 Teleport 挂到 #legacy-panels-root；这里只负责给
 * 晚到的 .weather-widget / .side-card / .control-btn 容器补挂 @surdeddd/liquidglass
 * 光学层（替代旧 liquid-glass.js 的 TARGETS 扫描）。
 *
 * MutationObserver 的原因：面板异步挂载/条件渲染，天气卡还要等首次请求回来才有
 * 内容 —— 首次扫描时节点可能尚未进 DOM。监听 #legacy-panels-root 的子节点变化，
 * 新出现的卡片立刻挂上玻璃，避免「一张玻璃一张实心」的混搭。
 */
const TARGETS = ['.weather-widget', '.side-card', '.control-btn'] as const;
const SELECTOR = TARGETS.join(',');

function decorate(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
    // 面板里的按钮/列表项不参与：只给「卡片级」容器挂，子元素靠父级玻璃透出来
    applyGlass(el, { square: false, refraction: 0.5, dispersion: 0.12, frost: 0 });
  });
}

export function attachPanelGlass(): void {
  const root = document.getElementById('legacy-panels-root') ?? document.body;
  decorate(root);

  let pending = 0;
  const observer = new MutationObserver((records) => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.matches(SELECTOR)) applyGlass(node, { square: false, refraction: 0.5, dispersion: 0.12 });
            decorate(node);
          }
        }
      }
    });
  });

  observer.observe(root, { childList: true, subtree: true });
}
