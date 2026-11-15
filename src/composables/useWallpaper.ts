/**
 * 壁纸域唯一数据入口（单例 composable，useTodo 同范式）。
 *
 * 移植来源：
 *  - 数据层：public/legacy-js/modules/wallpaper-manager.js（660 行）
 *  - UI 层：public/legacy-js/app.js 壁纸段（L195-304 分类/事件绑定，
 *    L1435-1723 open/close/search/renderGrid/pagination）
 *
 * 存储契约与 legacy 逐键兼容（见文末「存储契约」）；
 * 方法级差异与修正集中在文末「与 legacy 的差异」。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { usePanels, type PanelId } from '@/src/composables/usePanels';
import { useStored } from '@/src/lib/storage';
import { fetchJSON, resolveFetchUrl, type FetchJSONError } from '@/src/lib/http';
import { syncGlassScene } from '@/src/lib/glass';
import { isImageSource } from '@/src/lib/urlSafe';
import { toast as showToast } from '@/src/composables/useToast';

/** 每页壁纸数量（legacy WallpaperManager.WALLPAPERS_PER_PAGE，供分页计算引用）。 */
export const WALLPAPERS_PER_PAGE = 18;
/** 本地 blob 缓存上限 3.6MB：dataURL 比原图大约 33%，约等于 2.7MB 原图（storage.local 默认 10MB）。 */
export const BLOB_MAX_BYTES = 3.6 * 1024 * 1024;
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
  { name: '自然', query: 'Nature' },
  { name: '城市', query: 'Cityscape' },
  { name: '科技', query: 'Technology' },
  { name: '抽象', query: 'Abstract' },
  { name: '海洋', query: 'Ocean' },
  { name: '森林', query: 'Forest' },
  { name: '山脉', query: 'Mountains' },
  { name: '天空', query: 'Sky' },
  { name: '动物', query: 'Animals' },
  { name: '食物', query: 'Food' },
  { name: '运动', query: 'Sports' },
  { name: '旅行', query: 'Travel' },
] as const;

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

interface WallpaperApi {
  // 数据层（wallpaper-manager.js 对应物）
  fetchAndSetWallpaper(): Promise<void>;
  fetchRandomWallpaper(shouldSave?: boolean): Promise<void>;
  applyPexelsWallpaper(photo: WallpaperPhoto, shouldSave?: boolean): Promise<void>;
  searchPhotos(query: string, page?: number): Promise<WallpaperSearchResult>;
  // UI 状态（app.js 壁纸段对应物，全部响应式）
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
  // UI 行为（app.js 壁纸段对应物）
  searchWallpapers(
    query: string,
    page?: number,
    options?: { skipCategoryHighlight?: boolean }
  ): Promise<void>;
  handleSearch(): Promise<void>;
  handleCategoryClick(category: { name: string; query: string }): Promise<void>;
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

