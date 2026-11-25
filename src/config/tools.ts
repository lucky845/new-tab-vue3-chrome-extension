// 移植自 v1.8.1:js/config/tools.js —— 工具语义逐行等价，仅改 TS + 导出方式
import { t as tr } from '@/src/composables/useI18n';
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
        iss: 'tool_jwt_iss',
        sub: 'tool_jwt_sub',
        aud: 'tool_jwt_aud',
        exp: 'tool_jwt_exp',
        nbf: 'tool_jwt_nbf',
        iat: 'tool_jwt_iat',
        jti: 'tool_jwt_jti',
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
            name: 'tool_name_timestamp',
            icon: '⏱',
            desc: 'tool_desc_timestamp',
            placeholder: 'tool_ph_timestamp',
            kind: 'transform',
            run(input) {
                const t = input.trim();
                if (!t) return '';
                if (/^\d{10,13}$/.test(t)) {
                    const ms = t.length === 13 ? Number(t) : Number(t) * 1000;
                    const d = new Date(ms);
                    return tr('tool_out_timestamp', { local: d.toString(), iso: d.toISOString() });
                }
                const d = new Date(t.replace(/-/g, '/'));
                if (isNaN(d.getTime())) return tr('tool_out_bad_time');
                return tr('tool_out_timestamp_conv', { sec: Math.floor(d.getTime() / 1000), ms: d.getTime(), iso: d.toISOString() });
            },
        },
        {
            id: 'json',
            name: 'JSON',
            icon: '{}',
            desc: 'tool_desc_json',
            placeholder: '{"a":1,"b":[2,3]}',
            kind: 'transform',
            run(input) {
                const t = input.trim();
                if (!t) return '';
                try {
                    const obj = JSON.parse(t);
                    return JSON.stringify(obj, null, 2);
                } catch (e: unknown) {
                    return tr('tool_out_json_fail', { msg: (e as Error).message });
                }
            },
        },
        {
            id: 'base64',
            name: 'Base64',
            icon: '🔐',
            desc: 'tool_desc_base64',
            placeholder: 'tool_ph_base64',
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
            desc: 'tool_desc_url',
            placeholder: 'tool_ph_url',
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
            desc: 'tool_desc_hash',
            placeholder: 'tool_ph_hash',
            kind: 'transform',
            run: sha256,
        },
        {
            id: 'radix',
            name: 'tool_name_radix',
            icon: '🔢',
            desc: 'tool_desc_radix',
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
                if (isNaN(n)) return tr('tool_out_bad_number');
                return tr('tool_out_radix', { dec: n, hex: n.toString(16).toUpperCase(), oct: n.toString(8), bin: n.toString(2) });
            },
        },
        {
            id: 'case',
            name: 'tool_name_case',
            icon: 'Aa',
            desc: 'tool_desc_case',
            placeholder: 'hello world / user_name / userName',
            kind: 'transform',
            run(input) {
                const t = input.trim();
                if (!t) return '';
                return [
                    `${tr('tool_out_case_upper')}: ${t.toUpperCase()}`,
                    `${tr('tool_out_case_lower')}: ${t.toLowerCase()}`,
                    `${tr('tool_out_case_title')}: ${t.replace(/\b\w/g, c => c.toUpperCase())}`,
                    `${tr('tool_out_case_camel')}: ${toCamel(t)}`,
                    `${tr('tool_out_case_snake')}: ${toSnake(t)}`,
                ].join('\n');
            },
        },
        {
            id: 'dedupe',
            name: 'tool_name_dedupe',
            icon: '🧹',
            desc: 'tool_desc_dedupe',
            placeholder: 'tool_ph_dedupe',
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
                return tr('tool_out_dedupe', { out: out.length, total: lines.length, body: out.join('\n') });
            },
        },
        {
            id: 'wordcount',
            name: 'tool_name_wordcount',
            icon: '🔤',
            desc: 'tool_desc_wordcount',
            placeholder: 'tool_ph_wordcount',
            kind: 'transform',
            run(input) {
                if (!input) return tr('tool_out_wordcount_empty');
                const chars = [...input].length;
                const noSpace = [...input.replace(/\s/g, '')].length;
                const words = (input.match(/[A-Za-z0-9]+|[\u4e00-\u9fa5]/g) || []).length;
                const lines = input.split('\n').length;
                return tr('tool_out_wordcount', { chars, noSpace, words, lines });
            },
        },
        {
            id: 'color',
            name: 'tool_name_color',
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
                if (!rgb) return tr('tool_out_bad_color');
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
            name: 'tool_name_jwt',
            icon: '🪙',
            desc: 'tool_desc_jwt',
            placeholder: 'tool_ph_jwt',
            kind: 'transform',
            run(input) {
                const t = input.trim().replace(/^Bearer\s+/i, '');
                if (!t) return '';
                const parts = t.split('.');
                if (parts.length !== 3) return tr('tool_out_bad_jwt');
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
                    return tr('tool_out_jwt_fail', { msg: (e as Error).message });
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
                    .map(k => `${k} = ${tr(JWT_CLAIM_HINTS[k])}`);
                if (notes.length || hints.length) {
                    lines.push('', tr('tool_out_jwt_time_header'));
                    if (notes.length) lines.push(...notes);
                    if (hints.length) lines.push(hints.join(' / '));
                } else {
                    lines.push('', tr('tool_out_jwt_no_time'));
                }
                // 过期判断永远给一句，避免用户自己换算秒数
                const exp = payload.exp;
                const readable = formatUnixSeconds(exp);
                lines.push('', readable ? tr('tool_out_jwt_expires', { when: readable }) : tr('tool_out_jwt_no_exp'));
                if (readable) {
                    const expired = typeof exp === 'number' && exp * 1000 < Date.now();
                    lines.push(expired ? tr('tool_out_jwt_expired') : tr('tool_out_jwt_valid'));
                }
                lines.push('', tr('tool_out_jwt_no_verify'));
                return lines.join('\n');
            },
        },
        {
            id: 'htmlentity',
            name: 'tool_name_htmlentity',
            icon: '&amp;',
            desc: 'tool_desc_htmlentity',
            placeholder: 'tool_ph_htmlentity',
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
                        ? `${decoded}\n\n${tr('tool_out_entity_unknown', { n: unknown })}`
                        : decoded;
                }
                return escapeHtml(input);
            },
        },
        {
            id: 'password',
            name: 'tool_name_password',
            icon: '🔑',
            desc: 'tool_desc_password',
            placeholder: 'tool_ph_password',
            kind: 'generate',
            action: randomPassword,
        },
        {
            id: 'uuid',
            name: 'UUID',
            icon: '🆔',
            desc: 'tool_desc_uuid',
            placeholder: 'tool_ph_uuid',
            kind: 'generate',
            action: uuid,
        },
    ];

    // 主页右翼卡片展示的常用工具（按顺序取前 6 个）
    export const QUICK_TOOLS_FEATURED: string[] = ['timestamp', 'json', 'base64', 'url', 'hash', 'color'];
