/**
 * 搜索引擎 / 搜索历史 / 自定义引擎数据层（Vue 3 + ESM composable）。
 *
 * 移植自 v1.8.1:js/modules/search-manager.js 与
 * v1.8.1:js/modules/settings-manager.js 中 customEngines / searchEngine
 * 相关逻辑；内置引擎清单（含 icon）、三条校验文案逐字保留。
 *
 * 搜索历史的形态在 v2.2 升级：`string[]` → `HistoryEntry[]`（text / pinned / at）。
 * 旧数据（纯字符串数组）在水合时自动迁移，落盘永远是新结构；归一化与截断规则
 * 抽在 `lib/searchHistory.ts`，运行时与 `lib/backup.ts` 共用同一份实现。
 * 自定义引擎 URL 一律经 UrlSafe.isHttp 白名单（备份导入属于不可信输入）。
 */
import { log } from '@/src/lib/log';
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { UrlSafe } from '@/src/lib/urlSafe';
import {
    enforceHistoryLimits,
    normalizeHistory,
    type HistoryEntry,
} from '@/src/lib/searchHistory';

/** 类型对外仍从本模块取：调用点（SearchBlock / 测试）无需知道它搬去了 lib */
export type { HistoryEntry } from '@/src/lib/searchHistory';

export interface Engine {
    name: string;
    url: string;
    icon?: string;
    /** 用户截好的方形 logo（data URL）。有它就用它，没有再走 icon / 首字兜底 */
    logo?: string;
    isCustom?: boolean;
}

export interface AddEngineResult {
    ok: boolean;
    message?: string;
}

/** 站点 favicon 兜底（data URL）。与 EngineLogoEntry 同形，分开存是因为来源不同：
    用户裁的图优先于抓来的 favicon。 */
export interface EngineIconEntry {
    name: string;
    icon: string;
}

export interface EngineLogoEntry {
    name: string;
    logo?: string;
}

export interface SearchApi {
    engines: Ref<Engine[]>;
    currentName: Ref<string>;
    currentEngine: ComputedRef<Engine | null>;
    history: Ref<HistoryEntry[]>;
    customEngines: Ref<Engine[]>;
    init(): Promise<void>;
    setEngine(name: string): Promise<void>;
    addHistory(query: string): Promise<void>;
    clearHistory(): Promise<void>;
    setCustomEngines(list: Engine[]): Promise<void>;
    loadCustomEngines(): Promise<Engine[]>;
    addCustomEngine(name: string, url: string, logo?: string): Promise<AddEngineResult>;
    /** 改任意引擎（内置或自定义）的图标；logo 传 undefined 即还原默认 */
    setEngineLogo(name: string, logo: string | undefined): Promise<boolean>;
    setEngineIconImage(name: string, icon: string | undefined): Promise<boolean>;
    removeCustomEngine(name: string): Promise<boolean>;
    getSearchEngines(): Engine[];
    getCurrentSearchEngine(): Engine;
    setCurrentSearchEngine(engineName: string): boolean;
    /** 纯文本视图（只读快照，给备份/兼容旧调用点用） */
    getSearchHistory(): string[];
    /** 行对象视图：带 pinned / at，SearchBlock 用它渲染固定态 */
    getHistoryEntries(): HistoryEntry[];
    addToHistory(query: string): Promise<void>;
    removeFromHistory(index: number): Promise<void>;
    /** 固定/取消固定单条（按数组下标，越界静默，与 removeFromHistory 同语义） */
    setHistoryPinned(index: number, pinned: boolean): Promise<void>;
}

const STORAGE_KEYS = {
    searchEngine: 'searchEngine',
    customEngines: 'customEngines',
    searchHistory: 'searchHistory',
    settings: 'settings',
    engineLogos: 'engineLogos',
    engineIcons: 'engineIcons',
} as const;

const DEFAULT_SEARCH_ENGINE = 'Bing';

interface StorageArea {
    get(keys: string[]): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
}

function storageArea(): StorageArea {
    return (globalThis as unknown as { chrome: { storage: { local: StorageArea } } }).chrome.storage
        .local;
}

const CUSTOM_ENGINE_ICON =
    '<svg class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="200" height="200"><path d="M448 128a320 320 0 1 0 0 640 320 320 0 0 0 0-640z m0 576a256 256 0 1 1 0-512 256 256 0 0 1 0 512z" fill="#8AB4F8"></path><path d="M726.6 662.6l-51.3 51.3 179.5 179.5 51.3-51.3z" fill="#8AB4F8"></path></svg>';

