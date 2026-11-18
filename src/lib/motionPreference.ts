/**
 * 动效降级（reduce motion）——纯函数，不依赖 vue / chrome，便于单测。
 *
 * 语义：用户开关与系统 prefers-reduced-motion 任一成立即降级，开关只能「更保守」，
 * 不能覆盖系统的无障碍偏好。解析结果落在 <html data-motion>，CSS 只认这一个属性，
 * 避免 media query 与设置项两处真源打架。
 */
export type MotionMode = 'full' | 'reduced';

/** 首屏 preboot 用的 localStorage 镜像键（chrome.storage 异步抢不到首帧） */
export const MOTION_LS_MIRROR = 'ntce-motion';

export function resolveMotionMode(
  reduceMotion: boolean | undefined,
  systemPrefersReduced: boolean,
): MotionMode {
  return reduceMotion === true || systemPrefersReduced ? 'reduced' : 'full';
}

/** 洗 preboot 读到的镜像：只接受显式 true，其余（缺键/脏数据）一律不降级 */
export function normalizeMotionMirror(raw: unknown): { reduceMotion: boolean } {
  const value = (raw as { reduceMotion?: unknown } | null | undefined)?.reduceMotion;
  return { reduceMotion: value === true };
}
