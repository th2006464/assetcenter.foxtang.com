let allDevices = [];
let sortKey = "report_time";
let sortAsc = false;
let pageSize = 20;
let currentPage = 1;

function displayValue(v){return safe(v).trim() || "—"}
function displayVpnUser(v){
  const full=safe(v).trim();
  if(!full)return "—";
  const pos=full.lastIndexOf("\\");
  return pos>=0?full.slice(pos+1):full;
}
function displaySourceTime(v){
  const s=safe(v).trim();
  if(!s)return "—";
  const m=s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m?`${m[1]} ${m[2]}`:s;
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
  const cutoff=Date.now()-86400000;
  $("statRecent").textContent=data.filter(d=>{const dt=parseDate(d.report_time);return dt&&dt.getTime()>=cutoff}).length;
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

function getFilteredSorted(){
  const q=$("searchInput").value.trim().toLowerCase();
  const keys=["serial_number","computer_name","windows_user","forticlient_user","forticlient_last_seen","outlook_account","manufacturer","model","os_name","script_version"];
  let rows=allDevices.filter(d=>!q||keys.some(k=>safe(d[k]).toLowerCase().includes(q)));
  rows.sort((a,b)=>compareValues(a,b,sortKey)*(sortAsc?1:-1));
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

  if(!visibleRows.length){body.innerHTML='<tr><td colspan="11" class="empty-state">没有匹配的设备</td></tr>';return}
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
      <td>${vpnTime?`<span class="${vpnAgo.cls}">${escapeHtml(vpnAgo.text)}</span><br><span class="muted">${escapeHtml(displaySourceTime(vpnTime))}</span>`:'<span class="muted">—</span>'}</td>
      <td>${escapeHtml(displayValue(d.outlook_account))}</td>
      <td>${safe(d.manufacturer).trim()?`<span class="badge">${escapeHtml(d.manufacturer)}</span>`:'<span class="muted">—</span>'}</td>
      <td>${escapeHtml(displayValue(d.model))}</td>
      <td>${escapeHtml(displayValue(d.os_name))}</td>
      <td><span class="${report.cls}">${escapeHtml(report.text)}</span><br><span class="muted">${escapeHtml(displayValue(d.report_time))}</span></td>
      <td class="mono">${escapeHtml(displayValue(d.script_version))}</td>
    </tr>`;
  }).join("");
}

async function loadDevices(){
  $("statusText").textContent="正在读取数据"; $("statusDot").className="status-dot";
  try{
    const res=await fetch(API_URL,{cache:"no-store"});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const data=await res.json();
    if(!Array.isArray(data))throw new Error("API 返回格式不是数组");
    allDevices=data; updateStats(data); currentPage=1; render();
    $("statusText").textContent="数据正常"; $("statusDot").className="status-dot ok";
    $("lastUpdated").textContent="页面刷新时间："+new Date().toLocaleString();
  }catch(e){
    console.error(e);
    $("statusText").textContent="读取失败"; $("statusDot").className="status-dot err";
    $("deviceBody").innerHTML='<tr><td colspan="11" class="empty-state">无法读取设备数据，请检查 Worker / CORS / API 地址。</td></tr>';
  }
}

function exportCsv(){
  const rows=getFilteredSorted();
  const headers=[
    ["computer_name","ComputerName"],["serial_number","SerialNumber"],["windows_user","WindowsUser"],
    ["forticlient_user","FortiClientUser"],["forticlient_last_seen","FortiClientLastSeen"],["outlook_account","OutlookAccount"],
    ["manufacturer","Manufacturer"],["model","Model"],["os_name","OSName"],["report_time","ReportTime"],["script_version","ScriptVersion"]
  ];
  const esc=v=>`"${safe(v).replaceAll('"','""')}"`;
  const csv=[headers.map(h=>esc(h[1])).join(","),...rows.map(r=>headers.map(h=>esc(r[h[0]])).join(","))].join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`asset-center-${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded",()=>{
  initTheme();
  const preset=new URLSearchParams(location.search).get("q");
  if(preset)$("searchInput").value=preset;
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
