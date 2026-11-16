<script setup lang="ts">
/**
 * 主页右翼小工具迷你卡 —— markup 逐字来自 entrypoints/newtab.html:216-222（#side-card-tools）。
 *
 * legacy 映射（public/legacy-js/app.js）：
 * - renderToolsCard（669-686）：QUICK_TOOLS_FEATURED → tool-mini-btn（data-tool-id / title / 图标 + 名称）
 * - 交互由组件自持：mini 工具键 @click → openPanel(tool.id) 直开详情；
 *   展开键 @click → usePanels().toggle('tools')（沿用 legacy 的开合语义）。
 *
 * 图标走 iconSafe.createIconNode：QUICK_TOOLS 的 icon 是 emoji/文本（⏱ / {} / Aa / 🔑）
 * 而非 SVG 名，createIconNode 返回 null 时回退 textContent，与 legacy innerHTML 逐字节一致。
 */
import type { Directive } from 'vue';
import { createIconNode } from '@/src/lib/iconSafe';
import { useTools } from '@/src/composables/useTools';
import { setPanelOriginFromEvent, usePanels } from '@/src/composables/usePanels';
import { useSideCards } from '@/src/composables/useSideCards';

// 侧卡自持点击逻辑，不再由 App.vue 在 #tools-card-grid 上做事件委托
const { visible } = useSideCards();

const { featuredTools, openPanel: openToolsPanel } = useTools();
const { toggle } = usePanels();

/** 记录展开原点后开合：面板卡片从被点的这颗按钮长出来（见 app.css 的 --panel-origin）。 */
function openPanel(id: Parameters<typeof toggle>[0], ev: MouseEvent): void {
  setPanelOriginFromEvent(id, ev);
  toggle(id);
}

/** mini 工具键：直开详情，同时把原点写成被点的那颗键。 */
function openToolDetail(toolId: string, ev: MouseEvent): void {
  setPanelOriginFromEvent('tools', ev);
  openToolsPanel(toolId);
}

function renderToolIcon(el: HTMLElement, icon: string): void {
  el.replaceChildren();
  const node = createIconNode(icon);
  if (node) el.appendChild(node);
  else el.textContent = icon;
}

const vToolIcon: Directive<HTMLElement, string> = {
  mounted(el, binding) {
    renderToolIcon(el, binding.value);
  },
  updated(el, binding) {
    if (binding.value === binding.oldValue) return;
    renderToolIcon(el, binding.value);
  },
};
</script>

<!-- prettier-ignore -->
<template>
    <section v-show="visible('tools')" class="side-card" id="side-card-tools">
        <header class="side-card-header">
            <h3>小工具</h3>
            <button id="tools-card-expand" class="side-expand-btn" title="打开全部工具" @click="openPanel('tools', $event)">⤢</button>
        </header>
        <div id="tools-card-grid" class="tools-mini-grid">
            <button
                v-for="tool in featuredTools"
                :key="tool.id"
                type="button"
                class="tool-mini-btn"
                :data-tool-id="tool.id"
                :title="tool.name + ' · ' + tool.desc"
                @click="openToolDetail(tool.id, $event)"
            >
                <span class="tool-mini-icon" v-tool-icon="tool.icon"></span>
                <span class="tool-mini-name">{{ tool.name }}</span>
            </button>
        </div>
    </section>
</template>
