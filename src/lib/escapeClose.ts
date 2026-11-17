/**
 * Esc 关窗的判定层（纯函数，不读写 DOM）。
 *
 * 为什么要把「按 Esc 该关谁」抽出来：面板、文件夹浮层、右键菜单、搜索下拉各有一层，
 * 全都自己监听 keydown 就会一次关一片（或者关错层）。这里只回答一个问题——
 * 给定当前打开的浮层栈和几个「谁在抢 Esc」的旁证，应该关哪一个？
 *
 * 判定优先级（从高到低）：
 *   1. 模态对话框（.dsh-dialog）——它自己的 capture 监听已经 preventDefault，这里再判一次
 *   2. 拖拽进行中——Esc 的语义是「取消拖拽」，不是「关掉拖拽所在的浮层」
 *   3. 层级 z 最高的那一层；同层取最后打开的那个（order 最大）
 *
 * 层级与 app.css:277-280 的 --z-* 阶梯对齐：settings/widget 是 --z-overlay，
 * folder 是 --z-popover（更高），对话框走 --z-confirm（不在这里，它是第 1 条）。
 */

/** 一个可被 Esc 关闭的浮层 */
export interface EscapeEntry {
  /** 浮层身份，只用于挑层，不参与业务 */
  id: string;
  /** 层级，越大越靠上 */
  z: number;
  /** 打开顺序，越大越晚打开；同层时用它决定关最上面那个 */
  order: number;
}

/** 旁证：这两件事发生时，Esc 有别的归属 */
export interface EscapeEnvironment {
  /** 存在模态对话框：Esc 归它，面板不动 */
  dialogOpen: boolean;
  /** 拖拽中：Esc 归「取消拖拽」 */
  dragging: boolean;
}

/** 玻璃外壳 variant → 层级，和 app.css 的 z-index 阶梯保持同源 */
export const ESCAPE_Z_BY_VARIANT: Record<'settings' | 'widget' | 'folder', number> = {
  settings: 5000,
  widget: 5000,
  folder: 6000,
};

/**
 * 挑出 Esc 应该关闭的那一层。
 *
 * 返回 null 表示「这次 Esc 不该关面板」：要么没有任何浮层，要么对话框/拖拽正在占用 Esc。
 * 入参数组只读，不排序、不修改——调用方传进来的栈顺序无关，判定只依赖 z/order 两个数。
 */
export function pickEscapeTarget(entries: EscapeEntry[], env: EscapeEnvironment): string | null {
  if (env.dialogOpen || env.dragging) return null;
  let best: EscapeEntry | null = null;
  for (const entry of entries) {
    if (!best) {
      best = entry;
      continue;
    }
    // 只在严格更靠上时才换人：平级平序保持先到者，避免浮层数组抖动导致误关
    if (entry.z > best.z || (entry.z === best.z && entry.order > best.order)) best = entry;
  }
  return best ? best.id : null;
}
