let allDevices = [];
let sortKey = "report_time";
let sortAsc = false;
let pageSize = 20;
let currentPage = 1;
let activeFilter = null;   /* {key,value}，来自看板下钻的 ?filter= 参数 */

/* ---------- 列显隐（勾选即隐藏，选择记在本地） ---------- */
const HIDE_COLS_KEY = "asset-center-hidden-cols-v1";
/* 每列最小宽度：隐藏列后表格整体收窄，横向滚动条也随之变短 */
const COL_MIN_WIDTH = {
  computer_name:170,serial_number:150,windows_user:140,forticlient_user:130,
  forticlient_last_seen:150,outlook_account:200,manufacturer:100,model:210,
  os_name:180,c_drive_free_gb:130,report_time:150,script_version:120,
  sun_status:100,sun_group:130,sun_code:110,sun_note:150
};
let hiddenCols = loadHiddenCols();

/* ---------- 向日葵表导入：按「备注」匹配序列号 ----------
   向日葵导出的「备注」里既有纯序列号（5CD6071H3Y），也有「资产编号-序列号」混写
   （3101154-5CD9453NSW），所以匹配分三步：备注原值 → 备注去前缀 → 计算机名兜底。 */
const SUN_STORE_KEY = "asset-center-sunlogin-v1";
const SUN_KEYS = ["sun_status","sun_group","sun_code","sun_note"];
let sunRows = [];        /* 导入的向日葵行 */
let sunIndex = null;     /* {exact, tail, cn} 三个索引 */
let sunMeta = null;      /* {name, importedAt, total, matched} */

function loadHiddenCols(){
  try{
    const raw=localStorage.getItem(HIDE_COLS_KEY);
    if(!raw)return new Set();
    const arr=JSON.parse(raw);
    return new Set(Array.isArray(arr)?arr:[]);
  }catch(e){return new Set()}
}
function saveHiddenCols(){
  try{localStorage.setItem(HIDE_COLS_KEY,JSON.stringify(Array.from(hiddenCols)))}catch(e){}
}

function displayValue(v){return safe(v).trim() || "—"}
function displayVpnUser(v){
  const full=safe(v).trim();
  if(!full)return "—";
  const pos=full.lastIndexOf("\\");
  return pos>=0?full.slice(pos+1):full;
}
/* 统一按北京时间展示（分钟精度）；解析不了时保留原始串，行为与旧版一致 */
function displaySourceTime(v){
  const s=safe(v).trim();
  if(!s)return "—";
  const out=formatBeijingTime(s,false);
  return out==="—"?s:out;
}

/* C盘空间：合并显示“剩余 / 总容量”，剩余 < 20 GB 时红色预警，无数据显示 — */
function displayDrive(free,total){
  const f=toGbNumber(free),t=toGbNumber(total);
  if(f===null&&t===null)return '<span class="muted">—</span>';
  const low=f!==null&&f<LOW_DISK_GB;
  const tip=low?` title="剩余空间不足（低于 ${LOW_DISK_GB} GB）"`:"";
  return `<span class="disk-cell${low?" low":""}"${tip}>`
    +`<span class="disk-free">${escapeHtml(formatGb(f))}</span> / ${escapeHtml(formatGb(t))} GB</span>`;
}

function timeAgo(v){
  const d=parseDate(v); if(!d) return {text:"—",cls:"muted"};
  const diff=Date.now()-d.getTime(), min=Math.floor(diff/60000), hour=Math.floor(diff/3600000), day=Math.floor(diff/86400000);
  if(diff<0)return{text:displaySourceTime(v),cls:"muted"};
  if(min<1)return{text:"刚刚",cls:"time-good"};
  if(min<60)return{text:`${min} 分钟前`,cls:"time-good"};
  if(hour<24)return{text:`${hour} 小时前`,cls:"time-good"};
  if(day<7)return{text:`${day} 天前`,cls:"time-warn"};
  return{text:`${day} 天前`,cls:"time-bad"};
}

function updateStats(data){
  $("statTotal").textContent=data.length;
  $("statHP").textContent=data.filter(d=>normalizeVendor(d.manufacturer)==="HP").length;
  $("statWin11").textContent=data.filter(d=>osGroup(d.os_name)==="Windows 11").length;
  /* 自动化上报：脚本版本含 auto（如 1.3.2-auto），口径见 common.js 的 isAutoReport */
  const elAuto=$("statAuto");
  if(elAuto)elAuto.textContent=data.filter(d=>isAutoReport(d.script_version)).length;
  /* 24 小时窗口用 RECENT_WINDOW_HOURS，是 3h 口径的超集（含 3h 内的设备） */
  const el24=$("statRecent24");
  if(el24)el24.textContent=data.filter(d=>reportedWithinDay(d.report_time)).length;
}

