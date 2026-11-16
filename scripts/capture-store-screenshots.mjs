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
  // 固定一张渐变壁纸：预览页无 API 反代，在线图库 CORS 拦会卡在「正在加载」；
  // 同时让主屏背景每次一致，展示去掉白纱后的壁纸原色。
  const c = document.createElement('canvas');
  c.width = 1280; c.height = 800;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 800);
  g.addColorStop(0, '#b9cad6');
  g.addColorStop(0.40, '#dfe8ec');
  g.addColorStop(0.5, '#9fc0cd');
  g.addColorStop(1, '#2f5f78');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1280, 800);
  ctx.globalAlpha = 0.045; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
  for (let i = 0; i < 36; i++) {
    const y = 400 + (i / 36) * 400 + Math.random() * 8;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1280, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const wallpaper = c.toDataURL('image/jpeg', 0.85);

  // 天气兜底数据：预览页无 geolocation，灌一份 weather_last_ok 让天气卡显示真实数值
  const weather = {
    data: {
      temperature: 24, feelsLike: 25, humidity: 58, pressure: 1013,
      description: '晴', icon: 'sunny', city: '杭州', country: '中国',
      windSpeed: 8, windDeg: 90, timestamp: now,
    },
    ts: now,
  };
  const today = new Date();
  const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

  const seed = {
    todos: [
      { id: 'demo1', text: '整理本周项目周报', done: false, category: 'work', important: true, createdAt: now },
      { id: 'demo2', text: '预约周末体检', done: false, category: 'life', important: false, createdAt: now },
      { id: 'demo3', text: '读完设计心理学第三章', done: true, category: 'normal', important: false, createdAt: now },
    ],
    notes: [{ id: 'demo-n1', text: '会议要点：下周发布 v2.1；截图用真实运行画面', updatedAt: now }],
    weather_last_ok: weather,
    'om_weather_30.27_120.15': weather,
    settings: { weatherCity: '杭州', weatherCountry: '中国' },
    pomodoroSettings: { workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, roundsBeforeLongBreak: 4 },
    pomodoroStats: { date: dateStr, cycleCount: 2, completedToday: 2, totalAllTime: 12 },
    localWallpapers: [{ id: 'local:store-demo', dataUrl: wallpaper, name: '海岸晨光', addedAt: now }],
    savedWallpaperId: 'local:store-demo',
    savedWallpaperUrl: 'local:store-demo',
    savedWallpaperBlob: wallpaper,
    savedWallpaperBlobUrl: 'local:store-demo',
    savedWallpaperData: { id: 'local:store-demo', url: '', photographer: '本地图片', alt: '海岸晨光' },
  };
  for (const [k, v] of Object.entries(seed)) localStorage.setItem('pv:' + k, JSON.stringify(v));
});

const shots = [
  { name: '01-newtab-overview', label: '主界面总览', id: null },
  { name: '02-settings', label: '设置面板', id: 'settings-btn' },
  { name: '03-wallpaper-panel', label: '壁纸面板（本地壁纸库）', id: 'wallpaper-settings-btn', action: '.wallpaper-local-entry' },
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
  if (s.action) {
    const done = await page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return false; el.click(); return true; }, s.action);
    if (!done) console.warn('action 目标未找到:', s.action);
    await page.waitForTimeout(400);
  }
  const path = resolve(OUT, s.name + '.png');
  await page.screenshot({ path, fullPage: false });
  console.log('saved', path, '-', s.label);
}

await browser.close();
console.log('Done. 5 screenshots in', OUT);
