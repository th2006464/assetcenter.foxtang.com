/* Device dashboard: aggregates the device API and renders dependency-free
   charts (SVG donuts + CSS bars). Shares API_URL and theme helpers from common.js. */

let devices = [];

const PALETTE = ["var(--chart-1)","var(--chart-2)","var(--chart-3)","var(--chart-4)","var(--chart-5)","var(--chart-6)","var(--chart-7)","var(--chart-8)"];
/* 活跃度 6 档（3h / 3-24h / 1-3d / 4-7d / 8-30d / ge30d）逐档变红 */
const RAMP = ["var(--ramp-1)","var(--ramp-2)","var(--ramp-3)","var(--ramp-4)","var(--ramp-5)","var(--ramp-6)"];

/* C 盘剩余空间分档（GB）。阈值与明细表的低空间预警规则保持一致。 */
/* 第四项是对应的结构化筛选值，与 common.js 的 FILTER_SPECS.disk 对齐 */
const DISK_BUCKETS = [
  ["< 2 GB（严重）",  v => v < 2,             "var(--ramp-5)", "lt2"],
  ["2-20 GB（预警）", v => v >= 2 && v < 20,  "var(--ramp-3)", "2-20"],
  ["20-50 GB",        v => v >= 20 && v < 50, "var(--ramp-2)", "20-50"],
  ["50-100 GB",       v => v >= 50 && v < 100,"var(--chart-2)", "50-100"],
  ["≥ 100 GB",        v => v >= 100,          "var(--chart-1)", "ge100"]
];
const DISK_THRESHOLDS = [2,5,20,50];
let diskThreshold = 20;

/* 第三项是对应的结构化筛选值，与 common.js 的 FILTER_SPECS.activity 对齐 */
const BUCKETS = [
  ["3 小时内",  a => a < ACTIVE_WINDOW_DAYS,                 "3h"],
  ["3-24 小时", a => a >= ACTIVE_WINDOW_DAYS && a < 1,       "3h-24h"],
  ["1-3 天",    a => a >= 1 && a < 3,   "1-3d"],
  ["4-7 天",    a => a >= 3 && a < 7,   "4-7d"],
  ["8-30 天",   a => a >= 7 && a < 30,  "8-30d"],
  ["30 天以上", a => a >= 30,           "ge30d"]
];

/* ---------- helpers ---------- */

function pct(value,total){return total?`${(value/total*100).toFixed(1)}%`:"0%"}

/* ageDays() 与 formFactor() 已移到 common.js，明细表筛选与看板共用同一口径 */

/* normalizeVendor() and osGroup() live in common.js so the table page and the
   dashboard always report the same vendor / OS numbers. */

function shortenModel(v){
  const s=safe(v);
  return s.replace(/^HP\s+/i,"").replace(/\s*(PCI\s+)?(Notebook|Desktop|Microtower)\s*PC\s*$/i,"").trim()||s;
}

function versionParts(v){return safe(v).split(".").map(p=>parseInt(p,10)||0)}
function compareVersion(a,b){
  const x=versionParts(a),y=versionParts(b);
  for(let i=0;i<Math.max(x.length,y.length);i++){
    const d=(x[i]||0)-(y[i]||0);
    if(d)return d;
  }
  return 0;
}

function countBy(rows,fn){
  const map=new Map();
  rows.forEach(d=>{
    const key=fn(d)||"未知";
    map.set(key,(map.get(key)||0)+1);
  });
  return [...map].map(([label,value])=>({label,value}));
}

function byCountDesc(items){return [...items].sort((a,b)=>b.value-a.value)}

/* ---------- chart renderers ---------- */

function tipText(label,value,total){
  return total?`${label} · ${value} 台 · ${pct(value,total)}`:`${label} · ${value} 台`;
}

