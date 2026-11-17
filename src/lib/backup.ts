/**
 * 数据备份与恢复（Vue3 版纯函数模块）——逐字移植 v1.8.1:js/modules/backup-manager.js（580 行）。
 *
 * 四层兼容机制不变：键注册表 / 全量减缓存 / 迁移链 / 未知键保留 + 向前兼容。
 * 差异：class → 命名导出纯函数；UrlSafe → ESM import urlSafe；不挂全局对象。
 * 边界：除 exportToFile 的下载锚点外不碰 DOM，不渲染 UI（UI 在 SettingsPanel.vue）。
 */
import { isHttp, isImageSource } from '@/src/lib/urlSafe';
import { normalizeHistory } from '@/src/lib/searchHistory';

export const APP_ID = 'new-tab-pro';
export const SCHEMA_VERSION = 2;
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const SAFE_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

interface KeyMeta {
    type: string;
    label: string;
    since: number | null;
}
interface RegistryEntry {
    type: string;
    label: string;
    since: number;
    cache?: boolean;
}

/** 键注册表：未登记的键也能被导出（全量减缓存），登记的价值是类型校验与可读名 */
const registry: Record<string, RegistryEntry> = {
    settings: { type: 'object', label: '设置', since: 1 },
    customEngines: { type: 'array', label: '自定义搜索引擎', since: 1 },
    engineLogos: { type: 'array', label: '搜索引擎图标', since: 2 },
    quickAccessSites: { type: 'array', label: '快捷方式', since: 1 },
    todos: { type: 'array', label: '待办', since: 1 },
    notes: { type: 'array', label: '便签', since: 1 },
    pomodoroSettings: { type: 'object', label: '番茄钟设置', since: 1 },
    pomodoroStats: { type: 'object', label: '番茄钟统计', since: 1 },
    // 运行态存的是绝对截止时间戳，跨设备/隔天恢复只会得到一个立刻到期的假计时器，
    // 因此归为缓存：导出时排除，恢复后由 usePomodoro 首次启动自建基线
    pomodoroRuntime: { type: 'object', label: '番茄钟运行态', since: 2, cache: true },
    searchHistory: { type: 'array', label: '搜索历史', since: 1 },
    engineIcons: { type: 'array', label: '搜索引擎图标缓存', since: 2 },
    themeSettings: { type: 'object', label: '主题设置', since: 2 },
    sideCardModes: { type: 'object', label: '侧边卡片显隐设置', since: 2 },
    localWallpapers: { type: 'array', label: '本地壁纸库', since: 2 },
    savedWallpaperId: { type: 'string', label: '壁纸 ID', since: 1 },
    savedWallpaperUrl: { type: 'string', label: '壁纸地址', since: 1 },
    savedWallpaperData: { type: 'object', label: '壁纸元数据', since: 1 },
    savedWallpaperBlob: { type: 'string', label: '壁纸本地缓存图', since: 2 },
    savedWallpaperBlobUrl: { type: 'string', label: '壁纸缓存标记', since: 2 },
};

/** 只列确切前缀，不用宽泛模式，避免误丢用户数据键 */
const cachePrefixes = [
    'amap_adcode_',
    'amap_weather_',
    'om_geo_',
    'om_weather_',
    'om_last_location',
    // 天气失败冷却/最近成功时间：纯运行时状态，恢复后由天气链路自行重建
    'weather_cooldown_',
    'weather_fail_count',
    'weather_last_ok',
    // 主题日出日落缓存：按日期+经纬度生成，季节性数据不值得跨备份搬运
    'ntce-sun-',
];

export function isCacheKey(key: string): boolean {
    if (!key) return false;
    const meta = registry[key];
    if (meta && meta.cache) return true;
    return cachePrefixes.some(prefix => key.startsWith(prefix));
}

function expectedType(key: string): string | null {
    const meta = registry[key];
    return meta ? meta.type : null;
}

function typeOf(value: unknown): string {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
}

