/**
 * 图标解析：把用户输入的图标（内嵌 SVG 字符串或远程图片 URL）安全地转成 DOM 节点。
 *
 * 为什么不能直接 innerHTML：图标字符串来自用户在"新增快捷访问"里的粘贴，
 * 会持久化进 chrome.storage，属于可被第三方诱导输入的存储型注入面
 * （<svg onload=...>、以及 URL 里拼 "><img src=x onerror=...> 都能执行）。
 *
 * 这里改用 DOMParser 解析到惰性文档中：解析期间不执行脚本、不加载图片，
 * 再逐节点按白名单重建，任何 on* 事件属性、<script>、<foreignObject> 一律丢弃。
 * （移植自 v1.8.1:js/utils/icon-safe.js，语义逐行等价。）
 */

// 允许保留的 SVG 元素
const ALLOWED_SVG_TAGS = new Set([
    'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
    'title', 'desc', 'defs', 'lineargradient', 'radialgradient', 'stop',
    'clippath', 'mask', 'pattern', 'text', 'tspan',
]);

// 允许保留的 SVG 表现属性（一律按字符串设置，不进 innerHTML）
const ALLOWED_ATTRS = new Set([
    'viewBox', 'width', 'height', 'fill', 'fill-rule', 'fill-opacity',
    'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity',
    'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
    'transform', 'preserveAspectRatio', 'offset', 'stop-color', 'stop-opacity',
    'gradientUnits', 'gradientTransform', 'id', 'class', 'style',
]);

