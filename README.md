# New Tab Pro

一个纯本地的 Chrome / Edge 新标签页扩展：液态玻璃视觉、可自定义的快捷访问、壁纸、天气、待办、便签、番茄钟与小工具，全部数据只存在本机。

> [!IMPORTANT]
> **1.x（原生 JS 版）已归档，本项目从 2.0 起在此仓库独立迭代。**
> 旧仓库 [new-tab-chrome-extension](https://github.com/lucky845/new-tab-chrome-extension) 已设为只读存档，代码保持原样，仅历史可查。
> 2.0 用 Vue 3 + TypeScript + WXT 全面重写，功能对齐 1.x 并继续开发；目前尚未发布商店版本，请从下方「快速开始」或 Release 附件获取。

## 版本对照

|            | 1.x · new-tab-chrome-extension                                         | 2.0 · 本仓库                                              |
| ---------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| 运行方式   | 仓库即产物，加载目录即可                                               | 需构建（`npm install` + `npm run build`）                 |
| 技术栈     | 原生 ES2020，无构建系统                                                | WXT + Vue 3.5 + TypeScript 5.7 + Vite                     |
| 液态玻璃   | 自研 WebGL2 实时折射（`js/utils/liquid-glass.js`，无 WebGL2 回退 SVG） | `@surdeddd/liquidglass`（css-svg 后端，CSP 下主线程降级） |
| 快捷访问   | 每页 10 格，图标下带名称，文件夹 2×2 预览 + 数量角标                   | 图标方块 + 名称外置，文件夹九宫格分页、无角标             |
| 拖拽       | SortableJS                                                             | 指针事件自研（换位补间 / 悬停合并 / 停留新建文件夹）      |
| 面板与弹窗 | 各自实现                                                               | 统一磨砂材质 + 从点击处展开的进场动画                     |
| 状态       | **已归档**，只读存档                                                   | 活跃开发                                                  |

## 特性

- **🪟 液态玻璃界面**：面板、图标方块、顶栏按钮统一折射玻璃材质；弹窗从点击处展开，背景不做蒙版模糊。
- **🔍 多引擎搜索**：内置百度 / Google / Bing / 搜狗 / DuckDuckGo，支持自定义引擎；搜索引擎图标可上传图片裁切、抓取站点 favicon 或落到名称首字。
- **🧩 快捷访问**：自定义站点与文件夹（九宫格 + 分页），指针事件自研拖拽 —— 拖动换位带补间动画、悬停文件夹合并、两个图标停留即合并成新文件夹。
- **🖼 壁纸**：Picsum / Wallhaven / Pexels（自带 Key 时），支持搜索关键词、亮度与模糊调节；图片字节本地缓存，二次打开不再请求图床。
- **🌤 天气**：Open-Meteo 免费天气（可留空）、高德定位，30 分钟自动刷新，多级缓存与限流。
- **✅ 待办 / 📝 便签 / 🍅 番茄钟**：左右两翼常驻卡片，展开为面板；输入即落盘。
- **🧰 小工具**：时间戳、JSON、Base64、URL 编解码、SHA-256、进制转换、大小写、去重、字数统计、取色、密码、UUID —— 纯前端、零网络。
- **🎨 主题**：亮色 / 暗色 / 跟随系统 / 日出日落四种模式，首屏由同步脚本预置，无白闪。
- **💾 备份与恢复**：设置面板一键导出 JSON，导入时校验应用标识与 schema 版本，不合法整体拒绝。
- **🔒 纯本地**：无后端、无账号、无埋点；设置、壁纸缓存、待办等全部存在 `chrome.storage.local`。

玻璃与主题的量化验收（色度保留率、文字对比度、渲染耗时）沿用 1.x 的说明，见 [1.x README](https://github.com/lucky845/new-tab-chrome-extension#readme)。

## 技术栈

| 层       | 选型                                                                       |
| -------- | -------------------------------------------------------------------------- |
| 扩展框架 | [WXT](https://wxt.dev/) 0.21（Manifest V3，`chrome_url_overrides.newtab`） |
| 视图     | Vue 3.5 `<script setup lang="ts">` + TypeScript 5.7                        |
| 玻璃渲染 | @surdeddd/liquidglass（css-svg 后端，CSP 下自动降级到主线程位移贴图）      |
| 样式     | 原生 CSS 主题令牌 + Tailwind CSS v3（shadcn-vue 约定，reka-ui）            |
| 拖拽     | 指针事件自研（`src/composables/useIconDrag.ts`）；待办列表使用 SortableJS  |

## 快速开始

要求 Node.js 22.12+ 与 npm（WXT 0.21 要求 Node ≥ 22，Vite 8 要求 ≥ 22.12）。

```bash
git clone https://github.com/lucky845/new-tab-vue3-chrome-extension.git
cd new-tab-vue3-chrome-extension
npm install          # postinstall 会自动执行 wxt prepare
npm run dev          # 开发模式：自动拉起浏览器并加载扩展
```

### 加载构建产物

```bash
npm run build        # 产物输出到 .output/chrome-mv3
```

1. 打开 `chrome://extensions`，开启右上角「开发者模式」
2. 点击「加载已解压的扩展程序」，选择 `.output/chrome-mv3`
3. 新开标签页即可使用

修改代码后回到扩展页点击刷新按钮；页面结构或 manifest 变更时建议重新加载扩展。

## 常用脚本

| 命令                           | 说明                                    |
| ------------------------------ | --------------------------------------- |
| `npm run dev`                  | 开发模式（WXT）                         |
| `npm run build`                | 构建 Chrome 版本到 `.output/chrome-mv3` |
| `npm run build:firefox`        | 构建 Firefox 版本                       |
| `npm run zip`                  | 打包当前浏览器产物，用于商店提交        |
| `npx wxt zip -b firefox --mv2` | 打 Firefox（Manifest V2）包             |

三种浏览器的成品包由 CI 在打 tag 时自动构建，见下方「发布流程」。
| `npm run compile` | `vue-tsc --noEmit` 类型检查 |
| `npm run lint` | ESLint（当前仅校验配置文件）+ 类型检查 |
| `npm run lint:fix` | ESLint 自动修复 + 类型检查 |
| `npm run format` | Prettier 格式化 `src/` |

## 项目结构

```text
entrypoints/
  newtab.html            新标签页入口（同步主题引导 + Vue ESM 挂载）
src/
  boot.ts                createApp、注册 glass 指令、挂载
  App.vue                页面骨架、面板与卡片的 Teleport 宿主
  components/            Vue SFC（搜索、快捷访问、各面板与卡片、AppIcon 等）
  composables/           业务 composable（useSearch / useQuickAccess / useWeather ...）
  config/                默认站点、小工具定义、天气配置
  core/glass-panels.ts   顶栏按钮、侧卡、天气卡的玻璃装饰
  lib/                   玻璃桥接、存储、HTTP、备份、图标安全等工具层
  styles/                shell / glass / tailwind 样式
public/
  theme-preboot.js       首屏同步主题引导（CSP 禁内联，保证无白闪）
  theme/app.css          全局主题样式与视觉令牌
  _locales/              扩展名称与描述的多语言文案
  icons/                 扩展图标（16 / 48 / 128）
```

## 本地调试的接口反代

用静态服务器预览 `.output` 或直接以 `http://` 打开页面时，页面源是 `http://127.0.0.1:xxxx`，调用 Open-Meteo / Wallhaven 等接口会被 CORS 拦下。打开反代即可同源访问：

```bash
WXT_VUE3_API_PROXY=1 npx wxt . -p 3100
```

- 页面侧请求 `/__api/<host>/<path>` 会被 Vite 转发到 `https://<host>/<path>`；改写逻辑见 `src/lib/http.ts` 的 `resolveFetchUrl()`，代理规则见 `wxt.config.ts` 的 `buildProxy()`。
- 默认关闭，只在 `import.meta.env.DEV` 且非扩展源时生效；生产构建里该前缀恒为 `undefined`，请求原样直连。
- 扩展正式运行时依赖 `host_permissions`，不经过反代。
- `wxt` 必须带项目根目录参数（`npx wxt .`），否则它会把上级目录当成项目根，去 `./dev/entrypoints` 找入口并报错。

## 分支与提交

`master` 是受保护分支：**不能直接 push，也不能强推/删除**，所有改动都要走 Pull Request 合并。

```bash
git checkout master && git pull
git checkout -b feat/your-change
# ...修改...
npm run compile && npm run build   # 提交前自检
git commit -am "feat: ..."
git push -u origin feat/your-change
gh pr create --fill                 # 或在网页上开 PR
```

PR 合并后分支会保留在远端，可按需删除：`git push origin --delete feat/your-change`。

保护规则（Settings → Rules 管理）：

| 规则                            | 作用                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| Require a pull request          | 只能通过 PR 合并；approve 数要求为 0（单人维护不阻塞），过期 review 在推送后自动失效 |
| Require linear history          | 只允许 squash / merge，**不允许 rebase merge**，历史保持线性                         |
| Block force pushes              | 禁止 `--force` 覆盖远端历史                                                          |
| Restrict deletions              | 禁止删除 `master`                                                                    |
| Require conversation resolution | PR 里未解决的 review 评论会阻止合并                                                  |

紧急情况需要绕过时，用仓库 owner 权限在 Settings → Rules 里临时把规则设为 Disabled，处理完再打开。

## 发布流程

打 tag 即出包，流水线见 [`.github/workflows/release.yml`](.github/workflows/release.yml)：

```bash
npm version patch        # 或 minor / major，自动改 package.json 并打 v 前缀 tag
git push && git push --tags
```

推送 `v*` 标签后 CI 依次执行：`npm ci` → `npm run compile` 类型检查 → **校验 tag 版本与 `package.json` 一致**（不一致直接失败）→ 用 WXT 分别打包 Chrome / Edge / Firefox(MV2) → 汇总 `SHA256SUMS.txt` → 创建 GitHub Release 并附上全部产物。

| Release 附件                      | 适用                         |
| --------------------------------- | ---------------------------- |
| `new-tab-pro-v<版本>-chrome.zip`  | Chrome 及同内核浏览器        |
| `new-tab-pro-v<版本>-edge.zip`    | Microsoft Edge               |
| `new-tab-pro-v<版本>-firefox.zip` | Firefox（Manifest V2）       |
| `new-tab-pro-v<版本>-sources.zip` | Firefox 商店审核所需的源码包 |

也可以在 Actions 页手动触发 `Release` 工作流：只构建并上传工作流产物，不创建 Release，用来发版前试包。

## 权限说明

| 权限               | 用途                                                          |
| ------------------ | ------------------------------------------------------------- |
| `storage`          | 保存设置、壁纸缓存、快捷访问、待办、便签等全部本地数据        |
| `geolocation`      | 天气组件定位到所在城市（首次使用会请求授权）                  |
| `host_permissions` | 跨域 `fetch` 壁纸原图、天气接口与站点 favicon；不注入任何脚本 |

数据不上传；卸载扩展或在扩展详情里清除数据即彻底删除。

## 配置

- **天气**：`src/config/weather.ts`，默认留空 API Key 走 Open-Meteo 免费接口，接入高德的步骤见 [WEATHER_SETUP.md](WEATHER_SETUP.md)。
- **默认快捷站点**：`src/config/defaultSites.ts`。
- **小工具**：`src/config/tools.ts`，新增工具只需补一条 `QuickTool` 定义。
- **主题令牌**：`public/theme/app.css` 顶部的 CSS 变量（亮 / 暗各一套）。

## 贡献

欢迎提 Issue 与 PR。提交前请确保 `npm run compile` 与 `npm run build` 通过；代码风格沿用仓库内的 ESLint / Prettier 配置。

## 致谢

- [WXT](https://wxt.dev/)、[Vue](https://vuejs.org/)、[Vite](https://vite.dev/)
- [@surdeddd/liquidglass](https://www.npmjs.com/package/@surdeddd/liquidglass) 提供液态玻璃渲染
- [Open-Meteo](https://open-meteo.com/)、[Wallhaven](https://wallhaven.cc/)、[Picsum](https://picsum.photos/) 提供公开数据服务

## License

[MIT](LICENSE) © 2025 lucky845
