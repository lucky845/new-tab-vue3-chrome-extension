/**
 * 引擎名去重（纯函数，零依赖）。
 *
 * 背景：内置引擎与自定义引擎是两套数据源，在 rebuildEngines() 里直接拼接。
 * 一旦自定义引擎取了和内置引擎同名的名字（历史上 addCustomEngine 只查了自定义
 * 列表、applyCustomEngines 对导入数据完全不过滤），下拉里就会出现两个「Bing」。
 * 引擎以 name 为键（SearchBlock 的 v-for :key、setCurrentSearchEngine 都按 name），
 * 同名不只是视觉重复，还会让 currentName 的查找命中的是拼接顺序里的第一个。
 *
 * 去重口径：大小写不敏感、保留先出现的那个。内置引擎永远排在前，所以内置优先。
 */

export interface Named {
    name: string;
}

/** 引擎名的比较键：去空白 + 小写。中文名不受影响。 */
export function engineKey(name: string): string {
    return (name || '').trim().toLowerCase();
}

/**
 * 从 candidates 里剔除与 reserved 重名、以及彼此重名的项，保留先出现的。
 * 返回新数组与被丢弃的条目数（调用方据此决定是否回写存储，清掉历史脏数据）。
 */
export function dedupeEngines<T extends Named>(
    candidates: readonly T[],
    reserved: readonly Named[] = []
): { list: T[]; dropped: number } {
    const seen = new Set<string>();
    for (const item of reserved) {
        const key = engineKey(item.name);
        if (key) seen.add(key);
    }
    const list: T[] = [];
    let dropped = 0;
    for (const item of candidates) {
        const key = engineKey(item.name);
        if (!key) {
            dropped += 1;
            continue;
        }
        if (seen.has(key)) {
            dropped += 1;
            continue;
        }
        seen.add(key);
        list.push(item);
    }
    return { list, dropped };
}
