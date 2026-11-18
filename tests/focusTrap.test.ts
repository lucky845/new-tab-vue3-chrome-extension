import { describe, expect, it } from 'vitest';
import { FOCUSABLE_SELECTOR, trapTabTarget } from '@/src/lib/focusTrap';

/**
 * 焦点陷阱的判定层单测（node 环境，无 DOM）。
 *
 * 只覆盖 trapTabTarget 的边界：它回答的是「这次 Tab 该跳到哪个下标」，
 * 是焦点陷阱里唯一需要精确的地方——跳错一次，焦点就跳出面板了。
 */
describe('trapTabTarget', () => {
  it('面板内无可聚焦元素时返回 null，交由调用方兜底', () => {
    expect(trapTabTarget({ count: 0, activeIndex: -1, shift: false })).toBeNull();
    expect(trapTabTarget({ count: 0, activeIndex: 0, shift: true })).toBeNull();
  });

  it('焦点还在面板外：正向跳第一个，反向跳最后一个', () => {
    expect(trapTabTarget({ count: 3, activeIndex: -1, shift: false })).toBe(0);
    expect(trapTabTarget({ count: 3, activeIndex: -1, shift: true })).toBe(2);
  });

  it('正向停在最后一个 → 循环回第一个', () => {
    expect(trapTabTarget({ count: 3, activeIndex: 2, shift: false })).toBe(0);
    expect(trapTabTarget({ count: 1, activeIndex: 0, shift: false })).toBe(0);
  });

  it('反向停在第一个 → 循环回最后一个', () => {
    expect(trapTabTarget({ count: 3, activeIndex: 0, shift: true })).toBe(2);
    expect(trapTabTarget({ count: 1, activeIndex: 0, shift: true })).toBe(0);
  });

  it('中间位置不干预，交给浏览器默认 Tab', () => {
    expect(trapTabTarget({ count: 4, activeIndex: 1, shift: false })).toBeNull();
    expect(trapTabTarget({ count: 4, activeIndex: 2, shift: true })).toBeNull();
  });

  it('数量与下标越界时不误判', () => {
    // activeIndex 超出列表：不应被当成「最后一个」而乱跳，保持不干预
    expect(trapTabTarget({ count: 2, activeIndex: 5, shift: false })).toBeNull();
  });
});

describe('FOCUSABLE_SELECTOR', () => {
  it('覆盖原生可聚焦标签、显式 tabindex 与 contenteditable，且排除 hidden input', () => {
    const s = FOCUSABLE_SELECTOR;
    expect(s).toContain('button');
    expect(s).toContain('input:not([type="hidden"])');
    expect(s).toContain('select');
    expect(s).toContain('textarea');
    expect(s).toContain('[tabindex]');
    expect(s).toContain('[contenteditable="true"]');
  });
});
