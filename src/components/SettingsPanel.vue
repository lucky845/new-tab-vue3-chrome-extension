<script setup lang="ts">
import { log } from '@/src/lib/log';
/**
 * 设置面板（Vue3 移植）——markup 逐字来自 entrypoints/newtab.html:232-470。
 *
 * 移植映射（与 TodoPanel.vue / WallpaperPanel.vue 同款）：
 *   - legacy v1.8.1:js/app.js bindSettingsEvents/bindThemeEvents/bindBackupEvents/
 *     bindWallpaperAdjustmentEvents/bindCustomEngineEvents/bindSideWidgets：
 *     事件与响应式值以 Vue 指令/插值为主；壁纸滤镜、侧栏显隐等作用于
 *     HTML 静态节点的样式仍由组件内函数按 id 更新（见 applyWallpaperFilters）。
 *   - 数据层全部走 ESM：useSettings.ts / useTheme.ts / backup.ts，
 *     不再经全局 Manager 对象；settings 共享键用 read-modify-write 避免 useStored 回声。
 *   - 保存语义：面板不再有「保存」按钮 —— 手填类字段停手 3 秒自动落盘（scheduleAutosave），
 *     关闭面板时若还在冷却期内则立即补存（flushAutosave）；引擎的增删改/换图标即时落盘。
 *   - 主题预览语义：preview() 只改内存+apply，不落盘；自动保存或关闭面板时才 themeApi.save()。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { usePanels } from '@/src/composables/usePanels';
import GlassPanel from '@/src/components/common/GlassPanel.vue';
import { useTheme, type ThemeMode, type ThemeSettings } from '@/src/composables/useTheme';
import {
    readSettings,
    saveFromPanel,
    setTagline,
    patchSettings,
    getWallpaperAdjustments,
    setWallpaperAdjustments,
    getWallpaperSource,
    type CustomEngine,
} from '@/src/composables/useSettings';
import { buildPayload, exportToFile, importFromText, SCHEMA_VERSION } from '@/src/lib/backup';
import { copyText } from '@/src/lib/clipboard';
import { siteIconUrl } from '@/src/lib/iconSafe';
import EngineIcon from '@/src/components/EngineIcon.vue';
import EngineLogoPicker from '@/src/components/EngineLogoPicker.vue';
import { useWallpaper } from '@/src/composables/useWallpaper';
import { onWeatherSettingsSaved } from '@/src/composables/useWeather';
import { useSearch } from '@/src/composables/useSearch';
import { SIDE_CARD_LABELS, useSideCards, type SideCardId, type SideCardMode } from '@/src/composables/useSideCards';
import { toast as showToast } from '@/src/composables/useToast';
import { SHORTCUTS } from '@/src/config/shortcuts';

const panels = usePanels();
const themeApi = useTheme();
const wallpaper = useWallpaper();

/* ---------- 分页（tab）：一次只渲染一组设置项，避免整面板滚动触发大范围重绘掉帧 ---------- */
type SettingsTab = 'search' | 'wallpaper' | 'theme' | 'home' | 'advanced';
const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'search', label: '搜索' },
    { id: 'wallpaper', label: '壁纸' },
    { id: 'theme', label: '主题' },
    { id: 'home', label: '主页' },
    { id: 'advanced', label: '高级' },
];
const activeTab = ref<SettingsTab>('search');
/** 切页时把内容区滚回顶部，避免停在上一页的滚动位置。 */
const scrollEl = ref<HTMLElement | null>(null);
function selectTab(id: SettingsTab): void {
    if (activeTab.value === id) return;
    activeTab.value = id;
    if (scrollEl.value) scrollEl.value.scrollTop = 0;
}

/* ---------- 表单状态（legacy openSettingsPanel 回显的 11 个字段） ---------- */
const pexelsKey = ref('');
const weatherApiKey = ref('');
const weatherCity = ref('');
const tagline = ref('');
const brightness = ref(1);
const blur = ref(0);
const wallpaperSource = ref<'picsum' | 'wallhaven'>('picsum');
const showSideWidgets = ref(true);

const engineName = ref('');
const engineUrl = ref('');
const customEngines = ref<CustomEngine[]>([]);
/** 新增引擎时先截好的 logo（取消添加即丢弃，不落盘） */
const engineLogo = ref<string>('');

/* ---------- 密钥可见性（visibility-toggle.js 的 EYE/EYE_OFF 逐字内联） ---------- */
const EYE =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M1.8 12S5.6 5.5 12 5.5 22.2 12 22.2 12 18.4 18.5 12 18.5 1.8 12 1.8 12Z"/><circle cx="12" cy="12" r="3.2"/></svg>';
const EYE_OFF =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 3l18 18"/><path d="M10.6 6.2A9.9 9.9 0 0 1 12 6.1c6.4 0 10.2 5.9 10.2 5.9a17.4 17.4 0 0 1-3.6 4.1"/><path d="M6.3 7.5A17.6 17.6 0 0 0 1.8 12s3.8 5.9 10.2 5.9c1.5 0 2.9-.3 4.2-.9"/><path d="M9.9 14.1a3.2 3.2 0 0 0 4.2-4.2"/></svg>';
const pexelsHidden = ref(true);
const weatherHidden = ref(true);
function eyeIcon(hidden: boolean): string {
    return hidden ? EYE_OFF : EYE;
}
function visibilityLabel(hidden: boolean): string {
    return hidden ? '显示密钥' : '隐藏密钥';
}

