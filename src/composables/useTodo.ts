/**
 * 待办事项数据层（Vue 版）——业务语义唯一权威仍是 v1.8.1:js/modules/todo-manager.js。
 *
 * 这里做的是等价移植，不是重设计：
 * - 存储键 'todos' 一字不差，存裸对象数组（chrome.storage 结构化克隆），不是 JSON 字符串
 * - 数据结构（与 legacy 注释逐字一致；旧数据缺 category/dueDate/completedAt 时迁移补齐）：
 *   { id, content, important, done, createdAt, category: 'work'|'life'|'normal',
 *     dueDate: 'YYYY-MM-DD'|null, completedAt: number|null }
 * - 迁移逻辑：category 缺省 'normal'、dueDate 缺省 null、done 且无 completedAt 补 Date.now()
 * - 统计口径（getStats）与逾期判定（isOverdue）照搬：截止日当天 23:59:59 前不算逾期
 * - 持久化由 useStored 的深度 watch 承担（等价 legacy 每次 save()），组件层不直接碰 chrome.storage
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { useStored } from '@/src/lib/storage';

export type TodoCategory = 'work' | 'life' | 'normal';

export type TodoFilter = 'all' | TodoCategory;

export interface Todo {
  id: string;
  content: string;
  important: boolean;
  done: boolean;
  createdAt: number;
  category: TodoCategory;
  dueDate: string | null;
  completedAt: number | null;
}

export interface TodoStats {
  /** 总数 */
  total: number;
  /** 未完成 */
  active: number;
  /** 今日完成（completedAt >= 今天 0 点） */
  doneToday: number;
  /** 已逾期（未完成且过截止日 23:59:59） */
  overdue: number;
}

export interface AddTodoOptions {
  important?: boolean;
  /** legacy 直接透传 select 值，由 addTodo 内部 normalizeCategory 兜底 */
  category?: string;
  dueDate?: string | null;
}

export interface TodoApi {
  /** 全量待办（存储态，响应式） */
  todos: Ref<Todo[]>;
  /** 当前过滤视图（面板列表渲染源，语义同 legacy renderTodoList 的 filter） */
  filteredTodos: ComputedRef<Todo[]>;
  /** 分类过滤状态（legacy this.todoFilter，初始 'all'） */
  filter: Ref<TodoFilter>;
  /** 统计（语义同 legacy getStats()，响应式重算） */
  stats: ComputedRef<TodoStats>;
  setFilter(filter: TodoFilter): void;
  addTodo(content: string, options?: AddTodoOptions): Promise<Todo | null>;
  toggleTodo(id: string): Promise<Todo | null>;
  removeTodo(id: string): Promise<boolean>;
  clearDone(): Promise<number>;
  updateOrder(orderedIds: string[]): Promise<boolean>;
}

const STORAGE_KEY = 'todos';

const CATEGORY_WHITELIST: TodoCategory[] = ['work', 'life', 'normal'];

/** legacy TodoManager.normalizeCategory：白名单外一律归为 'normal' */
function normalizeCategory(category: unknown): TodoCategory {
  return CATEGORY_WHITELIST.includes(category as TodoCategory)
    ? (category as TodoCategory)
    : 'normal';
}

/** 是否已逾期（未完成且有截止日期，截止日当天 23:59:59 前不算逾期）—— legacy TodoManager.isOverdue */
export function isTodoOverdue(todo: Todo): boolean {
  if (todo.done || !todo.dueDate) return false;
  const end = new Date(`${todo.dueDate}T23:59:59`).getTime();
  return Number.isFinite(end) && end < Date.now();
}

/** legacy TodoManager.todayStart */
function todayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 读取迁移（legacy load() 的 useStored load 选项等价实现）：
 * - 非数组兜底为 []（legacy：Array.isArray(result[key]) ? result[key] : []）
 * - category 缺省 'normal'（legacy 判 !category，即 falsy 一律补）
 * - dueDate === undefined 补 null（显式 null 不动）
 * - done 且无 completedAt 补 Date.now()
 * 迁移结果进入响应式 state 后由 useStored 深度 watch 自动回写存储（等价 legacy 的 migrated → save()）。
 */
