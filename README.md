# 自动化终端管理平台

部署在 Cloudflare Pages 上的纯静态 IT 资产看板。数据在浏览器端直接从设备 API 读取，由前端完成统计、可视化、搜索、排序、分页和 CSV 导出，没有构建步骤和后端依赖。

- 生产地址：<https://assetcenter.foxtang.com>
- GitHub 仓库：<https://github.com/th2006464/assetcenter.foxtang.com>
- 生产分支：`main`（推送后由 Cloudflare Pages 自动部署）

## 三个页面

| 页面 | 入口 | 用途 |
| --- | --- | --- |
| `index.html` | 生产域名根路径 | 设备明细表：排序、搜索、分页、CSV 导出、列显隐复选框、资产 CSV 导入、纳管状态展示与筛选 |
| `dashboard.html` | `/dashboard.html` | 数据看板：KPI + 资产纳管统计 + 10 张分布图 + C 盘空间预警，可下钻到明细表 |
| `compare.html` | `/compare.html` | 脚本覆盖对比：上传向日葵设备表，定位「在线但没装 auto 脚本」的设备 |

三个页面通过顶部胶囊按钮互相跳转。**看板上所有 KPI 卡片和图表条目都可点击**，会带着筛选条件跳转到明细表。

### 列显隐复选框

明细表工具栏下方新增一行**「隐藏列」**胶囊——为表格里每一个 `<th data-key>` 生成一个复选框，**勾选即隐藏该列**，选择写入 `localStorage:asset-center-hidden-cols-v1`，下次打开仍生效。隐藏列后表格的 `min-width` 按可见列的最小宽度重新计算，横向滚动条随之变短，避免「列多就一定很宽」。

- 右侧「全部显示」一键清空勾选，恢复全列展示。
- 资产列的显隐由服务端数据决定：接口没返回资产字段时这些列自动收起，返回后自动展开（见下节）。用户的手动勾选始终优先，不会被自动逻辑覆盖。
- 实现：`js/app.js` 的 `buildColToggles()` + `applyColVisibility()` + `syncDataDrivenCols()`，列宽表 `COL_MIN_WIDTH` 集中在文件顶部。

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

- 明细表新增「管理状态」（`.mgmt-pill` 药丸）与「最后在线」两列，可按状态排序／用工具栏「纳管状态」下拉筛选。
- 看板新增一排统计卡：资产总数 / Agent 已上报 / 正常纳管 / Agent 未上报 / 未登记资产，点击可下钻到明细表。
- 搜索框会同时搜 `备注 / 识别码 / 分组 / 最后在线 / MAC / 内网 IP / 登录 IP`。
- 导出 CSV 只在接口带资产字段时才追加这几列，**不改变原有导出格式**。
- **字段降级**：Worker 还没返回 `management_status` / `has_asset` / `has_agent` 时，上述列、筛选下拉与统计卡会整体隐藏，页面表现与升级前完全一致；后端一上线即自动生效，前端无需再改。

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
const API_URL = "https://ams.foxtang.com/devices";
```

接口需返回 JSON 数组，字段为：`computer_name`、`serial_number`、`windows_user`、`outlook_account`、`manufacturer`、`model`、`os_name`、`forticlient_user`、`forticlient_last_seen`、`report_time`、`script_version`，以及 Agent v1.3.0 新增的 `c_drive_total_gb`、`c_drive_free_gb`（C 盘总容量 / 剩余空间，单位 GB）。

这两个磁盘字段对旧 Agent 为 `null`，前端按“无数据”处理：明细表显示 `—`、排序时永远排在最后、CSV 导出为空值。

时间字段（`report_time` / `forticlient_last_seen`）在页面上一律按**北京时间（UTC+8）**展示，例如 `2026-09-21T08:59:53Z` 显示为 `2026-09-21 16:59:53`。换算逻辑在 `js/common.js` 的 `formatBeijingTime()`。CSV 导出保留 API 原始值，不做换算，方便后续程序处理。

接口失败时页面显示“读取失败”并保留上一次状态，不会写入任何密钥或数据库凭据到前端。

## 目录结构

```
index.html          设备明细表
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

Cloudflare Pages 已连接 GitHub 仓库，推送到 `main` 即自动部署。本项目是静态站点，无需 npm、构建命令或输出目录，部署根目录就是仓库根目录。

详细的交互约定、统计口径和维护清单见 [README.txt](README.txt)。
