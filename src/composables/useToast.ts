/**
 * Toast —— Vue 队列版
 * --------------------------------------------------------------------
 * 无锚点 Toast 收口为一个 reactive 队列，由 <ToastHost> 组件统一渲染。
 * 这样「改一处样式」真正生效：样式真源在 public/theme/app.css 的 .dsh-tip
 * 族，组件只负责出队列/计时/进出场，不在运行时注入样式、不拼裸 DOM。
 * 对外 toast(message, type, duration) 签名不变，调用点零改动。
 *
 * 锚定提示（带箭头、跟随元素）仍走 useTip.ts 的 attachTip —— 那类提示要
 * 定位与翻转，保持命令式实现，样式同样吃 app.css 的 .dsh-tip 族。
 */
import { reactive, readonly } from 'vue';

const FALLBACK_DURATION = 2600;
const KNOWN_TYPES = ['success', 'warning', 'error', 'info', 'loading'] as const;
export type ToastType = (typeof KNOWN_TYPES)[number];

export interface ToastItem {
    id: number;
    message: string;
    type: ToastType;
}

const items: ToastItem[] = reactive([]);
let nextId = 1;
const timers = new Map<number, number>();

function dismiss(id: number): void {
    const timer = timers.get(id);
    if (timer != null) {
        window.clearTimeout(timer);
        timers.delete(id);
    }
    const i = items.findIndex((t) => t.id === id);
    if (i >= 0) items.splice(i, 1);
}

/** toast(message, type, duration)：duration 缺省 2600，显式 0 表示常驻。 */
export function toast(message: string, type: string = 'info', duration?: number): void {
    const known = (KNOWN_TYPES as readonly string[]).includes(type);
    const effective = duration == null ? FALLBACK_DURATION : duration;
    const id = nextId++;
    items.push({ id, message, type: known ? (type as ToastType) : 'info' });
    if (effective > 0) {
        timers.set(id, window.setTimeout(() => dismiss(id), effective));
    }
}

export function useToastQueue() {
    return { items: readonly(items), dismiss } as const;
}

export function useToast() {
    return { toast } as const;
}
