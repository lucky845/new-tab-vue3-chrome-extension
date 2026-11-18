# Unreleased

# 2.2.2 (2026-11-18)

性能小版本：冷启阻塞下降约 70%，无新功能、零新权限、零新依赖。

## 性能

- **冷启 TBT 6477ms → 1895ms（-70.7%）**：根因不在 PNG 编码本身（受控实验里同内容重复编码 900 倍波动、纯色画布 median 0.5ms），而是玻璃库 `encodeLensMap` 用未声明 `willReadFrequently` 的 2d canvas 做 `toDataURL`——渲染表面走 WebGL，读回要过 GPU 回读才同步，24 次调用在冷启阻塞 5037ms（单次最高 2343ms，占 CPU profile 71.7% 采样）。库内另一处同用途调用已带该标志，属疏漏。新增 `src/lib/canvas-readback.ts` 在 boot 最早期给原型打垫片：**仅对「未插入文档的 2d canvas」**补 `willReadFrequently:true`，调用方显式传值不覆盖，webgl 一律不碰——逐帧重绘的动画画布仍在 GPU 上，性能零风险。实测 toDataURL 累计 5037ms→5ms、单次峰值 2343ms→1ms，长任务 6–9 个→2 个
- **剩余 1.6s 长任务归因（非本次改动）**：冷启仅剩的 1.2–1.6s 长任务是 WebGL2 首个上下文创建（1x1 canvas，1332ms），有头真机（ANGLE Metal / M1 Pro）同样 1133ms、同页第二个 webgl2 仅 4ms —— GPU 进程冷启动的固定开销，与应用代码无关

## 可访问性

- **`⋯` 更多操作按钮命中区 20×20 → 24×24**：Lighthouse 唯一失败项 `target-size`（WCAG 2.2 要求 ≥24×24）。可见圆点仍 20px（改由 `::after` 绘制），响应区扩到 24px；同时移除隐藏态的 `scale(0.86)` 缩放——它会把 24px 命中区实际缩到 20.64px，等于白改

# 2.2.1 (2026-11-18)

工程收尾与上架准备：搜索引擎去重、商店材料补齐、代码审查修复与全套工程门禁。零新权限、零新依赖。

## 修复

- **中间宽度缩放网格重叠 + 文件夹预览溢出**：①700–920px 视口（含浏览器缩放后的 CSS 宽度）下，`data-wings=both` 的「给两翼让 560px」规则仍生效，但两翼早已 display:none，实测 810px 屏网格只剩 250px、86px 图标塞进 3 列互相重叠；把同特异性让位豁免从 ≤700px 上提到 ≤920px 真断点，裸选择器覆盖因特异性不足无效是前次漏修的原因。②手机 60px 图标下，主页文件夹的 2×2 缩略预览仍用固定 30px 子格 + 10px 内边距，实测溢出预览框；改成外层固化 `--preview-size`、padding 按 8% 缩放、子格用绝对 calc 取尺寸（直接写百分比会因 CSS 变量循环依赖缩成 5px）。CDP 探针量 390/768/810/900/1024/1280 六视口 + 1.1/1.25/1.5 三档 zoom 均无重叠无溢出
- **UI 评审三项高优先级修复**：①手机布局——天气卡与顶栏不再叠压（截图工具实测 `#todo-btn` 曾被 `div#temperature` 挡住），快捷方式恢复 3 列；根因是 `data-wings=both` 的「给两翼让 560px」规则在 390px 屏算出 `max-width:0px` 把网格塌成 0 列，手机断点显式覆盖让位规则。②玻璃面板过透——`--panel-glass-scrim` 浅色 0.82→0.94、深色 0.82→0.9，番茄钟 25:00 不再与背景时钟重影。③壁纸库分类降级提示——去掉遮挡搜索框的短命 toast 与侧栏底部重复提示，改为面板内常驻提示 + 不可用分类入口置灰。改动仅 CSS/模板/文案，无业务逻辑变更
- **天气失败原因被吞**：高德返回的 `INVALID_USER_KEY` / `USERKEY_PLAT_NOMATCH` / 配额类等错误码虽已抬到 `err.amapInfo`，但卡面一律显示「天气获取失败」，用户无法自助判断是 key、网络还是限频。抽出可测纯函数 `classifyWeatherError`，把高德码 / 定位权限 / 网络超时 / 城市四类分别给可执行提示；新增 14 用例（累计 16 文件 162 用例）
- **文件夹弹层图标「两层圆角」**：根因是「探测 favicon 是否铺满画布」在扩展约束下恒失败（faviconV2 无 ACAO，fetch/Canvas 均被拦），自带方形底的图标走了无蒙版分支，内层方形与外层玻璃圆角不同心。删除失效探测，远程图统一 70% + squircle 蒙版

## 工程保障