function compareValues(a,b,key){
  let av=a[key],bv=b[key];
  if(key==="report_time"||key==="forticlient_last_seen"){
    av=parseDate(av)?.getTime()??0;
    bv=parseDate(bv)?.getTime()??0;
  }else{
    av=safe(av).toLowerCase();
    bv=safe(bv).toLowerCase();
  }
  return av<bv?-1:av>bv?1:0;
}

/* 看板下钻用的结构化筛选（?filter=key:value），与关键字搜索是 AND 关系 */
function updateFilterChip(){
  const wrap=$("filterChipWrap");
  if(!wrap)return;
  if(!activeFilter){wrap.hidden=true;return}
  wrap.hidden=false;
  const text=$("filterChipText");
  if(text)text.textContent="筛选："+filterLabel(activeFilter);
}

function clearFilter(){
  activeFilter=null;
  try{
    const url=new URL(location.href);
    url.searchParams.delete("filter");
    history.replaceState(null,"",url.toString());
  }catch(e){/* file:// 等场景不支持，忽略即可 */}
  updateFilterChip();
  currentPage=1;
  render();
}

/* ---------- 列显隐：渲染复选框 + 同步表头/表体 ---------- */
function buildColToggles(){
  const wrap=$("colToggles");
  if(!wrap)return;
  const ths=Array.from(document.querySelectorAll("#deviceTable thead th[data-key]"));
  wrap.innerHTML=ths.map(th=>{
    const key=th.dataset.key;
    const labelEl=th.querySelector(".sort-btn span");
    const label=labelEl?labelEl.textContent:key;
    const on=hiddenCols.has(key);
    return `<label class="col-toggle${on?" is-hidden":""}" title="勾选后隐藏「${escapeHtml(label)}」列">`
      +`<input type="checkbox" data-col="${escapeHtml(key)}"${on?" checked":""}><span>${escapeHtml(label)}</span></label>`;
  }).join("");
  wrap.querySelectorAll("input[data-col]").forEach(inp=>{
    inp.addEventListener("change",()=>{
      if(inp.checked)hiddenCols.add(inp.dataset.col);
      else hiddenCols.delete(inp.dataset.col);
      saveHiddenCols();
      const box=inp.closest(".col-toggle");
      if(box)box.classList.toggle("is-hidden",inp.checked);
      applyColVisibility();
    });
  });
}

/* 复选框状态变了（导入/清除向日葵表时）整体重建一次 */
function refreshColToggles(){buildColToggles()}

/* 表头有 data-key，直接按 key 判；表体没有标记，按列序一一对应同步 */
function applyColVisibility(){
  const ths=Array.from(document.querySelectorAll("#deviceTable thead th"));
  const flags=ths.map(th=>!!(th.dataset.key&&hiddenCols.has(th.dataset.key)));
  ths.forEach((th,i)=>{th.hidden=flags[i]});
  document.querySelectorAll("#deviceBody tr").forEach(tr=>{
    Array.from(tr.children).forEach((td,i)=>{td.hidden=!!flags[i]});
  });
  const table=$("deviceTable");
  if(table){
    let w=0;
    ths.forEach((th,i)=>{if(!flags[i])w+=COL_MIN_WIDTH[th.dataset.key]||120});
    table.style.minWidth=w?w+"px":"";
  }
}

function visibleColCount(){
  const n=Array.from(document.querySelectorAll("#deviceTable thead th")).filter(th=>!th.hidden).length;
  return n>0?n:1;
}

