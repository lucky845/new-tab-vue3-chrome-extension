import { reactive } from "vue";
import type { QuickAccessNode } from "@/src/lib/defaultSites";

/**
 * 快捷访问图标的拖拽（指针事件实现，不依赖任何拖拽库）。
 *
 * 为什么不用 SortableJS：它自己搬真实 DOM，再回头通知数据「应该是这个顺序」，
 * 于是「库刚让位完、数据还没跟上」的瞬间就成了所有 bug 的温床——重复项被去重吞掉（图标消失）、
 * 高亮跟着被挤开的节点乱跳（瞬间换位）、Vue 与库同时操作同一批节点（nextSibling 崩溃）。
 *
 * 这里改成指针事件：拖拽期间一行 DOM 都不动，只让一个 fixed 定位的拖影跟着指针走；
 * 松手时用 elementFromPoint 取落点，把「拖到哪」这唯一事实交给数据层去解释。
 */

const DRAG_THRESHOLD = 4;
const CLICK_SUPPRESS_MS = 250;

export interface IconDragState {
  active: boolean;
  node: QuickAccessNode | null;
  /** 指针当前坐标（拖影中心） */
  x: number;
  y: number;
}

/** 全局共享：拖影组件直接读它，不需要层层传 props */
export const iconDragState = reactive<IconDragState>({
  active: false,
  node: null,
  x: 0,
  y: 0,
});

interface PendingDrag {
  node: QuickAccessNode;
  /** 按下时来源格子的 data-node-index，用来判定"原地松手" */
  index: number;
  startX: number;
  startY: number;
  pointerId: number;
  element: HTMLElement;
}

let pending: PendingDrag | null = null;
/** 指针此刻压在哪个格子上 */
let hoverCell: HTMLElement | null = null;
let suppressClickUntil = 0;

/** 落点样式钩子：格子用 data-drag-cell 标记，这里只做「谁在指针底下」的判定 */
const CELL_SELECTOR = "[data-drag-cell]";

type DropHandler = (dragged: QuickAccessNode, targetCell: HTMLElement) => void;
let dropHandler: DropHandler | null = null;
let hoverListener: ((cell: HTMLElement | null) => void) | null = null;
let startListener: ((node: QuickAccessNode) => void) | null = null;

/** 真正进入拖拽态时通知外部（给"原位格子淡下去"用，免得到处轮询） */
export function onIconDragStart(listener: ((node: QuickAccessNode) => void) | null): void {
  startListener = listener;
}

/** 由网格组件注册：松手时怎么解释落点，由它决定（排序 / 并进文件夹） */
export function onIconDrop(handler: DropHandler): void {
  dropHandler = handler;
}
/** 拖拽经过格子时通知外部，用来画高亮 */
export function onIconHover(listener: (cell: HTMLElement | null) => void): void {
  hoverListener = listener;
}

const onKeyDown = (event: KeyboardEvent): void => {
  if (event.key === "Escape") cancel();
};
const onBlur = (): void => cancel();

/** 中断拖拽（Esc / 失焦）：什么都不落，只收尾 */
function cancel(): void {
  reset();
  hoverListener?.(null);
}

function reset(): void {
  const element = pending?.element;
  const pointerId = pending?.pointerId;
  pending = null;
  hoverCell = null;
  iconDragState.active = false;
  iconDragState.node = null;
  if (typeof document !== "undefined") document.body.classList.remove("icon-dragging");
  if (typeof window !== "undefined") {
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", reset, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("blur", onBlur);
  }
  if (element && pointerId != null) {
    try {
      element.releasePointerCapture(pointerId);
    } catch {
      // 指针已释放（或事件是合成的）：忽略
    }
  }
}

/** 指针底下是哪个格子（拖影 pointer-events:none，不会被自己挡住） */
function cellAt(x: number, y: number): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const element = document.elementFromPoint(x, y);
  const cell = element?.closest?.(CELL_SELECTOR);
  return cell instanceof HTMLElement ? cell : null;
}

function applyHover(x: number, y: number): void {
  const cell = cellAt(x, y);
  if (cell === hoverCell) return;
  hoverCell = cell;
  hoverListener?.(cell);
}

/** 指针离开所有可落点（分页条、标题区、面板）时同样要通知外部收掉高亮 */

function onPointerMove(event: PointerEvent): void {
  if (!pending) return;
  if (!iconDragState.active) {
    if (Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) < DRAG_THRESHOLD) {
      return;
    }
    iconDragState.active = true;
    iconDragState.node = pending.node;
    if (typeof document !== "undefined") document.body.classList.add("icon-dragging");
    startListener?.(pending.node);
  }
  iconDragState.x = event.clientX;
  iconDragState.y = event.clientY;
  applyHover(event.clientX, event.clientY);
}

function onPointerUp(event: PointerEvent): void {
  if (!pending) return;
  const draggedNode = pending.node;
  const draggedIndex = pending.index;
  const dragged = iconDragState.active;
  const target = hoverCell;
  if (dragged) suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
  reset();
  if (!dragged || !target) return;
  // 落在自己身上不算落点（拖了一定距离但原地松手）
  if (draggedNode && target.dataset.nodeIndex === String(draggedIndex)) {
    hoverListener?.(null);
    return;
  }
  dropHandler?.(draggedNode, target);
  // 补一次悬停复位，让高亮在松手后立刻收掉
  hoverListener?.(null);
  void event;
}

/** 指针按下即登记，位移超过阈值才算拖拽（单击不受影响） */
export function startIconDrag(node: QuickAccessNode, event: PointerEvent): void {
  if (!node || event.button !== 0) return;
  if (pending) reset();
  const sourceCell = (event.currentTarget as HTMLElement | null)?.closest?.(CELL_SELECTOR) as HTMLElement | null;
  pending = {
    node,
    index: sourceCell ? Number(sourceCell.dataset.nodeIndex) : -1,
    startX: event.clientX,
    startY: event.clientY,
    pointerId: event.pointerId,
    element: event.currentTarget as HTMLElement,
  };
  if (typeof window === "undefined") return;
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", reset, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", onBlur);
  try {
    pending.element.setPointerCapture?.(event.pointerId);
  } catch {
    // 合成事件没有可捕获的指针：window 上的监听已经够用
  }
}

/**
 * 组件卸载时中断当前拖拽并摘掉全部全局监听。
 * 只置空回调是不够的：window 上的 pointermove/pointerup 和 body 的 icon-dragging 会残留。
 */
export function destroyIconDrag(): void {
  cancel();
  dropHandler = null;
  hoverListener = null;
  startListener = null;
  suppressClickUntil = 0;
  if (typeof document !== "undefined") document.body.classList.remove("icon-dragging");
}

/** 拖拽结束后浏览器还会补一次 click，用它挡掉误触发（打开图标 / 展开文件夹） */
export function shouldSuppressIconClick(): boolean {
  if (Date.now() < suppressClickUntil) {
    suppressClickUntil = 0;
    document.body.classList.remove("icon-dragging");
    return true;
  }
  return false;
}