export interface BackupPayload {
    app: string;
    schemaVersion: number;
    exportedAt: string;
    extensionVersion: string;
    keys: Record<string, KeyMeta>;
    extras: string[];
    skippedCache: string[];
    data: Record<string, unknown>;
}
export interface BackupStats {
    keys: number;
    bytes: number;
    items: Array<{ key: string; type: string; count: number | null; bytes: number }>;
}

/** 组装备份载荷：get(null) 取全量，只剔缓存，新功能键自动进入备份 */
export async function buildPayload(): Promise<{ payload: BackupPayload; stats: BackupStats }> {
    const stored = (await chrome.storage.local.get(null)) || {};
    const data: Record<string, unknown> = {};
    const skippedCache: string[] = [];
    for (const key of Object.keys(stored)) {
        if (isCacheKey(key)) {
            skippedCache.push(key);
            continue;
        }
        data[key] = stored[key];
    }
    const keyMeta: Record<string, KeyMeta> = {};
    const extras: string[] = [];
    for (const key of Object.keys(data)) {
        const meta = registry[key];
        if (meta) {
            keyMeta[key] = { type: meta.type, label: meta.label, since: meta.since };
        } else {
            keyMeta[key] = { type: typeOf(data[key]), label: key, since: null };
            extras.push(key);
        }
    }
    const payload: BackupPayload = {
        app: APP_ID,
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        extensionVersion:
            chrome.runtime && chrome.runtime.getManifest
                ? chrome.runtime.getManifest().version
                : 'unknown',
        keys: keyMeta,
        extras,
        skippedCache,
        data,
    };
    return { payload, stats: summarize(payload) };
}

/** 统计各键体量，供 UI 展示「这次备份了什么」 */
export function summarize(payload: BackupPayload): BackupStats {
    const data = (payload && payload.data) || {};
    const items: BackupStats['items'] = [];
    let total = 0;
    for (const key of Object.keys(data)) {
        const value = data[key];
        let count: number | null = null;
        if (Array.isArray(value)) count = value.length;
        else if (value && typeof value === 'object') count = Object.keys(value).length;
        const bytes = JSON.stringify(value).length;
        total += bytes;
        items.push({ key, type: typeOf(value), count, bytes });
    }
    return { keys: items.length, bytes: total, items };
}

/** newtab-pro-backup-20261111-201530.json */
export function buildFileName(date: Date = new Date()): string {
    const p = (n: number): string => String(n).padStart(2, '0');
    const stamp =
        date.getFullYear() +
        p(date.getMonth() + 1) +
        p(date.getDate()) +
        '-' +
        p(date.getHours()) +
        p(date.getMinutes()) +
        p(date.getSeconds());
    return 'newtab-pro-backup-' + stamp + '.json';
}

/** 导出并触发下载（唯一碰 DOM 的入口，等价于 legacy exportToFile） */
export async function exportToFile(): Promise<{
    fileName: string;
    bytes: number;
    stats: BackupStats;
}> {
    const built = await buildPayload();
    const text = JSON.stringify(built.payload, null, 2);
    const fileName = buildFileName();
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // 立刻 revoke 会让部分浏览器取消下载，延后释放
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { fileName, bytes: text.length, stats: built.stats };
}

/** 迁移链：v1 是白名单导出，防御性剔除缓存键 */
const migrations = [
    {
        from: 1,
        to: 2,
        migrate: (data: Record<string, unknown>): Record<string, unknown> => {
            const cleaned: Record<string, unknown> = {};
            for (const key of Object.keys(data)) {
                if (!isCacheKey(key)) cleaned[key] = data[key];
            }
            return cleaned;
        },
    },
];

/** 按 from 升序逐级推进到 SCHEMA_VERSION */
export function migrate(
    data: Record<string, unknown>,
    fromVersion: number
): { data: Record<string, unknown>; steps: number[] } {
    let current = data;
    const steps: number[] = [];
    let version = Number.isInteger(fromVersion) ? fromVersion : SCHEMA_VERSION;
    if (version >= SCHEMA_VERSION) return { data: current, steps };
    const chain = migrations.slice().sort((a, b) => a.from - b.from);
    for (const step of chain) {
        if (version === step.from) {
            current = step.migrate(current) || current;
            steps.push(step.to);
            version = step.to;
        }
    }
    return { data: current, steps };
}

