# 商店上架清单 v2.2.2

2026-11-18。这份文档把提交 Edge 合作伙伴中心和 Chrome Web Store 时要填的字段集中列出来，可以直接照着填。

字段依据微软官方的 publish-extension 文档。清单里的 name、description、shortDescription 会自动带进商店一览，上传后这几个字段只读。

## 1. 提交用的 zip

| 文件 | 版本 | 用途 |
| --- | --- | --- |
| .output/new-tab-vue3-chrome-extension-2.2.2-chrome.zip | 2.2.2 | Chrome Web Store |

Edge 包用同一条命令生成（`npm run zip` 后按需改 `wxt.config.ts` 的 browser 目标）。

由 v2.2.2 源码构建（WXT 0.21.5）。解包核对过 manifest：

- version 2.2.2，default_locale zh_CN，另有 en
- permissions 为 storage 和 geolocation
- host_permissions 是 10 个接口和图床域名，不含 *://*/*
- content_security_policy.extension_pages 的 script-src 为 'self'
- 产物 12 个文件过 `npm run check:remote-code` 门禁（无远程 script / 动态 import）

注意 .output/ 下还留着 2.0.0 / 2.1.0 / 2.2.0 的旧 zip，其中 2.0.0 带 *://*/* 全站点权限，**不要提交**。认准文件名里的 -2.2.2-。

## 2. 扩展名称

| 语言 | 当前取值 | 来源 |
| --- | --- | --- |
| 中文 | 新标签页 Pro | manifest name → __MSG_appName__ |
| 英文 | New Tab Pro | en locale |

New Tab Pro 和商店里已有的条目重名或近似：Infinity New Tab (Pro)、独立的 New Tab Pro（ID pkkmiidnofcdhdimddpoifbpdknmfjil）。Chrome 商店对混淆性相似名称有驳回先例，细节见 doc/STORE_ASSETS.md 第 1 节。

备选的独立品牌词：GlassTab、Lumina New Tab、澄页 ClearTab。最终名称以商店实测为准。

改名要同步这几处：public/_locales/*/messages.json 的 appName、README 标题、doc/PRIVACY.md 抬头、BUILDING.md。顺带纠正一下：STORE_ASSETS.md 里写的 extensionName 键名是错的，实际键是 appName。

## 3. Edge 商店字段对应关系

| manifest 字段 | 商店一览字段 | 上传后可改 | 当前取值 |
| --- | --- | --- | --- |
| name | 扩展名称（语言 > 详细信息） | 否 | 见第 2 节 |
| description | 说明（列表顶部） | 否 | 见第 5 节 |
| shortDescription | 商店一览简短说明 | 否 | 见第 4 节，当前 manifest 没有这个字段 |
| permissions / host_permissions | 权限声明 | — | 见第 6 节 |
| default_locale | 默认语言 | — | zh_CN |

manifest 里没有 shortDescription 时，商店会拿 description 的前几行顶上，列表和详情就会重复。微软建议填上。

## 4. 简短说明

上限 132 字符。下面两条都在这个范围内。

| 语言 | 文案 | 字符数 |
| --- | --- | --- |
| 中文 | 纯本地新标签页：壁纸、时钟、天气、待办、便签、番茄钟，左右两翼常驻，零后端无收集。 | 41 |
| English | Local new tab: wallpapers, clock, weather, todo, notes, pomodoro. No backend, no tracking. | 90 |

这个字段还没进包。要让它随包带进商店，得在 wxt.config.ts 加 shortDescription: '__MSG_appShortDescription__'，再给两份 messages.json 加对应的键，然后重新构建 zip。这是代码改动，走 PR。另一个办法是在 Partner Center 手动填，不改代码，但要记得这个字段上传后只读，填错只能重新打包上传。

## 5. 说明

中文：

    纯本地新标签页，打开即用，零后端、无账号、不收集任何数据。

    · 壁纸：Picsum / Pexels / Wallhaven 在线图库 + 本地图片库（最多保存 4 张）
    · 时钟与天气：多数据源，定位需你主动点选才授权，未授权也能用默认城市
    · 效率工具：待办（含分类）、便签、番茄钟，左右两翼常驻
    · 快捷访问：拖拽归类进文件夹、搜索历史内搜索
    · 数据自主：全部存于本机 chrome.storage.local，可在设置里一键导出 / 导入备份
    · 隐私优先：不含统计 SDK、无远端埋点，所有数据留在你的浏览器里

English:

    A local-first new tab, ready on open. No backend, no account, no data collection.

    · Wallpapers: Picsum / Pexels / Wallhaven galleries + a local image library (up to 4)
    · Clock & weather: multiple data sources; location is opt-in, with a default city
    · Productivity: todo (with categories), notes, pomodoro, always-on side widgets
    · Quick access: drag to group into folders, search within your search history
    · Your data: stored locally in chrome.storage.local, with one-click export/import
    · Privacy first: no analytics SDK, no remote tracking, everything stays in your browser

## 6. 权限说明

内容来自 doc/PRIVACY.md。

| 权限 | 为什么需要 |
| --- | --- |
| storage | 保存设置、壁纸缓存、快捷访问、待办、便签、番茄钟等全部本地数据 |
| geolocation | 天气组件定位到所在城市。首次打开不会弹定位框，只有在天气设置里点「使用当前位置」才取坐标 |
| host_permissions | 仅下列 10 个接口和图床域名的跨域请求，不含 *://*/*，不申请网站的通用访问权，不注入脚本 |