/* ---------- 主题预览（legacy previewThemeMode / snapshotTheme / markThemeDirty） ---------- */
const themeMode = ref<ThemeMode>('auto');
const themeLightStart = ref('07:00');
const themeDarkStart = ref('18:00');
const themePending = ref(false);
let themeSnapshot: ThemeSettings | null = null;

const isSun = computed(() => themeMode.value === 'sun');
const sunStatus = computed<string>(() => {
    if (!isSun.value) return '';
    const sun = themeApi.sunTimes.value;
    if (sun && !themeApi.getState().sunApproximate) {
        return '今日日出 ' + sun.sunrise + '、日落 ' + sun.sunset + '，将按此时刻自动切换。';
    }
    return (
        '未取得当地日出日落，暂用自定义时段（' +
        themeLightStart.value +
        ' 起浅色、' +
        themeDarkStart.value +
        ' 起深色）。'
    );
});

function markThemeDirty(): void {
    const snap = themeSnapshot;
    if (!snap) return;
    themePending.value =
        snap.mode !== themeMode.value ||
        snap.lightStart !== themeLightStart.value ||
        snap.darkStart !== themeDarkStart.value;
}

/** 从主题状态机回显表单（打开面板 / 初始化后调用） */
function syncThemeForm(): void {
    const st = themeApi.getState();
    themeMode.value = st.mode;
    themeLightStart.value = st.lightStart;
    themeDarkStart.value = st.darkStart;
    themeSnapshot = { mode: st.mode, lightStart: st.lightStart, darkStart: st.darkStart };
    themePending.value = false;
}

/** radio change：只改内存态并重新解析，不写 storage（legacy previewThemeMode） */
function previewThemeMode(): void {
    themeApi.preview({ mode: themeMode.value });
    markThemeDirty();
}

/** time change：非空值并入预览态（legacy previewThemeSunWindow） */
function previewThemeSunWindow(): void {
    const patch: Partial<ThemeSettings> = {};
    if (themeLightStart.value) patch.lightStart = themeLightStart.value;
    if (themeDarkStart.value) patch.darkStart = themeDarkStart.value;
    themeApi.preview(patch);
    markThemeDirty();
}

/* ---------- 壁纸亮度/模糊：实时应用 + 400ms 防抖持久化 ---------- */
let adjustTimer: ReturnType<typeof setTimeout> | null = null;

function applyWallpaperFilters(b = brightness.value, bl = blur.value): void {
    const container = document.getElementById('wallpaper');
    if (!container) return;
    const filters: string[] = [];
    if (b !== 1) filters.push('brightness(' + b + ')');
    if (bl > 0) filters.push('blur(' + bl + 'px)');
    container.style.filter = filters.join(' ');
    container.style.transform = bl > 0 ? 'scale(1.04)' : '';
}

function onAdjustmentInput(): void {
    applyWallpaperFilters();
    if (adjustTimer) clearTimeout(adjustTimer);
    adjustTimer = setTimeout(() => {
        void setWallpaperAdjustments(brightness.value, blur.value);
    }, 400);
}

const brightnessText = computed(() => Math.round(brightness.value * 100) + '%');
const blurText = computed(() => blur.value + 'px');

/* ---------- 主页小组件显隐（legacy applySideWidgetsVisibility + bindSideWidgets toggle） ---------- */
function applySideWidgetsVisibility(show = showSideWidgets.value): void {
    ['side-widgets', 'side-widgets-right'].forEach(id => {
        document.getElementById(id)?.classList.toggle('u-hidden', !show);
    });
}

const sideCards = useSideCards();

/** 三态下拉的选项文案。'always' 是默认值，放首位。 */
const SIDE_CARD_MODE_OPTIONS: Array<{ value: SideCardMode; label: string }> = [
    { value: 'always', label: '总是显示' },
    { value: 'auto', label: '有内容时出现' },
    { value: 'never', label: '隐藏' },
];

function sideCardMode(id: SideCardId): SideCardMode {
    return sideCards.modes.value[id] ?? 'always';
}

function onSideCardModeChange(id: SideCardId, event: Event): void {
    const value = (event.target as HTMLSelectElement).value as SideCardMode;
    sideCards.setMode(id, value);
}

async function onShowSideWidgetsChange(): Promise<void> {
    await patchSettings({ showSideWidgets: showSideWidgets.value });
    applySideWidgetsVisibility();
    showToast(showSideWidgets.value ? '主页小组件已显示' : '主页小组件已隐藏', 'success', 1500);
}

/* ---------- 自定义引擎（legacy refreshCustomEngines / bindCustomEngineEvents） ---------- */
function engineHost(url: string): string {
    try {
        return new URL(url.replace('%s', '')).hostname;
    } catch {
        return '';
    }
}

async function refreshCustomEngines(): Promise<void> {
    // 读的是 useSearch 的实时态（带 logo / 品牌 icon），而不是盘上的裸列表：
    // 换完图标当场就能看到新图标。落盘只在 persist* 里发生，这里不会产生 onChanged 风暴。
    const engines = useSearch().engines.value.filter(e => e.isCustom);
    customEngines.value = engines.map(e => ({
        name: e.name,
        url: e.url,
        logo: e.logo,
        icon: e.icon,
    }));
}

