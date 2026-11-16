/**
 * 提示浮层（Vue3 ESM 版）
 * --------------------------------------------------------------------
 * 逐字移植 public/legacy-js/utils/dsh-tip.js（504 行）：
 * - .dsh-tip / .dsh-tip--visible / .dsh-tip__icon / .dsh-tip__text /
 *   .dsh-tip__action / .dsh-tip__close / .dsh-tip__arrow / .dsh-tip-toasts
 * - GAP=8 / MARGIN=8 / ARROW=6、above/below/auto 翻转、视口钳制、同 key 去重
 * - 经典 dshTip 全局挂载 → 纯 ESM export + DOM，零全局对象挂载
 * - 样式真源已迁至 public/theme/app.css（.dsh-tip 同族），本文件只管 DOM 构造/定位/计时；
 *   无锚点 Toast 走 useToast.ts 的 Vue 队列（<ToastHost>），不再在本文件生成。
 */

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

const ICONS: Record<string, string> = {
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


interface TipPlacement {
  top: number;
  left: number;
  placement: 'above' | 'below';
  arrowX: number;
  arrowY: number;
}

function computePosition(
  anchorRect: DOMRect,
  tipW: number,
  tipH: number,
  preferred: string,
): TipPlacement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const anchorCenter = anchorRect.left + anchorRect.width / 2;
  const spaceAbove = anchorRect.top;
  const spaceBelow = vh - anchorRect.bottom;
  const fitsAbove = spaceAbove >= tipH + GAP + MARGIN;
  const fitsBelow = spaceBelow >= tipH + GAP + MARGIN;
  let placement: 'above' | 'below';
  if (preferred === 'above') placement = fitsAbove || !fitsBelow ? 'above' : 'below';
  else if (preferred === 'below') placement = fitsBelow || !fitsAbove ? 'below' : 'above';
  else placement = fitsBelow || !fitsAbove ? 'below' : 'above';
  let top = placement === 'above'
    ? anchorRect.top - tipH - GAP
    : anchorRect.bottom + GAP;
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

interface TipConfig {
  type: string;
  message: string;
  duration: number | null;
  placement: string;
  arrow: boolean;
  closable: boolean;
  action: TipAction | null;
  anchor: HTMLElement | null;
  key: string;
}

type TipElement = HTMLElement & { __dshTip?: Tip };
const registry = new Map<string, Tip>();

class Tip {
  readonly el: HTMLDivElement;
  readonly lastDuration: number;
  private cfg: TipConfig;
  private timer: number | null = null;
  private raf: number | null = null;
  private removeTimer: number | null = null;
  private observer: ResizeObserver | null = null;
  private onResize: (() => void) | null = null;
  private onScroll: (() => void) | null = null;
  private onEnter: (() => void) | null = null;
  private onLeave: (() => void) | null = null;
  private startedAt = 0;
  private remaining = 0;
  private _closed = false;

  get closed(): boolean {
    return this._closed;
  }

  constructor(options: Partial<TipConfig>) {
    const rawType = options.type || 'info';
    const type = Object.prototype.hasOwnProperty.call(ICONS, rawType) ? rawType : 'info';
    this.cfg = {
      type,
      message: options.message ?? '',
      duration: options.duration ?? null,
      placement: options.placement || 'auto',
      arrow: options.arrow !== false,
      closable: !!options.closable,
      action: options.action ?? null,
      anchor: options.anchor ?? null,
      key: options.key || 'default',
    };
    this.lastDuration = this.cfg.duration == null
      ? (DURATION[type] ?? DURATION.info ?? 2200)
      : this.cfg.duration;

    const el = document.createElement('div');
    el.className = 'dsh-tip dsh-tip--' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    this.el = el;

    const icon = document.createElement('span');
    icon.className = 'dsh-tip__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = ICONS[type] ?? '';
    el.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'dsh-tip__text';
    text.textContent = this.cfg.message;
    el.appendChild(text);

    const actionList: TipAction[] = this.cfg.action ? [this.cfg.action] : [];
    for (const act of actionList) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dsh-tip__action';
      btn.textContent = act.label;
      if (act.title) btn.title = act.title;
      btn.addEventListener('click', () => {
        act.onClick();
        this.close();
      });
      el.appendChild(btn);
    }

    if (this.cfg.closable) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dsh-tip__close';
      btn.setAttribute('aria-label', '关闭提示');
      btn.textContent = '×';
      btn.addEventListener('click', () => this.close());
      el.appendChild(btn);
    }

    if (this.cfg.arrow && this.cfg.anchor) {
      const arrow = document.createElement('span');
      arrow.className = 'dsh-tip__arrow';
      el.appendChild(arrow);
    }

    const rk = this.cfg.key;
    el.dataset.dshTipKey = rk;
    (el as TipElement).__dshTip = this;
    document.querySelectorAll<TipElement>('.dsh-tip[data-dsh-tip-key]').forEach((node) => {
      if (node === el || node.dataset.dshTipKey !== rk) return;
      const prev = node.__dshTip;
      if (prev) prev.close(true);
      else node.remove();
    });
    const exist = registry.get(rk);
    if (exist) exist.close(true);
    registry.set(rk, this);

    if (this.cfg.anchor) {
      document.body.appendChild(el);
    } else {
      let host = document.querySelector<HTMLElement>('.dsh-tip-toasts');
      if (!host) {
        host = document.createElement('div');
        host.className = 'dsh-tip-toasts';
        host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
      }
      host.appendChild(el);
    }

    this.position();
    this.raf = requestAnimationFrame(() => el.classList.add('dsh-tip--visible'));
    this.bind();
    this.schedule();
  }

  private position(): void {
    const anchor = this.cfg.anchor;
    if (!anchor || !anchor.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const p = computePosition(rect, this.el.offsetWidth, this.el.offsetHeight, this.cfg.placement);
    this.el.style.top = p.top + 'px';
    this.el.style.left = p.left + 'px';
    this.el.dataset.dshTipPlacement = p.placement;
    const arrow = this.el.querySelector<HTMLElement>('.dsh-tip__arrow');
    if (arrow) {
      arrow.style.left = p.arrowX + 'px';
      arrow.style.top = p.arrowY + 'px';
    }
  }

  private bind(): void {
    this.onResize = () => this.position();
    this.onScroll = () => this.position();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('scroll', this.onScroll, true);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.position());
      this.observer.observe(this.el);
      if (this.cfg.anchor) this.observer.observe(this.cfg.anchor);
    }
    if (this.cfg.closable || this.cfg.action) {
      this.onEnter = () => this.pause();
      this.onLeave = () => this.schedule();
      this.el.addEventListener('mouseenter', this.onEnter);
      this.el.addEventListener('mouseleave', this.onLeave);
    }
  }

  private schedule(): void {
    this.clearTimer();
    if (this._closed || this.lastDuration <= 0) return;
    this.remaining = this.remaining || this.lastDuration;
    this.startedAt = Date.now();
    this.timer = window.setTimeout(() => this.close(), this.remaining);
  }

  private pause(): void {
    if (this.timer == null) return;
    window.clearTimeout(this.timer);
    this.timer = null;
    this.remaining = Math.max(0, this.remaining - (Date.now() - this.startedAt));
  }

  private clearTimer(): void {
    if (this.timer == null) return;
    window.clearTimeout(this.timer);
    this.timer = null;
  }

  close(immediate = false): void {
    if (this._closed) return;
    this._closed = true;
    this.clearTimer();
    if (this.raf != null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    if (this.onScroll) window.removeEventListener('scroll', this.onScroll, true);
    if (this.onEnter) this.el.removeEventListener('mouseenter', this.onEnter);
    if (this.onLeave) this.el.removeEventListener('mouseleave', this.onLeave);
    if (registry.get(this.cfg.key) === this) registry.delete(this.cfg.key);
    const remove = () => {
      if (this.removeTimer != null) {
        window.clearTimeout(this.removeTimer);
        this.removeTimer = null;
      }
      this.el.remove();
      const host = document.querySelector('.dsh-tip-toasts');
      if (host && host.childElementCount === 0) host.remove();
    };
    if (immediate) {
      remove();
      return;
    }
    this.el.classList.remove('dsh-tip--visible');
    this.el.addEventListener('transitionend', remove, { once: true });
    this.removeTimer = window.setTimeout(remove, 300);
  }
}

function toHandle(tip: Tip): TipHandle {
  return {
    close: () => tip.close(),
    get closed() {
      return tip.closed;
    },
  };
}

/** 经典 dshTip.attach(anchor, options)：锚定元素，含定位/翻转/视口钳制/同 key 去重。 */
export function attachTip(el: HTMLElement, opts: TipOptions): TipHandle {
  return toHandle(new Tip({
    type: opts.type,
    message: opts.message,
    duration: opts.duration ?? null,
    placement: opts.placement,
    closable: opts.closable,
    action: opts.action ?? null,
    anchor: el,
    key: opts.key,
  }));
}

/** 按 key 关闭同组提示（含遗留 DOM 残留清理）。 */
export function closeTipByKey(key: string): void {
  const tip = registry.get(key);
  if (tip) {
    tip.close();
    return;
  }
  document.querySelectorAll<TipElement>('.dsh-tip[data-dsh-tip-key]').forEach((node) => {
    if (node.dataset.dshTipKey !== key) return;
    const prev = node.__dshTip;
    if (prev) prev.close();
    else node.remove();
  });
}

export function useTip() {
  return { attach: attachTip, close: closeTipByKey } as const;
}
