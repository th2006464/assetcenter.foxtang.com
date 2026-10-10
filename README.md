# 自动化终端管理平台

部署在 Cloudflare Pages 上的 IT 资产看板。公开首页复用 Auth Center Console 登录样式，用户手动点击 Google 按钮进入统一申请流程。通过独立 Cloudflare Access 应用认证后，浏览器只访问同源 `/api`，Pages Functions 和 AMS 后端均验证资产中心自己的 Access AUD；前端完成统计、可视化、搜索、排序、分页和 CSV 导出。

- 生产地址：<https://assetcenter.foxtang.com>
- GitHub 仓库：<https://github.com/th2006464/assetcenter.foxtang.com>
- 生产分支：`main`（推送后由 Cloudflare Pages 自动部署）

## 三个页面

| 页面 | 入口 | 用途 |
| --- | --- | --- |
| `index.html` | 生产域名根路径 | 设备明细表：排序、搜索、分页、CSV 导出、列显隐复选框、资产 CSV 导入、来源筛选与看板下钻 |
| `dashboard.html` | `/dashboard.html` | 数据看板：KPI + 资产纳管统计 + 10 张分布图 + C 盘空间预警，可下钻到明细表 |
| `compare.html` | `/compare.html` | 脚本覆盖对比：上传向日葵设备表，定位「在线但没装 auto 脚本」的设备 |

三个页面通过顶部胶囊按钮互相跳转。**看板上所有 KPI 卡片和图表条目都可点击**，会带着筛选条件跳转到明细表。

### 列显隐复选框

明细表工具栏下方的**「高级筛选」**默认收起，展开后显示「隐藏列」胶囊——为表格里每一个 `<th data-key>` 生成一个复选框，**勾选即隐藏该列**，选择写入 `localStorage:asset-center-hidden-cols-v1`，下次打开仍生效。隐藏列后表格的 `min-width` 按可见列的最小宽度重新计算，横向滚动条随之变短，避免「列多就一定很宽」。

- 右侧「全部显示」一键清空勾选，恢复全列展示。
- 资产列的显隐由服务端数据决定：接口没返回资产字段时这些列自动收起，返回后自动展开（见下节）。用户的手动勾选始终优先，不会被自动逻辑覆盖。
- 实现：`js/app.js` 的 `buildColToggles()` + `applyColVisibility()` + `syncDataDrivenCols()`，列宽表 `COL_MIN_WIDTH` 集中在文件顶部。

明细表「全部显示」旁新增**仅看上传 / 仅看向日葵**来源筛选。上传视图包含所有 Agent 上报设备，向日葵视图包含所有资产记录；已匹配合并的设备在两种视图中均可见。重复点击已选按钮恢复全部，搜索与看板下钻筛选继续叠加，切换时分页回到第 1 页。

### 资产 CSV 导入（向日葵表 → D1）

工具栏右上「导入向日葵表」按钮——上传**向日葵标准导出 CSV**（前几行可有「须知」说明、字段后带 `\t` 都支持；老版 GBK 编码自动回退），解析后**直接写入服务端**，不再缓存在浏览器本地。

```
选择 CSV → parseSunlogin()（表头自动定位，含「备注」列）
        → toImportRecords()（备注末段 = serial_number，TRIM + UPPERCASE，空 SN 跳过）
        → 确认条数弹窗 → Import Key 弹窗
        → POST https://ams.foxtang.com/import-assets  →  D1 asset_inventory
        → 自动 reload GET /devices，列表立刻反映 Agent ∪ Asset 并集
```

- **「备注」是 `serial_number` 的主要来源**：向日葵标准导出没有专门的硬件序列号列，序列号常被填在「备注」里；如「3101466-5CD5203BVK」，导入时取最后一个连字符后的「5CD5203BVK」为匹配键，完整备注仍保留。
- **空 SN 不上传**：`asset_inventory.serial_number` 是主键，空值记录直接跳过，并在确认弹窗里显示「缺少 SN：N」。
- **Import Key 只在内存里**：弹窗输入后存于局部变量，请求结束即释放；**不写** `localStorage` / `sessionStorage` / Cookie / 源码。
- 重复导入同一份 CSV 是安全的：主键冲突时 Worker 执行 UPSERT（更新而非新增重复行）。
- 失败提示展示 Worker 返回的具体错误（`HTTP 401 导入密码错误` / `HTTP 500 数据库写入失败`），不会只显示「上传失败」。
- 上传期间导入按钮 disabled，避免重复提交。

