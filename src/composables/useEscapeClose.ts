/**
 * Esc 关窗的调度器（模块级单例）。
 *
 * 分工：src/lib/escapeClose.ts 负责「该关谁」的纯判定，这里负责「谁在开着」的登记
 * 与唯一一个 document 监听。所有浮层只登记、不自己监听——一个浮层一个监听器，
 * 结果就是一次 Esc 关掉一串（legacy 里 ToolsPanel 和 FolderOverlay 各挂一个，
 * 就是这种双响）。
 *
 * 监听挂在冒泡阶段而不是 capture：useDialog.ts:184 与 useIconDrag.ts:176 都在
 * capture 抢 Esc，先到先得，这里只处理它们没吃掉的。
 *
 * 注意这里只做登记与分发，不 import 任何 Vue —— 组件通过 watch 在开合时调
 * registerEscapeTarget / 返回的函数。
 */
import { pickEscapeTarget, type EscapeEntry } from '@/src/lib/escapeClose';

interface Registration {
  entry: EscapeEntry;
  handler: () => void;
}

const registrations = new Map<string, Registration>();
let seq = 0;
let listening = false;

/** 拖拽中的旁证：两处拖拽实现（useIconDrag / FolderOverlay）都会给 body 挂这个类 */
function isDragging(): boolean {
  if (typeof document === 'undefined') return false;
  return document.body.classList.contains('icon-dragging');
}

/** 模态对话框（useDialog 直接挂 body 的 .dsh-dialog，z 走 --z-confirm）开着时 Esc 归它 */
function hasDialog(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('.dsh-dialog') !== null;
}

function snapshot(): EscapeEntry[] {
  const list: EscapeEntry[] = [];
  registrations.forEach(reg => list.push(reg.entry));
  return list;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  // capture 层（对话框）已经处理过就别再关面板
  if (event.defaultPrevented) return;
  const target = pickEscapeTarget(snapshot(), { dialogOpen: hasDialog(), dragging: isDragging() });
  if (!target) return;
  const reg = registrations.get(target);
  if (!reg) return;
  // 吃掉这次事件：同一层里若还有别的 keydown 监听（例如输入框自己收尾），不该再关第二层
  event.preventDefault();
  reg.handler();
}

function ensureListener(): void {
  if (listening || typeof document === 'undefined') return;
  document.addEventListener('keydown', onKeyDown);
  listening = true;
}

function dropListenerIfIdle(): void {
  if (!listening || registrations.size > 0 || typeof document === 'undefined') return;
  document.removeEventListener('keydown', onKeyDown);
  listening = false;
}

/**
 * 登记一个「开着就能被 Esc 关闭」的浮层。
 *
 * z 决定谁优先（与 app.css 的 --z-* 阶梯同源），登记顺序决定同层时关哪个——
 * 后登记的视为后打开，优先关闭。返回值必须调用：浮层关闭 / 组件卸载时注销，
 * 否则栈里留着幽灵条目，Esc 会关到一个已经不可见的层。
 */
export function registerEscapeTarget(id: string, z: number, handler: () => void): () => void {
  seq += 1;
  registrations.set(id, { entry: { id, z, order: seq }, handler });
  ensureListener();
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    registrations.delete(id);
    dropListenerIfIdle();
  };
}

/** 给单元测试 / 调试用：当前登记了几层。生产代码不该依赖它做业务判断 */
export function escapeTargetCount(): number {
  return registrations.size;
}
