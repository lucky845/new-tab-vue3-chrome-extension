import { describe, it, expect } from 'vitest';
import {
  REMOTE_ICON,
  firstCharOf,
  isDataImage,
  isRemoteIcon,
  siteIconUrl,
} from '@/src/lib/iconSafe';

/**
 * iconSafe 的 DOM 无关分类闸门。
 *
 * AppIcon.vue 用这几个函数决定走哪条渲染分支：
 *   logoSrc   ← isDataImage（用户裁剪成品，不套远程蒙版）
 *   imgSrc    ← siteIconUrl（faviconV2 远程图，套 70% + squircle 蒙版）
 *   isRemoteImg ← !logoSrc && !isSvgIcon（蒙版只作用远程图）
 * 它们一旦漂移，「两层图标」这类回归就会回来，所以单独钉死。
 *
 * parseSvg / parseImage / createIconNode 依赖 DOMParser + document，
 * 当前 vitest 跑在 node 环境且项目不引入新依赖，暂不纳入本文件。
 */
describe('iconSafe.firstCharOf', () => {
  it('空名兜底为问号', () => {
    expect(firstCharOf('')).toBe('?');
    expect(firstCharOf(undefined as unknown as string)).toBe('?');
  });
  it('汉字取本字，不受 upper 影响', () => {
    expect(firstCharOf('知乎')).toBe('知');
    expect(firstCharOf('知乎', false)).toBe('知');
  });
  it('拉丁字母按 upper 决定大小写', () => {
    expect(firstCharOf('github')).toBe('G');
    expect(firstCharOf('github', false)).toBe('g');
    expect(firstCharOf('V2EX')).toBe('V');
  });
});

describe('iconSafe.isDataImage', () => {
  it('只认 png/jpeg/webp 的 base64 data URI（允许前后空格）', () => {
    expect(isDataImage('data:image/png;base64,AAA')).toBe(true);
    expect(isDataImage('data:image/jpeg;base64,AAA')).toBe(true);
    expect(isDataImage('  data:image/webp;base64,AAA  ')).toBe(true);
    expect(isDataImage('DATA:IMAGE/PNG;BASE64,AAA')).toBe(true);
  });
  it('拒绝 svg data URI、文本 data URI 与远程 URL', () => {
    expect(isDataImage('data:image/svg+xml,<svg/>')).toBe(false);
    expect(isDataImage('data:text/html,x')).toBe(false);
    expect(isDataImage('https://example.com/a.png')).toBe(false);
    expect(isDataImage('')).toBe(false);
  });
});

describe('iconSafe.isRemoteIcon', () => {
  it('trim 后只放行 http(s)', () => {
    expect(isRemoteIcon('https://example.com/a.png')).toBe(true);
    expect(isRemoteIcon('  http://example.com  ')).toBe(true);
  });
  it('拒绝协议相对 / data / javascript / 空值', () => {
    expect(isRemoteIcon('//example.com/a.png')).toBe(false);
    expect(isRemoteIcon('data:image/png;base64,AAA')).toBe(false);
    expect(isRemoteIcon('javascript:alert(1)')).toBe(false);
    expect(isRemoteIcon('')).toBe(false);
  });
});

describe('iconSafe.siteIconUrl', () => {
  it('空域名不生成 URL', () => {
    expect(siteIconUrl('')).toBe('');
    expect(siteIconUrl('   ')).toBe('');
  });
  it('固定走 faviconV2 直链，query 参数完整（不申请 host 权限）', () => {
    const url = new URL(siteIconUrl('github.com'));
    expect(url.origin + url.pathname).toBe('https://t0.gstatic.com/faviconV2');
    expect(url.searchParams.get('client')).toBe('SOCIAL');
    expect(url.searchParams.get('type')).toBe('FAVICON');
    expect(url.searchParams.get('fallback_opts')).toBe('TYPE,SIZE,URL');
    expect(url.searchParams.get('url')).toBe('https://github.com');
    expect(url.searchParams.get('size')).toBe('128');
  });
  it('size 可覆盖，域名 trim', () => {
    const url = new URL(siteIconUrl('  v2ex.com  ', 64));
    expect(url.searchParams.get('url')).toBe('https://v2ex.com');
    expect(url.searchParams.get('size')).toBe('64');
  });
});

describe('iconSafe.REMOTE_ICON', () => {
  it('是空串哨兵：表示「没有内嵌 SVG，走 faviconV2」', () => {
    expect(REMOTE_ICON).toBe('');
  });
});