- **搜索引擎去重重构**：新增 `src/lib/engineDedup.ts`（`engineKey` 归一化 + `dedupeEngines` 去重，大小写不敏感、保留先出现者、空名丢弃）。修掉自定义引擎可与内置重名导致下拉出现两个 Bing 的问题：水合时清洗脏数据并回写 storage、新增时对内置+自定义两侧查重。新增 17 用例（累计 20 文件 198 用例）
- **商店上架材料补齐**：`doc/STORE_LISTING.md` 更新至 v2.2.1（zip 清单、实测 manifest、提审状态核对）；新增 440x280 宣传图 `doc/store-screenshots/06-promo-440x280.png`；128x128 图标留白实测 L29/T19/R30/B23 合规；构建 `.output/new-tab-vue3-chrome-extension-2.2.0-chrome.zip`（233.01 kB，12 文件过远程代码门禁）
- **对话框迁原生 <dialog>**：`useDialog` 原来是手搓模态框（`role=dialog` + `aria-modal` + 自己维护 Tab 焦点囚禁 / Esc / 遮罩 / 焦点复位），正是官方 dialog 指南 DON'T 清单里点名的写法。改用 `showModal()` 拿到 top-layer、浏览器级 inert、焦点管理与 Esc；保留 `.dsh-dialog` class 与全部 DOM/CSS 结构，调用方（FolderOverlay 的 prompt/confirm）与 `useEscapeClose` 的让路判定零改动。遮罩点击改按 `panel` 的 rect 判定（dialog 自身是 `inset:0` 全屏容器，用它判永远算「在内部」）。代价补一课：清 UA 默认样式时顺手清掉了 `margin:auto`，而它正是 dialog 默认居中的来源，真机截图复现面板贴左上角——补 `width/height:100%` 让 `inset:0 + flex` 重新居中后，桌面与 390px 移动端截图均居中。新增 `tests/dialog.test.ts` 8 用例（累计 19 文件 181 用例）
- **移动端缩放后顶栏压时钟修复**：≤700px 断点下顶栏被改成整行居中（top:108~176），时钟在文档流里从顶部排，缩放/窄窗口下相撞；把时钟下移写进唯一真源 `src/styles/shell.css`，用 `padding-top:150px`（不用 margin——短视口下会被 `.content-wrapper{margin-top:1vh}` 折叠吞掉）。实测 360/375/390/414 宽 × 740/800/844/896 高 + 1.1/1.25/1.5 倍缩放，可见时钟数字全部在顶栏下方、零重叠
- **代码审查修复**：独立审查发现 3 项 P2 并处置——TodoPanel 两处手写 `cat-${category}` 改复用共享 `categoryClass`（消除归一遗漏）；`classifyWeatherError` 网络分类改为 code 严格优先、仅 code 缺失时回退 message（修注释与实现不符 + 补冲突回归用例）；R6 窄口径扫描保留并在文档确认设计边界。新增 1 用例（累计 18 文件 173 用例）
- **主题写入幂等优化**：`useTheme.applyTheme` 写 DOM 属性前先读比对，值相同不写，避免 60s 定时器 + 8 处状态调用反复触发样式重算（新增 4 用例量化 setAttribute 调用次数）；累计 18 文件 172 用例
- **工具图标指令归一**：ToolsCard / ToolsPanel 逐字重复的 `renderToolIcon` + `vToolIcon` 抽到 `src/directives/toolIcon.ts`，两组件各删 ~18 行，行为零变化
- **重复展示逻辑归一**：Todo 卡/面板的 `categoryIcon`/`categoryTitle`/`categoryClass`/`dueText` 与图标映射抽到 `src/lib/todo-display.ts`（6 用例）；Notes 卡/面板逐字重复的 textarea 引用与 500ms 防抖保存抽到 `src/composables/useNoteCardActions.ts`（顺带补卸载 timer 清理）；累计 17 文件 168 用例
- **天气错误分类抽离**：把零依赖纯函数 `classifyWeatherError` 从 1590 行的 `useWeather.ts` 抽到 `src/lib/weather-error.ts`（composable 减 60 行），测试改为直接 import 纯函数模块、不再拖 chrome/vue 依赖；原 composable 保留 re-export 兼容，外部 API 不破
- **请求封装补测**：新增 `tests/http.test.ts`（11 用例），钉死 `fetchJSON` 的 JSON/文本解析、网络错误/429/5xx 重试与 4xx 不重试、超时 `ABORT_ERROR`、错误结构化与 `retryOn` 覆盖（该模块被天气/壁纸全量依赖却零覆盖）；累计 15 文件 148 用例
- **图标分类闸门补测**：新增 `tests/iconSafe.test.ts`（11 用例），钉死 `isDataImage` / `siteIconUrl` / `isRemoteIcon` / `firstCharOf` 的分类语义——这几个纯函数是 AppIcon 蒙版分支的闸门，防止「两层图标」回归；累计 14 文件 137 用例
- **R6 远程代码门禁**：新增 `npm run check:remote-code`，构建后扫描三浏览器产物，发现远程 `script src` / `import()` 立即失败；Vitest 11 用例覆盖 fetch/CSP/SVG 命名空间等放行边界（总 126 用例）

---

# 2.2.0 (2026-11-18)

