/**
 * 天气错误分类（纯函数，无 DOM / storage / 响应式依赖）。
 *
 * 从 useWeather.ts 抽出：它只吃字符串和结构化 code，放在 lib 层可独立单测，
 * 不必为一个纯函数 import 整个 1590 行的 composable（连带 chrome/vue/log）。
 * 这也是 ROADMAP v3.0「useWeather.ts 拆分」的第一刀。
 */

/**
 * 卡面文案（短句 + 位置行指引 + 完整原因；原 useWeather.showError 归并产物）。
 *
 * short / locationHint 现在放的是 i18n key（`weather_err_*_short` / `_hint`），
 * 由展示层调 t() 翻译；message 保持原始错误串（可能含接口原文，用于诊断）。
 * 这里仍是纯函数、零依赖——不 import useI18n，就不必为分类逻辑拉进 Vue。
 */
export interface WeatherErrorInfo {
  message: string;
  short: string;
  locationHint: string;
}

/**
 * 把一条天气错误归并为卡面文案——纯函数，可单测。
 *
 * 分类顺序有讲究：高德错误码（amapInfo 或 message 内嵌）优先于一切网络/权限关键词，
 * 因为「天气接口返回失败：INVALID_USER_KEY」里同时含「失败」等泛词，先匹配网络会误判。
 * 网络类靠 fetchJSON 的 code（ABORT_ERROR / NETWORK_ERROR / HTTP_ERROR）识别，
 * 不靠中文文案猜测——文案可能被 i18n 或 legacy 改动，code 是稳定的结构字段。
 */
export function classifyWeatherError(
  message: string,
  amapInfo?: string,
  code?: string
): WeatherErrorInfo {
  const info = (amapInfo || '') + ' ' + message;

  // 1) 高德错误码：key 类（用户要改设置）与配额/服务类（等恢复或提配额）
  if (/INVALID_USER_KEY|USERKEY_PLAT_NOMATCH|INVALID_USER_SCODE/i.test(info)) {
    return { message, short: 'weather_err_key_invalid_short', locationHint: 'weather_err_key_invalid_hint' };
  }
  if (/CUQPS|QUERY_OVER_LIMIT|OVER_LIMIT/i.test(info)) {
    return { message, short: 'weather_err_quota_short', locationHint: 'weather_err_quota_hint' };
  }
  if (/SERVICE_NOT_AVAILABLE/i.test(info)) {
    return { message, short: 'weather_err_service_unavailable_short', locationHint: 'weather_err_service_unavailable_hint' };
  }

  // 2) 定位/权限类（保留 legacy 语义）
  if (/权限被拒绝|NotAllowed|Permission/i.test(message)) {
    return { message, short: 'weather_err_geo_denied_short', locationHint: 'weather_err_geo_denied_hint' };
  }
  if (/位置信息不可用|未找到可用/i.test(message)) {
    return { message, short: 'weather_err_geo_failed_short', locationHint: 'weather_err_geo_failed_hint' };
  }
  if (/不支持地理位置|请在浏览器\/系统设置中允许位置访问/.test(message)) {
    return { message, short: 'weather_err_geo_unsupported_short', locationHint: 'weather_err_geo_unsupported_hint' };
  }

  // 3) 网络类：Open-Meteo 不通 / 请求超时 / HTTP 失败 —— 明确告诉用户「换源或稍后」
  //    fetchJSON 的 code 是稳定结构字段，优先于 message 文案（文案可能被 i18n 改动）。
  //    注意：不能把 code 和 message 拼成一个字符串再按「类别顺序」匹配——那样 code=HTTP_ERROR
  //    但 message 含「超时」时会被 ABORT 分支先命中，与 code 声称的语义相反。这里先按 code
  //    精确分类，仅当 code 缺失/未知时才回退 message 关键词。
  const codeClass =
    code === 'ABORT_ERROR' ? 'abort'
      : code === 'NETWORK_ERROR' ? 'network'
        : code === 'HTTP_ERROR' ? 'http'
          : null;
  if (codeClass === 'abort' || (codeClass === null && /ABORT_ERROR|请求超时|超时|timeout/i.test(message))) {
    return { message, short: 'weather_err_timeout_short', locationHint: 'weather_err_timeout_hint' };
  }
  if (codeClass === 'network' || (codeClass === null && /NETWORK_ERROR|网络错误|Failed to fetch|NetworkError/i.test(message))) {
    return { message, short: 'weather_err_network_short', locationHint: 'weather_err_network_hint' };
  }
  if (codeClass === 'http' || (codeClass === null && /HTTP_ERROR|HTTP 4\d\d|HTTP 5\d\d/i.test(message))) {
    return { message, short: 'weather_err_http_short', locationHint: 'weather_err_http_hint' };
  }

  // 4) 城市类 + 兜底
  if (/城市/.test(message)) {
    return { message, short: 'weather_err_city_short', locationHint: 'weather_err_city_hint' };
  }
  return { message, short: 'weather_err_unknown_short', locationHint: 'weather_err_unknown_hint' };
}
