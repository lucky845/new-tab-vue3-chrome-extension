<script setup lang="ts">
/**
 * 主页左翼待办迷你卡 —— markup 逐字来自 entrypoints/newtab.html:192-201（#side-card-todo）。
 *
 * legacy 映射（public/legacy-js/app.js）：
 * - renderTodoCard（910-918）：全量 getTodos() + 徽标 getStats().active → todos / stats
 * - renderTodoInto（844-908）：li 结构（勾选/星标/分类/文本/截止日/删除）→ v-for 模板
 * - bindSideWidgets（1349-1362）：#todo-card-input Enter 快速添加、trim 后为空不添加
 * - 展开按钮：外壳 SideCard 记录 panelOrigin 后 toggle('todo')
 *
 * 与 TodoPanel 共享 useTodo 单例；侧卡不挂 Sortable（legacy 侧卡本来也没有）。
 * 显隐 / 展开按钮 / 头部由 SideCard 外壳统一承载，本组件只管卡片主体。
 */
import { ref } from 'vue';
import SideCard from '@/src/components/common/SideCard.vue';
import { useTodo, isTodoOverdue, type Todo, type TodoCategory } from '@/src/composables/useTodo';
import { toast as showToast } from '@/src/composables/useToast';
import { ICON_TRASH, ICON_CAT_WORK, ICON_CAT_LIFE, ICON_CAT_NORMAL } from '@/src/lib/icons';

const { todos, stats, addTodo, toggleTodo, removeTodo } = useTodo();

/** 快速添加输入框（legacy todoInput.value） */
const draft = ref('');

/** legacy AppIcons —— 字面量已抽到 @/src/lib/icons 共享，此处仅做语义映射 */
const ICONS = {
  trash: ICON_TRASH,
  catWork: ICON_CAT_WORK,
  catLife: ICON_CAT_LIFE,
  catNormal: ICON_CAT_NORMAL,
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
    <SideCard cardId="todo" elementId="side-card-todo" title="待办" :badge="stats.active" badgeId="todo-card-badge" expandId="todo-card-expand">
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
    </SideCard>
</template>