function donutChart(items,options={}){
  const total=items.reduce((s,i)=>s+i.value,0);
  if(!total)return '<p class="chart-placeholder">暂无数据</p>';

  const size=172,c=size/2,r=66,circ=2*Math.PI*r;
  let offset=0;

  const segments=items.map((it,i)=>{
    const color=it.color||PALETTE[i%PALETTE.length];
    const len=it.value/total*circ;
    const seg=`<circle class="donut-seg" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="24"`
      +` stroke-dasharray="${len.toFixed(2)} ${(circ-len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"`
      +` data-tip="${escapeHtml(tipText(it.label,it.value,total))}" data-query="${escapeHtml(it.query||"")}"></circle>`;
    offset+=len;
    return seg;
  }).join("");

  const legend=items.map((it,i)=>{
    const color=it.color||PALETTE[i%PALETTE.length];
    return `<div class="legend-row${it.query?"":" static"}" data-tip="${escapeHtml(tipText(it.label,it.value,total))}" data-query="${escapeHtml(it.query||"")}">`
      +`<span class="legend-dot" style="background:${color}"></span>`
      +`<span class="legend-label" title="${escapeHtml(it.label)}">${escapeHtml(it.label)}</span>`
      +`<span class="legend-value">${it.value} 台</span>`
      +`<span class="legend-pct">${pct(it.value,total)}</span></div>`;
  }).join("");

  return `<div class="donut-wrap">`
    +`<svg class="donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHtml(options.aria||"分布图")}">`
    +`<g transform="rotate(-90 ${c} ${c})">${segments}</g>`
    +`<text class="donut-center-value" x="${c}" y="${c-1}" text-anchor="middle">${total}</text>`
    +`<text class="donut-center-label" x="${c}" y="${c+17}" text-anchor="middle">${escapeHtml(options.centerLabel||"台设备")}</text>`
    +`</svg><div class="donut-legend">${legend}</div></div>`;
}

function barChart(items,options={}){
  if(!items.length)return '<p class="chart-placeholder">暂无数据</p>';
  const total=options.total||items.reduce((s,i)=>s+i.value,0);

  const summary=options.summary?`<div class="bar-summary">${options.summary}</div>`:"";

  const rows=items.map((it,i)=>{
    const color=it.color||PALETTE[i%PALETTE.length];
    const width=total?(it.value/total*100).toFixed(1):"0";
    return `<div class="bar-row${it.query?"":" static"}" data-tip="${escapeHtml(tipText(it.label,it.value,total))}" data-query="${escapeHtml(it.query||"")}">`
      +`<span class="bar-label" title="${escapeHtml(it.label)}">${escapeHtml(it.label)}</span>`
      +`<span class="bar-value">${it.value} · ${pct(it.value,total)}</span>`
      +`<span class="bar-track"><span class="bar-fill" style="width:${width}%;background:${color}"></span></span></div>`;
  }).join("");

  return `<div class="bar-list">${summary}${rows}</div>`;
}

/* ---------- C 盘空间（Agent v1.3.0） ---------- */

function renderDiskCharts(){
  const total=devices.length;
  const chartDisk=$("chartDisk");
  if(!chartDisk)return;
  /* 旧 Agent 没有 c_drive_* 字段 → 单独归到“无数据”，不参与分档 */
  const reported=devices.filter(d=>toGbNumber(d.c_drive_free_gb)!==null);
  const unknown=total-reported.length;
  const lowCount=reported.filter(d=>toGbNumber(d.c_drive_free_gb)<LOW_DISK_GB).length;

  const items=DISK_BUCKETS.map(([label,test,color,key])=>({
    label,color,
    value:reported.filter(d=>test(toGbNumber(d.c_drive_free_gb))).length,
    query:`filter=disk:${key}`
  })).filter(it=>it.value>0);
  if(unknown)items.push({label:"无数据（旧 Agent）",value:unknown,color:"var(--chart-8)",query:"filter=disk:unknown"});

  chartDisk.innerHTML=barChart(items,{
    total,
    summary:`<span>已上报磁盘 <strong>${reported.length}</strong> 台</span>`
      +`<span>低于 ${LOW_DISK_GB} GB <strong>${lowCount}</strong> 台</span>`
  });
  renderDiskAlert();
}

