/**
 * 首屏预置：主题 + 时钟（防白闪 / 防占位符闪）
 *
 * 唯一保留在 <head> 的同步经典引导：CSP 是 script-src 'self'（无 unsafe-inline），
 * 内联脚本会被拦截；ESM 又是 deferred，抢不到首帧。所以这段必须外部同步加载。
 * 自包含：不依赖任何 window.* 全局构造器，只读 localStorage 镜像 'ntce-theme'；
 * chrome.storage 真值由 src/composables/useTheme.ts 在 Vue 挂载后校正。
 */
(function () {
    var DEFAULTS = { mode: 'auto', lightStart: '07:00', darkStart: '18:00' };
    function toMinutes(hhmm) {
        var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
        if (!m) return null;
        var h = Number(m[1]);
        var min = Number(m[2]);
        if (h < 0 || h > 23 || min < 0 || min > 59) return null;
        return h * 60 + min;
    }
    function systemPrefers() {
        try {
            return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        } catch (e) {
            return 'dark';
        }
    }
    function resolveSunSync(lightStart, darkStart) {
        var now = new Date();
        var cur = now.getHours() * 60 + now.getMinutes();
        var ls = toMinutes(lightStart);
        var ds = toMinutes(darkStart);
        if (ls === null || ds === null) return 'dark';
        if (ls <= ds) return cur >= ls && cur < ds ? 'light' : 'dark';
        return cur >= ls || cur < ds ? 'light' : 'dark';
    }
    var mirror = null;
    try {
        mirror = JSON.parse(localStorage.getItem('ntce-theme') || 'null');
    } catch (e) {
        mirror = null;
    }
    var mode = (mirror && mirror.mode) || 'auto';
    var resolved;
    if (mode === 'light' || mode === 'dark') {
        resolved = mode;
    } else if (mode === 'sun') {
        resolved = resolveSunSync(
            mirror.lightStart || DEFAULTS.lightStart,
            mirror.darkStart || DEFAULTS.darkStart
        );
    } else {
        resolved = systemPrefers();
    }
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-mode', mode);

    // 动效降级：用户开关（localStorage 镜像 'ntce-motion'）或系统偏好任一成立即降级，
    // 真值由 src/composables/useMotion.ts 在 Vue 挂载后校正
    var reduceMotion = false;
    try {
        var motionMirror = JSON.parse(localStorage.getItem('ntce-motion') || 'null');
        reduceMotion = !!(motionMirror && motionMirror.reduceMotion === true);
    } catch (e) {
        reduceMotion = false;
    }
    var systemReduced = false;
    try {
        systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
        systemReduced = false;
    }
    document.documentElement.setAttribute(
        'data-motion',
        reduceMotion || systemReduced ? 'reduced' : 'full'
    );

    // 时钟预填：与 ClockBlock 同一格式（HH:MM，24 小时制），抢在首帧前填掉占位符
    function pad(n) {
        return n < 10 ? '0' + n : String(n);
    }
    function paintClock() {
        var now = new Date();
        var timeEl = document.getElementById('clock-time');
        if (timeEl) timeEl.textContent = pad(now.getHours()) + ':' + pad(now.getMinutes());
        var dateEl = document.getElementById('clock-date');
        if (dateEl && !dateEl.textContent) {
            var week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            dateEl.textContent =
                now.getFullYear() +
                '年' +
                (now.getMonth() + 1) +
                '月' +
                now.getDate() +
                '日 ' +
                week[now.getDay()];
        }
    }
    paintClock();
    if (!document.getElementById('clock-time') && typeof MutationObserver === 'function') {
        var obs = new MutationObserver(function () {
            if (document.getElementById('clock-time')) {
                paintClock();
                obs.disconnect();
            }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
    }
    document.addEventListener('DOMContentLoaded', paintClock, { once: true });
})();
