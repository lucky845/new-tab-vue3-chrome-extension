/// <reference types="chrome" />
/**
 * 天气模块（Vue3 版）——移植自 public/legacy-js/modules/weather-manager.js（1583 行，逐段读完）。
 *
 * 结构映射：
 * - WeatherManager 实例字段 → 模块级单例（useWeather() 返回同一份 api，面板与卡片共享数据 ref）
 * - loadSettings/saveSettings/settings.weatherApiKey → 普通 ref + onChanged 实时拉取（共享键不走 useStored deep watch）
 * - init + setInterval(UPDATE_INTERVAL) → startAutoUpdate()（引用计数，卡片卸载即清理定时器）
 * - displayWeather/showError/markStale/showLoading → weatherData/isStale/errorInfo/isLoading 响应式状态
 * - DOM 产出（#temperature/#weather-desc/#location/#weather-svg）→ WeatherCard.vue 绑定 + createIconNode 注入
 *
 * 数据链路与 legacy 完全一致：
 * - 未配高德 Key → Open-Meteo 免密钥路径（geocoding / forecast / current_weather 兜底）
 * - 配了 Key → 城市名 geocode→adcode→weatherInfo；无城市 → 浏览器定位 regeo→adcode→weatherInfo（失败回退 IP 定位）
 * - 缓存体系：amap_adcode_<city> / amap_weather_<adcode> / om_geo_<city> / om_weather_<lat>_<lng> /
 *   om_last_location / weather_last_ok，TTL 全部取 WeatherConfig
 * - 失败冷却：weather_fail_count 连续失败指数退避（3min×2^n 封顶 30min），weather_cooldown_until 截止时间戳
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { WEATHER_CONFIG } from '@/src/config/weather';
import { fetchJSON } from '@/src/lib/http';


export type TemperatureUnit = 'celsius' | 'fahrenheit';

/** 内部天气数据结构（legacy formatAmapWeatherData / formatOpenMeteoData 的对齐字段） */
export interface WeatherData {
  temperature: number;
  feelsLike?: number;
  humidity?: number;
  pressure?: number;
  description: string;
  icon?: string;
  city: string;
  country?: string;
  windSpeed?: number;
  windDeg?: number;
  sunrise?: number;
  sunset?: number;
  timestamp: number;
  __fromCache?: boolean;
}

/** 带分类标记的错误（legacy assertAmapOk 把 info/fatal 抬到错误对象上） */
interface WeatherErrorLike extends Error {
  fatal?: boolean;
  amapInfo?: string;
}

/** legacy showError 归并出的卡面文案（短句 + 位置行指引 + 完整原因） */
export interface WeatherErrorInfo {
  message: string;
  short: string;
  locationHint: string;
}

/** settings 键里与天气相关的字段（其余字段原样保留，settings 是全模块共享对象） */
interface LegacySettings {
  weatherCity?: string;
  weatherApiKey?: string;
  temperatureUnit?: TemperatureUnit;
  [key: string]: unknown;
}

/* ==================== REST 响应类型（最小字段集） ==================== */

interface AmapBase {
  status?: string;
  info?: string;
  infocode?: string;
}
interface AmapGeoResponse extends AmapBase {
  geocodes?: Array<{ adcode?: string; citycode?: string }>;
}
interface AmapRegeoResponse extends AmapBase {
  regeocode?: {
    addressComponent?: { adcode?: string; citycode?: string; city?: string; province?: string };
  };
}
interface AmapWeatherResponse extends AmapBase {
  lives?: Array<{
    temperature?: string;
    humidity?: string;
    weather?: string;
    windpower?: string;
    city?: string;
    province?: string;
  }>;
}
interface AmapIPResponse extends AmapBase {
  adcode?: string;
  citycode?: string;
  city?: string;
  province?: string;
}
interface OpenMeteoGeoResponse {
  results?: Array<{ name: string; admin1?: string; country?: string; latitude: number; longitude: number }>;
}
interface OpenMeteoCurrentBlock {
  temperature_2m: number;
  relative_humidity_2m?: number;
  apparent_temperature: number;
  is_day: number;
  weather_code: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  pressure_msl?: number;
}
interface OpenMeteoForecastResponse {
  current?: OpenMeteoCurrentBlock;
  current_weather?: {
    temperature: number;
    windspeed: number;
    winddirection: number;
    weathercode: number;
    is_day: number;
  };
}

/* ==================== 缓存条目结构（照 legacy 存储原样） ==================== */

interface WeatherCacheEntry {
  data: WeatherData;
  ts: number;
}
interface AdcodeCacheEntry {
  adcode: string;
  ts: number;
}
interface PlaceCacheEntry {
  name: string;
  admin1: string;
  country: string;
  latitude: number;
  longitude: number;
  ts: number;
}
interface LastLocationEntry {
  latitude: number;
  longitude: number;
  ts: number;
}

interface CacheEnvelope<T> {
  data: T;
  ts: number | null;
  fresh: boolean;
}

const SETTINGS_KEY = 'settings';
// 初始占位对象：hydrate 后 refreshSettingsFromStorage() 会替换它，用引用差异判定「已就绪」
const emptySettings: LegacySettings = {};

/**
 * settings 载入变换（legacy loadSettings/init 的清洗逻辑收口到存储层）：
 * - 「当前位置」是定位路径的占位文案不是城市名，误存会让 geocoding 永远失败 → 清洗并回写（legacy loadSettings 同款）
 * - 历史占位符 your_amap_api_key_here 视为未配置 → 走 Open-Meteo 免密钥路径（legacy init 清内存值，这里归一到存储，行为等价）
 */
function loadSettingsRaw(raw: unknown): LegacySettings {
  const base = raw && typeof raw === 'object' ? (raw as LegacySettings) : {};
  const next: LegacySettings = { ...base };
  if (next.weatherCity === '当前位置') next.weatherCity = '';
  if (next.weatherApiKey === 'your_amap_api_key_here') next.weatherApiKey = '';
  return next;
}

/* ==================== 图标（供 WeatherCard 使用，照 legacy 原样移植） ==================== */

/**
 * 将高德天气现象描述映射为图标类别（legacy getIconTypeForAmap 逐字移植）
 */
export function getIconTypeForAmap(desc: string | undefined): string {
  // 高德天气现象表为中文，这里做精细匹配
  const text = (desc || '').trim();
  if (!text) return 'unknown';

  // 晴系
  if (text.includes('晴间多云') || text.includes('少云')) return 'cloudy-sunny';
  if (text.includes('晴')) return 'sunny';

  // 多云/阴
  if (text.includes('多云') || text.includes('阴')) return 'cloudy';

  // 雨系（由强到弱优先判定）
  if (text.includes('特大暴雨') || text.includes('极端降雨')) return 'heavy-rain';
  if (text.includes('大暴雨') || text.includes('暴雨-大暴雨')) return 'heavy-rain';
  if (text.includes('暴雨') || text.includes('大雨-暴雨')) return 'heavy-rain';
  if (text.includes('大雨')) return 'heavy-rain';
  if (text.includes('中雨-大雨')) return 'rain';
  if (text.includes('小雨-中雨')) return 'rain';
  if (text.includes('中雨')) return 'rain';
  if (text.includes('毛毛雨') || text.includes('细雨') || text.includes('小雨')) return 'rain';
  if (text.includes('冻雨') || text.includes('雨夹雪') || text.includes('阵雨夹雪')) return 'snow';
  if (text.includes('阵雨')) return 'rain';

  // 雷雨/冰雹
  if (text.includes('雷阵雨并伴有冰雹')) return 'thunderstorm';
  if (text.includes('强雷阵雨') || text.includes('雷阵雨')) return 'thunderstorm';
  if (text.includes('雷')) return 'thunderstorm';

  // 雪系
  if (text.includes('大雪-暴雪') || text.includes('暴雪')) return 'snow';
  if (text.includes('中雪-大雪')) return 'snow';
  if (text.includes('小雪-中雪')) return 'snow';
  if (
    text.includes('大雪') ||
    text.includes('中雪') ||
    text.includes('小雪') ||
    text.includes('阵雪') ||
    text.includes('雪')
  )
    return 'snow';

  // 低能见度/沙尘
  if (
    text.includes('强浓雾') ||
    text.includes('特强浓雾') ||
    text.includes('浓雾') ||
    text.includes('大雾') ||
    text.includes('轻雾') ||
    text.includes('雾')
  )
    return 'fog';
  if (
    text.includes('严重霾') ||
    text.includes('重度霾') ||
    text.includes('中度霾') ||
    text.includes('霾')
  )
    return 'fog';
  if (
    text.includes('沙尘暴') ||
    text.includes('强沙尘暴') ||
    text.includes('扬沙') ||
    text.includes('浮尘') ||
    text.includes('沙尘')
  )
    return 'fog';

  // 风类（无独立图标，归为cloudy）
  if (text.includes('风') || text.includes('飓风') || text.includes('热带风暴')) return 'cloudy';

  return 'unknown';
}

