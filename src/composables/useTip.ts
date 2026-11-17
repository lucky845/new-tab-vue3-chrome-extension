/**
 * 提示浮层 —— Vue 队列版
 * --------------------------------------------------------------------
 * 逐字对齐 v1.8.1:js/utils/dsh-tip.js 的行为（GAP=8 / MARGIN=8 / ARROW=6、
 * above/below/auto 翻转、视口钳制、同 key 去重、closable||action 时悬停暂停），
 * 但不再在运行时 createElement 拼 DOM：本文件只维护 reactive 队列与计时，
 * 渲染交给 <TipHost>（锚定提示）/ <TipBubble>（气泡内容）。
 * 样式真源仍在 public/theme/app.css 的 .dsh-tip 族，本文件不注入任何样式。
 * 无锚点 Toast 走 useToast.ts 的队列（<ToastHost>），与本文件无关。
 */
import { reactive } from 'vue';

export interface TipAction {
  label: string;
  title?: string;
  onClick: () => void;
}

export interface TipOptions {
  type?: string;
  key?: string;
  placement?: string;
  duration?: number;
  closable?: boolean;
  message: string;
  action?: TipAction;
}

export interface TipHandle {
  close(): void;
  closed: boolean;
}

const GAP = 8;
const MARGIN = 8;
const ARROW = 6;

export const TIP_ICONS: Record<string, string> = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'i',
  loading: '◌',
};

const DURATION: Record<string, number> = {
  success: 1800,
  info: 2200,
  warning: 3200,
  error: 4000,
  loading: 0,
};

/** 定位只需要锚点矩形这几个字段（DOMRect 天然满足，单测可传普通对象） */
export interface TipAnchorRect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

/** 视口尺寸：显式传入可脱离 window（node 环境单测） */
export interface TipViewport {
  width: number;
  height: number;
}

export interface TipPlacement {
  top: number;
  left: number;
  placement: 'above' | 'below';
  arrowX: number;
  arrowY: number;
}

function resolveViewport(viewport?: TipViewport): TipViewport {
  if (viewport) return viewport;
  if (typeof window !== 'undefined') return { width: window.innerWidth, height: window.innerHeight };
  return { width: 0, height: 0 };
}

/**
 * 锚定提示的几何解算：优先方向放得下就用它，否则翻到另一侧；两侧都放不下时
 * 按 preferred 的反向兜底，最后统一做视口钳制（四边各留 MARGIN），箭头在
 * 左右各留 14px 的范围内跟随锚点中心。
 */
export function computePosition(
  anchorRect: TipAnchorRect,
  tipW: number,
  tipH: number,
  preferred: string,
  viewport?: TipViewport,
): TipPlacement {
  const { width: vw, height: vh } = resolveViewport(viewport);
  const anchorCenter = anchorRect.left + anchorRect.width / 2;
  const spaceAbove = anchorRect.top;
  const spaceBelow = vh - anchorRect.bottom;
  const fitsAbove = spaceAbove >= tipH + GAP + MARGIN;
  const fitsBelow = spaceBelow >= tipH + GAP + MARGIN;
  let placement: 'above' | 'below';
  if (preferred === 'above') placement = fitsAbove || !fitsBelow ? 'above' : 'below';
  else if (preferred === 'below') placement = fitsBelow || !fitsAbove ? 'below' : 'above';
  else placement = fitsBelow || !fitsAbove ? 'below' : 'above';
  let top = placement === 'above' ? anchorRect.top - tipH - GAP : anchorRect.bottom + GAP;
  top = Math.max(MARGIN, Math.min(top, vh - tipH - MARGIN));
  const left = Math.max(MARGIN, Math.min(anchorCenter - tipW / 2, vw - tipW - MARGIN));
  const arrowX = Math.max(14, Math.min(anchorCenter - left - ARROW, tipW - 14 - ARROW * 2));
  const arrowY = placement === 'above' ? tipH - ARROW - 1 : -ARROW + 1;
  return {
    top: Math.round(top),
    left: Math.round(left),
    placement,
    arrowX: Math.round(arrowX),
    arrowY: Math.round(arrowY),
  };
}

/** 队列里的一条提示：渲染所需的一切都在这里，组件不持有业务状态 */
export interface TipItem {
  id: number;
  type: string;
  message: string;
  placement: string;
  /** 实际生效的展示时长（毫秒），<=0 表示常驻 */
  duration: number;
  closable: boolean;
  action: TipAction | null;
  anchor: HTMLElement | null;
  arrow: boolean;
  key: string;
  /** 入场动画开关：插入后下一个事件循环才置 true，等价原来的 --visible 类时机 */
  visible: boolean;
  closed: boolean;
}

const items = reactive<TipItem[]>([]);
const registry = new Map<string, TipItem>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const removeTimers = new Map<number, ReturnType<typeof setTimeout>>();
const remaining = new Map<number, number>();
const startedAt = new Map<number, number>();
let nextId = 1;

