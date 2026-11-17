import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyText } from '@/src/lib/clipboard';

/**
 * 本项目 vitest 跑在 node 环境（没有 jsdom，也不打算为一个工具函数引入它）。
 * copyText 的降级路径只用到 document 的四个动作：createElement / body.appendChild /
 * select / remove，这里用最小 stub 顶替，既能验证行为，又不增加依赖。
 */
interface FakeTextarea {
  value: string;
  style: Record<string, string>;
  selected: boolean;
  removed: boolean;
  select(): void;
  remove(): void;
}

function installFakeDocument(execCommand: () => boolean): {
  nodes: FakeTextarea[];
  execCalls: string[];
} {
  const nodes: FakeTextarea[] = [];
  const execCalls: string[] = [];
  const doc = {
    createElement: () => {
      const ta: FakeTextarea = {
        value: '',
        style: {},
        selected: false,
        removed: false,
        select() {
          ta.selected = true;
        },
        remove() {
          ta.removed = true;
          const i = nodes.indexOf(ta);
          if (i >= 0) nodes.splice(i, 1);
        },
      };
      nodes.push(ta);
      return ta;
    },
    body: { appendChild: () => undefined },
    execCommand: (cmd: string) => {
      execCalls.push(cmd);
      return execCommand();
    },
  };
  vi.stubGlobal('document', doc);
  return { nodes, execCalls };
}

describe('clipboard.copyText', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('空文本直接返回 false，不碰剪贴板也不建节点', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { nodes } = installFakeDocument(() => true);
    expect(await copyText('')).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(nodes).toHaveLength(0);
  });

  it('优先走 navigator.clipboard.writeText', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { nodes, execCalls } = installFakeDocument(() => true);
    expect(await copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    // 主路径成功时不该碰降级
    expect(execCalls).toHaveLength(0);
    expect(nodes).toHaveLength(0);
  });

  it('clipboard 被拒时降级 execCommand 并清掉临时节点', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('denied')) },
    });
    const { nodes, execCalls } = installFakeDocument(() => true);
    expect(await copyText('fallback')).toBe(true);
    expect(execCalls).toEqual(['copy']);
    // 临时 textarea 必须清理，否则每失败一次就漏一个节点
    expect(nodes).toHaveLength(0);
  });

  it('两条路径都失败时返回 false，同样不留节点', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('denied')) },
    });
    const { nodes } = installFakeDocument(() => false);
    expect(await copyText('x')).toBe(false);
    expect(nodes).toHaveLength(0);
  });

  it('execCommand 自身抛错也按失败处理，不向上抛', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('denied')) },
    });
    const { nodes } = installFakeDocument(() => {
      throw new Error('not supported');
    });
    expect(await copyText('x')).toBe(false);
    expect(nodes).toHaveLength(0);
  });
});
