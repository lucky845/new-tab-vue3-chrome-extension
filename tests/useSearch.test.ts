import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerCatalog, resetLocaleState } from '@/src/composables/useI18n';
import { catalog } from '@/src/locales/catalog';

// addCustomEngine 的重名提示已走 i18n（"{name}" 占位），node 环境须先注册语料。
beforeEach(() => {
    registerCatalog(catalog);
    resetLocaleState('zh-CN');
});

// useSearch 在模块顶层不直接访问 chrome（storageArea() 延迟到调用时读 globalThis），
// 但模块级单例会跨测试文件共享；这里通过 vi.resetModules + 动态 import 拿到隔离实例。
const store: Record<string, unknown> = {};
const setMock = vi.fn(async (items: Record<string, unknown>) => Object.assign(store, items));

const makeChrome = () => ({
  storage: {
    local: {
      get: async (keys: string[]) => keys.reduce((out, k) => {
        if (k in store) out[k] = store[k];
        return out;
      }, {} as Record<string, unknown>),
      set: setMock,
    },
  },
});

async function fresh(seed?: Record<string, unknown>) {
  vi.resetModules();
  for (const k of Object.keys(store)) delete store[k];
  if (seed) Object.assign(store, seed);
  setMock.mockClear();
  vi.stubGlobal('chrome', makeChrome());
  // useSearch 的重名提示走 i18n，与 useSearch 一起在 resetModules 后重新注册语料，
  // 否则 useI18n 也被重置成空 catalog，t() 只会返回裸 key。
  const i18n = await import('@/src/composables/useI18n');
  i18n.registerCatalog(catalog);
  i18n.resetLocaleState('zh-CN');
  const mod = await import('@/src/composables/useSearch');
  const api = mod.useSearch();
  await api.init();
  return api;
}

const texts = (api: { getSearchHistory(): string[] }) => api.getSearchHistory();

