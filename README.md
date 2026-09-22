# 自动化终端管理平台

部署在 Cloudflare Pages 上的纯静态 IT 资产看板。数据在浏览器端直接从设备 API 读取，由前端完成统计、可视化、搜索、排序、分页和 CSV 导出，没有构建步骤和后端依赖。

- 生产地址：<https://assetcenter.foxtang.com>
- GitHub 仓库：<https://github.com/th2006464/assetcenter.foxtang.com>
- 生产分支：`main`（推送后由 Cloudflare Pages 自动部署）

## 两个页面

| 页面 | 入口 | 用途 |
| --- | --- | --- |
| `index.html` | 生产域名根路径 | 设备明细表：12 列排序、搜索、分页、CSV 导出 |
| `dashboard.html` | `/dashboard.html` | 数据看板：KPI + 10 张分布图 + C 盘空间预警，可下钻到明细表 |

两个页面通过顶部胶囊按钮互相跳转。**看板上所有 KPI 卡片和图表条目都可点击**，会带着筛选条件跳转到明细表。

右上角状态位在数据加载成功后显示**数据上传时间**（全量设备中最近一次 `report_time`，按北京时间 `YYYY-MM-DD HH:mm`，悬停可见秒级完整时间）；读取失败显示“读取失败”，无可用上报时间显示“数据上传时间未知”。

### 看板内容

- **KPI**：设备总数、24h 内上报、最近24小时VPN接入、Windows 11、Windows 10、30 天未上报 —— 六张卡片全部可点击下钻。
- **分布图**：操作系统版本、设备活跃度（按最后上报时间分 24h / 1-3 天 / 4-7 天 / 8-30 天 / 30 天以上）、VPN 接入状态（24h 内有连接 / 有账号但超 24h / 未接入）、厂商、设备形态（按型号关键词识别笔记本 / 台式机）、Outlook 账号绑定、采集脚本版本、C 盘剩余空间分布（< 2 GB / 2-20 GB / 20-50 GB / 50-100 GB / ≥ 100 GB / 无数据）、机型 Top 10。
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
| `activity` | `24h` `1-3d` `4-7d` `8-30d` `30d+` `unknown` | 按最后上报时间分档 |
| `vpn` | `recent` `idle` `none` | 24h 内有连接 / 有账号但超 24h / 未接入 |
| `form` | `笔记本` `台式机` `其他` | 按型号关键词识别的设备形态 |
| `outlook` | `bound` `unbound` | 是否登记 Outlook 邮箱 |
| `disk` | `lt2` `2-20` `20-50` `50-100` `ge100` `unknown` | C 盘剩余空间分档 |

命中筛选时明细表工具栏会出现蓝色胶囊标签（如「筛选：未绑定 Outlook 邮箱」），点 `×` 即可清除，URL 参数同步移除。结构化筛选与关键字搜索是 **AND** 关系，可叠加使用。

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
css/style.css       主题变量、胶囊 UI、表格样式
css/dashboard.css   看板专用的 KPI 与图表样式
js/common.js        API 地址、主题切换、厂商/系统/形态归一化、FILTER_SPECS 筛选定义（两个页面共用）
js/app.js           明细表：请求、统计、搜索、排序、分页、导出、下钻筛选落地
js/dashboard.js     看板：聚合计算、图表渲染、下钻跳转
```

## 本地预览

由于浏览器要请求线上 API，本地预览需要网络（接口已开放 CORS）。

```bash
python3 -m http.server 4173
# 打开 http://127.0.0.1:4173/
```

## 部署

Cloudflare Pages 已连接 GitHub 仓库，推送到 `main` 即自动部署。本项目是静态站点，无需 npm、构建命令或输出目录，部署根目录就是仓库根目录。

详细的交互约定、统计口径和维护清单见 [README.txt](README.txt)。