/**
 * 天气图标 SVG 内部标记（legacy getWeatherIconSvg 逐字移植，不含外层 <svg> 壳）
 */
export function getWeatherIconSvg(iconType: string): string {
  const icons: Record<string, string> = {
    'cloudy-sunny': `
                <path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 0 0 4 14.5" fill="none" stroke="currentColor" stroke-width="2"/>
                <circle cx="7" cy="9" r="3" fill="none" stroke="currentColor" stroke-width="2"/>
            `,
    sunny: `
                <circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/>
                <line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" stroke-width="2"/>
                <line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" stroke-width="2"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" stroke-width="2"/>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2"/>
                <line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" stroke-width="2"/>
                <line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" stroke-width="2"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" stroke-width="2"/>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" stroke-width="2"/>
            `,
    'clear-night': `
                <path d="M12 3a6 6 0 0 0 6 6 6 6 0 0 0 6-6" fill="none" stroke="currentColor" stroke-width="2"/>
                <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M12 1v3m0 16v3" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M4.22 4.22l2.12 2.12m11.32 11.32l2.12 2.12" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M1 12h3m16 0h3" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M4.22 19.78l2.12-2.12m11.32-11.32l2.12-2.12" fill="none" stroke="currentColor" stroke-width="2"/>
            `,
    'partly-cloudy-day': `
                <circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 0 0 4 14.5" fill="none" stroke="currentColor" stroke-width="2"/>
            `,
    'partly-cloudy-night': `
                <path d="M12 3a6 6 0 0 0 6 6 6 6 0 0 0 6-6" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 0 0 4 14.5" fill="none" stroke="currentColor" stroke-width="2"/>
            `,
    cloudy: `
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="none" stroke="currentColor" stroke-width="2"/>
            `,
    rain: `
                <path d="M16 4a4 4 0 0 0-4 4 4 4 0 0 0-4 4" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M8 20v-6" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M12 20v-6" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M16 20v-6" fill="none" stroke="currentColor" stroke-width="2"/>
            `,
    'heavy-rain': `
                <path d="M16 4a4 4 0 0 0-4 4 4 4 0 0 0-4 4" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M7 22v-7" stroke="currentColor" stroke-width="2"/>
                <path d="M11 22v-7" stroke="currentColor" stroke-width="2"/>
                <path d="M15 22v-7" stroke="currentColor" stroke-width="2"/>
                <path d="M19 22v-7" stroke="currentColor" stroke-width="2"/>
            `,
    thunderstorm: `
                <path d="M16 4a4 4 0 0 0-4 4 4 4 0 0 0-4 4" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M8 20v-6" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M12 20v-6" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M16 20v-6" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M10 14l-2 2 2 2" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M14 14l-2 2 2 2" fill="none" stroke="currentColor" stroke-width="2"/>
            `,
    snow: `
                <path d="M16 4a4 4 0 0 0-4 4 4 4 0 0 0-4 4 4 4 0 0 0-4 4" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M8 20v-6" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M12 20v-6" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M16 20v-6" fill="none" stroke="currentColor" stroke-width="2"/>
                <circle cx="8" cy="18" r="1" fill="currentColor"/>
                <circle cx="12" cy="18" r="1" fill="currentColor"/>
                <circle cx="16" cy="18" r="1" fill="currentColor"/>
            `,
    fog: `
                <path d="M16 4a4 4 0 0 0-4 4 4 4 0 0 0-4 4 4 4 0 0 0-4 4" fill="none" stroke="currentColor" stroke-width="2"/>
                <line x1="4" y1="18" x2="20" y2="18" stroke="currentColor" stroke-width="2"/>
                <line x1="4" y1="22" x2="20" y2="22" stroke="currentColor" stroke-width="2"/>
            `,
    unknown: `
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
                <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2"/>
                <line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" stroke-width="2"/>
            `,
  };

  return icons[iconType] || icons['unknown'] || '';
}

/** 图标代号 → ICON_MAPPING 查表（legacy updateWeatherIcon 第一行） */
export function resolveWeatherIconType(iconCode: string): string {
  return WEATHER_CONFIG.ICON_MAPPING[iconCode] || iconCode || 'unknown';
}

/* ==================== 高德响应校验（legacy assertAmapOk / isAmapFatal） ==================== */

/**
 * 高德的失败分两类：配额/Key/服务不可用（fatal）——重试与刷新都没有意义；其余短冷却即可。
 */
function isAmapFatal(info: unknown): boolean {
  return /CUQPS|QUERY_OVER_LIMIT|OVER_LIMIT|INVALID_USER_KEY|USERKEY_PLAT_NOMATCH|INVALID_USER_SCODE|SERVICE_NOT_AVAILABLE/i.test(
    String(info || '')
  );
}

// 高德返回 HTTP 200 但 status !== '1' 同样算失败；把 info 抬到错误对象上，便于上层分类
function assertAmapOk(data: AmapBase | null | undefined, label: string): void {
  if (!data || data.status === '1') return;
  const info = data.info || data.infocode || '未知错误';
  const error = new Error(`${label}接口返回失败：${info}`) as WeatherErrorLike;
  error.amapInfo = info;
  error.fatal = isAmapFatal(info);
  throw error;
}

let singleton: WeatherApi | null = null;

