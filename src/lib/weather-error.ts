/**
 * 天气错误分类（纯函数，无 DOM / storage / 响应式依赖）。
 *
 * 从 useWeather.ts 抽出：它只吃字符串和结构化 code，放在 lib 层可独立单测，
 * 不必为一个纯函数 import 整个 1590 行的 composable（连带 chrome/vue/log）。
 * 这也是 ROADMAP v3.0「useWeather.ts 拆分」的第一刀。
 */

/** 卡面文案（短句 + 位置行指引 + 完整原因；原 useWeather.showError 归并产物） */
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
    return { message, short: '高德 Key 无效', locationHint: '⚙️ 设置里填有效的 Web服务 类型高德 Key' };
  }
  if (/CUQPS|QUERY_OVER_LIMIT|OVER_LIMIT/i.test(info)) {
    return { message, short: '高德配额超限', locationHint: '高德控制台提配额，或移除 Key 用免费天气' };
  }
  if (/SERVICE_NOT_AVAILABLE/i.test(info)) {
    return { message, short: '高德服务不可用', locationHint: '稍后自动重试，或 ⚙️ 设置移除 Key 用免费天气' };
  }

  // 2) 定位/权限类（保留 legacy 语义）
  if (/权限被拒绝|NotAllowed|Permission/i.test(message)) {
    return { message, short: '定位未授权', locationHint: '点 ⚙️ 设置天气城市即可显示' };
  }
  if (/位置信息不可用|未找到可用/i.test(message)) {
    return { message, short: '无法定位', locationHint: '点 ⚙️ 设置天气城市即可显示' };
  }
  if (/不支持地理位置|请在浏览器\/系统设置中允许位置访问/.test(message)) {
    return { message, short: '定位不可用', locationHint: '点 ⚙️ 设置天气城市即可显示' };
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
    return { message, short: '天气服务连接超时', locationHint: '网络不通或免费天气域名不可达，⚙️ 设置可填高德 Key 换源' };
  }
  if (codeClass === 'network' || (codeClass === null && /NETWORK_ERROR|网络错误|Failed to fetch|NetworkError/i.test(message))) {
    return { message, short: '天气网络错误', locationHint: '检查网络后点天气卡片重试；⚙️ 可填高德 Key 换源' };
  }
  if (codeClass === 'http' || (codeClass === null && /HTTP_ERROR|HTTP 4\d\d|HTTP 5\d\d/i.test(message))) {
    return { message, short: '天气服务异常', locationHint: '稍后自动重试；持续失败可 ⚙️ 设置换源' };
  }

  // 4) 城市类 + 兜底
  if (/城市/.test(message)) {
    return { message, short: '城市无效', locationHint: '打开右上角 ⚙️ 设置可修改天气城市' };
  }
  return { message, short: '天气获取失败', locationHint: '稍后自动重试，或 ⚙️ 设置换源' };
}
