/**
 * 搜索历史的数据结构与归一化（v2.2 抽出为纯函数模块）。
 *
 * 抽出来的理由：`useSearch`（浏览器侧）和 `lib/backup`（导入导出侧）必须用
 * **同一套**去重 / 截断 / 旧格式迁移规则，否则运行时看到 20 条、备份导入只剩
 * 10 条这类不一致会反复出现。这里不 import vue，也不碰 chrome.storage。
 */

/** 一条搜索历史。at = 最近一次搜索的时间戳（毫秒），仅用于排序与备份稳定化 */
export interface HistoryEntry {
    text: string;
    pinned: boolean;
    at: number;
}

/** 未固定条目的上限：运行时与备份导入共用这一个数，改一处即全部生效 */
export const MAX_HISTORY_ITEMS = 20;

/**
 * 排序 + 截断：固定条目永远排在前面且不参与淘汰。
 *
 * 纯函数、无副作用，落盘前与读盘后都走它，保证「内存里看到的顺序」和
 * 「storage 里存的顺序」是同一个东西（备份导出也一起吃这个顺序）。
 */
export function enforceHistoryLimits(list: HistoryEntry[]): HistoryEntry[] {
    const pinned = list.filter(item => item.pinned);
    const rest = list.filter(item => !item.pinned);
    return [...pinned, ...rest.slice(0, MAX_HISTORY_ITEMS)];
}

/**
 * 水合 / 导入归一化：同时吃三种输入。
 *
 * - `string`：v2.1 及更早的落盘格式（纯字符串数组）
 * - `{ text, pinned, at }`：v2.2 起的格式
 * - 混合数组：旧备份文件里可能一条新一条旧
 *
 * 空文本、缺 text 的对象、重复文本一律丢弃；重复时保留第一次出现的那条
 * （数组有序，第一条就是更新的那条）。
 */
export function normalizeHistory(raw: unknown): HistoryEntry[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: HistoryEntry[] = [];
    for (const item of raw) {
        let entry: HistoryEntry | null = null;
        if (typeof item === 'string') {
            entry = { text: item, pinned: false, at: 0 };
        } else if (item && typeof item === 'object') {
            const obj = item as Record<string, unknown>;
            if (typeof obj.text === 'string') {
                const at = Number(obj.at);
                entry = {
                    text: obj.text,
                    pinned: obj.pinned === true,
                    at: Number.isFinite(at) && at > 0 ? at : 0,
                };
            }
        }
        if (!entry) continue;
        const text = entry.text.trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push({ ...entry, text });
    }
    return enforceHistoryLimits(out);
}
