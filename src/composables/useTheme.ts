/**
 * 主题状态机（Vue3 版）——逐字移植 public/legacy-js/theme-manager.js（356 行）。
 *
 * 四种模式 auto / light / dark / sun。首屏防白闪由 public/theme-preboot.js 同步读
 * localStorage 镜像完成（chrome.storage 异步抢不到首帧），本模块在 Vue 挂载后用
 * storage 真值校正，并启动 60s 复查 + matchMedia 跟随系统。
 *
 * 与 legacy 的差异：ThemeManager 全局构造器改为模块级 ESM 单例 + 三个响应式
 * 镜像 ref；预览态 preview()（只改内存不落盘）与持久化 save() 分离，语义与 app.js 的
 * previewThemeMode / previewThemeSunWindow / snapshotTheme / restoreThemeSnapshot 一致。
 */
import { log } from '@/src/lib/log';
import { ref, type Ref } from 'vue';

export type ThemeMode = 'auto' | 'light' | 'dark' | 'sun';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeSettings {
  mode: ThemeMode;
  lightStart: string;
  darkStart: string;
}

export interface SunTimes {
  sunrise: string;
  sunset: string;
  approximate: boolean;
  ts: number;
}

export interface ThemeState {
  mode: ThemeMode;
  lightStart: string;
  darkStart: string;
  resolved: ResolvedTheme;
  sunTimes: SunTimes | null;
  sunApproximate: boolean;
}

export const THEME_STORAGE_KEY = 'themeSettings';
export const THEME_LS_MIRROR = 'ntce-theme';
export const THEME_DEFAULTS: ThemeSettings = {
  mode: 'auto',
  lightStart: '07:00',
  darkStart: '18:00',
};
const CHECK_INTERVAL = 60 * 1000;

