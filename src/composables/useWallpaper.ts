/**
 * 壁纸域唯一数据入口（单例 composable，useTodo 同范式）。
 *
 * 移植来源：
 *  - 数据层：v1.8.1:js/modules/wallpaper-manager.js（660 行）
 *  - UI 层：v1.8.1:js/app.js 壁纸段（openWallpaperPanel 636-646 / closeWallpaperPanel 647-662 /
 *    searchWallpapers 663-729 / renderWallpaperGrid 730-749 / renderWallpaperCategories 875-903 /
 *    bindWallpaperEvents 580-635）
 *
 * 存储契约与 legacy 逐键兼容（见文末「存储契约」）；
 * 方法级差异与修正集中在文末「与 legacy 的差异」。
 */
import { log } from '@/src/lib/log';
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { usePanels, type PanelId } from '@/src/composables/usePanels';
import { useStored } from '@/src/lib/storage';
import { fetchJSON, resolveFetchUrl, type FetchJSONError } from '@/src/lib/http';
import { syncGlassScene } from '@/src/lib/glass';
import { isImageSource } from '@/src/lib/urlSafe';
import {
  onPhotoInkForTone,
  toneFromLuminance,
  type WallpaperTone,
} from '@/src/lib/wallpaper-tone';
import { toast as showToast } from '@/src/composables/useToast';
import { t } from '@/src/composables/useI18n';

/** 每页壁纸数量（legacy WallpaperManager.WALLPAPERS_PER_PAGE，供分页计算引用）。 */
export const WALLPAPERS_PER_PAGE = 18;
/** 本地 blob 缓存上限 3.6MB：dataURL 比原图大约 33%，约等于 2.7MB 原图（storage.local 默认 10MB）。 */
export const BLOB_MAX_BYTES = 3.6 * 1024 * 1024;
/** 本地壁纸库容量（张）：面板据此显示上限与满库提示。 */
export const LOCAL_LIBRARY_MAX_ENTRIES = 4;
/** Picsum 免 Key 图库总页数（约 1080 张，60 页回绕）。 */
const PICSUM_TOTAL_PAGES = 60;
/** 随机壁纸查询词（legacy RANDOM_QUERIES 九项）。 */
export const RANDOM_QUERIES = [
  'Nature',
  'Cityscape',
  'Technology',
  'Abstract',
  'Ocean',
  'Forest',
  'Mountains',
  'Sky',
  'Wallpaper',
] as const;
/** 推荐分类（legacy CATEGORIES 十二项，字段名 name 与 legacy 一致）。 */
export const CATEGORIES = [
  { nameKey: 'wallpaper_cat_nature', query: 'Nature' },
  { nameKey: 'wallpaper_cat_city', query: 'Cityscape' },
  { nameKey: 'wallpaper_cat_tech', query: 'Technology' },
  { nameKey: 'wallpaper_cat_abstract', query: 'Abstract' },
  { nameKey: 'wallpaper_cat_ocean', query: 'Ocean' },
  { nameKey: 'wallpaper_cat_forest', query: 'Forest' },
  { nameKey: 'wallpaper_cat_mountain', query: 'Mountains' },
  { nameKey: 'wallpaper_cat_sky', query: 'Sky' },
  { nameKey: 'wallpaper_cat_animal', query: 'Animals' },
  { nameKey: 'wallpaper_cat_food', query: 'Food' },
  { nameKey: 'wallpaper_cat_sport', query: 'Sports' },
  { nameKey: 'wallpaper_cat_travel', query: 'Travel' },
] as const satisfies ReadonlyArray<{ nameKey: string; query: string }>;

/** 三源（Pexels/Wallhaven/Picsum）归一后的壁纸对象，形状与 legacy 完全一致。 */
export interface WallpaperPhoto {
  id: string;
  photographer: string;
  alt: string;
  avg_color: string;
  width: number;
  height: number;
  src: {
    original: string;
    large2x: string;
    landscape: string;
    large: string;
    medium: string;
    small: string;
    tiny: string;
  };
}

export type WallpaperSource = 'picsum' | 'wallhaven';

/** searchPhotos 统一返回（legacy SearchPhotosResult 形状 + UI 层降级标记）。 */
export interface WallpaperSearchResult {
  photos: WallpaperPhoto[] | null;
  totalPages: number;
  total: number;
  unauthorized: boolean;
  /** legacy result.source 三值：Pexels 命中 Key 路径返回 'pexels'。 */
  source: 'pexels' | WallpaperSource;
  /** 失败原因（Pexels 失败路径不带此字段，与 legacy 一致，UI 落默认文案）。 */
  error?: string;
  /** UI 层专用：当前图源是否支持按分类筛选；undefined 视为支持。 */
  categorySupported?: boolean;
  /** UI 层专用：触发「浏览模式」降级的分类词。 */
  requestedCategory?: string;
}

/** 分页渲染项（legacy getPaginationRange 的 number|'...' 强类型化）。 */
export interface PaginationItem {
  type: 'page' | 'ellipsis';
  value: number;
}

/** Wallhaven /v1/search 响应（本实现用到的字段）。 */
interface WallhavenResponse {
  data?: Array<{
    id?: unknown;
    path?: string;
    thumbs?: { original?: string; large?: string; small?: string };
    resolution?: string;
    colors?: string[];
    dimension_x?: number;
    dimension_y?: number;
  }>;
  meta?: { total?: number; last_page?: number };
}

/** Pexels 401 时的回调（legacy onAuthError 字段）。 */
type AuthErrorHandler = (() => void) | null;

/** 本地壁纸库条目：id 兼作 savedWallpaperId 哨兵（local:<ts>），dataUrl 为压缩后烤图。 */
export interface LocalWallpaperEntry {
  id: string;
  dataUrl: string;
  name: string;
  addedAt: number;
}