function migrate(raw: unknown): Todo[] {
  if (!Array.isArray(raw)) return [];
  const todos = raw.map((item) => ({ ...(item as Todo) }));
  for (const todo of todos) {
    if (!todo.category) todo.category = 'normal';
    if (todo.dueDate === undefined) todo.dueDate = null;
    if (todo.done && !todo.completedAt) todo.completedAt = Date.now();
  }
  return todos;
}

let singleton: TodoApi | null = null;

function createTodoApi(): TodoApi {
  const todos = useStored<Todo[]>(STORAGE_KEY, [], { load: migrate });
  const filter = ref<TodoFilter>('all');

  // legacy renderTodoList：filter === 'all' 或 category 匹配
  const filteredTodos = computed(() =>
    todos.value.filter((t) => filter.value === 'all' || t.category === filter.value),
  );

  // legacy getStats()：未完成 / 今日完成 / 总数 / 已逾期
  const stats = computed<TodoStats>(() => {
    const today = todayStart();
    return {
      total: todos.value.length,
      active: todos.value.filter((t) => !t.done).length,
      doneToday: todos.value.filter((t) => t.done && t.completedAt && t.completedAt >= today)
        .length,
      overdue: todos.value.filter((t) => !t.done && isTodoOverdue(t)).length,
    };
  });

  return {
    todos,
    filteredTodos,
    filter,
    stats,
    setFilter(next) {
      filter.value = next;
    },
    // 添加（与 legacy addTodo 一致：trim 后为空返回 null，id/时间戳/分类归一化逻辑逐字照搬）
    async addTodo(content, options = {}) {
      const text = (content || '').trim();
      if (!text) return null;
      const { important = false, category = 'normal', dueDate = null } = options;
      const todo: Todo = {
        id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        content: text,
        important: !!important,
        done: false,
        createdAt: Date.now(),
        category: normalizeCategory(category),
        dueDate: dueDate || null,
        completedAt: null,
      };
      todos.value.unshift(todo);
      return todo;
    },
    // 切换完成状态（完成时记录 completedAt；取消完成清空）
    async toggleTodo(id) {
      const todo = todos.value.find((t) => t.id === id);
      if (!todo) return null;
      todo.done = !todo.done;
      todo.completedAt = todo.done ? Date.now() : null;
      return todo;
    },
    async removeTodo(id) {
      const index = todos.value.findIndex((t) => t.id === id);
      if (index === -1) return false;
      todos.value.splice(index, 1);
      return true;
    },
    // 清除已完成（返回清除条数，供 UI 提示）
    async clearDone() {
      const before = todos.value.length;
      todos.value = todos.value.filter((t) => !t.done);
      return before - todos.value.length;
    },
    // 拖拽排序回写（UI 层传渲染后的 id 顺序；未出现的项兜底追加尾部，避免丢数据）
    async updateOrder(orderedIds) {
      if (!Array.isArray(orderedIds) || orderedIds.length === 0) return false;
      const map = new Map(todos.value.map((t) => [t.id, t]));
      const next: Todo[] = [];
      for (const id of orderedIds) {
        const todo = map.get(id);
        if (todo) {
          next.push(todo);
          map.delete(id);
        }
      }
      for (const todo of map.values()) next.push(todo);
      todos.value = next;
      return true;
    },
  };
}

/**
 * 待办域唯一数据入口（单例）。
 * 面板与主页待办卡（后续 TodoCard.vue）共享同一份响应式状态，
 * 任何一侧变更都会经 useStored 深度 watch 持久化到 chrome.storage.local 的 'todos' 键。
 */
export function useTodo(): TodoApi {
  if (!singleton) singleton = createTodoApi();
  return singleton;
}
