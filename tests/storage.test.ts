import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { useStored } from '@/src/lib/storage';

const store: Record<string, unknown> = {};
const setMock = vi.fn(async (items: Record<string, unknown>) => Object.assign(store, items));
const listeners = new Set<(changes: Record<string, unknown>, area: string) => void>();
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (keys: string[]) => keys.reduce((out, k) => {
        if (k in store) out[k] = store[k];
        return out;
      }, {} as Record<string, unknown>),
      set: setMock,
    },
    onChanged: {
      addListener: (fn: (changes: Record<string, unknown>, area: string) => void) => listeners.add(fn),
    },
  },
});

const flush = async () => { await nextTick(); await new Promise((r) => setTimeout(r, 0)); await nextTick(); };
const emit = (key: string) => listeners.forEach((fn) => fn({ [key]: { oldValue: undefined, newValue: store[key] } }, 'local'));

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  // 注意：不能 clear listeners。useStored 的 bound 是模块级标志，
  // onChanged.addListener 只在首次调用注册一次（内部 dispatch），清掉后外部事件无法触发。
  setMock.mockClear();
});

describe('useStored', () => {
  it('从 storage 水合初始值，load 迁移函数生效', async () => {
    store.foo = { old: 1 };
    const state = useStored('foo', { value: 0 }, {
      load: (raw) => ({ value: (raw as { old: number }).old }),
    });
    await flush();
    expect(state.value).toEqual({ value: 1 });
  });
  it('缺省用初始值，存储无按键时不写回', async () => {
    const state = useStored('missing', 42);
    await flush();
    expect(state.value).toBe(42);
    expect(setMock).not.toHaveBeenCalled();
  });
  it('变更写回纯数据（Proxy 剥壳），同值不重复写', async () => {
    const state = useStored('todos', [] as { content: string }[]);
    await flush();
    state.value = [{ content: 'x' }];
    await flush();
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(store.todos).toEqual([{ content: 'x' }]);
    state.value = [{ content: 'x' }];
    await flush();
    expect(setMock).toHaveBeenCalledTimes(1);
  });
  it('外部 onChanged 事件拉回最新值', async () => {
    const state = useStored('bar', 'init');
    await flush();
    store.bar = 'external';
    emit('bar');
    await flush();
    expect(state.value).toBe('external');
  });
  it('save 变换在写盘前生效', async () => {
    const state = useStored('num', 0, { save: (v) => v * 2 });
    await flush();
    state.value = 5;
    await flush();
    expect(store.num).toBe(10);
  });
});