// 只保留纯颜色/尺寸类声明，拒绝 url()、expression()、behavior 这类可触发请求或脚本的写法
const SAFE_STYLE_DECL =
    /^(fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-dasharray|stroke-opacity|fill-opacity|opacity|color)\s*:\s*[a-z0-9#()%,.\s-]+$/i;

function isSafeStyle(style: string): boolean {
    if (!style || /url\s*\(|expression\s*\(|behavior|javascript:/i.test(style)) return false;
    return style
        .split(';')
        .map((decl) => decl.trim())
        .filter(Boolean)
        .every((decl) => SAFE_STYLE_DECL.test(decl));
}

function sanitizeNode(node: Element, doc: Document): SVGSVGElement | null {
    const tag = node.tagName.toLowerCase();
    if (!ALLOWED_SVG_TAGS.has(tag)) return null;

    const el = doc.createElementNS('http://www.w3.org/2000/svg', tag) as SVGSVGElement;
    for (const attr of Array.from(node.attributes)) {
        const name = attr.name;
        const lower = name.toLowerCase();
        // 事件属性、javascript: 链接、外部引用一律丢弃
        if (lower.startsWith('on')) continue;
        if (lower === 'href' || lower === 'xlink:href') continue;
        if (!ALLOWED_ATTRS.has(name) && !ALLOWED_ATTRS.has(lower)) continue;
        if (lower === 'style' && !isSafeStyle(attr.value)) continue;
        el.setAttribute(name, attr.value);
    }

    for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
            // 文本节点：只允许在 text/tspan/title/desc 内出现
            if (['text', 'tspan', 'title', 'desc'].includes(tag)) {
                el.appendChild(doc.createTextNode(child.nodeValue ?? ''));
            }
        } else if (child.nodeType === 1) {
            const safeChild = sanitizeNode(child as Element, doc);
            if (safeChild) el.appendChild(safeChild);
        }
    }
    return el;
}

// 近白填充：内置图标统一用 #e6e6e6，纯白/白色关键字一并算进来
const LIGHT_FILL_RE =
    /^(#e6e6e6|#eee|#eeeeee|#fff|#ffffff|white|rgba?\(\s*255\s*,\s*255\s*,\s*255[^)]*\))$/i;

/**
 * 这个 SVG 是不是「单色近白」图标（决定浅色主题要不要反相）。
 * 判定从严：必须至少有一个 fill，且所有 fill 都是近白；任何彩色/var()/currentColor 一律不算。
 */
function isMonoLight(svg: SVGSVGElement): boolean {
    const nodes = [svg as unknown as Element].concat(Array.from(svg.querySelectorAll('[fill], [style]')));
    let seenFill = 0;
    for (const node of nodes) {
        const fill = (node.getAttribute && node.getAttribute('fill')) || '';
        const style = (node.getAttribute && node.getAttribute('style')) || '';
        const styleFill = /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(style);
        const value = (fill || (styleFill ? styleFill[1] : '')).trim();
        if (!value) continue;
        if (!LIGHT_FILL_RE.test(value)) return false;
        seenFill++;
    }
    return seenFill > 0;
}

/**
 * 解析 SVG 字符串 -> 安全 <svg> 元素；失败返回 null
 */
export function parseSvg(svgText: string): SVGSVGElement | null {
    if (typeof svgText !== 'string' || !svgText.trim().toLowerCase().startsWith('<svg')) {
        return null;
    }
    const payload = svgText.trim();
    // DOMParser 解析的是惰性文档：不执行脚本、不发起请求
    const parsed = new DOMParser().parseFromString(payload, 'image/svg+xml');
    if (parsed.querySelector('parsererror')) return null;

    const root = parsed.documentElement;
    if (!root || root.tagName.toLowerCase() !== 'svg') return null;

    const safe = sanitizeNode(root, document);
    if (safe) {
        // 图标统一用 currentColor 描边，跟随主题
        if (!safe.getAttribute('width')) safe.setAttribute('width', '100%');
        if (!safe.getAttribute('height')) safe.setAttribute('height', '100%');
        safe.classList.add('icon');
        // 内置站点图标全是 fill="#e6e6e6" 的近白单色图；
        // 浅色主题的白色玻璃上它们会「消失」（文件夹 2×2 预览直接变空格子）。
        // 这里只给确认是单色浅图的打标记，由 CSS 在浅色主题下反相压深——彩色/自定义图标不受影响。
        if (isMonoLight(safe)) safe.classList.add('mono-light');
    }
    return safe;
}

/**
 * 远程图片 URL -> <img> 元素；只接受 http/https，失败返回 null
 */
export function parseImage(url: string): HTMLImageElement | null {
    if (typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) return null;
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    // 首屏 renderQuickAccess 会走这里；lazy 保证自定义远程图标不 gate window.load
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    // setAttribute 而非字符串拼接：URL 里的引号无法逃逸成新标签
    img.setAttribute('src', trimmed);
    return img;
}

/**
 * 把图标输入变成安全的 DOM 节点（内嵌 SVG 优先，其次远程图片）
 */
export function createIconNode(icon: string): Node | null {
    if (typeof icon !== 'string' || !icon.trim()) return null;
    if (icon.trim().toLowerCase().startsWith('<svg')) return parseSvg(icon);
    return parseImage(icon);
}

/** 首字兜底：汉字取本字，其余按 upper 决定大小写。三处图标（站点/引擎）共用同一规则 */
export function firstCharOf(name: string, upper = true): string {
    const c = (name || '').charAt(0);
    if (!c) return '?';
    return /\p{Script=Han}/u.test(c) ? c : upper ? c.toUpperCase() : c;
}

/** 是不是本机裁剪产物（data:image 位图）—— 引擎 logo 只认这一种 */
export function isDataImage(value: string): boolean {
    return /^data:image\/(png|jpeg|webp);base64,/i.test((value || '').trim());
}

/**
 * 远程图标（faviconV2 拉取）的形状：快捷访问里用 `icon: ''` 表示「没有内嵌 SVG」。
 * 首帧就发起图片请求，比内嵌 SVG 的站点更晚出图，用它标记出来逐级淡入。
 */
export const REMOTE_ICON = '' as const;

/** 站点图标服务的域名：只放行这几个，扩展不申请任何站点的 host 权限 */
export const FAVICON_HOSTS = ['www.google.com', 't0.gstatic.com', 't1.gstatic.com', 't2.gstatic.com', 't3.gstatic.com'] as const;

/**
 * 站点图标的地址。
 *
 * 走 Google 的 faviconV2 接口直接拿图，而不是 `<host>/favicon.ico`：后者在多数站点上
 * 要么 404、要么返回 16px 的小图，作为 26px 的引擎图标糊成一片。
 *
 * 为什么是 t0.gstatic.com 而不是 www.google.com/s2/favicons：后者会 301 到 gstatic，
 * 而 301 的响应是 text/html + x-content-type-options: nosniff。扩展没有申请这些站点的
 * host 权限，读不到响应头也读不到像素，301 会让两条探测路都失效；直链是 200 + image/*，
 * 至少能在 CSP 的 img-src 白名单里正常显示。
 */
export function siteIconUrl(host: string, size = 128): string {
    const domain = (host || '').trim();
    if (!domain) return '';
    const query = new URLSearchParams({
        client: 'SOCIAL',
        type: 'FAVICON',
        fallback_opts: 'TYPE,SIZE,URL',
        url: 'https://' + domain,
        size: String(size),
    });
    return `https://t0.gstatic.com/faviconV2?${query.toString()}`;
}

/** 站点图标只认远程 http(s) 或本机 data:image，别的协议一律不当图片用 */
export function isRemoteIcon(value: string): boolean {
    return /^https?:\/\//i.test((value || '').trim());
}

export const IconSafe = {
    parseSvg,
    parseImage,
    createIconNode,
    firstCharOf,
    isDataImage,
    siteIconUrl,
    isRemoteIcon,
} as const;