> **Import Key 的前置条件**：Worker 的 CORS 预检必须放行 `X-Import-Key`。当前线上 `Access-Control-Allow-Headers` 只有 `Content-Type, X-Api-Key`，浏览器会拦截该请求；Worker 需要改用独立的 `X-Import-Key / IMPORT_KEY`（**不能复用 Agent 的 API Key**）并把该头加入 `Access-Control-Allow-Headers`。

### 资产 / Agent 统一展示与纳管状态

`GET /devices` 升级后返回 `devices` 与 `asset_inventory` 按 `serial_number` 匹配后的**并集**。前端会兼容旧导入数据：当硬件 SN 对应唯一一条 Agent 行和唯一一条带资产编号前缀的资产行时合并展示；长期应在 Worker / D1 中规范化旧主键。前端据此区分三种纳管状态：

| management_status | 中文 | 含义 |
| --- | --- | --- |
| `managed` | 正常纳管 | 资产表有登记，Agent 也上报了 |
| `agent_missing` | Agent未上报 | 资产表有登记，但 Agent 未上报（未部署 / 计划任务异常 / 长期离线） |
| `asset_missing` | 未登记资产 | Agent 上报了，但资产表里没有 |

- **「管理状态」「向日葵状态」「识别码」三列已下线**（明细表 18 → 15 列），「高级筛选」里的纳管状态多选同步移除；向日葵侧只保留「最后在线 / 向日葵分组 / 备注」三列，可继续按列排序。
- 看板新增一排统计卡：资产总数 / Agent 已上报 / 正常纳管 / Agent 未上报 / 未登记资产，点击仍可下钻到明细表（走 `?filter=manage:xxx`，由筛选标签承接）。
- 搜索框会同时搜 `备注 / 分组 / 最后在线 / MAC / 内网 IP / 登录 IP`（识别码已移出搜索范围）。
- 导出 CSV 只在接口带资产字段时才追加这几列，**不改变原有导出格式**；已下线的三列不再导出。
- **字段降级**：接口没有 `sun_group / sun_note / sun_last` 数据时这三列自动隐藏，页面表现与升级前一致；后端一上线即自动生效，前端无需再改。

> **复用的 CSV 解析器**：把对比页的 `decodeBuffer` / `readFileText` / `parseCsv` / `colOf` / `cell` 上移到了 `js/common.js`，明细表和对比页共用同一套；改这些函数时注意两边都会受影响。

右上角状态位在数据加载成功后显示**数据上传时间**（全量设备中最近一次 `report_time`，按北京时间 `YYYY-MM-DD HH:mm`，悬停可见秒级完整时间）；读取失败显示“读取失败”，无可用上报时间显示“数据上传时间未知”。

### 看板内容

- **KPI**：设备总数、24 小时内上报、最近24小时VPN接入、Windows 11、Windows 10、7 天未上报 —— 六张卡片全部可点击下钻。
- **分布图**：操作系统版本、设备活跃度（按最后上报时间分 3h / 3-24h / 1-3 天 / 4-7 天 / 8-30 天 / 30 天以上）、VPN 接入状态（24h 内有连接 / 有账号但超 24h / 未接入）、厂商、设备形态（按型号关键词识别笔记本 / 台式机）、Outlook 账号绑定、采集脚本版本、C 盘剩余空间分布（< 2 GB / 2-20 GB / 20-50 GB / 50-100 GB / ≥ 100 GB / 无数据）、机型 Top 10。
- **C 盘空间预警**：可按 2 / 5 / 20 / 50 GB 阈值快速筛选剩余空间不足的设备，剩余最少优先排列；中间列显示 Outlook 邮箱，`📋 复制邮箱 (N)` 按钮以**分号**分隔复制全部邮箱（可直接粘到 Outlook 收件人栏），点击设备行跳转到明细表。

图表是手写 SVG 环形图与 CSS 条形图，不依赖任何第三方图表库，颜色沿用 `css/dashboard.css` 中的主题变量，明暗主题自动适配。

### 下钻筛选机制

看板跳转到明细表有两种参数：

| 参数 | 用途 | 示例 |
| --- | --- | --- |
| `q=` | 普通关键字搜索，自动填入搜索框 | `index.html?q=Windows 11` |
| `filter=` | 结构化筛选（计算类概念，关键字搜不到） | `index.html?filter=outlook:unbound` |

