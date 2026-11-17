import { describe, it, expect } from 'vitest';
import {
  TONE_BRIGHT_ABOVE,
  TONE_DARK_BELOW,
  onPhotoInkForTone,
  toneFromLuminance,
} from '@/src/lib/wallpaper-tone';

describe('wallpaperTone.toneFromLuminance', () => {
  it('阈值边界按「含等号」判档：150 算亮、80 算暗', () => {
    expect(toneFromLuminance(TONE_BRIGHT_ABOVE)).toBe('bright');
    expect(toneFromLuminance(TONE_DARK_BELOW)).toBe('dark');
  });

  it('阈值内侧一格仍是 normal', () => {
    expect(toneFromLuminance(TONE_BRIGHT_ABOVE - 1)).toBe('normal');
    expect(toneFromLuminance(TONE_DARK_BELOW + 1)).toBe('normal');
  });

  it('实测典型值：白纸/灰蓝天空/森林', () => {
    expect(toneFromLuminance(236)).toBe('bright');
    expect(toneFromLuminance(150)).toBe('bright');
    expect(toneFromLuminance(110)).toBe('normal');
    expect(toneFromLuminance(70)).toBe('dark');
    expect(toneFromLuminance(0)).toBe('dark');
    expect(toneFromLuminance(255)).toBe('bright');
  });

  it('量不出亮度（NaN / Infinity）时退回 normal，不假装分过档', () => {
    expect(toneFromLuminance(Number.NaN)).toBe('normal');
    expect(toneFromLuminance(Number.POSITIVE_INFINITY)).toBe('normal');
    expect(toneFromLuminance(Number.NEGATIVE_INFINITY)).toBe('normal');
  });
});

describe('wallpaperTone.onPhotoInkForTone', () => {
  it('亮壁纸用墨字、暗壁纸用白字', () => {
    expect(onPhotoInkForTone('bright')).toBe('dark');
    expect(onPhotoInkForTone('dark')).toBe('light');
  });

  it('normal 与 null 都不翻面（跟随主题）', () => {
    expect(onPhotoInkForTone('normal')).toBeNull();
    expect(onPhotoInkForTone(null)).toBeNull();
  });
});