async function addEngine(): Promise<void> {
    const result = await useSearch().addCustomEngine(
        engineName.value,
        engineUrl.value,
        engineLogo.value || undefined
    );
    if (!result.ok) {
        showToast(result.message || '添加失败', 'error');
        return;
    }
    engineName.value = '';
    engineUrl.value = '';
    engineLogo.value = '';
    await refreshCustomEngines();
    showToast('自定义引擎已添加', 'success');
}

async function removeEngine(name: string): Promise<void> {
    await useSearch().removeCustomEngine(name);
    await refreshCustomEngines();
    showToast('已删除引擎「' + name + '」', 'success');
}

/* ---------- 已有引擎换图标 ---------- */
/** 正在改图标的引擎名；空串表示没有在编辑 */
const logoEditing = ref('');
function toggleLogoEditor(name: string): void {
    logoEditing.value = logoEditing.value === name ? '' : name;
}
/**
 * 换图标的落地动作。logo 传 undefined 即清空（只清用户裁的那张），
 * favicon 兜底层不动 —— 恢复默认后还能看到站点图标，再没有才退到首字。
 */
async function onEngineLogoChanged(name: string, logo: string | undefined): Promise<void> {
    await useSearch().setEngineLogo(name, logo);
    await refreshCustomEngines();
    showToast(logo ? '图标已更新' : '已恢复默认图标', 'success');
    logoEditing.value = '';
}

/**
 * 从站点图标服务取一张图当图标（抓不到就退回首字）。
 *
 * 扩展不申请任何站点的 host_permissions，所以这里读不到跨源字节，只能把图当
 * <img> 解码后画进 canvas 再导出 data URL —— 这与「不挂外链请求」的老做法有个取舍：
 * 服务端若不给 CORS，这次取图会失败并提示换图，而不是偷偷退回远程 URL。
 */
async function useSiteIcon(name: string, url: string): Promise<void> {
    const host = engineHost(url);
    if (!host) {
        showToast('这个引擎的地址解析不出域名', 'error');
        return;
    }
    const dataUrl = await fetchIconDataUrl(siteIconUrl(host, 128));
    if (!dataUrl) {
        showToast('没抓到站点图标，换个图试试', 'error');
        return;
    }
    await useSearch().setEngineLogo(name, undefined);
    await useSearch().setEngineIconImage(name, dataUrl);
    await refreshCustomEngines();
    showToast('已换成站点图标', 'success');
    logoEditing.value = '';
}

/** 把图标地址取成 data URL：图标层只收 data:image，不挂外链请求 */
async function fetchIconDataUrl(url: string): Promise<string | undefined> {
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx || !canvas.width) return undefined;
        ctx.drawImage(img, 0, 0);
        return canvas.toDataURL('image/png');
    } catch {
        // 跨源图不带 CORS 头时 canvas 被判定 tainted，toDataURL 抛 SecurityError
        return undefined;
    }
}

/** 内置引擎：只读展示，不提供换图标入口 —— 品牌图标就是它的身份 */
const builtinEngines = computed(() => useSearch().engines.value.filter(e => !e.isCustom));

/* ---------- 备份与恢复（legacy exportData / importData / setBackupStatus） ---------- */
const DEFAULT_BACKUP_STATUS =
    '备份是单个 JSON，含设置、搜索引擎与图标、快捷方式、待办、便签、番茄钟、搜索历史、侧边卡片布局、主题偏好、壁纸（含本地壁纸库）。天气、地理与日出缓存不导出（恢复后自动重新获取）。可下载成文件，也可复制到剪贴板或粘贴文本导入。';
const backupStatus = ref(DEFAULT_BACKUP_STATUS);
const backupKind = ref<'' | 'error' | 'success'>('');
const exportDisabled = ref(false);
const importDisabled = ref(false);
const importInput = ref<HTMLInputElement | null>(null);
/** 剪贴板不可用时的粘贴兜底输入（粘贴由浏览器原生处理，不需要 clipboardRead 权限） */
const pasteText = ref('');
const pasteOpen = ref(false);

function setBackupStatus(message: string, kind: '' | 'error' | 'success'): void {
    backupStatus.value = message;
    backupKind.value = kind;
}

async function exportData(): Promise<void> {
    exportDisabled.value = true;
    try {
        const result = await exportToFile();
        const kb = (result.bytes / 1024).toFixed(1);
        setBackupStatus(
            '已导出 ' + result.fileName + '（' + result.stats.keys + ' 项，约 ' + kb + ' KB）',
            'success'
        );
        showToast('备份已导出', 'success');
    } catch (error) {
        log.error('导出备份失败:', error);
        setBackupStatus('导出失败：' + ((error as Error).message || '未知错误'), 'error');
        showToast('导出备份失败', 'error');
    } finally {
        // 成功失败都要解锁按钮，否则一次异常后按钮永久不可用
        exportDisabled.value = false;
    }
}

/**
 * 导入的唯一落地实现：文件选择与剪贴板两条入口共用。
 * 成功后会刷新页面（各模块内存里持有旧数据，直接改 storage 不会自动生效）。
 */
