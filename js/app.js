let allDevices = [];
let sortKey = "report_time";
let sortAsc = false;
let pageSize = 20;
let currentPage = 1;
let activeFilter = null;   /* {key,value}，来自看板下钻的 ?filter= 参数 */
let sourceFilter = "";       /* "agent" / "asset" / 空串 */

/* ---------- 列显隐（勾选即隐藏，选择记在本地） ---------- */
const HIDE_COLS_KEY = "asset-center-hidden-cols-v1";
/* 升级标记：资产列改由服务端供数后，只需把旧的「默认隐藏」恢复一次 */
const COLS_MIGRATION_KEY = "asset-center-hidden-cols-migrated-v2";
/* 每列最小宽度：隐藏列后表格整体收窄，横向滚动条也随之变短 */
const COL_MIN_WIDTH = {
  computer_name:170,serial_number:150,windows_user:140,forticlient_user:130,
  forticlient_last_seen:150,outlook_account:200,manufacturer:100,model:210,
  os_name:180,c_drive_free_gb:130,report_time:150,script_version:120,
  mgmt_status:130,sun_last:150,
  sun_status:100,sun_group:130,sun_code:110,sun_note:150
};
let hiddenCols = loadHiddenCols();

/* ---------- 资产表（向日葵 CSV） ----------
   数据不再落在浏览器本地：CSV 解析后直接 POST /import-assets 写入 D1 asset_inventory，
   展示用的资产字段由 GET /devices 统一返回（Agent ∪ Asset 的 SN 并集）。
   接口暂时还没返回这些字段时，相关列会自动隐藏，后端上线后自动出现。 */
const SUN_KEYS = ["sun_status","sun_group","sun_code","sun_note","sun_last"];
const MGMT_COL = "mgmt_status";
const DATA_DRIVEN_COLS = SUN_KEYS.concat([MGMT_COL]);
/* 本轮因「接口没有该字段数据」而临时隐藏的列；不写入用户偏好，数据到位后自动恢复显示 */
let autoHiddenCols = new Set();
let sunMeta = null;      /* 最近一次导入结果 {name, importedAt, read, imported, skipped} */
let importBusy = false;  /* 上传进行中：按钮 disabled，避免重复提交 */

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
/* 纳管状态下拉与 activeFilter 双向同步：
   看板下钻（?filter=manage:xxx）进来时自动选中，点「×」清除筛选时自动回到「全部」。
   接口还没有纳管数据时整块隐藏。 */
function syncManageFilter(){
  const wrap=$("manageFilterWrap"),sel=$("manageFilter");
  if(!wrap||!sel)return;
  wrap.hidden=!hasManagementData(allDevices);
  /* 看板还能下钻到 manage:asset / manage:agent（下拉里没有这两项），
     找不到对应 option 时退回「全部」，避免 select 显示空白。 */
  const v=(activeFilter&&activeFilter.key==="manage")?`manage:${activeFilter.value}`:"";
  sel.value=[...sel.options].some(o=>o.value===v)?v:"";
}

