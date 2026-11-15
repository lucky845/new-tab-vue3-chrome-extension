/**
 * Toast（Vue3 ESM 版）
 * --------------------------------------------------------------------
 * 逐字移植 public/legacy-js/utils/toast.js（30 行）：
 * - FALLBACK_DURATION = 2600
 * - type 白名单 ['success','warning','error','info','loading']
 * - duration == null ? 2600 : duration（显式 0 表示常驻，不能被吞掉）
 * - 纯 ESM：直接 createToastTip 生成同一套 .dsh-tip DOM，零全局对象读写
 */
import { createToastTip } from './useTip';

const FALLBACK_DURATION = 2600;
const KNOWN_TYPES: string[] = ['success', 'warning', 'error', 'info', 'loading'];

export function toast(
  message: string,
  type: string = 'info',
  duration?: number,
): void {
  const known = KNOWN_TYPES.includes(type);
  // 与底层 Tip 保持同一口径：undefined/null 才用默认值，显式 0 表示常驻
  const effective = duration == null ? FALLBACK_DURATION : duration;
  createToastTip(message, known ? type : 'info', effective);
}

export function useToast() {
  return { toast } as const;
}