/* ---------- 向日葵表导入 ---------- */
function parseSunlogin(text){
  const rows=parseCsv(text);
  /* 表头不一定在第一行（标准导出前面有「须知」说明行），在前 12 行里找含「备注」的那一行 */
  let headerAt=-1,header=null;
  for(let i=0;i<Math.min(rows.length,12);i++){
    const cells=(rows[i]||[]).map(c=>safe(c).trim());
    if(cells.includes("备注")){headerAt=i;header=cells;break}
  }
  if(headerAt<0)return{error:"没找到表头：需要含「备注」列的向日葵设备表"};
  const iName=colOf(header,["设备名称"]), iNote=colOf(header,["备注"]);
  const iStatus=colOf(header,["状态"]), iGroup=colOf(header,["分组"]);
  const iCode=colOf(header,["识别码","葵码"]), iCn=colOf(header,["计算机名"]);
  const iLast=colOf(header,["最后在线时间"]), iIp=colOf(header,["内网IP","内网 IP","内网ip"]);
  const out=[];
  for(let i=headerAt+1;i<rows.length;i++){
    const r=rows[i];
    if(!r||r.every(c=>!safe(c).trim()))continue;
    const note=cell(r,iNote),cn=cell(r,iCn);
    if(!note&&!cn)continue;                 /* 备注和计算机名都空的行没有匹配价值 */
    out.push({dev:cell(r,iName),note,status:cell(r,iStatus),group:cell(r,iGroup),
      code:cell(r,iCode),cn,last:cell(r,iLast),ip:cell(r,iIp)});
  }
  if(!out.length)return{error:"表头下面没解析到数据行"};
  return{rows:out};
}

function buildSunIndex(rows){
  const exact=new Map(),tail=new Map(),cn=new Map();
  rows.forEach(r=>{
    const n=safe(r.note).trim().toUpperCase();
    if(n){
      if(!exact.has(n))exact.set(n,r);
      const t=snTail(n);
      if(t&&!tail.has(t))tail.set(t,r);
    }
    const c=safe(r.cn).trim().toUpperCase();
    if(c&&!cn.has(c))cn.set(c,r);
  });
  return{exact,tail,cn};
}

/* 设备 → 向日葵行：备注原值 → 备注去前缀 → 计算机名 */
function lookupSun(d){
  if(!sunIndex)return null;
  const sn=safe(d.serial_number).trim().toUpperCase();
  if(sn){
    if(sunIndex.exact.has(sn))return sunIndex.exact.get(sn);
    const t=snTail(sn);
    if(t&&sunIndex.tail.has(t))return sunIndex.tail.get(t);
  }
  const cn=safe(d.computer_name).trim().toUpperCase();
  if(cn&&sunIndex.cn.has(cn))return sunIndex.cn.get(cn);
  return null;
}

function isSunOnline(status){
  const s=safe(status);
  return /在线/.test(s)&&!/离线/.test(s);
}

/* 把匹配结果写回设备对象；返回匹配上的台数 */
function applySunToDevices(){
  let matched=0;
  allDevices.forEach(d=>{
    const s=lookupSun(d);
    d.sun_status=s?safe(s.status).trim():"";
    d.sun_group=s?safe(s.group).trim():"";
    d.sun_code=s?safe(s.code).trim():"";
    d.sun_note=s?safe(s.note).trim():"";
    d.sun_online=isSunOnline(d.sun_status);
    if(s)matched++;
  });
  return matched;
}

function saveSunStore(){
  try{
    localStorage.setItem(SUN_STORE_KEY,JSON.stringify({
      v:1,name:sunMeta?sunMeta.name:"",importedAt:sunMeta?sunMeta.importedAt:"",
      total:sunRows.length,rows:sunRows
    }));
    return true;
  }catch(e){return false}
}

function loadSunStore(){
  try{
    const raw=localStorage.getItem(SUN_STORE_KEY);
    if(!raw)return false;
    const data=JSON.parse(raw);
    if(!data||!Array.isArray(data.rows)||!data.rows.length)return false;
    sunRows=data.rows;
    sunIndex=buildSunIndex(sunRows);
    sunMeta={name:safe(data.name),importedAt:safe(data.importedAt),total:sunRows.length,matched:0};
    return true;
  }catch(e){return false}
}

function clearSunStore(){
  try{localStorage.removeItem(SUN_STORE_KEY)}catch(e){}
  sunRows=[];sunIndex=null;sunMeta=null;
  allDevices.forEach(d=>{d.sun_status="";d.sun_group="";d.sun_code="";d.sun_note="";d.sun_online=false});
  SUN_KEYS.forEach(k=>hiddenCols.add(k));   /* 没数据就别占位置 */
  saveHiddenCols();
  refreshColToggles();
  updateSunStatus();
  render();
}