export interface ValidatedBackup {
    data: Record<string, unknown>;
    schemaVersion: number;
    currentVersion: number;
    forwardCompat: boolean;
    migratedTo: number | null;
    upgradeSteps: number[];
    unknown: string[];
    skippedCache: string[];
    exportedAt: string | null;
    isStandard: boolean;
    droppedLinks: number;
    droppedItems: number;
}

/** 清洗链接字段（就地修改）：快捷方式/文件夹内条目/自定义引擎/壁纸地址 */
function sanitizeLinks(accepted: Record<string, unknown>): number {
    let dropped = 0;
    if (Array.isArray(accepted.quickAccessSites)) {
        const sites: unknown[] = [];
        for (const node of accepted.quickAccessSites) {
            if (!node || typeof node !== 'object') {
                dropped++;
                continue;
            }
            const item = node as Record<string, unknown>;
            if (item.isFolder) {
                const items = Array.isArray(item.items) ? item.items : [];
                const keptItems = items.filter((sub: unknown) => {
                    const ok =
                        !!sub &&
                        typeof sub === 'object' &&
                        isHttp((sub as Record<string, unknown>).url as string);
                    if (!ok) dropped++;
                    return ok;
                });
                item.items = keptItems;
                // 空文件夹保留：用户可能就是要占位，静默删掉等于吞数据
                sites.push(item);
                continue;
            }
            if (!isHttp(item.url as string)) {
                dropped++;
                continue;
            }
            sites.push(item);
        }
        accepted.quickAccessSites = sites;
    }
    if (Array.isArray(accepted.engineLogos)) {
        // logo 来自导入的不可信 JSON：只认本机裁剪产物的 data:image 位图，别的一律剥掉
        accepted.engineLogos = accepted.engineLogos.filter((entry: unknown) => {
            if (!entry || typeof entry !== 'object') return false;
            const { name, logo } = entry as Record<string, unknown>;
            return (
                typeof name === 'string' &&
                !!name.trim() &&
                typeof logo === 'string' &&
                /^data:image\/(png|jpeg|webp);base64,/i.test(logo)
            );
        });
    }
    if (Array.isArray(accepted.customEngines)) {
        // 旧版本把 logo 塞在引擎项里：迁移到 engineLogos，再从引擎项剥掉
        const legacy: unknown[] = [];
        for (const engine of accepted.customEngines) {
            if (!engine || typeof engine !== 'object') continue;
            const { name, logo } = engine as Record<string, unknown>;
            if (
                typeof name === 'string' &&
                typeof logo === 'string' &&
                /^data:image\/(png|jpeg|webp);base64,/i.test(logo)
            ) {
                legacy.push({ name, logo });
            }
            delete (engine as Record<string, unknown>).logo;
        }
        if (legacy.length) {
            const merged = Array.isArray(accepted.engineLogos) ? accepted.engineLogos : [];
            const seen = new Set(merged.map(e => (e as { name?: string }).name));
            accepted.engineLogos = [
                ...merged,
                ...legacy.filter(e => !seen.has((e as { name: string }).name)),
            ];
        }
        accepted.customEngines = accepted.customEngines.filter((engine: unknown) => {
            const ok =
                !!engine &&
                typeof engine === 'object' &&
                isHttp((engine as Record<string, unknown>).url as string);
            if (!ok) dropped++;
            return ok;
        });
    }
    // 壁纸地址会进 background-image：非图片地址留着只会变成远程探测。
    // 例外：本地壁纸的哨兵 URL 形如 local:<entryId>（useWallpaper 的库 id），
    // 它不是网址而是「从 localWallpapers 库按 id 恢复」的标记——删了它，
    // savedWallpaperId 虽在、cache 标记却丢，恢复链路会多绕一圈甚至误判。
    const wallpaperUrl = accepted.savedWallpaperUrl;
    if (
        'savedWallpaperUrl' in accepted &&
        typeof wallpaperUrl === 'string' &&
        !wallpaperUrl.startsWith('local:') &&
        !isImageSource(wallpaperUrl)
    ) {
        delete accepted.savedWallpaperUrl;
        dropped++;
    }
    return dropped;
}

