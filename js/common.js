/* Shared runtime helpers for index.html (device table) and dashboard.html (charts).
   Load this file before app.js / dashboard.js. */

const API_URL = "https://ams.foxtang.com/devices";
const THEME_KEY = "asset-center-theme";

const $ = id => document.getElementById(id);
const safe = v => (v ?? "").toString();

function escapeHtml(v){return safe(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function parseDate(v){const d=new Date(v);return Number.isNaN(d.getTime())?null:d}

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

/* 设备形态：笔记本 / 台式机 / 其他。看板与明细表共用，保证口径一致。 */
function formFactor(v){
  const m=safe(v).toLowerCase();
  if(/book|thinkpad|latitude/.test(m))return "笔记本";
  if(/tower|desktop|microtower|\bsff\b|\bmt\b|optiplex|thinkcentre/.test(m))return "台式机";
  return "其他";
}

/* ---------- 结构化筛选（看板下钻 → 明细表） ----------
   以下筛选项都是「计算出来的概念」（活跃度、VPN 状态、形态、邮箱绑定、磁盘分档），
   无法用普通关键字搜索命中，所以走独立的 filter 参数：index.html?filter=key:value。
   key/value 与看板图表一一对应，两边共用同一份定义，避免口径漂移。 */
const FILTER_SPECS={
  activity:{
    labels:{"24h":"24 小时内上报","1-3d":"1-3 天前上报","4-7d":"4-7 天前上报",
            "8-30d":"8-30 天前上报","30d+":"30 天以上未上报","unknown":"上报时间未知"},
    test:(d,v)=>{
      const a=ageDays(d.report_time);
      if(v==="unknown")return a===null;
      if(a===null)return false;
      return ({"24h":a<1,"1-3d":a>=1&&a<3,"4-7d":a>=3&&a<7,"8-30d":a>=7&&a<30,"30d+":a>=30})[v]===true;
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

/* 把 "activity:24h" 解析成 {key,value}；非法值返回 null。 */
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

function currentThemeIsDark(){
  const attr=document.documentElement.dataset.theme;
  if(attr)return attr==="dark";
  return matchMedia("(prefers-color-scheme: dark)").matches;
}