function updateSunStatus(){
  const el=$("sunStatus"),clear=$("clearSunBtn");
  if(!el)return;
  el.classList.remove("err");
  if(!sunRows.length){el.hidden=true;if(clear)clear.hidden=true;return}
  el.hidden=false;if(clear)clear.hidden=false;
  const matched=(sunMeta&&sunMeta.matched)||0;
  const time=sunMeta&&sunMeta.importedAt?formatBeijingTime(sunMeta.importedAt,false):"";
  el.innerHTML=`向日葵表：已匹配 <b>${matched}</b> / ${sunRows.length} 台`
    +(time?` · 导入于 ${escapeHtml(time)}`:"")
    +(sunMeta&&sunMeta.name?` · ${escapeHtml(sunMeta.name)}`:"");
  el.title=sunMeta&&sunMeta.name?sunMeta.name:"";
}

function showSunError(msg){
  const el=$("sunStatus");
  if(!el)return;
  el.hidden=false;el.classList.add("err");
  el.innerHTML=escapeHtml(msg);
  el.title="";
}

async function importSunFile(file){
  if(!file)return;
  showSunError("正在解析…");
  try{
    const parsed=parseSunlogin(await readFileText(file));
    if(parsed.error){showSunError(parsed.error);return}
    sunRows=parsed.rows;
    sunIndex=buildSunIndex(sunRows);
    sunMeta={name:file.name,importedAt:new Date().toISOString(),total:sunRows.length,matched:0};
    const matched=applySunToDevices();
    sunMeta.matched=matched;
    const saved=saveSunStore();
    SUN_KEYS.forEach(k=>hiddenCols.delete(k));   /* 导入成功后默认把这四列放出来 */
    saveHiddenCols();
    refreshColToggles();
    updateSunStatus();
    render();
    if(!saved){
      /* 数据量太大，本地存不下：本次能用，刷新后要重新导入 */
      const el=$("sunStatus");
      if(el)el.title="数据量较大，未能保存到浏览器本地：刷新页面后需要重新导入";
    }
  }catch(e){
    console.error(e);
    showSunError("导入失败："+safe(e&&e.message||String(e)));
  }
}

function getFilteredSorted(){
  const q=$("searchInput").value.trim().toLowerCase();
  /* 导入向日葵表后，备注 / 识别码 / 分组也参与搜索 */
  const keys=["serial_number","computer_name","windows_user","forticlient_user","forticlient_last_seen","outlook_account","manufacturer","model","os_name","script_version","sun_note","sun_code","sun_group"];
  let rows=allDevices.filter(d=>(!q||keys.some(k=>safe(d[k]).toLowerCase().includes(q)))
    &&matchesFilter(d,activeFilter));
  rows.sort((a,b)=>{
    /* C盘空间按剩余容量排序：升序时剩余最少在前；null / 无数据（旧 Agent）始终排最后 */
    if(sortKey==="c_drive_free_gb"){
      const av=toGbNumber(a[sortKey]),bv=toGbNumber(b[sortKey]);
      if(av===null&&bv===null)return 0;
      if(av===null)return 1;
      if(bv===null)return -1;
      return (av-bv)*(sortAsc?1:-1);
    }
    /* 向日葵列：没匹配上的（空值）恒排最后；状态列按 在线 → 离线 → 无数据 排 */
    if(sortKey.startsWith("sun_")){
      const av=safe(a[sortKey]).trim(),bv=safe(b[sortKey]).trim();
      if(!av&&!bv)return 0;
      if(!av)return 1;
      if(!bv)return -1;
      if(sortKey==="sun_status"){
        const rank=d=>!d.sun_status?2:(d.sun_online?0:1);
        return (rank(a)-rank(b))*(sortAsc?1:-1);
      }
      return compareValues(a,b,sortKey)*(sortAsc?1:-1);
    }
    return compareValues(a,b,sortKey)*(sortAsc?1:-1);
  });
  return rows;
}

function updateSortIndicators(){
  document.querySelectorAll("th[data-key]").forEach(th=>{
    const indicator=th.querySelector(".sort-indicator");
    th.classList.toggle("sorted",th.dataset.key===sortKey);
    if(indicator) indicator.innerHTML=th.dataset.key===sortKey?(sortAsc?'<span class="arrow active">▲</span><span class="arrow">▼</span>':'<span class="arrow">▲</span><span class="arrow active">▼</span>'):'<span class="arrow">▲</span><span class="arrow">▼</span>';
    th.setAttribute("aria-sort",th.dataset.key===sortKey?(sortAsc?"ascending":"descending"):"none");
  });
}

