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
  it('14 个工具且 id 唯一', () => {
    expect(QUICK_TOOLS).toHaveLength(14);
    expect(new Set(QUICK_TOOLS.map((t) => t.id)).size).toBe(14);
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
  it('jwt 解析头部与载荷', async () => {
    // HS256 示例 token：header {"alg":"HS256","typ":"JWT"}，payload 含 sub/name/iat
    const token =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
      '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ' +
      '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const out = await run('jwt', token);
    expect(out).toContain('--- Header ---');
    expect(out).toContain('"alg": "HS256"');
    expect(out).toContain('--- Payload ---');
    expect(out).toContain('"name": "John Doe"');
    // iat=1516239022：本地时区决定是 01-17 还是 01-18，CI 跑 UTC、本机跑 +08，
    // 所以只断言「能被读成日期时间」，不锁死具体日期。
    expect(out).toMatch(/iat: 2018-01-1[78] \d{2}:\d{2}:\d{2}/);
    expect(out).toContain('签名未校验');
  });
  it('jwt 容忍 Bearer 前缀与 base64url 变体', async () => {
    // payload 段含 -_ 字符（base64url），验证不需要手动补填充
    const token = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJhYmMifQ.';
    const out = await run('jwt', 'Bearer ' + token);
    expect(out).toContain('"alg": "none"');
    expect(out).toContain('"sub": "abc"');
    expect(out).toContain('无 exp 字段');
  });
  it('jwt 对非法输入给出可读提示', async () => {
    expect(await run('jwt', '')).toBe('');
    expect(await run('jwt', 'abc.def')).toContain('不是合法的 JWT');
  });
  it('htmlentity 转义与反转义', async () => {
    expect(await run('htmlentity', '<div class="a">')).toBe(
      '&lt;div class=&quot;a&quot;&gt;'
    );
    expect(await run('htmlentity', '&lt;div&gt;')).toBe('<div>');
    // & 必须最先替换，否则会被二次转义
    expect(await run('htmlentity', '&')).toBe('&amp;');
    expect(await run('htmlentity', 'a & b')).toBe('a &amp; b');
  });
  it('htmlentity 支持数字与不常见命名实体', async () => {
    expect(await run('htmlentity', '&#65;&#x42;')).toBe('AB');
    expect(await run('htmlentity', '&copy;&nbsp;&hellip;')).toBe('©\u00a0…');
    // 不认识的命名实体原样保留，并告知条数
    const out = await run('htmlentity', '&nosuchentity; &lt;');
    expect(out).toContain('&nosuchentity;');
    expect(out).toContain('1 个实体无法识别');
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