function renderDiskAlert(){
  const total=devices.length;
  const rows=devices
    .map(d=>({name:safe(d.computer_name).trim()||safe(d.serial_number).trim()||"未知设备",
              email:safe(d.outlook_account).trim(),
              free:toGbNumber(d.c_drive_free_gb),
              capacity:toGbNumber(d.c_drive_total_gb)}))
    .filter(r=>r.free!==null&&r.free<diskThreshold)
    .sort((a,b)=>a.free-b.free);

  const note=$("diskAlertNote");
  if(note){
    note.textContent=`剩余 < ${diskThreshold} GB · ${rows.length} 台 · 占比 ${pct(rows.length,total)}`;
    note.classList.toggle("alert",rows.length>0);
  }

  const emails=rows.map(r=>r.email).filter(Boolean);
  const chips=DISK_THRESHOLDS.map(t=>
    `<button class="disk-chip${t===diskThreshold?" active":""}" type="button" data-threshold="${t}">&lt; ${t} GB</button>`
  ).join("");
  /* 复制按钮：把当前列表里所有非空 Outlook 邮箱一次写入剪贴板。
     分隔符用分号（Outlook / 多数邮件客户端的收件人分隔符），可直接粘贴到收件人栏。 */
  const copyBtn=emails.length
    ? `<button class="disk-copy-btn" type="button" title="以分号分隔复制，可直接粘贴到邮件收件人栏" data-emails="${escapeHtml(emails.join("|"))}">📋 复制邮箱 (${emails.length})</button>`
    : `<span class="disk-filter-hint">列表内暂无可复制邮箱</span>`;
  const filter=`<div class="disk-filter"><span class="disk-filter-label">预警阈值</span>${chips}${copyBtn}</div>`;

  const target=$("chartDiskAlert");
  if(!target)return;
  if(!rows.length){
    target.innerHTML=`<div class="disk-alert">${filter}`
      +`<p class="disk-empty">没有设备剩余空间低于 ${diskThreshold} GB</p></div>`;
  }else{
    const list=rows.map(r=>{
      const usedPct=r.capacity?Math.min(100,Math.max(0,(r.capacity-r.free)/r.capacity*100)):null;
      const emailTxt=r.email||"—";
      const tip=`${r.name} · ${r.email||"未登记邮箱"} · 剩余 ${formatGb(r.free)} GB / ${formatGb(r.capacity)} GB`
        +(usedPct===null?"":` · 已用 ${usedPct.toFixed(1)}%`);
      return `<div class="disk-row" data-query="${escapeHtml(r.name)}" data-tip="${escapeHtml(tip)}">`
        +`<span class="disk-row-name">${escapeHtml(r.name)}</span>`
        +`<span class="disk-row-email${r.email?"":" empty"}">${escapeHtml(emailTxt)}</span>`
        +`<span class="disk-row-space low">${escapeHtml(formatDrive(r.free,r.capacity))}</span>`
        +`<span class="bar-track">${usedPct===null?"":`<span class="bar-fill" style="width:${usedPct.toFixed(1)}%;background:var(--ramp-5)"></span>`}</span>`
        +`</div>`;
    }).join("");
    target.innerHTML=`<div class="disk-alert">${filter}`
      +`<div class="bar-summary"><span>剩余空间最少优先</span><span>共 <strong>${rows.length}</strong> 台低于 ${diskThreshold} GB</span></div>`
      +`<div class="disk-list">${list}</div></div>`;
  }

  target.querySelectorAll(".disk-chip").forEach(btn=>{
    btn.addEventListener("click",()=>{
      diskThreshold=Number(btn.dataset.threshold);
      renderDiskAlert();
    });
  });

  const copy=target.querySelector(".disk-copy-btn");
  if(copy){
    copy.addEventListener("click",async()=>{
      const list=(copy.dataset.emails||"").split("|").filter(Boolean);
      const reset=()=>{copy.classList.remove("copied");copy.textContent=`📋 复制邮箱 (${list.length})`};
      if(!list.length){return}
      try{
        await navigator.clipboard.writeText(list.join(";"));
        copy.classList.add("copied");
        copy.textContent=`✓ 已复制 ${list.length} 个邮箱`;
      }catch(e){
        copy.textContent="复制失败，请检查浏览器权限";
      }
      setTimeout(reset,1800);
    });
  }
}

/* ---------- KPI ---------- */

function setNote(id,text,tone){
  const el=$(id);
  if(!el)return;
  el.textContent=text;
  el.classList.remove("alert","good");
  if(tone)el.classList.add(tone);
}

