/**
 * 轻量分级日志。
 *
 * 目的（ROADMAP §4.4 console.* 收敛）：把散落的 console.log/info/debug 收口到统一开关下，
 * 保留 error/warn（排障关键路径），开发期可开 verbose 看全量。
 *
 * 用法：import { log } from '@/src/lib/log'; 然后 log.debug('[壁纸] 命中缓存')。
 * 生产默认静默；把 localStorage 的 ntce-verbose-log 设为 '1' 即可临时打开（无需改构建）。
 */

type LogLevel = 'debug' | 'info' | 'log' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  log: 1,
  warn: 2,
  error: 3,
};

/** 0=error only, 1=+warn, 2=+info/log, 3=+debug */
function threshold(): number {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('ntce-verbose-log') === '1') {
      return 3;
    }
    // 开发服务器下默认放 info（Vite 注入 DEV）
    if (import.meta.env?.DEV) return 2;
  } catch {
    /* localStorage 不可用（隐私模式/预览 shim）时退回静默 */
  }
  return 1; // 生产：仅 warn / error
}

function emit(level: LogLevel, args: unknown[]): void {
  if (LEVEL_ORDER[level] < threshold()) return;
  const fn = console[level] ?? console.log;
  fn(...args);
}

export const log = {
  debug: (...args: unknown[]) => emit('debug', args),
  info: (...args: unknown[]) => emit('info', args),
  log: (...args: unknown[]) => emit('log', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args),
};