  // ---------- UI 层状态（legacy app.js 壁纸段变量 / DOM 类） ----------
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
  /** legacy app.js:54 初始 'Nature'。 */
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
      console.error('同步壁纸密钥失败:', error);
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
      console.log('[壁纸] 命中本地缓存，零请求');
      return;
    }

    // 1b. 有缓存 URL：直接用；Pexels 来源异步校验 ID，失效才换新。
    if (result.savedWallpaperUrl) {
      setWallpaper(result.savedWallpaperUrl);
      console.log('使用缓存的壁纸URL');

      const savedId = String(result.savedWallpaperId || '');
      // Picsum/Wallhaven 图床链接长期有效无需验证；仅 Pexels 来源需要验证
      const isPexelsWallpaper =
        savedId.length > 0 && !savedId.startsWith('pic_') && !savedId.startsWith('wh_');
      if (isPexelsWallpaper && pexelsApiKey) {
        setTimeout(() => {
          void (async () => {
            const isValid = await validateWallpaperById(savedId);
            if (!isValid) {
              console.log('缓存的壁纸已失效，获取新壁纸');
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
      console.error('验证壁纸时网络错误:', error);
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
        console.error('获取已保存壁纸(ID: ' + id + ')失败，状态: ' + response.status + '。将移除该ID。');
        removeSavedWallpaperKeys();
        return false;
      }
      const photo = mapPexelsPhoto(await response.json());
      void applyPexelsWallpaper(photo, true);
      console.log('成功加载并缓存壁纸 (ID: ' + id + ')');
      return true;
    } catch (error) {
      console.error('获取已保存壁纸时网络错误:', error);
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
          console.error('Pexels API 密钥无效或已过期。');
          if (onAuthError) onAuthError();
        }
        console.error('Pexels 随机壁纸失败，回落 Picsum:', (error as Error).message);
      }
    }

    // 2) Wallhaven 图源（可选）随机
    if (wallpaperSource === 'wallhaven') {
      const result = await searchWallhaven(randomQuery, Math.floor(Math.random() * 20) + 1);
      if (result.photos && result.photos.length > 0) {
        const photo = result.photos[Math.floor(Math.random() * result.photos.length)];
        void applyPexelsWallpaper(photo, shouldSave);
        console.log('已应用 Wallhaven 随机壁纸 (ID: ' + photo.id + ')');
        return;
      }
      console.warn('Wallhaven 随机失败，回落 Picsum:', result.error || '无结果');
    }

    // 3) Picsum 随机（默认 / 回落）。legacy 的 HEAD 探测已删（纯负收益）。
    try {
      const randomSeed = Math.floor(Math.random() * 1e9);
      const wallpaperUrl = 'https://picsum.photos/seed/' + randomSeed + '/1920/1080';
      setWallpaper(wallpaperUrl);
      if (shouldSave) {
        await cacheWallpaper('pic_random_' + randomSeed, wallpaperUrl, 'Picsum', '随机精选摄影');
      }
      console.log('已应用 Picsum 随机壁纸: ' + wallpaperUrl);
    } catch (error) {
      console.error('随机壁纸获取失败，保留当前壁纸:', (error as Error).message);
    }
  }

  /** 应用壁纸：设置背景 + 可选写缓存（blob 预载走 setWallpaper → trackImageLoad）。 */
  async function applyPexelsWallpaper(photo: WallpaperPhoto, shouldSave = false): Promise<void> {
    const wallpaperUrl = photo.src.large2x;
    setWallpaper(wallpaperUrl);
    if (shouldSave) {
      await cacheWallpaper(photo.id, wallpaperUrl, photo.photographer, photo.alt);
      console.log('获取并已保存新的随机壁纸 (ID: ' + photo.id + ')');
    }
  }

  /** 壁纸缓存写入（统一入口）：useStored ref 写入即持久化。 */
  async function cacheWallpaper(id: string, url: string, photographer: string, alt: string): Promise<void> {
    savedWallpaperId.value = id;
    savedWallpaperUrl.value = url;
    savedWallpaperData.value = { id, url, photographer, alt };
  }

  /** 移除三键（Pic 记录异常 / Pexels ID 恢复失败）。ref 重置后 useStored 可能回写 ''，与 remove 等价。 */
  function removeSavedWallpaperKeys(): void {
    void chrome.storage.local.remove(['savedWallpaperId', 'savedWallpaperUrl', 'savedWallpaperData']);
    savedWallpaperId.value = '';
    savedWallpaperUrl.value = '';
    savedWallpaperData.value = null;
  }

  /** 设置壁纸背景 + 玻璃场景同步 + 加载追踪。 */
  function setWallpaper(imageUrl: string): void {
    const container = document.getElementById('wallpaper');
    if (!container) return;
    // 壁纸地址可能来自备份导入：只接受 http(s) / data:image / 扩展内相对路径，
    // 否则不给 background-image 赋值（非法协议会变成远程探测或注入面）
    if (!isImageSource(imageUrl)) {
      console.warn('[壁纸] 地址协议不受支持，已忽略:', imageUrl);
      return;
    }
    container.style.backgroundImage = "url('" + imageUrl + "')";
    // 液态玻璃光学层采样壁纸做折射，换壁纸时同步刷新场景纹理。
    // Vue 侧不持有 liquidGlass 实例，直接走 lib/glass 的场景同步（不支持时静默）。
    if (imageUrl) syncGlassScene(imageUrl);
    trackImageLoad(imageUrl);
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
    probe.onerror = () => console.warn('[壁纸] 图片加载失败:', imageUrl);
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
        console.log('[壁纸] 原图 ' + Math.round(blob.size / 1024) + 'KB 超过缓存上限，跳过');
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
      console.log('[壁纸] 已缓存到本地（' + Math.round(dataUrl.length / 1024) + 'KB，原样字节），下次零请求');
    } catch (error) {
      // 无 host_permissions / 网络失败 / 超配额 —— 放弃缓存，壁纸照常显示
      console.warn('[壁纸] 本地缓存生成失败:', (error as Error).message);
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
        console.error('Pexels API 密钥无效或已过期。');
        onAuthError();
      }
      console.error('搜索壁纸失败:', (error as Error).message);
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
      console.error('Picsum 图库加载失败:', error);
      return {
        photos: null,
        totalPages: 1,
        total: 0,
        unauthorized: false,
        source: 'picsum',
        error: (error as Error).message || '图库加载失败',
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
      console.error('Wallhaven 搜索失败:', error);
      return {
        photos: null,
        totalPages: 1,
        total: 0,
        unauthorized: false,
        source: 'wallhaven',
        error: 'Wallhaven 不可访问。该图源需要能访问境外网络，可在设置中切回 Picsum。',
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
      alt: author + ' 摄影作品',
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
      alt: ('Wallhaven ' + (item.resolution || '') + ' 壁纸').trim(),
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

  // ================= UI 层（app.js 壁纸段） =================

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
   * legacy searchWallpapers（app.js L1560-1635 等价物）：
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
        showToast(result.error || '壁纸加载失败，请检查网络', 'error', 4000);
        return;
      }
      if (result.categorySupported === false && result.requestedCategory) {
        showToast(
          '当前图源不支持按分类筛选，已改为浏览模式。\n想看「分类」结果请在设置里切换到 Wallhaven 图源。',
          'warning',
          4200
        );
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
  async function handleCategoryClick(category: { name: string; query: string }): Promise<void> {
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
      showToast('请输入 1 到 ' + totalPages.value + ' 之间的页码。');
      return false;
    }
    await goToPage(page);
    return true;
  }

  /**
   * legacy closeWallpaperPanel（app.js L1483-1490 等价物）：
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

  /** Pexels 401 回调注入（legacy app.js:123 onAuthError = () => openSettingsPanel()）。 */
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
    return '共 ' + totalPages.value + ' 页 / ' + shownTotal + ' 个';
  });

  return {
    fetchAndSetWallpaper,
    fetchRandomWallpaper,
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
