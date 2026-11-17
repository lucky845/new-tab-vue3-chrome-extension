import { describe, it, expect } from 'vitest';
import { computePosition, type TipAnchorRect } from '@/src/composables/useTip';

const VIEW = { width: 1000, height: 800 };

/** 造一个锚点矩形：left/top 决定位置，width 决定中心 */
const anchor = (left: number, top: number, width = 40, height = 40): TipAnchorRect => ({
  left,
  top,
  bottom: top + height,
  width,
});

describe('computePosition 锚定提示定位', () => {
  it('下方放得下时优先放在锚点下方，水平居中', () => {
    const p = computePosition(anchor(400, 100), 200, 60, 'auto', VIEW);
    expect(p.placement).toBe('below');
    expect(p.top).toBe(148); // bottom 140 + GAP 8
    expect(p.left).toBe(320); // 中心 420 - 200/2
    expect(p.arrowY).toBeLessThan(0); // 箭头探出上沿
  });

  it('下方放不下、上方放得下时翻到上方', () => {
    const p = computePosition(anchor(400, 700), 200, 60, 'auto', VIEW);
    expect(p.placement).toBe('above');
    expect(p.top).toBe(632); // 700 - 60 - 8
    expect(p.arrowY).toBeGreaterThan(0); // 箭头探出下沿
  });

  it('显式 above 但上方放不下时翻到下方', () => {
    const p = computePosition(anchor(400, 20), 200, 300, 'above', VIEW);
    expect(p.placement).toBe('below');
  });

  it('显式 below 但下方放不下时翻到上方', () => {
    const p = computePosition(anchor(400, 760), 200, 200, 'below', VIEW);
    expect(p.placement).toBe('above');
  });

  it('上方放不下时即使显式 above 也翻到下方（优先保证可见）', () => {
    const p = computePosition(anchor(400, 300), 200, 400, 'above', VIEW);
    expect(p.placement).toBe('below');
  });

  it('两侧都放不下时仍然选一侧并钳进视口，不会飞出屏幕', () => {
    // 气泡比视口还高：任何方向都放不下，算法必须给一个钳制后的合法位置
    const p = computePosition(anchor(400, 300), 200, 900, 'auto', VIEW);
    expect(['above', 'below']).toContain(p.placement);
    // 上限算出负数时以下限为准：贴住视口上边，气泡底部的溢出交给浏览器裁掉
    expect(p.top).toBe(8);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left).toBeLessThanOrEqual(1000 - 200 - 8);
  });

  it('贴左边缘时 left 被钳到 MARGIN，箭头不会跑出气泡', () => {
    const p = computePosition(anchor(0, 100), 200, 60, 'auto', VIEW);
    expect(p.left).toBe(8);
    expect(p.arrowX).toBeGreaterThanOrEqual(14);
    expect(p.arrowX).toBeLessThanOrEqual(200 - 14 - 12);
  });

  it('贴右边缘时 left 被钳到 vw - w - MARGIN', () => {
    const p = computePosition(anchor(980, 100), 200, 60, 'auto', VIEW);
    expect(p.left).toBe(792); // 1000 - 200 - 8
  });

  it('顶部放不下时翻到下方并保持 GAP 间距', () => {
    const p = computePosition(anchor(400, 0), 200, 600, 'above', VIEW);
    expect(p.placement).toBe('below');
    expect(p.top).toBe(48); // bottom 40 + GAP 8
  });

  it('底部放不下时翻到上方（贴着锚点上沿）', () => {
    const p = computePosition(anchor(400, 790), 200, 60, 'below', VIEW);
    expect(p.placement).toBe('above');
    expect(p.top).toBe(722); // 790 - 60 - 8
  });

  it('输出整数（避免亚像素抖动）', () => {
    const p = computePosition(anchor(400.4, 100.6, 40.3), 200.7, 60.2, 'auto', VIEW);
    [p.top, p.left, p.arrowX, p.arrowY].forEach((n) => expect(Number.isInteger(n)).toBe(true));
  });

  it('不传 viewport 时回落到 window（node 环境为 0 尺寸也不抛错）', () => {
    const p = computePosition(anchor(0, 0), 100, 40, 'auto');
    expect(typeof p.top).toBe('number');
    expect(typeof p.left).toBe('number');
  });
});
