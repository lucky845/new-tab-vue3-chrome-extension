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
  /**
   * 折射带宽（px）。库在 'auto' 时按 `min(BAND_LIMIT=20, 0.7 * min(w,h)/2)` 封顶 ——
   * 20px 在 65px 高的搜索框上占 31%（整条像水波），在 619px 高的面板上只占 3%，
   * 观感退化成「平玻璃」。大面板必须显式给带宽，才能保住同一个「玻璃厚边」比例。
   * 传数字时库直接取该值，绕开 20px 上限。
   */
  bevelWidth?: number;
  /** 底色不透明度（0-1）：库 clear 预设只有 0.0765，等于没底，面板上文字会糊。 */
  tintOpacity?: number;
  /** 高斯模糊半径（库单位，非 px）：面板需要比细条更大的模糊兜住文字底。 */
  blur?: number;
  saturation?: number;
  brightness?: number;
  /** 圆角半径（px）。不传时库会自行按 min(宽,高)*0.36 覆盖 border-radius；
      方格这类需要比 0.36 更方的形状时显式传入。 */
  radius?: number;
  /** 边缘高光强度（0-1），决定库注入的 .lg-bezel 的亮度；卡片类降到 0.5 左右边缘更干净 */
  specular?: number;
}

/**
 * 材质档位
 * ------------------------------------------------------------
 * 搜索框之所以看着像「一块厚玻璃」，靠的是比例而不是参数：折射带宽度占
 * 元素短边的份额。库在 bevelWidth:'auto' 时按 `min(20, 0.7 * min(w,h)/2)`
 * 封顶 —— 20px 落在 65px 高的搜索条上占 31%（整条都是弯的），落在
 * 500x617 的面板上只占 3%，观感退化成一层平玻璃。所以按元素尺度分档
 * 显式给带宽，比例才对得上。
 *
 * tintOpacity 一律 0：库把 tint 写进元素的内联 background，写死就跟不上
 * 主题切换与壁纸翻面。填充改由 styles/glass.css 用主题令牌 !important
 * 夺回（该文件「填充接管」段），同一套光学参数在浅色/深色/翻面下都成立。
 *
 * dispersion 一律 0 是性能取舍而非审美：色散让滤镜链多走三个位移通道
 * （lgDispR/G/B + feComposite），实测面板滚动 87fps → 52fps，而色边在
 * 面板尺寸上肉眼几乎看不出来，只有搜索框那种细条值得开。
 */
export const PANEL_GLASS: GlassOptions = {
  refraction: 0.5,
  dispersion: 0,
  frost: 0,
  bevelWidth: 96,
  tintOpacity: 0,
  blur: 12,
};

export const CARD_GLASS: GlassOptions = {
  refraction: 0.5,
  dispersion: 0,
  frost: 0,
  bevelWidth: 56,
  tintOpacity: 0,
  blur: 5,
  specular: 0,
  // 侧卡是常驻 chrome，不吃库的动态 bevel：specular>0 会让库 mountBezel 并在每次
  // pointermove 里把宿主的 --lg-light-angle 内联改写一次（dist/index.js flush() →
  // bezel.update()），宿主正是 backdrop-filter 的目标，重写自定义属性能让折射链
  // 整层重绘 —— 彩色壁纸上的表现就是「白闪一下」。改成 0 后库销毁 bezel、注销光照，
  // 小件彻底不再随指针改样式；边缘亮线改由 CSS 静态描边给（见 styles/glass.css）。
};

export const CHIP_GLASS: GlassOptions = {
  refraction: 0.5,
  dispersion: 0,
  frost: 0,
  bevelWidth: 44,
  tintOpacity: 0,
  blur: 4,
  specular: 0,
};

export const CONTROL_GLASS: GlassOptions = {
  refraction: 0.5,
  dispersion: 0,
  frost: 0,
  bevelWidth: 14,
  tintOpacity: 0,
  blur: 3,
  specular: 0,
};

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
      // specular 可调：它同时决定库写进宿主的 1px 内联白边亮度，以及是否挂动态
      // bezel（syncBezel 里 specular > 0 才 mountBezel + registerLight）。小件给 0。
      specular: options.specular ?? 0.8,
      shadow: options.square ? 0.28 : 0,
      ...(options.bevelWidth !== undefined ? { bevelWidth: options.bevelWidth } : {}),
      ...(options.tintOpacity !== undefined ? { tintOpacity: options.tintOpacity } : {}),
      ...(options.blur !== undefined ? { blur: options.blur } : {}),
      ...(options.saturation !== undefined ? { saturation: options.saturation } : {}),
      ...(options.brightness !== undefined ? { brightness: options.brightness } : {}),
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