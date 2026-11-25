import { describe, expect, it, vi } from 'vitest';
import { applyStaticI18n } from '@/src/lib/static-i18n';

/**
 * 静态 DOM 文案回填：newtab.html 里手写的按钮 title 在 Vue 之外，
 * 靠 data-i18n-* 声明 key，由 boot.ts 在挂载时与语言切换时回填。
 *
 * node 环境没有真实 DOM，这里只造 querySelectorAll 的最小桩：被测函数
 * 只用到 querySelectorAll + dataset + setAttribute，够用即可。
 */
type FakeEl = {
  attrs: Record<string, string>;
  dataset: Record<string, string | undefined>;
  setAttribute: (k: string, v: string) => void;
};

function fakeRoot(els: Record<string, FakeEl[]>): { root: ParentNode; seen: string[] } {
  const seen: string[] = [];
  const root = {
    querySelectorAll: (selector: string) => {
      seen.push(selector);
      return els[selector] ?? [];
    },
  } as unknown as ParentNode;
  return { root, seen };
}

function el(dataset: Record<string, string | undefined>): FakeEl {
  const attrs: Record<string, string> = {};
  return { attrs, dataset, setAttribute: (k, v) => { attrs[k] = v; } };
}

const t = (key: string): string => 'T:' + key;

describe('applyStaticI18n', () => {
  it('按 data-i18n-title 回填 title', () => {
    const a = el({ i18nTitle: 'todo_panel_title' });
    const { root } = fakeRoot({ '[data-i18n-title]': [a] });
    expect(applyStaticI18n(t, root)).toBe(1);
    expect(a.attrs.title).toBe('T:todo_panel_title');
  });

  it('aria-label 走 dataset.i18nAriaLabel（连字符转驼峰）', () => {
    const a = el({ i18nAriaLabel: 'clock_aria_name' });
    const { root } = fakeRoot({ '[data-i18n-aria-label]': [a] });
    applyStaticI18n(t, root);
    expect(a.attrs['aria-label']).toBe('T:clock_aria_name');
  });

  it('placeholder 同理', () => {
    const a = el({ i18nPlaceholder: 'todo_input_placeholder' });
    const { root } = fakeRoot({ '[data-i18n-placeholder]': [a] });
    applyStaticI18n(t, root);
    expect(a.attrs.placeholder).toBe('T:todo_input_placeholder');
  });

  it('三类属性都扫一遍，返回回填总数', () => {
    const { root, seen } = fakeRoot({
      '[data-i18n-title]': [el({ i18nTitle: 'a' }), el({ i18nTitle: 'b' })],
      '[data-i18n-aria-label]': [el({ i18nAriaLabel: 'c' })],
      '[data-i18n-placeholder]': [],
    });
    expect(applyStaticI18n(t, root)).toBe(3);
    expect(seen).toEqual(['[data-i18n-title]', '[data-i18n-aria-label]', '[data-i18n-placeholder]']);
  });

  it('值为空时跳过，不回填空串（避免把 title 抹掉）', () => {
    const a = el({ i18nTitle: '' });
    const { root } = fakeRoot({ '[data-i18n-title]': [a] });
    expect(applyStaticI18n(t, root)).toBe(0);
    expect(a.attrs.title).toBeUndefined();
  });

  it('newtab.html 里声明的 key 全都在语料里（防拼错 key 后界面显示裸 key）', async () => {
    const { readFileSync } = await import('node:fs');
    const { catalog } = await import('@/src/locales/catalog');
    const html = readFileSync(new URL('../entrypoints/newtab.html', import.meta.url), 'utf8');
    const keys = [...html.matchAll(/data-i18n-[a-z-]+="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(catalog.zh_CN[key], 'zh_CN 缺 key: ' + key).toBeTruthy();
      expect(catalog.en[key], 'en 缺 key: ' + key).toBeTruthy();
    }
  });
});
