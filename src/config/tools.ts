// 移植自 v1.8.1:js/config/tools.js —— 工具语义逐行等价，仅改 TS + 导出方式
export interface QuickTool {
    id: string;
    name: string;
    icon: string;
    desc: string;
    placeholder?: string;
    kind: 'transform' | 'generate';
    run?: (input: string) => string | Promise<string>;
    action?: () => string;
}
/**
 * 小工具定义（纯前端、零依赖、零网络）
 * kind: 'transform' 输入 → 输出；'generate' 一键生成
 * run(input) 返回 string（transform 可为 async）
 * 由 v1.8.1:js/app.js 渲染为工具宫格与工具面板，不持有 DOM。
 */
    // ---------- 工具函数 ----------

    const pad = (n: number) => String(n).padStart(2, '0');

    const formatDate = (date: Date, withMs?: boolean) => {
        const base =
            `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
            `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        return withMs ? `${base}.${String(date.getMilliseconds()).padStart(3, '0')}` : base;
    };

    const toCamel = (s: string) =>
        s
            .trim()
            .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
            .replace(/^(.)/, c => c.toLowerCase());

    const toSnake = (s: string) =>
        s
            .trim()
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .replace(/[-\s]+/g, '_')
            .toLowerCase();

    const hex2rgb = (hex: string) => {
        const v = hex.replace('#', '');
        const full =
            v.length === 3
                ? v
                      .split('')
                      .map(c => c + c)
                      .join('')
                : v;
        if (!/^[0-9a-f]{6}$/i.test(full)) return null;
        return {
            r: parseInt(full.slice(0, 2), 16),
            g: parseInt(full.slice(2, 4), 16),
            b: parseInt(full.slice(4, 6), 16),
        };
    };

    const rgb2hsl = ({ r, g, b }: { r: number; g: number; b: number }) => {
        const rr = r / 255,
            gg = g / 255,
            bb = b / 255;
        const max = Math.max(rr, gg, bb),
            min = Math.min(rr, gg, bb);
        let h = 0,
            s = 0;
        const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
            else if (max === gg) h = ((bb - rr) / d + 2) / 6;
            else h = ((rr - gg) / d + 4) / 6;
        }
        return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
    };

    const uuid = () =>
        typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                  const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16 | 0;
                  const v = c === 'x' ? r : (r & 0x3) | 0x8;
                  return v.toString(16);
              });

    const randomPassword = () => {
        const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+?';
        const bytes = crypto.getRandomValues(new Uint8Array(20));
        return [...bytes].map(b => chars[b % chars.length]).join('');
    };

    const sha256 = async (text: string) => {
        const data = new TextEncoder().encode(text);
        const buf = await crypto.subtle.digest('SHA-256', data);
        return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    };

    /** base64url（JWT 用的变体）→ 原始字节：还原 -/_ 与补 = 填充 */
    const base64UrlToBytes = (seg: string) => {
        const normalized = seg.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
        const bin = atob(padded);
        return Uint8Array.from(bin, c => c.charCodeAt(0));
    };

    /** 秒级时间戳 → 本地可读，越界/非法返回 null（JWT 的 exp/iat/nbf 都是秒） */
    const formatUnixSeconds = (value: unknown) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return null;
        const ms = value * 1000;
        const d = new Date(ms);
        if (isNaN(d.getTime())) return null;
        return formatDate(d);
    };

    /** JWT 的 claims 里时间字段统一加可读注释；JSON 结构保持原样 */
    const annotateJwtClaims = (payload: Record<string, unknown>) => {
        const notes: string[] = [];
        (['iat', 'nbf', 'exp'] as const).forEach(k => {
            const readable = formatUnixSeconds(payload[k]);
            if (readable) notes.push(`${k}: ${readable}`);
        });
        return notes;
    };

    const JWT_CLAIM_HINTS: Record<string, string> = {
        iss: '签发者',
        sub: '主体',
        aud: '受众',
        exp: '过期时间',
        nbf: '生效时间',
        iat: '签发时间',
        jti: '唯一 ID',
    };

    /** HTML 实体表：覆盖常用命名实体 + 数字实体 */
    const NAMED_ENTITIES: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: '\u00a0',
        copy: '©',
        reg: '®',
        trade: '™',
        hellip: '…',
        mdash: '—',
        ndash: '–',
        lsquo: '‘',
        rsquo: '’',
        ldquo: '“',
        rdquo: '”',
        bull: '•',
        middot: '·',
        times: '×',
        divide: '÷',
        deg: '°',
        plusmn: '±',
        euro: '€',
        pound: '£',
        yen: '¥',
        cent: '¢',
        sect: '§',
        para: '¶',
        dagger: '†',
        permil: '‰',
        laquo: '«',
        raquo: '»',
        frac12: '½',
        frac14: '¼',
        frac34: '¾',
        sup2: '²',
        sup3: '³',
        micro: 'µ',
        alpha: 'α',
        beta: 'β',
        gamma: 'γ',
        delta: 'δ',
        pi: 'π',
        sigma: 'σ',
        omega: 'ω',
        rarr: '→',
        larr: '←',
        uarr: '↑',
        darr: '↓',
        harr: '↔',
    };

    const ENTITY_SOURCE = '&(#\\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);';
    /** 带 g 用于 replace；判定只用一个不带 g 的副本（g 正则的 test 会推进 lastIndex） */
    const ENTITY_PATTERN = new RegExp(ENTITY_SOURCE, 'gi');
    const ENTITY_TEST = new RegExp(ENTITY_SOURCE, 'i');

    /** 解码一个实体；不认识的命名实体原样返回 null */
    const decodeEntity = (body: string) => {
        if (body.startsWith('#')) {
            const code = body[1] === 'x' || body[1] === 'X'
                ? parseInt(body.slice(2), 16)
                : parseInt(body.slice(1), 10);
            if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null;
            try {
                return String.fromCodePoint(code);
            } catch {
                return null;
            }
        }
        return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body.toLowerCase())
            ? NAMED_ENTITIES[body.toLowerCase()] ?? null
            : null;
    };

    /** 转义：& 必须最先替换，否则后续替换出的 & 会被二次转义 */
    const escapeHtml = (text: string) =>
        text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

    // ---------- 工具定义 ----------

    export const QUICK_TOOLS: QuickTool[] = [
        {
            id: 'timestamp',
            name: '时间戳',
            icon: '⏱',
            desc: '时间戳 ⇄ 日期时间',
            placeholder: '输入 Unix 时间戳（秒/毫秒）或 2026-01-01 12:00:00',
            kind: 'transform',
            run(input) {
                const t = input.trim();
                if (!t) return '';
                if (/^\d{10,13}$/.test(t)) {
                    const ms = t.length === 13 ? Number(t) : Number(t) * 1000;
                    const d = new Date(ms);
                    return `${formatDate(d, true)}\n本地: ${d.toString()}\nISO: ${d.toISOString()}`;
                }
                const d = new Date(t.replace(/-/g, '/'));
                if (isNaN(d.getTime())) return '无法识别的时间格式';
                return `秒: ${Math.floor(d.getTime() / 1000)}\n毫秒: ${d.getTime()}\nISO: ${d.toISOString()}`;
            },
        },
        {
            id: 'json',
            name: 'JSON',
            icon: '{}',
            desc: '格式化 / 压缩 / 校验',
            placeholder: '{"a":1,"b":[2,3]}',
            kind: 'transform',
            run(input) {
                const t = input.trim();
                if (!t) return '';
                try {
                    const obj = JSON.parse(t);
                    return JSON.stringify(obj, null, 2);
                } catch (e: unknown) {
                    return `JSON 解析失败: ${(e as Error).message}`;
                }
            },
        },
        {
            id: 'base64',
            name: 'Base64',
            icon: '🔐',
            desc: '编码 / 解码',
            placeholder: '文本或 Base64 字符串',
            kind: 'transform',
            run(input) {
                if (!input) return '';
                try {
                    // 能按 UTF-8 解码出可打印内容 → 视为 Base64 串进行解码
                    const bin = atob(input.trim());
                    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
                    const decoded = new TextDecoder().decode(bytes);
                    if (/[\u0000-\u0008\u000e-\u001f]/.test(decoded)) throw new Error('binary');
                    return decoded;
                } catch {
                    const bytes = new TextEncoder().encode(input);
                    let bin = '';
                    bytes.forEach(b => (bin += String.fromCharCode(b)));
                    return btoa(bin);
                }
            },
        },
        {
            id: 'url',
            name: 'URL',
            icon: '🔗',
            desc: '编码 / 解码',
            placeholder: '带空格或 %E4%BD%A0 的链接/文本',
            kind: 'transform',
            run(input) {
                if (!input) return '';
                try {
                    if (/%[0-9a-f]{2}/i.test(input)) return decodeURIComponent(input);
                } catch {
                    /* 非法编码序列则走编码分支 */
                }
                return encodeURIComponent(input);
            },
        },
        {
            id: 'hash',
            name: 'SHA-256',
            icon: '#',
            desc: '文本哈希摘要',
            placeholder: '输入任意文本',
            kind: 'transform',
            run: sha256,
        },
        {
            id: 'radix',
            name: '进制',
            icon: '🔢',
            desc: '二进制 / 八进制 / 十进制 / 十六进制',
            placeholder: '42、0x2A、0b101010、0o52',
            kind: 'transform',
            run(input) {
                const t = input.trim().toLowerCase().replace(/_/g, '');
                if (!t) return '';
                let n = NaN;
                if (/^0x[0-9a-f]+$/.test(t)) n = parseInt(t.slice(2), 16);
                else if (/^0b[01]+$/.test(t)) n = parseInt(t.slice(2), 2);
                else if (/^0o[0-7]+$/.test(t)) n = parseInt(t.slice(2), 8);
                else if (/^-?\d+$/.test(t)) n = parseInt(t, 10);
                if (isNaN(n)) return '无法识别的数字格式';
                return `十进制: ${n}\n十六进制: 0x${n.toString(16).toUpperCase()}\n八进制: 0o${n.toString(8)}\n二进制: 0b${n.toString(2)}`;
            },
        },
        {
            id: 'case',
            name: '大小写',
            icon: 'Aa',
            desc: '大小写 / 驼峰 / 下划线',
            placeholder: 'hello world / user_name / userName',
            kind: 'transform',
            run(input) {
                const t = input.trim();
                if (!t) return '';
                return [
                    `大写: ${t.toUpperCase()}`,
                    `小写: ${t.toLowerCase()}`,
                    `首字母大写: ${t.replace(/\b\w/g, c => c.toUpperCase())}`,
                    `驼峰: ${toCamel(t)}`,
                    `下划线: ${toSnake(t)}`,
                ].join('\n');
            },
        },
        {
            id: 'dedupe',
            name: '去重',
            icon: '🧹',
            desc: '按行去重并保留顺序',
            placeholder: '每行一条内容',
            kind: 'transform',
            run(input) {
                if (!input) return '';
                const lines = input.split('\n');
                const seen = new Set();
                const out = lines.filter(line => {
                    const key = line.trim();
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                return `去重后 ${out.length} / ${lines.length} 行\n\n${out.join('\n')}`;
            },
        },
        {
            id: 'wordcount',
            name: '字数',
            icon: '🔤',
            desc: '字符 / 词 / 行统计',
            placeholder: '粘贴文本',
            kind: 'transform',
            run(input) {
                if (!input) return '字符: 0';
                const chars = [...input].length;
                const noSpace = [...input.replace(/\s/g, '')].length;
                const words = (input.match(/[A-Za-z0-9]+|[\u4e00-\u9fa5]/g) || []).length;
                const lines = input.split('\n').length;
                return `字符: ${chars}\n不含空白: ${noSpace}\n词/汉字: ${words}\n行数: ${lines}`;
            },
        },
        {
            id: 'color',
            name: '颜色',
            icon: '🎨',
            desc: 'HEX ⇄ RGB ⇄ HSL',
            placeholder: '#4EC2C6 或 rgb(78,194,198)',
            kind: 'transform',
            run(input) {
                const t = input.trim();
                if (!t) return '';
                let rgb = null;
                if (t.startsWith('#')) rgb = hex2rgb(t);
                else {
                    const m = t.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
                    if (m) rgb = { r: +m[1], g: +m[2], b: +m[3] };
                }
                if (!rgb) return '支持 #4EC2C6 或 rgb(78,194,198)';
                const hex =
                    '#' +
                    [rgb.r, rgb.g, rgb.b]
                        .map(v => v.toString(16).padStart(2, '0'))
                        .join('')
                        .toUpperCase();
                const hsl = rgb2hsl(rgb);
                return `HEX: ${hex}\nRGB: rgb(${rgb.r}, ${rgb.g}, ${rgb.b})\nHSL: hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
            },
        },
        {
            id: 'jwt',
            name: 'JWT',
            icon: '🪙',
            desc: '解析头部与载荷',
            placeholder: '粘贴 JWT（格式 aaa.bbb.ccc）',
            kind: 'transform',
            run(input) {
                const t = input.trim().replace(/^Bearer\s+/i, '');
                if (!t) return '';
                const parts = t.split('.');
                if (parts.length !== 3) return '不是合法的 JWT：应有三段，用 . 分隔';
                const decodeSegment = (seg: string) => {
                    const text = new TextDecoder().decode(base64UrlToBytes(seg));
                    return JSON.parse(text) as Record<string, unknown>;
                };
                let header: Record<string, unknown>;
                let payload: Record<string, unknown>;
                try {
                    header = decodeSegment(parts[0]);
                    payload = decodeSegment(parts[1]);
                } catch (e: unknown) {
                    return `JWT 解析失败: ${(e as Error).message}`;
                }
                const lines = [
                    '--- Header ---',
                    JSON.stringify(header, null, 2),
                    '',
                    '--- Payload ---',
                    JSON.stringify(payload, null, 2),
                ];
                const notes = annotateJwtClaims(payload);
                const hints = Object.keys(payload)
                    .filter(k => JWT_CLAIM_HINTS[k])
                    .map(k => `${k} = ${JWT_CLAIM_HINTS[k]}`);
                if (notes.length || hints.length) {
                    lines.push('', '--- 时间与字段 ---');
                    if (notes.length) lines.push(...notes);
                    if (hints.length) lines.push(hints.join(' / '));
                } else {
                    lines.push('', '载荷里没有标准的时间字段（iat / nbf / exp）');
                }
                // 过期判断永远给一句，避免用户自己换算秒数
                const exp = payload.exp;
                const readable = formatUnixSeconds(exp);
                lines.push('', readable ? `状态: ${readable} 过期` : '状态: 无 exp 字段，不过期');
                if (readable) {
                    const expired = typeof exp === 'number' && exp * 1000 < Date.now();
                    lines.push(expired ? '已过期' : '仍在有效期内');
                }
                lines.push('', '签名未校验（本工具只解码不验签）');
                return lines.join('\n');
            },
        },
        {
            id: 'htmlentity',
            name: 'HTML 实体',
            icon: '&amp;',
            desc: '转义 / 反转义',
            placeholder: '&lt;div&gt; 或 <div>',
            kind: 'transform',
            run(input) {
                if (!input) return '';
                // 含实体 → 优先按解码处理（与 base64/URL 的「自动判别」一致）
                if (ENTITY_TEST.test(input)) {
                    let unknown = 0;
                    const decoded = input.replace(ENTITY_PATTERN, (match, body: string) => {
                        const value = decodeEntity(body);
                        if (value == null) {
                            unknown++;
                            return match;
                        }
                        return value;
                    });
                    return unknown
                        ? `${decoded}\n\n（${unknown} 个实体无法识别，已原样保留）`
                        : decoded;
                }
                return escapeHtml(input);
            },
        },
        {
            id: 'password',
            name: '密码',
            icon: '🔑',
            desc: '生成 20 位强密码',
            placeholder: '点「生成」得到随机强密码',
            kind: 'generate',
            action: randomPassword,
        },
        {
            id: 'uuid',
            name: 'UUID',
            icon: '🆔',
            desc: '生成 UUID v4',
            placeholder: '点「生成」得到 UUID',
            kind: 'generate',
            action: uuid,
        },
    ];

    // 主页右翼卡片展示的常用工具（按顺序取前 6 个）
    export const QUICK_TOOLS_FEATURED: string[] = ['timestamp', 'json', 'base64', 'url', 'hash', 'color'];