/** 字段级清洗（就地修改）：顶层类型对得上不代表内容能用 */
function sanitizeValues(accepted: Record<string, unknown>): number {
    const isPlainObject = (v: unknown): v is Record<string, unknown> =>
        !!v && typeof v === 'object' && !Array.isArray(v);
    const asNumber = (v: unknown, min: number, max: number): number | undefined => {
        if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
        return Math.min(max, Math.max(min, v));
    };
    const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    let dropped = 0;

    // settings：按真实默认值的类型收敛；未登记字段原样保留（向前兼容）
    if (isPlainObject(accepted.settings)) {
        const rules: Record<string, (v: unknown) => unknown> = {
            pexelsApiKey: asString,
            weatherApiKey: asString,
            weatherCity: asString,
            temperatureUnit: v => (v === 'celsius' || v === 'fahrenheit' ? v : undefined),
            wallpaperQuery: asString,
            searchEngine: asString,
            tagline: asString,
            wallpaperBrightness: v => asNumber(v, 0.3, 1),
            wallpaperBlur: v => asNumber(v, 0, 20),
            showSideWidgets: v => (typeof v === 'boolean' ? v : undefined),
            wallpaperSource: v => (v === 'picsum' || v === 'wallhaven' ? v : undefined),
        };
        const cleanSettings: Record<string, unknown> = {};
        for (const key of Object.keys(accepted.settings)) {
            const rule = rules[key];
            if (!rule) {
                cleanSettings[key] = accepted.settings[key];
                continue;
            }
            const ok = rule(accepted.settings[key]);
            if (ok === undefined) {
                dropped++;
                continue;
            }
            cleanSettings[key] = ok;
        }
        accepted.settings = cleanSettings;
    }

    // todos：结构见 useTodo.ts
    if (Array.isArray(accepted.todos)) {
        const kept: Record<string, unknown>[] = [];
        for (const todo of accepted.todos) {
            if (!isPlainObject(todo) || typeof todo.content !== 'string') {
                dropped++;
                continue;
            }
            const item: Record<string, unknown> = { ...todo };
            item.important = todo.important === true;
            item.done = todo.done === true;
            item.category =
                ['work', 'life', 'normal'].indexOf(todo.category as string) !== -1
                    ? todo.category
                    : 'normal';
            if (typeof todo.createdAt !== 'number' || !Number.isFinite(todo.createdAt)) {
                delete item.createdAt;
            }
            if (typeof todo.completedAt !== 'number' || !Number.isFinite(todo.completedAt)) {
                item.completedAt = null;
            }
            item.dueDate = typeof todo.dueDate === 'string' ? todo.dueDate : null;
            kept.push(item);
        }
        accepted.todos = kept;
    }

    // notes：结构见 useNotes.ts
    if (Array.isArray(accepted.notes)) {
        accepted.notes = accepted.notes
            .filter((note: unknown) => {
                const ok = isPlainObject(note) && typeof note.content === 'string';
                if (!ok) dropped++;
                return ok;
            })
            .map((note: unknown) => {
                const item: Record<string, unknown> = { ...(note as Record<string, unknown>) };
                item.pinned = (note as Record<string, unknown>).pinned === true;
                return item;
            });
    }

    // searchHistory：v2.1 是纯字符串数组，v2.2 起是 { text, pinned, at } 对象数组。
    // 导入必须三种输入都吃（旧备份 / 新备份 / 手改过的混合数组），归一化规则
    // 与运行时 `composables/useSearch` 共用 lib/searchHistory 的实现，不再各写一套。
    if (Array.isArray(accepted.searchHistory)) {
        const before = accepted.searchHistory.length;
        const normalized = normalizeHistory(accepted.searchHistory);
        // 归一会去空、去重、截断；丢了多少条记在 dropped 里，恢复报告要如实报数
        dropped += Math.max(0, before - normalized.length);
        accepted.searchHistory = normalized;
    }
    return dropped;
}

