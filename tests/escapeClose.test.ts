import { describe, it, expect } from 'vitest';
import {
  ESCAPE_Z_BY_VARIANT,
  pickEscapeTarget,
  type EscapeEntry,
} from '@/src/lib/escapeClose';

/** 造一个浮层条目：z 默认与 settings 面板同级 */
const entry = (id: string, z = ESCAPE_Z_BY_VARIANT.settings, order = 1): EscapeEntry => ({
  id,
  z,
  order,
});

const NO_COLLISION = { dialogOpen: false, dragging: false };

describe('pickEscapeTarget 挑出 Esc 该关的层', () => {
  it('没有任何浮层时返回 null', () => {
    expect(pickEscapeTarget([], NO_COLLISION)).toBeNull();
  });

  it('只有一个浮层时关它', () => {
    expect(pickEscapeTarget([entry('todo')], NO_COLLISION)).toBe('todo');
  });

  it('多层时关 z 最大的那一层', () => {
    const entries = [
      entry('settings'),
      entry('folder', ESCAPE_Z_BY_VARIANT.folder),
      entry('todo', ESCAPE_Z_BY_VARIANT.widget),
    ];
    expect(pickEscapeTarget(entries, NO_COLLISION)).toBe('folder');
  });

  it('同 z 时关最后打开的那层（order 最大）', () => {
    const entries = [entry('todo', 5000, 1), entry('notes', 5000, 3), entry('pomodoro', 5000, 2)];
    expect(pickEscapeTarget(entries, NO_COLLISION)).toBe('notes');
  });

  it('同 z 且同 order 时保持先到者，不因数组顺序抖动而换人', () => {
    const a = entry('todo', 5000, 1);
    const b = entry('notes', 5000, 1);
    expect(pickEscapeTarget([a, b], NO_COLLISION)).toBe('todo');
    expect(pickEscapeTarget([b, a], NO_COLLISION)).toBe('notes');
  });

  it('对话框开着时不关面板（Esc 归对话框）', () => {
    expect(pickEscapeTarget([entry('todo')], { dialogOpen: true, dragging: false })).toBeNull();
  });

  it('拖拽中不关面板（Esc 归「取消拖拽」）', () => {
    expect(pickEscapeTarget([entry('todo')], { dialogOpen: false, dragging: true })).toBeNull();
  });

  it('对话框与拖拽同时存在时同样不关面板', () => {
    expect(pickEscapeTarget([entry('folder', 6000)], { dialogOpen: true, dragging: true })).toBeNull();
  });

  it('不修改传入的数组（调用方传的是内部快照）', () => {
    const entries = [entry('todo', 5000, 1), entry('folder', 6000, 2)];
    const copy = entries.map(e => ({ ...e }));
    pickEscapeTarget(entries, NO_COLLISION);
    expect(entries).toEqual(copy);
  });
});
