import type { Directive } from 'vue';
import { applyGlass, releaseGlass, type GlassOptions } from '@/src/lib/glass';

/** `v-glass` 指令：挂载即上玻璃，卸载即释放。参数与 applyGlass 一致。 */
export const vGlass: Directive<HTMLElement, GlassOptions | undefined> = {
  mounted(el, binding) {
    applyGlass(el, binding.value);
  },
  updated(el, binding) {
    if (binding.value !== binding.oldValue) applyGlass(el, binding.value);
  },
  unmounted(el) {
    releaseGlass(el);
  },
};
