# 商店名称查重与上架素材说明

> 本文记录 v2.1 上架前置的自我核查结论（2026-11-16）。名称查重为联网实测，截图脚本随仓库提供。

## 1. 名称查重结论：现有 listing 主名 "New Tab Pro" 撞名风险高

联网搜索（Chrome Web Store / Softonic / Extpose）发现以下已占用或近似条目：

| 名称 | 来源 | 链接 |
| --- | --- | --- |
| Infinity New Tab (Pro) / Infinity 新标签页 (Pro) | Chrome Web Store | https://chromewebstore.google.com/detail/infinity-new-tab-pro/nnnkddnnlpamobajfibfdgfnbcnkgngh |
| New Tab Pro（独立条目 ID pkkmiidnofcdhdimddpoifbpdknmfjil） | Extpose / Chrome Web Store | https://extpose.com/ext/pkkmiidnofcdhdimddpoifbpdknmfjil |
| Newtab Pro for Google Chrome | Softonic | https://newtab-pro.en.softonic.com/chrome/extension |

**判断**：`New Tab Pro` 与上述条目高度近似，Chrome 商店对"混淆性相似名称"有审核驳回先例，
且 ROADMAP §9 风险表本就标注"New Tab Pro 极高概率已被占用"。建议上架时启用独立品牌词作 listing 主名。

### 候选独立品牌词（均未在本次搜索中发现占用，最终以商店实测为准）

- **GlassTab** — 贴合液态玻璃视觉，ROADMAP §9 已举例；短、可注册、英文通用。
- **Lumina New Tab** — 光影意象，辨识度高。
- **澄页 / ClearTab** — 中文语境，强调"纯本地、清爽"。

选定主名后需同步更新：`public/_locales/*/messages.json` 的 `extensionName`、`README.md` 标题、
`doc/PRIVACY.md` 抬头、`BUILDING.md` 提及的产品名。扩展 ID 由商店分配，与名称无关。

## 2. 5 张 1280×800 商店截图

本次 5 张截图已用 Playwright 在预览页 `http://127.0.0.1:51999/newtab.html` 实拍，
落盘到 `doc/store-screenshots/`（逐张视觉核验通过）。自动化环境无法直接访问
`chrome-extension://` 扩展页，故走预览页出图。若需重出图，随仓库提供脚本
`scripts/capture-store-screenshots.mjs`（Playwright），本机运行即可。
注意：预览页无在线壁纸 API 反代，脚本走本地壁纸库视图（用 canvas 生成壁纸 dataUrl
经 `addInitScript` 注入 `pv:localWallpapers`），否则在线图库 CORS 拦会停在"正在加载"。

```bash
# 1) 装依赖（一次性）
npm i -D playwright && npx playwright install chromium

# 2) 起预览（若截预览页；端口已在跑则跳过）
npm run build && cd .output/chrome-mv3 && python3 -m http.server 51999 --bind 127.0.0.1 &

# 3) 出图，产物在 doc/store-screenshots/
node scripts/capture-store-screenshots.mjs
```

脚本默认截 5 张：主界面总览、设置面板、壁纸面板、天气面板、待办面板。
若想截真实扩展页而非预览页，用 `--url chrome-extension://<你的扩展ID>/newtab.html`。
按钮 id 若与版本不符，脚本会告警并截全屏代替——按提示改 `shots[].id` 即可。

**5 张截图建议视角**（与 ROADMAP §9.3 对齐：直角 full bleed、文字 ≥32px）：
1. 主界面总览 —— 搜索框 + 快捷访问 + 左右翼卡片同框，体现"好看的桌面"
2. 设置面板 —— 主题/壁纸/数据子页，体现可定制
3. 壁纸面板 —— 本地壁纸库 + 在线分类，体现视觉驱动
4. 天气面板 —— 定位 + 多数据源，体现信息密度
5. 待办面板 —— 分类筛选 + 便签/番茄，体现效率属性

## 3. 440×280 宣传图与 128×128 图标

- 440×280 小型宣传图：用上述主界面截图裁切 + 加产品名，建议脚本外人工设计（文案与排版需审美判断）。
- 128×128 合规图标：`public/icons/icon128.png` 已存在（10973 bytes），当前为满幅图形；
  ROADMAP 要求 "96×96 图形 + 16px padding"，上架前需确认现图是否已留白，未留白则用图像工具补 16px padding。