`filter=` 支持以下 `key:value`（定义集中在 `js/common.js` 的 `FILTER_SPECS`，看板与明细表共用同一份口径）：

| key | 可选 value | 含义 |
| --- | --- | --- |
| `activity` | `3h` `3h-24h` `1-3d` `4-7d` `8-30d` `ge30d` `unknown` `24h` `ge7d` | 按最后上报时间分档 |
| `vpn` | `recent` `idle` `none` | 24h 内有连接 / 有账号但超 24h / 未接入 |
| `form` | `笔记本` `台式机` `其他` | 按型号关键词识别的设备形态 |
| `outlook` | `bound` `unbound` | 是否登记 Outlook 邮箱 |
| `disk` | `lt2` `2-20` `20-50` `50-100` `ge100` `unknown` | C 盘剩余空间分档 |

命中筛选时明细表工具栏会出现蓝色胶囊标签（如「筛选：未绑定 Outlook 邮箱」），点 `×` 即可清除，URL 参数同步移除。结构化筛选与关键字搜索是 **AND** 关系，可叠加使用。

> 「活跃」窗口统一为 **3 小时**，定义在 `js/common.js` 的 `ACTIVE_WINDOW_HOURS`。活跃度首档、以及 `filter=activity:3h` 全部读这一个常量，改一处即可全局生效。
>
> 注意看板 KPI 用的是**汇总档**（跨细分档位），不是 3 小时窗口：
> - 「24 小时内上报」→ `filter=activity:24h`（`a < 1` 天，等于 `3h` ∪ `3h-24h`）
> - 「7 天未上报」→ `filter=activity:ge7d`（`a >= 7` 天，等于 `8-30d` ∪ `ge30d`）
>
> **筛选值里禁止出现 `+`**：`URLSearchParams` 会把 URL 里的 `+` 解码成空格，
> `?filter=activity:30d+` 实际拿到 `"30d "` 匹配不上，筛选会**静默失效**（显示全量却不报错）。
> 所以「大于等于」统一用 `ge` 前缀（`ge7d` / `ge30d`，与 disk 的 `ge100` 一致）。
>
> 明细表统计卡另有 **24 小时**窗口，定义在 `RECENT_WINDOW_HOURS`，由 `reportedWithinDay()` 计算。

### 自动化上报口径

明细表「自动化上报」统计卡不看上报时间，直接判断**脚本版本**：
`script_version` 包含 `auto`（大小写不敏感）即计入，判定函数在 `js/common.js` 的 `isAutoReport()`，匹配标记是常量 `AUTO_REPORT_TAG`。

线上实际版本形如 `1.3.2-auto`。注意 `1.3.2-cleaner`、`1.3.2-test`、`1.2.0` 这类**不含** auto 的版本不计入 —— 这个口径反映的是「客户端是否已升级到自动上报版本」，与时间窗口无关。

### 脚本覆盖对比页（compare.html）

用途：拿向日葵导出的设备表，找出**在线但还没装 auto 脚本**的那批机器 —— 这批当下就能推送。

- **只上传一个文件**：向日葵标准设备表。资产上报数据由页面自己从 `API_URL` 读取，进页面就自动拉；接口读不到时才放开手动上传 CSV 兜底。
- **匹配口径**：默认**纯按计算机名**（不区分大小写）。只有当标准表**有专门的硬件序列号列**（「硬件序列号」/「序列号」/「SN」/「SerialNumber」）时，计算机名对不上才会再用 `serial_number` 兜底一次。仍对不上判为**从未上报**，同样要处理。
  - **标准版向日葵导出没有序列号列**，所以实际就是纯按计算机名比。
    「备注」列**不参与序列号匹配** —— 它是自由文本，可能是序列号、资产编号，也可能就是一个 `-`，拿它当序列号会有误匹配。
  - 页面底注会写明当前是按什么匹配的：「按计算机名 X 台 · 未匹配 Y 台（导出无序列号列，纯按计算机名对比）」。
