/**
 * 对话框（原生 <dialog> 版）
 * --------------------------------------------------------------------
 * API 与经典 dshDialog 一致：prompt / confirm / alert，返回语义不变。
 *
 * 迁移说明（现代 Web 指南 · dialog）：旧实现用 div + role=dialog + aria-modal 手搓模态框，
 * 自己维护 Tab 焦点囚禁 / Esc / 遮罩点击 / 焦点复位。原生 <dialog>.showModal() 免费提供
 * top-layer、浏览器级 inert、焦点管理、Esc（cancel）、::backdrop。这里保留 .dsh-dialog
 * class 与全部 __panel/__title/... 结构和 CSS（视觉零回归），只把手搓逻辑换成原生语义，
 * 且保留 click-outside fallback —— closedby=any 在 Safari 不支持（Limited availability）。
 *
 * 与 useEscapeClose 的契约：那个模块靠 .dsh-dialog 选择器判断对话框是否开着并让路；
 * 原生 dialog 挂 body 且保留该 class，契约不变。
 */
import { PANEL_GLASS, applyGlass } from '@/src/lib/glass';

interface PromptOptions {
  confirmText?: string;
  cancelText?: string;
  message?: string;
  danger?: boolean;
  validate?: (value: string) => string | null;
}
interface ConfirmOptions {
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}
interface AlertOptions {
  confirmText?: string;
}
type DialogKind = 'prompt' | 'confirm' | 'alert';
interface DialogSpec {
  type: DialogKind;
  title: string;
  message?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  validate?: (value: string) => string | null;
}
interface ActiveDialog {
  cancel(): void;
}
let activeDialog: ActiveDialog | null = null;

interface DialogUI {
  titleEl: HTMLElement;
  messageEl: HTMLElement;
  inputEl: HTMLInputElement;
  errorEl: HTMLElement;
  cancelBtn: HTMLButtonElement;
  confirmBtn: HTMLButtonElement;
}
function createDialog(): { dialog: HTMLDialogElement; panel: HTMLElement; ui: DialogUI } {
  const dialog = document.createElement('dialog');
  dialog.className = 'dsh-dialog';
  // 指南 MANDATORY：aria-labelledby 指向可见标题，不手写 role/aria-modal
  dialog.setAttribute('aria-labelledby', 'dsh-dialog-title');
  dialog.innerHTML = [
    '<div class="dsh-dialog__panel">',
    '  <div class="dsh-dialog__title" id="dsh-dialog-title"></div>',
    '  <div class="dsh-dialog__message"></div>',
    '  <input class="dsh-dialog__input" type="text" />',
    '  <div class="dsh-dialog__error" aria-live="polite"></div>',
    '  <div class="dsh-dialog__actions">',
    '    <button type="button" class="settings-btn secondary dsh-dialog__cancel">取消</button>',
    '    <button type="button" class="settings-btn primary dsh-dialog__confirm">确定</button>',
    '  </div>',
    '</div>',
  ].join('');
  document.body.appendChild(dialog);
  const panel = dialog.querySelector<HTMLElement>('.dsh-dialog__panel');
  if (panel) applyGlass(panel, PANEL_GLASS);
  function q<TNode extends Element>(selector: string): TNode {
    const node = dialog.querySelector<TNode>(selector);
    if (!node) throw new Error('[dialog] 缺少节点: ' + selector);
    return node;
  }
  return {
    dialog,
    panel: panel as HTMLElement,
    ui: {
      titleEl: q<HTMLElement>('.dsh-dialog__title'),
      messageEl: q<HTMLElement>('.dsh-dialog__message'),
      inputEl: q<HTMLInputElement>('.dsh-dialog__input'),
      errorEl: q<HTMLElement>('.dsh-dialog__error'),
      cancelBtn: q<HTMLButtonElement>('.dsh-dialog__cancel'),
      confirmBtn: q<HTMLButtonElement>('.dsh-dialog__confirm'),
    },
  };
}

