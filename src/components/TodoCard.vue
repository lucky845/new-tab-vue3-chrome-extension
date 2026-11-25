<script setup lang="ts">
/**
 * 主页左翼待办迷你卡 —— markup 逐字来自 entrypoints/newtab.html:192-201（#side-card-todo）。
 *
 * legacy 映射（v1.8.1:js/app.js）：
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
import { useTodo, isTodoOverdue } from '@/src/composables/useTodo';
import { toast as showToast } from '@/src/composables/useToast';
import {
  TODO_ICONS as ICONS,
  categoryIcon,
  categoryTitle,
  categoryClass,
  dueText as formatDueText,
} from '@/src/lib/todo-display';
import { t } from '@/src/composables/useI18n';

const { todos, stats, addTodo, toggleTodo, removeTodo } = useTodo();

/** 快速添加输入框（legacy todoInput.value） */
const draft = ref('');

/**
 * 分类图标 / 文案 / 样式类 / 截止日文案已抽到 @/src/lib/todo-display（与 TodoPanel 共享），
 * 本组件只保留调用：dueText(todo) = formatDueText(todo.dueDate, isTodoOverdue(todo))。
 */
const dueText = (t: import('@/src/composables/useTodo').Todo): string =>
  formatDueText(t.dueDate, isTodoOverdue(t));

async function quickAdd(): Promise<void> {
  const content = draft.value.trim();
  if (!content) {
    showToast(t('todo_toast_empty_input'), 'error');
    return;
  }
  await addTodo(content, { category: 'normal' });
  draft.value = '';
}
</script>

<!-- prettier-ignore -->
<template>
    <SideCard cardId="todo" elementId="side-card-todo" :title="t('side_card_todo')" :badge="stats.active" badgeId="todo-card-badge" expandId="todo-card-expand">
        <div class="side-todo-add">
            <input type="text" id="todo-card-input" :placeholder="t('todo_card_placeholder')" maxlength="100" v-model="draft" @keydown.enter="quickAdd" />
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
    </SideCard>
</template>
