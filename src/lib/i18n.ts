/**
 * 运行时语言层。
 *
 * 为什么不是直接用 @wxt-dev/i18n：那个包只有一层 `browser.i18n.getMessage` 包装，
 * 语言永远是浏览器 UI 语言，**没有任何运行时切换能力**（源码 46 行，无 changeLocale）。
 * 我们需要「用户可以在设置里选中文 / English / 跟随系统」，所以这里自己实现：
 *
 * - 数据源：`locales/<lang>.yml`（由 @wxt-dev/i18n/module 构建时编进 _locales/，
 *   manifest 的 __MSG_*__ 仍走同一份文案，不重复维护）。
 * - 取值：优先用 `browser.i18n.getMessage`（跟随浏览器语言的那一份），
 *   用户显式选了语言时改用构建期内联的当前语言包。
 *
 * 设计取舍：不引入 vue-i18n（约 20KB gzip）只为几个插值；这里只做
 * 「查表 + 占位符替换 + 缺词回退 + 语言解析」，够用且可单测。
 */

/** 支持的界面语言（新增语言时只改这里 + locales/ 下加 yml） */
export const SUPPORTED_LOCALES = ['zh_CN', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** 'auto' = 跟随系统/浏览器，其余为显式指定 */
export type LocalePref = 'auto' | Locale;

export const DEFAULT_LOCALE: Locale = 'zh_CN';

/**
 * 把任意来源的语言标记归一成受支持的语言。
 *
 * 只做前缀匹配：`zh-TW`、`zh-Hans-CN` 都落到 zh_CN（当前只有简中一套中文文案），
 * `en-US`、`en-GB` 都落到 en。识别不出来时返回 null，由调用方决定回退。
 */
export function normalizeLocale(raw: string | undefined | null): Locale | null {
    const tag = String(raw || '')
        .trim()
        .replace(/_/g, '-')
        .toLowerCase();
    if (!tag) return null;
    const [primary] = tag.split('-');
    if (primary === 'zh') return 'zh_CN';
    if (primary === 'en') return 'en';
    return null;
}

/** 语言偏好 → 实际生效语言；'auto' 或无效偏好时用 systemLang */
export function resolveLocale(pref: LocalePref | string | undefined, systemLang: string | undefined): Locale {
    const picked = normalizeLocale(pref);
    if (picked) return picked;
    return normalizeLocale(systemLang) ?? DEFAULT_LOCALE;
}

/** 文案表：扁平 key → 模板串。key 用 '.' 分级，直接做对象属性名 */
export type Messages = Record<string, string>;
/** 全量语言包：locale → 文案表 */
export type Catalog = Partial<Record<Locale, Messages>>;

/**
 * 占位符替换。
 *
 * 支持两种写法（与 chrome.i18n 的 conventions 对齐）：
 * - 位置参数：`{0}`、`{1}`，按传入数组顺序
 * - 命名参数：`{count}`，从对象取值
 *
 * 缺参数时**保留原占位符**而不是显示 undefined —— 用户看到 `{0}` 能立刻报 bug，
 * 看到 undefined 只会困惑。
 */
export function interpolate(template: string, params?: readonly (string | number)[] | Record<string, string | number>): string {
    if (!params) return template;
    if (Array.isArray(params)) {
        return template.replace(/\{(\d+)\}/g, (whole, idx: string) => {
            const v = params[Number(idx)];
            return v === undefined ? whole : String(v);
        });
    }
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
        const v = (params as Record<string, string | number>)[name];
        return v === undefined ? whole : String(v);
    });
}

/**
 * 查词。找不到时依次回退：当前语言 → 默认语言 → key 本身。
 *
 * 回退到「key 本身」是刻意的：缺翻译的句子在界面上会以 `settings.title` 这种形状出现，
 * 一眼能看出漏翻，比显示空白或抛错好排查。
 */
export function lookup(catalog: Catalog, locale: Locale, key: string): string | undefined {
    return catalog[locale]?.[key] ?? catalog[DEFAULT_LOCALE]?.[key];
}

/** 纯查表 + 插值，不碰任何浏览器 API，便于单测 */
export function translate(
    catalog: Catalog,
    locale: Locale,
    key: string,
    params?: readonly (string | number)[] | Record<string, string | number>,
): string {
    const template = lookup(catalog, locale, key);
    if (template === undefined) return key;
    return interpolate(template, params);
}
