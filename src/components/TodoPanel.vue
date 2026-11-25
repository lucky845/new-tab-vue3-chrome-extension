<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import Sortable from 'sortablejs';
import { usePanels } from '@/src/composables/usePanels';
import GlassPanel from '@/src/components/common/GlassPanel.vue';
import { isTodoOverdue, useTodo } from '@/src/composables/useTodo';
import { toast as showToast } from '@/src/composables/useToast';
import {
  TODO_ICONS as ICONS,
  categoryIcon,
  categoryTitle,
  categoryClass,
  dueText as formatDueText,
  todoCategoryKey,
} from '@/src/lib/todo-display';
import { t } from '@/src/composables/useI18n';

/**
 * 待办事项面板。
 *
 * markup 从 entrypoints/newtab.html 234-272 逐字拷贝（id/class/中文文案/SVG/DOM 层级零改动），
 * 业务语义唯一权威是 v1.8.1:js/modules/todo-manager.js + v1.8.1:js/app.js 的
 * bindTodoEvents / renderTodoInto / renderTodoList，移植映射：
 *   - addEventListener        转为 @click / @change / @keydown.enter / @click.self
 *   - classList 操作          转为 :class
 *   - textContent             转为插值
 *   - innerHTML(AppIcons)     转为 v-html（图标为本地常量，非外部输入）
 *   - renderTodoInto 逐个 createElement 转为 v-for + :key
 * 数据层全部在 useTodo()，本组件只做 UI 编排。
 */
const { isOpen, close } = usePanels();
const todoStore = useTodo();
const { filteredTodos, filter, stats, setFilter, addTodo, toggleTodo, removeTodo, updateOrder } =
  todoStore;

// —— 表单状态（legacy：todoInput / todoCategorySelect / todoDueDateInput / todoImportantActive）——
const draft = ref('');
const draftDueDate = ref('');
const importantActive = ref(false);

// —— 模板 ref（组件内禁止 document.querySelector；Sortable 挂点与打开聚焦都用 ref）——
const listEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);

/** 分类图标 / 文案已抽到 @/src/lib/todo-display（与 TodoCard 共享），本组件直接调用 */
// 新待办的分类跟随当前筛选：选了「工作/生活」就落进该分类；
// 「全部」下新增一律落「普通」。这里给出可见提示，让用户知道规则，而非静默猜测。
const categoryHint = computed(() =>
  t('todo_scope_all', { category: t(todoCategoryKey('normal')) }),
);
const categoryHintTitle = computed(() =>
  filter.value === 'all'
    ? t('todo_hint_all', { category: t(todoCategoryKey('normal')) })
    : t('todo_hint_category', { category: categoryTitle(filter.value) }),
);

// 截止日文案与 TodoCard 共享同一份语义；逾期判定仍由 isTodoOverdue 提供
const dueText = (t: import('@/src/composables/useTodo').Todo): string =>
  formatDueText(t.dueDate, isTodoOverdue(t));

// legacy renderTodoList 的 todoCount 文案：'N 项待完成 · 今日完成 N'（逾期 > 0 追加 ⚠️ 段）
const countText = computed(() => {
  const s = stats.value;
  const parts = [t('todo_stats_active', { n: s.active }), t('todo_stats_done_today', { n: s.doneToday })];
  if (s.overdue > 0) parts.push(t('todo_stats_overdue', { n: s.overdue }));
  return parts.join(' · ');
});

// —— 添加（legacy bindTodoEvents 的 add：trim 非空校验 → addTodo → 清空输入与截止日；重要标记与分类保持不动）——
async function add(): Promise<void> {
  const content = draft.value.trim();
  if (!content) {
    showToast(t('todo_toast_empty'), 'error');
    return;
  }
  await addTodo(content, {
    important: importantActive.value,
    category: filter.value === 'all' ? 'normal' : filter.value,
    dueDate: draftDueDate.value || null,
  });
  draft.value = '';
  draftDueDate.value = '';
}

// —— 清除已完成（legacy：清除数 > 0 才提示成功）——
// 组件包装与数据层 clearDone 同名是刻意的：UI 提示留在组件层，数据动作走 todoStore
async function clearDone(): Promise<void> {
  const removed = await todoStore.clearDone();
  if (removed > 0) showToast(t('todo_toast_cleared', { n: removed }), 'success');
}

// —— 面板打开时聚焦输入框（legacy：todoBtn click → renderTodoList → todoInput.focus() 的聚焦部分）——
watch(
  () => isOpen('todo'),
  async (open) => {
    if (!open) return;
    await nextTick();
    inputEl.value?.focus();
  },
);

// —— 拖拽排序（SortableJS，仅初始化一次；animation/filter/preventOnFilter/delay 参数与 legacy 完全一致）——
let sortable: Sortable | null = null;