function renderPagination(totalRows,totalPages){
  const pagination=$("pagination");
  const prev=$("prevPageBtn"), next=$("nextPageBtn"), info=$("pageInfo");
  const all=pageSize===0;
  pagination.style.display=all||totalRows===0?"none":"flex";
  if(all||totalRows===0)return;
  prev.disabled=currentPage<=1;
  next.disabled=currentPage>=totalPages;
  info.textContent=`第 ${currentPage} / ${totalPages} 页`;
}

function render(){
  const rows=getFilteredSorted(), body=$("deviceBody");
  const totalRows=rows.length;
  const totalPages=pageSize===0?1:Math.max(1,Math.ceil(totalRows/pageSize));
  if(currentPage>totalPages)currentPage=totalPages;
  if(currentPage<1)currentPage=1;

  let visibleRows=rows;
  let start=0,end=totalRows;
  if(pageSize!==0){
    start=(currentPage-1)*pageSize;
    end=Math.min(start+pageSize,totalRows);
    visibleRows=rows.slice(start,end);
  }

  $("resultCount").textContent=totalRows===0?"0 台设备":pageSize===0?`共 ${totalRows} 台设备 · 已显示全部`:`共 ${totalRows} 台设备 · 显示 ${start+1}-${end}`;
  updateSortIndicators();
  renderPagination(totalRows,totalPages);

  if(!visibleRows.length){body.innerHTML=`<tr><td colspan="${visibleColCount()}" class="empty-state">没有匹配的设备</td></tr>`;applyColVisibility();return}
  body.innerHTML=visibleRows.map(d=>{
    const report=timeAgo(d.report_time);
    const vpnTime=safe(d.forticlient_last_seen).trim();
    const vpnAgo=vpnTime?timeAgo(vpnTime):null;
    const vpnFull=safe(d.forticlient_user).trim();
    return `<tr>
      <td><strong>${escapeHtml(displayValue(d.computer_name))}</strong></td>
      <td class="mono">${escapeHtml(displayValue(d.serial_number))}</td>
      <td>${escapeHtml(displayValue(d.windows_user))}</td>
      <td class="mono"${vpnFull?` title="${escapeHtml(vpnFull)}"`:""}>${escapeHtml(displayVpnUser(d.forticlient_user))}</td>
      <td>${vpnTime?`${escapeHtml(vpnAgo.text)}<br><span class="muted">${escapeHtml(displaySourceTime(vpnTime))}</span>`:'<span class="muted">—</span>'}</td>
      <td>${escapeHtml(displayValue(d.outlook_account))}</td>
      <td>${safe(d.manufacturer).trim()?`<span class="badge">${escapeHtml(d.manufacturer)}</span>`:'<span class="muted">—</span>'}</td>
      <td>${escapeHtml(displayValue(d.model))}</td>
      <td>${escapeHtml(displayValue(d.os_name))}</td>
      <td>${displayDrive(d.c_drive_free_gb,d.c_drive_total_gb)}</td>
      <td><span class="${report.cls}">${escapeHtml(report.text)}</span><br><span class="muted">${escapeHtml(formatBeijingTime(d.report_time))}</span></td>
      <td class="mono">${escapeHtml(displayValue(d.script_version))}</td>
      <td>${d.sun_status?`<span class="sun-pill ${d.sun_online?"online":"offline"}">${escapeHtml(d.sun_status)}</span>`:'<span class="muted">—</span>'}</td>
      <td>${escapeHtml(displayValue(d.sun_group))}</td>
      <td class="mono">${escapeHtml(displayValue(d.sun_code))}</td>
      <td class="mono">${escapeHtml(displayValue(d.sun_note))}</td>
    </tr>`;
  }).join("");
  applyColVisibility();
}

async function loadDevices(){
  setStatus("正在读取数据");
  try{
    const res=await fetch(API_URL,{cache:"no-store"});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const data=await res.json();
    if(!Array.isArray(data))throw new Error("API 返回格式不是数组");
    allDevices=data; updateStats(data); currentPage=1;
    /* 有导入过的向日葵表就按备注↔序列号重新匹配一次（接口数据会变） */
    const matched=applySunToDevices();
    if(sunMeta)sunMeta.matched=matched;
    updateSunStatus();
    render();
    setStatusUploadTime(allDevices);          /* 右上角展示最近一次上报时间 */
    $("lastUpdated").textContent="页面刷新时间："+new Date().toLocaleString();
  }catch(e){
    console.error(e);
    setStatus("读取失败","err","无法读取设备数据，请检查 Worker / CORS / API 地址");
    $("deviceBody").innerHTML=`<tr><td colspan="${visibleColCount()}" class="empty-state">无法读取设备数据，请检查 Worker / CORS / API 地址。</td></tr>`;
  }
}

