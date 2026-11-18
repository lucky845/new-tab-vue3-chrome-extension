/**
 * useDialog 迁原生 <dialog> 的行为契约测试。
 * vitest environment=node 无 jsdom：用最小 DOM 桩模拟 dialog 关键路径，
 * 验证 prompt/confirm/alert 返回语义、Esc(cancel)、遮罩点击 fallback、
 * 校验失败不关闭、重复打开收敛。applyGlass 用 vi.mock 桩掉。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/src/lib/glass', () => ({ PANEL_GLASS: {}, applyGlass: vi.fn() }));

import { useDialog } from '@/src/composables/useDialog';

class FakeClassList {
  private set = new Set<string>();
  add(...n: string[]) { n.forEach(x => this.set.add(x)); }
  remove(...n: string[]) { n.forEach(x => this.set.delete(x)); }
  contains(n: string) { return this.set.has(n); }
}
type Listener = (e: any) => void;
let focusedEl: FakeEl | null = null;

class FakeEl {
  tagName: string;
  private _className = '';
  get className() { return this._className; }
  set className(v: string) { this._className = v; v.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c)); }
  classList = new FakeClassList();
  attrs = new Map<string, string>();
  children: FakeEl[] = [];
  listeners = new Map<string, Listener[]>();
  textContent = '';
  value = '';
  open = false;
  parent: FakeEl | null = null;
  _rect = { left: 100, top: 100, right: 300, bottom: 200 };
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  set innerHTML(html: string) {
    // 扁平解析：为每个带 class 的标签建一个子元素（测试不关心嵌套层级，
    // querySelector 走 descendants），并额外把 panel 设为 dialog 的直接子节点。
    const re = /<(\w+)[^>]*class="([^"]*)"[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const el = new FakeEl(m[1]);
      m[2].split(/\s+/).forEach(c => el.classList.add(c));
      this.appendChild(el);
    }
  }
  get innerHTML() { return ''; }
  setAttribute(n: string, v: string) { this.attrs.set(n, v); }
  getAttribute(n: string) { return this.attrs.get(n) ?? null; }
  appendChild(c: FakeEl) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
  addEventListener(t: string, fn: Listener) { const a = this.listeners.get(t) ?? []; a.push(fn); this.listeners.set(t, a); }
  removeEventListener(t: string, fn: Listener) { this.listeners.set(t, (this.listeners.get(t) ?? []).filter(x => x !== fn)); }
  dispatch(t: string, e: any = {}) {
    (this.listeners.get(t) ?? []).slice().forEach(fn => fn({ target: this, preventDefault: vi.fn(), ...e }));
  }
  focus() { focusedEl = this; }
  select() {}
  getBoundingClientRect() { return this._rect; }
  querySelector<T extends FakeEl = FakeEl>(sel: string): T | null {
    const cls = sel.replace(/^\./, '');
    return this.descendants().find(x => x.classList.contains(cls)) as T ?? null;
  }
  querySelectorAll(sel: string): FakeEl[] {
    const cls = sel.replace(/^\./, '');
    return this.descendants().filter(x => x.classList.contains(cls));
  }
  descendants(): FakeEl[] {
    const out: FakeEl[] = [];
    for (const c of this.children) { out.push(c); out.push(...c.descendants()); }
    return out;
  }
  contains(node: FakeEl): boolean { return node === this || this.descendants().includes(node); }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

let body: FakeEl;
function dialogEl(): FakeEl { return body.children.find(x => x.tagName === 'DIALOG')!; }

beforeEach(() => {
  focusedEl = null;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number);
  body = new FakeEl('body');
  vi.stubGlobal('document', {
    body,
    createElement: (tag: string) => new FakeEl(tag),
    querySelector: () => null,
  });
  Object.defineProperty(globalThis.document, 'activeElement', { get: () => focusedEl });
});
afterEach(() => vi.unstubAllGlobals());

describe('useDialog · 原生 dialog 迁移的返回语义', () => {
  it('confirm：确定 true，取消 false，dialog 保留 .dsh-dialog class', async () => {
    const api = useDialog();
    const p = api.confirm('标题', '消息');
    const d = dialogEl();
    expect(d.classList.contains('dsh-dialog')).toBe(true);
    expect(d.open).toBe(true);
    expect(d.getAttribute('aria-labelledby')).toBe('dsh-dialog-title');
    d.querySelector<FakeEl>('.dsh-dialog__confirm')!.dispatch('click');
    await expect(p).resolves.toBe(true);
    expect(body.children.find(x => x.tagName === 'DIALOG')).toBeUndefined();
  });

  it('prompt：确认返回 trim 字符串，取消返回 null', async () => {
    const api = useDialog();
    const p1 = api.prompt('输入', '  hi  ');
    const d1 = dialogEl();
    d1.querySelector<FakeEl>('.dsh-dialog__input')!.value = '  hello  ';
    d1.querySelector<FakeEl>('.dsh-dialog__confirm')!.dispatch('click');
    await expect(p1).resolves.toBe('hello');

    const p2 = api.prompt('输入', '');
    dialogEl().querySelector<FakeEl>('.dsh-dialog__cancel')!.dispatch('click');
    await expect(p2).resolves.toBeNull();
  });

  it('alert：取消按钮隐藏，确定返回 undefined', async () => {
    const p = useDialog().alert('提示', '内容');
    const d = dialogEl();
    expect(d.querySelector('.dsh-dialog__cancel')!.classList.contains('u-hidden')).toBe(true);
    d.querySelector<FakeEl>('.dsh-dialog__confirm')!.dispatch('click');
    await expect(p).resolves.toBeUndefined();
  });

  it('Esc（cancel 事件）→ 取消语义并 preventDefault', async () => {
    const p = useDialog().confirm('标题', '消息');
    const d = dialogEl();
    const preventDefault = vi.fn();
    d.dispatch('cancel', { preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    await expect(p).resolves.toBe(false);
  });

  it('校验失败显示错误不关闭；修正后提交成功', async () => {
    const p = useDialog().prompt('输入', '', { validate: v => v.length < 3 ? '至少 3 个字符' : null });
    const d = dialogEl();
    const input = d.querySelector<FakeEl>('.dsh-dialog__input')!;
    input.value = 'ab';
    d.querySelector<FakeEl>('.dsh-dialog__confirm')!.dispatch('click');
    expect(d.querySelector('.dsh-dialog__error')!.textContent).toBe('至少 3 个字符');
    expect(d.open).toBe(true);
    input.value = 'abcd';
    d.querySelector<FakeEl>('.dsh-dialog__confirm')!.dispatch('click');
    await expect(p).resolves.toBe('abcd');
  });

  it('遮罩点击 fallback：点 panel 内不关，点 dialog 外部坐标才关', async () => {
    const p = useDialog().confirm('标题', '消息');
    const d = dialogEl();
    const panel = d.querySelector<FakeEl>('.dsh-dialog__panel')!;
    d.dispatch('click', { target: panel, clientX: 150, clientY: 150 });
    expect(d.open).toBe(true);
    d.dispatch('click', { target: d, clientX: 50, clientY: 50 });
    await expect(p).resolves.toBe(false);
  });

  it('危险确认带 is-danger 标记', async () => {
    useDialog().confirm('删除', '不可恢复', { danger: true });
    expect(dialogEl().querySelector('.dsh-dialog__confirm')!.classList.contains('is-danger')).toBe(true);
  });

  it('重复打开：先 cancel 上一个再开新的，两个 promise 都收敛', async () => {
    const api = useDialog();
    const p1 = api.confirm('第一个', '消息');
    const p2 = api.confirm('第二个', '消息');
    await expect(p1).resolves.toBe(false);
    dialogEl().querySelector<FakeEl>('.dsh-dialog__confirm')!.dispatch('click');
    await expect(p2).resolves.toBe(true);
  });
});
