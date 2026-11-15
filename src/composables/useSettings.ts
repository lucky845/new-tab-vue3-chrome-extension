/**
 * 设置域数据层（Vue3 版）——逐字移植 public/legacy-js/modules/settings-manager.js（250 行）。
 *
 * 关键决策：settings 是 useWeather.ts:360 通过普通 ref + onChanged 监听的共享键，
 * 这里同样走命令式 read-modify-write（get → merge → set），与 legacy SettingsManager 的
 * getAllSettings / saveFromPanel / setSetting 语义一致；避免任何 useStored deep watch
 * 对共享 settings 键产生回声写盘。写入后 useWeather 的 onChanged 自动拉回新值。
 */
export interface Settings {
  pexelsApiKey: string;
  weatherApiKey: string;
  weatherCity: string;
  temperatureUnit: string;
  wallpaperQuery: string;
  searchEngine: string;
  tagline: string;
  wallpaperBrightness: number;
  wallpaperBlur: number;
  showSideWidgets: boolean;
  wallpaperSource: string;
}

export const DEFAULT_SETTINGS: Settings = {
  pexelsApiKey: '',
  weatherApiKey: '',
  weatherCity: '',
  temperatureUnit: 'celsius',
  wallpaperQuery: 'Nature',
  searchEngine: 'Bing',
  tagline: '',
  wallpaperBrightness: 1,
  wallpaperBlur: 0,
  showSideWidgets: true,
  wallpaperSource: 'picsum',
};

/** 一次性迁移旧独立键并清理（legacy migrateLegacySettings 逐字移植，幂等） */
export async function migrateLegacySettings(): Promise<void> {
  const legacyKeys = ['pexelsApiKey', 'weatherCity', 'temperatureUnit', 'weatherApiKey'];
  const data = await chrome.storage.local.get(['settings', ...legacyKeys]);
  const cur = { ...(data.settings || {}) } as Record<string, unknown>;
  let changed = false;
  legacyKeys.forEach((k) => {
    if (typeof data[k] !== 'undefined' && data[k] !== null && data[k] !== '') {
      cur[k] = data[k];
      changed = true;
    }
  });
  if (changed) {
    await chrome.storage.local.set({ settings: cur });
    await chrome.storage.local.remove(legacyKeys);
    console.log('已迁移并清理旧设置键:', legacyKeys);
  }
}

/** 等价 legacy loadSettings()：默认值合并 + 旧键迁移 */
export async function readSettings(): Promise<Settings> {
  await migrateLegacySettings();
  const result = await chrome.storage.local.get(['settings']);
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) } as Settings;
}

/** read-modify-write：settings 是全模块共享对象，禁止整对象覆盖丢字段 */
export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await readSettings();
  const next: Settings = { ...cur, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/** 设置面板一次性保存（legacy saveFromPanel 逐字移植，含 weatherApiKey 空值不覆盖的怪癖） */
export async function saveFromPanel(fields: {
  pexelsApiKey: string;
  weatherApiKey: string;
  weatherCity: string;
  wallpaperSource: string;
}): Promise<Settings> {
  const cur = await readSettings();
  const next: Settings = { ...cur };
  if (typeof fields.pexelsApiKey === 'string') next.pexelsApiKey = fields.pexelsApiKey.trim();
  // legacy：清空 Key 不覆盖（只在非空时写），保留逐字行为
  if (typeof fields.weatherApiKey === 'string' && fields.weatherApiKey.trim()) {
    next.weatherApiKey = fields.weatherApiKey.trim();
  }
  if (typeof fields.weatherCity === 'string') next.weatherCity = fields.weatherCity.trim();
  if (fields.wallpaperSource === 'picsum' || fields.wallpaperSource === 'wallhaven') {
    next.wallpaperSource = fields.wallpaperSource;
  }
  await chrome.storage.local.set({ settings: next });
  return next;
}

/** 标语：空串 = 隐藏（legacy setTagline） */
export async function setTagline(tagline: string): Promise<Settings> {
  return patchSettings({ tagline: tagline || '' });
}

export function getWallpaperSource(s: Settings): 'picsum' | 'wallhaven' {
  return s.wallpaperSource === 'wallhaven' ? 'wallhaven' : 'picsum';
}

export function getWallpaperAdjustments(s: Settings): { brightness: number; blur: number } {
  return {
    brightness: Number(s.wallpaperBrightness) || 1,
    blur: Number(s.wallpaperBlur) || 0,
  };
}

/** 壁纸亮度（0.3~1）与模糊度（0~20px），clamp 防越界（legacy setWallpaperAdjustments） */
export async function setWallpaperAdjustments(
  brightness: number,
  blur: number,
): Promise<{ brightness: number; blur: number }> {
  const b = Math.min(1, Math.max(0.3, Number(brightness) || 1));
  const bl = Math.min(20, Math.max(0, Number(blur) || 0));
  await patchSettings({ wallpaperBrightness: b, wallpaperBlur: bl });
  return { brightness: b, blur: bl };
}

/* ---------- 自定义搜索引擎（独立键 customEngines，不混入 settings 数值型默认值） ---------- */
export interface CustomEngine {
  name: string;
  url: string;
  /** 用户截好的方形 logo（data URL）；缺席时回落到站点 favicon / 首字 */
  logo?: string;
  /** 引擎自带的品牌 SVG（内置引擎才有），没有 logo 时显示 */
  icon?: string;
}

export async function readCustomEngines(): Promise<CustomEngine[]> {
  const result = await chrome.storage.local.get(['customEngines']);
  return Array.isArray(result.customEngines) ? (result.customEngines as CustomEngine[]) : [];
}

async function writeCustomEngines(engines: CustomEngine[]): Promise<void> {
  await chrome.storage.local.set({ customEngines: engines });
}

/** 校验：名称非空、URL 含 %s、http(s) 协议、重名拒绝（逐字移植校验文案与顺序） */
export async function addCustomEngine(
  name: string,
  url: string,
  logo?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const n = (name || '').trim();
  const u = (url || '').trim();
  if (!n || !u || !u.includes('%s')) {
    return { ok: false, message: '名称与搜索链接（含 %s 占位符）均不能为空' };
  }
  if (!/^https?:\/\//i.test(u)) {
    return { ok: false, message: '搜索链接必须以 http(s):// 开头' };
  }
  const engines = await readCustomEngines();
  if (engines.some((e) => e.name.toLowerCase() === n.toLowerCase())) {
    return { ok: false, message: '已存在同名引擎「' + n + '」' };
  }
  engines.push(logo ? { name: n, url: u, logo } : { name: n, url: u });
  await writeCustomEngines(engines);
  return { ok: true };
}

export async function removeCustomEngine(name: string): Promise<boolean> {
  const engines = await readCustomEngines();
  const kept = engines.filter((e) => e.name !== name);
  await writeCustomEngines(kept);
  return kept.length < engines.length;
}
