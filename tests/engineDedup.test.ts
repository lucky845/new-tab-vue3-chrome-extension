import { describe, it, expect } from 'vitest';
import { dedupeEngines, engineKey } from '@/src/lib/engineDedup';

const B = [{ name: 'Baidu' }, { name: 'Google' }, { name: 'Bing' }];

describe('engineKey', () => {
  it('去空白并小写', () => {
    expect(engineKey('  Bing ')).toBe('bing');
    expect(engineKey('BING')).toBe('bing');
  });
  it('空值返回空串', () => {
    expect(engineKey('')).toBe('');
    expect(engineKey('   ')).toBe('');
  });
  it('中文名不受小写影响', () => {
    expect(engineKey(' 必应 ')).toBe('必应');
  });
});

describe('dedupeEngines · 与内置重名', () => {
  it('剔除与内置同名的自定义引擎（这就是下拉出现两个 Bing 的根因）', () => {
    const { list, dropped } = dedupeEngines([{ name: 'Bing' }, { name: 'MyEngine' }], B);
    expect(list.map(e => e.name)).toEqual(['MyEngine']);
    expect(dropped).toBe(1);
  });

  it('大小写不同也算重名', () => {
    const { list } = dedupeEngines([{ name: 'bing' }, { name: 'BING' }], B);
    expect(list).toEqual([]);
  });

  it('前后空白不影响判定，但保留的项原样返回', () => {
    const { list } = dedupeEngines([{ name: '  Baidu  ' }], B);
    expect(list).toEqual([]);
  });

  it('不重名的自定义引擎全部保留且顺序不变', () => {
    const { list, dropped } = dedupeEngines([{ name: 'A' }, { name: 'B' }, { name: 'C' }], B);
    expect(list.map(e => e.name)).toEqual(['A', 'B', 'C']);
    expect(dropped).toBe(0);
  });
});

describe('dedupeEngines · 自定义之间重名', () => {
  it('保留先出现的那个', () => {
    const { list, dropped } = dedupeEngines(
      [{ name: 'Dup', url: 'first' }, { name: 'dup', url: 'second' }],
      []
    );
    expect(list).toHaveLength(1);
    expect((list[0] as { url?: string }).url).toBe('first');
    expect(dropped).toBe(1);
  });

  it('空名字直接丢弃并计入 dropped', () => {
    const { list, dropped } = dedupeEngines([{ name: '  ' }, { name: 'Ok' }], []);
    expect(list.map(e => e.name)).toEqual(['Ok']);
    expect(dropped).toBe(1);
  });

  it('空数组安全', () => {
    expect(dedupeEngines([], B)).toEqual({ list: [], dropped: 0 });
  });

  it('保留额外字段（url/logo 不被丢掉）', () => {
    const { list } = dedupeEngines([{ name: 'X', url: 'https://x/?q=%s', logo: 'data:image/png;base64,aa' }], []);
    expect(list[0]).toEqual({ name: 'X', url: 'https://x/?q=%s', logo: 'data:image/png;base64,aa' });
  });
});
