/**
 * 小工具面板状态机（Vue 版）——移植自 v1.8.1:js/app.js 的小工具域：
 *   openToolsPanel / closeToolsPanel / showToolsGridView / showToolDetail /
 *   runActiveTool / copyToolResult（renderToolsGrid 由 ToolsPanel.vue 的 v-for 取代）。
 *
 * 状态是模块级共享（与 usePanels 同模式）：ToolsPanel.vue 与主页右翼侧卡
 * （legacy renderToolsCard 的 #tools-card-grid / #tools-card-expand，属于侧卡组件域）
 * 共用同一份，侧卡用 openPanel(toolId) / featuredTools 接管 legacy 的入口绑定。
 *
 * 工具定义与语义全部来自 src/config/tools.ts（QUICK_TOOLS / QUICK_TOOLS_FEATURED），零网络、零存储：
 * legacy tools 域没有写任何 chrome.storage key，这里同样无持久化。
 */
import { computed, ref } from 'vue';
import { QUICK_TOOLS, QUICK_TOOLS_FEATURED, type QuickTool } from '@/src/config/tools';
import { usePanels } from '@/src/composables/usePanels';
import { toast as showToast } from '@/src/composables/useToast';
import { copyText } from '@/src/lib/clipboard';

/** legacy 的两层视图：宫格（grid）+ 详情（detail），与 #tools-grid-view / #tools-detail-view 对应 */
export type ToolsView = 'grid' | 'detail';

// —— 模块级共享状态 ——
// view/activeToolId 对应 legacy this.activeToolId + 两个视图的 u-hidden 互斥；
// input/output 对应 #tool-input.value / #tool-output.textContent。
const view = ref<ToolsView>('grid');
const activeToolId = ref<string | null>(null);
const input = ref('');
const output = ref('');

export function useTools() {
  const panels = usePanels();

  /** legacy this.quickTools.find(t => t.id === this.activeToolId) */
  const activeTool = computed<QuickTool | null>(
    () => QUICK_TOOLS.find((t) => t.id === activeToolId.value) ?? null,
  );

  /** legacy showToolDetail 里的 isGenerate（决定 转换/生成 按钮互斥与自动运行） */
  const isGenerate = computed(() => activeTool.value?.kind === 'generate');

  /**
   * legacy renderToolsCard（v1.8.1:js/app.js:2322-2339）的数据源：
   * QUICK_TOOLS_FEATURED 6 个 id 按 QUICK_TOOLS 定义顺序映射回工具对象（过滤不存在的 id）。
   * 侧卡组件用它渲染 tool-mini-btn，点击走 openPanel(tool.id)。
   */
  const featuredTools = computed<QuickTool[]>(() =>
    QUICK_TOOLS_FEATURED.map((id) => QUICK_TOOLS.find((t) => t.id === id)).filter(
      (t): t is QuickTool => Boolean(t),
    ),
  );

  /** legacy showToolsGridView（v1.8.1:js/app.js:2422-2434）：回宫格、清 activeToolId、标题复位由组件插值完成 */
  function showGridView(): void {
    view.value = 'grid';
    activeToolId.value = null;
  }

  /**
   * legacy showToolDetail（v1.8.1:js/app.js:2435-2469）：找不到工具直接返回（行为一致）；
   * 清输入/输出；generate 工具立即自动运行一次；transform 工具由组件层在
   * DOM 就绪后 focus 输入框（legacy 的 input.focus()）。
   */
  function showDetail(toolId: string): void {
    const tool = QUICK_TOOLS.find((t) => t.id === toolId);
    if (!tool) return;
    activeToolId.value = toolId;
    input.value = '';
    output.value = '';
    view.value = 'detail';
    if (tool.kind === 'generate') void runActive();
  }

  /**
   * legacy runActiveTool（v1.8.1:js/app.js:2470-2493）：
   * generate → action()；transform → 空输入清空输出并返回，否则 run(input)（可 async）。
   * 任何异常输出「执行失败: {message}」。
   * 注：config/tools.ts 里所有 transform 都定义了 run、generate 都定义了 action，
   * 接口把两者标成可选只为类型完备，这里的断言与 legacy 直调语义一致。
   */
  async function runActive(): Promise<void> {
    const tool = activeTool.value;
    if (!tool) return;
    try {
      let result: string;
      if (tool.kind === 'generate') {
        const action = tool.action as () => string;
        result = action();
      } else {
        if (!input.value.trim()) {
          output.value = '';
          return;
        }
        const run = tool.run as (input: string) => string | Promise<string>;
        result = await run(input.value);
      }
      output.value = result;
    } catch (error) {
      output.value = `执行失败: ${(error as Error).message}`;
    }
  }

  /**
   * legacy copyToolResult（v1.8.1:js/app.js:2494-2519）：空结果 warning 提示；
   * navigator.clipboard.writeText 失败时降级 textarea + execCommand('copy')。
   */
  async function copyResult(): Promise<void> {
    const text = output.value;
    if (!text) {
      showToast('没有可复制的结果', 'warning', 1800);
      return;
    }
    // 剪贴板降级逻辑收敛在 src/lib/clipboard.ts，备份页共用同一实现
    const ok = await copyText(text);
    if (ok) showToast('已复制到剪贴板', 'success', 1600);
    else showToast('复制失败，请手动选择复制', 'error', 2200);
  }

  /** legacy bindToolsEvents（v1.8.1:js/app.js:2358-2402）里的清空按钮：清输入 + 清输出 */
  function clearAll(): void {
    input.value = '';
    output.value = '';
  }

  /**
   * legacy openToolsPanel（v1.8.1:js/app.js:2403-2415）。两条入口都归到这里：
   *   - 侧卡展开按钮 #tools-card-expand（无参）→ 宫格视图；
   *   - 侧卡 mini 工具按钮（renderToolsCard 产出，带 tool.id）→ 直开详情。
   * renderToolsGrid 的重建由 ToolsPanel.vue 的 v-for 静态渲染取代（工具是常量，无重建必要）。
   */
  function openPanel(toolId: string | null = null): void {
    panels.open('tools');
    if (toolId) showDetail(toolId);
    else showGridView();
  }

  /** legacy closeToolsPanel（v1.8.1:js/app.js:2416-2421）：关面板 + activeToolId 置空（视图不重置，与 legacy 一致） */
  function closePanel(): void {
    panels.close('tools');
    activeToolId.value = null;
  }

  return {
    // 状态
    view,
    activeToolId,
    input,
    output,
    activeTool,
    isGenerate,
    featuredTools,
    // 动作
    showGridView,
    showDetail,
    runActive,
    copyResult,
    clearAll,
    openPanel,
    closePanel,
  };
}
