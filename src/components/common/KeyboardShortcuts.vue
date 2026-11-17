<script lang="ts">
// 组件不产出任何 DOM（快捷键是纯副作用）。render 返回 null，
// 而不是留一个空 <template> 节点——空模板既过不了 vue/valid-template-root，
// 也会往页面里塞一个无意义的包裹元素。
export default { name: 'KeyboardShortcuts', render: () => null };
</script>

<script setup lang="ts">
/**
 * 键盘快捷键（v2.2 Wave B）
 * --------------------------------------------------------------------
 * 组合定义在 src/config/shortcuts.ts（同一份清单还被设置面板用来渲染说明）。
 *   Alt+S 聚焦搜索    Alt+K 设置    Alt+T 小工具    Alt+W 壁纸
 *   Alt+A 待办        Alt+N 便签    Alt+P 番茄钟    Alt+Shift+W 收起全部面板
 *
 * 三条硬约束，缺一条就会踩坏别处：
 *   1. 输入态不拦截：焦点在 input/textarea/select/contenteditable 上时直接返回，
 *      否则用户打字按 Alt+S 会被抢走焦点。
 *   2. 组合键让位：带 ctrl/meta 的一律不处理（系统级快捷键不能截）。
 *   3. 模态优先：确认对话框打开、文件夹浮层打开、图标拖拽进行中都不响应——
 *      这三种场景里按键另有语义（Esc 取消、方向键移动等）。
 */
import { onMounted, onUnmounted } from 'vue';
import { SHORTCUT_MAP } from '@/src/config/shortcuts';
import { seedPanelOriginFromTrigger, usePanels } from '@/src/composables/usePanels';

const panels = usePanels();

/** 焦点是否落在可输入元素上。 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/** 是否有模态浮层/拖拽占着键盘。 */
function hasBlockingOverlay(): boolean {
  if (document.body.classList.contains('icon-dragging')) return true;
  // useDialog 的确认框直接挂 body（不在任何面板内），打开时独占键盘
  if (document.querySelector('.dsh-dialog')) return true;
  const folder = document.getElementById('folder-overlay');
  return !!folder && !folder.classList.contains('u-hidden');
}

function focusSearch(): void {
  const input = document.getElementById('search-input');
  if (!(input instanceof HTMLInputElement)) return;
  input.focus({ preventScroll: true });
  // 连同已有关键词一起选中，符合「按快捷键回到搜索」的预期
  input.select();
}

function onKeyDown(e: KeyboardEvent): void {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  // 长按产生的重复事件不重复触发
  if (e.repeat) return;
  if (isTypingTarget(e.target)) return;
  if (hasBlockingOverlay()) return;

  const def = SHORTCUT_MAP[`${e.shiftKey ? 'shift+' : ''}${e.key.toLowerCase()}`];
  if (!def) return;
  e.preventDefault();

  if (def.action === 'focus-search') {
    focusSearch();
    return;
  }
  if (def.action === 'close-all') {
    panels.closeAll();
    return;
  }
  if (def.panel) {
    // 键盘触发没有点击坐标，用触发按钮中心补原点，卡片仍从按钮处长出来
    seedPanelOriginFromTrigger(def.panel);
    if (!panels.isOpen(def.panel)) panels.open(def.panel);
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));
</script>