async function applyImportText(text: string): Promise<void> {
    importDisabled.value = true;
    try {
        const result = await importFromText(text);
        const notes: string[] = [];
        if (result.migratedTo) notes.push('已从 v' + result.schemaVersion + ' 升级格式');
        if (result.forwardCompat) {
            notes.push(
                '备份版本 v' +
                    result.schemaVersion +
                    ' 高于当前 v' +
                    SCHEMA_VERSION +
                    '，已尽力兼容'
            );
        }
        if (result.unknown && result.unknown.length) {
            notes.push('保留 ' + result.unknown.length + ' 项未知数据');
        }
        if (result.droppedLinks) notes.push('跳过 ' + result.droppedLinks + ' 个不支持的链接');
        if (result.droppedItems) notes.push('跳过 ' + result.droppedItems + ' 项类型不符的数据');
        const detail = notes.length ? '（' + notes.join('；') + '）' : '';
        const when = result.exportedAt ? '，备份于 ' + result.exportedAt.slice(0, 10) : '';
        setBackupStatus(
            '已导入 ' + result.keys.length + ' 项数据' + when + detail + '，即将刷新页面生效…',
            'success'
        );
        pasteText.value = '';
        showToast('导入成功，正在刷新…', 'success');
        // 各模块内存里持有旧数据，直接改 storage 不会自动生效，刷新最稳妥
        setTimeout(() => window.location.reload(), 900);
    } catch (error) {
        log.error('导入备份失败:', error);
        const message = (error as Error).message || '未知错误';
        setBackupStatus('导入失败：' + message, 'error');
        showToast('导入失败：' + (message || '文件不合法'), 'error');
        importDisabled.value = false;
    }
    // 成功分支不重置按钮：页面即将刷新，避免出现「可再次点击」的瞬时假象
}

async function importData(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input && input.files && input.files[0];
    if (!file) return;
    try {
        await applyImportText(await file.text());
    } finally {
        // 无论成功失败都清空 input，否则连续导入同一个文件不会再触发 change
        if (input) input.value = '';
    }
}

/** 粘贴框导入：剪贴板 API 被拒时的最后一条路，纯本地文本不碰权限 */
async function importFromPasteBox(): Promise<void> {
    if (!pasteText.value.trim()) {
        setBackupStatus('粘贴框是空的，请先粘贴备份内容', 'error');
        return;
    }
    await applyImportText(pasteText.value);
}
function openImportPicker(): void {
    importInput.value?.click();
}

/** 复制整份备份 JSON 到剪贴板：小体量数据不用落盘再找文件 */
async function copyBackup(): Promise<void> {
    exportDisabled.value = true;
    try {
        const built = await buildPayload();
        const text = JSON.stringify(built.payload, null, 2);
        const kb = (new TextEncoder().encode(text).length / 1024).toFixed(1);
        if (!(await copyText(text))) {
            setBackupStatus('复制失败：剪贴板不可用，请改用「导出备份」下载文件', 'error');
            showToast('复制备份失败', 'error');
            return;
        }
        setBackupStatus('已复制备份（' + built.stats.keys + ' 项，约 ' + kb + ' KB）到剪贴板', 'success');
        showToast('备份已复制', 'success');
    } catch (error) {
        log.error('复制备份失败:', error);
        setBackupStatus('复制失败：' + ((error as Error).message || '未知错误'), 'error');
        showToast('复制备份失败', 'error');
    } finally {
        exportDisabled.value = false;
    }
}

/* ---------- 打开回显 / 关闭回滚 / 保存 ---------- */
let hydratePromise: Promise<void> | null = null;
async function hydrate(): Promise<void> {
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
        await ensureThemeInit();
        const s = await readSettings();
        pexelsKey.value = s.pexelsApiKey || '';
        weatherApiKey.value = s.weatherApiKey || '';
        weatherCity.value = s.weatherCity || '';
        tagline.value = s.tagline || '';
        const adj = getWallpaperAdjustments(s);
        brightness.value = adj.brightness;
        blur.value = adj.blur;
        wallpaperSource.value = getWallpaperSource(s);
        showSideWidgets.value = s.showSideWidgets !== false;
        applyWallpaperFilters(adj.brightness, adj.blur);
        applySideWidgetsVisibility(showSideWidgets.value);
        await refreshCustomEngines();
        syncThemeForm();
        hydrated = true;
    })().catch(error => {
        hydratePromise = null;
        throw error;
    });
    return hydratePromise;
}

/** 自动保存冷却：停手 3 秒后才落盘 */
const AUTOSAVE_DELAY = 3000;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;

/** 记一笔改动，3 秒内没有新改动就落盘 */
function scheduleAutosave(): void {
    if (!hydrated) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
        autosaveTimer = null;
        void save();
    }, AUTOSAVE_DELAY);
}

function flushAutosave(): void {
    if (!autosaveTimer) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    void save();
}

function closePanel(): void {
    // 关得比冷却期还快：先把还没落盘的改动补上，别让「自动保存」变成「自动丢失」
    flushAutosave();
    panels.close('settings');
}

