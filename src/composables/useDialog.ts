/**
 * 对话框（Vue3 ESM 版）
 * --------------------------------------------------------------------
 * 逐字移植 public/legacy-js/utils/dsh-dialog.js（203 行）：
 * - .dsh-dialog / __panel / __title / __message / __input / __error / __actions
 * - .settings-btn.secondary.dsh-dialog__cancel 文案「取消」、.primary.dsh-dialog__confirm「确定」
 * - 校验提示内联展示、ESC / 遮罩关闭、Tab 囚禁、焦点复位、重复打开先 cancel
 * - prompt 取消返回 null、confirm 取消返回 false、submit 用 raw.trim()
 * - 经典 dshDialog 全局挂载 → 纯 ESM export，零全局对象挂载
 */

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

function createOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'dsh-dialog';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = [
    '<div class="dsh-dialog__panel">',
    '  <div class="dsh-dialog__title"></div>',
    '  <div class="dsh-dialog__message"></div>',
    '  <input class="dsh-dialog__input" type="text" />',
    '  <div class="dsh-dialog__error" aria-live="polite"></div>',
    '  <div class="dsh-dialog__actions">',
    '    <button type="button" class="settings-btn secondary dsh-dialog__cancel">取消</button>',
    '    <button type="button" class="settings-btn primary dsh-dialog__confirm">确定</button>',
    '  </div>',
    '</div>',
  ].join('');
  document.body.appendChild(overlay);
  function q<TNode extends Element>(selector: string): TNode {
    const node = overlay.querySelector<TNode>(selector);
    if (!node) throw new Error('[dialog] 缺少节点: ' + selector);
    return node;
  }
  return {
    overlay,
    titleEl: q<HTMLElement>('.dsh-dialog__title'),
    messageEl: q<HTMLElement>('.dsh-dialog__message'),
    inputEl: q<HTMLInputElement>('.dsh-dialog__input'),
    errorEl: q<HTMLElement>('.dsh-dialog__error'),
    cancelBtn: q<HTMLButtonElement>('.dsh-dialog__cancel'),
    confirmBtn: q<HTMLButtonElement>('.dsh-dialog__confirm'),
  };
}

function open<T>(opt: DialogSpec): Promise<T> {
  return new Promise<T>((resolve) => {
    if (activeDialog) activeDialog.cancel();
    const previousFocus = document.activeElement as HTMLElement | null;
    const ui = createOverlay();
    const { overlay, titleEl, messageEl, inputEl, errorEl, cancelBtn, confirmBtn } = ui;

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
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.removeEventListener('click', onOverlayClick);
      overlay.remove();
      activeDialog = null;
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
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
      if (opt.type === 'confirm') {
        finish(true as T);
        return;
      }
      if (opt.type === 'alert') {
        finish(undefined as T);
        return;
      }
      const raw = inputEl.value;
      const trimmed = raw.trim();
      if (opt.validate) {
        const message = opt.validate(trimmed);
        if (message) {
          errorEl.textContent = message;
          inputEl.focus();
          return;
        }
      }
      finish(trimmed as T);
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables: HTMLElement[] = [inputEl, cancelBtn, confirmBtn].filter(
        (node) => !node.classList.contains('u-hidden'),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }

    function onOverlayClick(e: MouseEvent): void {
      if (e.target === overlay) cancel();
    }

    cancelBtn.addEventListener('click', cancel);
    confirmBtn.addEventListener('click', submit);
    document.addEventListener('keydown', onKeyDown, true);
    overlay.addEventListener('click', onOverlayClick);
    activeDialog = { cancel };
    requestAnimationFrame(() => {
      if (opt.type === 'prompt') {
        inputEl.focus();
        inputEl.select();
      } else {
        confirmBtn.focus();
      }
    });
  });
}

/** 经典 dshDialog.prompt：确认返回 trim 后的字符串，取消/ESC/遮罩返回 null。 */
function promptDialog(
  title: string,
  defaultValue: string,
  opts?: PromptOptions,
): Promise<string | null> {
  return open<string | null>({
    type: 'prompt',
    title,
    defaultValue,
    message: opts?.message,
    confirmText: opts?.confirmText,
    cancelText: opts?.cancelText,
    danger: opts?.danger,
    validate: opts?.validate,
  });
}

/** 经典 dshDialog.confirm：确定 true，取消/ESC/遮罩 false。 */
function confirmDialog(
  title: string,
  message: string,
  opts?: ConfirmOptions,
): Promise<boolean> {
  return open<boolean>({
    type: 'confirm',
    title,
    message,
    confirmText: opts?.confirmText,
    cancelText: opts?.cancelText,
    danger: opts?.danger,
  });
}

/** Vue3 新增：单按钮告警（复用同一套 .dsh-dialog class 与 ESC/遮罩关闭）。 */
function alertDialog(
  title: string,
  message: string,
  opts?: AlertOptions,
): Promise<void> {
  return open<void>({
    type: 'alert',
    title,
    message,
    confirmText: opts?.confirmText,
  });
}

export function useDialog() {
  return { prompt: promptDialog, confirm: confirmDialog, alert: alertDialog } as const;
}
