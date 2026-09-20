# 向日葵设备信息看板

这是一个部署在 Cloudflare Pages 上的纯静态设备资产看板。页面从设备 API 读取数据，在浏览器端完成统计、搜索、排序、分页和 CSV 导出。

## 线上部署与发布

- GitHub 仓库：`https://github.com/th2006464/assetcenter.foxtang.com`
- 生产分支：`main`
- Cloudflare Pages 项目：`asset-center`
- 生产域名：`https://assetcenter.foxtang.com`
- 当前部署方式：Cloudflare Pages 已连接 GitHub。推送到 `main` 后自动部署。
- 本项目是静态站点，不需要 npm、构建命令或构建输出目录；部署根目录就是仓库根目录。

本地预览：

```bash
python3 -m http.server 4173
```

然后打开 `http://127.0.0.1:4173/`。由于浏览器会请求真实 API，本地预览需要网络和 API 的 CORS 允许。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `index.html` | 明细表页面骨架、按钮、统计卡、搜索框、设备表格和分页控件 |
| `dashboard.html` | 数据看板页面骨架、KPI 卡和 8 个图表容器 |
| `css/style.css` | 颜色变量、响应式布局、统一胶囊 UI、表格和明暗主题样式 |
| `css/dashboard.css` | 看板专用：KPI 网格、图表卡片、环形图/条形图、图表配色变量 |
| `js/common.js` | 两个页面共用：`API_URL`、主题切换、厂商与操作系统归一化 |
| `js/app.js` | 明细表：API 请求、统计、搜索、排序、分页、CSV 导出 |
| `js/dashboard.js` | 看板：聚合计算、SVG 环形图与条形图渲染、提示气泡、下钻跳转 |
| `README.md` | GitHub 仓库首页说明（项目介绍、页面入口、目录结构） |
| `README.txt` | 运维与维护说明（本文件） |

两个页面都先加载 `js/common.js`，再加载各自的脚本。`common.js` 里的顶层常量和函数不要在页面脚本里重复声明，否则会触发重复定义错误。

## 数据接口

`js/app.js` 中的 `API_URL` 当前为：

```js
const API_URL = "https://ams.foxtang.com/devices";
```

接口必须返回 JSON 数组。每条设备记录使用以下字段：

`computer_name`、`serial_number`、`windows_user`、`forticlient_user`、`forticlient_last_seen`、`outlook_account`、`manufacturer`、`model`、`os_name`、`report_time`、`script_version`。

如果接口失败，页面会把状态改为“读取失败”，并在表格中显示错误提示；不要在前端写入 API 密钥或数据库凭据。

## 页面按钮与交互

### 顶部操作胶囊

- **刷新数据**：触发 `loadDevices()`，以 `cache: "no-store"` 重新请求 API，更新四项统计、表格和最后刷新时间。
- **导出 CSV**：触发 `exportCsv()`，导出当前搜索条件和排序结果的全部记录，不受当前分页限制。文件名格式为 `asset-center-YYYY-MM-DD.csv`，并带 UTF-8 BOM，方便 Excel 正确识别中文。
- **◐ 主题切换**：触发 `setTheme()`，在 `light` 与 `dark` 间切换；选择保存到 `localStorage` 的 `asset-center-theme`，刷新页面后仍保留。

### 数据状态胶囊

- **每页显示**：修改 `pageSize`（20、50、100、200 或全部），并回到第 1 页重新渲染。
- **数据正常 / 读取失败**：由 `loadDevices()` 根据请求状态更新 `#statusText`、`#statusDot` 和对应颜色。

### 页面跳转

- **看板视图**（`index.html`）：跳转到 `dashboard.html`。
- **设备明细**（`dashboard.html`）：跳转到 `index.html`。
- 明细表支持 `?q=关键词` 深链：进入页面时会把参数填入搜索框再加载数据，用于承接看板的下钻点击。

### 表格交互

- 点击任意表头会按该字段排序；再次点击同一字段会切换升序/降序。
- `sortKey` 保存当前字段，`sortAsc` 保存方向；`updateSortIndicators()` 负责高亮 ▲ 或 ▼。
- 搜索框支持序列号、计算机名、当前用户、VPN 用户、VPN 活动时间、邮箱、厂商、型号、系统和脚本版本；输入后自动回到第 1 页。
- 上一页/下一页按钮只改变 `currentPage`，然后调用 `render()`。
- 选择“全部”时 `pageSize` 为 `0`，隐藏分页按钮并展示所有过滤结果。

## 统计卡计算方式

`updateStats(data)` 在每次成功加载数据后运行：

