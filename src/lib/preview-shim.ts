/**
 * 预览环境 chrome.storage 内存兜底（仅非扩展上下文生效；扩展里 chrome 已存在，本模块零操作）。
 *
 * 为什么需要：src/ 的 Vue 域（useStored 与 useWeather/useWallpaper/useNotes/usePomodoro
 * 的直连调用）在模块求值/挂载期就访问 chrome.storage；本地 http 预览不是扩展上下文，
 * chrome 未定义，第一个 useStored 就会把整个 Vue 应用炸掉。
 * 这里在一切模块求值之前注入内存版 chrome.storage.local：get 返回 {key: value}、
 * set/remove 即时落内存、onChanged 异步派发，语义与 chrome.storage 一致。
 */

type StoreChange = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type StoreListener = (changes: StoreChange, area: string) => void;

type ChromeLike = { chrome?: { storage?: { local?: unknown } } };

// 真实 Chrome 浏览器（非扩展上下文）也定义了 window.chrome（loadTimes/csi/runtime），
// 但没有 chrome.storage —— 所以这里判断的是 storage.local 缺失，而不是 chrome 本身缺失。
const existingChrome = (globalThis as ChromeLike).chrome;

if (!existingChrome || !existingChrome.storage || !existingChrome.storage.local) {
  /**
   * 内存库的初值可以由地址栏带进来，形如 ?seed=customEngines,engineLogos。
   * 预览页刷新会清空内存，要反复验证同一份数据（自定义引擎、换了图标的引擎）时，
   * 用这个把「需要长期存在的数据」一次性灌进去；键名必须存在于内存库，值由调用方自己拼。
   */
  const memory = new Map<string, unknown>();
  // localStorage 兜底持久化：预览页刷新不再丢设置/待办/历史（壁纸烤图超配额时该键退回内存）。
  // 真扩展里本模块整体不生效，这里的持久化只影响本地 http 预览。
  const PV_PREFIX = 'pv:';
  let quotaWarned = false;
  const persistKey = (k: string): void => {
    try {
      const v = memory.get(k);
      if (v === undefined) localStorage.removeItem(PV_PREFIX + k);
      else localStorage.setItem(PV_PREFIX + k, JSON.stringify(v));
    } catch {
      // localStorage ~5MB 配额：壁纸烤图这类大值存不下就只留内存，功能照常
      if (!quotaWarned) {
        quotaWarned = true;
        console.warn('[preview-shim] localStorage 配额不足，键 ' + k + ' 仅保留在内存（刷新即丢）');
      }
    }
  };
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const lsKey = localStorage.key(i);
      if (!lsKey || !lsKey.startsWith(PV_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(lsKey);
        if (raw != null) memory.set(lsKey.slice(PV_PREFIX.length), JSON.parse(raw));
      } catch {
        /* 单键损坏就跳过，别让一个坏键炸掉整个预览 */
      }
    }
  } catch {
    /* localStorage 不可用（隐私模式等）就纯内存跑 */
  }
  // ?seed={"customEngines":[...],"engineLogos":[...]}：预览刷新会清空内存库，
  // 反复验证同一份数据（自定义引擎、换了图标的引擎）时用它把数据带进来。
  try {
    const seed = new URL(location.href).searchParams.get('seed');
    const parsed = seed ? (JSON.parse(seed) as Record<string, unknown>) : null;
    if (parsed) Object.keys(parsed).forEach((k) => memory.set(k, JSON.parse(JSON.stringify(parsed[k]))));
  } catch {
    /* 地址里的 seed 不是合法 JSON 就忽略 */
  }
  // 页面脚本里 chrome.storage.local 也被改了（调试或复现问题时可以直接灌数据）
  (globalThis as Record<string, unknown>).__previewStore = memory;
  const listeners = new Set<StoreListener>();
  const notify = (changes: StoreChange): void => {
    setTimeout(() => listeners.forEach((fn) => fn(changes, 'local')), 0);
  };

  type GetInput = string | string[] | Record<string, unknown> | null | undefined;
  type GetCallback = (result: Record<string, unknown>) => void;

  /**
   * 调用方可能把回调当第二个参数，也可能像 Promise 风格那样只传一个函数（真实
   * chrome.storage 只认前者，但这里宽松一点，免得调试时 await 拿到空对象）。
   */
  function splitCallback<C>(a?: unknown, b?: C): C | undefined {
    if (typeof a === 'function') return a as C;
    return b;
  }

  const local = {
    get(keys?: GetInput, callbackIn?: GetCallback): Promise<Record<string, unknown>> | void {
      const callback = splitCallback(keys, callbackIn);
      const result: Record<string, unknown> = {};
      if (typeof keys === 'function') keys = undefined;
      if (typeof keys === 'string') {
        result[keys] = memory.get(keys);
      } else if (Array.isArray(keys)) {
        keys.forEach((k) => {
          result[k] = memory.get(k);
        });
      } else if (keys && typeof keys === 'object') {
        Object.keys(keys).forEach((k) => {
          result[k] = memory.has(k) ? memory.get(k) : (keys as Record<string, unknown>)[k];
        });
      }
      if (callback) {
        callback(result);
        return;
      }
      return Promise.resolve(result);
    },
    set(items: Record<string, unknown>, callbackIn?: () => void): Promise<void> | void {
      const callback = splitCallback(items, callbackIn);
      const changes: StoreChange = {};
      Object.keys(items).forEach((k) => {
        changes[k] = { oldValue: memory.get(k), newValue: items[k] };
        memory.set(k, items[k]);
        persistKey(k);
      });
      notify(changes);
      if (callback) {
        callback();
        return;
      }
      return Promise.resolve();
    },
    remove(keysIn: string | string[], callbackIn?: () => void): Promise<void> | void {
      const callback = splitCallback(keysIn, callbackIn);
      const keys = (typeof keysIn === 'function' ? [] : keysIn) as string | string[];
      const list = typeof keys === 'string' ? [keys] : keys;
      const changes: StoreChange = {};
      list.forEach((k) => {
        changes[k] = { oldValue: memory.get(k) };
        memory.delete(k);
        persistKey(k);
      });
      notify(changes);
      if (callback) {
        callback();
        return;
      }
      return Promise.resolve();
    },
    clear(callbackIn?: () => void): Promise<void> | void {
      const callback = splitCallback(callbackIn, callbackIn);
      memory.clear();
      notify(
        Object.fromEntries([...memory.keys()].map((k) => [k, { oldValue: undefined }]))
      );
      if (callback) {
        callback();
        return;
      }
      return Promise.resolve();
    },
  };

  // 合并而不是覆盖：保留浏览器自带的 chrome.runtime/loadTimes 等属性
  const chromeHost = (existingChrome ?? {}) as Record<string, unknown>;
  chromeHost.storage = {
    local,
    // sync 仅供兜底调用，语义同 local（本项目只使用 local）
    sync: local,
    onChanged: {
      addListener(fn: StoreListener): void {
        listeners.add(fn);
      },
      removeListener(fn: StoreListener): void {
        listeners.delete(fn);
      },
    },
  };
  (globalThis as Record<string, unknown>).chrome = chromeHost;

  console.debug('[preview-shim] chrome.storage 内存兜底已注入（非扩展上下文）');
}

export {};
