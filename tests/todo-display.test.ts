/**
 * todo-display 的分类 / 截止日文案测试。
 *
 * 这些纯函数原本在 TodoCard.vue 与 TodoPanel.vue 各写一份，两处改一处漏的漂移
 * 就是这个模块存在的理由；测试把语义钉死在 lib 层。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TODO_ICONS, categoryIcon, categoryTitle, categoryClass, dueText, todoCategoryKey } from '@/src/lib/todo-display';
import { ICON_TRASH, ICON_CAT_WORK, ICON_CAT_LIFE, ICON_CAT_NORMAL } from '@/src/lib/icons';
import { registerCatalog, resetLocaleState } from '@/src/composables/useI18n';
import { catalog } from '@/src/locales/catalog';

// node 测试环境没有 chrome.i18n，locale 会回退到 DEFAULT_LOCALE（zh_CN）；
// 这里显式注册真实语料，断言的就是用户实际会看到的文案。
beforeEach(() => {
  registerCatalog(catalog);
  resetLocaleState('zh-CN');
});

describe('todo-display TODO_ICONS', () => {
  it('映射四个本地图标常量，不再由组件各自声明', () => {
    expect(TODO_ICONS.trash).toBe(ICON_TRASH);
    expect(TODO_ICONS.catWork).toBe(ICON_CAT_WORK);
    expect(TODO_ICONS.catLife).toBe(ICON_CAT_LIFE);
    expect(TODO_ICONS.catNormal).toBe(ICON_CAT_NORMAL);
  });
});

describe('todo-display categoryIcon', () => {
  it('三类各有图标，缺省与未知都落 normal', () => {
    expect(categoryIcon('work')).toBe(ICON_CAT_WORK);
    expect(categoryIcon('life')).toBe(ICON_CAT_LIFE);
    expect(categoryIcon('normal')).toBe(ICON_CAT_NORMAL);
    expect(categoryIcon(undefined)).toBe(ICON_CAT_NORMAL);
    expect(categoryIcon('bogus' as 'work')).toBe(ICON_CAT_NORMAL);
  });
});

describe('todo-display categoryTitle', () => {
  it('三类文案走 i18n（默认中文），缺省与未知都落普通', () => {
    expect(categoryTitle('work')).toBe('工作');
    expect(categoryTitle('life')).toBe('生活');
    expect(categoryTitle('normal')).toBe('普通');
    expect(categoryTitle(undefined)).toBe('普通');
    expect(categoryTitle('bogus' as 'work')).toBe('普通');
  });

  it('todoCategoryKey 给出稳定 key，供 <title> 与导出使用', () => {
    expect(todoCategoryKey('work')).toBe('todo_cat_work');
    expect(todoCategoryKey('life')).toBe('todo_cat_life');
    expect(todoCategoryKey('normal')).toBe('todo_cat_normal');
    expect(todoCategoryKey(undefined)).toBe('todo_cat_normal');
  });
});

describe('todo-display categoryClass', () => {
  it('拼 cat- 前缀，空值落 normal（与面板模板 class 对齐）', () => {
    expect(categoryClass('work')).toBe('cat-work');
    expect(categoryClass('life')).toBe('cat-life');
    expect(categoryClass(undefined)).toBe('cat-normal');
    expect(categoryClass('')).toBe('cat-normal');
  });
});

describe('todo-display dueText', () => {
  it('无截止日返回空串', () => {
    expect(dueText(null, false)).toBe('');
    expect(dueText(undefined, true)).toBe('');
    expect(dueText('', false)).toBe('');
  });
  it('未逾期显示日历，逾期显示警告；文案与 legacy 一字不差', () => {
    expect(dueText('2026-11-20', false)).toBe('📅 2026-11-20');
    expect(dueText('2026-11-20', true)).toBe('⚠️ 2026-11-20 已逾期');
  });
});