function exportCsv(){
  const rows=getFilteredSorted();
  const headers=[
    ["computer_name","ComputerName"],["serial_number","SerialNumber"],["windows_user","WindowsUser"],
    ["forticlient_user","FortiClientUser"],["forticlient_last_seen","FortiClientLastSeen"],["outlook_account","OutlookAccount"],
    ["manufacturer","Manufacturer"],["model","Model"],["os_name","OSName"],["report_time","ReportTime"],["script_version","ScriptVersion"],
    ["c_drive_total_gb","C Drive Total GB"],["c_drive_free_gb","C Drive Free GB"]
  ];
  /* 导入过向日葵表才追加这四列，没导入时不干扰原有导出格式 */
  if(sunRows.length){
    headers.push(["sun_status","向日葵状态"],["sun_group","向日葵分组"],["sun_code","识别码"],["sun_note","备注"]);
  }
  const esc=v=>`"${safe(v).replaceAll('"','""')}"`;
  /* 磁盘字段导出原始数值，不合并；旧 Agent 无数据 → 空值 */
  const cell=(r,key)=>{
    if(key==="c_drive_total_gb"||key==="c_drive_free_gb"){
      const n=toGbNumber(r[key]);
      return n===null?'""':String(n);
    }
    return esc(r[key]);
  };
  const csv=[headers.map(h=>esc(h[1])).join(","),...rows.map(r=>headers.map(h=>cell(r,h[0])).join(","))].join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`asset-center-${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded",()=>{
  initTheme();
  loadSunStore();          /* 恢复上一次导入的向日葵表（存在浏览器本地） */
  const params=new URLSearchParams(location.search);
  const preset=params.get("q");
  if(preset)$("searchInput").value=preset;
  activeFilter=parseFilterParam(params.get("filter"));
  updateFilterChip();
  const clearBtn=$("clearFilterBtn");
  if(clearBtn)clearBtn.addEventListener("click",clearFilter);
  /* 列显隐：默认全显示；向日葵四列在没有导入数据时默认隐藏 */
  if(!sunRows.length)SUN_KEYS.forEach(k=>hiddenCols.add(k));
  buildColToggles();
  applyColVisibility();
  const showAll=$("showAllColsBtn");
  if(showAll)showAll.addEventListener("click",()=>{
    hiddenCols.clear();
    if(!sunRows.length)SUN_KEYS.forEach(k=>hiddenCols.add(k));
    saveHiddenCols();refreshColToggles();applyColVisibility();
  });
  const sunInput=$("sunFileInput");
  const importBtn=$("importSunBtn");
  if(importBtn&&sunInput){
    importBtn.addEventListener("click",()=>sunInput.click());
    sunInput.addEventListener("change",()=>{
      const f=sunInput.files&&sunInput.files[0];
      sunInput.value="";                      /* 清空 value，同一个文件可以重复导入 */
      importSunFile(f);
    });
  }
  const clearSun=$("clearSunBtn");
  if(clearSun)clearSun.addEventListener("click",clearSunStore);

  $("searchInput").addEventListener("input",()=>{currentPage=1;render()});
  $("refreshBtn").addEventListener("click",loadDevices);
  $("exportBtn").addEventListener("click",exportCsv);
  $("pageSizeSelect").addEventListener("change",e=>{pageSize=e.target.value==="all"?0:Number(e.target.value);currentPage=1;render()});
  $("prevPageBtn").addEventListener("click",()=>{if(currentPage>1){currentPage--;render()}});
  $("nextPageBtn").addEventListener("click",()=>{currentPage++;render()});
  document.querySelectorAll("th[data-key]").forEach(th=>th.addEventListener("click",()=>{
    const key=th.dataset.key;
    if(sortKey===key)sortAsc=!sortAsc;else{sortKey=key;sortAsc=true}
    currentPage=1;render();
  }));
  loadDevices();
});