function createWeatherApi(): WeatherApi {
  /* ---------- 设置（legacy loadSettings/saveSettings/settings 字段） ----------
     settings 是全模块共享键：SettingsPanel.vue / useSettings.ts 会直接 read-modify-write
     写盘。这里不走 useStored —— 它的 deep watch 会把「打开页面时的陈旧快照」整对象
     回写，把刚保存的 tagline / wallpaperSource 冲掉（wave3 保存链路回放实测复现）。
     改为：普通 ref + onChanged 实时拉取 + 唯一写入口 writeSettingsFields（读-改-写）。 */
  const settings = ref<LegacySettings>(emptySettings) as Ref<LegacySettings>;

  /** 从 storage 拉取最新 settings 并清洗（其它上下文写入时经 onChanged 触发） */
  async function refreshSettingsFromStorage(): Promise<void> {
    const result = await chrome.storage.local.get([SETTINGS_KEY]).catch(() => ({}));
    const raw = (result as Record<string, unknown>)[SETTINGS_KEY];
    if (raw !== undefined) settings.value = loadSettingsRaw(raw);
  }
  void refreshSettingsFromStorage();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, SETTINGS_KEY)) {
      void refreshSettingsFromStorage();
    }
  });

  /** settings 唯一写入口：read-modify-write 合字段，不覆盖其它域刚写的值；
   *  写完同步更新内存，保证紧随其后的 fetch 决策路径读到新值。 */
  async function writeSettingsFields(fields: Partial<LegacySettings>): Promise<void> {
    const result = await chrome.storage.local.get([SETTINGS_KEY]).catch(() => ({}));
    const stored = (result as Record<string, unknown>)[SETTINGS_KEY];
    const base: Record<string, unknown> =
      stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
    const next = { ...base, ...fields };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    settings.value = loadSettingsRaw(next);
  }

  // init 的决策路径（缓存键/城市/Key）必须等 settings 落地再走。
  // hydrate 后 state 引用必然离开初始空对象（load 恒返回新对象）；
  // 存储里没有 settings 键时 apply 会早退，此时空设置就是正确初值，直接放行。
  async function waitSettingsHydrated(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (settings.value !== emptySettings) return;
      const stored = (await chrome.storage.local.get([SETTINGS_KEY]).catch(() => ({}))) as Record<string, unknown>;
      if (!stored || stored[SETTINGS_KEY] === undefined) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  // 只读：写入统一走 writeSettingsFields（杜绝任何整对象回写）
  const currentCity: ComputedRef<string> = computed<string>(
    () => settings.value.weatherCity ?? '',
  );
  // 优先使用设置里的 API Key，其次使用配置文件中的默认值（legacy init 同序）
  const apiKey = computed<string>(() => settings.value.weatherApiKey || WEATHER_CONFIG.API_KEY);
  const temperatureUnit = computed<TemperatureUnit>(() =>
    settings.value.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius'
  );

  /* ---------- 响应式状态（legacy this.weatherData / DOM class 操作的收口） ---------- */
  const weatherData = ref<WeatherData | null>(null);
  const isLoading = ref(false); // .weather-widget.loading（legacy showLoading/hideLoading）
  const isStale = ref(false); // .weather-widget.is-stale（legacy markStale/clearStale）
  const staleTitle = ref(''); // legacy markStale 写入 widget.title 的文案
  const errorInfo = ref<WeatherErrorInfo | null>(null); // legacy showError 的卡面文案

  let lastRequestAt = 0; // legacy this._lastRequestAt（最短请求间隔节流）
  let lastResolvedCacheKey: string | null = null; // legacy this.lastResolvedCacheKey（本次成功走的缓存键）

  /* ---------- 缓存工具（legacy 缓存段逐字移植） ---------- */

  function getCacheTtl(): number {
    return WEATHER_CONFIG.WEATHER_CACHE_TTL;
  }

  // 过期缓存的兜底上限：超过这个年龄就不再拿来显示（宁可显示错误提示）
  function getMaxCacheAge(): number {
    return WEATHER_CONFIG.WEATHER_CACHE_MAX_AGE;
  }

  function isCacheUsable(ts: number | null | undefined): boolean {
    return !!ts && Date.now() - ts <= getMaxCacheAge();
  }

  /** 失败/离线兜底窗口：正常 24h 上限之外，最多再顶 7 天，避免卡片空成「--°C」。 */
  function getFallbackCacheAge(): number {
    return WEATHER_CONFIG.WEATHER_CACHE_FALLBACK_MAX_AGE;
  }

  function isFallbackCacheUsable(ts: number | null | undefined): boolean {
    if (!ts) return false;
    const age = Date.now() - ts;
    return age >= 0 && age <= getFallbackCacheAge();
  }

  // 数据年龄（分钟）；数据里带 timestamp，缺失则视为未知
  function getDataAgeMinutes(data: WeatherData | null): number | null {
    if (!data) return null;
    const ts = Number(data.timestamp);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    const age = Date.now() - ts;
    if (age < 0) return null;
    return age / 60000;
  }

  /** 通用缓存条目读取：命中即返回，不回源 */
  async function readCacheEntry<T>(key: string): Promise<CacheEnvelope<T> | null> {
    if (!key) return null;
    try {
      const stored = (await chrome.storage.local.get([key])) as Record<string, unknown>;
      const entry = stored && (stored[key] as { data: T; ts?: number } | undefined);
      if (!entry || entry.data === undefined || entry.data === null) return null;
      return {
        data: entry.data,
        ts: entry.ts ?? null,
        fresh: Date.now() - (entry.ts ?? 0) < getCacheTtl(),
      };
    } catch (e) {
      console.warn('[weather] 读取天气缓存失败:', (e as Error)?.message || e);
      return null;
    }
  }

  function readWeatherCache(key: string): Promise<CacheEnvelope<WeatherData> | null> {
    return readCacheEntry<WeatherData>(key);
  }

  /** 写天气缓存（同时留一份上次成功，供失败回退） */
  async function writeWeatherCache(key: string | null, data: WeatherData): Promise<void> {
    const entry: WeatherCacheEntry = { data, ts: Date.now() };
    const payload: Record<string, unknown> = { weather_last_ok: entry };
    if (key) payload[key] = entry;
    try {
      await chrome.storage.local.set(payload);
    } catch (e) {
      console.warn('[weather] 写入天气缓存失败:', (e as Error)?.message || e);
    }
  }

  // 上一次成功的数据：刷新失败时继续显示，而不是把卡片打成错误态
  async function readLastOk(): Promise<WeatherCacheEntry | null> {
    const result = (await chrome.storage.local.get(['weather_last_ok'])) as Record<string, unknown>;
    return ((result && result.weather_last_ok) as WeatherCacheEntry | undefined) || null;
  }

  /**
   * 缓存先行：内存里的 weatherData / 持久化的 weather_last_ok 中取一份立即可显示的数据。
   * 过期数据也返回（由调用方决定是否回源），这样卡片一开就有内容，网络慢也不会先闪「--°C」。
   */
  async function readCachedData(
    options: { allowExpired?: boolean } = {},
  ): Promise<CacheEnvelope<WeatherData> | null> {
    if (weatherData.value) {
      const ts = weatherData.value.timestamp || null;
      return {
        data: weatherData.value,
        ts,
        fresh: ts ? Date.now() - ts < getCacheTtl() : false,
      };
    }
    const lastOk = await readLastOk();
    if (!lastOk || !lastOk.data) return null;
    // 正常路径仍守 24h 上限；失败/冷却/启动兜底放宽到 7 天，
    // 避免「网络一断就 --°C」把上次成功的数据白白丢掉。
    const usable = options.allowExpired
      ? isFallbackCacheUsable(lastOk.ts)
      : isCacheUsable(lastOk.ts);
    if (!usable) return null;
    return {
      data: lastOk.data,
      ts: lastOk.ts,
      fresh: Date.now() - lastOk.ts < getCacheTtl(),
    };
  }

  /**
   * 当前城市对应的 adcode 缓存（24h）。
   * 「当前位置」是定位路径的占位文案，不是城市名，不能拿来当 key 查。
   */
  async function readAmapAdcodeCache(): Promise<AdcodeCacheEntry | null> {
    const city = currentCity.value;
    if (!city || city === '当前位置') return null;
    const adcodeKey = `amap_adcode_${city}`;
    const stored = (await chrome.storage.local.get([adcodeKey])) as Record<string, unknown>;
    const entry = stored && (stored[adcodeKey] as AdcodeCacheEntry | undefined);
    if (!entry || !entry.adcode) return null;
    if (Date.now() - (entry.ts || 0) >= WEATHER_CONFIG.ADCODE_CACHE_TTL) return null;
    return entry;
  }

  /** 若缓存仍在有效期内，则直接渲染缓存并跳过请求 */
  async function displayCachedWeatherIfFresh(): Promise<boolean> {
    try {
      const ttl = getCacheTtl();
      const adcoded = await readAmapAdcodeCache();
      // 1) 高德城市缓存（city -> adcode -> weather）
      if (adcoded) {
        const wKey = `amap_weather_${adcoded.adcode}`;
        const cachedW = await readWeatherCache(wKey);
        if (cachedW && cachedW.fresh) {
          displayWeather(cachedW.data);
          lastResolvedCacheKey = wKey;
          return true;
        }
      }

      // 2) Open-Meteo 按城市：上次 geocoding 的坐标 + 该坐标的天气缓存
      if (currentCity.value) {
        const place = await readCacheEntry<PlaceCacheEntry>(`om_geo_${currentCity.value}`);
        if (place && place.fresh && place.data.latitude !== undefined) {
          const key = `om_weather_${place.data.latitude.toFixed(2)}_${place.data.longitude.toFixed(2)}`;
          const cachedW = await readWeatherCache(key);
          if (cachedW && cachedW.fresh) {
            displayWeather(cachedW.data);
            lastResolvedCacheKey = key;
            return true;
          }
        }
      }

      // 3) 兜底：上次成功的整体快照（无论走的是哪条链路）
      const lastOk = await readLastOk();
      if (lastOk && lastOk.data && Date.now() - (lastOk.ts || 0) < ttl) {
        displayWeather(lastOk.data);
        return true; // key 未知：成功回写只更新 weather_last_ok
      }

      // 都过期了，返回 false 走正常流程（上层会先贴旧值再后台更新）
      return false;
    } catch (e) {
      console.warn('读取缓存天气失败，将走网络请求:', (e as Error)?.message || e);
      return false;
    }
  }

  /* ---------- 显示状态（legacy markStale/clearStale/showLoading/hideLoading/displayWeather/showError） ---------- */

  /**
   * 标记「当前显示的是缓存数据」，并在卡片 title 上留数据年龄线索。
   */
  function markStale(ageMin?: number): void {
    isStale.value = true;
    staleTitle.value = ageMin
      ? `当前显示 ${ageMin} 分钟前的缓存数据（下次自动更新在冷却结束后）`
      : '当前显示缓存数据';
  }

  function clearStale(): void {
    isStale.value = false;
    staleTitle.value = '';
  }

  /** 统一渲染入口：legacy displayWeather 的响应式等价（DOM 文本由 WeatherCard 绑定产出） */
  function displayWeather(data: WeatherData): void {
    weatherData.value = data;
    errorInfo.value = null;
    // 缓存态由数据年龄决定：过期数据无论来自 cache-first 还是失败回退，
    // 都统一挂上「· 缓存」标记，避免「看着是实时数据其实是旧值」
    const ageMin = getDataAgeMinutes(data);
    if (ageMin !== null && ageMin * 60000 > getCacheTtl()) {
      markStale(ageMin);
    } else {
      clearStale();
    }
    isLoading.value = false; // legacy hideLoading
  }

  /**
   * 失败/离线/冷却期统一兜底渲染：清错误态与 loading，强制挂「缓存」标记。
   * 不改动 description 文本（回归按「多云」精确断言），可见标记由 CSS ::after 产出。
   */
  function displayFallbackCache(data: WeatherData, ts: number | null): void {
    weatherData.value = data;
    errorInfo.value = null;
    const byTs = ts ? Math.max(1, Math.round((Date.now() - ts) / 60000)) : 0;
    const byData = getDataAgeMinutes(data);
    const ageMin = Math.max(1, Math.round(Math.max(byTs, byData ?? 0)));
    markStale(ageMin);
    isLoading.value = false;
  }

  /**
   * 错误文案归并（legacy showError 逐字移植）：
   * 卡面只放一句短语（整句错误在 360px 卡片里只能靠省略号截断），位置行给可执行的下一步。
   */
  function showError(message: string): void {
    const short = /权限被拒绝|NotAllowed|Permission/.test(message)
      ? '定位未授权'
      : /超时|timeout/.test(message)
        ? '定位超时'
        : /位置信息不可用|未找到可用/.test(message)
          ? '无法定位'
          : /城市/.test(message)
            ? '城市无效'
            : '天气获取失败';
    const locationHint = /城市/.test(message)
      ? '打开右上角 ⚙️ 设置可修改天气城市'
      : /权限被拒绝|NotAllowed/.test(message)
        ? '点 ⚙️ 设置天气城市即可显示'
        : /位置信息不可用|未找到可用/.test(message)
          ? '点 ⚙️ 设置天气城市即可显示'
          : /超时/.test(message)
            ? '定位超时，点 ⚙️ 可手动设城市'
            : '获取失败';
    errorInfo.value = { message, short, locationHint };
    isLoading.value = false;
  }

  /* ---------- 失败冷却（legacy inCooldown/setCooldown/clearFailCount 逐字移植） ---------- */

  async function inCooldown(): Promise<boolean> {
    const result = (await chrome.storage.local.get(['weather_cooldown_until'])) as Record<string, unknown>;
    return ((result && (result.weather_cooldown_until as number)) || 0) > Date.now();
  }

  /**
   * 记一次失败冷却，并按连续失败次数指数退避。
   * 连续失败第 1 次冷却传入的基础时长，之后每失败一次翻倍，封顶 30 分钟
   * —— 网络恢复后最多半小时就会被重新探测到，而网络一直不通时不再骚扰。
   */
  async function setCooldown(ms: number, reason: string): Promise<void> {
    const stored = (await chrome.storage.local.get(['weather_fail_count']).catch(() => ({}))) as Record<string, unknown>;
    const fails = ((stored && (stored.weather_fail_count as number)) || 0) + 1;
    // 首次用传入的基础时长，之后按 2^(n-1) 翻倍
    const backoff = ms * Math.pow(2, Math.min(fails - 1, 4));
    await chrome.storage.local.set({
      weather_fail_count: fails,
      weather_cooldown_until: Date.now() + backoff,
      weather_cooldown_reason: reason || '',
    });
    if (fails > 1) {
      console.info(`[weather] 连续失败 ${fails} 次，冷却 ${Math.round(backoff / 60000)} 分钟`);
    }
  }

  /** 请求成功时清零失败计数，让下次失败重新从基础冷却开始。 */
  async function clearFailCount(): Promise<void> {
    const stored = (await chrome.storage.local.get(['weather_fail_count']).catch(() => ({}))) as Record<string, unknown>;
    if (stored && stored.weather_fail_count) {
      await chrome.storage.local.remove(['weather_fail_count']).catch(() => {});
    }
  }

  /* ---------- 持久化检测城市 ---------- */

  /** 持久化保存自动识别到的城市（仅当用户未手动设置城市时） */
  async function persistDetectedCity(cityName: string): Promise<void> {
    if (!cityName) return;
    // 若用户已经设置了城市，则不覆盖
    if (currentCity.value) return;
    await writeSettingsFields({ weatherCity: cityName });
  }

  /* ---------- 高德数据链路 ---------- */

  /** 根据城市名获取adcode（带缓存） */
  async function getAdcodeByCity(cityName: string): Promise<string> {
    const cacheKey = `amap_adcode_${cityName}`;
    const cached = (await chrome.storage.local.get([cacheKey])) as Record<string, unknown>;
    const entry = cached && (cached[cacheKey] as AdcodeCacheEntry | undefined);
    if (entry && Date.now() - entry.ts < WEATHER_CONFIG.ADCODE_CACHE_TTL) {
      return entry.adcode;
    }
    const url = `${WEATHER_CONFIG.BASE_URL}/geocode/geo?key=${apiKey.value}&address=${encodeURIComponent(cityName)}`;
    const data = await fetchJSON<AmapGeoResponse>(url, {
      timeout: WEATHER_CONFIG.GEOLOCATION_TIMEOUT,
      // 每次重试都是一次配额消耗，配额类/Key 类错误重试也没用（沿用 legacy retries: 1）
      retries: 1,
      retryDelay: 600,
      backoff: 2,
    });
    assertAmapOk(data, '城市编码');
    if (!data.geocodes || data.geocodes.length === 0) {
      throw new Error('未查询到城市adcode');
    }
    const adcode = data.geocodes[0].adcode || data.geocodes[0].citycode;
    if (!adcode) throw new Error('未查询到城市adcode');
    await chrome.storage.local.set({ [cacheKey]: { adcode, ts: Date.now() } });
    return adcode;
  }

  /** 通过adcode获取天气（带缓存） */
  async function getWeatherByAdcode(adcode: string): Promise<WeatherData> {
    const cacheKey = `amap_weather_${adcode}`;
    const cached = (await chrome.storage.local.get([cacheKey])) as Record<string, unknown>;
    const entry = cached && (cached[cacheKey] as WeatherCacheEntry | undefined);
    if (entry && Date.now() - entry.ts < WEATHER_CONFIG.WEATHER_CACHE_TTL) {
      lastResolvedCacheKey = cacheKey;
      return { ...entry.data, __fromCache: true };
    }
    const url = `${WEATHER_CONFIG.BASE_URL}/weather/weatherInfo?key=${apiKey.value}&city=${adcode}&extensions=base`;
    const data = await fetchJSON<AmapWeatherResponse>(url, {
      timeout: WEATHER_CONFIG.GEOLOCATION_TIMEOUT,
      retries: 1,
      retryDelay: 600,
      backoff: 2,
    });
    assertAmapOk(data, '天气');
    if (!data.lives || data.lives.length === 0) {
      throw new Error('高德天气返回空数据');
    }
    const formatted = formatAmapWeatherData(data.lives[0]);
    lastResolvedCacheKey = cacheKey;
    delete formatted.__fromCache;
    await chrome.storage.local.set({ [cacheKey]: { data: formatted, ts: Date.now() } });
    return formatted;
  }

  /**
   * 带重试机制的位置天气获取。
   * maxRetries 默认 1 = 不重试。内层 fetchOpenMeteoCurrent / getAdcodeByCity
   * 各自已经有降级兜底，外层再叠多次重试就是乘法：每轮 5 秒超时用户要干等
   * 20 秒以上。真要重试交给 30 分钟定时器和用户手动刷新。
   */
  async function getWeatherByLocationWithRetry(maxRetries = 1): Promise<WeatherData> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`尝试获取位置天气 (第${attempt}次)...`);
        return await getWeatherByLocation();
      } catch (error) {
        console.log(`第${attempt}次尝试失败:`, (error as Error).message);
        if (attempt === maxRetries) {
          // 最后一次尝试失败，抛出错误
          throw error;
        }
        // 等待一段时间后重试
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    throw new Error('获取天气信息失败');
  }

  /** 根据位置获取天气（先逆地理到adcode，再取天气；定位失败回退 IP 定位） */
  async function getWeatherByLocation(): Promise<WeatherData> {
    try {
      const position = await getCurrentPosition();
      const lng = position.coords.longitude;
      const lat = position.coords.latitude;
      // 逆地理，获取adcode
      const regeoUrl = `${WEATHER_CONFIG.BASE_URL}/geocode/regeo?key=${apiKey.value}&location=${lng},${lat}`;
      const regeoData = await fetchJSON<AmapRegeoResponse>(regeoUrl, {
        timeout: WEATHER_CONFIG.GEOLOCATION_TIMEOUT,
        retries: 1,
        retryDelay: 600,
        backoff: 2,
      });
      assertAmapOk(regeoData, '逆地理');
      const component = regeoData?.regeocode?.addressComponent;
      const adcode = component?.adcode;
      const cityCode = adcode || component?.citycode;
      const detectedCityName = component?.city || component?.province;
      if (!adcode && !cityCode) {
        throw new Error('逆地理失败，未获取到adcode');
      }
      // 顺手把「城市 → adcode」也写进缓存：下次启动若 currentCity 已被持久化成这个城市，
      // getAdcodeByCity 就能直接命中，省掉一次 geocode 请求
      if (detectedCityName && (adcode || cityCode)) {
        chrome.storage.local
          .set({
            ['amap_adcode_' + detectedCityName]: {
              adcode: adcode || cityCode,
              ts: Date.now(),
            },
          })
          .catch(() => {});
      }
      // 天气
      const data = await getWeatherByAdcode((adcode || cityCode) as string);
      // 持久化保存自动识别到的城市
      if (!currentCity.value && detectedCityName) {
        try {
          await persistDetectedCity(detectedCityName);
        } catch (e) {
          console.warn('保存定位城市失败:', (e as Error)?.message || e);
        }
      }
      return data;
    } catch (error) {
      console.warn('基于浏览器定位失败，尝试使用IP定位作为回退...', (error as Error)?.message || error);
      // 回退：使用IP定位获取adcode
      try {
        const { adcode, cityName } = await getAdcodeByIP();
        const data = await getWeatherByAdcode(adcode);
        if (!currentCity.value && cityName) {
          try {
            await persistDetectedCity(cityName);
          } catch (e) {
            console.warn('保存IP城市失败:', (e as Error)?.message || e);
          }
        }
        return data;
      } catch (ipErr) {
        console.error('IP 定位回退也失败:', ipErr);
        // 配额/Key 问题必须以 IP 路径的错误为准，否则上层会当成普通定位失败、只冷却 3 分钟
        if ((ipErr as WeatherErrorLike)?.fatal) throw ipErr;
        throw error; // 其余情况抛原始错误，便于上层判断权限/超时
      }
    }
  }

  /** 通过IP定位获取 adcode（回退方案，直接用高德 IP 定位） */
  async function getAdcodeByIP(): Promise<{ adcode: string; cityName?: string }> {
    // 直接使用高德 IP 定位，无需额外第三方服务/host 权限
    const url = `${WEATHER_CONFIG.BASE_URL}/ip?key=${apiKey.value}`;
    const data = await fetchJSON<AmapIPResponse>(url, {
      timeout: WEATHER_CONFIG.GEOLOCATION_TIMEOUT - 1000,
      retries: 1,
      retryDelay: 500,
      backoff: 2,
    });
    assertAmapOk(data, 'IP 定位');
    const ipAdcode = data?.adcode || data?.citycode;
    if (!ipAdcode) throw new Error('IP定位未返回adcode');
    const cityName = data?.city || data?.province;
    return { adcode: ipAdcode, cityName };
  }

  /**
   * 获取当前位置：先尝试高精度，失败或超时则自动回退到低精度，延长超时；
   * 前置 permissions 查询直接给出「权限被拒绝」的明确错误。
   */
  function getCurrentPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error('浏览器不支持地理位置'));
        return;
      }

      const geoOptions = {
        enableHighAccuracy: true,
        timeout: WEATHER_CONFIG.GEOLOCATION_TIMEOUT,
        maximumAge: WEATHER_CONFIG.GEOLOCATION_MAX_AGE,
      };

      const mapGeoError = (error: GeolocationPositionError | null): string => {
        if (!error) return '获取位置失败（未知原因）';
        // 标准 PositionError(code) 与现代 DOMException(name)
        const code = typeof error.code === 'number' ? error.code : undefined;
        const name = (error as GeolocationPositionError & { name?: string }).name || '';
        const msg = error.message || '';

        // 先按 code 分类
        if (code === 1 /* PERMISSION_DENIED */) {
          return '地理位置权限被拒绝，请在浏览器/系统设置中允许位置访问';
        }
        if (code === 2 /* POSITION_UNAVAILABLE */) {
          return '位置信息不可用';
        }
        if (code === 3 /* TIMEOUT */) {
          return '获取位置超时，请检查网络/定位设置';
        }

        // 再按 name/消息特征
        if (name === 'NotAllowedError' || /denied|blocked/i.test(msg)) {
          return '地理位置权限被拒绝，请在浏览器/系统设置中允许位置访问';
        }
        if (name === 'NotFoundError') {
          return '未找到可用的定位源，请检查系统定位是否开启';
        }
        if (name === 'SecurityError') {
          return '定位被安全策略阻止，请检查浏览器定位设置';
        }
        if (/timeout/i.test(msg)) {
          return '获取位置超时，请检查网络/定位设置';
        }
        return '获取位置时发生未知错误';
      };

      const requestLocation = () => {
        let settled = false;

        // 先尝试高精度，失败或超时则自动回退到低精度，延长超时
        const tryHighAccuracy = () => {
          const hiTimeout = Math.min(geoOptions.timeout, 8000);
          const opts: PositionOptions = {
            enableHighAccuracy: true,
            timeout: hiTimeout,
            maximumAge: geoOptions.maximumAge,
          };
          const timerA = setTimeout(() => {
            if (settled) return;
            tryLowAccuracy();
          }, hiTimeout + 200);

          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (settled) return;
              settled = true;
              clearTimeout(timerA);
              resolve(pos);
            },
            () => {
              if (settled) return;
              clearTimeout(timerA);
              tryLowAccuracy();
            },
            opts
          );
        };

        const tryLowAccuracy = () => {
          const loTimeout = Math.max(geoOptions.timeout, 12000);
          const opts: PositionOptions = {
            enableHighAccuracy: false,
            timeout: loTimeout,
            maximumAge: geoOptions.maximumAge,
          };
          const timerB = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error('获取位置超时，请检查网络/定位设置'));
          }, loTimeout + 200);

          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (settled) return;
              settled = true;
              clearTimeout(timerB);
              resolve(pos);
            },
            (err) => {
              if (settled) return;
              settled = true;
              clearTimeout(timerB);
              reject(new Error(mapGeoError(err)));
            },
            opts
          );
        };

        tryHighAccuracy();
      };

      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions
          .query({ name: 'geolocation' })
          .then((status) => {
            if (status.state === 'denied') {
              reject(new Error('地理位置权限被拒绝，请在浏览器/系统设置中允许位置访问'));
              return;
            }
            requestLocation();
          })
          .catch(() => {
            requestLocation();
          });
      } else {
        requestLocation();
      }
    });
  }

  /* ==================== Open-Meteo 免密钥天气（无高德Key时的默认路径） ==================== */

  /** 优先使用设置的城市名（走 geocoding），否则使用浏览器定位坐标 */
  async function getOpenMeteoWeather(): Promise<WeatherData> {
    lastResolvedCacheKey = null;
    if (currentCity.value) {
      return getOpenMeteoByCity(currentCity.value);
    }
    return getOpenMeteoByLocation();
  }

  /** 按城市名获取 Open-Meteo 天气（geocoding 结果与天气均带缓存） */
  async function getOpenMeteoByCity(cityName: string): Promise<WeatherData> {
    // 1. 城市名 -> 坐标（带 24h 缓存）
    const geoKey = `om_geo_${cityName}`;
    const geoCached = (await chrome.storage.local.get([geoKey])) as Record<string, unknown>;
    const geoTtl = WEATHER_CONFIG.ADCODE_CACHE_TTL;
    let place = geoCached && (geoCached[geoKey] as PlaceCacheEntry | undefined);
    if (!place || Date.now() - place.ts >= geoTtl) {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        cityName
      )}&count=1&language=zh&format=json`;
      const data = await fetchJSON<OpenMeteoGeoResponse>(url, {
        timeout: WEATHER_CONFIG.GEOLOCATION_TIMEOUT,
        retries: 2,
        retryDelay: 600,
        backoff: 2,
      });
      if (!data.results || data.results.length === 0) {
        throw new Error('未查询到该城市，请检查城市名称');
      }
      const r = data.results[0];
      place = {
        name: r.name,
        admin1: r.admin1 || '',
        country: r.country || '',
        latitude: r.latitude,
        longitude: r.longitude,
        ts: Date.now(),
      };
      await chrome.storage.local.set({ [geoKey]: place });
    }
    // 2. 坐标 -> 天气
    return fetchOpenMeteoCurrent(
      place.latitude,
      place.longitude,
      place.admin1 ? `${place.name}·${place.admin1}` : place.name,
      place.country
    );
  }

  /**
   * 按浏览器定位获取 Open-Meteo 天气（定位失败回退上次成功坐标）。
   * 定位不可用/被拒绝属常见情况（用户未授权、系统关闭定位），静默降级：
   * 能回退就用缓存坐标，回退不了才把原始错误抛给上层展示提示。
   */
  async function getOpenMeteoByLocation(): Promise<WeatherData> {
    const locKey = 'om_last_location';
    try {
      const position = await getCurrentPosition();
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const data = await fetchOpenMeteoCurrent(latitude, longitude, '当前位置', '');
      await chrome.storage.local.set({
        [locKey]: { latitude, longitude, ts: Date.now() },
      });
      return data;
    } catch (geoErr) {
      // 静默回退：优先用上次成功坐标
      const last = (await chrome.storage.local.get([locKey])) as Record<string, unknown>;
      const saved = last && (last[locKey] as LastLocationEntry | undefined);
      if (saved) {
        return fetchOpenMeteoCurrent(saved.latitude, saved.longitude, '当前位置', '');
      }
      // 无缓存可选：交由上层统一展示友好文案（不在这里打 warn，避免噪音）
      throw geoErr;
    }
  }

  /** 调用 Open-Meteo forecast 接口并格式化（带缓存） */
  async function fetchOpenMeteoCurrent(latitude: number, longitude: number, cityName: string, country: string): Promise<WeatherData> {
    const cacheKey = `om_weather_${latitude.toFixed(2)}_${longitude.toFixed(2)}`;
    const cached = (await chrome.storage.local.get([cacheKey])) as Record<string, unknown>;
    const entry = cached && (cached[cacheKey] as WeatherCacheEntry | undefined);
    if (entry && Date.now() - entry.ts < WEATHER_CONFIG.WEATHER_CACHE_TTL) {
      lastResolvedCacheKey = cacheKey;
      return { ...entry.data, __fromCache: true };
    }
    const base = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}`;
    const timeout = WEATHER_CONFIG.GEOLOCATION_TIMEOUT;
    // retries: 0 —— 这里刻意不重试。
    //
    // 以前是 retries: 1，加上 legacy 兜底接口（各 1 次重试）和
    // getWeatherByLocationWithRetry 外层的重试，最坏情况是 2 × (2 + 2) = 8 次
    // 5 秒超时 = 40 秒 —— 用户打开新标签页能看见满屏飘红的 forecast 请求，
    // 就是这个乘法爆炸造成的。
    //
    // 这些失败绝大多数是「本机到 api.open-meteo.com 不通」（国内网络对这域名
    // 长期不稳定），不是接口抖动。对不可达的下游重试没有任何收益，只会
    // 把等待时间叠成 N 倍并把 DevTools 刷满。失败就交给上层冷却。
    const opts = { timeout, retries: 0 };

    let current: OpenMeteoCurrentBlock;
    try {
      const data = await fetchJSON<OpenMeteoForecastResponse>(
        `${base}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,` +
          'weather_code,wind_speed_10m,wind_direction_10m,pressure_msl&timezone=auto',
        opts
      );
      if (!data || !data.current) throw new Error('Open-Meteo 返回空数据');
      current = data.current;
    } catch (primaryErr) {
      // 降级：旧版 current_weather 接口字段少（无湿度/气压），但可用性更高，
      // 实测新接口偶发整段超时（HTTP 000）而它照常返回，所以留作兜底。
      console.warn(
        '[weather] Open-Meteo current 接口失败，改用 current_weather 兜底:',
        (primaryErr as Error)?.message || primaryErr
      );
      const legacy = await fetchJSON<OpenMeteoForecastResponse>(`${base}&current_weather=true&timezone=auto`, opts);
      if (!legacy || !legacy.current_weather) throw primaryErr;
      const cw = legacy.current_weather;
      current = {
        temperature_2m: cw.temperature,
        apparent_temperature: cw.temperature,
        is_day: cw.is_day,
        weather_code: cw.weathercode,
        wind_speed_10m: cw.windspeed,
        wind_direction_10m: cw.winddirection,
      };
    }

    const formatted = formatOpenMeteoData(current, cityName, country);
    lastResolvedCacheKey = cacheKey;
    await chrome.storage.local.set({ [cacheKey]: { data: formatted, ts: Date.now() } });
    return formatted;
  }

  /** WMO weathercode -> [中文描述, 图标类别]（legacy getWmoMapping 逐字移植） */
  function getWmoMapping(code: number): [string, string] {
    const map: Record<number, [string, string]> = {
      0: ['晴', 'sunny'],
      1: ['晴', 'sunny'],
      2: ['多云', 'cloudy-sunny'],
      3: ['阴', 'cloudy'],
      45: ['雾', 'fog'],
      48: ['雾凇', 'fog'],
      51: ['毛毛雨', 'rain'],
      53: ['毛毛雨', 'rain'],
      55: ['毛毛雨', 'rain'],
      56: ['冻雨', 'snow'],
      57: ['冻雨', 'snow'],
      61: ['小雨', 'rain'],
      63: ['中雨', 'rain'],
      65: ['大雨', 'heavy-rain'],
      66: ['冻雨', 'snow'],
      67: ['冻雨', 'snow'],
      71: ['小雪', 'snow'],
      73: ['中雪', 'snow'],
      75: ['大雪', 'snow'],
      77: ['雪', 'snow'],
      80: ['阵雨', 'rain'],
      81: ['阵雨', 'rain'],
      82: ['强阵雨', 'heavy-rain'],
      85: ['阵雪', 'snow'],
      86: ['阵雪', 'snow'],
      95: ['雷阵雨', 'thunderstorm'],
      96: ['雷阵雨伴冰雹', 'thunderstorm'],
      99: ['雷阵雨伴冰雹', 'thunderstorm'],
    };
    return map[code] || ['未知', 'unknown'];
  }

  /** 将 Open-Meteo current 结构格式化为内部结构（对齐高德 formatter 字段） */
  function formatOpenMeteoData(current: OpenMeteoCurrentBlock, cityName: string, country: string): WeatherData {
    const code = current.weather_code;
    const isNight = current.is_day === 0;
    const [description, iconBase] = getWmoMapping(code);
    // 夜间图标适配
    let icon = iconBase;
    if (isNight) {
      if (iconBase === 'sunny') icon = 'clear-night';
      else if (iconBase === 'cloudy-sunny') icon = 'partly-cloudy-night';
    }
    return {
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature),
      humidity:
        current.relative_humidity_2m !== undefined
          ? Math.round(current.relative_humidity_2m)
          : undefined,
      pressure:
        current.pressure_msl !== undefined ? Math.round(current.pressure_msl) : undefined,
      description,
      icon,
      city: cityName || '当前位置',
      country: country || '',
      windSpeed:
        current.wind_speed_10m !== undefined ? Math.round(current.wind_speed_10m) : undefined,
      windDeg:
        current.wind_direction_10m !== undefined
          ? Math.round(current.wind_direction_10m)
          : undefined,
      sunrise: undefined,
      sunset: undefined,
      timestamp: Date.now(),
    };
  }

  /** 将高德实况天气lives[0]格式化为内部结构 */
  function formatAmapWeatherData(live: NonNullable<AmapWeatherResponse['lives']>[number]): WeatherData {
    return {
      temperature: parseInt(live.temperature ?? '', 10),
      feelsLike: parseInt(live.temperature ?? '', 10),
      humidity: parseInt(live.humidity ?? '', 10),
      pressure: undefined,
      description: live.weather ?? '',
      icon: undefined,
      city: live.city || live.province || '',
      country: 'CN',
      windSpeed: live.windpower ? parseInt(live.windpower, 10) : undefined,
      windDeg: undefined,
      sunrise: undefined,
      sunset: undefined,
      timestamp: Date.now(),
    };
  }

  /* ==================== 主流程：updateWeather（legacy updateWeather 逐字移植） ==================== */

  /**
   * 更新天气信息。force=true 跳过节流与冷却（用户手动刷新/换城市）。
   */
  async function updateWeather(options: { force?: boolean } = {}): Promise<void> {
    const force = options.force === true;
    if (isLoading.value) return;
    // 限流：避免过于频繁
    const now = Date.now();
    if (!force && lastRequestAt && now - lastRequestAt < WEATHER_CONFIG.MIN_REQUEST_INTERVAL) {
      return;
    }
    // 上一次失败的冷却期（配额类失败冷却 30 分钟，避免继续烧配额）
    if (!force && (await inCooldown())) {
      console.info('[weather] 处于失败冷却期，跳过本次请求');
      // 冷却期内至少把上次成功的数据显示出来，别让卡片停在「--°C」；
      // 这里必须放宽到兜底窗口，真机控制台「处于失败冷却期」正是这条路径。
      const cached = await readCachedData({ allowExpired: true }).catch(() => null);
      if (cached && cached.data) displayFallbackCache(cached.data, cached.ts);
      return;
    }
    lastRequestAt = now;

    // 缓存先行：已有数据时不再进 loading 态（避免每 30 分钟图标脉冲闪一下），
    // 只有空白卡片才需要 loading 提示
    const preCached = weatherData.value
      ? null
      : await readCachedData({ allowExpired: true }).catch(() => null);
    if (preCached && preCached.data) {
      displayFallbackCache(preCached.data, preCached.ts);
    } else {
      isLoading.value = true; // legacy showLoading
    }

    try {
      let data: WeatherData | undefined;
      lastResolvedCacheKey = null;

      if (!apiKey.value) {
        // 未配置高德Key：使用 Open-Meteo 免费天气接口（无需任何密钥）
        data = await getOpenMeteoWeather();
      } else if (currentCity.value) {
        // 使用指定城市 => 先换为adcode（带缓存）
        const adcode = await getAdcodeByCity(currentCity.value);
        data = await getWeatherByAdcode(adcode);
      } else {
        // 使用当前位置，带重试机制
        data = await getWeatherByLocationWithRetry();
      }

      if (data && Number.isFinite(data.temperature)) {
        // 命中缓存返回的旧数据不能把「· 缓存」标记抹掉（时间戳还是旧的）
        if (!data.__fromCache) {
          clearStale();
          // 成功即清零连续失败计数：下次再失败重新从基础冷却开始
          void clearFailCount().catch(() => {});
        }
        displayWeather(data);
        // 统一落缓存：weather_last_ok（失败回退用）+ 本次链路自己的 key
        void writeWeatherCache(lastResolvedCacheKey, data).catch(() => {});
        // 若当前未指定城市且成功从定位/IP 获取到城市名，持久化保存，避免频繁请求。
        // 「当前位置」是定位路径的显示占位文案，持久化它会让下次启动误走城市查询。
        if (!currentCity.value && data.city && data.city !== '当前位置') {
          try {
            await persistDetectedCity(data.city);
          } catch (e) {
            console.warn('自动保存定位城市失败:', (e as Error)?.message || e);
          }
        }
      }
    } catch (error) {
      const err = error as WeatherErrorLike;
      const msg = err?.message || '获取天气信息失败';
      // 定位不可用/被拒绝是常见预期态（用户未授权），降级为 info，避免每次开标签页刷错误
      const expectedGeoIssue = /权限被拒绝|位置信息不可用|获取位置超时|不支持地理位置|未找到可用/.test(msg);
      if (expectedGeoIssue) {
        console.info('[weather] 定位不可用，已跳过自动定位：', msg);
      } else {
        console.error('获取天气信息失败:', error);
      }
      // 冷却：配额/Key 异常、以及「要用户改设置才会变」的定位权限问题都冷却 30 分钟；
      // 其余（网络抖动、空数据）3 分钟，给一次快速恢复的机会。
      const needsUserAction =
        err?.fatal === true || /权限被拒绝|不支持地理位置|请在浏览器\/系统设置中允许位置访问/.test(msg);
      const cooldownMs = needsUserAction ? 30 * 60 * 1000 : 3 * 60 * 1000;
      void setCooldown(cooldownMs, msg).catch(() => {});

      // 失败兜底：正常 24h 上限之外，再给 7 天内的 weather_last_ok 一次机会；
      // 命中后卡片显示缓存数据（带「· 缓存」），而不是「--°C / 获取中…」。
      const fallback = await readCachedData({ allowExpired: true }).catch(() => null);
      if (fallback && fallback.data) {
        displayFallbackCache(fallback.data, fallback.ts);
        // legacy 这里还会挂一条 dsh-tip warning（「天气更新失败…显示 N 分钟前的数据」）；
        // dsh-tip 尚未 Vue 化，该提示暂缺，卡片上的「· 缓存」标记照常生效。
      } else {
        showError(msg);
      }
    } finally {
      isLoading.value = false;
      // 加载态必须收敛：weatherData 为空等边界下 displayWeather 不会被调用，
      // .weather-widget.loading 的 pulse 会一直残留成「自己动」的指示。
    }
  }

  /* ==================== 初始化与定时刷新（legacy init，定时器按组件生命周期管理） ==================== */

  let initialized = false;

  async function init(): Promise<void> {
    if (initialized) return;
    initialized = true;
    try {
      // 等设置 hydrate：init 的缓存键/城市/Key 决策必须基于存储里的真实值
      await waitSettingsHydrated();
      // 启动优先走缓存渲染，避免刷新即请求
      const usedCache = await displayCachedWeatherIfFresh();
      if (!usedCache) {
        // 缓存过期/缺失：先把旧数据贴上（带「· 缓存」标记），再后台更新，
        // 网络慢、接口超时或处于失败冷却期也不会让卡片先空成「--°C」。
        const fallback = await readCachedData({ allowExpired: true }).catch(() => null);
        if (fallback && fallback.data) displayFallbackCache(fallback.data, fallback.ts);
        await updateWeather();
      }
    } catch (error) {
      console.error('天气管理器初始化失败:', error);
      const fallback = await readCachedData({ allowExpired: true }).catch(() => null);
      if (fallback && fallback.data) displayFallbackCache(fallback.data, fallback.ts);
      else showError('天气服务初始化失败');
    }
  }

  let updateTimer: ReturnType<typeof setInterval> | null = null;
  let consumerCount = 0;

  /**
   * 启动定时刷新（UPDATE_INTERVAL 30 分钟）并触发首次 init。
   * 引用计数：面板/卡片都卸载时清理定时器（legacy 的 updateTimer 清理逻辑收口到这里）。
   * 返回清理函数，组件在 onUnmounted 里调用。
   */
  function startAutoUpdate(): () => void {
    consumerCount += 1;
    if (!updateTimer) {
      void init();
      updateTimer = setInterval(() => {
        void updateWeather();
      }, WEATHER_CONFIG.UPDATE_INTERVAL);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      consumerCount = Math.max(0, consumerCount - 1);
      if (consumerCount === 0 && updateTimer) {
        clearInterval(updateTimer);
        updateTimer = null;
      }
    };
  }

  /* ==================== 设置动作（legacy setCity/useCurrentLocation/setTemperatureUnit/refresh） ==================== */

  /** 设置城市：换城市是明确意图，跳过冷却与节流 */
  async function setCity(cityName: string): Promise<void> {
    await writeSettingsFields({ weatherCity: cityName });
    await updateWeather({ force: true });
  }

  /** 使用当前位置 */
  async function useCurrentLocation(): Promise<void> {
    await writeSettingsFields({ weatherCity: '' });
    await updateWeather({ force: true });
  }

  /** 设置温度单位（写回 settings；显示由响应式自动重算，等价于 legacy 的重新 displayWeather） */
  async function setTemperatureUnit(unit: TemperatureUnit): Promise<void> {
    await writeSettingsFields({ temperatureUnit: unit });
  }

  /** 设置面板保存后同步 settings 字段：saveFromPanel 已写盘，但 onChanged 异步到达前
   *  fetch 决策路径可能还读到旧值——这里直接写响应式 settings，保证下一次 fetch 生效 */
  async function applySettingsFields(fields: { weatherApiKey?: string; weatherCity?: string }): Promise<void> {
    await writeSettingsFields(fields);
  }

  /** 刷新天气信息：用户手动点刷新 = 明确的「现在就再试一次」，绕过冷却 */
  async function refresh(): Promise<void> {
    await updateWeather({ force: true });
  }

  return {
    weatherData,
    isLoading,
    isStale,
    staleTitle,
    error: errorInfo,
    currentCity,
    temperatureUnit,
    setCity,
    useCurrentLocation,
    setTemperatureUnit,
    applySettingsFields,
    refresh,
    updateWeather,
    getCurrentWeather: () => weatherData.value,
    startAutoUpdate,
  };
}