export const BUILTIN_ENGINES: Engine[] = [
    {
        name: 'Baidu',
        icon: '<svg t="1750565499301" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1565" width="200" height="200"><path d="M345.706 297.423c15.35 12.792 35.817 20.467 53.726 17.908 20.467 0 38.375-10.233 53.725-23.025 17.91-15.35 30.7-35.817 40.934-58.842C512 189.97 512 136.245 496.65 90.194c-10.234-30.7-28.142-58.842-53.726-76.75C427.574 3.21 404.548-1.906 384.081 0.652c-12.791 2.558-25.583 7.675-38.375 15.35-23.025 15.35-38.376 40.934-48.61 66.518-12.791 46.05-15.35 92.101-2.557 138.152 10.233 28.142 25.583 56.284 51.167 76.75z m255.837 2.558c17.909 15.35 40.934 25.584 63.96 25.584 20.466 2.558 38.375-2.558 56.283-12.792 17.909-10.233 33.26-25.584 43.493-43.492 12.792-20.467 23.025-40.934 30.7-63.96 5.117-17.908 7.675-38.375 5.117-58.842-2.559-28.142-15.35-53.726-33.259-76.751-12.792-15.35-28.142-30.7-46.05-38.376-12.792-5.116-28.143-10.233-40.935-7.675-17.908 2.559-33.258 12.792-46.05 23.026-17.909 15.35-33.259 33.258-43.493 53.725-10.233 17.909-20.466 38.376-23.025 61.401-2.558 25.584-2.558 51.168 2.559 74.193 5.116 23.025 12.791 46.05 30.7 63.96zM245.929 509.768c17.91-15.35 28.143-35.818 35.818-56.285 10.233-33.258 10.233-66.517 7.675-99.776 0-12.792-5.117-25.584-10.234-38.376-12.792-28.142-35.817-53.725-63.959-69.076-23.025-10.233-46.05-15.35-66.518-10.233-25.583 2.558-46.05 20.467-61.4 40.934-20.467 28.142-30.7 63.96-35.818 97.218-2.558 20.467 0 40.934 5.117 61.4 7.675 30.701 23.025 58.843 46.05 79.31 17.91 15.35 40.935 23.026 63.96 23.026 28.142 0 56.284-7.675 79.31-28.142z m736.811-76.752c-2.558-20.467-7.675-38.375-17.908-56.284-10.234-20.467-28.143-40.934-48.61-51.167-23.025-12.792-51.167-15.35-76.75-12.792-12.792 2.558-28.143 5.117-40.935 12.792-17.908 10.233-30.7 28.142-40.933 48.609-10.234 25.584-15.35 53.726-15.35 81.868 0 25.583 0 53.726 7.674 79.31 5.117 17.908 15.35 38.375 33.26 48.608 17.908 15.35 40.933 20.467 63.959 23.026 17.908 2.558 38.375 2.558 56.284-2.559 17.908-5.116 35.817-15.35 46.05-30.7 12.792-15.35 20.467-35.817 23.026-53.726 12.792-30.7 10.233-58.842 10.233-86.985zM911.106 819.33c-2.559-35.817-20.467-71.634-46.05-99.776-5.118-5.117-10.234-10.234-17.91-15.35-33.258-28.142-66.517-58.843-99.776-89.543-33.259-33.26-63.96-69.076-92.101-107.452-20.467-33.259-48.61-63.96-86.985-81.868-23.025-10.233-51.167-15.35-76.751-12.792-46.05 5.117-86.985 30.7-115.127 66.518-7.675 7.675-12.791 17.909-17.908 28.142-20.467 30.7-46.05 61.401-74.193 86.985-15.35 15.35-30.7 28.142-46.05 40.934-7.676 7.675-17.91 15.35-25.584 23.025-30.7 23.025-61.401 53.726-79.31 86.985-12.792 23.025-20.467 48.609-23.025 76.75 0 23.026 2.558 46.051 10.233 66.518 7.675 23.026 17.909 46.051 33.26 63.96 25.583 30.7 63.958 51.167 102.334 53.725 48.609 2.559 97.218 0 143.269-7.675 20.467-2.558 40.934-10.233 63.959-12.792 46.05-5.116 92.101-2.558 135.594 10.234 35.817 12.792 74.192 17.909 112.568 20.467 38.375 2.558 79.31-2.558 115.127-23.025 25.583-12.792 46.05-35.818 58.842-61.401 20.467-33.26 30.7-71.635 25.584-112.569zM481.3 924.224H363.615c-12.792 0-25.584 0-38.376-2.559-25.584-5.117-48.61-20.467-63.96-43.492-12.791-15.35-20.466-33.259-23.025-53.726a246.563 246.563 0 0 1 0-61.4c5.117-23.026 17.909-43.493 33.26-58.843 12.791-12.792 30.7-23.026 48.608-30.7 7.675-2.56 15.35-5.117 23.026-5.117h69.076v-97.219h66.517c2.559 120.244 2.559 237.929 2.559 353.056z m263.512 0H583.634c-17.908-2.559-33.258-7.676-46.05-17.909-15.35-12.792-23.026-33.259-23.026-51.167v-173.97h66.518v161.178c0 7.675 2.558 12.792 7.675 17.908 5.117 5.117 12.792 7.675 20.467 7.675h69.076V678.62h66.518v245.604z" fill="#306CFF" p-id="1566"></path><path d="M340.59 734.904c-12.793 5.117-25.585 15.35-33.26 30.7-5.116 12.792-7.675 25.584-7.675 38.376 0 15.35 5.117 30.7 12.792 43.492 10.234 15.35 28.142 25.584 46.05 23.026h53.727V732.346H353.38c-2.558-2.559-7.675 0-12.792 2.558z" fill="#306CFF" p-id="1567"></path></svg>',
        url: 'https://www.baidu.com/s?wd=',
    },
    {
        name: 'Google',
        icon: '<svg t="1750565700259" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2559" width="200" height="200"><path d="M214.101333 512c0-32.512 5.546667-63.701333 15.36-92.928L57.173333 290.218667A491.861333 491.861333 0 0 0 4.693333 512c0 79.701333 18.858667 154.88 52.394667 221.610667l172.202667-129.066667A290.56 290.56 0 0 1 214.101333 512" fill="#FBBC05" p-id="2560"></path><path d="M516.693333 216.192c72.106667 0 137.258667 25.002667 188.458667 65.962667L854.101333 136.533333C763.349333 59.178667 646.997333 11.392 516.693333 11.392c-202.325333 0-376.234667 113.28-459.52 278.826667l172.373334 128.853333c39.68-118.016 152.832-202.88 287.146666-202.88" fill="#EA4335" p-id="2561"></path><path d="M516.693333 807.808c-134.357333 0-247.509333-84.864-287.232-202.88l-172.288 128.853333c83.242667 165.546667 257.152 278.826667 459.52 278.826667 124.842667 0 244.053333-43.392 333.568-124.757333l-163.584-123.818667c-46.122667 28.458667-104.234667 43.776-170.026666 43.776" fill="#34A853" p-id="2562"></path><path d="M1005.397333 512c0-29.568-4.693333-61.44-11.648-91.008H516.650667V614.4h274.602666c-13.696 65.962667-51.072 116.650667-104.533333 149.632l163.541333 123.818667c93.994667-85.418667 155.136-212.650667 155.136-375.850667" fill="#4285F4" p-id="2563"></path></svg>',
        url: 'https://www.google.com/search?q=',
    },
    {
        name: 'Bing',
        icon: '<svg t="1750565754331" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="4482" width="200" height="200"><path d="M340.5824 70.109867L102.536533 0.682667v851.217066L340.650667 643.345067V70.109867zM102.536533 851.7632l238.045867 171.6224 580.881067-340.923733V411.784533L102.536533 851.831467z" fill="#1296db" p-id="4483"></path><path d="M409.463467 255.3856l113.732266 238.933333 138.8544 56.866134 259.413334-139.400534-506.0608-156.330666z" fill="#1296db" p-id="4484"></path></svg>',
        url: 'https://www.bing.com/search?q=',
    },
    {
        name: 'Sogou',
        icon: '<svg t="1750565827458" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="6537" width="200" height="200"><path d="M1015.062344 508.169576c0-280.897756-227.27182-508.169576-508.169576-508.169576C228.548628 0 1.276808 227.27182 1.276808 508.169576s227.27182 508.169576 508.169576 508.169576c66.394015 0 130.234414-12.76808 191.521197-38.304239 76.608479-30.643392 145.55611-81.715711 199.182045-148.109726 71.501247-86.822943 114.912718-199.182045 114.912718-321.755611zM677.985037 939.730673c-56.179551 17.875312-109.805486 30.643392-168.538653 30.643392-255.361596 0-462.204489-206.842893-462.204489-462.204489S254.084788 45.965087 509.446384 45.965087 971.650873 252.80798 971.650873 508.169576c0 112.359102-40.857855 217.057357-109.805486 298.773067-48.518703 58.733167-112.359102 104.698254-183.86035 132.78803z" fill="#FA4D23" p-id="6538"></path><path d="M499.23192 699.690773s-183.860349 2.553616-286.004987-91.930174L205.566085 737.995012s607.760599 219.610973 612.86783-132.788029c0 0 12.76808-84.269327-206.842893-143.002494 0 0-86.822943-20.428928-183.860349-76.608479 0 0-53.625935-61.286783 99.591023-48.518703 181.306733 15.321696 275.790524 61.286783 275.790523 61.286783V283.451372s-413.685786-155.770574-574.563591 22.982543c0 0-53.625935 81.715711 2.553616 132.78803s168.538653 114.912718 316.648379 153.216958c0-2.553616 191.521197 86.822943-48.518703 107.25187z" fill="#FA4D23" p-id="6539"></path></svg>',
        url: 'https://www.sogou.com/web?query=',
    },
    {
        name: 'DuckDuckGo',
        icon: '<svg t="1750565847235" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7705" width="200" height="200"><path d="M28.16 509.44c0 268.8 217.6 486.4 486.4 486.4s486.4-217.6 486.4-486.4-217.6-486.4-486.4-486.4-486.4 217.6-486.4 486.4z" fill="#CC6633" p-id="7706"></path><path d="M64 512c0 247.296 200.704 448 448 448s448-200.704 448-448-200.704-448-448-448S64 264.704 64 512z" fill="#FFFFFF" p-id="7707"></path><path d="M934.912 516.096c0 199.68-138.24 367.616-324.096 412.672-11.264-21.504-22.016-42.496-31.232-59.904 31.744 28.16 70.144 38.912 91.648 25.6 27.648-16.896 37.376-78.848-5.632-135.168-13.312 0.512-30.72 2.56-50.176 8.192-27.648 8.192-48.128 20.992-61.44 30.72-11.776-17.92-28.16-48.64-36.352-89.6-6.656-33.28-5.12-61.952-2.56-81.408 14.848 10.24 113.664 43.52 162.816 42.496s129.536-30.72 120.832-54.784-88.576 20.992-172.544 13.312c-61.952-5.632-72.704-33.28-58.88-53.76 17.408-25.6 48.64 4.608 100.352-10.752 51.712-15.36 124.416-43.008 151.04-58.368 61.952-34.816-26.112-49.152-46.592-39.424-19.968 9.216-88.064 26.624-120.32 34.304 17.92-62.976-25.088-172.544-73.216-220.672-15.872-15.872-39.424-25.6-66.56-30.72-10.24-14.336-27.136-28.16-51.2-40.448-46.08-24.064-98.304-32.768-149.504-24.064h-2.56c-6.144 1.024-9.728 3.584-14.848 4.096 6.144 0.512 29.184 11.264 44.032 17.408-7.168 3.072-16.896 4.608-24.576 7.68-3.072 0.512-5.632 1.024-8.704 2.56-7.168 3.072-12.8 15.36-12.288 21.504 34.816-3.584 86.528-1.024 124.416 10.24-26.624 3.584-51.2 10.752-69.12 19.968-0.512 0.512-1.024 0.512-2.048 1.024-2.048 1.024-4.608 1.536-6.144 2.56-56.832 29.696-81.92 99.84-67.072 183.808 13.312 75.776 69.12 336.384 95.232 460.288-164.352-56.32-282.624-214.016-282.624-399.36 0-235.008 190.464-424.96 424.96-424.96s424.96 190.464 424.96 424.96z" fill="#DE5833" p-id="7708"></path><path d="M357.376 446.976c0 17.408 14.336 31.744 31.744 31.744s31.744-14.336 31.744-31.744c0-17.408-14.336-31.744-31.744-31.744s-31.744 14.336-31.744 31.744zM599.552 401.408c-14.848-0.512-27.648 11.264-28.16 26.112-0.512 14.848 11.264 27.648 26.112 28.16h2.048c14.848 0 27.136-12.288 27.136-27.136s-12.288-27.136-27.136-27.136z m-201.728-45.568s-23.552-10.752-46.592 3.584c-23.04 14.848-22.016 29.696-22.016 29.696s-12.288-27.136 20.48-40.448c32.256-13.824 48.64 7.168 48.128 7.168z m218.112-2.048s-16.896-9.728-30.208-9.728c-27.136 0.512-34.816 12.288-34.816 12.288s4.608-28.672 39.424-23.04c11.264 2.56 20.992 9.728 25.6 20.48z" fill="#336699" p-id="7709"></path><path d="M549.376 522.24c24.576-9.728 35.328-9.728 74.24-17.408 24.576-5.12 56.832-11.776 94.72-23.552 30.208-9.216 36.864-13.824 56.32-15.36 26.112-2.048 62.464 1.024 66.56 15.36 2.048 6.656-4.608 13.824-10.24 20.48-14.336 16.384-32.256 22.016-61.44 30.72-36.352 11.264-38.912 11.264-51.2 15.36-58.368 18.432-55.296 23.552-76.8 25.6-38.912 3.584-60.928-12.8-71.68 0-6.656 8.192-4.608 22.016 0 30.72 6.656 11.776 19.968 15.36 40.96 20.48 25.6 6.144 46.08 5.632 51.2 5.12 18.432-1.024 31.744-4.608 51.2-10.24 40.96-11.776 52.736-21.504 71.68-15.36 3.584 1.024 19.456 6.144 20.48 15.36 2.048 18.432-53.76 43.52-102.4 51.2-47.104 7.168-86.528-2.56-97.28-5.12-7.168-2.048-19.968-6.144-46.08-15.36-29.696-10.24-37.376-13.824-46.08-20.48-9.216-7.168-23.04-17.92-25.6-35.84-2.56-18.432 9.216-33.28 15.36-40.96 9.216-11.264 21.504-20.992 46.08-30.72z" fill="#FDD20A" p-id="7710"></path><path d="M523.776 798.72c4.096-3.584 9.216-7.168 15.36-10.24 11.776-6.144 22.528-9.216 30.72-10.24-1.536 3.584-3.584 6.656-5.12 10.24 14.336-7.168 29.696-13.824 46.08-20.48 25.088-10.24 49.152-18.432 71.68-25.6 7.68 12.288 22.016 36.864 25.6 71.68 3.584 35.328-5.12 63.488-10.24 76.8-6.144 3.584-32.768 17.408-66.56 10.24s-51.712-30.208-56.32-35.84c-1.536 5.12-3.584 10.24-5.12 15.36-5.632 1.024-14.848 2.048-25.6 0-11.776-2.048-20.48-7.168-25.6-10.24-24.064 11.776-47.616 24.064-71.68 35.84-3.584 4.608-9.728 6.656-15.36 5.12-7.68-2.048-10.24-9.728-10.24-10.24-5.632-16.896-11.264-37.888-15.36-61.44-4.096-25.088-5.12-47.616-5.12-66.56-2.048-6.144 0.512-12.8 5.12-15.36s9.728-0.512 10.24 0c18.944 2.56 44.544 7.68 71.68 20.48 13.824 6.656 26.112 13.824 35.84 20.48z" fill="#66CC33" p-id="7711"></path></svg>',
        url: 'https://duckduckgo.com/?q=',
    },
];

