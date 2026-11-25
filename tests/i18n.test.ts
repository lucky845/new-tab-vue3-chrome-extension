import { describe, expect, it } from 'vitest';
import {
    DEFAULT_LOCALE,
    interpolate,
    lookup,
    normalizeLocale,
    resolveLocale,
    translate,
    type Catalog,
} from '@/src/lib/i18n';

describe('normalizeLocale', () => {
    it('识别简体/繁体/带脚本标记的中文，统一落到 zh_CN', () => {
        expect(normalizeLocale('zh-CN')).toBe('zh_CN');
        expect(normalizeLocale('zh_CN')).toBe('zh_CN');
        expect(normalizeLocale('zh-TW')).toBe('zh_CN');
        expect(normalizeLocale('zh-Hans-CN')).toBe('zh_CN');
    });

    it('识别英文的各地区变体，统一落到 en', () => {
        expect(normalizeLocale('en')).toBe('en');
        expect(normalizeLocale('en-US')).toBe('en');
        expect(normalizeLocale('EN-gb')).toBe('en');
    });

    it('不支持的语言返回 null，不瞎猜', () => {
        expect(normalizeLocale('ja-JP')).toBeNull();
        expect(normalizeLocale('fr')).toBeNull();
        expect(normalizeLocale('')).toBeNull();
        expect(normalizeLocale(null)).toBeNull();
        expect(normalizeLocale(undefined)).toBeNull();
    });
});

describe('resolveLocale', () => {
    it('显式偏好优先于系统语言', () => {
        expect(resolveLocale('en', 'zh-CN')).toBe('en');
        expect(resolveLocale('zh_CN', 'en-US')).toBe('zh_CN');
    });

    it("'auto' 或无效偏好时跟随系统", () => {
        expect(resolveLocale('auto', 'en-US')).toBe('en');
        expect(resolveLocale('auto', 'ja-JP')).toBe(DEFAULT_LOCALE);
        expect(resolveLocale(undefined, 'en-GB')).toBe('en');
        expect(resolveLocale('bogus', 'en')).toBe('en');
    });
});

describe('interpolate', () => {
    it('替换位置参数', () => {
        expect(interpolate('已移入「{0}」', ['工作'])).toBe('已移入「工作」');
        expect(interpolate('{0} 个站点回到主面板', [3])).toBe('3 个站点回到主面板');
    });

    it('替换命名参数', () => {
        expect(interpolate('{count} 个待办', { count: 5 })).toBe('5 个待办');
    });

    it('缺参数时保留原占位符，不显示 undefined', () => {
        expect(interpolate('{0} 与 {1}', ['A'])).toBe('A 与 {1}');
        expect(interpolate('{name} 与 {other}', { name: 'A' })).toBe('A 与 {other}');
    });

    it('没有参数时原样返回', () => {
        expect(interpolate('纯文本')).toBe('纯文本');
        expect(interpolate('带 {0} 的文本')).toBe('带 {0} 的文本');
    });
});

const catalog: Catalog = {
    zh_CN: { 'a.title': '标题', 'a.sub': '副标题', 'a.only.zh': '仅中文有' },
    en: { 'a.title': 'Title', 'a.sub': 'Subtitle' },
};

describe('translate / lookup', () => {
    it('命中当前语言', () => {
        expect(translate(catalog, 'en', 'a.title')).toBe('Title');
    });

    it('当前语言缺词时回退到默认语言', () => {
        expect(translate(catalog, 'en', 'a.only.zh')).toBe('仅中文有');
    });

    it('都缺时回退成 key 本身，便于发现漏翻', () => {
        expect(translate(catalog, 'en', 'a.nope')).toBe('a.nope');
        expect(lookup(catalog, 'en', 'a.nope')).toBeUndefined();
    });

    it('插值跟随语言', () => {
        const c: Catalog = { zh_CN: { greet: '你好 {0}' }, en: { greet: 'Hello {0}' } };
        expect(translate(c, 'zh_CN', 'greet', ['张三'])).toBe('你好 张三');
        expect(translate(c, 'en', 'greet', ['Bob'])).toBe('Hello Bob');
    });
});