- **口径**：`script_version` 含 `auto` 才算达标（`1.3.2-auto` ✓，`1.3.2-test` / `1.1.0` / `1.3.2-cleaner` ✗）。
- **在线判定**来自向日葵的「状态」列：含「在线」且不含「离线」。
- **处理建议** = 在线未装 → 可立即推送；离线未装 → 待上线推送；已装 → 无需处理。默认停在「可立即推送」页签，KPI 卡也做了高亮。
- 若向日葵导出自带「自动化脚本已配置」列，**以它为准**（向日葵是权威源），并顺带和接口数据交叉核对，不一致的台数会显示在底注。
- **推送后复检**：工具栏的「刷新并重新筛选」会重新读一次接口并重跑比对，顶部提示这次**新装上了哪几台**、**还剩多少台**（其中在线几台可继续推），页面自动切到还剩的那批；已转达标的机器挂「本次已修复」角标。
  - 实现：`compare()` 结束后 `snapshotFail()` 记下本轮「未装」名单，下次刷新时用它算差值（`state.prevFail` / `state.delta`）。重置会清空快照。
- 同一计算机名在资产数据里有多条记录时（实测存在不同序列号共用计算机名），按**最近一次 `report_time`** 取值，并在表格里挂「重名 N」角标。

> **两套字段名别混用**：接口 JSON 是 **snake_case**（`computer_name` / `script_version` / `serial_number`），
> 而页面导出的 CSV 表头是 **CamelCase**（`ComputerName` / `ScriptVersion`）。
> `parseApi()` 和 `parseAc()` 是两套解析，改的时候认准各自来源。
>
> **向日葵标准导出的表头不在第一行**：前面有 3 行「须知」+ 1 个空行，表头在第 5 行（20 列）。
> `detectKind()` 会扫描前 12 行找表头，不要在解析时假定表头在 `rows[0]`。
> 另外每个单元格末尾带一个 `\t`，读取时统一 `trim()`。

## 数据接口

接口地址在 `js/common.js` 的 `API_URL` 中：

```js
const API_URL = "/api/devices";
```

接口需返回 JSON 数组，字段为：`computer_name`、`serial_number`、`windows_user`、`outlook_account`、`manufacturer`、`model`、`os_name`、`forticlient_user`、`forticlient_last_seen`、`report_time`、`script_version`，以及 Agent v1.3.0 新增的 `c_drive_total_gb`、`c_drive_free_gb`（C 盘总容量 / 剩余空间，单位 GB）。

这两个磁盘字段对旧 Agent 为 `null`，前端按“无数据”处理：明细表显示 `—`、排序时永远排在最后、CSV 导出为空值。

时间字段（`report_time` / `forticlient_last_seen`）在页面上一律按**北京时间（UTC+8）**展示，例如 `2026-09-21T08:59:53Z` 显示为 `2026-09-21 16:59:53`。换算逻辑在 `js/common.js` 的 `formatBeijingTime()`。CSV 导出保留 API 原始值，不做换算，方便后续程序处理。

接口失败时页面显示“读取失败”并保留上一次状态，不会写入任何密钥或数据库凭据到前端。

## 目录结构

```
index.html          公开 Google 登录页
devices.html        设备明细表
dashboard.html      数据看板
compare.html        脚本覆盖对比（只上传向日葵表，资产数据自动读接口）
css/style.css       主题变量、胶囊 UI、表格样式
css/dashboard.css   看板专用的 KPI 与图表样式
css/compare.css     对比页专用的上传区、状态/判定/建议标签样式
js/common.js        API 地址、主题切换、厂商/系统/形态归一化、FILTER_SPECS 筛选定义（页面共用）
js/app.js           明细表：请求、统计、搜索、排序、分页、导出、下钻筛选落地
js/dashboard.js     看板：聚合计算、图表渲染、下钻跳转
js/compare.js       对比页：CSV 解析、接口自动读取、匹配与判定、导出
```

> 改任何 CSS / JS 之后，**必须把 index.html、dashboard.html、compare.html 里所有
> `<link>` / `<script>` 的 `?v=N` 一起加一版**：生产站点有浏览器缓存，
> 只改 JS 不改版本号（或只改 CSS 不改 JS）会出现「页面是新的、逻辑还是旧的」，
> 表现得像功能没上线甚至报错。

## 本地预览

由于浏览器要请求线上 API，本地预览需要网络（接口已开放 CORS）。

```bash
python3 -m http.server 4173
# 打开 http://127.0.0.1:4173/
```

## 部署

Cloudflare Pages 已连接 GitHub 仓库，推送到 `main` 即自动部署。本项目使用 Pages Functions。构建命令为 `npm run build`，输出目录为 `public`；仅复制公开 HTML/CSS/JS/图片，登记配置、后端源码和环境文件不进入静态产物。

详细的交互约定、统计口径和维护清单见 [README.txt](README.txt)。

## 统一授权与后台兼容