const FIRST_BUILTIN: Engine = BUILTIN_ENGINES[0] as Engine;

function createSearch(): SearchApi {
    const engines = ref<Engine[]>([...BUILTIN_ENGINES]);
    const currentName = ref<string>(FIRST_BUILTIN.name);
    const currentEngine: ComputedRef<Engine | null> = computed(
        () => engines.value.find(e => e.name === currentName.value) || null
    );
    const history = ref<HistoryEntry[]>([]);
    const customEngines = ref<Engine[]>([]);
    /** 用户给引擎换的图标，按引擎名存（内置引擎也能换）。与 customEngines 分开存，
      这样删掉再重建同名引擎时图标还在，且内置引擎不必进「自定义」列表。 */
    const engineLogos = ref<Record<string, string>>({});
    /** 引擎名 → 用户裁好的图（data URL）；用作 favicon 失败时的兜底 */
    const engineIconUrls = ref<Record<string, string>>({});

    /**
     * 内置 + 自定义的重建统一走这里。图标只有一个出口：
     *   用户裁的（engineLogos）→ 站点 favicon（engineIconUrls）→ 该引擎自带的品牌 SVG
     * 三者都塞进 logo 字段，图标组件里「有 logo 就不画 SVG」，只能有一个赢家。
     * 内置引擎的换图入口已在设置里移除，但仍保留覆盖能力：老版本用户换过的
     * 图标存在 storage 里，直接忽略会让他们的图标凭空消失。
     */
    function rebuildEngines(): void {
        const decorate = (e: Engine): Engine => {
            const logo = engineLogos.value[e.name] || engineIconUrls.value[e.name] || e.icon;
            return logo ? { ...e, logo } : e;
        };
        engines.value = [
            ...BUILTIN_ENGINES.map(decorate),
            ...customEngines.value.map(toMapped).map(decorate),
        ];
    }

    function plainLogos(): EngineLogoEntry[] {
        return Object.entries(engineLogos.value)
            .filter(([name, logo]) => name.trim() && safeLogo(logo))
            .map(([name, logo]) => ({ name, logo }));
    }

    /** favicon 兜底层只存非空串，避免 storage 里堆积噪声 */
    function plainIcons(): EngineIconEntry[] {
        return Object.entries(engineIconUrls.value)
            .filter(([name, icon]) => name.trim() && icon.trim())
            .map(([name, icon]) => ({ name, icon }));
    }

    function applyEngineIcons(value: unknown): void {
        const next: Record<string, string> = {};
        if (Array.isArray(value)) {
            for (const item of value) {
                if (!item || typeof item !== 'object') continue;
                const entry = item as Record<string, unknown>;
                if (typeof entry.name !== 'string' || !entry.name.trim()) continue;
                const icon = safeLogo(entry.icon);
                if (icon) next[entry.name.trim()] = icon;
            }
        }
        engineIconUrls.value = next;
        rebuildEngines();
    }

    function applyEngineLogos(value: unknown): void {
        const next: Record<string, string> = {};
        if (Array.isArray(value)) {
            for (const item of value) {
                if (!item || typeof item !== 'object') continue;
                const entry = item as Record<string, unknown>;
                if (typeof entry.name !== 'string' || !entry.name.trim()) continue;
                const logo = safeLogo(entry.logo);
                if (logo) next[entry.name.trim()] = logo;
            }
        } else if (value && typeof value === 'object') {
            // 兼容对象形态 { 名称: dataURL }
            for (const [name, logo] of Object.entries(value as Record<string, unknown>)) {
                const safe = safeLogo(logo);
                if (name.trim() && safe) next[name.trim()] = safe;
            }
        }
        engineLogos.value = next;
        rebuildEngines();
    }

    // 自定义引擎（可能来自备份导入）一律过 UrlSafe.isHttp 白名单
    function isSafeEngine(value: unknown): value is Engine {
        if (!value || typeof value !== 'object') return false;
        const item = value as Record<string, unknown>;
        const name = item.name;
        const url = item.url;
        if (typeof name !== 'string' || !name.trim()) return false;
        if (typeof url !== 'string') return false;
        if (item.logo !== undefined && typeof item.logo !== 'string') return false;
        return UrlSafe.isHttp(url.replace('%s', 'test'));
    }

    /** logo 只收 data:image 的位图（用户本机裁剪产物）；远程地址一律不收，避免把图标变成请求 */
    function safeLogo(value: unknown): string | undefined {
        return typeof value === 'string' &&
            /^data:image\/(png|jpeg|webp);base64,/i.test(value.trim())
            ? value.trim()
            : undefined;
    }

    /** 自定义引擎默认不带图标（放大镜表示「这是你自己加的」），logo/icon 由覆盖层补 */
    function toMapped(engine: Engine): Engine {
        return {
            name: engine.name,
            url: engine.url,
            isCustom: true,
            icon: CUSTOM_ENGINE_ICON,
        };
    }

    function plainList(): Array<{ name: string; url: string }> {
        return customEngines.value.map(e => ({ name: e.name, url: e.url }));
    }

    function applyCustomEngines(list: unknown): void {
        const safe: Engine[] = [];
        if (Array.isArray(list)) {
            for (const item of list) {
                if (!isSafeEngine(item)) continue;
                safe.push({ name: item.name, url: item.url });
            }
        }
        customEngines.value = safe;
        // 任何一次「自定义引擎变了」都意味着内存态要对外刷新一次。watch(engines) 只在
        // 引用变化时触发，下面可能只是名字换了而数组内容一样，所以这里显式换新引用。
        rebuildEngines();
        // 当前引擎若已被删除则回落到内置默认（legacy setCustomEngines 语义）
        const stillExists = engines.value.some(e => e.name === currentName.value);
        if (!stillExists) currentName.value = FIRST_BUILTIN.name;
    }

    async function persistCustomEngines(list: Array<{ name: string; url: string }>): Promise<void> {
        const before = JSON.stringify(plainList());
        applyCustomEngines(list);
        const next = plainList();
        // 值未变化时跳过写入：SettingsPanel.refreshCustomEngines() 会把读回的同一份列表
        // 再次 setCustomEngines()，无条件 set 会触发 onChanged 形成回环。
        if (JSON.stringify(next) === before) return;
        await storageArea().set({ [STORAGE_KEYS.customEngines]: next });
    }

    async function persistHistory(): Promise<void> {
        try {
            // chrome.storage 走结构化克隆：直接写 Vue Proxy 数组会被序列化成 {"0":...} 字典丢数据
            // （与 useStored 的修复同源），必须先转纯数据数组再落盘。
            const plain = JSON.parse(JSON.stringify(history.value ?? [])) as HistoryEntry[];
            await storageArea().set({ [STORAGE_KEYS.searchHistory]: plain });
        } catch (error) {
            log.error('保存搜索历史失败:', error);
        }
    }

    async function init(): Promise<void> {
        let data: Record<string, unknown> = {};
        try {
            data = await storageArea().get([
                STORAGE_KEYS.searchEngine,
                STORAGE_KEYS.customEngines,
                STORAGE_KEYS.searchHistory,
                STORAGE_KEYS.settings,
                STORAGE_KEYS.engineLogos,
                STORAGE_KEYS.engineIcons,
            ]);
        } catch (error) {
            log.error('加载设置失败:', error);
        }
        // 搜索历史（legacy loadHistory）
        try {
            // 旧版本存的是纯字符串数组，normalizeHistory 顺手完成迁移（v2.2 起落盘结构为对象数组）
            history.value = normalizeHistory(data[STORAGE_KEYS.searchHistory]);
        } catch (error) {
            log.error('加载搜索历史失败:', error);
            history.value = [];
        }
        // 合并内置 + 自定义引擎，自定义 URL 先过白名单。
        // 两个覆盖层要先落位再重建，否则首帧会先闪一下品牌图。
        applyEngineLogos(data[STORAGE_KEYS.engineLogos]);
        applyEngineIcons(data[STORAGE_KEYS.engineIcons]);
        applyCustomEngines(data[STORAGE_KEYS.customEngines]);
        // 回填 currentName：优先独立键，兼容 legacy settings.searchEngine，再取默认
        const rawSettings = data[STORAGE_KEYS.settings];
        const settings =
            rawSettings && typeof rawSettings === 'object'
                ? (rawSettings as Record<string, unknown>)
                : {};
        const storedName = data[STORAGE_KEYS.searchEngine];
        const legacyName = settings.searchEngine;
        const name =
            typeof storedName === 'string' && storedName
                ? storedName
                : typeof legacyName === 'string' && legacyName
                  ? legacyName
                  : DEFAULT_SEARCH_ENGINE;
        currentName.value = engines.value.some(e => e.name === name) ? name : FIRST_BUILTIN.name;
    }

    async function setEngine(name: string): Promise<void> {
        currentName.value = name;
        await storageArea().set({ [STORAGE_KEYS.searchEngine]: name });
    }

    async function addHistory(query: string): Promise<void> {
        const text = query.trim();
        if (!text) return;
        // 重复搜索一个已固定的词不掉固定态：只把 at 刷新到最新，位置仍在固定区
        const prev = history.value.find(item => item.text === text);
        const entry: HistoryEntry = { text, pinned: prev?.pinned === true, at: Date.now() };
        history.value = enforceHistoryLimits([
            entry,
            ...history.value.filter(item => item.text !== text),
        ]);
        await persistHistory();
    }

    async function clearHistory(): Promise<void> {
        history.value = [];
        await persistHistory();
    }

    /** 删除单条历史（legacy search-manager.removeFromHistory：按索引删，越界静默）。 */
    async function removeFromHistory(index: number): Promise<void> {
        if (index >= 0 && index < history.value.length) {
            history.value.splice(index, 1);
            await persistHistory();
        }
    }

    /**
     * 固定 / 取消固定（v2.2 新增）。
     *
     * 下标语义与 removeFromHistory 一致：SearchBlock 传的是未过滤数组里的原始下标。
     * 固定后条目不参与上限淘汰，只是位置被归到固定区；取消固定则回到未固定区末尾。
     */
    async function setHistoryPinned(index: number, pinned: boolean): Promise<void> {
        const target = history.value[index];
        if (!target || target.pinned === pinned) return;
        history.value = enforceHistoryLimits(
            history.value.map((item, i) => (i === index ? { ...item, pinned } : item))
        );
        await persistHistory();
    }

    async function setCustomEngines(list: Engine[]): Promise<void> {
        const plain = (Array.isArray(list) ? list : []).map(e => ({ name: e.name, url: e.url }));
        await persistCustomEngines(plain);
    }

    async function loadCustomEngines(): Promise<Engine[]> {
        let raw: unknown = [];
        try {
            const data = await storageArea().get([STORAGE_KEYS.customEngines]);
            raw = Array.isArray(data[STORAGE_KEYS.customEngines])
                ? data[STORAGE_KEYS.customEngines]
                : [];
        } catch (error) {
            log.error('加载自定义引擎失败:', error);
        }
        applyCustomEngines(raw);
        return customEngines.value;
    }

    async function addCustomEngine(
        name: string,
        url: string,
        logo?: string
    ): Promise<AddEngineResult> {
        const n = (name || '').trim();
        const u = (url || '').trim();
        if (!n || !u || !u.includes('%s')) {
            return { ok: false, message: '名称与搜索链接（含 %s 占位符）均不能为空' };
        }
        if (!/^https?:\/\//i.test(u) || !UrlSafe.isHttp(u.replace('%s', 'test'))) {
            return { ok: false, message: '搜索链接必须以 http(s):// 开头' };
        }
        if (customEngines.value.some(e => e.name.toLowerCase() === n.toLowerCase())) {
            return { ok: false, message: '已存在同名引擎「' + n + '」' };
        }
        await persistCustomEngines([...plainList(), { name: n, url: u }]);
        const safe = safeLogo(logo);
        if (safe) await setEngineLogo(n, safe);
        return { ok: true };
    }

    /**
     * 改任意引擎的图标（内置引擎也算）：只动覆盖层，不碰引擎本身。
     * 改完立即重建内存态，搜索框下拉不必等下一次读盘。
     */
    async function setEngineLogo(name: string, logo: string | undefined): Promise<boolean> {
        const n = (name || '').trim();
        if (!n || !engines.value.some(e => e.name === n)) return false;
        const safe = safeLogo(logo);
        const next = { ...engineLogos.value };
        if (safe) next[n] = safe;
        else delete next[n];
        engineLogos.value = next;
        rebuildEngines();
        await storageArea().set({ [STORAGE_KEYS.engineLogos]: plainLogos() });
        return true;
    }

    /**
     * 站点图标兜底：抓不到用户裁剪图时用它顶上。只收 data:image（设置面板的
     * 「用站点图标」会用 canvas 转成内联 data URL），远程地址一律不收。
     */
    async function setEngineIconImage(name: string, icon: string | undefined): Promise<boolean> {
        const n = (name || '').trim();
        if (!n || !engines.value.some(e => e.name === n)) return false;
        const next = { ...engineIconUrls.value };
        const safe = safeLogo(icon);
        if (safe) next[n] = safe;
        else delete next[n];
        engineIconUrls.value = next;
        rebuildEngines();
        await storageArea().set({ [STORAGE_KEYS.engineIcons]: plainIcons() });
        return true;
    }

    async function removeCustomEngine(name: string): Promise<boolean> {
        const before = customEngines.value.length;
        const next = customEngines.value.filter(e => e.name !== name);
        await persistCustomEngines(plainList().filter(e => e.name !== name));
        return next.length < before;
    }

    // ---- 兼容 legacy SearchManager 的同步接口（签名与 SearchBlock.vue 一致） ----
    function getSearchEngines(): Engine[] {
        return engines.value;
    }

    function getCurrentSearchEngine(): Engine {
        return currentEngine.value || FIRST_BUILTIN;
    }

    function setCurrentSearchEngine(engineName: string): boolean {
        const engine = engines.value.find(e => e.name === engineName);
        if (!engine) return false;
        currentName.value = engine.name;
        return true;
    }

    function getSearchHistory(): string[] {
        return history.value.map(item => item.text);
    }

    function getHistoryEntries(): HistoryEntry[] {
        return history.value;
    }

    function addToHistory(query: string): Promise<void> {
        return addHistory(query);
    }

    return {
        engines,
        currentName,
        currentEngine,
        history,
        customEngines,
        init,
        setEngine,
        addHistory,
        clearHistory,
        setCustomEngines,
        loadCustomEngines,
        addCustomEngine,
        setEngineLogo,
        setEngineIconImage,
        removeCustomEngine,
        getSearchEngines,
        getCurrentSearchEngine,
        setCurrentSearchEngine,
        getSearchHistory,
        getHistoryEntries,
        addToHistory,
        removeFromHistory,
        setHistoryPinned,
    };
}

let instance: SearchApi | null = null;

/** 模块级单例：全应用共享同一份引擎 / 历史状态。 */
export function useSearch(): SearchApi {
    if (!instance) instance = createSearch();
    return instance;
}
