import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  const mod = await import('@/src/composables/useSearch');
  const api = mod.useSearch();
  await api.init();
  return api;
}

describe('useSearch 历史管理', () => {
  it('init 从 storage 水合历史', async () => {
    const api = await fresh({ searchHistory: ['a', 'b'] });
    expect(api.getSearchHistory()).toEqual(['a', 'b']);
  });
  it('addHistory 去重并置顶', async () => {
    const api = await fresh();
    await api.addHistory('a');
    await api.addHistory('b');
    await api.addHistory('a');
    expect(api.getSearchHistory()).toEqual(['a', 'b']);
  });
  it('历史上限 10 条（保留最新）', async () => {
    const api = await fresh();
    for (let i = 0; i < 12; i++) await api.addHistory('q' + i);
    const h = api.getSearchHistory();
    expect(h).toHaveLength(10);
    expect(h[0]).toBe('q11');
    expect(h[9]).toBe('q2');
    expect(store.searchHistory).toEqual(h);
  });
  it('clearHistory 清空并落盘', async () => {
    const api = await fresh();
    await api.addHistory('a');
    await api.clearHistory();
    expect(api.getSearchHistory()).toEqual([]);
    expect(store.searchHistory).toEqual([]);
  });
  it('removeFromHistory 按索引删，越界静默', async () => {
    const api = await fresh();
    await api.addHistory('a'); await api.addHistory('b'); await api.addHistory('c');
    await api.removeFromHistory(1);
    expect(api.getSearchHistory()).toEqual(['c', 'a']);
    const n = setMock.mock.calls.length;
    await api.removeFromHistory(99);
    await api.removeFromHistory(-1);
    expect(api.getSearchHistory()).toEqual(['c', 'a']);
    expect(setMock.mock.calls.length).toBe(n);
  });
  it('addToHistory 是 addHistory 别名', async () => {
    const api = await fresh();
    await api.addToHistory('x');
    expect(api.getSearchHistory()).toEqual(['x']);
  });
});
