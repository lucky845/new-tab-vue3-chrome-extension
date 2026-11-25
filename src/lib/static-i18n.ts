/**
 * 静态 DOM 文案本地化 —— 给 entrypoints/newtab.html 里手写的 title / aria-label 用。
 *
 * 为什么需要：newtab.html 是 HTML 入口，`title="待办事项"` 这类属性在 Vue 挂载前
 * 就存在于 DOM 上，不属于任何组件，t() 管不到。原本想用 `__MSG_key__`，但 WXT 只对
 * manifest 做占位符替换，HTML 里的 `__MSG_*` 会原样留在产物里（实测构建后仍是
 * `<title>__MSG_appName__</title>`），故改为运行期按 data-i18n-* 属性回填。
 *
 * 用法：元素上写 `data-i18n-title="todo_panel_title"` / `data-i18n-aria-label="..."`，
 * 值即 locales/*.yml 的 key。存的是 key 不是译文，所以语言切换时重新回填即可。
 */
const ATTRS = ['title', 'aria-label', 'placeholder'] as const;

type Translate = (key: string) => string;

/** data-i18n-title → dataset.i18nTitle */
function datasetKey(attr: string): string {
    return 'i18n' + attr.replace(/(^|-)(\w)/g, (_m, _sep: string, c: string) => c.toUpperCase());
}

/**
 * 按 data-i18n-<attr> 回填属性；没有对应属性的元素不受影响。
 * @param t 翻译函数（传入而非内部 import，便于单测且不绑定 Vue）
 * @param root 扫描范围，默认 document
 * @returns 实际回填的属性个数
 */
export function applyStaticI18n(t: Translate, root: ParentNode = document): number {
    let applied = 0;
    for (const attr of ATTRS) {
        root.querySelectorAll<HTMLElement>(`[data-i18n-${attr}]`).forEach((el) => {
            const key = (el.dataset as Record<string, string | undefined>)[datasetKey(attr)];
            if (!key) return;
            el.setAttribute(attr, t(key));
            applied += 1;
        });
    }
    return applied;
}
