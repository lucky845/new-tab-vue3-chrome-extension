/**
 * 壁纸亮度分档 —— 把「这张壁纸有多亮」翻译成「浮在壁纸上的字该用哪种颜色」。
 *
 * 分档而不是连续取值，是因为浮字只有两种可用色（墨/白），中间地带给主题默认值：
 * 80–150 这段亮度上白字和墨字都不到 4.5:1，硬翻面只会让文字在壁纸纹理里消失，
 * 此时保留主题色 + 字形光晕才是稳的。
 *
 * 阈值是 Rec.601 感知亮度（0–255），实测取值：白纸≈236、灰蓝天空≈150、森林≈70。
 */

export type WallpaperTone = 'bright' | 'normal' | 'dark';

/** 浮在壁纸上时应该用的字色：'dark' = 墨字，'light' = 白字，null = 跟随主题。 */
export type OnPhotoInk = 'dark' | 'light' | null;

/** 高于此亮度按「亮壁纸」处理（需要墨字）。 */
export const TONE_BRIGHT_ABOVE = 150;
/** 低于此亮度按「暗壁纸」处理（需要白字）。 */
export const TONE_DARK_BELOW = 80;

/** 0–255 的感知亮度 → 三档。非有限数按 normal 处理（量不出来时不要假装量过）。 */
export function toneFromLuminance(avg: number): WallpaperTone {
  if (!Number.isFinite(avg)) return 'normal';
  if (avg >= TONE_BRIGHT_ABOVE) return 'bright';
  if (avg <= TONE_DARK_BELOW) return 'dark';
  return 'normal';
}

/** 三档 → 浮字字色。normal 交给主题（连字色一起翻会把两套主题的风格抹平）。 */
export function onPhotoInkForTone(tone: WallpaperTone | null): OnPhotoInk {
  if (tone === 'bright') return 'dark';
  if (tone === 'dark') return 'light';
  return null;
}