interface WallpaperApi {
  // 数据层（wallpaper-manager.js 对应物）
  fetchAndSetWallpaper(): Promise<void>;
  fetchRandomWallpaper(shouldSave?: boolean): Promise<void>;
  applyPexelsWallpaper(photo: WallpaperPhoto, shouldSave?: boolean): Promise<void>;
  /** 上传本地图片为壁纸：压缩后走 savedWallpaperBlob 快路径。 */
  setLocalWallpaper(file: File): Promise<{ ok: boolean; message: string }>;
  /** 移除本地壁纸并回到随机图。 */
  clearLocalWallpaper(): Promise<void>;
  /** 当前壁纸 ID（本地条目为 local:<ts> 哨兵），面板徽标判断用。 */
  savedWallpaperId: Ref<string>;
  /** 本地壁纸库（可见可管理的缩略图列表，刷新不丢）。 */
  localLibrary: Ref<LocalWallpaperEntry[]>;
  /** 把当前生效的本地烤图收进库（上传时自动调用）。 */
  refreshLocalLibrary(): Promise<void>;
  /** 从库里应用一张本地壁纸。 */
  applyLocalWallpaper(entryId: string): Promise<void>;
  /** 从库里删除一张本地壁纸；若正是当前壁纸则一并撤回随机图。 */
  removeLocalWallpaper(entryId: string): Promise<void>;
  searchPhotos(query: string, page?: number): Promise<WallpaperSearchResult>;
  // UI 状态（v1.8.1:js/app.js 壁纸段对应物，全部响应式）
  photos: Ref<WallpaperPhoto[]>;
  isSearching: Ref<boolean>;
  loadFailed: Ref<boolean>;
  categoryUnsupported: Ref<boolean>;
  activeCategory: Ref<string>;
  wallpaperSearchQuery: Ref<string>;
  currentQuery: Ref<string>;
  currentPage: Ref<number>;
  totalPages: Ref<number>;
  totalWallpapers: Ref<number>;
  paginationItems: ComputedRef<PaginationItem[]>;
  totalResultsInfo: ComputedRef<string>;
  // UI 行为（v1.8.1:js/app.js 壁纸段对应物）
  searchWallpapers(
    query: string,
    page?: number,
    options?: { skipCategoryHighlight?: boolean }
  ): Promise<void>;
  handleSearch(): Promise<void>;
  handleCategoryClick(category: { nameKey: string; query: string }): Promise<void>;
  goToPage(page: number): Promise<void>;
  handleJumpSubmit(raw: string): Promise<boolean>;
  closeWallpaperPanel(): void;
  /** 打开任意面板（组件 onAuthError 注入用 open('settings')）。 */
  open(id: PanelId): void;
  setAuthErrorHandler(handler: AuthErrorHandler): void;
}

