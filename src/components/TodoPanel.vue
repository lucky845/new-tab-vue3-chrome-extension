<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import Sortable from 'sortablejs';
import { panelOriginStyle, usePanels } from '@/src/composables/usePanels';
import { isTodoOverdue, useTodo, type Todo, type TodoCategory } from '@/src/composables/useTodo';
import { toast as showToast } from '@/src/composables/useToast';

/**
 * 待办事项面板。
 *
 * markup 从 entrypoints/newtab.html 234-272 逐字拷贝（id/class/中文文案/SVG/DOM 层级零改动），
 * 业务语义唯一权威是 public/legacy-js/modules/todo-manager.js + app.js 的
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
const draftCategory = ref('normal');
const draftDueDate = ref('');
const importantActive = ref(false);

// —— 模板 ref（组件内禁止 document.querySelector；Sortable 挂点与打开聚焦都用 ref）——
const listEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);

/** legacy AppIcons（public/legacy-js/app.js 第 6、10-12 行逐字拷贝，视觉零漂移） */
const ICONS = {
  trash: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`,
  catWork: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>`,
  catLife: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"></path><path d="M5 9.5V21h14V9.5"></path><path d="M10 21v-6h4v6"></path></svg>`,
  catNormal: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8M8 17h5"></path></svg>`,
} as const;

// legacy：{ work: 'catWork', life: 'catLife', normal: 'catNormal' }[category] || 'catNormal'
function categoryIcon(category: TodoCategory | undefined): string {
  const map: Record<TodoCategory, string> = {
    work: ICONS.catWork,
    life: ICONS.catLife,
    normal: ICONS.catNormal,
  };
  return map[category ?? 'normal'] ?? ICONS.catNormal;
}

// legacy：{ work: '工作', life: '生活', normal: '普通' }[category] || '普通'
function categoryTitle(category: TodoCategory | undefined): string {
  const map: Record<TodoCategory, string> = { work: '工作', life: '生活', normal: '普通' };
  return map[category ?? 'normal'] ?? '普通';
}

// legacy：逾期时 '⚠️ {date} 已逾期'，否则 '📅 {date}'；无截止日期渲染空 span
function dueText(t: Todo): string {
  if (!t.dueDate) return '';
  return isTodoOverdue(t) ? `⚠️ ${t.dueDate} 已逾期` : `📅 ${t.dueDate}`;
}

// legacy renderTodoList 的 todoCount 文案：'N 项待完成 · 今日完成 N'（逾期 > 0 追加 ⚠️ 段）
const countText = computed(() => {
  const s = stats.value;
  const parts = [`${s.active} 项待完成`, `今日完成 ${s.doneToday}`];
  if (s.overdue > 0) parts.push(`⚠️ ${s.overdue} 项已逾期`);
  return parts.join(' · ');
});

// —— 添加（legacy bindTodoEvents 的 add：trim 非空校验 → addTodo → 清空输入与截止日；重要标记与分类保持不动）——
async function add(): Promise<void> {
  const content = draft.value.trim();
  if (!content) {
    showToast('请输入待办内容', 'error');
    return;
  }
  await addTodo(content, {
    important: importantActive.value,
    category: draftCategory.value,
    dueDate: draftDueDate.value || null,
  });
  draft.value = '';
  draftDueDate.value = '';
}

// —— 清除已完成（legacy：清除数 > 0 才提示成功）——
// 组件包装与数据层 clearDone 同名是刻意的：UI 提示留在组件层，数据动作走 todoStore
async function clearDone(): Promise<void> {
  const removed = await todoStore.clearDone();
  if (removed > 0) showToast(`已清除 ${removed} 条已完成待办`, 'success');
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
        showToast('排序已保存', 'success', 1200);
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
  <div
    id="todo-panel"
    :style="panelOriginStyle('todo')"
    class="widget-panel"
    :class="{ 'u-hidden': !isOpen('todo') }"
    @click.self="close('todo')"
  >
    <div class="widget-content">
      <div class="widget-header">
        <h2>待办事项</h2>
        <button id="close-todo-btn" class="control-btn widget-close-btn" title="关闭" @click="close('todo')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div id="todo-filter-bar" class="todo-filter-bar">
        <button class="todo-filter-tab" :class="{ active: filter === 'all' }" @click="setFilter('all')">全部</button>
        <button class="todo-filter-tab" :class="{ active: filter === 'work' }" @click="setFilter('work')"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg> 工作</button>
        <button class="todo-filter-tab" :class="{ active: filter === 'life' }" @click="setFilter('life')"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"></path><path d="M5 9.5V21h14V9.5"></path><path d="M10 21v-6h4v6"></path></svg> 生活</button>
        <button class="todo-filter-tab" :class="{ active: filter === 'normal' }" @click="setFilter('normal')"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8M8 17h5"></path></svg> 普通</button>
      </div>
      <div class="todo-input-row">
        <button id="todo-important-btn" class="todo-important-btn" :class="{ active: importantActive }" title="重要标记" @click="importantActive = !importantActive">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
        <input type="text" id="todo-input" ref="inputEl" v-model="draft" placeholder="添加一个待办…" maxlength="100" @keydown.enter="add" />
        <select id="todo-category-select" class="todo-category-select" title="分类" v-model="draftCategory">
          <option value="normal">普通</option>
          <option value="work">工作</option>
          <option value="life">生活</option>
        </select>
        <input type="date" id="todo-due-date" class="todo-due-date" title="截止日期（可选）" v-model="draftDueDate" />
        <button id="todo-add-btn" class="settings-btn" @click="add">添加</button>
      </div>
      <ul id="todo-list" class="todo-list" ref="listEl">
        <li
          v-for="todo in filteredTodos"
          :key="todo.id"
          :data-id="todo.id"
          class="todo-item"
          :class="[`cat-${todo.category || 'normal'}`, { done: todo.done, important: todo.important, overdue: isTodoOverdue(todo) }]"
        >
          <input type="checkbox" :checked="todo.done" @change="toggleTodo(todo.id)" />
          <!-- 仅重要项渲染星标：空占位会拉大勾选框与内容区之间的间距 -->
          <span v-if="todo.important" class="todo-star" title="重要">★</span>
          <span
            class="todo-cat-badge"
            :class="`cat-${todo.category || 'normal'}`"
            :title="categoryTitle(todo.category)"
            v-html="categoryIcon(todo.category)"
          ></span>
          <span class="todo-text">{{ todo.content }}</span>
          <span class="todo-due">{{ dueText(todo) }}</span>
          <button
            class="todo-delete-btn"
            title="删除"
            aria-label="删除待办"
            @click.stop="removeTodo(todo.id)"
            v-html="ICONS.trash"
          ></button>
        </li>
      </ul>
      <div class="todo-footer">
        <span id="todo-count">{{ countText }}</span>
        <button id="todo-clear-done-btn" class="link-btn" @click="clearDone">清除已完成</button>
      </div>
    </div>
  </div>
</template>
