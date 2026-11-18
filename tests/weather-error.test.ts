import { describe, it, expect } from 'vitest';
import { classifyWeatherError } from '@/src/lib/weather-error';

/**
 * 天气错误分类器闸门。
 *
 * 背景（真实 bug）：高德返回 INVALID_USER_KEY 等明确错误码，assertAmapOk 已抬到
 * err.amapInfo，但旧 showError 只匹配「权限/超时/位置/城市」，一律吞成
 * 「天气获取失败」——用户卡面上看不出是 key 配错、配额耗尽还是网络不通。
 * 分类器是纯函数（DOM/storage 无关），这里把四类归因钉死，防止回归。
 */
describe('classifyWeatherError · 高德错误码优先', () => {
  it('INVALID_USER_KEY：短句+可执行提示，不误判为网络', () => {
    const r = classifyWeatherError('天气接口返回失败：INVALID_USER_KEY', 'INVALID_USER_KEY');
    expect(r.short).toBe('高德 Key 无效');
    expect(r.locationHint).toContain('Web服务');
    expect(r.message).toBe('天气接口返回失败：INVALID_USER_KEY');
  });

  it('USERKEY_PLAT_NOMATCH、INVALID_USER_SCODE 同归 key 类', () => {
    expect(classifyWeatherError('USERKEY_PLAT_NOMATCH', 'USERKEY_PLAT_NOMATCH').short).toBe('高德 Key 无效');
    expect(classifyWeatherError('城市编码接口返回失败：INVALID_USER_SCODE').short).toBe('高德 Key 无效');
  });

  it('配额类（CUQPS / QUERY_OVER_LIMIT / OVER_LIMIT）独立归因', () => {
    for (const info of ['CUQPS', 'QUERY_OVER_LIMIT', 'DAY_QUERY_OVER_LIMIT']) {
      const r = classifyWeatherError('天气接口返回失败：' + info, info);
      expect(r.short).toBe('高德配额超限');
      expect(r.locationHint).toContain('配额');
    }
  });

  it('SERVICE_NOT_AVAILABLE 归服务不可用', () => {
    expect(classifyWeatherError('SERVICE_NOT_AVAILABLE').short).toBe('高德服务不可用');
  });

  it('高德码放在 amapInfo 而非 message 里也能识别', () => {
    const r = classifyWeatherError('天气接口返回失败', 'INVALID_USER_KEY');
    expect(r.short).toBe('高德 Key 无效');
  });
});

describe('classifyWeatherError · 定位/权限类', () => {
  it('权限被拒绝 → 定位未授权', () => {
    expect(classifyWeatherError('Geolocation permission denied').short).toBe('定位未授权');
  });
  it('位置信息不可用 / 未找到可用 → 无法定位', () => {
    expect(classifyWeatherError('位置信息不可用').short).toBe('无法定位');
    expect(classifyWeatherError('未找到可用位置').short).toBe('无法定位');
  });
});

describe('classifyWeatherError · 网络类（Open-Meteo 不通的真实场景）', () => {
  it('请求超时 → 连接超时 + 换源提示', () => {
    const r = classifyWeatherError('请求超时');
    expect(r.short).toBe('天气服务连接超时');
    expect(r.locationHint).toContain('高德 Key');
  });
  it('NETWORK_ERROR / Failed to fetch → 网络错误', () => {
    expect(classifyWeatherError('NETWORK_ERROR').short).toBe('天气网络错误');
    expect(classifyWeatherError('Failed to fetch').short).toBe('天气网络错误');
  });
  it('fetchJSON 的 code 优先：message 无关键词但 code 明确', () => {
    expect(classifyWeatherError('fetch failed', undefined, 'NETWORK_ERROR').short).toBe('天气网络错误');
    expect(classifyWeatherError('aborted', undefined, 'ABORT_ERROR').short).toBe('天气服务连接超时');
    expect(classifyWeatherError('error', undefined, 'HTTP_ERROR').short).toBe('天气服务异常');
  });
  it('code 与 message 冲突时以 code 为准（P2-2 回归闸门）', () => {
    // code=HTTP_ERROR 但 message 含「超时」：不能被 ABORT 分支先截走
    expect(classifyWeatherError('请求超时', undefined, 'HTTP_ERROR').short).toBe('天气服务异常');
    // code=NETWORK_ERROR 但 message 含「超时」：应判网络错误，不是连接超时
    expect(classifyWeatherError('请求超时', undefined, 'NETWORK_ERROR').short).toBe('天气网络错误');
    // code=ABORT_ERROR 但 message 含「HTTP 500」：应判连接超时
    expect(classifyWeatherError('HTTP 500', undefined, 'ABORT_ERROR').short).toBe('天气服务连接超时');
  });
  it('HTTP_ERROR / HTTP 状态码 → 服务异常', () => {
    expect(classifyWeatherError('HTTP_ERROR').short).toBe('天气服务异常');
    expect(classifyWeatherError('HTTP 500').short).toBe('天气服务异常');
  });
});

describe('classifyWeatherError · 城市与兜底', () => {
  it('城市关键词 → 城市无效', () => {
    expect(classifyWeatherError('未查询到城市adcode').short).toBe('城市无效');
  });
  it('未知错误 → 天气获取失败 + 重试提示', () => {
    const r = classifyWeatherError('something unknown');
    expect(r.short).toBe('天气获取失败');
    expect(r.locationHint).toContain('重试');
  });
  it('原 message 始终原样保留在 card title', () => {
    const raw = '天气接口返回失败：INVALID_USER_KEY';
    expect(classifyWeatherError(raw, 'INVALID_USER_KEY').message).toBe(raw);
  });
});