function open<T>(opt: DialogSpec): Promise<T> {
  return new Promise<T>((resolve) => {
    if (activeDialog) activeDialog.cancel();
    const { dialog, panel, ui } = createDialog();
    const { titleEl, messageEl, inputEl, errorEl, cancelBtn, confirmBtn } = ui;

    titleEl.textContent = opt.title || '请确认';
    if (opt.message) messageEl.textContent = opt.message;
    else messageEl.classList.add('u-hidden');
    if (opt.type === 'prompt') inputEl.value = opt.defaultValue ?? '';
    else inputEl.classList.add('u-hidden');
    cancelBtn.textContent = opt.cancelText || '取消';
    confirmBtn.textContent = opt.confirmText || '确定';
    if (opt.danger) confirmBtn.classList.add('is-danger');
    if (opt.type === 'alert') cancelBtn.classList.add('u-hidden');

    let settled = false;

    function cleanup(): void {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
      dialog.removeEventListener('click', onDialogClick);
      confirmBtn.removeEventListener('click', onConfirmClick);
      cancelBtn.removeEventListener('click', onCancelClick);
      inputEl.removeEventListener('keydown', onInputKeyDown);
      if (dialog.open) dialog.close();
      dialog.remove();
      activeDialog = null;
      // 不手写焦点复位：原生 showModal 会把焦点还给 invoker（指南 DON'T）。
    }
    function finish(value: T): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }
    function cancel(): void {
      if (opt.type === 'prompt') finish(null as T);
      else if (opt.type === 'alert') finish(undefined as T);
      else finish(false as T);
    }
    function submit(): void {
      if (opt.type === 'confirm') { finish(true as T); return; }
      if (opt.type === 'alert') { finish(undefined as T); return; }
      const trimmed = inputEl.value.trim();
      if (opt.validate) {
        const message = opt.validate(trimmed);
        if (message) { errorEl.textContent = message; inputEl.focus(); return; }
      }
      finish(trimmed as T);
    }
    function onCancel(e: Event): void { e.preventDefault(); cancel(); }
    function onClose(): void { if (!settled) cancel(); }
    function onConfirmClick(): void { submit(); }
    function onCancelClick(): void { cancel(); }
    function onInputKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    }
    // 遮罩点击 fallback：closedby=any 在 Safari 不支持。dialog 是 inset:0 全屏容器，
    // 必须用 panel 的 rect 判断「点在内容区外」，否则 click-outside 永不生效。
    function onDialogClick(e: MouseEvent): void {
      if (e.target !== dialog) return;
      const rect = panel.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside) cancel();
    }
    function show(): void {
      // closedby=any 是渐进增强（Chrome134+/Edge134+/Firefox141+）；Safari 靠 click fallback。
      dialog.setAttribute('closedby', 'any');
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      requestAnimationFrame(() => {
        if (opt.type === 'prompt') { inputEl.focus(); inputEl.select(); }
        else if (opt.danger && opt.type === 'confirm') cancelBtn.focus(); // 危险项焦点给取消
        else confirmBtn.focus();
      });
    }

    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClose);
    dialog.addEventListener('click', onDialogClick);
    confirmBtn.addEventListener('click', onConfirmClick);
    cancelBtn.addEventListener('click', onCancelClick);
    inputEl.addEventListener('keydown', onInputKeyDown);
    activeDialog = { cancel };
    show();
  });
}

/** 经典 dshDialog.prompt：确认返回 trim 后的字符串，取消/ESC/遮罩返回 null。 */
function promptDialog(
  title: string, defaultValue: string, opts?: PromptOptions,
): Promise<string | null> {
  return open<string | null>({
    type: 'prompt', title, defaultValue,
    message: opts?.message, confirmText: opts?.confirmText, cancelText: opts?.cancelText,
    danger: opts?.danger, validate: opts?.validate,
  });
}
/** 经典 dshDialog.confirm：确定 true，取消/ESC/遮罩 false。 */
function confirmDialog(
  title: string, message: string, opts?: ConfirmOptions,
): Promise<boolean> {
  return open<boolean>({
    type: 'confirm', title, message,
    confirmText: opts?.confirmText, cancelText: opts?.cancelText, danger: opts?.danger,
  });
}
/** 单按钮告警（复用同一套 .dsh-dialog class 与 Esc/遮罩关闭）。 */
function alertDialog(title: string, message: string, opts?: AlertOptions): Promise<void> {
  return open<void>({ type: 'alert', title, message, confirmText: opts?.confirmText });
}
export function useDialog() {
  return { prompt: promptDialog, confirm: confirmDialog, alert: alertDialog } as const;
}