/* Shared runtime helpers for index.html (device table) and dashboard.html (charts).
   Load this file before app.js / dashboard.js. */

const API_URL = "https://ams.foxtang.com/devices";
/* 资产 CSV 导入接口（独立于 Agent 上报的 /report，鉴权用 X-Import-Key） */
const IMPORT_API_URL = "https://ams.foxtang.com/import-assets";
const THEME_KEY = "asset-center-theme";
/* 旧版本把向日葵表缓存在浏览器本地，改由 D1 asset_inventory 统一存储后不再需要 */
const LEGACY_SUN_STORE_KEY = "asset-center-sunlogin-v1";

const $ = id => document.getElementById(id);
const safe = v => (v ?? "").toString();

function escapeHtml(v){return safe(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function parseDate(v){const d=new Date(v);return Number.isNaN(d.getTime())?null:d}

/* ---------- 时间展示统一按北京时间（UTC+8） ----------
   API 返回 ISO 串（report_time 用 Z 结尾的 UTC，forticlient_last_seen 带 +08:00），
   parseDate 都能正确解析成瞬时点，这里再统一换算到北京时间展示，
   避免出现 2026-09-21T08:59:53Z 这种带 T / Z、需要心算时区的写法。 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function beijingParts(v){
  const d=parseDate(v);
  if(!d)return null;
  const bj=new Date(d.getTime()+BEIJING_OFFSET_MS);
  const p=n=>String(n).padStart(2,"0");
  return {
    date:`${bj.getUTCFullYear()}-${p(bj.getUTCMonth()+1)}-${p(bj.getUTCDate())}`,
    time:`${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}`,
    seconds:p(bj.getUTCSeconds())
  };
}

/* withSeconds=true → 2026-09-21 16:59:53 ；false → 2026-09-21 16:59 */
function formatBeijingTime(v,withSeconds=true){
  const p=beijingParts(v);
  if(!p)return "—";
  return withSeconds?`${p.date} ${p.time}:${p.seconds}`:`${p.date} ${p.time}`;
}

/* ---------- 上报时间窗口 ----------
   ACTIVE_WINDOW_HOURS =“活跃”窗口（3 小时内上报即视为在线）：明细表统计卡、
   看板 KPI、活跃度分档、结构化筛选全部共用这一个窗口，改一处即全局生效。
   RECENT_WINDOW_HOURS = 明细表「24h 内上报」统计卡用的窗口，与活跃窗口分开定义，
   两个口径互不干扰。AGE_DAYS 版供 ageDays() 的结果比较。 */
const ACTIVE_WINDOW_HOURS = 3;
const ACTIVE_WINDOW_MS = ACTIVE_WINDOW_HOURS * 60 * 60 * 1000;
const ACTIVE_WINDOW_DAYS = ACTIVE_WINDOW_HOURS / 24;   /* 3h = 0.125 天 */

const RECENT_WINDOW_HOURS = 24;

/* 最后上报时间距今是否在 hours 小时内（report_time 必须可解析） */
function reportedWithin(v,hours){
  const d=parseDate(v);
  if(!d)return false;
  const window=Number(hours)>0?Number(hours)*60*60*1000:ACTIVE_WINDOW_MS;
  return (Date.now()-d.getTime()) < window;
}

/* 落在活跃窗口内（默认 3 小时） */
function reportedWithinWindow(v){
  return reportedWithin(v,ACTIVE_WINDOW_HOURS);
}

/* 落在 24 小时窗口内（含 3h 内的设备，是 3h 口径的超集） */
function reportedWithinDay(v){
  return reportedWithin(v,RECENT_WINDOW_HOURS);
}

/* ---------- 右上角状态位 ----------
   加载成功后不再显示“数据正常”，改为展示「数据上传时间」＝全量设备里
   report_time 最大的那一条，也就是最近一次客户端上报的时间（北京时间）。
   devices 为空或全部没有可解析的 report_time 时，显示“数据上传时间未知”。 */
function latestReportTime(devices){
  let latest=null,latestMs=-Infinity;
  (devices||[]).forEach(d=>{
    const dt=parseDate(d&&d.report_time);
    if(!dt)return;
    const ms=dt.getTime();
    if(ms>latestMs){latestMs=ms;latest=d.report_time}
  });
  return latest;
}

/* text / dot 统一走这里，顺带管理 title，避免上一次的提示残留 */
function setStatus(text,dotClass,title){
  const dot=$("statusDot"),label=$("statusText");
  if(label){
    label.textContent=text;
    if(title)label.title=title;else label.removeAttribute("title");
  }
  if(dot)dot.className="status-dot"+(dotClass?" "+dotClass:"");
}

function setStatusUploadTime(devices){
  const latest=latestReportTime(devices);
  const p=latest?beijingParts(latest):null;
  if(!p){setStatus("数据上传时间未知","","暂无可解析的上报时间");return}
  setStatus(`数据上传时间：${p.date} ${p.time}`,"ok",
    `最近一次设备上报：${formatBeijingTime(latest)}（北京时间）`);
}

/* ---------- C 盘容量（Agent v1.3.0 新增） ----------
   Worker 返回 c_drive_total_gb / c_drive_free_gb（单位 GB，可能为 null）。
   旧 Agent 没有这两个字段 → 一律返回 null，界面显示“—”，排序时排在最后。 */
const LOW_DISK_GB = 20;

function toGbNumber(v){
  if(v===null||v===undefined||v==="")return null;
  const n=typeof v==="number"?v:Number(v);
  return Number.isFinite(n)?n:null;
}

/* 显示用：整数不带小数，小数保留 1 位（126.4 / 475.7） */
function formatGb(v){
  const n=toGbNumber(v);
  if(n===null)return "—";
  return Number.isInteger(n)?String(n):n.toFixed(1);
}

/* 合并显示：剩余空间 / 总容量 */
function formatDrive(free,total){
  const f=toGbNumber(free),t=toGbNumber(total);
  if(f===null&&t===null)return null;              // 无数据 → 调用方显示 —
  return `${formatGb(f)} / ${formatGb(t)} GB`;
}

/* Shared classification: the table page and the dashboard must report
   the same vendor / OS numbers. */
function normalizeVendor(v){
  const s=safe(v).trim();
  if(!s)return "未知";
  const l=s.toLowerCase();
  if(l.includes("hewlett")||l.includes("hp"))return "HP";
  if(l.includes("lenovo"))return "Lenovo";
  if(l.includes("dell"))return "Dell";
  if(l.includes("microsoft"))return "Microsoft";
  return s;
}

function osGroup(v){
  const s=safe(v);
  if(/windows\s*11/i.test(s))return "Windows 11";
  if(/windows\s*10/i.test(s))return "Windows 10";
  if(/windows/i.test(s))return "其他 Windows";
  return s.trim()||"未知";
}

function ageDays(v){
  const d=parseDate(v);
  return d?(Date.now()-d.getTime())/86400000:null;
}

/* ---------- 自动化上报识别 ----------
   Agent 支持自动上报后版本号会带 auto 标记（实测线上形如 1.3.2-auto）。
   只要 script_version 包含 auto（大小写不敏感）就算自动化上报；
   注意 1.3.2-cleaner / 1.3.2-test 这类不含 auto，不算。 */
const AUTO_REPORT_TAG = "auto";

function isAutoReport(v){
  return safe(v).toLowerCase().includes(AUTO_REPORT_TAG);
}

/* 设备形态：笔记本 / 台式机 / 其他。看板与明细表共用，保证口径一致。 */
function formFactor(v){
  const m=safe(v).toLowerCase();
  if(/book|thinkpad|latitude/.test(m))return "笔记本";
  if(/tower|desktop|microtower|\bsff\b|\bmt\b|optiplex|thinkcentre/.test(m))return "台式机";
  return "其他";
}

/* ---------- 资产纳管状态（devices ∪ asset_inventory） ----------
   Worker 完成 /devices 的 FULL OUTER JOIN 后会直接返回 management_status：
     managed       asset + agent 都有 → 正常纳管
     agent_missing 只有 asset          → Agent 未上报
     asset_missing 只有 agent          → 未登记资产
   Worker 还没部署时接口没有这些字段，managementStatusOf() 返回空串，
   前端据此自动隐藏相关列和统计卡，等后端上线即可自动生效，无需再改前端。 */
const MANAGEMENT_STATUS={
  managed:{label:"正常纳管",cls:"ms-managed",hint:"资产表与 Agent 均已登记"},
  agent_missing:{label:"Agent未上报",cls:"ms-agent-missing",hint:"资产表有登记，但 Agent 未上报"},
  asset_missing:{label:"未登记资产",cls:"ms-asset-missing",hint:"Agent 已上报，但资产表中没有"}
};

function normalizeSn(v){return safe(v).trim().toUpperCase()}

/* D1 / SQLite 没有真正的 boolean，LEFT JOIN 出来的 has_asset / has_agent
   实际可能是 1 / 0 / "1" / "true"，只认 === true 会静默全部判成 false，
   这里统一放宽成真值判断。 */
function asBool(v){return v===true||v===1||v==="1"||v==="true"}

/* 优先用 Worker 算好的字段；缺失时按 has_agent / has_asset 现场推导；两者都没有返回 "" */
function managementStatusOf(d){
  if(!d)return "";
  const raw=safe(d.management_status).trim();
  if(MANAGEMENT_STATUS[raw])return raw;
  const hasAgent=asBool(d.has_agent),hasAsset=asBool(d.has_asset);
  if(!hasAgent&&!hasAsset&&d.has_agent===undefined&&d.has_asset===undefined)return "";
  if(hasAgent&&hasAsset)return "managed";
  if(hasAsset)return "agent_missing";
  if(hasAgent)return "asset_missing";
  return "";
}

function managementLabel(key){
  return MANAGEMENT_STATUS[key]?MANAGEMENT_STATUS[key].label:"";
}

/* 接口是否已提供统一资产数据（决定管理状态列 / 纳管统计卡是否出现） */
function hasManagementData(list){
  return (list||[]).some(d=>managementStatusOf(d)!=="");
}

/* ---------- 结构化筛选（看板下钻 → 明细表） ----------
   以下筛选项都是「计算出来的概念」（活跃度、VPN 状态、形态、邮箱绑定、磁盘分档、纳管状态），
   无法用普通关键字搜索命中，所以走独立的 filter 参数：index.html?filter=key:value。
   key/value 与看板图表一一对应，两边共用同一份定义，避免口径漂移。 */
const FILTER_SPECS={
  manage:{
    /* asset / agent 是「只要一边有」的宽松口径，给看板两张汇总卡下钻用；
       另外三个是互斥的三态，加起来等于全量。 */
    labels:{managed:"正常纳管",agent_missing:"Agent未上报",asset_missing:"未登记资产",
            asset:"资产表内设备",agent:"Agent 已上报设备"},
    test:(d,v)=>{
      if(v==="asset")return asBool(d.has_asset);
      if(v==="agent")return asBool(d.has_agent);
      return managementStatusOf(d)===v;
    }
  },
  activity:{
    /* 24h / ge7d 是看板 KPI 用的「汇总档」，跨了上面的细分档位：
       24h = 3h ∪ 3h-24h（a < 1 天）；ge7d = 8-30d ∪ ge30d（a >= 7 天）。
       注意：value 里不能用 `+`！URLSearchParams 会把 `+` 解码成空格，
       导致 `?filter=activity:30d+` 拿到 "30d " 匹配不上、筛选静默失效（老 bug）。
       统一用 ge 前缀表示「大于等于」，与 disk 的 ge100 一致。 */
    labels:{"3h":"3 小时内上报","3h-24h":"3-24 小时前上报","1-3d":"1-3 天前上报",
            "4-7d":"4-7 天前上报","8-30d":"8-30 天前上报","ge30d":"30 天以上未上报","unknown":"上报时间未知",
            "24h":"24 小时内上报","ge7d":"7 天以上未上报"},
    test:(d,v)=>{
      const a=ageDays(d.report_time);
      if(v==="unknown")return a===null;
      if(a===null)return false;
      return ({"3h":a<ACTIVE_WINDOW_DAYS,"3h-24h":a>=ACTIVE_WINDOW_DAYS&&a<1,
               "24h":a<1,"ge7d":a>=7,
               "1-3d":a>=1&&a<3,"4-7d":a>=3&&a<7,"8-30d":a>=7&&a<30,"ge30d":a>=30})[v]===true;
    }
  },
  vpn:{
    labels:{recent:"24h 内有 VPN 连接",idle:"有 VPN 账号但超 24h 未连接",none:"未接入 VPN"},
    test:(d,v)=>{
      const hasAcct=safe(d.forticlient_user).trim()!=="";
      const a=ageDays(d.forticlient_last_seen);
      const recent=a!==null&&a<1;
      if(v==="recent")return recent;
      if(v==="idle")return hasAcct&&!recent;
      if(v==="none")return !hasAcct;
      return false;
    }
  },
  form:{
    labels:{"笔记本":"笔记本","台式机":"台式机","其他":"其他形态"},
    test:(d,v)=>formFactor(d.model)===v
  },
  outlook:{
    labels:{bound:"已绑定 Outlook 邮箱",unbound:"未绑定 Outlook 邮箱"},
    test:(d,v)=>{
      const has=safe(d.outlook_account).trim()!=="";
      return v==="bound"?has:!has;
    }
  },
  disk:{
    labels:{lt2:"C 盘剩余 < 2 GB","2-20":"C 盘剩余 2-20 GB","20-50":"C 盘剩余 20-50 GB",
            "50-100":"C 盘剩余 50-100 GB","ge100":"C 盘剩余 ≥ 100 GB",unknown:"C 盘数据缺失（旧 Agent）"},
    test:(d,v)=>{
      const f=toGbNumber(d.c_drive_free_gb);
      if(v==="unknown")return f===null;
      if(f===null)return false;
      return ({lt2:f<2,"2-20":f>=2&&f<20,"20-50":f>=20&&f<50,"50-100":f>=50&&f<100,ge100:f>=100})[v]===true;
    }
  }
};

/* 把 "activity:3h" 解析成 {key,value}；非法值返回 null。 */
function parseFilterParam(raw){
  if(!raw)return null;
  const i=raw.indexOf(":");
  if(i<=0)return null;
  const key=raw.slice(0,i),value=raw.slice(i+1);
  if(!FILTER_SPECS[key]||!FILTER_SPECS[key].labels[value])return null;
  return {key,value};
}

function filterLabel(f){
  if(!f)return "";
  const spec=FILTER_SPECS[f.key];
  return spec?(spec.labels[f.value]||f.value):f.value;
}

function matchesFilter(d,f){
  if(!f)return true;
  const spec=FILTER_SPECS[f.key];
  return spec?spec.test(d,f.value):true;
}

function readStoredTheme(){
  try{return localStorage.getItem(THEME_KEY)}catch(e){return null}
}
function writeStoredTheme(theme){
  try{localStorage.setItem(THEME_KEY,theme)}catch(e){/* storage unavailable, theme still applies for this session */}
}

function setTheme(theme){
  document.documentElement.dataset.theme=theme;
  writeStoredTheme(theme);
  const btn=$("themeToggle");
  if(!btn)return;
  const isDark=theme==="dark";
  btn.setAttribute("aria-pressed",String(isDark));
  btn.setAttribute("aria-label",isDark?"切换浅色主题":"切换深色主题");
  btn.textContent=isDark?"◑":"◐";
}

function initTheme(){
  const saved=readStoredTheme();
  setTheme(saved||((matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light"));
  const btn=$("themeToggle");
  if(btn)btn.addEventListener("click",()=>setTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"));
}

/* ---------- 文件读取与 CSV 解析（首页导入向日葵表、对比页上传共用同一套） ----------
   向日葵导出有两个坑：① 老版本是 GBK 编码；② 表头不一定在第一行（标准导出前面有「须知」说明行）。
   所以解码要 UTF-8 优先 + GBK 兜底，解析后由调用方自己找表头行。 */
function decodeBuffer(buf) {
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes("\uFFFD")) {
    try {
      const gbk = new TextDecoder("gbk").decode(buf);
      if (!gbk.includes("\uFFFD")) return gbk.replace(/^\uFEFF/, "");
    } catch (e) { /* 浏览器不支持 gbk，继续用 utf-8 结果 */ }
  }
  return text;
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(decodeBuffer(fr.result));
    fr.onerror = () => reject(fr.error || new Error("读取文件失败"));
    fr.readAsArrayBuffer(file);
  });
}

/* 支持引号包裹、字段内逗号 / 换行、CRLF */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQ = false;
      } else cell += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* 按候选列名找列下标（精确匹配，全找不到返回 -1） */
function colOf(header, names) {
  for (const n of names) {
    const i = header.findIndex(h => safe(h).trim() === n);
    if (i >= 0) return i;
  }
  return -1;
}
function cell(row, i) { return i >= 0 ? safe(row[i]).trim() : ""; }

/* 序列号归一化：向日葵「备注」常写成「资产编号-序列号」（如 3101154-5CD9453NSW），
   去掉最后一个 `-` 之前的前缀才能和接口的 serial_number 对上。 */
function snTail(v) {
  const s = safe(v).trim().toUpperCase();
  if (!s) return "";
  const i = s.lastIndexOf("-");
  return i >= 0 ? s.slice(i + 1) : s;
}

function currentThemeIsDark(){
  const attr=document.documentElement.dataset.theme;
  if(attr)return attr==="dark";
  return matchMedia("(prefers-color-scheme: dark)").matches;
}
