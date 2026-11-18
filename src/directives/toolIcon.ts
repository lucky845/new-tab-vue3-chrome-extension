/**
 * 工具图标渲染指令 —— ToolsCard（迷你卡）与 ToolsPanel（详情面板）共用。
 *
 * 原本两个组件各自写了一份 renderToolIcon + vToolIcon（逐字重复），任一方调整
 * 安全节点回退逻辑，另一方就会漂移。这里把指令收成单一实现：
 *   - icon 走 iconSafe.createIconNode（内嵌 SVG 白名单重建）；
 *   - emoji/纯文本（QUICK_TOOLS 的 '⏱' / '{}' / 'Aa'）createIconNode 返回 null，
 *     回退 textContent，与 legacy innerHTML 塞文本节点的产出逐字节一致。
 *
 * 指令 mounted/updated 都渲染；updated 里同值时跳过，避免无谓 DOM 重建。
 */
import type { Directive } from 'vue';
import { createIconNode } from '@/src/lib/iconSafe';

function renderToolIcon(el: HTMLElement, icon: string): void {
  el.replaceChildren();
  const node = createIconNode(icon);
  if (node) el.appendChild(node);
  else el.textContent = icon;
}

export const vToolIcon: Directive<HTMLElement, string> = {
  mounted(el, binding) {
    renderToolIcon(el, binding.value);
  },
  updated(el, binding) {
    if (binding.value === binding.oldValue) return;
    renderToolIcon(el, binding.value);
  },
};
