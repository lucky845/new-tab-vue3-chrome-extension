/**
 * 面板焦点陷阱（DOM 侧接线，判定逻辑在 src/lib/focusTrap.ts）。
 *
 * 分工与 useEscapeClose.ts 完全对称，刻意做成同一套模型：
 *   - 每个打开的面板只「登记」，不自己挂 keydown；唯一监听在模块级
 *   - 层级与打开顺序集中在一个 Map 里，Tab 只交给最靠上的一层，和 Esc 的
 *     pickEscapeTarget 判定共用同一份 EscapeEntry，避免两套层级口径打架
 *   - 打开时把焦点收进面板，关闭时把焦点还给打开它之前那个元素
 *
 * 为什么不用 useDialog.ts 那种手写循环：那个是三元素硬编码的对话框专用实现，
 * 面板的可聚焦元素是动态的（设置面板里随 tab 切换而变），必须做成通用的。
 */
import { FOCUSABLE_SELECTOR, trapTabTarget } from '@/src/lib/focusTrap';
import { pickEscapeTarget, type EscapeEntry } from '@/src/lib/escapeClose';

interface TrapRegistration {
  entry: EscapeEntry;
  /** 面板根元素：既是焦点兜底容器（tabindex=-1），也是查询可聚焦元素的边界 */
  root: HTMLElement;
}

const registrations = new Map<string, TrapRegistration>();
let seq = 0;
let listening = false;

type Tabbable = HTMLElement & { disabled?: boolean };

/**
 * 一个元素当前是否真的可见可聚焦：display:none / 父级隐藏（.u-hidden）都拿不到矩形。
 * checkVisibility 是较新的 API，老内核没有就退回几何判定。
 */
function isVisible(el: HTMLElement): boolean {
  const candidate = el as HTMLElement & { checkVisibility?: (opts?: object) => boolean };
  if (typeof candidate.checkVisibility === 'function') return candidate.checkVisibility({ checkOpacity: false });
  return el.getClientRects().length > 0;
}

/** 面板内按 DOM 顺序排列、当前可聚焦的元素（disabled 与不可见的一律剔除） */
function focusablesIn(root: HTMLElement): HTMLElement[] {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return nodes.filter((el) => {
    const tabbable = el as Tabbable;
    return tabbable.disabled !== true && isVisible(el);
  });
}

/**
 * 打开时把焦点收进面板：优先第一个可聚焦元素，面板里一个都没有时落到面板根上。
 *
 * 为什么要兜底到根：面板里可能整块内容都是只读展示（如壁纸面板的分类栏），
 * 没有可聚焦元素时 Tab 会直接从面板里溜出去，焦点就丢了。根上带 tabindex="-1"，
 * 屏幕阅读器还能念到面板标题，语义上比「空白焦点」强。
 */
export function focusInto(root: HTMLElement): void {
  const target = focusablesIn(root)[0];
  if (target) {
    target.focus();
    return;
  }
  root.focus();
}

/** 关闭时把焦点还给打开面板之前那个元素；元素已不在文档里则不抢焦点 */
export function restoreFocus(previous: HTMLElement | null): void {
  if (!previous || !document.contains(previous)) return;
  if (typeof previous.focus === 'function') previous.focus();
}

/** 只有最靠上的一层面板处理 Tab，与 Esc 的层级判定同源 */
function topTrap(): TrapRegistration | null {
  const entries = Array.from(registrations.values()).map((reg) => reg.entry);
  const id = pickEscapeTarget(entries, { dialogOpen: false, dragging: false });
  return id ? registrations.get(id) ?? null : null;
}

/**
 * 打开时是否已经把焦点收进面板了。
 *
 * 有这个判断是因为部分面板会自己聚焦内部元素（TodoPanel 打开即聚焦输入框）：
 * 面板的 watch 注册在子组件 GlassPanel 之前，若这里无条件抢焦点，会把用户输入框
 * 里的焦点顶到关闭按钮上。焦点已在面板内就维持原样，把「是否聚焦」的决策留给面板。
 */
function focusAlreadyInside(root: HTMLElement): boolean {
  return typeof document !== 'undefined' && root.contains(document.activeElement);
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  // 对话框（.dsh-dialog）自己有一套三元素焦点循环，且是 capture 监听、先到先得，
  // 这里不抢——避免两层同时 preventDefault 后焦点在面板和对话框之间跳。
  if (document.querySelector('.dsh-dialog')) return;
  const reg = topTrap();
  if (!reg) return;
  const focusables = focusablesIn(reg.root);
  const activeIndex = focusables.indexOf(document.activeElement as HTMLElement);
  const target = trapTabTarget({ count: focusables.length, activeIndex, shift: event.shiftKey });
  if (target === null) return;
  event.preventDefault();
  const next = focusables[target];
  if (next) {
    next.focus();
  } else if (focusables.length === 0) {
    // 面板内无可聚焦元素：把焦点固定在面板根上，Tab/Shift+Tab 原地循环
    reg.root.focus();
  }
}

function ensureListener(): void {
  if (listening || typeof document === 'undefined') return;
  document.addEventListener('keydown', onKeyDown);
  listening = true;
}

function dropListenerIfIdle(): void {
  if (!listening || registrations.size > 0 || typeof document === 'undefined') return;
  document.removeEventListener('keydown', onKeyDown);
  listening = false;
}

/**
 * 登记一个「打开时接管焦点」的面板。
 *
 * z 与打开顺序必须与 Esc 登记用的一致（同一份 ESCAPE_Z_BY_VARIANT 与同一次
 * watch），否则会出现「Esc 关掉的是最上层、Tab 关的是次上层」的错位。返回值必须
 * 在面板关闭 / 组件卸载时调用。
 */
export function registerFocusTrap(id: string, z: number, root: HTMLElement): () => void {
  seq += 1;
  // 打开前的焦点先存下来：关闭面板时还回去，键盘用户才能连续操作下一个面板
  const previous = (document.activeElement as HTMLElement | null) ?? null;
  registrations.set(id, { entry: { id, z, order: seq }, root });
  ensureListener();
  if (!focusAlreadyInside(root)) focusInto(root);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    registrations.delete(id);
    dropListenerIfIdle();
    restoreFocus(previous);
  };
}

/** 给单元测试 / 调试用：当前登记了几层焦点陷阱 */
export function focusTrapCount(): number {
  return registrations.size;
}
