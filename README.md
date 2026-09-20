# 向日葵设备信息看板

部署在 Cloudflare Pages 上的纯静态 IT 资产看板。数据在浏览器端直接从设备 API 读取，由前端完成统计、可视化、搜索、排序、分页和 CSV 导出，没有构建步骤和后端依赖。

- 生产地址：<https://assetcenter.foxtang.com>
- GitHub 仓库：<https://github.com/th2006464/assetcenter.foxtang.com>
- 生产分支：`main`（推送后由 Cloudflare Pages 自动部署）

## 两个页面

| 页面 | 入口 | 用途 |
| --- | --- | --- |
| `index.html` | 生产域名根路径 | 设备明细表：11 列排序、搜索、分页、CSV 导出 |
| `dashboard.html` | `/dashboard.html` | 数据看板：KPI + 8 张分布图，可下钻到明细表 |

两个页面通过顶部胶囊按钮互相跳转。看板里点击可筛选的图例（厂商、操作系统、机型、客户端版本）会带着关键词跳转到 `index.html?q=...` 并自动填入搜索框。

### 看板内容

- **KPI**：设备总数、24h 内上报、最近24小时VPN接入、Windows 11、Windows 10、30 天未上报。
- **分布图**：操作系统版本、设备活跃度（按最后上报时间分 24h / 1-3 天 / 4-7 天 / 8-30 天 / 30 天以上）、VPN 接入状态（24h 内有连接 / 有账号但超 24h / 未接入）、厂商、设备形态（按型号关键词识别笔记本 / 台式机）、Outlook 账号绑定、采集脚本版本、机型 Top 10。

图表是手写 SVG 环形图与 CSS 条形图，不依赖任何第三方图表库，颜色沿用 `css/dashboard.css` 中的主题变量，明暗主题自动适配。

## 数据接口

接口地址在 `js/common.js` 的 `API_URL` 中：

```js
const API_URL = "https://ams.foxtang.com/devices";
```

接口需返回 JSON 数组，字段为：`computer_name`、`serial_number`、`windows_user`、`outlook_account`、`manufacturer`、`model`、`os_name`、`forticlient_user`、`forticlient_last_seen`、`report_time`、`script_version`。

接口失败时页面显示“读取失败”并保留上一次状态，不会写入任何密钥或数据库凭据到前端。

## 目录结构

```
index.html          设备明细表
dashboard.html      数据看板
css/style.css       主题变量、胶囊 UI、表格样式
css/dashboard.css   看板专用的 KPI 与图表样式
js/common.js        API 地址、主题切换、厂商与系统归一化（两个页面共用）
js/app.js           明细表：请求、统计、搜索、排序、分页、导出
js/dashboard.js     看板：聚合计算与图表渲染
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
