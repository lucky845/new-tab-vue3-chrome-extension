import { describe, it, expect, vi } from 'vitest';
import { isHttp, isImageSource, safeHref, safeOpen } from '@/src/lib/urlSafe';

describe('urlSafe.isHttp', () => {
  it('只放行 http(s)', () => {
    expect(isHttp('http://example.com')).toBe(true);
    expect(isHttp('https://example.com/a?b=1')).toBe(true);
    expect(isHttp('  https://example.com  ')).toBe(true);
  });
  it('拒绝 javascript:/data:/file:/协议相对/空值/非字符串', () => {
    expect(isHttp('javascript:alert(1)')).toBe(false);
    expect(isHttp('data:text/html,x')).toBe(false);
    expect(isHttp('file:///etc/passwd')).toBe(false);
    expect(isHttp('//example.com')).toBe(false);
    expect(isHttp('')).toBe(false);
    expect(isHttp('   ')).toBe(false);
    expect(isHttp(undefined as unknown as string)).toBe(false);
  });
});

describe('urlSafe.isImageSource', () => {
  it('收 http(s) 网络图、data:image 与扩展内相对图片路径', () => {
    expect(isImageSource('https://img.example.com/a.jpg')).toBe(true);
    expect(isImageSource('data:image/png;base64,AAA')).toBe(true);
    expect(isImageSource('img/wallpaper.webp')).toBe(true);
    expect(isImageSource('/assets/a.gif')).toBe(true);
  });
  it('local: 哨兵不是图片来源（备份清洗依赖这个判定）', () => {
    expect(isImageSource('local:123456')).toBe(false);
  });
  it('拒绝危险协议与非图片', () => {
    expect(isImageSource('javascript:alert(1)')).toBe(false);
    expect(isImageSource('data:text/html,x')).toBe(false);
    // 源码对 http(s) 一律放行（壁纸地址来自受信任配置），不按扩展名过滤
    expect(isImageSource('https://example.com/page.html')).toBe(true);
  });
});

describe('urlSafe.safeHref', () => {
  it('安全地址 trim 后原样返回，不安全退化成 #', () => {
    expect(safeHref('  https://example.com  ')).toBe('https://example.com');
    expect(safeHref('javascript:alert(1)')).toBe('#');
    expect(safeHref('')).toBe('#');
  });
});

describe('urlSafe.safeOpen', () => {
  it('拒绝不安全地址且不调用 window.open', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    expect(safeOpen('javascript:alert(1)')).toBe(false);
    expect(open).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('安全地址以 noopener,noreferrer 打开', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    expect(safeOpen(' https://example.com ')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    vi.unstubAllGlobals();
  });
});
