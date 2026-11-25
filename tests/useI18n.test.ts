import { beforeEach, describe, expect, it } from 'vitest';
import { computed } from 'vue';
import {
    getLocalePref,
    registerCatalog,
    resetLocaleState,
    setLocalePref,
    t,
    useI18n,
} from '@/src/composables/useI18n';

const catalog = {
    zh_CN: { 'nav.title': '设置', 'greet.user': '你好，{0}' },
    en: { 'nav.title': 'Settings', 'greet.user': 'Hello, {0}' },
};

beforeEach(() => {
    registerCatalog(catalog);
    // 显式指定系统语言：测试不该依赖跑测机器的 navigator.language
    resetLocaleState('zh-CN');
});

describe('useI18n 响应式取词', () => {
    it('默认 auto：无系统语言时落到默认语言', () => {
        expect(getLocalePref()).toBe('auto');
        expect(t('nav.title')).toBe('设置');
    });

    it('切换偏好后立即换语言（响应式）', () => {
        setLocalePref('en');
        expect(t('nav.title')).toBe('Settings');
        expect(t('greet.user', ['Bob'])).toBe('Hello, Bob');
    });

    it('computed 依赖 locale，切换时会重新求值', () => {
        const label = computed(() => t('nav.title'));
        expect(label.value).toBe('设置');
        setLocalePref('en');
        expect(label.value).toBe('Settings');
    });

    it('显式偏好优先于系统语言', () => {
        setLocalePref('en');
        expect(useI18n().locale.value).toBe('en');
        setLocalePref('zh_CN');
        expect(useI18n().locale.value).toBe('zh_CN');
    });

    it('无效偏好回落到 auto，不把界面卡死', () => {
        setLocalePref('klingon');
        expect(getLocalePref()).toBe('auto');
        expect(useI18n().locale.value).toBe('zh_CN');
    });

    it('auto 跟随系统语言', () => {
        resetLocaleState('en-GB');
        expect(useI18n().locale.value).toBe('en');
        expect(t('nav.title')).toBe('Settings');
        resetLocaleState('ja-JP');
        expect(useI18n().locale.value).toBe('zh_CN');
    });

    it('支持的写法带地区也能识别', () => {
        setLocalePref('en-US');
        expect(useI18n().locale.value).toBe('en');
        setLocalePref('zh-TW');
        expect(useI18n().locale.value).toBe('zh_CN');
    });

    it('缺词时回退默认语言，再缺则显示 key', () => {
        setLocalePref('en');
        expect(t('only.in.default')).toBe('only.in.default');
    });
});