/** 本地时间 "HH:MM" -> 当日分钟数；非法返回 null（legacy toMinutes 逐字移植） */
export function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function systemPrefers(): ResolvedTheme {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** 只保留白名单字段（legacy ThemeManager.sanitize 逐字移植） */
export function sanitizeTheme(input: unknown): Partial<ThemeSettings> {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Partial<ThemeSettings> = {};
  if (['auto', 'light', 'dark', 'sun'].includes(String(src.mode))) {
    out.mode = src.mode as ThemeMode;
  }
  if (toMinutes(String(src.lightStart ?? '')) !== null) {
    out.lightStart = String(src.lightStart);
  }
  if (toMinutes(String(src.darkStart ?? '')) !== null) {
    out.darkStart = String(src.darkStart);
  }
  return out;
}

/* ---------- 模块级单例状态 ---------- */
let settings: ThemeSettings = { ...THEME_DEFAULTS };
let sunTimes: SunTimes | null = null;
let currentResolved: ResolvedTheme | null = null;
let timerId: ReturnType<typeof setInterval> | null = null;
let mediaQuery: MediaQueryList | null = null;
let mqHandler: (() => void) | null = null;

/** 响应式镜像：SettingsPanel 直接渲染，避免再抄一份 DOM 查询 */
const settingsRef = ref<ThemeSettings>({ ...THEME_DEFAULTS }) as Ref<ThemeSettings>;
const resolvedRef = ref<ResolvedTheme>('dark') as Ref<ResolvedTheme>;
const sunTimesRef = ref<SunTimes | null>(null) as Ref<SunTimes | null>;

function publish(): void {
  settingsRef.value = { ...settings };
  sunTimesRef.value = sunTimes ? { ...sunTimes } : null;
}

function writeMirror(): void {
  try {
    localStorage.setItem(THEME_LS_MIRROR, JSON.stringify(settings));
  } catch {
    // localStorage 不可用（隐私模式等）时忽略：异步路径仍会正确应用
  }
}

function resolve(): ResolvedTheme {
  const mode = settings.mode;
  if (mode === 'light' || mode === 'dark') return mode;
  if (mode === 'auto') return systemPrefers();
  const startMin = toMinutes(sunTimes?.sunrise ?? '') ?? toMinutes(settings.lightStart);
  const endMin = toMinutes(sunTimes?.sunset ?? '') ?? toMinutes(settings.darkStart);
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  if (startMin === null || endMin === null) return 'dark';
  const isLight =
    startMin <= endMin ? cur >= startMin && cur < endMin : cur >= startMin || cur < endMin;
  return isLight ? 'light' : 'dark';
}

/** 套用主题：只改 <html data-theme> / data-theme-mode / colorScheme，配色全走 CSS token */
export function applyTheme(): ResolvedTheme {
  const resolved = resolve();
  currentResolved = resolved;
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-theme-mode', settings.mode);
  root.style.colorScheme = resolved;
  resolvedRef.value = resolved;
  return resolved;
}

/** matchMedia 的旧式 addListener/removeListener 兜底（Safari 旧版） */
interface LegacyMql {
  addEventListener?: (type: string, cb: () => void) => void;
  removeEventListener?: (type: string, cb: () => void) => void;
  addListener?: (cb: () => void) => void;
  removeListener?: (cb: () => void) => void;
}

function stopWatching(): void {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  if (mediaQuery && mqHandler) {
    const mql = mediaQuery as unknown as LegacyMql;
    if (mql.removeEventListener) mql.removeEventListener('change', mqHandler);
    else if (mql.removeListener) mql.removeListener(mqHandler);
  }
}

function startWatching(): void {
  stopWatching();
  // 跨天 / 到点切换：每分钟复查（日出日落只精确到分钟，标签页也可能后台挂起）
  timerId = setInterval(() => applyTheme(), CHECK_INTERVAL);
  try {
    mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    mqHandler = () => {
      if (settings.mode === 'auto') applyTheme();
    };
    const mql = mediaQuery as unknown as LegacyMql;
    if (mql.addEventListener) mql.addEventListener('change', mqHandler);
    else if (mql.addListener) mql.addListener(mqHandler);
  } catch {
    // matchMedia 不可用：auto 模式退化为首次解析结果
  }
}

/** 复用天气域缓存的坐标，不额外发起定位（legacy getCachedCoords 逐字移植） */
async function getCachedCoords(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const r = await chrome.storage.local.get(['om_last_location']);
    const loc = (r && r.om_last_location) as
      | { latitude?: number; longitude?: number }
      | undefined;
    if (loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
      return { latitude: loc.latitude, longitude: loc.longitude };
    }
  } catch {
    // 忽略：无坐标就用自定义时段
  }
  return null;
}