async function save(): Promise<void> {
    const pexels = pexelsKey.value.trim();
    const city = weatherCity.value.trim();
    const wKey = weatherApiKey.value.trim();
    const line = tagline.value.trim();
    // 只写「这次真的变了」的字段：自动保存 3 秒一触发，整体重写会连累壁纸重载、天气重取
    const current = await readSettings();
    const patch: Parameters<typeof saveFromPanel>[0] = {
        pexelsApiKey: current.pexelsApiKey || '',
        weatherApiKey: current.weatherApiKey || '',
        weatherCity: current.weatherCity || '',
        wallpaperSource: current.wallpaperSource || 'picsum',
    };
    const sourceChanged = wallpaperSource.value !== patch.wallpaperSource;
    if (pexels !== patch.pexelsApiKey) patch.pexelsApiKey = pexels;
    if (wKey && wKey !== patch.weatherApiKey) patch.weatherApiKey = wKey;
    if (city !== patch.weatherCity) patch.weatherCity = city;
    if (sourceChanged) patch.wallpaperSource = wallpaperSource.value;
    // 一条都没变就别重写 storage —— 自动保存每 3 秒触发一次，整体重写会连累下游联动
    const settingsChanged =
        patch.pexelsApiKey !== (current.pexelsApiKey || '') ||
        patch.weatherApiKey !== (current.weatherApiKey || '') ||
        patch.weatherCity !== (current.weatherCity || '') ||
        patch.wallpaperSource !== (current.wallpaperSource || 'picsum');

    try {
        if (settingsChanged) await saveFromPanel(patch);
        if (sourceChanged) {
            // 图源可能换了能力：旧图源留下的「不支持分类」告警必须清掉
            wallpaper.categoryUnsupported.value = false;
        }
        // 主题：预览态在这里才真正落盘
        await themeApi.save({
            mode: themeMode.value,
            lightStart: themeLightStart.value,
            darkStart: themeDarkStart.value,
        });
        syncThemeForm();
        // 标语：ClockBlock 经 useStored 的 onChanged 响应式重算，无需手动写 DOM
        if (line !== (current.tagline || '')) await setTagline(line);
        // 持久化（settings/theme/tagline）全部完成后再给 toast；天气/壁纸联动要走网络、
        // 可能超时重试，所以 fire-and-forget，网络结果回来后各 composable 自行更新状态。
        themePending.value = false;
        log.log('设置已自动保存');
        showToast('设置已自动保存', 'success', 1500);
        // 联动只跟着真正变化的字段走：没换城市/Key 就不重取天气，没换图源就不重拉壁纸
        if (city !== (current.weatherCity || '') || wKey !== (current.weatherApiKey || '')) {
            void Promise.resolve(onWeatherSettingsSaved(city, wKey)).catch(e =>
                log.warn('天气设置联动失败:', e)
            );
        }
        if (sourceChanged) {
            void Promise.resolve(wallpaper.fetchAndSetWallpaper()).catch(e =>
                log.warn('壁纸设置联动失败:', e)
            );
        }
    } catch (error) {
        log.error('保存设置失败:', error);
        showToast('保存设置失败，请重试', 'error');
    }
}

/* ---------- 主题状态机启动（模块级单例，只 init 一次） ---------- */
let themeInitPromise: Promise<unknown> | null = null;
function ensureThemeInit(): Promise<unknown> {
    if (!themeInitPromise) themeInitPromise = themeApi.init();
    return themeInitPromise;
}

onMounted(() => {
    // 启动回显与打开面板共用同一份单次 hydrate，消除两份 readSettings 与重复渲染。
    void hydrate();
});

onUnmounted(() => {
    if (adjustTimer) clearTimeout(adjustTimer);
    if (autosaveTimer) clearTimeout(autosaveTimer);
});

/**
 * 需要「停手 3 秒自动保存」的字段：面板里手填、且写盘有明显副作用的（要触发壁纸重载、
 * 天气重取、主题重算）。即时生效的那几项（壁纸亮度、小组件显隐、引擎增删改）自己不进来，
 * 否则会多写一次盘。
 */
watch(
    [
        pexelsKey,
        weatherApiKey,
        weatherCity,
        tagline,
        wallpaperSource,
        themeMode,
        themeLightStart,
        themeDarkStart,
    ],
    () => scheduleAutosave()
);

watch(
    () => panels.isOpen('settings'),
    open => {
        // 重复开关不再重新读盘；只同步可能被主题预览改过的表单状态。
        if (open) {
            void hydrate().then(() => syncThemeForm());
        }
    }
);
</script>