function updateKpis(){
  const total=devices.length;
  /* 24 小时内上报：与明细表「24h 内上报」统计卡同一口径（reportedWithinDay） */
  const recent24=devices.filter(d=>reportedWithinDay(d.report_time)).length;
  const vpn=devices.filter(d=>{const a=ageDays(d.forticlient_last_seen);return a!==null&&a<1}).length;
  const win11=devices.filter(d=>osGroup(d.os_name)==="Windows 11").length;
  const win10=devices.filter(d=>osGroup(d.os_name)==="Windows 10").length;
  /* 7 天未上报：a >= 7 天；上报时间未知（null）也按未上报计入，与旧口径一致 */
  const stale=devices.filter(d=>{const a=ageDays(d.report_time);return a===null||a>=7}).length;

  $("kpiTotal").textContent=total;
  const elRecent24=$("kpiRecent24");
  if(elRecent24)elRecent24.textContent=recent24;
  setNote("kpiRecent24Note",`占比 ${pct(recent24,total)}`,recent24/total>=0.6?"good":null);
  $("kpiVpn").textContent=vpn;
  setNote("kpiVpnNote",`占比 ${pct(vpn,total)}`,null);
  $("kpiWin11").textContent=win11;
  setNote("kpiWin11Note",`占比 ${pct(win11,total)}`,win11/total>=0.9?"good":null);
  $("kpiWin10").textContent=win10;
  setNote("kpiWin10Note",`占比 ${pct(win10,total)} · 建议迁移到 Windows 11`,win10>0?"alert":"good");
  $("kpiStale").textContent=stale;
  setNote("kpiStaleNote",`占比 ${pct(stale,total)}`,stale?"alert":"good");
}

/* ---------- render ---------- */

function renderCharts(){
  const total=devices.length;

  const os=byCountDesc(countBy(devices,d=>osGroup(d.os_name))).map(it=>({...it,query:`q=${it.label}`}));
  $("chartOs").innerHTML=donutChart(os,{aria:"操作系统版本分布",centerLabel:"台设备"});

  const activity=BUCKETS.map(([label,test,key],i)=>({
    label,
    value:devices.filter(d=>{const a=ageDays(d.report_time);return a!==null&&test(a)}).length,
    color:RAMP[i],
    query:`filter=activity:${key}`
  })).filter(it=>it.value>0);
  const unknownAge=devices.filter(d=>ageDays(d.report_time)===null).length;
  if(unknownAge)activity.push({label:"时间未知",value:unknownAge,color:PALETTE[5],query:"filter=activity:unknown"});
  $("chartActivity").innerHTML=barChart(activity,{total});

  const vpnAccount=devices.filter(d=>safe(d.forticlient_user).trim()).length;
  const vpnRecent=devices.filter(d=>{const a=ageDays(d.forticlient_last_seen);return a!==null&&a<1}).length;
  const vpnIdle=Math.max(0,vpnAccount-vpnRecent);
  $("chartVpn").innerHTML=donutChart([
    {label:"24h 内有连接",value:vpnRecent,color:"var(--chart-2)",query:"filter=vpn:recent"},
    {label:"有账号但超 24h",value:vpnIdle,color:"var(--chart-3)",query:"filter=vpn:idle"},
    {label:"未接入 VPN",value:Math.max(0,total-vpnAccount),color:"var(--chart-4)",query:"filter=vpn:none"}
  ],{aria:"VPN 接入状态分布",centerLabel:"台设备"});

  const vendors=byCountDesc(countBy(devices,d=>normalizeVendor(d.manufacturer))).map(it=>({...it,query:`q=${it.label}`}));
  $("chartVendor").innerHTML=donutChart(vendors,{aria:"厂商分布",centerLabel:"台设备"});

  const forms=byCountDesc(countBy(devices,d=>formFactor(d.model))).map(it=>({...it,query:`filter=form:${it.label}`}));
  $("chartForm").innerHTML=donutChart(forms,{aria:"设备形态分布",centerLabel:"台设备"});

  const bound=devices.filter(d=>safe(d.outlook_account).trim()).length;
  $("chartOutlook").innerHTML=donutChart([
    {label:"已绑定邮箱",value:bound,color:"var(--chart-6)",query:"filter=outlook:bound"},
    {label:"未绑定邮箱",value:total-bound,color:"var(--chart-3)",query:"filter=outlook:unbound"}
  ],{aria:"Outlook 账号绑定分布",centerLabel:"台设备"});

  const versions=byCountDesc(countBy(devices,d=>safe(d.script_version).trim()||"未知"))
    .sort((a,b)=>compareVersion(b.label,a.label))
    .map((it,i)=>({...it,color:i===0?"var(--chart-2)":"var(--chart-3)",query:`q=${it.label}`}));
  $("chartAgent").innerHTML=barChart(versions,{total});

  renderDiskCharts();

  const models=byCountDesc(countBy(devices,d=>safe(d.model).trim()||"未知"));
  const topN=models.slice(0,10);
  const topSum=topN.reduce((s,i)=>s+i.value,0);
  const modelSummary=`Top ${topN.length} 合计 <strong>${topSum} 台</strong> · 占 <strong>${pct(topSum,total)}</strong>`;
  $("chartModel").innerHTML=barChart(
    topN.map(it=>({...it,label:shortenModel(it.label),query:`q=${it.label}`})),
    {total,summary:modelSummary}
  );
}

