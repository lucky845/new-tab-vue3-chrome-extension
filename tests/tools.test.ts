import { describe, it, expect } from 'vitest';
import { QUICK_TOOLS, QUICK_TOOLS_FEATURED } from '@/src/config/tools';

const tool = (id: string) => {
  const t = QUICK_TOOLS.find((x) => x.id === id);
  if (!t) throw new Error('missing tool ' + id);
  return t;
};
const run = (id: string, input: string): string | Promise<string> => {
  const t = tool(id);
  if (!t.run) throw new Error('tool has no run: ' + id);
  return t.run(input);
};

describe('tools 定义', () => {
  it('12 个工具且 id 唯一', () => {
    expect(QUICK_TOOLS).toHaveLength(12);
    expect(new Set(QUICK_TOOLS.map((t) => t.id)).size).toBe(12);
  });
  it('精选位只引用存在的工具 id', () => {
    expect(QUICK_TOOLS_FEATURED).toHaveLength(6);
    QUICK_TOOLS_FEATURED.forEach((id) => expect(QUICK_TOOLS.some((t) => t.id === id)).toBe(true));
  });
});

describe('tools transform', () => {
  it('json 格式化与错误提示', async () => {
    expect(await run('json', '{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(await run('json', '{bad')).toContain('JSON 解析失败');
    expect(await run('json', '')).toBe('');
  });
  it('base64 编解码自动判别', async () => {
    expect(await run('base64', 'hello')).toBe('aGVsbG8=');
    expect(await run('base64', 'aGVsbG8=')).toBe('hello');
    expect(await run('base64', '你好')).toBe('5L2g5aW9');
  });
  it('url 编解码自动判别', async () => {
    expect(await run('url', 'hello world')).toBe('hello%20world');
    expect(await run('url', 'hello%20world')).toBe('hello world');
  });
  it('radix 进制转换', async () => {
    expect(await run('radix', '42')).toBe('十进制: 42\n十六进制: 0x2A\n八进制: 0o52\n二进制: 0b101010');
    expect(await run('radix', '0x2A')).toContain('十进制: 42');
    expect(await run('radix', 'zzz')).toBe('无法识别的数字格式');
  });
  it('case 大小写/驼峰/下划线', async () => {
    const out = await run('case', 'hello world');
    expect(out).toContain('大写: HELLO WORLD');
    expect(out).toContain('驼峰: helloWorld');
    expect(out).toContain('下划线: hello_world');
  });
  it('dedupe 按行去重保序', async () => {
    expect(await run('dedupe', 'a\nb\na')).toContain('去重后 2 / 3 行');
    expect(await run('dedupe', 'a\nb\na')).toContain('\na\nb');
  });
  it('wordcount 统计', async () => {
    expect(await run('wordcount', 'hello world')).toContain('字符: 11');
    expect(await run('wordcount', 'hello world')).toContain('词/汉字: 2');
  });
  it('color hex 转 rgb/hsl', async () => {
    const out = await run('color', '#ff0000');
    expect(out).toContain('HEX: #FF0000');
    expect(out).toContain('RGB: rgb(255, 0, 0)');
    expect(out).toContain('HSL: hsl(0, 100%, 50%)');
  });
  it('hash 输出 64 位 SHA-256', async () => {
    expect(await run('hash', 'hello')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('tools generate', () => {
  it('uuid 符合 v4 格式', () => {
    const uuid = tool('uuid').action!();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
  it('password 20 位', () => {
    expect(tool('password').action!()).toHaveLength(20);
  });
});
