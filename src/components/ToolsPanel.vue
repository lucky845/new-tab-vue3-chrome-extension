<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch, type Directive } from 'vue';
import { QUICK_TOOLS } from '@/src/config/tools';
import { createIconNode } from '@/src/lib/iconSafe';
import { usePanels } from '@/src/composables/usePanels';
import GlassPanel from '@/src/components/common/GlassPanel.vue';
import { useTools } from '@/src/composables/useTools';

/**
 * 小工具面板（两层视图：工具宫格 + 单工具详情）。
 *
 * markup 从 entrypoints/newtab.html 470-502 逐字拷贝（id/class/中文文案/层级零改动），
 * 业务语义唯一权威是 v1.8.1:js/app.js 的小工具域，移植映射：
 *   - renderToolsGrid 的 createElement 循环   → v-for + :key（工具是常量，无需每次打开重建）
 *   - btn.addEventListener('click')           → @click
 *   - classList add/remove/toggle('u-hidden') → :class="{ 'u-hidden': ... }"
 *   - title/desc/input.placeholder 赋值        → 插值 + :placeholder
 *   - #tool-input.value / #tool-output.textContent → v-model / 插值（共享状态在 useTools）
 *   - bindToolsEvents 的 meta/ctrl+Enter、点击遮罩关闭、Escape 关闭 → 模板修饰符 + 文档级 keydown
 * 数据层全部在 useTools()，本组件只做 UI 编排；开合状态走 usePanels('tools')。
 */
const { isOpen } = usePanels();
const {
  view,
  input,
  output,
  activeTool,
  isGenerate,
  showGridView,
  showDetail,
  runActive,
  copyResult,
  clearAll,
  closePanel,
} = useTools();

// —— 模板 ref（组件内禁止 document.querySelector；legacy 的 input.focus() 用 ref 落地）——
const inputEl = ref<HTMLTextAreaElement | null>(null);

/**
 * 工具图标：走 iconSafe.createIconNode（内嵌 SVG → 白名单重建的安全节点）。
 * QUICK_TOOLS 的 icon 目前全是 emoji/文本（'⏱'、'{}'、'Aa'…），createIconNode 对
 * 非 SVG/非 URL 返回 null —— 此时回退 textContent 渲染，与 legacy
 * innerHTML 塞文本节点的产出完全一致；若未来换成 SVG 字符串无需改这里。
 */
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

// —— legacy bindToolsEvents（v1.8.1:js/app.js:2358-2402）里的遮罩分支：e.target === panel 时关闭 ——
// —— legacy document keydown Escape（仅面板可见时）关闭 ——
function onDocumentKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isOpen('tools')) closePanel();
}
onMounted(() => document.addEventListener('keydown', onDocumentKeydown));
onUnmounted(() => document.removeEventListener('keydown', onDocumentKeydown));

// —— legacy showToolDetail 的 transform 分支：进入详情后聚焦输入框（v1.8.1:js/app.js:2467）——
// 监听 [面板开合, 视图, 当前工具]，覆盖「从宫格点入」和「从侧卡带 toolId 直开」两条路径。
watch(
  () => [isOpen('tools'), view.value, activeTool.value?.id] as const,
  async ([open, v, toolId]) => {
    if (!open || v !== 'detail' || !toolId) return;
    if (activeTool.value?.kind !== 'transform') return;
    await nextTick();
    inputEl.value?.focus();
  },
);
</script>

<template>
        <!-- 小工具面板 -->
        <GlassPanel
            panelId="tools"
            :open="isOpen('tools')"
            variant="settings"
            elementId="tools-panel"
            @dismiss="closePanel()"
          >
            <div class="settings-content tools-content">
                <div class="tools-panel-header">
                    <h2 id="tools-panel-title">{{ activeTool?.name ?? '小工具' }}</h2>
                    <div class="tools-panel-header-actions">
                        <button id="close-tools-btn" class="close-panel-btn close-btn" title="关闭" @click="closePanel()">✕</button>
                    </div>
                </div>

                <div id="tools-grid-view" :class="{ 'u-hidden': view !== 'grid' }">
                    <p class="api-key-description">
                        纯本地运行，不联网、不上传。输入内容后点「转换 / 生成」，结果可一键复制。
                    </p>
                    <div id="tools-grid" class="tools-grid">
                        <button
                            v-for="tool in QUICK_TOOLS"
                            :key="tool.id"
                            type="button"
                            class="tool-grid-btn"
                            :data-tool-id="tool.id"
                            @click="showDetail(tool.id)"
                        >
                            <span class="tool-grid-icon" v-tool-icon="tool.icon"></span>
                            <span class="tool-grid-name">{{ tool.name }}</span>
                            <span class="tool-grid-desc">{{ tool.desc }}</span>
                        </button>
                    </div>
                </div>

                <div id="tools-detail-view" :class="{ 'u-hidden': view !== 'detail' }">
                    <!-- 返回列表做成面包屑，而不是和右上角 ✕ 并排的第二个按钮：
                         详情页只有一个「退出口」在右上角，返回走内容区的面包屑。 -->
                    <button
                        id="tools-back-btn"
                        class="tools-back-link"
                        :class="{ 'u-hidden': view !== 'detail' }"
                        @click="showGridView()"
                    >← 全部工具</button>
                    <p id="tool-desc" class="api-key-description">{{ activeTool?.desc ?? '' }}</p>
                    <textarea
                        id="tool-input"
                        ref="inputEl"
                        v-model="input"
                        class="tool-input"
                        rows="5"
                        spellcheck="false"
                        :placeholder="activeTool?.placeholder ?? ''"
                        @keydown.meta.enter.prevent="runActive()"
                        @keydown.ctrl.enter.prevent="runActive()"
                    ></textarea>
                    <div class="tools-actions">
                        <button id="tool-run-btn" class="primary" :class="{ 'u-hidden': isGenerate }" @click="runActive()">转换</button>
                        <button id="tool-generate-btn" class="primary" :class="{ 'u-hidden': !isGenerate }" @click="runActive()">生成</button>
                        <button id="tool-copy-btn" @click="copyResult()">复制结果</button>
                        <button id="tool-clear-btn" @click="clearAll()">清空</button>
                    </div>
                    <pre id="tool-output" class="tool-output">{{ output }}</pre>
                </div>
            </div>
        </GlassPanel>
</template>