<template>
    <GlassPanel
        panelId="settings"
        :open="panels.isOpen('settings')"
        variant="settings"
        elementId="settings-panel"
        @dismiss="closePanel"
      >
        <div class="settings-content">
            <button
                id="close-settings-btn"
                class="close-panel-btn"
                type="button"
                title="关闭"
                @click="closePanel"
            >
                ✕
            </button>
            <div class="settings-head">
                <h2>设置</h2>
                <p class="settings-autosave" role="status">静置 3s 自动保存</p>
            </div>
            <div class="settings-tabs" role="tablist">
                    <button
                        v-for="tab in settingsTabs"
                        :key="tab.id"
                        type="button"
                        role="tab"
                        class="settings-tab"
                        :class="{ 'is-active': activeTab === tab.id }"
                        :aria-selected="activeTab === tab.id"
                        @click="selectTab(tab.id)"
                    >
                        {{ tab.label }}
                    </button>
            </div>
            <div class="settings-scroll" ref="scrollEl">
                <!-- 搜索 -->
                <div class="setting-item" v-show="activeTab === 'search'">
                    <label>自定义搜索引擎</label>
                    <div class="custom-engine-row">
                        <input
                            type="text"
                            id="custom-engine-name-input"
                            v-model="engineName"
                            placeholder="名称，如 知乎"
                        />
                        <input
                            type="text"
                            id="custom-engine-url-input"
                            v-model="engineUrl"
                            placeholder="https://www.zhihu.com/search?type=content&q=%s"
                        />
                        <button id="custom-engine-add-btn" class="settings-btn" @click="addEngine">
                            添加
                        </button>
                    </div>
                    <details class="engine-add-picker" :open="!!engineLogo">
                        <summary>新引擎的图标（可选）</summary>
                        <EngineLogoPicker :name="engineName" @update="engineLogo = $event ?? ''" />
                    </details>
                    <ul id="custom-engine-list" class="custom-engine-list">
                        <li v-if="customEngines.length === 0" class="engine-host">
                            暂无自定义引擎
                        </li>
                        <li
                            v-for="engine in customEngines"
                            :key="engine.name"
                            class="custom-engine-item"
                        >
                            <div class="custom-engine-row-main">
                                <EngineIcon
                                    class="custom-engine-icon"
                                    :icon="engine.icon"
                                    :logo="engine.logo"
                                    :name="engine.name"
                                />
                                <span class="custom-engine-text"
                                    >{{ engine.name }}
                                    <span class="engine-host">{{
                                        engineHost(engine.url)
                                    }}</span></span
                                >
                                <button
                                    class="engine-logo-btn"
                                    title="用站点 favicon 当图标"
                                    @click="useSiteIcon(engine.name, engine.url)"
                                >
                                    站点图标
                                </button>
                                <button
                                    class="engine-logo-btn"
                                    title="选一张图当图标"
                                    @click="toggleLogoEditor(engine.name)"
                                >
                                    {{ engine.logo ? '换图' : '选图' }}
                                </button>
                                <button
                                    v-if="engine.logo"
                                    class="engine-logo-btn"
                                    title="清空图标，退回站点 favicon 或首字"
                                    @click="onEngineLogoChanged(engine.name, undefined)"
                                >
                                    清空
                                </button>
                                <button
                                    class="engine-remove"
                                    title="删除"
                                    @click="removeEngine(engine.name)"
                                >
                                    ×
                                </button>
                            </div>
                            <EngineLogoPicker
                                v-if="logoEditing === engine.name"
                                :name="engine.name"
                                :current-logo="engine.logo"
                                @update="logo => onEngineLogoChanged(engine.name, logo)"
                            />
                        </li>
                    </ul>
                    <p class="api-key-description">
                        搜索链接中用 %s
                        代表关键词占位符，添加后可在搜索框下拉中选择。自定义引擎可以拖图取景，
                        不设置时先用站点 favicon，抓不到再用名称首字；内置引擎固定用品牌图标。
                    </p>

                    <label class="engine-builtin-label">内置引擎</label>
                    <ul class="custom-engine-list">
                        <li
                            v-for="engine in builtinEngines"
                            :key="engine.name"
                            class="custom-engine-item"
                        >
                            <div class="custom-engine-row-main">
                                <EngineIcon
                                    class="custom-engine-icon"
                                    :icon="engine.icon"
                                    :logo="engine.logo"
                                    :name="engine.name"
                                />
                                <span class="custom-engine-text">{{ engine.name }}</span>
                            </div>
                        </li>
                    </ul>
                </div>

                <div class="setting-item" v-show="activeTab === 'home'">
                    <label for="weather-city-input">天气城市</label>
                    <div class="input-with-icon">
                        <input
                            type="text"
                            id="weather-city-input"
                            v-model="weatherCity"
                            placeholder="例如: 北京, 上海, 广州"
                        />
                    </div>
                    <p class="api-key-description">留空将自动使用您的位置，或手动输入城市名称。</p>
                </div>

                <div class="setting-item" v-show="activeTab === 'home'">
                    <label for="tagline-input">首页标语</label>
                    <div class="input-with-icon">
                        <input
                            type="text"
                            id="tagline-input"
                            v-model="tagline"
                            maxlength="40"
                            placeholder="例如：今天也要好好写代码"
                        />
                    </div>
                    <p class="api-key-description">显示在时钟下方，留空则隐藏。</p>
                </div>

                <div class="setting-item" v-show="activeTab === 'wallpaper'">
                    <label for="wallpaper-brightness-input">
                        壁纸亮度 <span id="brightness-value">{{ brightnessText }}</span>
                    </label>
                    <input
                        type="range"
                        id="wallpaper-brightness-input"
                        v-model.number="brightness"
                        min="0.3"
                        max="1"
                        step="0.01"
                        @input="onAdjustmentInput"
                    />
                    <label for="wallpaper-blur-input">
                        壁纸模糊 <span id="blur-value">{{ blurText }}</span>
                    </label>
                    <input
                        type="range"
                        id="wallpaper-blur-input"
                        v-model.number="blur"
                        min="0"
                        max="20"
                        step="1"
                        @input="onAdjustmentInput"
                    />
                    <p class="api-key-description">
                        调整壁纸观感，文字更易读。修改后立即生效并自动保存。
                    </p>
                </div>

                <div class="setting-item" v-show="activeTab === 'wallpaper'">
                    <label>壁纸图源</label>
                    <div id="wallpaper-source-options" class="wallpaper-source-options">
                        <label class="source-option">
                            <input
                                type="radio"
                                name="wallpaper-source"
                                value="picsum"
                                v-model="wallpaperSource"
                            />
                            <span class="source-option-text">
                                <strong>Picsum 精选（默认）</strong>
                                <small
                                    >国内直连稳定可达，Unsplash 精选摄影图，无需任何密钥。<strong
                                        >仅支持按页浏览，不支持按分类 / 关键词筛选</strong
                                    >；点分类时会自动尝试
                                    Wallhaven，连不上则退化为浏览模式并给出提示。</small
                                >
                            </span>
                        </label>
                        <label class="source-option">
                            <input
                                type="radio"
                                name="wallpaper-source"
                                value="wallhaven"
                                v-model="wallpaperSource"
                            />
                            <span class="source-option-text">
                                <strong>Wallhaven（支持分类与关键词）</strong>
                                <small
                                    >唯一支持按分类 /
                                    关键词真正筛选的图源，壁纸质量高；需要能访问境外网络（wallhaven.cc
                                    国内直连不稳定）。想用分类筛选请选这个。</small
                                >
                            </span>
                        </label>
                    </div>
                    <p class="api-key-description">
                        切换后重新打开壁纸库生效；启动壁纸与「换一张」也会使用所选图源。
                    </p>
                </div>

                <div class="setting-item" v-show="activeTab === 'theme'">
                    <label class="theme-section-label">外观主题</label>
                    <div id="theme-options" class="theme-options">
                        <label class="theme-option">
                            <input
                                type="radio"
                                name="theme-mode"
                                value="light"
                                v-model="themeMode"
                                @change="previewThemeMode"
                            />
                            <span class="theme-option-text">
                                <strong>浅色</strong>
                                <small>始终保持原样：白字浮在壁纸上</small>
                            </span>
                        </label>
                        <label class="theme-option">
                            <input
                                type="radio"
                                name="theme-mode"
                                value="dark"
                                v-model="themeMode"
                                @change="previewThemeMode"
                            />
                            <span class="theme-option-text">
                                <strong>深色</strong>
                                <small>在原样式基础上压暗壁纸</small>
                            </span>
                        </label>
                        <label class="theme-option">
                            <input
                                type="radio"
                                name="theme-mode"
                                value="auto"
                                v-model="themeMode"
                                @change="previewThemeMode"
                            />
                            <span class="theme-option-text">
                                <strong>跟随系统</strong>
                                <small>按操作系统的浅色/深色偏好切换</small>
                            </span>
                        </label>
                        <label class="theme-option">
                            <input
                                type="radio"
                                name="theme-mode"
                                value="sun"
                                v-model="themeMode"
                                @change="previewThemeMode"
                            />
                            <span class="theme-option-text">
                                <strong>日出日落</strong>
                                <small>白天浅色、夜晚深色</small>
                            </span>
                        </label>
                    </div>
                    <div
                        id="theme-sun-window"
                        class="theme-sun-window"
                        :class="{ 'u-hidden': !isSun }"
                    >
                        <label for="theme-light-start">白天开始</label>
                        <input
                            type="time"
                            id="theme-light-start"
                            v-model="themeLightStart"
                            @change="previewThemeSunWindow"
                        />
                        <label for="theme-dark-start">夜晚开始</label>
                        <input
                            type="time"
                            id="theme-dark-start"
                            v-model="themeDarkStart"
                            @change="previewThemeSunWindow"
                        />
                    </div>
                    <p
                        id="theme-sun-status"
                        class="theme-sun-status"
                        :class="{ 'u-hidden': !isSun }"
                    >
                        {{ sunStatus }}
                    </p>
                    <p class="api-key-description">
                        日出日落会自动读取当地日出/日落时刻；拿不到定位或网络时，改用上面的自定义时段。
                        <span
                            id="theme-pending-hint"
                            class="theme-pending-hint"
                            :class="{ 'u-hidden': !themePending }"
                            >已改为预览态，停手 3 秒自动保存</span
                        >
                    </p>
                </div>

                <div class="setting-item" v-show="activeTab === 'theme'">
                    <label>小组件显示</label>
                    <div class="side-card-modes">
                        <!-- 总开关与四张卡同一玻璃卡族；用 div 不用 label，避开
                             .setting-item label 的 display:block 与 >span 的 float:right -->
                        <div class="side-card-mode side-card-mode-master">
                            <span class="side-card-mode-label">主页显示小组件</span>
                            <input
                                type="checkbox"
                                id="show-side-widgets-toggle"
                                aria-label="主页显示小组件"
                                v-model="showSideWidgets"
                                @change="onShowSideWidgetsChange"
                            />
                            <small class="side-card-mode-hint">
                                待办 / 便签 / 番茄钟常驻两侧；关闭后可随时点右上角按钮打开对应面板
                            </small>
                        </div>
                        <div
                            v-for="card in SIDE_CARD_LABELS"
                            :key="card.id"
                            class="side-card-mode"
                        >
                            <span class="side-card-mode-label">{{ card.label }}</span>
                            <select
                                :id="`side-card-mode-${card.id}`"
                                :aria-label="card.label"
                                :value="sideCardMode(card.id)"
                                @change="onSideCardModeChange(card.id, $event)"
                            >
                                <option
                                    v-for="opt in SIDE_CARD_MODE_OPTIONS"
                                    :key="opt.value"
                                    :value="opt.value"
                                >
                                    {{ opt.label }}
                                </option>
                            </select>
                            <small class="side-card-mode-hint">{{ card.hint }}</small>
                        </div>
                    </div>
                    <p class="api-key-description">
                        四张卡片默认展示，可按需改为「有内容时出现」或「隐藏」；关掉后中间内容会自动收回让出的宽度。
                    </p>
                </div>

                <!-- 可选增强（高级）：以下两项均无需配置，扩展开箱即用 -->
                <div class="setting-item" v-show="activeTab === 'advanced'">
                    <label for="api-key-input">Pexels API 密钥（可选增强）</label>
                    <div class="input-with-icon">
                        <input
                            :type="pexelsHidden ? 'password' : 'text'"
                            id="api-key-input"
                            v-model="pexelsKey"
                            placeholder="在此输入您的密钥"
                        />
                        <button
                            id="toggle-api-key-visibility"
                            class="visibility-toggle"
                            type="button"
                            v-html="eyeIcon(pexelsHidden)"
                            :aria-label="visibilityLabel(pexelsHidden)"
                            :title="visibilityLabel(pexelsHidden)"
                            :aria-pressed="pexelsHidden ? 'false' : 'true'"
                            @click="pexelsHidden = !pexelsHidden"
                        ></button>
                    </div>
                    <p class="api-key-description">
                        可选增强功能：填写后壁纸搜索与分类筛选一律走
                        Pexels（优先级高于下方「壁纸图源」选择）。不填也完全可用——默认使用 Picsum
                        免费图库，无需任何密钥，但 Picsum 不支持分类筛选。
                        <a
                            href="https://www.pexels.com/zh-cn/api/documentation/#authorization"
                            target="_blank"
                            >获取免费密钥</a
                        >
                    </p>
                </div>

                <div class="setting-item" v-show="activeTab === 'advanced'">
                    <label for="weather-api-key-input">高德地图 Web服务 Key（可选增强）</label>
                    <div class="input-with-icon">
                        <input
                            :type="weatherHidden ? 'password' : 'text'"
                            id="weather-api-key-input"
                            v-model="weatherApiKey"
                            placeholder="在此输入您的高德Web服务Key"
                        />
                        <button
                            id="toggle-weather-key-visibility"
                            class="visibility-toggle"
                            type="button"
                            v-html="eyeIcon(weatherHidden)"
                            :aria-label="visibilityLabel(weatherHidden)"
                            :title="visibilityLabel(weatherHidden)"
                            :aria-pressed="weatherHidden ? 'false' : 'true'"
                            @click="weatherHidden = !weatherHidden"
                        ></button>
                    </div>
                    <p class="api-key-description">
                        可选：不填时天气功能自动使用 Open-Meteo
                        免费数据，无需任何密钥。如需高德数据，前往
                        <a href="https://lbs.amap.com/" target="_blank">高德开放平台</a> 申请
                        Web服务 Key。
                    </p>
                </div>

                <div class="setting-item" v-show="activeTab === 'advanced'">
                    <label>数据备份与恢复</label>
                    <div class="backup-actions">
                        <button
                            type="button"
                            id="export-data-btn"
                            class="settings-btn secondary"
                            :disabled="exportDisabled"
                            @click="exportData"
                        >
                            导出备份
                        </button>
                        <button
                            type="button"
                            id="copy-backup-btn"
                            class="settings-btn secondary"
                            :disabled="exportDisabled"
                            @click="copyBackup"
                        >
                            复制备份
                        </button>
                        <button
                            type="button"
                            id="import-data-btn"
                            class="settings-btn secondary"
                            :disabled="importDisabled"
                            @click="openImportPicker"
                        >
                            导入备份
                        </button>
                        <button
                            type="button"
                            id="paste-import-btn"
                            class="settings-btn secondary"
                            :disabled="importDisabled"
                            :aria-expanded="pasteOpen"
                            @click="pasteOpen = !pasteOpen"
                        >
                            粘贴文本导入
                        </button>
                        <input
                            type="file"
                            id="import-data-input"
                            ref="importInput"
                            accept="application/json,.json"
                            class="u-hidden"
                            @change="importData"
                        />
                    </div>
                    <div v-show="pasteOpen" class="backup-paste">
                        <textarea
                            id="backup-paste-input"
                            v-model="pasteText"
                            class="backup-paste-input"
                            spellcheck="false"
                            placeholder="把备份 JSON 全文粘贴到这里，再点右侧导入"
                            aria-label="粘贴备份 JSON"
                        ></textarea>
                        <button
                            type="button"
                            id="paste-import-confirm"
                            class="settings-btn secondary"
                            :disabled="importDisabled || !pasteText.trim()"
                            @click="importFromPasteBox"
                        >
                            导入
                        </button>
                    </div>
                    <p
                        class="api-key-description"
                        id="backup-status"
                        :class="{
                            'is-error': backupKind === 'error',
                            'is-success': backupKind === 'success',
                        }"
                    >
                        {{ backupStatus }}
                    </p>
                </div>

                <div class="setting-item" v-show="activeTab === 'advanced'">
                    <label>键盘快捷键</label>
                    <ul class="shortcut-list">
                        <li v-for="sc in SHORTCUTS" :key="sc.keys.join('+')" class="shortcut-row">
                            <span class="shortcut-keys">
                                <kbd v-for="k in sc.keys" :key="k">{{ k }}</kbd>
                            </span>
                            <span class="shortcut-label">{{ sc.label }}</span>
                        </li>
                    </ul>
                    <p class="api-key-description">
                        焦点在输入框内时不响应；确认框、文件夹浮层打开或图标拖拽中也不响应。
                    </p>
                </div>
            </div>
        </div>
    </GlassPanel>
</template>