/** 只读队列：给 <TipHost> 渲染用 */
export function useTipQueue() {
  return { items };
}

function clearTimer(id: number): void {
  const timer = timers.get(id);
  if (timer == null) return;
  clearTimeout(timer);
  timers.delete(id);
}

function schedule(item: TipItem): void {
  clearTimer(item.id);
  if (item.closed || item.duration <= 0) return;
  // 用 ?? 而不是 ||：remaining 归零（悬停到时间用尽）时必须立刻关闭，
  // 不能回落到完整 duration 重新计时一遍。
  const left = remaining.get(item.id) ?? item.duration;
  remaining.set(item.id, left);
  startedAt.set(item.id, Date.now());
  timers.set(
    item.id,
    setTimeout(() => closeItem(item), left),
  );
}

function pauseItem(item: TipItem): void {
  const timer = timers.get(item.id);
  if (timer == null) return;
  clearTimeout(timer);
  timers.delete(item.id);
  const started = startedAt.get(item.id) ?? Date.now();
  const left = Math.max(0, (remaining.get(item.id) ?? item.duration) - (Date.now() - started));
  remaining.set(item.id, left);
}

function removeItem(item: TipItem): void {
  const timer = removeTimers.get(item.id);
  if (timer != null) {
    clearTimeout(timer);
    removeTimers.delete(item.id);
  }
  const i = items.findIndex((t) => t.id === item.id);
  if (i >= 0) items.splice(i, 1);
}

function closeItem(item: TipItem, immediate = false): void {
  if (item.closed) return;
  item.closed = true;
  clearTimer(item.id);
  remaining.delete(item.id);
  startedAt.delete(item.id);
  if (registry.get(item.key) === item) registry.delete(item.key);
  if (immediate) {
    removeItem(item);
    return;
  }
  // 先收起（opacity/位移过渡 .2s），300ms 兜底移除，与原实现一致
  item.visible = false;
  removeTimers.set(
    item.id,
    setTimeout(() => removeItem(item), 300),
  );
}

function toHandle(item: TipItem): TipHandle {
  return {
    close: () => closeItem(item),
    get closed() {
      return item.closed;
    },
  };
}

/** 经典 dshTip.attach(anchor, options)：锚定元素，含定位/翻转/视口钳制/同 key 去重。 */
export function attachTip(el: HTMLElement, opts: TipOptions): TipHandle {
  const rawType = opts.type || 'info';
  const type = Object.prototype.hasOwnProperty.call(TIP_ICONS, rawType) ? rawType : 'info';
  const key = opts.key || 'default';
  const explicit = opts.duration ?? null;
  const duration = explicit == null ? (DURATION[type] ?? DURATION.info ?? 2200) : explicit;

  // 同 key 去重：旧提示直接移除，不播收起过渡
  const exist = registry.get(key);
  if (exist) closeItem(exist, true);

  const draft: TipItem = {
    id: nextId++,
    type,
    message: opts.message ?? '',
    placement: opts.placement || 'auto',
    duration,
    closable: !!opts.closable,
    action: opts.action ?? null,
    anchor: el,
    arrow: true,
    key,
    visible: false,
    closed: false,
  };
  // push 进 reactive 数组后再取回：取到的是响应式代理，后续改 visible/closed
  // 才能触发 <TipHost> 重渲染；直接改 draft 原始对象不会触发依赖。
  items.push(draft);
  const item = items[items.length - 1]!;
  registry.set(key, item);
  // 入场动画：先以 opacity:0 挂上去，下一轮事件循环再置 visible 让它过渡到 1。
  // 这里刻意不用 requestAnimationFrame —— 后台标签页/隐藏窗口里 rAF 会被暂停，
  // 提示会一直停在 opacity:0 不可见（预览页实测踩到）。
  setTimeout(() => {
    if (!item.closed) item.visible = true;
  }, 0);
  schedule(item);
  return toHandle(item);
}

/** 按 key 关闭同组提示。 */
export function closeTipByKey(key: string): void {
  const tip = registry.get(key);
  if (tip) {
    closeItem(tip);
    return;
  }
  items.filter((t) => t.key === key && !t.closed).forEach((t) => closeItem(t));
}

/** 悬停暂停/移出续计时：只有 closable 或带 action 的提示需要（与原 bind() 同条件） */
export function pauseTip(id: number): void {
  const item = items.find((t) => t.id === id);
  if (!item || item.closed) return;
  if (!item.closable && !item.action) return;
  pauseItem(item);
}

export function resumeTip(id: number): void {
  const item = items.find((t) => t.id === id);
  if (!item || item.closed) return;
  if (!item.closable && !item.action) return;
  schedule(item);
}

export function useTip() {
  return { attach: attachTip, close: closeTipByKey } as const;
}