`/api` 由本业务专属 Access 邮箱策略保护；普通未授权用户通过主页按钮进入统一申请。`/session` 仅返回布尔登录状态，全部私有响应禁用缓存。`/api/auth/callback` 验证身份后返回 `/devices.html`。

Pages Functions 使用 `AMS` service binding，并将已校验 JWT 传给 AMS。AMS `/devices` 与 `/assets` 校验同一资产中心 AUD，原始 API 地址无法匿名读取。Pages 的 pages.dev、preview 与 rmm 别名不能读取私有 API。

机器 `POST /report` 的路径、`X-Api-Key`、SQL 和响应保持原样；`POST /import-assets` 的独立 `X-Import-Key` 保持原样。网页导入通过登录后的同源代理发送，密钥只存在于该次操作局部变量。AMS 原有 Cron 为空；部署配置保持为空。

验证：`npm test`、`npm run build`、`npx wrangler pages functions build`。AMS 独立部署：`npm run deploy:ams`（`--keep-vars` 保留现存 IMPORT_KEY，现有 API_KEY secret 自动保留），不得把密钥复制进配置或网页。

2026-10-01：明细、看板、对比及导入请求遇到认证失效会顶层回到固定 `/?login=1` 手动登录页，后者仅转向该业务已登记申请入口。Access 重定向通过 manual 模式识别；401、403、HTML 与网络失败须经 `/session` 确认未登录再跳转，导入密码错误、网络中断及服务故障保留原错误。启动 session 检查不可用时继续加载受服务端保护的 API 并显示其错误。本地模拟验证不代表真实 Google/Access 完整验收。

## 登录页恢复与私有深链（2026-10-01）

匿名访问 `/devices`、`/dashboard`、`/compare` 及对应 `.html` 时，Pages Functions 在返回静态页面之前校验该业务专属 Access JWT；未认证返回 `302 /?login=1`，不会先展示业务页再靠前端跳转。已认证页面响应也禁用缓存，非标准域名的私有页面返回 404。`scripts/build.mjs` 的 `_routes.json` 必须覆盖这些页面，不能仅保护 API。

已打开页面遇到 Access 重定向或经 `/session` 确认身份失效后，回到同一手动登录页。`login=1` 禁用首页自动进入设备页，避免残留 JWT 与 Access 拒绝相互循环；只有点击“使用 Google 继续”才触发登记的统一申请入口。`/auth/login` 保留手动动作兼容路由。身份探测最多等待 4 秒；网络中断、探测失败及业务错误不会自动当作匿名，导入密码错误保留原提示。

本地验证：`npm test`（含私有深链服务器拦截及认证恢复）、`npm run build`、`npx wrangler pages functions build`、`git diff --check`。部署使用 `npm run deploy`，不需要数据库迁移或 Access 策略变更。真实 Google 登录、已授权与拒绝账号的完整 Access 验收仍需真实账号；本地故障模拟与匿名 HTTP 检查不等同此验收。

同一页面内同时发生多个认证失败时，首页恢复只执行一次；每个失败请求仍结束为错误，避免重复顶层导航。回归同时释放多个失效请求并验证仅一次恢复，另检查尾斜杠深链及生成的 Pages 路由覆盖；未知 `/devices/foo` 由服务端明确返回 404，不映射设备页。

## 2026-10-07 登录徽章压缩

登录页与 favicon 使用原尺寸 440 × 440 的 cybersecurity-440-q90.webp（WebP quality 90 / method 6），保留原 PNG 资源。登录样式、手动登录与认证恢复行为保持不变。本地测试 20 项通过，并验证构建资源、服务器路由及桌面/390px 明暗主题；真实 Google/Access 账号验收单独进行。

## 设备去重与向日葵关联：已验证稳定基线（2026-10-10，请勿随意改动）

**这是生产环境已通过用户实际验证的行为。后续修改 `js/common.js`、`js/app.js`、Worker `GET /devices`、CSV 导入或设备列表时，必须保持以下规则，并回归验证。**

### 数据来源与匹配键

