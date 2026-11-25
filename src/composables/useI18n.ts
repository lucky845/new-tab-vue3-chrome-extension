/**
 * 语言状态（响应式）+ 文案表挂载。
 *
 * 与 src/lib/i18n.ts 的分工：那边是纯函数（不认识 Vue，也不认识浏览器），
 * 这边负责把「用户偏好 → 生效语言」接上 storage、并暴露响应式的 t()。
 *
 * 语言包通过 `registerCatalog` 注入而不是直接 import，是为了：
 * 1. 单测里能塞假数据，不依赖构建产物；
 * 2. 以后拆包时可以让非默认语言按需加载。
 */
import { computed, ref, shallowRef } from 'vue';
import {
    DEFAULT_LOCALE,
    normalizeLocale,
    resolveLocale,
    translate,
    type Catalog,
    type Locale,
    type LocalePref,
} from '@/src/lib/i18n';

/** 文案表（构建期由 locales/*.yml 生成后注入） */
const catalog = shallowRef<Catalog>({});

/** 系统/浏览器语言，来自 chrome.i18n.getUILanguage()，非扩展环境回退到 navigator */
function detectSystemLang(): string {
    try {
        const g = globalThis as {
            chrome?: { i18n?: { getUILanguage?: () => string } };
            navigator?: { language?: string };
        };
        const fromChrome = g.chrome?.i18n?.getUILanguage?.();
        if (fromChrome) return fromChrome;
        return g.navigator?.language || '';
    } catch {
        return '';
    }
}

/** 用户偏好（'auto' 或具体语言），由设置面板写入 */
const localePref = ref<LocalePref>('auto');
/** 系统语言快照；`auto` 时由它决定生效语言 */
const systemLang = ref<string>(detectSystemLang());

/** 生效语言 */
const currentLocale = computed<Locale>(() => resolveLocale(localePref.value, systemLang.value));

/** 注入文案表，返回卸载函数（测试用） */
export function registerCatalog(next: Catalog): void {
    catalog.value = next;
}

/**
 * 设置用户的显式语言偏好。
 *
 * 不做 storage 写入——持久化由设置面板调用 patchSettings({ locale }) 完成，
 * 这样这里保持纯状态，单测不需要 stub chrome.storage。
 */
export function setLocalePref(pref: LocalePref | string): void {
    // 具体语言才认，其余（含 'auto'、无效值、脏数据）一律回 auto，不让坏值卡死界面
    localePref.value = normalizeLocale(pref) ?? 'auto';
}

export function getLocalePref(): LocalePref {
    return localePref.value;
}

/** 测试用：重置到初始状态；可指定系统语言以模拟不同环境 */
export function resetLocaleState(systemLangOverride?: string): void {
    localePref.value = 'auto';
    systemLang.value = systemLangOverride ?? detectSystemLang();
}

/** 系统语言（响应式）。设置面板显示「跟随系统（当前：English）」时要用 */
export const currentSystemLang = computed(() => systemLang.value);

/** 当前生效语言（响应式）。给 Vue 之外的静态 DOM 回填用，见 src/lib/static-i18n.ts。 */
export const locale = currentLocale;

/**
 * 取词。返回字符串而不是绑定在模板上的 t，调用方按需包 computed。
 *
 * 第二个参数是替换参数：数组走位置占位符 `{0}`，对象走命名占位符 `{name}`。
 */
export function t(
    key: string,
    params?: readonly (string | number)[] | Record<string, string | number>,
): string {
    return translate(catalog.value, locale.value, key, params);
}

export function useI18n() {
    return {
        /** 生效语言（响应式） */
        locale,
        /** 用户偏好（响应式） */
        localePref,
        /** 当前语言的文案表，只读用途（如整表遍历做校验） */
        catalog,
        t,
        setLocalePref,
        DEFAULT_LOCALE,
    };
}