function createWallpaperApi(): WallpaperApi {
  // ---------- 面板开合（usePanels 全局单例状态） ----------
  const { open, close } = usePanels();

  // ---------- 数据层状态（legacy WallpaperManager 实例字段） ----------
  const currentQuery = ref('Nature');
  const currentPage = ref(1);
  const totalPages = ref(1);
  const totalWallpapers = ref(0);

  // ---------- UI 层状态（legacy v1.8.1:js/app.js 壁纸段变量 / DOM 类） ----------
  const photos = ref<WallpaperPhoto[]>([]);
  const isSearching = ref(false);
  /** 对应 legacy 空态提示（grid 内 .wallpaper-empty-hint，photos===null 时显示）。 */
  const loadFailed = ref(false);
  /** 对应 legacy markCategoryUnsupported / clearCategoryUnsupported。 */
  const categoryUnsupported = ref(false);
  /** 对应 legacy 高亮的 data-category 元素（'' 表示无高亮）。 */
  const activeCategory = ref('');
  /** 对应 #wallpaper-search-input 的值。 */
  const wallpaperSearchQuery = ref('');
  /** legacy v1.8.1:js/app.js:54 初始 'Nature'。 */
  const lastActiveCategoryQuery = ref('Nature');
  let onAuthError: AuthErrorHandler = null;

  // ---------- 持久化（useStored 写路径；读取语义见 fetchAndSetWallpaper） ----------
  const savedWallpaperId = useStored<string>('savedWallpaperId', '');
  const savedWallpaperUrl = useStored<string>('savedWallpaperUrl', '');
  const savedWallpaperData = useStored<{ id: string; url: string; photographer: string; alt: string } | null>(
    'savedWallpaperData',
    null
  );
  const savedWallpaperBlob = useStored<string>('savedWallpaperBlob', '');
  const savedWallpaperBlobUrl = useStored<string>('savedWallpaperBlobUrl', '');

  // ---------- 密钥/图源同步（settings 域只读，30s TTL） ----------
  let pexelsApiKey = '';
  let wallpaperSource: WallpaperSource = 'picsum';
  let apiKeySyncedAt = 0;

  /** legacy syncApiKey：读 settings.pexelsApiKey + wallpaperSource，30s TTL，返回是否已配置 Key。 */
  async function syncApiKey(force = false): Promise<boolean> {
    const now = Date.now();
    if (!force && apiKeySyncedAt !== 0 && now - apiKeySyncedAt < 30000) {
      return pexelsApiKey.length > 0;
    }
    try {
      // chrome.storage.local.get 在本仓类型环境回退为 {}（NoInfer 泛型）→ 显式断言形状
      const data = (await chrome.storage.local.get(['settings'])) as {
        settings?: { pexelsApiKey?: string; wallpaperSource?: string };
      };
      const settings = data && data.settings;
      pexelsApiKey = (settings && settings.pexelsApiKey) || '';
      wallpaperSource = settings && settings.wallpaperSource === 'wallhaven' ? 'wallhaven' : 'picsum';
    } catch (error) {
      log.error('同步壁纸密钥失败:', error);
    }
    apiKeySyncedAt = Date.now();
    return pexelsApiKey.length > 0;
  }

  // ================= 数据层（wallpaper-manager.js） =================

  /**
   * 主入口：加载并应用壁纸。
   * 优先级：本地 blob 缓存 → 缓存 URL（Pexels 异步校验）→ 仅 ID 恢复 → 随机。
   * 读路径用单次 chrome.storage.local.get 而非 useStored：避免异步 hydrate
   * 竞态把「有缓存」误判成「无缓存」（丢壁纸 + 多余网络请求）。
   */
  async function fetchAndSetWallpaper(): Promise<void> {
    await syncApiKey();

    const result = (await chrome.storage.local.get([
      'savedWallpaperId',
      'savedWallpaperUrl',
      'savedWallpaperData',
      'savedWallpaperBlob',
      'savedWallpaperBlobUrl',
    ])) as {
      savedWallpaperId?: unknown;
      savedWallpaperUrl?: string;
      savedWallpaperData?: unknown;
      savedWallpaperBlob?: string;
      savedWallpaperBlobUrl?: string;
    };

    // 1a. 有本地烤好的 dataURL → 零网络请求直接出图（最快路径）。
    //     校验 savedWallpaperBlobUrl 与当前壁纸 URL 一致：不一致说明缓存是上一张的。
    if (result.savedWallpaperBlob && result.savedWallpaperBlobUrl === result.savedWallpaperUrl) {
      setWallpaper(result.savedWallpaperBlob);
      log.log('[壁纸] 命中本地缓存，零请求');
      return;
    }

    // 1a-2. 本地壁纸：blob 丢了（被清/超配额）时从库里按哨兵 id 找回；库空才放行随机。
    const localSavedId = String(result.savedWallpaperId || '');
    if (localSavedId.startsWith('local:')) {
      const entry = (await readLocalLibrary()).find((item) => item.id === localSavedId);
      if (entry) {
        savedWallpaperId.value = entry.id;
        savedWallpaperUrl.value = entry.id;
        savedWallpaperData.value = { id: entry.id, url: '', photographer: t('wallpaper_local_image'), alt: entry.name };
        savedWallpaperBlob.value = entry.dataUrl;
        savedWallpaperBlobUrl.value = entry.id;
        setWallpaper(entry.dataUrl);
        log.log('[壁纸] 本地库恢复:', entry.name);
        return;
      }
      await removeSavedWallpaperKeys(); // 库里没有这张了：清键走随机，别卡在死哨兵上
    }

    // 1b. 有缓存 URL：直接用；Pexels 来源异步校验 ID，失效才换新。
    if (result.savedWallpaperUrl) {
      setWallpaper(result.savedWallpaperUrl);
      log.log('使用缓存的壁纸URL');

      const savedId = String(result.savedWallpaperId || '');
      // Picsum/Wallhaven 图床链接长期有效无需验证；仅 Pexels 来源需要验证
      const isPexelsWallpaper =
        savedId.length > 0 && !savedId.startsWith('pic_') && !savedId.startsWith('wh_');
      if (isPexelsWallpaper && pexelsApiKey) {
        setTimeout(() => {
          void (async () => {
            const isValid = await validateWallpaperById(savedId);
            if (!isValid) {
              log.log('缓存的壁纸已失效，获取新壁纸');
              await fetchRandomWallpaper(true);
            }
          })();
        }, 100);
      }
      return;
    }

    // 2. 有 Pexels ID 但没有 URL：按 ID 恢复；Picsum 记录异常则清掉重来。
    const savedId = String(result.savedWallpaperId || '');
    if (savedId && !result.savedWallpaperUrl) {
      if (savedId.startsWith('pic_')) {
        removeSavedWallpaperKeys();
      } else if (pexelsApiKey) {
        const success = await fetchWallpaperById(savedId);
        if (success) {
          return;
        }
      }
    }

    // 3. 没有保存的壁纸或恢复失败：随机壁纸（有 Key 走 Pexels，无 Key 走 Picsum）。
    await fetchRandomWallpaper(true);
  }

  /** 验证 Pexels 壁纸是否仍然有效（raw fetch，非 JSON 通道）。 */
  async function validateWallpaperById(id: string): Promise<boolean> {
    try {
      const response = await fetch(resolveFetchUrl('https://api.pexels.com/v1/photos/' + id), {
        headers: { Authorization: pexelsApiKey },
      });
      return response.ok;
    } catch (error) {
      log.error('验证壁纸时网络错误:', error);
      return false;
    }
  }

  /** 仅剩 Pexels 缓存 ID 时的恢复路径；失败移除三键。 */
  async function fetchWallpaperById(id: string): Promise<boolean> {
    try {
      const response = await fetch(resolveFetchUrl('https://api.pexels.com/v1/photos/' + id), {
        headers: { Authorization: pexelsApiKey },
      });
      if (!response.ok) {
        log.error('获取已保存壁纸(ID: ' + id + ')失败，状态: ' + response.status + '。将移除该ID。');
        removeSavedWallpaperKeys();
        return false;
      }
      const photo = mapPexelsPhoto(await response.json());
      void applyPexelsWallpaper(photo, true);
      log.log('成功加载并缓存壁纸 (ID: ' + id + ')');
      return true;
    } catch (error) {
      log.error('获取已保存壁纸时网络错误:', error);
      return false;
    }
  }

  /**
   * 「换一张」：有 Key 走 Pexels 随机；图源为 wallhaven 时走 Wallhaven 随机
   * （不论有无 Key，与 legacy 一致）；兜底 Picsum 随机。失败逐级回落。
   */
  async function fetchRandomWallpaper(shouldSave = false): Promise<void> {
    const randomQuery = RANDOM_QUERIES[Math.floor(Math.random() * RANDOM_QUERIES.length)];

    // 1) Pexels：随机查询词 + 随机页取第一张
    if (pexelsApiKey) {
      const page = Math.floor(Math.random() * 100) + 1;
      try {
        const data = await fetchJSON<{ photos?: unknown[] }>(
          'https://api.pexels.com/v1/search?query=' +
            encodeURIComponent(randomQuery) +
            '&orientation=landscape&per_page=1&page=' +
            page,
          { headers: { Authorization: pexelsApiKey } }
        );
        if (data.photos && data.photos.length > 0) {
          void applyPexelsWallpaper(mapPexelsPhoto(data.photos[0]), shouldSave);
          return;
        }
      } catch (error) {
        const status = (error as FetchJSONError).status;
        if (status === 401) {
          log.error('Pexels API 密钥无效或已过期。');
          if (onAuthError) onAuthError();
        }
        log.error('Pexels 随机壁纸失败，回落 Picsum:', (error as Error).message);
      }
    }

    // 2) Wallhaven 图源（可选）随机
    if (wallpaperSource === 'wallhaven') {
      const result = await searchWallhaven(randomQuery, Math.floor(Math.random() * 20) + 1);
      if (result.photos && result.photos.length > 0) {
        const photo = result.photos[Math.floor(Math.random() * result.photos.length)];
        void applyPexelsWallpaper(photo, shouldSave);
        log.log('已应用 Wallhaven 随机壁纸 (ID: ' + photo.id + ')');
        return;
      }
      log.warn('Wallhaven 随机失败，回落 Picsum:', result.error || '无结果');
    }

    // 3) Picsum 随机（默认 / 回落）。legacy 的 HEAD 探测已删（纯负收益）。
    try {
      const randomSeed = Math.floor(Math.random() * 1e9);
      const wallpaperUrl = 'https://picsum.photos/seed/' + randomSeed + '/1920/1080';
      setWallpaper(wallpaperUrl);
      if (shouldSave) {
        await cacheWallpaper('pic_random_' + randomSeed, wallpaperUrl, 'Picsum', t('wallpaper_picsum_title'));
      }
      log.log('已应用 Picsum 随机壁纸: ' + wallpaperUrl);
    } catch (error) {
      log.error('随机壁纸获取失败，保留当前壁纸:', (error as Error).message);
    }
  }

  /** 应用壁纸：设置背景 + 可选写缓存（blob 预载走 setWallpaper → trackImageLoad）。 */
  async function applyPexelsWallpaper(photo: WallpaperPhoto, shouldSave = false): Promise<void> {
    const wallpaperUrl = photo.src.large2x;
    setWallpaper(wallpaperUrl);
    if (shouldSave) {
      await cacheWallpaper(photo.id, wallpaperUrl, photo.photographer, photo.alt);
      log.log('获取并已保存新的随机壁纸 (ID: ' + photo.id + ')');
    }
  }

  /** 壁纸缓存写入（统一入口）：useStored ref 写入即持久化。 */
  async function cacheWallpaper(id: string, url: string, photographer: string, alt: string): Promise<void> {
    // 换到网络壁纸时清掉旧本地烤图：dataURL 是 MB 级资产，URL 已对不上就永远读不到，纯占配额
    if (savedWallpaperUrl.value && savedWallpaperUrl.value !== url && savedWallpaperBlob.value) {
      savedWallpaperBlob.value = '';
      savedWallpaperBlobUrl.value = '';
    }
    savedWallpaperId.value = id;
    savedWallpaperUrl.value = url;
    savedWallpaperData.value = { id, url, photographer, alt };
  }

  /** 移除三键（Pic 记录异常 / Pexels ID 恢复失败）。ref 重置后 useStored 可能回写 ''，与 remove 等价。 */
  function removeSavedWallpaperKeys(): void {
    void chrome.storage.local.remove([
      'savedWallpaperId',
      'savedWallpaperUrl',
      'savedWallpaperData',
      'savedWallpaperBlob',
      'savedWallpaperBlobUrl',
    ]);
    savedWallpaperId.value = '';
    savedWallpaperUrl.value = '';
    savedWallpaperData.value = null;
  }

  // ---------- 本地图片壁纸（v2.1.1）：Bitmap 解码 → canvas 压缩 → 复用 savedWallpaperBlob 快路径 ----------

  /**
   * 入库上限：dataURL 字符数（≈ 二进制 ×1.37）。chrome.storage.local 单域 10MB，
   * 一张本地壁纸留一半预算；网络壁纸缓存（savedWallpaperData 元数据）很小，不受影响。
   */
  const LOCAL_WALLPAPER_MAX_CHARS = 5_000_000;
  /** 压缩阶梯：外层缩边、内层降质，任一档达标（≤ 上限）即用，避免一张图把配额吃穿。 */
  const LOCAL_MAX_SIDE_STEPS = [2560, 1600] as const;
  const LOCAL_QUALITY_STEPS = [0.85, 0.75, 0.6] as const;

  /** 解码用户文件：优先 createImageBitmap（不走 DOM 加载、自动释放），失败回退 Image + objectURL。 */
  async function decodeLocalImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(file);
      } catch {
        /* 大图或格式不支持时回退 */
      }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('图片解码失败'));
        img.src = url;
      });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** 按最大边缩放 + JPEG 编码；超限返回 null（让调用方降档重试）。 */
  function bakeLocalWallpaper(
    source: ImageBitmap | HTMLImageElement,
    maxSide: number,
    quality: number
  ): string | null {
    const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
    const w = Math.max(1, Math.round(source.width * scale));
    const h = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // 先铺白底：JPEG 没有透明通道，PNG/GIF 的透明像素不铺底会被编码成黑色
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return dataUrl.length <= LOCAL_WALLPAPER_MAX_CHARS ? dataUrl : null;
  }

  /** 释放解码产物（ImageBitmap 有关闭方法，img 交给 GC）。 */
  function disposeLocalImage(source: ImageBitmap | HTMLImageElement): void {
    if ('close' in source && typeof source.close === 'function') source.close();
  }

  /**
   * 本地图片上壁纸：压缩烤成 dataURL 后写进与网络壁纸同一套缓存键
   * （savedWallpaperBlob + BlobUrl 哨兵），重启走 fetchAndSetWallpaper 的 1a 快路径，零网络直出。
   */
  async function setLocalWallpaper(file: File): Promise<{ ok: boolean; message: string }> {
    if (!file.type.startsWith('image/')) return { ok: false, message: 'wallpaper_err_pick_image' };
    let source: ImageBitmap | HTMLImageElement | null = null;
    try {
      source = await decodeLocalImage(file);
      let baked: string | null = null;
      outer: for (const maxSide of LOCAL_MAX_SIDE_STEPS) {
        for (const quality of LOCAL_QUALITY_STEPS) {
          baked = bakeLocalWallpaper(source, maxSide, quality);
          if (baked) break outer;
        }
      }
      if (!baked) return { ok: false, message: 'wallpaper_err_too_large' };
      const added = await addToLocalLibrary(baked, file.name);
      const sentinel = added.id;
      savedWallpaperId.value = sentinel;
      savedWallpaperUrl.value = sentinel;
      savedWallpaperData.value = { id: sentinel, url: '', photographer: t('wallpaper_local_image'), alt: file.name };
      savedWallpaperBlob.value = baked;
      savedWallpaperBlobUrl.value = sentinel;
      setWallpaper(baked);
      return {
        ok: true,
        message: added.inLibrary
          ? t('wallpaper_toast_local_applied')
          : t('wallpaper_toast_local_applied_tmp'),
      };
    } catch (error) {
      log.error('本地壁纸处理失败:', error);
      return { ok: false, message: 'wallpaper_err_process_failed' };
    } finally {
      if (source) disposeLocalImage(source);
    }
  }

  /** 撤掉本地壁纸并回随机图（其余键交给 fetchRandomWallpaper 覆写）。 */
  async function clearLocalWallpaper(): Promise<void> {
    savedWallpaperBlob.value = '';
    savedWallpaperBlobUrl.value = '';
    await chrome.storage.local.remove(['savedWallpaperBlob', 'savedWallpaperBlobUrl']);
    await fetchRandomWallpaper(true);
  }

  // ---------- 本地壁纸库（可见、可应用、可删除；上限防吃满 10MB 配额） ----------

  const LOCAL_LIBRARY_KEY = 'localWallpapers';
  /** 库容量预算：单库 4 张、总量 6M 字符，保证 savedWallpaperBlob(≤5M) + 库 ≤ chrome.storage 10MB。 */
  const LOCAL_LIBRARY_MAX_TOTAL_CHARS = 6_000_000;
  const LOCAL_LIBRARY_ENTRY_MAX_CHARS = 4_000_000;

  const localLibrary = ref<LocalWallpaperEntry[]>([]);

  async function readLocalLibrary(): Promise<LocalWallpaperEntry[]> {
    try {
      const stored = await chrome.storage.local.get([LOCAL_LIBRARY_KEY]);
      const raw = stored[LOCAL_LIBRARY_KEY];
      if (!Array.isArray(raw)) return [];
      return raw.filter(
        (item): item is LocalWallpaperEntry =>
          !!item &&
          typeof (item as LocalWallpaperEntry).id === 'string' &&
          typeof (item as LocalWallpaperEntry).dataUrl === 'string'
      );
    } catch (error) {
      log.warn('[壁纸] 本地库读取失败:', (error as Error).message);
      return [];
    }
  }

  async function writeLocalLibrary(list: LocalWallpaperEntry[]): Promise<void> {
    localLibrary.value = list;
    try {
      await chrome.storage.local.set({ [LOCAL_LIBRARY_KEY]: list });
    } catch (error) {
      // 超配额：库里最老的一张逐个放弃，直到写得进去；库瘦身不撤当前壁纸
      log.warn('[壁纸] 本地库写入失败，尝试瘦身:', (error as Error).message);
      const trimmed = [...list];
      while (trimmed.length > 0) {
        trimmed.shift();
        try {
          await chrome.storage.local.set({ [LOCAL_LIBRARY_KEY]: trimmed });
          localLibrary.value = trimmed;
          return;
        } catch {
          continue;
        }
      }
    }
  }

  /** 把一张压缩后的 dataUrl 收进库：超预算按加入时间淘汰最老的。 */
  async function addToLocalLibrary(dataUrl: string, name: string): Promise<{ id: string; inLibrary: boolean }> {
    const list = await readLocalLibrary();
    const existing = list.find((item) => item.dataUrl === dataUrl);
    if (existing) return { id: existing.id, inLibrary: true }; // 同一张图重复上传不重复入库
    const entry: LocalWallpaperEntry = {
      id: 'local:' + Date.now(),
      dataUrl,
      name: name || t('wallpaper_local_image'),
      addedAt: Date.now(),
    };
    if (dataUrl.length > LOCAL_LIBRARY_ENTRY_MAX_CHARS) return { id: entry.id, inLibrary: false }; // 超限不入库，仅当当前壁纸
    list.push(entry);
    // 容量预算：先按张数、再按总字符，淘汰最老的（正在使用的哨兵不在库里也安全）
    while (list.length > LOCAL_LIBRARY_MAX_ENTRIES) list.shift();
    let total = list.reduce((sum, item) => sum + item.dataUrl.length, 0);
    while (total > LOCAL_LIBRARY_MAX_TOTAL_CHARS && list.length > 1) {
      total -= list[0].dataUrl.length;
      list.shift();
    }
    await writeLocalLibrary(list);
    return { id: entry.id, inLibrary: true };
  }

  /** 面板打开/启动时刷新库列表（ storage onChanged 不订阅，读时拉平）。 */
  async function refreshLocalLibrary(): Promise<void> {
    localLibrary.value = await readLocalLibrary();
  }

  /** 从库里应用：写齐五键（哨兵=条目 id）并直出，下次启动走 1a 快路径。 */
  async function applyLocalWallpaper(entryId: string): Promise<void> {
    const entry = localLibrary.value.find((item) => item.id === entryId) ?? (await readLocalLibrary()).find((item) => item.id === entryId);
    if (!entry) return;
    savedWallpaperId.value = entry.id;
    savedWallpaperUrl.value = entry.id;
    savedWallpaperData.value = { id: entry.id, url: '', photographer: t('wallpaper_local_image'), alt: entry.name };
    savedWallpaperBlob.value = entry.dataUrl;
    savedWallpaperBlobUrl.value = entry.id;
    setWallpaper(entry.dataUrl);
  }

  /** 删除库条目；删的正是当前壁纸时回随机图。 */
  async function removeLocalWallpaper(entryId: string): Promise<void> {
    const list = await readLocalLibrary();
    const next = list.filter((item) => item.id !== entryId);
    await writeLocalLibrary(next);
    if (savedWallpaperId.value === entryId || savedWallpaperBlobUrl.value === entryId) {
      await clearLocalWallpaper();
    }
  }

  // ---------- 壁纸亮度分档（决定蒙版厚度） ----------

  /**
   * 壁纸亮度分档写进 <html data-wallpaper-tone>，由 app.css 决定蒙版加多厚。
   * 反向组合才需要加码：亮壁纸配深色主题（白字）、暗壁纸配浅色主题（墨字），
   * 11px 的站点名会掉到 3:1 以下；同向组合默认值已经够。
   */
  /**
   * 把分档结果写进 <html>：data-wallpaper-tone 控制蒙版厚度，
   * data-photo-ink 控制浮字字色（bright 壁纸用墨字、dark 壁纸用白字、其余跟随主题）。
   * 两个属性成对写入、成对清除，避免只翻一半导致「白字落在白壁纸」上。
   */
  function applyWallpaperTone(tone: WallpaperTone | null): void {
    const root = document.documentElement;
    if (tone) root.dataset.wallpaperTone = tone;
    else delete root.dataset.wallpaperTone;
    const ink = onPhotoInkForTone(tone);
    if (ink) root.dataset.photoInk = ink;
    else delete root.dataset.photoInk;
  }

  /** 从已解码的源图缩到 16×16 采样平均亮度；跨域图污染画布时抛错，返回 null 表示量不出。 */
  function sampleTone(source: CanvasImageSource): WallpaperTone | null {
    const size = 16;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    try {
      ctx.drawImage(source, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      const avg = sum / (data.length / 4);
      return toneFromLuminance(avg);
    } catch {
      // SecurityError：图床没给 CORS 头，读不到像素。放弃分档，蒙版退回默认值。
      return null;
    }
  }

  /**
   * 量一下当前壁纸有多亮。读不到像素就清掉标记走默认值 —— 不阻塞壁纸显示，
   * 也不假装量过（跨域无 CORS 的图床在扩展里确实拿不到像素）。
   */
  function measureWallpaperTone(imageUrl: string): void {
    if (!imageUrl || typeof Image === 'undefined') return;
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = () => applyWallpaperTone(sampleTone(probe));
    probe.onerror = () => applyWallpaperTone(null);
    probe.src = imageUrl;
  }

  /** 设置壁纸背景 + 玻璃场景同步 + 加载追踪。 */
  function setWallpaper(imageUrl: string): void {
    const container = document.getElementById('wallpaper');
    if (!container) return;
    // 壁纸地址可能来自备份导入：只接受 http(s) / data:image / 扩展内相对路径，
    // 否则不给 background-image 赋值（非法协议会变成远程探测或注入面）
    if (!isImageSource(imageUrl)) {
      log.warn('[壁纸] 地址协议不受支持，已忽略:', imageUrl);
      return;
    }
    container.style.backgroundImage = "url('" + imageUrl + "')";
    // 液态玻璃光学层采样壁纸做折射，换壁纸时同步刷新场景纹理。
    // Vue 侧不持有 liquidGlass 实例，直接走 lib/glass 的场景同步（不支持时静默）。
    if (imageUrl) syncGlassScene(imageUrl);
    trackImageLoad(imageUrl);
    measureWallpaperTone(imageUrl);
  }

  /**
   * 预热并追踪壁纸是否解码成功；成功后把原图烤成 dataURL 存进 storage。
   * 用 Image 走浏览器缓存：这里成功的话 background-image 命中缓存直接出图。
   */
  function trackImageLoad(imageUrl: string): void {
    if (!imageUrl || typeof Image === 'undefined') return;
    // dataURL 已经在本地了，没必要再转存一遍
    if (imageUrl.startsWith('data:')) return;
    const probe = new Image();
    probe.decoding = 'async';
    probe.crossOrigin = 'anonymous';
    probe.onload = () => void storeWallpaperBlob(imageUrl);
    probe.onerror = () => log.warn('[壁纸] 图片加载失败:', imageUrl);
    probe.src = imageUrl;
  }

  /**
   * 原图转存 dataURL。用 fetch 拿原始字节而非 canvas.toDataURL：
   * 部分图床 302 跳 CDN 时画布会被污染。失败放弃缓存，壁纸照常显示。
   */
  async function storeWallpaperBlob(imageUrl: string): Promise<void> {
    try {
      const response = await fetch(resolveFetchUrl(imageUrl), { credentials: 'omit', cache: 'force-cache' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const contentType = response.headers.get('content-type') || '';
      if (!/^image\//i.test(contentType)) throw new Error('响应不是图片: ' + contentType);
      const blob = await response.blob();
      if (blob.size > BLOB_MAX_BYTES) {
        log.log('[壁纸] 原图 ' + Math.round(blob.size / 1024) + 'KB 超过缓存上限，跳过');
        return;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('读取失败'));
        reader.readAsDataURL(blob);
      });
      if (!dataUrl) return;
      savedWallpaperBlob.value = dataUrl;
      savedWallpaperBlobUrl.value = imageUrl; // 记录来源，用于判断缓存是否还对应当前壁纸
      log.log('[壁纸] 已缓存到本地（' + Math.round(dataUrl.length / 1024) + 'KB，原样字节），下次零请求');
    } catch (error) {
      // 无 host_permissions / 网络失败 / 超配额 —— 放弃缓存，壁纸照常显示
      log.warn('[壁纸] 本地缓存生成失败:', (error as Error).message);
    }
  }

  // ---------- Pexels 搜索数据层 ----------

  /**
   * 壁纸搜索（仅数据层，渲染由 WallpaperPanel 完成）。
   * 双源：有 Pexels Key 走 Pexels；无 Key 按设置走 Picsum（默认）或 Wallhaven（可选）。
   * 无 Key 且 Picsum 图源时：有分类词先试 Wallhaven（真支持关键词），不可达回落
   * Picsum 浏览并标记 categorySupported=false，绝不假装筛过。
   */
  async function searchPhotos(query: string, page = 1): Promise<WallpaperSearchResult> {
    // 与 legacy 差异：legacy 仅启动时同步一次密钥；这里每次搜索前同步（30s TTL），
    // 设置面板改 Key/图源后 30s 内对搜索生效，无需重开标签页。
    await syncApiKey();

    if (!pexelsApiKey) {
      const q = (query || '').trim();

      if (q && wallpaperSource === 'picsum') {
        const wallhaven = await searchWallhaven(q, page);
        if (wallhaven.photos && wallhaven.photos.length > 0) {
          return { ...wallhaven, categorySupported: true };
        }
        const browsing = await searchPicsum(page);
        return { ...browsing, categorySupported: false, requestedCategory: q };
      }

      // 走到这里说明要么没分类词（纯浏览），要么图源已是 wallhaven
      const result =
        wallpaperSource === 'wallhaven' ? await searchWallhaven(query, page) : await searchPicsum(page);
      const categorySupported = wallpaperSource === 'wallhaven' || !q;
      if (!q && wallpaperSource !== 'wallhaven') {
        result.source = 'picsum';
      }
      return { ...result, categorySupported };
    }

    try {
      const data = await fetchJSON<{ photos?: unknown[]; total_results?: number }>(
        'https://api.pexels.com/v1/search?query=' +
          encodeURIComponent(query) +
          '&per_page=' +
          WALLPAPERS_PER_PAGE +
          '&page=' +
          page +
          '&orientation=landscape',
        { headers: { Authorization: pexelsApiKey } }
      );
      const list = data.photos || [];
      const resultPhotos = list.map(mapPexelsPhoto);
      currentQuery.value = query;
      currentPage.value = page;
      totalWallpapers.value = data.total_results ?? resultPhotos.length;
      totalPages.value = Math.max(1, Math.ceil(totalWallpapers.value / WALLPAPERS_PER_PAGE));
      return {
        photos: resultPhotos,
        totalPages: totalPages.value,
        total: totalWallpapers.value,
        unauthorized: false,
        source: 'pexels',
      };
    } catch (error) {
      const status = (error as FetchJSONError).status;
      if (status === 401 && onAuthError) {
        log.error('Pexels API 密钥无效或已过期。');
        onAuthError();
      }
      log.error('搜索壁纸失败:', (error as Error).message);
      // 与 legacy 一致：Pexels 失败返回不带 error 字段，UI toast 落默认文案
      return { photos: null, totalPages: 1, total: 0, unauthorized: false, source: 'pexels' };
    }
  }

  /** Picsum Photos 免 Key 图库浏览：纯按页码浏览，60 页回绕，12s 超时。 */
  async function searchPicsum(page = 1): Promise<WallpaperSearchResult> {
    const realPage = ((page - 1) % PICSUM_TOTAL_PAGES) + 1;
    try {
      const list = await fetchJSON<Array<{ id?: unknown; author?: unknown }>>(
        'https://picsum.photos/v2/list?page=' + realPage + '&limit=' + WALLPAPERS_PER_PAGE,
        { timeout: 12000 }
      );
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error('Picsum 返回空列表');
      }
      currentPage.value = page;
      totalWallpapers.value = PICSUM_TOTAL_PAGES * WALLPAPERS_PER_PAGE;
      totalPages.value = PICSUM_TOTAL_PAGES;
      const photos = list.map(mapPicsumPhoto);
      return {
        photos,
        totalPages: totalPages.value,
        total: totalWallpapers.value,
        unauthorized: false,
        source: 'picsum',
      };
    } catch (error) {
      log.error('Picsum 图库加载失败:', error);
      return {
        photos: null,
        totalPages: 1,
        total: 0,
        unauthorized: false,
        source: 'picsum',
        error: (error as Error).message || t('wallpaper_gallery_failed'),
      };
    }
  }

  /** Wallhaven 免 Key 搜索：general + SFW（purity=100），横屏 1920x1080 起。 */
  async function searchWallhaven(query: string, page = 1): Promise<WallpaperSearchResult> {
    const q = (query || '').trim();
    const params = new URLSearchParams({
      categories: '100',
      purity: '100',
      atleast: '1920x1080',
      per_page: String(WALLPAPERS_PER_PAGE),
      page: String(page),
    });
    if (q) {
      params.set('q', q);
      params.set('sorting', 'relevance');
    } else {
      params.set('sorting', 'toplist');
      params.set('topRange', '1M');
    }
    try {
      const data = await fetchJSON<WallhavenResponse>(
        'https://wallhaven.cc/api/v1/search?' + params.toString(),
        { timeout: 12000 }
      );
      const items = (data.data || []).map(mapWallhavenPhoto);
      currentQuery.value = q || currentQuery.value;
      currentPage.value = page;
      totalWallpapers.value = data.meta?.total ?? items.length;
      totalPages.value = Math.max(1, data.meta?.last_page ?? 1);
      return {
        photos: items,
        totalPages: totalPages.value,
        total: totalWallpapers.value,
        unauthorized: false,
        source: 'wallhaven',
      };
    } catch (error) {
      // 429 等具体原因对用户无操作价值，统一吞成同一条提示（与 legacy 一致）
      log.error('Wallhaven 搜索失败:', error);
      return {
        photos: null,
        totalPages: 1,
        total: 0,
        unauthorized: false,
        source: 'wallhaven',
        error: t('wallpaper_wallhaven_unreachable'),
      };
    }
  }

  // ---------- 三源归一映射 ----------

  /** Pexels 原始对象 → WallpaperPhoto（字段缺失兜底，类型硬化）。 */
  function mapPexelsPhoto(raw: unknown): WallpaperPhoto {
    const item = (raw || {}) as Record<string, unknown>;
    const src = (item.src || {}) as Record<string, unknown>;
    const pick = (value: unknown): string => String(value ?? '');
    return {
      id: pick(item.id),
      photographer: pick(item.photographer),
      alt: pick(item.alt),
      avg_color: pick(item.avg_color) || '#4EC2C6',
      width: Number(item.width ?? 1920),
      height: Number(item.height ?? 1080),
      src: {
        original: pick(src.original),
        large2x: pick(src.large2x),
        landscape: pick(src.landscape),
        large: pick(src.large),
        medium: pick(src.medium),
        small: pick(src.small),
        tiny: pick(src.tiny),
      },
    };
  }

  /** Picsum v2/list 条目 → WallpaperPhoto（渲染层网格用 medium，应用壁纸用 large2x/original）。 */
  function mapPicsumPhoto(item: { id?: unknown; author?: unknown }): WallpaperPhoto {
    const id = String(item.id ?? '');
    const author = String(item.author ?? '') || 'Picsum';
    return {
      id: 'pic_' + id,
      photographer: author,
      alt: t('wallpaper_photo_by', { author }),
      avg_color: '#4EC2C6',
      width: 1920,
      height: 1080,
      src: {
        original: 'https://picsum.photos/id/' + id + '/1920/1080',
        large2x: 'https://picsum.photos/id/' + id + '/1920/1080',
        landscape: 'https://picsum.photos/id/' + id + '/1920/1080',
        large: 'https://picsum.photos/id/' + id + '/1280/720',
        medium: 'https://picsum.photos/id/' + id + '/640/360',
        small: 'https://picsum.photos/id/' + id + '/320/180',
        tiny: 'https://picsum.photos/id/' + id + '/160/90',
      },
    };
  }

  /** Wallhaven 条目 → WallpaperPhoto。 */
  function mapWallhavenPhoto(item: NonNullable<WallhavenResponse['data']>[number]): WallpaperPhoto {
    const path = item.path || '';
    const thumbs = item.thumbs || {};
    return {
      id: 'wh_' + String(item.id ?? ''),
      photographer: 'Wallhaven',
      alt: t('wallpaper_alt_wallhaven', { res: item.resolution || '' }).trim(),
      avg_color: (item.colors && item.colors[0]) || '#4EC2C6',
      width: Number(item.dimension_x ?? 1920),
      height: Number(item.dimension_y ?? 1080),
      src: {
        original: path,
        large2x: path,
        landscape: path,
        large: thumbs.original || path,
        medium: thumbs.large || path,
        small: thumbs.small || path,
        tiny: thumbs.small || path,
      },
    };
  }

  // ================= UI 层（v1.8.1:js/app.js 壁纸段） =================

  /** legacy getPaginationRange：delta=2 窗口 + 首尾页 + 省略号；[...new Set] 去重的强类型等价物。 */
  function getPaginationRange(current: number, total: number): PaginationItem[] {
    const delta = 2;
    const range: number[] = [];
    for (let i = Math.max(2, current - delta); i <= Math.min(total - 1, current + delta); i++) {
      range.push(i);
    }
    const items: PaginationItem[] = [];
    if (current - delta > 2) items.push({ type: 'ellipsis', value: 0 });
    for (const i of range) items.push({ type: 'page', value: i });
    if (current + delta < total - 1) items.push({ type: 'ellipsis', value: 0 });
    items.unshift({ type: 'page', value: 1 });
    if (total > 1) items.push({ type: 'page', value: total });
    // legacy 用 Set 对混合数组去重：两个 '...' 只保留一个，页码去重，顺序不变
    const seen = new Set<string>();
    const result: PaginationItem[] = [];
    for (const item of items) {
      const key = item.type === 'page' ? String(item.value) : '...';
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  /**
   * legacy searchWallpapers（v1.8.1:js/app.js:663-729 等价物）：
   * 分类高亮 → loading + 清空网格 → searchPhotos → 空态/降级提示 → 渲染。
   */
  async function searchWallpapers(
    query: string,
    page = 1,
    options: { skipCategoryHighlight?: boolean } = {}
  ): Promise<void> {
    if (options.skipCategoryHighlight !== true) {
      const matched = CATEGORIES.find((category) => category.query === query);
      if (matched) {
        activeCategory.value = query;
        lastActiveCategoryQuery.value = query;
      } else {
        activeCategory.value = '';
      }
    }
    isSearching.value = true;
    photos.value = [];
    loadFailed.value = false;
    try {
      const result = await searchPhotos(query, page);
      if (result.photos === null) {
        loadFailed.value = true;
        showToast(result.error || t('wallpaper_load_failed'), 'error', 4000);
        return;
      }
      if (result.categorySupported === false && result.requestedCategory) {
        // 分类降级的解释统一由面板内 .wallpaper-category-hint 常驻展示（评审 S6）：
        // 这里不再弹短命 toast，避免和面板内提示重复、又飘在标题/搜索框上方遮挡主操作。
        categoryUnsupported.value = true;
      } else {
        categoryUnsupported.value = false;
      }
      photos.value = result.photos;
    } finally {
      isSearching.value = false;
    }
  }

  /** 搜索按钮 / 搜索框 Enter：query = trim(input)，空则沿用最近分类词。 */
  async function handleSearch(): Promise<void> {
    const query = wallpaperSearchQuery.value.trim();
    await searchWallpapers(query || lastActiveCategoryQuery.value, 1);
  }

  /** 分类点击：清空搜索框后按分类词搜索（legacy renderWallpaperCategories 的 li onclick）。 */
  async function handleCategoryClick(category: { nameKey: string; query: string }): Promise<void> {
    wallpaperSearchQuery.value = '';
    await searchWallpapers(category.query, 1);
  }

  /** 页码/上一页/下一页：以 currentQuery 续搜，跳过分类高亮（legacy goToPage）。 */
  async function goToPage(page: number): Promise<void> {
    await searchWallpapers(currentQuery.value, page, { skipCategoryHighlight: true });
  }

  /**
   * 跳页输入 Enter（legacy L1508-1523 等价物）：parseInt 后仅判数值范围，
   * 合法 → 续搜 + 清空 + blur（清空/blur 由组件做）；非法 → 默认 info toast。
   */
  async function handleJumpSubmit(raw: string): Promise<boolean> {
    const page = parseInt(raw, 10);
    if (!(page >= 1 && page <= totalPages.value)) {
      showToast(t('wallpaper_page_range', { max: totalPages.value }));
      return false;
    }
    await goToPage(page);
    return true;
  }

  /**
   * legacy closeWallpaperPanel（v1.8.1:js/app.js:647-662 等价物）：
   * 面板隐藏（usePanels）→ 清搜索框 → currentQuery 不是分类词时回落最近分类搜索。
   */
  function closeWallpaperPanel(): void {
    close('wallpaper');
    wallpaperSearchQuery.value = '';
    const isCategory = CATEGORIES.some((category) => category.query === currentQuery.value);
    if (!isCategory) {
      void searchWallpapers(lastActiveCategoryQuery.value, 1);
    }
  }

  /** Pexels 401 回调注入（legacy v1.8.1:js/app.js:123 onAuthError = () => openSettingsPanel()）。 */
  function setAuthErrorHandler(handler: AuthErrorHandler): void {
    onAuthError = handler;
  }

  // ---------- 计算属性（legacy updatePagination 的响应式等价物） ----------

  const paginationItems = computed<PaginationItem[]>(() =>
    getPaginationRange(currentPage.value, totalPages.value)
  );

  const totalResultsInfo = computed<string>(() => {
    const max = totalPages.value * WALLPAPERS_PER_PAGE;
    const shownTotal =
      totalWallpapers.value > max ? '~' + max : String(totalWallpapers.value);
    return t('wallpaper_total_info', { pages: totalPages.value, total: shownTotal });
  });

  return {
    fetchAndSetWallpaper,
    fetchRandomWallpaper,
    setLocalWallpaper,
    clearLocalWallpaper,
    savedWallpaperId,
    localLibrary,
    refreshLocalLibrary,
    applyLocalWallpaper,
    removeLocalWallpaper,
    applyPexelsWallpaper,
    searchPhotos,
    photos,
    isSearching,
    loadFailed,
    categoryUnsupported,
    activeCategory,
    wallpaperSearchQuery,
    currentQuery,
    currentPage,
    totalPages,
    totalWallpapers,
    paginationItems,
    totalResultsInfo,
    searchWallpapers,
    handleSearch,
    handleCategoryClick,
    goToPage,
    handleJumpSubmit,
    closeWallpaperPanel,
    setAuthErrorHandler,
    // open 仅组件的 onAuthError 注入（open('settings')）需要
    open,
  };
}

let singleton: WallpaperApi | null = null;

/**
 * 壁纸域唯一入口（单例）。面板与主页共享同一份响应式状态；
 * 存储契约见文件头/尾注释。
 */
export function useWallpaper(): WallpaperApi {
  if (!singleton) singleton = createWallpaperApi();
  return singleton;
}

/**
 * ---------- 存储契约（与 legacy 逐键兼容） ----------
 * settings 对象（只读）：pexelsApiKey(string)、wallpaperSource('picsum'|'wallhaven')；
 *   wallpaperBrightness/wallpaperBlur 归设置域，壁纸域不读写。
 * savedWallpaperId(string)：当前壁纸 ID。Pexels 为纯数字 ID；Picsum 为 pic_ 前缀；
 *   Wallhaven 为 wh_ 前缀；Picsum 随机为 pic_random_<seed>。
 * savedWallpaperUrl(string)：应用中的壁纸 URL（large2x / seed URL / dataURL）。
 * savedWallpaperData({id,url,photographer,alt}|null)：壁纸元信息（备份管理器覆盖三键）。
 * savedWallpaperBlob(string)：dataURL 本地缓存（≤3.6MB，原样字节）。
 * savedWallpaperBlobUrl(string)：blob 的来源 URL，与 savedWallpaperUrl 一致才视为有效缓存。
 *
 * ---------- 与 legacy 的差异 ----------
 * 1. liquidGlass.setScene → syncGlassScene（lib/glass 场景同步，不支持时静默）。
 * 2. 401 回调 onAuthError 由组件 onMounted 注入 open('settings')；legacy 为
 *    openSettingsPanel() 且回显 Key/天气输入——Vue 设置面板自持表单状态（回显降级）。
 * 3. searchPhotos 每次搜索前 syncApiKey()（30s TTL）：legacy 仅启动同步一次，
 *    改 Key 后要重开标签页才生效；Vue 侧 30s 内生效（行为修正）。
 * 4. Pexels total_results 缺失时回落 photos.length（legacy 会算出 NaN，类型硬化）。
 * 5. 错误 message 统一为 fetchJSON 的 'HTTP <status>'（legacy 为各源自定义文案），
 *    console 语义不变；Wallhaven 失败提示文案逐字保留。
 * 6. legacy getCategories/setCurrentCategory/getCurrentState 无 UI 消费者，未移植
 *    （状态即响应式 ref，组件直接读）。
 * 7. 仍保留少量按 id 更新静态 DOM 样式的代码（#wallpaper 的 backgroundImage /
 *    filter）：壁纸层是 useWallpaper 直接持有的 viewport 背景节点，不属于组件模板。
 * 8. remove 三键 = chrome.storage.local.remove + ref 重置；useStored 异步回写 ''
 *    与 remove 等价（所有读路径均为真值判断）。
 */
