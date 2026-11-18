import { log } from '@/src/lib/log';
import { readSettings } from '@/src/composables/useSettings';
import { MOTION_LS_MIRROR, resolveMotionMode, type MotionMode } from '@/src/lib/motionPreference';

/**
 * 动效降级状态机（单例，App 挂载时 init 一次）。
 *
 * 与 useTheme 同款分层：public/theme-preboot.js 用 localStorage 镜像 'ntce-motion'
 * 在首帧前预置 <html data-motion>；这里在 Vue 挂载后用 chrome.storage 真值校正，
 * 并监听 settings 变更（设置面板 patchSettings 落盘后由这里统一应用）与系统偏好变化。
 */

let reduceMotion = false;
let initialized = false;

function systemPrefersReduced(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function writeMirror(): void {
  try {
    localStorage.setItem(MOTION_LS_MIRROR, JSON.stringify({ reduceMotion }));
  } catch {
    // localStorage 不可用（隐私模式等）时忽略：异步路径仍会正确应用
  }
}

/** 套用动效档位：只改 <html data-motion>，降级规则全在 CSS */
export function applyMotionMode(): MotionMode {
  const mode = resolveMotionMode(reduceMotion, systemPrefersReduced());
  document.documentElement.setAttribute('data-motion', mode);
  return mode;
}

function bindListeners(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const next = changes.settings.newValue as { reduceMotion?: boolean } | undefined;
    reduceMotion = next?.reduceMotion === true;
    writeMirror();
    applyMotionMode();
  });
  try {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => applyMotionMode();
    // Safari 旧版只有 addListener
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
    else if (typeof mql.addListener === 'function') mql.addListener(onChange);
  } catch (error) {
    log.warn('系统动效偏好监听失败：', error);
  }
}

export function useMotion(): { init: () => Promise<void>; apply: () => MotionMode } {
  async function init(): Promise<void> {
    if (initialized) return;
    initialized = true;
    // 先用系统偏好落一档，避免等 storage 期间出现动画闪烁
    applyMotionMode();
    bindListeners();
    const settings = await readSettings();
    reduceMotion = settings.reduceMotion === true;
    writeMirror();
    applyMotionMode();
  }
  return { init, apply: applyMotionMode };
}
