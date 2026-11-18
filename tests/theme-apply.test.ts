/**
 * useTheme.applyTheme 幂等写入测试。
 *
 * applyTheme 被 60s 定时器与多处状态变更反复触发；优化前每次都无条件写 3 个 DOM 属性
 * （触发样式重算）+ 1 个 ref。优化后写前读比对，值相同就不写。本测试用受控 DOM 桩
 * 精确计数 setAttribute 调用次数——这就是性能优化的可量化验收，不靠感觉。
 *
 * vitest environment=node（无 jsdom），故这里手动桩 document.documentElement；
 * applyTheme 只用到 getAttribute / setAttribute / style.colorScheme 三处。
 * 用 useTheme().preview() 设置内存态，避免触碰 chrome.storage。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyTheme, useTheme } from '@/src/composables/useTheme';

interface FakeRoot {
  attrs: Map<string, string>;
  style: { colorScheme: string };
  setCalls: string[];
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

let root: FakeRoot;

function makeRoot(): FakeRoot {
  const r: FakeRoot = {
    attrs: new Map(),
    style: { colorScheme: '' },
    setCalls: [],
    getAttribute(name) {
      return r.attrs.get(name) ?? null;
    },
    setAttribute(name, value) {
      r.setCalls.push(name);
      r.attrs.set(name, value);
    },
  };
  return r;
}

beforeEach(() => {
  root = makeRoot();
  vi.stubGlobal('document', { documentElement: root });
  // mode=dark 时 resolve() 直接返回，不触碰 window.matchMedia
  useTheme().preview({ mode: 'dark' });
  root.setCalls.length = 0; // 清掉初始化那次写入，只统计被测调用
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('applyTheme 幂等写入（性能）', () => {
  it('首次写入三个属性（无比对基线时正常落值）', () => {
    const fresh = makeRoot();
    vi.stubGlobal('document', { documentElement: fresh });
    applyTheme();
    expect(fresh.attrs.get('data-theme')).toBe('dark');
    expect(fresh.attrs.get('data-theme-mode')).toBe('dark');
    expect(fresh.style.colorScheme).toBe('dark');
    expect(fresh.setCalls).toEqual(['data-theme', 'data-theme-mode']);
  });

  it('主题未变时重复调用，零次 DOM 写入（核心性能验收）', () => {
    applyTheme();
    applyTheme();
    applyTheme();
    expect(root.setCalls).toEqual([]);
  });

  it('外部改了 data-theme 时自愈：检测到不一致才写回', () => {
    root.attrs.set('data-theme', 'light'); // 模拟外部脚本/DevTools 改动
    applyTheme();
    expect(root.setCalls).toEqual(['data-theme']);
    expect(root.attrs.get('data-theme')).toBe('dark');
  });

  it('colorScheme 不一致时单独补齐，不连带重写其他两个属性', () => {
    root.style.colorScheme = 'light';
    applyTheme();
    expect(root.setCalls).toEqual([]); // style.colorScheme 直接赋值，不计入 setAttribute
    expect(root.style.colorScheme).toBe('dark');
  });
});
