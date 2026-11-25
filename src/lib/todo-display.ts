/**
 * 待办展示格式化（纯函数，零 Vue / 零 chrome 依赖）。
 *
 * 原来 categoryIcon / categoryTitle / categoryClass / dueText 在 TodoCard.vue 与

 * TodoPanel.vue 各写一遍，逐字重复。抽到这里后：
 * - 卡片、面板、测试只认同一份语义，改文案不会再出现「两处改一处漏」；
 * - 逾期判定不在这里做——由调用方把 isTodoOverdue(todo) 传进来，保证 lib 层
 *   不反向依赖 composable（isTodoOverdue 的业务权威仍在 useTodo.ts）。
 */
import { ICON_TRASH, ICON_CAT_WORK, ICON_CAT_LIFE, ICON_CAT_NORMAL } from '@/src/lib/icons';
import type { TodoCategory } from '@/src/composables/useTodo';

/** legacy AppIcons 的语义映射（两个组件原来各声明一份 ICONS） */
export const TODO_ICONS = {
  trash: ICON_TRASH,
  catWork: ICON_CAT_WORK,
  catLife: ICON_CAT_LIFE,
  catNormal: ICON_CAT_NORMAL,
} as const;

// legacy：{ work: 'catWork', life: 'catLife', normal: 'catNormal' }[category] || 'catNormal'
export function categoryIcon(category: TodoCategory | undefined): string {
  const map: Record<TodoCategory, string> = {
    work: TODO_ICONS.catWork,
    life: TODO_ICONS.catLife,
    normal: TODO_ICONS.catNormal,
  };
  return map[category ?? "normal"] ?? TODO_ICONS.catNormal;
}

/** 分类的 i18n key —— 需要原始文案的场景（<title>、导出、测试断言）用它，不要直接拿翻译串 */
export function todoCategoryKey(category: TodoCategory | undefined): string {
  // 未知分类必须落回 normal —— 否则 'bogus' 会拼出无词条的 todo_cat_bogus，界面显示裸 key
  const safe: TodoCategory =
    category === 'work' || category === 'life' || category === 'normal' ? category : 'normal';
  return 'todo_cat_' + safe;
}

// legacy：{ work: '工作', life: '生活', normal: '普通' }[category] || '普通'
export function categoryTitle(category: TodoCategory | undefined): string {
  return t(todoCategoryKey(category));
}

export function categoryClass(category: TodoCategory | undefined): string {
  return 'cat-' + (category || 'normal');
}

/**
 * legacy：逾期时 '⚠️ {date} 已逾期'，否则 '📅 {date}'；无截止日期渲染空 span。
 * overdue 由调用方传 isTodoOverdue(todo) —— lib 不碰时间与 store。
 */
import { t } from '@/src/composables/useI18n';
export function dueText(dueDate: string | null | undefined, overdue: boolean): string {
  if (!dueDate) return "";
  return overdue ? t('todo_due_overdue', { date: dueDate }) : `📅 ${dueDate}`;
}
