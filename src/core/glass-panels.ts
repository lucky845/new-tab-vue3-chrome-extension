import { applyGlass } from '@/src/lib/glass';
import type { GlassOptions } from '@/src/lib/glass';
import { CARD_GLASS, CHIP_GLASS, CONTROL_GLASS, PANEL_GLASS } from '@/src/lib/glass';

/**
 * 玻璃挂载中心。
 *
 * 面板本体已全部由 Vue3 SFC 经 Teleport 挂到 #legacy-panels-root；这里负责给
 * 「外壳」补挂 @surdeddd/liquidglass 光学层（替代旧 liquid-glass.js 的 TARGETS 扫描）。
 *
 * 为什么按目标分档：库的折射带按比例才像玻璃 —— 同一个 20px 带宽在 65px 高的
 * 搜索条上是整条弯的，在 600px 高的面板上等于没有。分档常量见 src/lib/glass.ts。
 *
 * MutationObserver 的原因：面板异步挂载/条件渲染，天气卡还要等首次请求回来才有
 * 内容 —— 首次扫描时节点可能尚未进 DOM。监听 #legacy-panels-root 的子节点变化，
 * 新出现的容器立刻挂上玻璃，避免「一张玻璃一张实心」的混搭。
 */
const TARGET_GLASS = new Map<string, () => GlassOptions>([
  // 面板内容层：设置 / 壁纸 / 天气 / 工具 / 添加 / 待办 / 便签 / 番茄 / 文件夹
  ['.settings-content', () => PANEL_GLASS],
  ['.widget-content', () => PANEL_GLASS],
  ['.folder-popover', () => PANEL_GLASS],
  // 主页两翼卡片
  ['.side-card', () => CARD_GLASS],
  // 天气卡（矮而宽，带宽取中间档）
  ['.weather-widget', () => CHIP_GLASS],
  // 顶栏圆形控制按钮
  ['.control-btn', () => CONTROL_GLASS],
]);

const SELECTOR = [...TARGET_GLASS.keys()].join(',');

function glassFor(el: HTMLElement): GlassOptions | undefined {
  for (const [selector, factory] of TARGET_GLASS) {
    if (el.matches(selector)) return factory();
  }
  // 子元素靠父级玻璃透出来，不单独挂
  return undefined;
}

function decorate(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
    const options = glassFor(el);
    if (options) applyGlass(el, options);
  });
}

export function attachPanelGlass(): void {
  const panelsRoot = document.getElementById('legacy-panels-root');
  // 首扫给整份 body：添加页弹窗（QuickAccessDialog）和文件夹弹层是直接 Teleport
  // 到 body 的，不在 #legacy-panels-root 里面，只扫那个容器会漏掉它们。
  decorate(document.body);

  let pending = 0;
  const observer = new MutationObserver((records) => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const options = glassFor(node);
          if (options) applyGlass(node, options);
          decorate(node);
        }
      }
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
  if (panelsRoot) observer.observe(panelsRoot, { childList: true, subtree: true });
}
