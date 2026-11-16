/**
 * 统一请求封装（移植自 legacy utils/request.js，语义逐行等价）：
 * 超时（AbortController）、重试（指数退避）、429/5xx 与网络错误默认重试、
 * JSON/文本自动解析、错误对象带 code/status/url/body。
 *
 * 本地调试反代：见 resolveFetchUrl()。
 */

/**
 * 开发期反代前缀。由 wxt.config.ts 的 vite server.proxy 注入（只在 dev 构建里存在），
 * 生产构建时 import.meta.env.DEV === false，这里恒为 undefined，
 * 所有请求原样直连 —— 线上行为与加反代之前逐字节一致。
 */
const DEV_API_PREFIX: string | undefined = import.meta.env.DEV
    ? import.meta.env.DEV_API_PREFIX
    : undefined;

/**
 * 把绝对接口地址改写成同源反代路径，绕开本地预览页（127.0.0.1:xxxx）的跨域限制。
 *
 * WXT_VUE3_API_PROXY=1 wxt dev 时 /__api/<host>/<path> 会被 vite 代理到
 * https://<host>/<path>，页面侧看到的是同源请求，不会有 CORS 预检；
 * 扩展内的正式运行走 chrome-extension:// 源 + host_permissions，用绝对地址，
 * 因此这里只在 DEV 生效，且只改写白名单里的域名。
 */
const DEV_PROXY_HOSTS = [
    'api.pexels.com',
    'images.pexels.com',
    'restapi.amap.com',
    'api.open-meteo.com',
    'geocoding-api.open-meteo.com',
    'wallhaven.cc',
    'w.wallhaven.cc',
    'th.wallhaven.cc',
    'picsum.photos',
    'www.google.com', // 站点 favicon 服务（s2/favicons，会 301 到下面这个）
    't0.gstatic.com',
];

/** 是否运行在 chrome-extension:// 里：那里跨域 fetch 由 host_permissions 兜底，不走反代 */
export function isExtensionOrigin(): boolean {
    return typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
}

export function resolveFetchUrl(url: string): string {
    if (!DEV_API_PREFIX || isExtensionOrigin()) return url;
    let u: URL;
    try {
        u = new URL(url, typeof location === 'undefined' ? undefined : location.href);
    } catch {
        return url;
    }
    if (u.protocol !== 'https:' || !DEV_PROXY_HOSTS.includes(u.hostname)) return url;
    return `${DEV_API_PREFIX}${u.host}${u.pathname}${u.search}`;
}
export interface FetchJSONOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
    retries?: number;
    retryDelay?: number;
    backoff?: number;
    retryOn?: (ctx: { attempt: number; error: unknown; response: Response | null }) => boolean;
}

export interface FetchJSONError extends Error {
    code?: 'ABORT_ERROR' | 'NETWORK_ERROR' | 'HTTP_ERROR';
    status?: number;
    url?: string;
    body?: unknown;
    cause?: unknown;
    parseError?: unknown;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchJSON<T = unknown>(
    url: string,
    options: FetchJSONOptions = {}
): Promise<T> {
    const {
        method = 'GET',
        headers,
        body,
        timeout = 10000,
        retries = 0,
        retryDelay = 500,
        backoff = 2,
        retryOn,
    } = options;
    const shouldRetry = (attempt: number, error: unknown, response: Response | null): boolean => {
        if (typeof retryOn === 'function') return retryOn({ attempt, error, response });
        if (error) return true; // 网络错误/超时默认可重试
        if (!response) return false;
        return response.status === 429 || (response.status >= 500 && response.status < 600);
    };

    let attempt = 0;

    for (;;) {
        const controller = new AbortController();
        const abortId = setTimeout(() => controller.abort(), timeout);
        let response: Response;
        try {
            response = await fetch(resolveFetchUrl(url), {
                method,
                headers,
                body,
                signal: controller.signal,
            });
        } catch (err) {
            clearTimeout(abortId);
            if (attempt < retries && shouldRetry(attempt, err, null)) {
                await sleep(retryDelay * Math.pow(backoff, attempt));
                attempt++;
                continue;
            }
            const error = new Error(
                (err as { name?: string })?.name === 'AbortError' ? '请求超时' : '网络错误'
            ) as FetchJSONError;
            error.code =
                (err as { name?: string })?.name === 'AbortError' ? 'ABORT_ERROR' : 'NETWORK_ERROR';
            error.cause = err;
            error.url = url;
            throw error;
        } finally {
            clearTimeout(abortId);
        }

        let data: unknown;
        let parseError: unknown;
        const contentType = response.headers.get('content-type') || '';
        try {
            data = contentType.includes('application/json')
                ? await response.json()
                : await response.text();
        } catch (err) {
            parseError = err;
        }

        if (response.ok) return data as T;

        if (attempt < retries && shouldRetry(attempt, null, response)) {
            await sleep(retryDelay * Math.pow(backoff, attempt));
            attempt++;
            continue;
        }

        const error = new Error('HTTP ' + response.status) as FetchJSONError;
        error.code = 'HTTP_ERROR';
        error.status = response.status;
        error.url = url;
        error.body = typeof data === 'string' ? data.slice(0, 500) : data;
        if (parseError) error.parseError = parseError;
        throw error;
    }
}
