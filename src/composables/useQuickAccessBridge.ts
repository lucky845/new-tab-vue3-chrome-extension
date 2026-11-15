/**
 * 快捷访问事件桥（纯 ESM 模块级单例）。
 *
 * 取代迁移期的全局事件桥：网格、弹窗、文件夹浮层
 * 三个组件各自只注册/删除自己提供的方法，互不覆盖、互不依赖全局对象。
 */

export interface QuickAccessBridge {
  refreshGrid?: () => void;
  openAdd?: (preselect?: number) => void;
  openEdit?: (index: number) => void;
  closeDialog?: () => void;
  openFolder?: (index: number) => void;
  closeFolder?: () => void;
  handleItemMerge?: (a: number, b: number) => Promise<boolean> | boolean;
  showContextMenu?: (e: MouseEvent, item: HTMLElement) => void;
}

let instance: QuickAccessBridge | null = null;

/** 全应用共享同一份桥对象；模块级单例，天然跨组件一致。 */
export function quickAccessBridge(): QuickAccessBridge {
  if (!instance) instance = {};
  return instance;
}
