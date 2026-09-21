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