onMounted(() => {
  const el = listEl.value;
  if (!el || sortable) return;
  sortable = Sortable.create(el, {
    animation: 150,
    // 复选框 / 删除按钮不参与拖拽，否则按住它们会启动拖拽而吞掉 click
    filter: 'input, button, .todo-delete-btn, .todo-check',
    preventOnFilter: false,
    delay: 120,
    delayOnTouchOnly: true,
    onEnd: async () => {
      // legacy 语义：按渲染后的 id 顺序回写；过滤态下未出现在 DOM 的项由 updateOrder 兜底追加尾部
      const ids = [...el.children]
        .map((li) => (li as HTMLElement).dataset?.id)
        .filter((id): id is string => Boolean(id));
      if (ids.length) {
        await updateOrder(ids);
        showToast(t('todo_toast_order_saved'), 'success', 1200);
      }
    },
  });
});

onUnmounted(() => {
  sortable?.destroy();
  sortable = null;
});
</script>

<template>
  <!-- 待办事项面板 -->
  <GlassPanel
    panelId="todo"
    :open="isOpen('todo')"
    variant="widget"
    elementId="todo-panel"
    labelled-by="todo-panel-title"
    @dismiss="close('todo')"
  >
    <div class="widget-content">
      <div class="widget-header">
        <h2 id="todo-panel-title">{{ t('todo_panel_title') }}</h2>
        <button id="close-todo-btn" class="control-btn widget-close-btn" :title="t('common_close')" :aria-label="t('common_close')" @click="close('todo')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div id="todo-filter-bar" class="todo-filter-bar">
        <button class="todo-filter-tab" :class="{ active: filter === 'all' }" @click="setFilter('all')">{{ t('todo_filter_all') }}</button>
        <button class="todo-filter-tab" :class="{ active: filter === 'work' }" @click="setFilter('work')"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg> {{ t(todoCategoryKey('work')) }}</button>
        <button class="todo-filter-tab" :class="{ active: filter === 'life' }" @click="setFilter('life')"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"></path><path d="M5 9.5V21h14V9.5"></path><path d="M10 21v-6h4v6"></path></svg> {{ t(todoCategoryKey('life')) }}</button>
        <button class="todo-filter-tab" :class="{ active: filter === 'normal' }" @click="setFilter('normal')"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8M8 17h5"></path></svg> {{ t(todoCategoryKey('normal')) }}</button>
      </div>
      <div class="todo-input-row">
        <button id="todo-important-btn" class="todo-important-btn" :class="{ active: importantActive }" :title="t('todo_mark_important')" :aria-label="t('todo_mark_important')" :aria-pressed="importantActive" @click="importantActive = !importantActive">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
        <input type="text" id="todo-input" ref="inputEl" v-model="draft" :placeholder="t('todo_input_placeholder')" maxlength="100" @keydown.enter="add" />
        <span id="todo-category-hint" class="todo-category-hint" :title="categoryHintTitle">{{ categoryHint }}</span>
        <input type="date" id="todo-due-date" class="todo-due-date" :title="t('todo_due_date_label')" v-model="draftDueDate" />
        <button id="todo-add-btn" class="settings-btn" @click="add">{{ t('common_add') }}</button>
      </div>
      <ul id="todo-list" class="todo-list" ref="listEl">
        <!-- 空态与 NotesPanel 的 notes-empty 同一语义：有筛选 = 该分类无匹配；否则 = 首跑引导 -->
        <li v-if="filteredTodos.length === 0" class="todo-empty">
          {{ filter === 'all' ? t('todo_empty_all') : t('todo_empty_category') }}
        </li>
        <li
          v-for="todo in filteredTodos"
          :key="todo.id"
          :data-id="todo.id"
          class="todo-item"
          :class="[categoryClass(todo.category), { done: todo.done, important: todo.important, overdue: isTodoOverdue(todo) }]"
        >
          <input type="checkbox" :checked="todo.done" @change="toggleTodo(todo.id)" />
          <!-- 仅重要项渲染星标：空占位会拉大勾选框与内容区之间的间距 -->
          <span v-if="todo.important" class="todo-star" :title="t('todo_important')">★</span>
          <span
            class="todo-cat-badge"
            :class="categoryClass(todo.category)"
            :title="categoryTitle(todo.category)"
            v-html="categoryIcon(todo.category)"
          ></span>
          <span class="todo-text">{{ todo.content }}</span>
          <span class="todo-due">{{ dueText(todo) }}</span>
          <button
            class="todo-delete-btn"
            :title="t('common_delete')"
            :aria-label="t('todo_delete_aria')"
            @click.stop="removeTodo(todo.id)"
            v-html="ICONS.trash"
          ></button>
        </li>
      </ul>
      <div class="todo-footer">
        <span id="todo-count">{{ countText }}</span>
        <button id="todo-clear-done-btn" class="link-btn" @click="clearDone">{{ t('todo_clear_done') }}</button>
      </div>
    </div>
  </GlassPanel>
</template>