- Agent 自动上报保存在 D1 `devices`，主键 `serial_number`，有有效 `report_time`；向日葵 CSV 保存在 `asset_inventory`，同样以 `serial_number` 为主键，包含 `device_name`、`asset_note`、`asset_group` 等。
- 向日葵「备注」可能为 `资产编号-硬件SN`，例如 `3101466-5CD5203BVK`；Agent SN 为 `5CD5203BVK`。前端 `snTail()` 对字符串去空格、转大写、取**最后一个连字符之后**的片段作为匹配键。
- 不能直接用完整的两侧 `serial_number` 做唯一匹配，也不能只用 `computer_name` 自动合并：计算机名可能重复或被复用，历史备注也可能不准确。
- 旧导入资产的 D1 主键可能仍是完整备注 `3101466-5CD5203BVK`，所以 Worker 按原始 SN 做并集后，**前端仍需二次合并**；不要因为 Worker 已有 JOIN 就移除 `reconcileDevices()`。

### 前端合并的精确规则（`js/common.js:reconcileDevices()`）

1. 对 API 返回的全部行按 `snTail(d.serial_number)` 分组；空 SN 不参与。
2. **仅当一个标准化 SN 分组恰好两条记录**，其中一条有非空且非 `"0"` 的 `report_time`，另一条无上报时间，才考虑合并。
3. 无上报时间的记录必须有资产证据：`has_asset` 为真，或 `asset_note` / `device_name` / `asset_device_name` 非空。否则保持两条，避免误合并。
4. 合并时以有上报时间的 Agent 行为主，补充资产侧缺失字段；保留 Agent 原始硬件 SN，并将 `has_agent=1`、`has_asset=1`、`management_status="managed"`。结果只展示一行。
5. 若 SN 不一致、候选超过两条、无法明确区分来源或资产证据不足，**宁可保留独立行，也不能凭计算机名强制合并**。
6. 这是**只影响浏览器显示的合并**，不删除、不覆盖 D1 中的原始记录；数据库行数与页面显示设备数可能不同。

**实际验收案例：** 搜索 `15005035`，Agent 行 `SH15005035 / 5CD5203BVK` 与向日葵行 `SH15005035 / 3101466-5CD5203BVK` 应合并成**一行**；保留 Agent 的当前用户、Outlook 邮箱、上报时间，同时显示向日葵设备名称 `SH15005035-唐昊`、分组、备注。此前发生过两行重复展示，原因是按 `has_agent/has_asset` 及资产字段判断“纯来源”过于严格：Agent 行也可能带资产字段。**不要恢复这种来源互斥判断。**

### 表格改动与回归检查

- 「向日葵设备名称」列位于「计算机名」右侧；`js/app.js:normalizeAssetFields()` 优先使用 `asset_device_name`，否则使用 `device_name`。空值显示 `—`；应保留搜索、排序、列显隐。
- `devices.html` 中的 `<th data-key>` 顺序必须与 `js/app.js:render()` 的 `<td>` 顺序**一一对应**。增删列时同步更新 `COL_MIN_WIDTH`、CSV 导出/搜索（如适用）及初始空状态的 `colspan`，否则会出现 VPN 版本列显示日期、厂商列错位等故障。
- `report_time` 为空、0 或解析为 1970 年时显示 `—`，不能显示 `1970-01-01 08:00:00` / 两万多天前；无 Agent 的资产记录本身不是异常数据。
- 修改 `js/common.js` 后必须更新 `devices.html` 对应的 `?v=N`，修改 `js/app.js` 也必须更新对应版本；否则浏览器缓存可能继续运行旧代码。
- **回归至少覆盖：** (a) 上述 `SH15005035` 搜索结果恰好一行；(b) 不同 SN 的同名计算机仍分别显示；(c) 只有资产、没有 Agent 的记录显示 `—` 上报时间；(d) 表头与数据不串列；(e) 来源筛选、搜索、排序、隐藏列仍正常。
- 修改前先阅读本节并核对线上实际 `GET /api/devices` 字段；如 API 字段或标记有变化，先定位数据来源再调整合并算法，不要仅凭重复截图反复猜测。

### 数据维护安全边界

- `devices` 和 `asset_inventory` 当前都以 `serial_number` 为主键；`asset_inventory` 的 SQLite `rowid` 可临时用于精确查询/删除，但不是长期稳定的业务 ID。
- **不要**使用 `WHERE computer_name = ...` 或“未匹配 Agent”作为整表批量删除条件；先 `SELECT` 检查 SN 和来源，必要时以 SN/rowid 精确操作。
- CSV 导入按备注尾段生成 SN，Worker 采用 UPSERT；**更新备注导致匹配键改变时，旧 SN 记录不会自动因为新 CSV 缺席而消失**，应先核查再单独清理。前端显示去重不等于数据库物理去重。