体验打磨与无障碍版本：液态玻璃面板、番茄钟跨标签页存活、搜索历史固定、
浮层统一 Esc、面板焦点陷阱与动效降级。零新权限、零账号、零遥测。

## 新增

- **液态玻璃面板**（PR #32）：面板 / 卡片 /  chips / 控件四档折射参数；浮字随壁纸亮度自动翻面（深色主题恒白字保对比度）
- **小工具扩充**（PR #37）：新增 JWT 解码、HTML 实体转义，共 14 个工具；宫格改面板内滚动
- **备份复制到剪贴板 / 粘贴导入**（PR #37）：复用 clipboard 降级链，零新权限
- **番茄钟跨标签页存活**（PR #38）：运行态按 deadline 持久化，刷新/重开浏览器后恢复；不申请 alarms/notifications 权限，后台冻结时回到页面即结算
- **搜索历史固定（pin）**（PR #38）：常用搜索置顶，历史上限统一 20 条，旧纯字符串数据自动迁移
- **浮层统一 Esc 关闭**（PR #40）：面板 / 文件夹 / 右键菜单 / 搜索下拉逐层退出，对话框与拖拽进行中不误关
- **无障碍第一批**（PR #41）：面板统一 dialog 语义 + 焦点陷阱（Tab 面板内循环、关闭归还焦点），图标按钮与分页控件可访问名补全
- **动效降级开关**（PR #42）：设置 · 主题页一键减少动效；系统「减少动态效果」偏好始终自动生效

## 变更

- **移除全局键盘快捷键**（PR #39）：Alt 组合与浏览器/系统快捷键冲突面无法穷举，设置项与代码一并清除
- `useTip` 命令式 DOM 改为 Vue 队列渲染（PR #36），气泡定位抽纯函数
- 备份注册表补充番茄钟运行态键（标记为缓存，不跨设备恢复绝对时间戳）

## 修复

- 预览 shim `storage.local.get(null)` 返回空导致备份导出空文件（PR #31）
- 浅色主题取消壁纸白纱（PR #31）；小工具卡白闪（液态玻璃小件关闭镜面高光，PR #32）
- 陈旧注释与 ROADMAP 状态漂移清理（PR #33 / #34）；typescript-eslint 升级清除 minimatch 中危告警（PR #35）

## 工程保障

- Vitest 从 44 用例扩到 **12 文件 115 用例**（剪贴板 / 壁纸亮度 / 番茄钟运行态 / 搜索历史 / Esc 层级 / 焦点陷阱 / 动效降级）
- CI 持续执行 lint + test + 三浏览器打包

---

# 2.1.0 (2026-11-16)

从 1.x 原生 JS 版完整重写为 Vue 3 + TypeScript + WXT 架构后的首个功能大版本。
零账号、零云同步、零埋点——所有数据只存本地 `chrome.storage.local`。

## 新增

- **液态玻璃视觉骨架**：图标方块、顶栏按钮、面板弹窗统一折射材质；面板从点击处展开（PR #19 / #23）
- **本地壁纸库**（PR #13 / #15 / #16 / #20）：上传图片 canvas 压缩后入库，可见/可应用/可删除，重启零网络直出；分类侧栏独立入口，容量上限对用户可见
- **左右翼四卡常驻**（PR #10 / #17 / #21）：待办 / 番茄钟 / 便签 / 小工具三态显隐（有内容时出现 / 总是 / 隐藏），列数实测自适应
- **空状态与引导**（PR #11）：快捷访问、待办无数据时的引导文案
- **搜索历史内搜索**（PR #12）：输入即过滤历史，过滤态可单删
- **通用组件抽离**（PR #19 / #21）：GlassPanel / ToastHost / SideCard，Toast 样式与面板同源
- **设置面板重构**（PR #22）：头部固定、待办分类跟随筛选、标题左对齐
- **备份覆盖补全**（PR #24）：本地壁纸库 / 主题 / 侧卡数据纳入导入导出，本地壁纸哨兵持久化
- **工程保障**（PR #14 / 本版）：ESLint 全量接管 TS/Vue；Vitest 44 用例覆盖 5 个关键模块；CI 接入 lint + test

## 变更

- 面板与弹窗材质由毛玻璃改为高斯模糊，提升可读性与渲染性能（PR #23）
- 默认站点按浏览器语言分流（中文 CN / 其他 GLOBAL），首装不弹定位授权（PR #6）
- 砍掉 `*://*/*` host_permissions，favicon 改走 CSP `img-src` 白名单直连（PR #4）
- vue-tsc 升 `^3.3.14`，清除 minimatch 依赖告警链（PR #9）

## 修复

- 全屏面板误挂玻璃物理效果导致「弹窗跟鼠标漂移」+ 巨大蒙版挡点击
- 目录网格在 700–980px 反复 3/4/5 列跳变
- 拖拽框误圈下一行、拖到文件夹左右横跳导致图标消失

---

# 2.0.0

- Vue 3 + TypeScript + WXT 全面重写，功能对齐 1.x。
