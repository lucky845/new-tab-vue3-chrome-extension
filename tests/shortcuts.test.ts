import { describe, it, expect } from 'vitest';
import { SHORTCUTS, SHORTCUT_MAP } from '../src/config/shortcuts';

describe('键盘快捷键注册表', () => {
  it('按键组合唯一，不会互相覆盖', () => {
    const combos = SHORTCUTS.map((s) => `${s.shift ? 'shift+' : ''}${s.key}`);
    expect(new Set(combos).size).toBe(combos.length);
  });

  it('查找表的键与定义一一对应', () => {
    expect(Object.keys(SHORTCUT_MAP)).toHaveLength(SHORTCUTS.length);
    for (const s of SHORTCUTS) {
      const key = `${s.shift ? 'shift+' : ''}${s.key}`;
      expect(SHORTCUT_MAP[key]).toBe(s);
    }
  });

  it('只用小写单字符匹配，Alt 由组件统一判定', () => {
    for (const s of SHORTCUTS) {
      expect(s.key).toMatch(/^[a-z]$/);
      // 显示用键序列首项必须是 Alt：组件只在 altKey 时触发，不一致会误导用户
      expect(s.keys[0]).toBe('Alt');
    }
  });

  it('打开面板的快捷键都指向真实面板 id', () => {
    const panelShortcuts = SHORTCUTS.filter((s) => s.action === 'open-panel');
    expect(panelShortcuts.length).toBeGreaterThan(0);
    for (const s of panelShortcuts) {
      expect(s.panel).toBeTruthy();
    }
  });

  it('聚焦搜索与收起全部各只有一条，避免语义重复', () => {
    expect(SHORTCUTS.filter((s) => s.action === 'focus-search')).toHaveLength(1);
    expect(SHORTCUTS.filter((s) => s.action === 'close-all')).toHaveLength(1);
  });

  it('收起全部使用 Alt+Shift 组合，与打开壁纸区分', () => {
    const closeAll = SHORTCUTS.find((s) => s.action === 'close-all');
    const openWallpaper = SHORTCUTS.find((s) => s.panel === 'wallpaper');
    expect(closeAll?.shift).toBe(true);
    expect(openWallpaper?.shift).toBeUndefined();
    // 同一个字母 + shift 才有意义，否则两条会落到同一个 keydown
    expect(closeAll?.key).toBe(openWallpaper?.key);
  });
});