/** 校验并归一化：只对结构性错误抛异常；未知键 / 更高版本一律降级处理 */
export function validate(raw: unknown): ValidatedBackup {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('备份文件格式不正确：顶层必须是对象');
    }
    const obj = raw as Record<string, unknown>;
    const isStandard = typeof obj.app === 'string';
    let data: unknown;
    let declaredVersion = SCHEMA_VERSION;
    let exportedAt: string | null = null;
    if (isStandard) {
        if (obj.app !== APP_ID) {
            throw new Error('这不是 New Tab Pro 的备份文件（app 标识不匹配）');
        }
        if (typeof obj.schemaVersion === 'number' && Number.isInteger(obj.schemaVersion)) {
            declaredVersion = obj.schemaVersion;
        }
        exportedAt = typeof obj.exportedAt === 'string' ? obj.exportedAt : null;
        data = obj.data;
    } else {
        // 裸数据：当作最早的格式
        data = obj;
        declaredVersion = 1;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('备份文件里没有可导入的数据');
    }
    // 先迁移到当前版本，再校验
    const migrated = migrate(data as Record<string, unknown>, declaredVersion);
    const source = migrated.data;
    const accepted: Record<string, unknown> = {};
    const unknown: string[] = [];
    const skippedCache: string[] = [];
    for (const key of Object.keys(source)) {
        if (isCacheKey(key)) {
            skippedCache.push(key);
            continue;
        }
        if (!SAFE_KEY_RE.test(key)) {
            throw new Error('字段名 "' + key + '" 不合法');
        }
        const value = source[key];
        const expected = expectedType(key);
        if (expected) {
            const actual = typeOf(value);
            if (actual !== expected) {
                throw new Error(
                    '字段 "' + key + '" 类型不正确：期望 ' + expected + '，实际 ' + actual
                );
            }
        } else {
            unknown.push(key);
        }
        accepted[key] = value;
    }
    const droppedLinks = sanitizeLinks(accepted);
    const droppedItems = sanitizeValues(accepted);
    if (Object.keys(accepted).length === 0) {
        throw new Error('备份文件里没有可导入的数据（未找到已知字段）');
    }
    return {
        data: accepted,
        schemaVersion: declaredVersion,
        currentVersion: SCHEMA_VERSION,
        forwardCompat: declaredVersion > SCHEMA_VERSION,
        migratedTo: migrated.steps.length ? migrated.steps[migrated.steps.length - 1] : null,
        upgradeSteps: migrated.steps,
        unknown,
        skippedCache,
        exportedAt,
        isStandard,
        droppedLinks,
        droppedItems,
    };
}

export interface ImportResult {
    keys: string[];
    unknown: string[];
    skippedCache: string[];
    schemaVersion: number;
    forwardCompat: boolean;
    migratedTo: number | null;
    exportedAt: string | null;
    droppedLinks: number;
    droppedItems: number;
}

/** 从文本导入（先校验，后写入；任一致命错误整体不写） */
export async function importFromText(text: string): Promise<ImportResult> {
    if (typeof text !== 'string' || !text.trim()) {
        throw new Error('文件内容为空');
    }
    // 用字节数而不是字符数：中文一个字占 3 字节
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > MAX_IMPORT_BYTES) {
        const mb = (MAX_IMPORT_BYTES / 1024 / 1024).toFixed(0);
        throw new Error('备份文件过大（超过 ' + mb + ' MB），已拒绝导入');
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        throw new Error('无法解析 JSON：' + (e as Error).message);
    }
    const checked = validate(raw);
    // 校验全部通过后才写入，避免「导入一半」
    await chrome.storage.local.set(checked.data);
    return {
        keys: Object.keys(checked.data),
        unknown: checked.unknown,
        skippedCache: checked.skippedCache,
        schemaVersion: checked.schemaVersion,
        forwardCompat: checked.forwardCompat,
        migratedTo: checked.migratedTo,
        exportedAt: checked.exportedAt,
        droppedLinks: checked.droppedLinks,
        droppedItems: checked.droppedItems,
    };
}
