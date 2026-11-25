import { defineConfig } from 'wxt';

/**
 * 本地调试反代（可选）。WXT_VUE3_API_PROXY=1 wxt dev 打开。
 *
 * 为什么要它：用静态服务器预览 .output、或直接以 http:// 打开页面时，
 * 页面源是 http://127.0.0.1:xxxx，调 api.open-meteo.com / wallhaven.cc 这类接口
 * 会撞 CORS（对方不会给这个源发 Access-Control-Allow-Origin）。扩展正式运行时有
 * host_permissions 兜底，不受影响 —— 所以反代只在 dev 生效、且默认关闭。
 *
 * 打开后页面侧请求 /__api/<host>/<path>，vite 转成 https://<host>/<path>。
 * 客户端那一侧的同源改写见 src/lib/http.ts 的 resolveFetchUrl()。
 */
const API_PROXY = process.env.WXT_VUE3_API_PROXY === '1';
const PROXY_PREFIX = '/__api';

/** 需要反代的接口主机 → 目标源（vite proxy 每条规则只吃一个 host） */
const PROXY_TARGETS: Record<string, string> = {
    'api.pexels.com': 'https://api.pexels.com',
    'images.pexels.com': 'https://images.pexels.com',
    'restapi.amap.com': 'https://restapi.amap.com',
    'api.open-meteo.com': 'https://api.open-meteo.com',
    'geocoding-api.open-meteo.com': 'https://geocoding-api.open-meteo.com',
    'wallhaven.cc': 'https://wallhaven.cc',
    'w.wallhaven.cc': 'https://w.wallhaven.cc',
    'th.wallhaven.cc': 'https://th.wallhaven.cc',
    'picsum.photos': 'https://picsum.photos',
    't0.gstatic.com': 'https://t0.gstatic.com',
    'www.google.com': 'https://www.google.com',
};

type ProxyRule = {
    target: string;
    changeOrigin: boolean;
    secure: boolean;
    rewrite: (path: string) => string;
};

function buildProxy(): Record<string, ProxyRule> {
    const proxy: Record<string, ProxyRule> = {};
    if (!API_PROXY) return proxy;
    for (const [host, target] of Object.entries(PROXY_TARGETS)) {
        const base = PROXY_PREFIX + '/' + host;
        proxy[base] = {
            target,
            changeOrigin: true,
            secure: true,
            rewrite: (path: string) => path.slice(base.length) || '/',
        };
    }
    return proxy;
}

// WXT 配置：newtab.html 作为 unlisted page 入口，chrome_url_overrides 由入口 html 的
// <meta name="manifest.chrome_url_overrides"> 决定（见 entrypoints/newtab.html）。
export default defineConfig({
    // @wxt-dev/i18n 把 locales/<lang>.yml 编进 _locales/，并让 manifest 的 __MSG_*__ 与
    // 运行时取词（#i18n 的 i18n.t）共用同一份文案。注意：它本身只跟随浏览器语言，无运行时切换，
    // 用户在设置里选语言的逻辑在 src/lib/i18n.ts 里自己实现。
    modules: ['@wxt-dev/module-vue', '@wxt-dev/i18n/module'],
    srcDir: '.',
    entrypointsDir: 'entrypoints',
    outDir: '.output',

    // 反代只在 WXT_VUE3_API_PROXY=1 时注入；同时把前缀透给客户端（import.meta.env.DEV_API_PREFIX）
    vite: () => ({
        define: {
            'import.meta.env.DEV_API_PREFIX': JSON.stringify(API_PROXY ? PROXY_PREFIX : undefined),
        },
        server: {
            proxy: buildProxy(),
        },
    }),
    manifest: {
        name: '__MSG_appName__',
        description: '__MSG_appDescription__',
        default_locale: 'zh_CN',
        version: '2.2.3',

        // 新标签页是唯一入口，不需要后台脚本，也不需要 content script。
        // storage：壁纸 / 快捷访问 / 待办 / 便签 / 设置全部落在这里。
        // geolocation：天气组件取本地天气。首次使用会弹系统授权。
        permissions: ['storage', 'geolocation'],

        // 壁纸缓存用 fetch 取原图字节（不经 <img>），跨域 fetch 必须走 host_permissions，
        // 它不依赖对方返回 Access-Control-Allow-Origin。加图床 CDN 域名是因为
        // picsum / pexels 会 302 到自己的 CDN，只放行主域会漏掉重定向后那一跳。
        host_permissions: [
            'https://api.pexels.com/',
            'https://images.pexels.com/',
            'https://restapi.amap.com/',
            'https://api.open-meteo.com/',
            'https://geocoding-api.open-meteo.com/',
            'https://wallhaven.cc/',
            'https://th.wallhaven.cc/',
            'https://w.wallhaven.cc/',
            'https://picsum.photos/',
            'https://*.picsum.photos/',
            // 这里刻意没有 '*://*/*'：站点图标只经 <img> 显示，走 CSP 的 img-src 白名单，
            // 不需要任何站点的访问权。见 doc/PRIVACY.md。
        ],

        // 图标沿用 public/icons/（WXT 不自动发现，必须显式声明；缺了会显示默认拼图图标）。
        icons: {
            16: 'icons/icon16.png',
            48: 'icons/icon48.png',
            128: 'icons/icon128.png',
        },

        // 工具栏图标点击直接开新标签页（新标签页本身就是产品，点开即用）。
        action: {
            default_title: 'New Tab Pro',
        },

        // MV3 的 extension_pages CSP 只允许 'self'/'none'/'wasm-unsafe-eval'，
        // worker-src blob: 会被 Chrome 直接拒载整个 manifest（实测报错
        // Insecure CSP value "blob:" in directive 'worker-src'）。
        // liquidglass 的 Blob Worker 被 CSP 拦截后会走库内正式降级路径：
        // requestLensMap(!active) → generateLensMap() 主线程同步生成位移贴图，
        // 结果按 lensMapKey 缓存，仅首次 attach / resize 换 key 时算一次，可接受。
        content_security_policy: {
            extension_pages:
                "script-src 'self'; object-src 'self'; img-src 'self' data: blob: " +
                'https://t0.gstatic.com https://t1.gstatic.com https://t2.gstatic.com https://t3.gstatic.com ' +
                'https://picsum.photos https://fastly.picsum.photos https://*.picsum.photos ' +
                'https://images.pexels.com https://th.wallhaven.cc https://w.wallhaven.cc',
        },
    },
});