function updateFilterChip(){
  const wrap=$("filterChipWrap");
  syncManageFilter();
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
    const on=isColHidden(key);
    return `<label class="col-toggle${on?" is-hidden":""}" title="勾选后隐藏「${escapeHtml(label)}」列">`
      +`<input type="checkbox" data-col="${escapeHtml(key)}"${on?" checked":""}><span>${escapeHtml(label)}</span></label>`;
  }).join("");
  wrap.querySelectorAll("input[data-col]").forEach(inp=>{
    inp.addEventListener("change",()=>{
      if(inp.checked)hiddenCols.add(inp.dataset.col);
      else{
        hiddenCols.delete(inp.dataset.col);
        autoHiddenCols.delete(inp.dataset.col);   /* 用户显式要求显示，覆盖「本轮无数据」 */
      }
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
  const flags=ths.map(th=>!!(th.dataset.key&&isColHidden(th.dataset.key)));
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

/* ---------- 向日葵 CSV 解析 ----------
   表头不一定在第一行（标准导出前面有「须知」说明行），在前 12 行里找含「备注」的那一行。
   这里一次性采集标准 CSV 的全部 15 列，既给界面展示用，也给 toImportRecords() 组装
   /import-assets 的请求体，避免同一份文件解析两遍。 */
function parseSunlogin(text){
  const rows=parseCsv(text);
  let headerAt=-1,header=null;
  for(let i=0;i<Math.min(rows.length,12);i++){
    const cells=(rows[i]||[]).map(c=>safe(c).trim());
    if(cells.includes("备注")){headerAt=i;header=cells;break}
  }
  if(headerAt<0)return{error:"无法识别该文件：需要含「备注」列的向日葵设备 CSV"};
  const iName=colOf(header,["设备名称"]), iNote=colOf(header,["备注"]);
  const iStatus=colOf(header,["状态"]), iGroup=colOf(header,["分组"]);
  const iCode=colOf(header,["识别码","葵码"]), iCn=colOf(header,["计算机名"]);
  const iLast=colOf(header,["最后在线时间"]), iIp=colOf(header,["内网IP","内网 IP","内网ip"]);
  const iVer=colOf(header,["向日葵版本号"]), iDeploy=colOf(header,["部署来源"]);
  const iSys=colOf(header,["系统版本"]), iMac=colOf(header,["MAC地址","MAC 地址"]);
  const iLoginIp=colOf(header,["最后登录IP","最后登录 IP"]);
  const iCpu=colOf(header,["处理器"]), iMem=colOf(header,["内存"]);
  const out=[];
  for(let i=headerAt+1;i<rows.length;i++){
    const r=rows[i];
    if(!r||r.every(c=>!safe(c).trim()))continue;
    const note=cell(r,iNote),cn=cell(r,iCn);
    if(!note&&!cn)continue;                 /* 备注和计算机名都空的行没有匹配价值 */
    out.push({dev:cell(r,iName),note,status:cell(r,iStatus),group:cell(r,iGroup),
      code:cell(r,iCode),cn,last:cell(r,iLast),ip:cell(r,iIp),
      version:cell(r,iVer),deploy:cell(r,iDeploy),sys:cell(r,iSys),
      mac:cell(r,iMac),loginIp:cell(r,iLoginIp),cpu:cell(r,iCpu),mem:cell(r,iMem)});
  }
  if(!out.length)return{error:"表头下面没解析到数据行"};
  return{rows:out};
}

/* CSV 行 → /import-assets 记录。
   「备注」是 serial_number 的主要来源，提交前统一 TRIM + UPPERCASE；
   空 SN 的记录直接跳过，绝不向接口发送空 serial_number（D1 里它是主键）。 */
function toImportRecords(rows){
  const records=[],skipped=[];
  (rows||[]).forEach(r=>{
    const sn=snTail(r.note);
    if(!sn){
      skipped.push(safe(r.dev).trim()||safe(r.cn).trim()||"（空行）");
      return;
    }
    records.push({
      serial_number:sn,
      device_name:safe(r.dev).trim(),
      asset_note:safe(r.note).trim(),
      status:safe(r.status).trim(),
      asset_group:safe(r.group).trim(),
      sunlogin_code:safe(r.code).trim(),
      sunlogin_version:safe(r.version).trim(),
      deployment_source:safe(r.deploy).trim(),
      system_version:safe(r.sys).trim(),
      mac_address:safe(r.mac).trim(),
      internal_ip:safe(r.ip).trim(),
      last_login_ip:safe(r.loginIp).trim(),
      last_online_time:safe(r.last).trim(),
      computer_name:safe(r.cn).trim(),
      processor:safe(r.cpu).trim(),
      memory:safe(r.mem).trim()
    });
  });
  return{records,skipped,total:(rows||[]).length};
}

/* GET /devices 的统一数据 → 展示字段。
   Worker 还没升级时这些字段全是 undefined，对应列会自动隐藏，
   原有 Agent 字段的展示不受影响。 */
function normalizeAssetFields(d){
  d.sun_status=safe(d.sun_status).trim();
  d.sun_group=safe(d.sun_group).trim()||safe(d.asset_group).trim();
  d.sun_code=safe(d.sunlogin_code).trim();
  d.sun_note=safe(d.asset_note).trim();
  d.sun_last=safe(d.last_online_time).trim();
  d.sun_online=/在线/.test(d.sun_status)&&!/离线/.test(d.sun_status);
  d.mgmt_status=managementStatusOf(d);
}

/* 按本轮数据决定哪些列「暂时没有内容」，只记在内存里，不覆盖用户手动的显隐偏好 */
function syncDataDrivenCols(){
  autoHiddenCols=new Set();
  const hasSun=allDevices.some(d=>d.sun_status||d.sun_group||d.sun_code||d.sun_note||d.sun_last);
  if(!hasSun)SUN_KEYS.forEach(k=>autoHiddenCols.add(k));
  if(!hasManagementData(allDevices))autoHiddenCols.add(MGMT_COL);
}

/* 实际是否隐藏 = 用户偏好 ∪ 本轮无数据 */
function isColHidden(k){return hiddenCols.has(k)||autoHiddenCols.has(k)}

/* 旧版本把整张向日葵表缓存在浏览器本地；D1 asset_inventory 才是正式数据源，
   这份旧缓存必须作废，否则会盖掉服务器返回的资产数据。 */
function dropLegacySunStore(){
  try{localStorage.removeItem(LEGACY_SUN_STORE_KEY)}catch(e){/* 存储不可用，忽略 */}
}

/* 老版本默认把向日葵四列设为隐藏；升级后这些列改由服务端供数，
   这里一次性恢复显示，之后交给 syncDataDrivenCols() 按数据有无自动收放。 */
function migrateHiddenCols(){
  try{
    if(localStorage.getItem(COLS_MIGRATION_KEY))return;
    DATA_DRIVEN_COLS.forEach(k=>hiddenCols.delete(k));
    saveHiddenCols();
    localStorage.setItem(COLS_MIGRATION_KEY,"1");
  }catch(e){/* 存储不可用，仅本次生效 */}
}

/* ---------- 导入状态条 ---------- */
function setSunStatus(html,isError){
  const el=$("sunStatus");
  if(!el)return;
  if(!html){el.hidden=true;el.classList.remove("err");el.innerHTML="";el.title="";return}
  el.hidden=false;
  el.classList.toggle("err",!!isError);
  el.innerHTML=html;
  el.title="";
}

function assetCoverageText(){
  if(!allDevices.length)return "";
  const withAsset=allDevices.filter(d=>asBool(d.has_asset)).length;
  if(!withAsset)return "";
  return `资产表已关联 <b>${withAsset}</b> / ${allDevices.length} 台`;
}

function updateSunStatus(){
  const coverage=assetCoverageText();
  if(!sunMeta){setSunStatus(coverage);return}
  const m=sunMeta;
  const time=m.importedAt?formatBeijingTime(m.importedAt,false):"";
  setSunStatus(`<b>资产数据导入成功</b> · 读取 ${m.read} · 导入 ${m.imported} · 跳过 ${m.skipped}`
    +(time?` · ${escapeHtml(time)}`:"")
    +(coverage?` · ${coverage}`:""));
}

function showSunError(msg){setSunStatus(escapeHtml(msg),true)}

/* ---------- 轻量弹窗（确认导入 / 输入 Import Key） ----------
   用页面内浮层而不是 window.prompt：外观与现有卡片一致、跟随明暗主题，
   也不会被浏览器「阻止重复弹窗」的机制拦掉。 */
function closeModal(){
  const mask=$("modalMask");
  if(mask)mask.remove();
}

/* input 非空 → 返回输入的字符串（取消/空值返回 null）；否则 → 确定返回 true，取消返回 null */
function openModal(opts){
  return new Promise(resolve=>{
    closeModal();
    const title=safe(opts&&opts.title);
    const mask=document.createElement("div");
    mask.className="modal-mask";
    mask.id="modalMask";
    const field=opts&&opts.input
      ? `<label class="modal-field"><span class="modal-field-label">${escapeHtml(opts.input.label||"")}</span>`
        +`<input id="modalInput" class="modal-input" type="password" autocomplete="off" spellcheck="false"`
        +` placeholder="${escapeHtml(opts.input.placeholder||"")}"></label>`
      : "";
    mask.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">`
      +`<h2 class="modal-title">${escapeHtml(title)}</h2>`
      +`<div class="modal-body">${safe(opts&&opts.body)}</div>${field}`
      +`<div class="modal-actions">`
      +`<button class="btn btn-sm" type="button" data-act="cancel">${escapeHtml(opts&&opts.cancelText||"取消")}</button>`
      +`<button class="btn btn-sm btn-primary" type="button" data-act="ok">${escapeHtml(opts&&opts.confirmText||"确定")}</button>`
      +`</div></div>`;
    document.body.appendChild(mask);

    const finish=value=>{closeModal();resolve(value)};
    const submit=()=>{
      const el=$("modalInput");
      finish(el?(el.value.trim()||null):true);
    };

    mask.addEventListener("click",e=>{
      if(e.target===mask){finish(null);return}
      const act=e.target.closest("[data-act]");
      if(!act)return;
      if(act.dataset.act==="cancel")finish(null);
      else submit();
    });
    mask.addEventListener("keydown",e=>{
      if(e.key==="Escape"){finish(null);return}
      if(e.key==="Enter"){e.preventDefault();submit()}
    });
    const focusEl=$("modalInput")||mask.querySelector("[data-act='ok']");
    if(focusEl)focusEl.focus();
  });
}

/* Worker 返回的具体错误要原样展示，不能只说「上传失败」 */
function importErrorDetail(status,json,text){
  const body=json?(safe(json.error)||safe(json.message)):safe(text).trim();
  if(status===401||status===403)return body?`导入密码错误 · ${body}`:"导入密码错误";
  if(status===400)return body||"请求格式不正确";
  if(status===413)return body||"数据量过大，请拆分后分批导入";
  if(status>=500)return body?`服务器错误 · ${body}`:"数据库写入失败";
  return body||"未知错误";
}

/* 选择 CSV → 解析 → 确认条数 → 输入 Import Key → POST /import-assets → 刷新列表 */
async function importSunFile(file){
  if(!file||importBusy)return;
  showSunError("正在解析…");
  let parsed;
  try{
    parsed=parseSunlogin(await readFileText(file));
  }catch(e){
    console.error(e);
    showSunError("读取文件失败："+safe(e&&e.message||String(e)));
    return;
  }
  if(parsed.error){showSunError(parsed.error);return}

  const {records,skipped,total}=toImportRecords(parsed.rows);
  if(!records.length){
    showSunError(`解析到 ${total} 行，但没有一行带「备注」序列号，已全部跳过。`);
    return;
  }

  const body=`<p>检测到 <b>${total}</b> 条设备记录</p>`
    +`<p>有效 SN：<b>${records.length}</b></p>`
    +(skipped.length?`<p>缺少 SN：<b>${skipped.length}</b>（不会上传）</p>`:"")
    +`<p class="modal-hint">确认导入？</p>`;
  const confirmed=await openModal({title:"导入向日葵表",body,confirmText:"确认导入",cancelText:"取消"});
  if(!confirmed){updateSunStatus();return}

  /* Import Key 只存在于这个局部变量里：不写 localStorage / sessionStorage / Cookie，
     请求结束即随变量回收。 */
  const importKey=await openModal({
    title:"资产导入密码",
    body:`<p class="modal-hint">密码仅用于本次上传，不会保存在浏览器或源码中。</p>`,
    input:{label:"Import Key",placeholder:"请输入资产导入密码"},
    confirmText:"上传",
    cancelText:"取消"
  });
  if(!importKey){updateSunStatus();return}

  await postImport(records,total,skipped.length,importKey);
}

async function postImport(records,total,skippedCount,importKey){
  const btn=$("importSunBtn");
  importBusy=true;
  if(btn){btn.disabled=true;btn.classList.add("is-busy")}
  setSunStatus(`正在导入资产数据…（${records.length} 条）`);
  try{
    const res=await fetch(IMPORT_API_URL,{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Import-Key":importKey},
      body:JSON.stringify({devices:records})
    });
    const text=await res.text();
    let json=null;
    try{json=JSON.parse(text)}catch(e){/* 部分错误响应是纯文本，按下面 text 兜底 */}
    if(!res.ok){
      showSunError(`导入失败 · HTTP ${res.status} · ${importErrorDetail(res.status,json,text)}`);
      return;
    }
    const imported=json&&json.imported!=null?json.imported:records.length;
    const skipped=json&&json.skipped!=null?json.skipped:skippedCount;
    const received=json&&json.received!=null?json.received:total;
    sunMeta={importedAt:new Date().toISOString(),read:received,imported,skipped};
    /* 写库完成后重新拉服务端统一数据，列表立刻反映 Agent ∪ Asset 的并集 */
    await loadDevices();
  }catch(e){
    console.error(e);
    showSunError("导入失败 · "+safe(e&&e.message||String(e))
      +"（若提示 Failed to fetch，通常是 Worker 的 CORS 未放行 X-Import-Key）");
  }finally{
    importBusy=false;
    if(btn){btn.disabled=false;btn.classList.remove("is-busy")}
    importKey="";
  }
}

function setSourceFilter(source){
  sourceFilter=sourceFilter===source?"":source;
  ["agent","asset"].forEach(kind=>{
    const btn=$(kind==="agent"?"showAgentBtn":"showAssetBtn");
    if(btn)btn.setAttribute("aria-pressed",String(sourceFilter===kind));
  });
  currentPage=1;
  render();
}

function getFilteredSorted(){
  const q=$("searchInput").value.trim().toLowerCase();
  /* 资产表字段也参与搜索：备注 / 识别码 / 分组 / 最后在线 / MAC / 内网 IP / 登录 IP / 资产计算机名 */
  const keys=["serial_number","computer_name","windows_user","forticlient_user","forticlient_last_seen","outlook_account","manufacturer","model","os_name","script_version",
    "sun_note","sun_code","sun_group","sun_last","mac_address","internal_ip","last_login_ip","asset_computer_name","asset_device_name"];
  let rows=allDevices.filter(d=>(!q||keys.some(k=>safe(d[k]).toLowerCase().includes(q)))
    &&matchesFilter(d,activeFilter)
    &&(!sourceFilter||asBool(d[sourceFilter==="agent"?"has_agent":"has_asset"])));
  rows.sort((a,b)=>{
    /* C盘空间按剩余容量排序：升序时剩余最少在前；null / 无数据（旧 Agent）始终排最后 */
    if(sortKey==="c_drive_free_gb"){
      const av=toGbNumber(a[sortKey]),bv=toGbNumber(b[sortKey]);
      if(av===null&&bv===null)return 0;
      if(av===null)return 1;
      if(bv===null)return -1;
      return (av-bv)*(sortAsc?1:-1);
    }
    /* 管理状态：正常纳管 → Agent未上报 → 未登记资产 → 无数据（接口未提供时恒排最后） */
    if(sortKey===MGMT_COL){
      const rank=d=>({managed:0,agent_missing:1,asset_missing:2})[d.mgmt_status]??3;
      const av=rank(a),bv=rank(b);
      if(av===3&&bv===3)return 0;
      if(av===3)return 1;
      if(bv===3)return -1;
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

/* 纳管状态药丸。接口没返回 management_status 时 d.mgmt_status 为空 → 显示 —（该列届时会整体隐藏） */
function renderMgmtStatus(d){
  const meta=MANAGEMENT_STATUS[d.mgmt_status];
  if(!meta)return '<span class="muted">—</span>';
  return `<span class="mgmt-pill ${meta.cls}" title="${escapeHtml(meta.hint)}">${escapeHtml(meta.label)}</span>`;
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
      <td>${renderMgmtStatus(d)}</td>
      <td>${escapeHtml(displayValue(d.sun_last))}</td>
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
    allDevices=reconcileDevices(data); updateStats(allDevices); currentPage=1;
    /* 统一数据：把 asset_inventory 侧的字段摊平到展示字段上，并算出纳管状态 */
    allDevices.forEach(normalizeAssetFields);
    syncDataDrivenCols();
    refreshColToggles();
    updateSunStatus();
    syncManageFilter();
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
  /* 接口带资产字段时才追加这几列，没有资产数据时不干扰原有导出格式 */
  const hasAssetCols=allDevices.some(d=>d.sun_status||d.sun_group||d.sun_code||d.sun_note||d.sun_last);
  if(hasAssetCols){
    headers.push(["sun_status","向日葵状态"],["sun_group","向日葵分组"],["sun_code","识别码"],
      ["sun_note","备注"],["sun_last","最后在线"]);
  }
  if(hasManagementData(allDevices))headers.push(["mgmt_status","管理状态"]);
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
  dropLegacySunStore();    /* D1 asset_inventory 才是正式资产源，旧的浏览器缓存作废 */
  migrateHiddenCols();
  const params=new URLSearchParams(location.search);
  const preset=params.get("q");
  if(preset)$("searchInput").value=preset;
  activeFilter=parseFilterParam(params.get("filter"));
  updateFilterChip();
  syncManageFilter();
  const clearBtn=$("clearFilterBtn");
  if(clearBtn)clearBtn.addEventListener("click",clearFilter);
  const manageSel=$("manageFilter");
  if(manageSel)manageSel.addEventListener("change",()=>{
    const v=manageSel.value;
    activeFilter=v?parseFilterParam(v):null;
    updateFilterChip();
    currentPage=1;
    render();
  });
  buildColToggles();
  applyColVisibility();
  const showAll=$("showAllColsBtn");
  if(showAll)showAll.addEventListener("click",()=>{
    hiddenCols.clear();
    autoHiddenCols.clear();
    saveHiddenCols();refreshColToggles();applyColVisibility();
  });
  const agentBtn=$("showAgentBtn"),assetBtn=$("showAssetBtn");
  if(agentBtn)agentBtn.addEventListener("click",()=>setSourceFilter("agent"));
  if(assetBtn)assetBtn.addEventListener("click",()=>setSourceFilter("asset"));
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
