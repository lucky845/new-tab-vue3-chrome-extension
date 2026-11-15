/**
 * 天气配置（移植自 public/legacy-js/config/weather-config.js，数值逐字保留）
 */
export interface WeatherConfig {
    API_KEY: string;
    BASE_URL: string;
    DEFAULT_UNIT: 'celsius' | 'fahrenheit';
    DEFAULT_LANG: string;
    UPDATE_INTERVAL: number;
    GEOLOCATION_TIMEOUT: number;
    GEOLOCATION_MAX_AGE: number;
    WEATHER_CACHE_TTL: number;
    WEATHER_CACHE_MAX_AGE: number;
    /** 网络失败/离线/冷却期允许显示的过期缓存上限（默认 7 天） */
    WEATHER_CACHE_FALLBACK_MAX_AGE: number;
    ADCODE_CACHE_TTL: number;
    MIN_REQUEST_INTERVAL: number;
    ICON_MAPPING: Record<string, string>;
}

export const WEATHER_CONFIG: WeatherConfig = {
    // 高德地图 Web服务 API Key - 前往 https://lbs.amap.com/ 申请（可选：留空则使用 Open-Meteo 免费天气，无需密钥）
    API_KEY: '',
    // API基础URL
    BASE_URL: 'https://restapi.amap.com/v3',
    // 默认设置
    DEFAULT_UNIT: 'celsius', // 仍保留前端显示单位切换
    DEFAULT_LANG: 'zh_cn', // 暂无作用，兼容保留
    // 更新间隔（毫秒）：30分钟
    UPDATE_INTERVAL: 30 * 60 * 1000,
    // 地理位置超时设置：5秒 / 位置缓存5分钟
    GEOLOCATION_TIMEOUT: 5000,
    GEOLOCATION_MAX_AGE: 5 * 60 * 1000,
    // 本地缓存与限流：天气缓存20分钟；过期缓存最多顶24h；行政区编码缓存1天；最短请求间隔10s
    WEATHER_CACHE_TTL: 20 * 60 * 1000,
    WEATHER_CACHE_MAX_AGE: 24 * 60 * 60 * 1000,
    WEATHER_CACHE_FALLBACK_MAX_AGE: 7 * 24 * 60 * 60 * 1000,
    ADCODE_CACHE_TTL: 24 * 60 * 60 * 1000,
    MIN_REQUEST_INTERVAL: 10 * 1000,
    // 天气图标映射（Open-Meteo WMO code → 本地图标名）
    ICON_MAPPING: {
        '01d': 'sunny', '01n': 'clear-night',
        '02d': 'partly-cloudy-day', '02n': 'partly-cloudy-night',
        '03d': 'cloudy', '03n': 'cloudy',
        '04d': 'cloudy', '04n': 'cloudy',
        '09d': 'rain', '09n': 'rain',
        '10d': 'rain', '10n': 'rain',
        '11d': 'thunderstorm', '11n': 'thunderstorm',
        '13d': 'snow', '13n': 'snow',
        '50d': 'fog', '50n': 'fog',
    },
};
