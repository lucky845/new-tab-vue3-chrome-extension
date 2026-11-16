<script setup lang="ts">
/**
 * 主页左翼待办迷你卡 —— markup 逐字来自 entrypoints/newtab.html:192-201（#side-card-todo）。
 *
 * legacy 映射（public/legacy-js/app.js）：
 * - renderTodoCard（910-918）：全量 getTodos() + 徽标 getStats().active → todos / stats
 * - renderTodoInto（844-908）：li 结构（勾选/星标/分类/文本/截止日/删除）→ v-for 模板
 * - bindSideWidgets（1349-1362）：#todo-card-input Enter 快速添加、trim 后为空不添加
 * - 展开按钮（1367）：panelBtn.click() → usePanels().toggle('todo')
 *
 * 与 TodoPanel 共享 useTodo 单例；侧卡不挂 Sortable（legacy 侧卡本来也没有）。
 */
import { ref } from 'vue';
import { setPanelOriginFromEvent, usePanels } from '@/src/composables/usePanels';
import { useTodo, isTodoOverdue, type Todo, type TodoCategory } from '@/src/composables/useTodo';
import { toast as showToast } from '@/src/composables/useToast';
import { useSideCards } from '@/src/composables/useSideCards';

const { visible } = useSideCards();

const { toggle } = usePanels();

/** 记录展开原点后开合：面板卡片从被点的这颗按钮长出来（见 app.css 的 --panel-origin）。 */
function openPanel(id: Parameters<typeof toggle>[0], ev: MouseEvent): void {
  setPanelOriginFromEvent(id, ev);
  toggle(id);
}
const { todos, stats, addTodo, toggleTodo, removeTodo } = useTodo();

/** 快速添加输入框（legacy todoInput.value） */
const draft = ref('');

/** legacy AppIcons（public/legacy-js/app.js 第 6、10-12 行逐字拷贝，视觉零漂移） */
const ICONS = {
  trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>',
  catWork: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>',
  catLife: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"></path><path d="M5 9.5V21h14V9.5"></path><path d="M10 21v-6h4v6"></path></svg>',
  catNormal: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8M8 17h5"></path></svg>',
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

function categoryClass(category: TodoCategory | undefined): string {
  return 'cat-' + (category || 'normal');
}

// legacy：逾期时 '⚠️ {date} 已逾期'，否则 '📅 {date}'；无截止日期渲染空 span
function dueText(t: Todo): string {
  if (!t.dueDate) return '';
  return isTodoOverdue(t) ? '⚠️ ' + t.dueDate + ' 已逾期' : '📅 ' + t.dueDate;
}

async function quickAdd(): Promise<void> {
  const content = draft.value.trim();
  if (!content) {
    showToast('请输入待办内容', 'error');
    return;
  }
  await addTodo(content, { category: 'normal' });
  draft.value = '';
}
</script>

<!-- prettier-ignore -->
<template>
    <section v-show="visible('todo')" class="side-card" id="side-card-todo">
        <header class="side-card-header">
            <h3>待办<span id="todo-card-badge" class="side-badge">{{ stats.active }}</span></h3>
            <button id="todo-card-expand" class="side-expand-btn" title="打开完整面板" @click="openPanel('todo', $event)">⤢</button>
        </header>
        <div class="side-todo-add">
            <input type="text" id="todo-card-input" placeholder="快速添加待办，回车确认" maxlength="100" v-model="draft" @keydown.enter="quickAdd" />
        </div>
        <ul id="todo-card-list" class="side-todo-list todo-list">
            <li
                v-for="todo in todos"
                :key="todo.id"
                :data-id="todo.id"
                class="todo-item"
                :class="[categoryClass(todo.category), { done: todo.done, important: todo.important, overdue: isTodoOverdue(todo) }]"
            >
                <input type="checkbox" :checked="todo.done" @change="toggleTodo(todo.id)" />
                <!-- 仅重要项渲染星标：空占位会拉大勾选框与内容区之间的间距 -->
                <span v-if="todo.important" class="todo-star" title="重要">★</span>
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
                    title="删除"
                    aria-label="删除待办"
                    @click.stop="removeTodo(todo.id)"
                    v-html="ICONS.trash"
                ></button>
            </li>
        </ul>
    </section>
</template>
