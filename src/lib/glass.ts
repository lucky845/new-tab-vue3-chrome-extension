import { log } from '@/src/lib/log';
import { attach, detach } from '@surdeddd/liquidglass';
import type { LiquidGlassHandle } from '@surdeddd/liquidglass';

/**
 * 液态玻璃统一入口。
 *
 * 库的 attach() 是 install-or-update 语义：同一元素重复 attach 会返回同一个 handle，
 * 组件里可以放心在 onMounted / watch 里重复调用，不用自己维护去重表。
 * （这里仍然用 WeakMap 记一份，是为了 detach 时能精确清理，并给 syncGlassScene 提供句柄。）
 *
 * 材质取舍（对齐旧手写版观感）：
 *   preset 'clear' —— 最接近「通透 + 折射」；
 *   refraction 0.5 —— 库默认值，斜纹壁纸上边缘弯折最自然；
 *   dispersion 0.18 —— 旧 shader 的 0.34 在 112px 方格上会糊成彩边，收一半；
 *   specular 0.8 —— 保留顶部亮边，玻璃的「厚度感」主要来自这条高光。
 */

export interface GlassOptions {
  /** 方形元素（方格/卡片）：bevel 收窄、给一点投影 */
  square?: boolean;
  refraction?: number;
  dispersion?: number;
  frost?: number;
  physics?: boolean;
  /** 圆角半径（px）。不传时库会自行按 min(宽,高)*0.36 覆盖 border-radius；
      方格这类需要比 0.36 更方的形状时显式传入。 */
  radius?: number;
  /** 边缘高光强度（0-1），决定库注入的 .lg-bezel 的亮度；卡片类降到 0.5 左右边缘更干净 */
  specular?: number;
}

const handles = new WeakMap<HTMLElement, LiquidGlassHandle>();

export function applyGlass(el: HTMLElement, options: GlassOptions = {}): LiquidGlassHandle | null {
  const existing = handles.get(el);
  if (existing) return existing;

  try {
    const handle = attach(el, {
      preset: 'clear',
      refraction: options.refraction ?? 0.5,
      dispersion: options.dispersion ?? 0.18,
      frost: options.frost ?? 0,
      specular: 0.8,
      shadow: options.square ? 0.28 : 0,
      // 物理默认关闭：库的 hover 磁性（MAGNET_RATIO 0.05）会改写宿主 transform，
      // 全屏面板/卡片被鼠标带着漂移（bug m00309-2「弹窗跟着鼠标动」）。
      physics: options.physics ?? false,
      shape: options.square ? 'squircle' : 'rounded',
      // 显式半径：库在 radius:'auto' 时会把圆角写成边长的 36%（91px 卡 → 33px，
      // 接近圆形）。手机 App 图标的圆角比例是 22% 左右，这里交给调用方决定。
      ...(options.radius !== undefined ? { radius: options.radius } : {}),
    });
    // 给宿主打上「由库接管」的标记：样式表按它让位（见 styles/glass.css 末段）。
    // 手写版靠 :has(> .liquid-glass-canvas) 判断，库不插那个节点，用属性最直白。
    el.dataset.glass = 'lib';
    handles.set(el, handle);
    return handle;
  } catch (error) {
    log.error('[glass] attach 失败，保留 CSS 玻璃外观:', error);
    return null;
  }
}

export function releaseGlass(el: HTMLElement): void {
  if (!handles.has(el)) return;
  try {
    detach(el);
  } catch (error) {
    log.warn('[glass] detach 失败:', error);
  }
  delete el.dataset.glass;
  handles.delete(el);
}

/**
 * 把壁纸同步给「需要显式场景」的后端。
 *
 * css-svg 后端直接从元素背后的真实 DOM 取像素，不需要这一步；
 * 只有退化到 webgl-scene（Safari/Firefox，或 backdrop-filter 不可用）时才需要
 * 明确告诉它场景图在哪。统一调用 handle.set({ sceneImage })。
 */
export function syncGlassScene(imageUrl: string): void {
  document.querySelectorAll<HTMLElement>('[data-glass]').forEach((el) => {
    const handle = handles.get(el);
    if (!handle) return;
    try {
      handle.set({ sceneImage: imageUrl } as never);
    } catch {
      /* 后端不支持 sceneImage 时静默，CSS 玻璃照旧 */
    }
  });
}