describe('useSearch 引擎去重', () => {
  it('存储里已有与内置重名的引擎时，水合只保留一个 Bing', async () => {
    const api = await fresh({
      customEngines: [
        { name: 'Bing', url: 'https://www.bing.com/search?q=' },
        { name: 'Mine', url: 'https://mine.test/?q=' },
      ],
    });
    const names = api.engines.value.map(e => e.name);
    expect(names.filter(n => n === 'Bing')).toHaveLength(1);
    expect(names).toContain('Mine');
  });

  it('清洗后回写 storage，避免每次打开都重复过滤', async () => {
    await fresh({ customEngines: [{ name: 'Bing', url: 'https://www.bing.com/search?q=' }] });
    expect(setMock).toHaveBeenCalled();
    const written = setMock.mock.calls.map(c => c[0]).find(o => 'customEngines' in o);
    expect(written).toBeTruthy();
    expect((written as { customEngines: unknown[] }).customEngines).toEqual([]);
  });

  it('addCustomEngine 拒绝与内置引擎同名', async () => {
    const api = await fresh();
    const r = await api.addCustomEngine('Bing', 'https://www.bing.com/search?q=%s');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Bing');
  });

  it('addCustomEngine 拒绝与内置引擎同名但大小写不同', async () => {
    const api = await fresh();
    const r = await api.addCustomEngine('bAiDu', 'https://www.baidu.com/s?wd=%s');
    expect(r.ok).toBe(false);
  });

  it('addCustomEngine 允许不重名的新引擎', async () => {
    const api = await fresh();
    const r = await api.addCustomEngine('MyEngine', 'https://my.test/?q=%s');
    expect(r.ok).toBe(true);
    expect(api.engines.value.map(e => e.name)).toContain('MyEngine');
  });

  it('引擎名全表无重复', async () => {
    const api = await fresh({
      customEngines: [
        { name: 'Dup', url: 'https://a.test/?q=' },
        { name: 'DUP', url: 'https://b.test/?q=' },
      ],
    });
    const names = api.engines.value.map(e => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('useSearch 历史管理', () => {
  it('init 从 storage 水合历史', async () => {
    const api = await fresh({ searchHistory: ['a', 'b'] });
    expect(texts(api)).toEqual(['a', 'b']);
    // 旧格式（纯字符串）水合后必须升级成对象结构再落盘
    expect(api.history.value[0]).toEqual({ text: 'a', pinned: false, at: 0 });
  });

  it('旧格式与新格式混合水合时都能吃，重复只留第一条', async () => {
    const api = await fresh({
      searchHistory: ['old', { text: 'new', pinned: true, at: 123 }, 'old'],
    });
    expect(texts(api)).toEqual(['new', 'old']);
    expect(api.history.value[0].pinned).toBe(true);
  });

  it('addHistory 去重并置顶', async () => {
    const api = await fresh();
    await api.addHistory('a');
    await api.addHistory('b');
    await api.addHistory('a');
    expect(texts(api)).toEqual(['a', 'b']);
  });

  it('addHistory 空白查询直接忽略，不落盘', async () => {
    const api = await fresh();
    await api.addHistory('   ');
    expect(texts(api)).toEqual([]);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('未固定条目上限 20，且落盘结构与内存一致', async () => {
    const api = await fresh();
    for (let i = 0; i < 25; i++) await api.addHistory('q' + i);
    const h = texts(api);
    expect(h).toHaveLength(20);
    expect(h[0]).toBe('q24');
    expect(h[19]).toBe('q5');
    expect(store.searchHistory).toEqual(api.history.value);
  });

  it('固定条目不参与上限淘汰，重复搜索不掉固定态', async () => {
    const api = await fresh();
    await api.addHistory('keep');
    await api.setHistoryPinned(0, true);
    for (let i = 0; i < 25; i++) await api.addHistory('q' + i);
    const h = texts(api);
    expect(h).toHaveLength(21);
    expect(h[0]).toBe('keep');
    expect(h[1]).toBe('q24');
    // 再搜一次固定词：仍在固定区，pinned 不掉
    await api.addHistory('keep');
    expect(api.history.value[0]).toMatchObject({ text: 'keep', pinned: true });
    expect(api.history.value.filter(e => e.text === 'keep')).toHaveLength(1);
  });

  it('setHistoryPinned 取消固定后回到未固定区，越界静默', async () => {
    const api = await fresh();
    await api.addHistory('a');
    await api.addHistory('b');
    await api.setHistoryPinned(0, true);
    expect(texts(api)).toEqual(['b', 'a']);
    await api.setHistoryPinned(0, false);
    expect(texts(api)).toEqual(['b', 'a']);
    expect(api.history.value[0].pinned).toBe(false);
    const n = setMock.mock.calls.length;
    await api.setHistoryPinned(99, true);
    await api.setHistoryPinned(-1, true);
    expect(setMock.mock.calls.length).toBe(n);
  });

  it('clearHistory 清空并落盘', async () => {
    const api = await fresh();
    await api.addHistory('a');
    await api.clearHistory();
    expect(texts(api)).toEqual([]);
    expect(store.searchHistory).toEqual([]);
  });

  it('removeFromHistory 按索引删，越界静默', async () => {
    const api = await fresh();
    await api.addHistory('a'); await api.addHistory('b'); await api.addHistory('c');
    await api.removeFromHistory(1);
    expect(texts(api)).toEqual(['c', 'a']);
    const n = setMock.mock.calls.length;
    await api.removeFromHistory(99);
    await api.removeFromHistory(-1);
    expect(texts(api)).toEqual(['c', 'a']);
    expect(setMock.mock.calls.length).toBe(n);
  });

  it('addToHistory 是 addHistory 别名', async () => {
    const api = await fresh();
    await api.addToHistory('x');
    expect(texts(api)).toEqual(['x']);
  });
});
