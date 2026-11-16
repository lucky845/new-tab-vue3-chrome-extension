import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  APP_ID, SCHEMA_VERSION, MAX_IMPORT_BYTES, isCacheKey, buildPayload, summarize,
  buildFileName, migrate, validate, importFromText,
} from '@/src/lib/backup';

const store: Record<string, unknown> = {};
const setMock = vi.fn(async (items: Record<string, unknown>) => Object.assign(store, items));
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (keys: string | string[] | null) => {
        if (keys === null) return { ...store };
        if (Array.isArray(keys)) {
          return keys.reduce((out, k) => { if (k in store) out[k] = store[k]; return out; }, {} as Record<string, unknown>);
        }
        return keys in store ? { [keys]: store[keys] } : {};
      },
      set: setMock,
    },
    onChanged: { addListener: vi.fn() },
  },
  runtime: { getManifest: () => ({ version: '2.0.0' }) },
});

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  setMock.mockClear();
});

describe('backup.isCacheKey', () => {
  it('登记表缓存键与前缀键都判为缓存', () => {
    expect(isCacheKey('amap_adcode_123')).toBe(true);
    expect(isCacheKey('om_weather_BJ')).toBe(true);
    expect(isCacheKey('weather_cooldown_reason')).toBe(true);
    expect(isCacheKey('weather_fail_count')).toBe(true);
    expect(isCacheKey('weather_last_ok')).toBe(true);
    expect(isCacheKey('ntce-sun-2026-01-01-31-121')).toBe(true);
  });
  it('真实数据键不是缓存', () => {
    expect(isCacheKey('todos')).toBe(false);
    expect(isCacheKey('localWallpapers')).toBe(false);
    expect(isCacheKey('savedWallpaperBlob')).toBe(false);
    expect(isCacheKey('')).toBe(false);
  });
});

describe('backup.buildPayload / summarize', () => {
  it('全量减缓存，登记键带可读名，未知键进 extras', async () => {
    Object.assign(store, {
      todos: [{ content: 'a' }],
      localWallpapers: [{ id: 'local:1' }],
      savedWallpaperBlob: 'data:image/jpeg;base64,AAA',
      sideCardModes: { todo: 'always' },
      amap_adcode_123: 'x',
      weather_fail_count: 3,
      myNewFeature: { x: 1 },
    });
    const { payload, stats } = await buildPayload();
    expect(payload.app).toBe(APP_ID);
    expect(payload.schemaVersion).toBe(SCHEMA_VERSION);
    expect(payload.extensionVersion).toBe('2.0.0');
    expect(payload.data.todos).toEqual([{ content: 'a' }]);
    expect(payload.data.localWallpapers).toEqual([{ id: 'local:1' }]);
    expect(payload.keys.localWallpapers?.label).toBe('本地壁纸库');
    expect(payload.extras).toContain('myNewFeature');
    expect(payload.skippedCache).toContain('amap_adcode_123');
    expect(payload.skippedCache).toContain('weather_fail_count');
    expect(payload.data.amap_adcode_123).toBeUndefined();
    expect(stats.keys).toBe(Object.keys(payload.data).length);
  });
});

describe('backup.buildFileName', () => {
  it('固定日期产出稳定文件名', () => {
    expect(buildFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe('newtab-pro-backup-20260102-030405.json');
  });
});

describe('backup.migrate', () => {
  it('v1 剔除缓存键并记一步', () => {
    const r = migrate({ todos: [], amap_adcode_x: 'x' } as Record<string, unknown>, 1);
    expect(r.data).toEqual({ todos: [] });
    expect(r.steps).toEqual([2]);
  });
  it('当前版本不迁移，未来版本原样返回', () => {
    expect(migrate({ todos: [] }, SCHEMA_VERSION).steps).toEqual([]);
    expect(migrate({ todos: [] }, 99).steps).toEqual([]);
  });
});

describe('backup.validate', () => {
  it('拒绝非法顶层/标识/字段类型', () => {
    expect(() => validate(null)).toThrow('顶层必须是对象');
    expect(() => validate([])).toThrow('顶层必须是对象');
    expect(() => validate({ app: 'other', data: {} })).toThrow('app 标识不匹配');
    expect(() => validate({ app: APP_ID, data: { todos: 'not-array' } })).toThrow('类型不正确');
  });
  it('保留 local: 壁纸哨兵，清洗非图片 URL', () => {
    const r = validate({
      app: APP_ID,
      schemaVersion: 2,
      data: {
        savedWallpaperUrl: 'local:123456',
        quickAccessSites: [
          { url: 'https://example.com', title: 'ok' },
          { url: 'javascript:alert(1)', title: 'bad' },
        ],
      },
    });
    expect(r.data.savedWallpaperUrl).toBe('local:123456');
    expect(r.droppedLinks).toBe(1);
    expect((r.data.quickAccessSites as unknown[])).toHaveLength(1);
  });
  it('搜索历史去重并截到 20 条，todo 字段归一化', () => {
    const r = validate({
      app: APP_ID,
      data: {
        searchHistory: ['a', 'a', 'b', '', 'c'],
        todos: [{ content: 'x', category: 'weird', done: 1 }],
      },
    });
    expect(r.data.searchHistory).toEqual(['a', 'b', 'c']);
    const todo = (r.data.todos as Record<string, unknown>[])[0];
    expect(todo.category).toBe('normal');
    expect(todo.done).toBe(false);
  });
  it('缓存键被跳过且记录在 skippedCache', () => {
    const r = validate({ app: APP_ID, data: { todos: [], amap_adcode_x: 'y' } });
    expect(r.skippedCache).toContain('amap_adcode_x');
    expect(r.data.amap_adcode_x).toBeUndefined();
  });
});

describe('backup.importFromText', () => {
  it('空内容 / 非 JSON / 超大文件被拒且不写入', async () => {
    await expect(importFromText('')).rejects.toThrow('文件内容为空');
    await expect(importFromText('not-json')).rejects.toThrow('无法解析 JSON');
    await expect(importFromText('x'.repeat(MAX_IMPORT_BYTES + 1))).rejects.toThrow('备份文件过大');
    expect(setMock).not.toHaveBeenCalled();
  });
  it('全量写回校验通过的数据', async () => {
    const result = await importFromText(JSON.stringify({
      app: APP_ID, schemaVersion: 2,
      data: { todos: [{ content: 'x' }], localWallpapers: [{ id: 'local:1' }] },
    }));
    expect(result.keys).toContain('todos');
    expect(result.keys).toContain('localWallpapers');
    expect(setMock).toHaveBeenCalledTimes(1);
    const todo = (store.todos as Record<string, unknown>[])[0];
    expect(todo.content).toBe('x');
    expect(todo.done).toBe(false);
    expect(todo.category).toBe('normal');
    expect(store.localWallpapers).toEqual([{ id: 'local:1' }]);
  });
});