export async function refreshSunTimes(): Promise<SunTimes | null> {
  if (settings.mode !== 'sun') return null;
  try {
    const coord = await getCachedCoords();
    if (!coord) {
      sunTimes = null;
      publish();
      return null;
    }
    const today = new Date();
    const ymd =
      today.getFullYear() +
      '-' +
      String(today.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(today.getDate()).padStart(2, '0');
    const key =
      'ntce-sun-' + ymd + '-' + coord.latitude.toFixed(2) + '-' + coord.longitude.toFixed(2);
    const cached = await chrome.storage.local.get([key]);
    if (cached[key]) {
      sunTimes = cached[key] as SunTimes;
      applyTheme();
      publish();
      return sunTimes;
    }
    const url =
      'https://api.open-meteo.com/v1/forecast?latitude=' +
      coord.latitude +
      '&longitude=' +
      coord.longitude +
      '&daily=sunrise,sunset&timezone=auto&forecast_days=1';
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const sr = data && data.daily && data.daily.sunrise && data.daily.sunrise[0];
    const ss = data && data.daily && data.daily.sunset && data.daily.sunset[0];
    if (!sr || !ss) throw new Error('无日出日落数据');
    const pick = (s: string): string | null => {
      const m = /T(\d{2}:\d{2})/.exec(String(s));
      return m ? m[1] : null;
    };
    const result: SunTimes = {
      sunrise: pick(sr) ?? '',
      sunset: pick(ss) ?? '',
      approximate: false,
      ts: Date.now(),
    };
    if (!result.sunrise || !result.sunset) throw new Error('时间解析失败');
    await chrome.storage.local.set({ [key]: result });
    sunTimes = result;
    applyTheme();
    publish();
    return result;
  } catch (e) {
    // 取不到就用自定义兜底时间，绝不因此卡住主题
    log.warn('获取日出日落失败，改用自定义时段:', (e as Error).message);
    sunTimes = null;
    publish();
    return null;
  }
}

export interface ThemeApi {
  settings: Ref<ThemeSettings>;
  resolved: Ref<ResolvedTheme>;
  sunTimes: Ref<SunTimes | null>;
  init(): Promise<ThemeSettings>;
  save(next: ThemeSettings): Promise<ThemeSettings>;
  setMode(mode: ThemeMode): Promise<ThemeSettings>;
  preview(patch: Partial<ThemeSettings>): void;
  restore(snapshot: ThemeSettings): void;
  getState(): ThemeState;
  refreshSunTimes(): Promise<SunTimes | null>;
}

function createThemeApi(): ThemeApi {
  let initPromise: Promise<ThemeSettings> | null = null;
  async function load(): Promise<ThemeSettings> {
    try {
      const r = await chrome.storage.local.get([THEME_STORAGE_KEY]);
      const saved = r[THEME_STORAGE_KEY];
      if (saved && typeof saved === 'object') {
        settings = { ...THEME_DEFAULTS, ...sanitizeTheme(saved) };
      }
    } catch (e) {
      log.warn('读取主题设置失败，使用默认值:', e);
    }
    writeMirror();
    publish();
    return { ...settings };
  }

  async function save(next: ThemeSettings): Promise<ThemeSettings> {
    settings = { ...THEME_DEFAULTS, ...sanitizeTheme(next) };
    writeMirror();
    try {
      await chrome.storage.local.set({ [THEME_STORAGE_KEY]: settings });
    } catch (e) {
      log.warn('保存主题设置失败:', e);
    }
    publish();
    if (settings.mode === 'sun') await refreshSunTimes();
    applyTheme();
    return { ...settings };
  }

  return {
    settings: settingsRef,
    resolved: resolvedRef,
    sunTimes: sunTimesRef,
    init(): Promise<ThemeSettings> {
      if (!initPromise) {
        initPromise = (async () => {
          await load();
          applyTheme();
          startWatching();
          await refreshSunTimes();
          return { ...settings };
        })();
      }
      return initPromise;
    },
    save,
    setMode: (mode: ThemeMode): Promise<ThemeSettings> => save({ ...settings, mode }),
    /** 只改内存态 + 重新解析：不写 storage、不写 localStorage 镜像（legacy 预览语义） */
    preview(patch: Partial<ThemeSettings>): void {
      settings = { ...settings, ...patch };
      publish();
      applyTheme();
    },
    /** 关闭/取消时回滚到打开面板时的快照 */
    restore(snapshot: ThemeSettings): void {
      settings = { ...THEME_DEFAULTS, ...sanitizeTheme(snapshot) };
      publish();
      applyTheme();
      if (settings.mode === 'sun') void refreshSunTimes();
    },
    getState(): ThemeState {
      return {
        mode: settings.mode,
        lightStart: settings.lightStart,
        darkStart: settings.darkStart,
        resolved: currentResolved ?? resolve(),
        sunTimes,
        sunApproximate: !sunTimes,
      };
    },
    refreshSunTimes,
  };
}

let singleton: ThemeApi | null = null;
/** 主题模块单例：全应用共用一份状态机（setInterval / matchMedia 只挂一次） */
export function useTheme(): ThemeApi {
  if (!singleton) singleton = createThemeApi();
  return singleton;
}