function renderError(message){
  ["chartOs","chartActivity","chartVpn","chartVendor","chartForm","chartOutlook","chartAgent","chartDisk","chartDiskAlert","chartModel"]
    .forEach(id=>{const el=$(id);if(el)el.innerHTML=`<p class="chart-placeholder">${escapeHtml(message)}</p>`});
  ["kpiTotal","kpiRecent24","kpiVpn","kpiWin11","kpiWin10","kpiStale"].forEach(id=>{const el=$(id);if(el)el.textContent="—"});
  const note=$("diskAlertNote");
  if(note){note.textContent="剩余空间低于阈值";note.classList.remove("alert")}
}

/* ---------- data ---------- */

async function loadDevices(){
  setStatus("正在读取数据");
  try{
    const res=await fetch(API_URL,{cache:"no-store"});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const data=await res.json();
    if(!Array.isArray(data))throw new Error("API 返回格式不是数组");
    devices=data;
    if(!devices.length){
      renderError("接口返回 0 条设备记录");
    }else{
      updateKpis();
      renderCharts();
    }
    setStatusUploadTime(devices);            /* 右上角展示最近一次上报时间 */
    $("lastUpdated").textContent="页面刷新时间："+new Date().toLocaleString();
  }catch(e){
    console.error(e);
    devices=[];
    renderError("无法读取设备数据，请检查 Worker / CORS / API 地址。");
    setStatus("读取失败","err","无法读取设备数据，请检查 Worker / CORS / API 地址");
    $("lastUpdated").textContent="读取失败，未更新数据";
  }
}

/* ---------- tooltip + drill-down ---------- */

function initTooltip(){
  const tip=$("chartTip");
  const hide=()=>{tip.classList.remove("visible");tip.setAttribute("aria-hidden","true")};
  document.addEventListener("mouseover",e=>{
    const target=e.target.closest("[data-tip]");
    if(!target)return;
    tip.textContent=target.dataset.tip;
    tip.classList.add("visible");
    tip.setAttribute("aria-hidden","false");
  });
  document.addEventListener("mousemove",e=>{
    if(!tip.classList.contains("visible"))return;
    tip.style.left=`${e.clientX}px`;
    tip.style.top=`${e.clientY-12}px`;
  });
  document.addEventListener("mouseout",e=>{if(e.target.closest("[data-tip]"))hide()});
  window.addEventListener("scroll",hide,{passive:true});
}

function initDrilldown(){
  document.addEventListener("click",e=>{
    const target=e.target.closest("[data-query]");
    const query=target&&target.dataset.query;
    if(!query)return;
    /* data-query 两种形态：
       "filter=activity:3h" → 结构化筛选（活跃度 / VPN / 形态 / 邮箱 / 磁盘分档）
       "Windows 11" 等裸关键词 → 普通关键字搜索 */
    const m=query.match(/^(q|filter)=(.*)$/);
    location.href=m
      ? `index.html?${m[1]}=${encodeURIComponent(m[2])}`
      : `index.html?q=${encodeURIComponent(query)}`;
  });
}

document.addEventListener("DOMContentLoaded",()=>{
  initTheme();
  initTooltip();
  initDrilldown();
  $("refreshBtn").addEventListener("click",loadDevices);
  loadDevices();
});
