/**
 * 面板焦点陷阱的判定层（纯函数，不读写 DOM）。
 *
 * 为什么要抽出来：焦点陷阱只有一处真正有价值的判定——「Tab/Shift+Tab 按到边缘时该跳到
 * 哪一个」。把这段从 DOM 接线里剥出来，Vitest（node 环境，无 jsdom）就能直接覆盖
 * 边界；DOM 侧（useFocusTrap.ts）只负责取元素、算下标、调 focus。
 *
 * 语义与 src/composables/useDialog.ts 里对话框的手写循环一致，只是从三元素硬编码
 * 换成通用列表。
 */

/**
 * 可聚焦元素的选择器。覆盖原生可聚焦标签与显式 tabindex，与 useDialog 的候选集合
 * 对齐，但多出 textarea/select/[contenteditable]。
 *
 * 注意不写 :not([disabled])：disabled 元素本来就不会被 querySelectorAll 的
 * :not([disabled]) 之外命中——这里保留 disabled 元素，交由 isTabbable 统一过滤，
 * 免得在多处各写一遍过滤逻辑。
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[tabindex]',
  '[contenteditable="true"]',
].join(',');

/** 一次 Tab 判定的输入 */
export interface TabRequest {
  /** 面板内可聚焦元素的数量（0 表示面板里没有可聚焦元素） */
  count: number;
  /** document.activeElement 在列表中的下标；-1 表示焦点还在面板外 */
  activeIndex: number;
  /** 是否 Shift+Tab（反向） */
  shift: boolean;
}

/**
 * 算出这次 Tab 该跳到的下标。
 *
 * 返回 null 表示「不需要干预，浏览器默认行为即可」：既没有到边缘、也没有焦点在面板外。
 * 返回下标时，调用方必须 preventDefault 后把该元素设为焦点——否则浏览器的默认 Tab
 * 会跳走，这里算出的结果被默认行为冲掉。
 *
 * 三条边界：
 *   1. 面板内无可聚焦元素（count<=0）：null，交调用方自行回退（把焦点放在面板根上）
 *   2. 焦点在面板外（activeIndex<0）：正向跳 0，反向跳最后一个
 *   3. 正向停在最后一个 → 回 0；反向停在第一个 → 回最后一个
 */
export function trapTabTarget(request: TabRequest): number | null {
  const { count, activeIndex, shift } = request;
  if (count <= 0) return null;
  if (activeIndex < 0) return shift ? count - 1 : 0;
  if (shift && activeIndex === 0) return count - 1;
  if (!shift && activeIndex === count - 1) return 0;
  return null;
}
