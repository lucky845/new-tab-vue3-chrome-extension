/**
 * 面板开合状态机（Vue 版）——替代 legacy v1.8.1:js/app.js 里逐个 classList.add/remove('u-hidden')。
 *
 * 语义与 legacy 一致：各面板相互独立，可以同时开（面板是独立浮层卡片）。
 * CSS 不变：面板可见 = 不带 u-hidden（display:flex），隐藏 = 带 u-hidden（display:none）。
 */
import { reactive } from 'vue';

export type PanelId =
  | 'todo'
  | 'notes'
  | 'pomodoro'
  | 'wallpaper'
  | 'weather-settings'
  | 'tools'
  | 'settings'
  | 'add-qa'
  | 'folder';

const state = reactive<Record<PanelId, boolean>>({
  todo: false,
  notes: false,
  pomodoro: false,
  wallpaper: false,
  'weather-settings': false,
  tools: false,
  settings: false,
  'add-qa': false,
  folder: false,
});

export interface PanelsApi {
  isOpen: (id: PanelId) => boolean;
  open: (id: PanelId) => void;
  close: (id: PanelId) => void;
  toggle: (id: PanelId) => void;
  closeAll: () => void;
}

/**
 * 每个面板最近一次的「展开原点」（视口坐标，CSS px）。
 * 由触发元素在 open/toggle 前写入，CSS 用它算 --panel-origin，
 * 让卡片从被点击的位置长出来，而不是从自己的几何中心弹出。
 * 未记录时退回弹性原点（见 app.css 的 --panel-origin 默认值）。
 */
const origins = new Map<PanelId, { x: number; y: number }>();

/** 记录展开原点；传不出有效坐标时清空，回落到默认原点。 */
export function setPanelOrigin(id: PanelId, x?: number, y?: number): void {
  if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
    origins.set(id, { x, y });
  } else {
    origins.delete(id);
  }
}

/** 从一次事件/元素上取原点（取元素中心，比事件点更稳：键盘触发时事件点没有意义）。 */
export function setPanelOriginFromEvent(id: PanelId, ev?: Event): void {
  const el = ev?.currentTarget instanceof Element ? ev.currentTarget : ev?.target instanceof Element ? ev.target : null;
  if (!el) {
    setPanelOrigin(id);
    return;
  }
  const r = el.getBoundingClientRect();
  setPanelOrigin(id, r.left + r.width / 2, r.top + r.height / 2);
}

/**
 * 面板根元素的 :style 绑定来源。
 * 把记录到的原点暴露成 --panel-origin-x / -y，CSS 用它算「从点击处长出来」的位移量
 * （见 app.css 末尾「弹窗展开式进场」）。没有记录时返回空对象，走 CSS 默认原点。
 */
export function panelOriginStyle(id: PanelId): Record<string, string> {
  const o = origins.get(id);
  if (!o) return {};
  return {
    '--panel-origin-x': `${o.x}px`,
    '--panel-origin-y': `${o.y}px`,
  };
}

/**
 * 兜底原点：没走 setPanelOriginFromEvent 的入口（键盘触发、代码调用、卡片内部委托）
 * 用它对应的触发按钮补上，避免动画从一个跟点击无关的位置长出来。
 * 按钮找不到就什么都不做，由 CSS 的默认原点接管。
 */
const TRIGGER_SELECTOR: Partial<Record<PanelId, string>> = {
  todo: '#todo-btn, #todo-card-expand',
  notes: '#notes-btn, #notes-card-expand',
  pomodoro: '#pomodoro-btn, #pomodoro-card-expand',
  wallpaper: '#wallpaper-settings-btn',
  'weather-settings': '#weather-settings-btn',
  tools: '#tools-btn, #tools-card-expand',
  settings: '#settings-btn',
};

/**
 * 从面板对应的触发按钮取展开原点。
 * 键盘触发时没有有意义的点击坐标，用它把原点补到按钮中心上，
 * 否则卡片会从一个跟动作无关的位置长出来。
 */
export function seedPanelOriginFromTrigger(id: PanelId): void {
  if (origins.has(id)) return;
  const sel = TRIGGER_SELECTOR[id];
  if (!sel) return;
  const el = document.querySelector(sel);
  if (!el) return;
  const r = el.getBoundingClientRect();
  origins.set(id, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
}

export function usePanels(): PanelsApi {
  return {
    isOpen: (id) => state[id],
    open: (id) => {
      seedPanelOriginFromTrigger(id);
      state[id] = true;
    },
    close: (id) => {
      state[id] = false;
    },
    toggle: (id) => {
      if (!state[id]) seedPanelOriginFromTrigger(id);
      state[id] = !state[id];
    },
    closeAll: () => {
      (Object.keys(state) as PanelId[]).forEach((k) => {
        state[k] = false;
      });
    },
  };
}