/* ==================== 对外 API（useTodo 同款模块级单例） ==================== */

export interface WeatherApi {
  /** 当前天气数据（legacy this.weatherData） */
  weatherData: Ref<WeatherData | null>;
  /** .weather-widget.loading（legacy showLoading/hideLoading） */
  isLoading: Ref<boolean>;
  /** .weather-widget.is-stale（legacy markStale/clearStale） */
  isStale: Ref<boolean>;
  /** 缓存态 title 文案（legacy markStale 写入 widget.title） */
  staleTitle: Ref<string>;
  /** 错误文案（legacy showError 的卡面短句 + 位置行指引 + 完整原因） */
  error: Ref<WeatherErrorInfo | null>;
  /** 当前城市（settings.weatherCity，清洗后；只读，写入走 writeSettingsFields） */
  currentCity: ComputedRef<string>;
  /** 设置面板保存后同步 settings 字段（onChanged 异步到达前保证 fetch 读到新值） */
  applySettingsFields(fields: { weatherApiKey?: string; weatherCity?: string }): Promise<void>;
  /** 温度单位（settings.temperatureUnit，归一为 celsius/fahrenheit） */
  temperatureUnit: ComputedRef<TemperatureUnit>;
  setCity(cityName: string): Promise<void>;
  useCurrentLocation(): Promise<void>;
  setTemperatureUnit(unit: TemperatureUnit): Promise<void>;
  refresh(): Promise<void>;
  updateWeather(options?: { force?: boolean }): Promise<void>;
  /** legacy getCurrentWeather() */
  getCurrentWeather(): WeatherData | null;
  /** 定时刷新启动（返回清理函数）；首次调用触发 init */
  startAutoUpdate(): () => void;
}

/** legacy 设置面板保存后的联动桥（app.js saveSettings → weatherManager.setApiKey/setCity/useCurrentLocation）。
 *  字段已由 settingsManager.saveFromPanel 写盘；onChanged 异步到达前响应式 settings 可能还是旧值，
 *  这里先同步 Key 再按 legacy 语义拉取：有城市走城市分支，否则走定位分支。 */
export async function onWeatherSettingsSaved(city: string, apiKey: string): Promise<void> {
  const api = useWeather();
  // 空 Key 不覆盖：与 useSettings.saveFromPanel 逐字一致（清空输入框保留旧 Key）
  if (apiKey) await api.applySettingsFields({ weatherApiKey: apiKey });
  if (city) await api.setCity(city);
  else await api.useCurrentLocation();
}

/** 天气模块单例：面板与卡片共享同一份数据 ref（useTodo 同模式） */
export function useWeather(): WeatherApi {
  if (!singleton) singleton = createWeatherApi();
  return singleton;
}
