/**
 * 键盘快捷键注册表。
 *
 * 一处定义、两处消费：
 *   - src/components/common/KeyboardShortcuts.vue 用它建 keydown 查找表
 *   - src/components/SettingsPanel.vue 的「键盘快捷键」区块用它渲染说明
 * 分开放两份清单迟早会漂移，所以放这里当唯一真源。
 *
 * 只允许 Alt + 单字母：Ctrl/Cmd 组合已被浏览器和系统大量占用，
 * 无修饰键的单字母会抢走用户在其他区域的输入。
 */
import type { PanelId } from '@/src/composables/usePanels';

export type ShortcutAction = 'focus-search' | 'open-panel' | 'close-all';

export interface ShortcutDef {
  /** 显示用按键序列，如 ['Alt', 'S'] */
  keys: string[];
  /** 匹配用的单字符（小写）；close-all 用 'w' + shift */
  key: string;
  shift?: boolean;
  action: ShortcutAction;
  panel?: PanelId;
  label: string;
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: ['Alt', 'S'], key: 's', action: 'focus-search', label: '聚焦搜索框' },
  { keys: ['Alt', 'K'], key: 'k', action: 'open-panel', panel: 'settings', label: '打开设置' },
  { keys: ['Alt', 'T'], key: 't', action: 'open-panel', panel: 'tools', label: '打开小工具' },
  { keys: ['Alt', 'W'], key: 'w', action: 'open-panel', panel: 'wallpaper', label: '打开壁纸' },
  { keys: ['Alt', 'A'], key: 'a', action: 'open-panel', panel: 'todo', label: '打开待办' },
  { keys: ['Alt', 'N'], key: 'n', action: 'open-panel', panel: 'notes', label: '打开便签' },
  { keys: ['Alt', 'P'], key: 'p', action: 'open-panel', panel: 'pomodoro', label: '打开番茄钟' },
  { keys: ['Alt', 'Shift', 'W'], key: 'w', shift: true, action: 'close-all', label: '收起全部面板' },
];

/** keydown 查找表：`${shift ? 'shift+' : ''}${key}` → 定义。 */
export const SHORTCUT_MAP: Record<string, ShortcutDef> = Object.fromEntries(
  SHORTCUTS.map((s) => [`${s.shift ? 'shift+' : ''}${s.key}`, s]),
);