10 个域名：api.pexels.com、images.pexels.com、restapi.amap.com、api.open-meteo.com、geocoding-api.open-meteo.com、wallhaven.cc、th.wallhaven.cc、w.wallhaven.cc、picsum.photos、*.picsum.photos。

数据存了什么、何时联网、向谁发送，见 doc/PRIVACY.md。

## 7. 隐私政策 URL

Edge 和 Chrome 都要求填一个公开可访问的隐私政策地址。本扩展用 GitHub 上公开的隐私说明文件：

https://github.com/lucky845/new-tab-vue3-chrome-extension/blob/master/doc/PRIVACY.md

仓库是公开的，2026-11-16 实测这个地址返回 200，浏览器打开就是渲染后的隐私说明。它指向 master 分支的 doc/PRIVACY.md，文件内容更新后这个地址不用改。若商店只接受纯文本地址，备用 raw 地址：https://raw.githubusercontent.com/lucky845/new-tab-vue3-chrome-extension/master/doc/PRIVACY.md（同为 200）。

## 8. 截图和宣传图

| 素材 | 路径 | 状态 |
| --- | --- | --- |
| 主界面总览 | doc/store-screenshots/01-newtab-overview.png | 已完成，1280x800 |
| 设置面板 | doc/store-screenshots/02-settings.png | 已完成 |
| 壁纸面板 | doc/store-screenshots/03-wallpaper-panel.png | 已完成 |
| 天气面板 | doc/store-screenshots/04-weather-panel.png | 已完成 |
| 待办面板 | doc/store-screenshots/05-todo-panel.png | 已完成 |
| 440x280 宣传图 | doc/store-screenshots/06-promo-440x280.png | 已完成，440x280，整页缩放无裁切 |
| 128x128 图标 | public/icons/icon128.png | 已完成，实测留白 L29/T19/R30/B23 px（约 15%–23%，符合商店「四周留白、不贴边」要求） |

## 9. 提审前还要做的事

这几项自动化跑不了，得在真扩展上做。**2026-11-18 已完成的部分**（证据见交付记录）：

- ✅ 真扩展（Chrome 157 + CDP `Extensions.loadUnpacked`）冒烟 6 脚本 65 项断言全过，控制台 0 错误
- ✅ 真扩展里跑通备份导出 / 复制 / 粘贴导入 / 非法拒绝 / 往返还原（4 条路径 18 项断言）
- ✅ 440x280 宣传图已做（`doc/store-screenshots/06-promo-440x280.png`）
- ✅ 128x128 图标留白实测合规（L29/T19/R30/B23）
- ✅ 隐私政策 URL 两个地址 2026-11-16 实测 200

**仍需人工完成**：

- Edge / Firefox 各跑一遍冒烟（Chrome 已过，另两个浏览器未测）
- 在 Partner Center / CWS 后台实填字段并提交
- 名称重名风险确认（New Tab Pro 有近似条目，备选词见第 2 节）
