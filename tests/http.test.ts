import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isExtensionOrigin, resolveFetchUrl, fetchJSON, type FetchJSONError } from '@/src/lib/http';

/**
 * 统一请求封装的核心行为：重试、超时、解析、错误结构化。
 * 被 useWeather / useWallpaper / WallpaperPanel 全量依赖，却没有一道闸——
 * 重试策略或解析分支漂移会直接变成线上白屏，这里钉死。
 *
 * import.meta.env.DEV 在 vitest 下为 false（生产语义），resolveFetchUrl 原样返回。
 */

/** 构造最小可用的 Response 替身；status=200 且 JSON content-type */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** 构造网络错误（无 name=AbortError） */
function networkError(): Error {
  return new Error('boom');
}

describe('http.isExtensionOrigin', () => {
  const OriginalLocation = globalThis.location;
  afterEach(() => {
    Object.defineProperty(globalThis, 'location', { value: OriginalLocation, configurable: true });
  });
  it('chrome-extension: 协议返回 true，其余（含无 location）返回 false', () => {
    Object.defineProperty(globalThis, 'location', { value: { protocol: 'chrome-extension:' }, configurable: true });
    expect(isExtensionOrigin()).toBe(true);
    Object.defineProperty(globalThis, 'location', { value: { protocol: 'http:' }, configurable: true });
    expect(isExtensionOrigin()).toBe(false);
    Object.defineProperty(globalThis, 'location', { value: undefined, configurable: true });
    expect(isExtensionOrigin()).toBe(false);
  });
});

describe('http.resolveFetchUrl', () => {
  it('生产语义下原样返回（无 DEV_API_PREFIX 注入）', () => {
    expect(resolveFetchUrl('https://api.pexels.com/v1/search?q=x')).toBe('https://api.pexels.com/v1/search?q=x');
    expect(resolveFetchUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('http.fetchJSON', () => {
  afterEach(() => vi.restoreAllMocks());

  it('成功：JSON 解析并按泛型返回，content-type 含 application/json 即走 json()', async () => {
    const data = { ok: true, count: 1 };
    const json = vi.fn(async () => data);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json; charset=utf-8' },
      json,
      text: vi.fn(),
    } as unknown as Response);
    const result = await fetchJSON<typeof data>('https://x.test/api');
    expect(result).toEqual(data);
    expect(json).toHaveBeenCalledOnce();
  });

  it('成功：非 JSON content-type 走 text()', async () => {
    const text = vi.fn(async () => 'plain body');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/plain' },
      json: vi.fn(),
      text,
    } as unknown as Response);
    expect(await fetchJSON('https://x.test/a')).toBe('plain body');
    expect(text).toHaveBeenCalledOnce();
  });

  it('网络错误默认重试：第 3 次成功时返回，共调用 fetch 3 次', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    const result = await fetchJSON('https://x.test/retry', { retries: 2, retryDelay: 1, backoff: 1 });
    expect(result).toEqual({ ok: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('网络错误重试耗尽：抛 NETWORK_ERROR，cause 保留原始错误，url 正确', async () => {
    const boom = networkError();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(boom);
    await expect(fetchJSON('https://x.test/net', { retries: 1, retryDelay: 1 }))
      .rejects.toMatchObject({ code: 'NETWORK_ERROR', url: 'https://x.test/net', cause: boom });
  });

  it('超时（AbortError）：抛 ABORT_ERROR，code 正确', async () => {
    const abort = new Error('aborted');
    Object.defineProperty(abort, 'name', { value: 'AbortError' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abort);
    await expect(fetchJSON('https://x.test/timeout'))
      .rejects.toMatchObject({ code: 'ABORT_ERROR', message: '请求超时' });
  });

  it('429 / 5xx 默认重试', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse('rate limited', 429))
      .mockResolvedValueOnce(jsonResponse('server error', 503))
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    expect(await fetchJSON('https://x.test/rate', { retries: 2, retryDelay: 1 })).toEqual({ ok: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('4xx 不重试；错误带 status/body', async () => {
    const noRetry = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse('bad request', 400));
    await expect(fetchJSON('https://x.test/bad', { retries: 3, retryDelay: 1 }))
      .rejects.toMatchObject({ code: 'HTTP_ERROR', status: 400, body: 'bad request' });
    expect(noRetry).toHaveBeenCalledTimes(1);
  });

  it('retryOn 自定义策略优先：可放行默认会重试的网络错误', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(networkError());
    await expect(fetchJSON('https://x.test/custom', {
      retries: 2,
      retryDelay: 1,
      retryOn: () => false,
    })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('JSON 解析失败时错误对象带 parseError', async () => {
    const parseErr = new Error('bad json');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => 'application/json' },
      json: async () => { throw parseErr; },
      text: async () => '',
    } as unknown as Response);
    await expect(fetchJSON('https://x.test/parse'))
      .rejects.toMatchObject({ code: 'HTTP_ERROR', status: 500, parseError: parseErr });
  });
});
