#!/usr/bin/env node
/**
 * 生成商店上架截图（1280x800，直角 full bleed）。
 *
 * 用法：
 *   node scripts/capture-store-screenshots.mjs [--url http://127.0.0.1:51999/newtab.html] [--out doc/store-screenshots]
 *
 * 默认走本地预览页（WXT 构建产物 .output/chrome-mv3 用静态服务器起在 51999）：
 *   cd .output/chrome-mv3 && python3 -m http.server 51999 --bind 127.0.0.1
 * 预览页 chrome.storage 由 shim 兜底，数据存在 localStorage 的 pv: 前缀键。
 * 若要截真实扩展页，--url 换成 chrome-extension://<扩展ID>/newtab.html。
 * 依赖：npm i -D playwright && npx playwright install chromium
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const URL = arg('--url', 'http://127.0.0.1:51999/newtab.html');
const OUT = resolve(arg('--out', 'doc/store-screenshots'));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

// 可复现演示数据（纯 localStorage pv: 键，不碰真实用户数据）
await page.addInitScript(() => {
  const now = Date.now();
  const seed = {
    todos: [
      { id: 'demo1', text: '整理本周项目周报', done: false, category: 'work', important: true, createdAt: now },
      { id: 'demo2', text: '预约周末体检', done: false, category: 'life', important: false, createdAt: now },
      { id: 'demo3', text: '读完设计心理学第三章', done: true, category: 'normal', important: false, createdAt: now },
    ],
    notes: [{ id: 'demo-n1', text: '会议要点：下周发布 v2.1；截图用真实运行画面', updatedAt: now }],
  };
  for (const [k, v] of Object.entries(seed)) localStorage.setItem('pv:' + k, JSON.stringify(v));
});

const shots = [
  { name: '01-newtab-overview', label: '主界面总览', id: null },
  { name: '02-settings', label: '设置面板', id: 'settings-btn' },
  { name: '03-wallpaper-panel', label: '壁纸面板', id: 'wallpaper-settings-btn' },
  { name: '04-weather-panel', label: '天气面板', id: 'weather-settings-btn' },
  { name: '05-todo-panel', label: '待办面板', id: 'todo-btn' },
];

for (const s of shots) {
  await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(900);
  if (s.id) {
    const clicked = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return false; el.click(); return true; }, s.id);
    if (!clicked) console.warn('按钮未找到，截全屏代替面板:', s.id);
    await page.waitForTimeout(500);
  }
  const path = resolve(OUT, s.name + '.png');
  await page.screenshot({ path, fullPage: false });
  console.log('saved', path, '-', s.label);
}

await browser.close();
console.log('Done. 5 screenshots in', OUT);
console.log('若某按钮 id 与当前版本不符，用 browser-read snapshot 确认后改 shots[].id。');