- **设备总数**：数组长度。
- **HP 设备**：`normalizeVendor(manufacturer) === "HP"`，其中 `Hewlett-Packard` 也归一化为 `HP`。
- **Windows 11**：`osGroup(os_name) === "Windows 11"`，兼容 `os_name` 中版本后缀乱码的情况。
- **24h 内上报**：`report_time` 可解析且不早于当前时间前 24 小时。

`normalizeVendor()` 与 `osGroup()` 定义在 `js/common.js`，明细表和看板必须共用它们，否则两个页面的厂商数和系统数会不一致。

## 数据看板（dashboard.html）

`js/dashboard.js` 复用同一个 `API_URL`，在浏览器端聚合后渲染，不依赖第三方图表库。

### 指标口径

- **24h 内上报**：`report_time` 距今小于 1 天。
- **VPN 已接入**：`forticlient_user` 非空。
- **Windows 11**：同统计卡的 `osGroup()`。
- **客户端待升级**：`script_version` 不是数据集中的最高版本（按 `.` 分段做数值比较，当前为 `1.2.0`）。
- **30 天未上报**：`report_time` 距今大于等于 30 天，或无法解析。
- **设备形态**：按 `model` 关键词判断，命中 `book / thinkpad / latitude` 为笔记本，命中 `tower / desktop / microtower / sff / mt / optiplex / thinkcentre` 为台式机，其余归入“其他”。

### 图表与交互

- 环形图是 SVG `<circle>` 配合 `stroke-dasharray` 绘制，条形图是 CSS 宽度条；两者颜色都取自 `css/dashboard.css` 的 `--chart-1..8` 和 `--ramp-1..5` 变量，切换主题时自动变色。
- 悬停显示气泡（标签、台数、占比），滚动时自动隐藏。
- 带 `data-query` 的图例可点击，跳转到 `index.html?q=...`；不可筛选的分组（如 VPN 未接入、设备形态）不带 `data-query`，不做跳转。
- 接口失败时所有图表容器显示错误占位，KPI 显示为 `—`，状态胶囊变红。

## 统一胶囊 UI 约定

页面所有需要成组展示的控件都使用“外层一颗胶囊、内部细分隔线”的方式，而不是多个独立圆按钮。

### 外层容器

操作组和统计组使用：

```css
display: flex;
align-items: center;
overflow: hidden;
border: 1px solid var(--line);
border-radius: 999px;
background: var(--surface);
```

顶部操作组是 `.top-actions`，每页/状态组是 `.status-wrap`，四项统计组是 `.stats-grid`。

### 内部分段

- `.top-actions .btn + .btn` 和 `.status-segment` 使用 `border-left: 1px solid var(--line)`。
- 胶囊内部按钮取消自己的边框和圆角，保持同一条外轮廓。
- 统计卡 `.stat-card` 不再单独设置背景、阴影和圆角，只由外层 `.stats-grid` 统一控制。
- 颜色必须使用 CSS 变量（`--surface`、`--line`、`--text`、`--muted`、`--accent`），不要在组件中硬编码主题颜色。

### 响应式规则

- 1000px 以下，四项统计变为两列，并使用上边框/左边框保持分段关系。
- 640px 以下，统计变为单列；除第一项外，其余项使用上边框。
- 顶部区域在窄屏下纵向排列，胶囊允许换行但不改变语义顺序。

## 明暗主题

主题变量定义在 `:root`、`html[data-theme="dark"]` 和系统偏好回退规则中。不要直接给 `body` 或组件写一套独立的深色颜色。新增组件时只使用现有变量，并同时检查浅色和深色主题下的边框对比度。

## 维护注意事项

1. 修改字段时，同时检查 `getFilteredSorted()`、`compareValues()`、表头、表格渲染和 `exportCsv()` 的字段映射，以及 `js/dashboard.js` 里的聚合口径。
2. 新增按钮时，必须在 HTML 添加稳定的 `id`，在 `DOMContentLoaded` 中绑定事件，并在本 README 的“页面按钮与交互”中说明行为。
3. 修改胶囊外观时，优先调整外层容器和 CSS 变量，不要给单个按钮增加独立阴影或不同圆角。
4. 新增图表配色时只扩展 `--chart-*` / `--ramp-*` 变量，并同时维护浅色、`html[data-theme="dark"]` 和 `prefers-color-scheme` 三处定义。
5. 推送前至少运行：

```bash
node --check js/common.js
node --check js/app.js
node --check js/dashboard.js
git diff --check
```

5. Cloudflare Pages 的生产部署以 GitHub `main` 分支为准；不要通过手动上传覆盖自动部署链路。
