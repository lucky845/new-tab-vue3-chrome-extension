/// <reference types="chrome" />
/**
 * chrome.storage.local 响应式封装（Vue3 版统一持久化入口）。
 *
 * 契约（与 legacy 各 manager 完全一致，老用户数据无损）：
 * - 存的是裸对象（chrome.storage 自带结构化克隆），不是 JSON 字符串
 * - key 一字不差沿用 legacy（'todos' / 'notes' / 'settings' / 'customEngines' ...）
 * - 本组件写入时忽略 onChanged 回声；外部写入（其它上下文）自动拉回最新值
 */
import { ref, toRaw, watch, type Ref } from 'vue';

let bound = false;
const keyListeners = new Set<(key: string) => void>();

/** 结构化相等：用于切断「同值新对象 → deep watch → set → onChanged」回环。 */
function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function ensureOnChange(): void {
  if (bound) return;
  bound = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of Object.keys(changes)) keyListeners.forEach((fn) => fn(key));
  });
}

export interface StoredOptions<T> {
  /** 存储原始值 → 响应式值（迁移/兜底）；缺省原样返回 */
  load?: (raw: unknown) => T;
  /** 响应式值 → 存储值（写前变换）；缺省原样写入 */
  save?: (value: T) => unknown;
}

export function useStored<T>(key: string, initial: T, options: StoredOptions<T> = {}): Ref<T> {
  ensureOnChange();
  const load = options.load ?? ((raw: unknown) => raw as T);
  const state = ref(initial) as Ref<T>;
  let hydrated = false;
  // lastWritten 保存「上一次写入存储的原始形态」，而不是 load() 迁移后的形态：
  // useTodo/useNotes/usePomodoro 的 load 会把旧格式迁移成新对象，迁移结果必须能落盘。
  let lastWritten: string | null = null;

  const apply = (raw: unknown): void => {
    if (raw === undefined) return;
    const next = load(raw);
    lastWritten = stableStringify(raw);
    if (stableStringify(state.value) !== stableStringify(next)) state.value = next;
  };

  void chrome.storage.local.get([key]).then((result) => {
    apply(result[key]);
    hydrated = true;
  });

  const listener = (changed: string): void => {
    if (changed !== key || !hydrated) return;
    void chrome.storage.local.get([key]).then((result) => apply(result[key]));
  };
  keyListeners.add(listener);

  watch(
    state,
    (value) => {
      if (!hydrated) return;
      const saved = options.save ? options.save(value) : value;
      // 关键：chrome.storage 的结构化克隆会把 Vue 响应式 Proxy 当普通对象序列化
      // （数组被写成 {"0":...} 字典），写回后 get 读到的不是数组 → load 兜底清空。
      // 必须先转成纯数据（toRaw + JSON 深拷贝，同时剥离嵌套 Proxy）再落盘。
      const payload = JSON.parse(JSON.stringify(toRaw(saved) ?? null)) as T;
      const serialized = stableStringify(payload);
      // 自身写入回声、同值重赋值直接短路：这是 833 次写盘的根因闸门。
      if (serialized === lastWritten) return;
      lastWritten = serialized;
      void chrome.storage.local.set({ [key]: payload });
    },
    { deep: true },
  );

  return state;
}
