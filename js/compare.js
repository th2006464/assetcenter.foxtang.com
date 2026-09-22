/* 脚本覆盖对比页：上传「全量标准表」+「资产上报导出」，抓出没装 auto 脚本的计算机名。
   依赖 js/common.js（$ / escapeHtml / safe / isAutoReport / initTheme）。 */

const VERDICT = {
  ok:      { text: "已装 auto",   cls: "ok" },
  missing: { text: "从未上报",    cls: "missing" },
  nonauto: { text: "未装 auto",   cls: "nonauto" }
};
/* 排序时的优先级：越需要跟进的排越前 */
const VERDICT_RANK = { missing: 0, nonauto: 1, ok: 2 };

/* 处理建议：在线未装 → 现在就能推；离线未装 → 等上线再推 */
const SUGGEST = {
  now:   { text: "可立即推送", cls: "now" },
  later: { text: "待上线推送", cls: "later" },
  ok:    { text: "无需处理",   cls: "done" }
};
const SUGGEST_RANK = { now: 0, later: 1, ok: 2 };

const state = {
  loaded: { std: null, ac: null },   /* {name, rows, kind} */
  stdRows: [], acRows: [],
  stdHasAutoCol: false, stdAutoColName: "",
  source: "", disagree: 0, crossChecked: 0,
  results: [],
  tab: "fail", q: "",
  sortKey: "cn", sortAsc: true
};

/* ---------- 文件读取：UTF-8 优先，出现替换字符时回退 GBK ---------- */
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

/* ---------- CSV 解析：支持引号包裹、字段内逗号/换行、CRLF ---------- */
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

/* ---------- 类型识别：按表头判断是标准表还是资产表 ---------- */
function detectKind(rows) {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const cells = (rows[i] || []).map(c => safe(c).trim().toLowerCase());
    if (!cells.length) continue;
    const joined = cells.join("|");
    /* 先判资产表：英文列名。向日葵标准表里没有 ComputerName / ScriptVersion */
    if (joined.includes("scriptversion") || joined.includes("computername")) return { kind: "ac", headerAt: i };
    if (joined.includes("计算机名") || joined.includes("设备名称")) return { kind: "std", headerAt: i };
  }
  return null;
}

function colOf(header, names) {
  for (const n of names) {
    const i = header.findIndex(h => safe(h).trim() === n);
    if (i >= 0) return i;
  }
  return -1;
}
function cell(row, i) { return i >= 0 ? safe(row[i]).trim() : ""; }

/* 标准表：表头行可能不在第一行（前面有「须知」说明） */
function parseStd(rows, headerAt) {
  const header = rows[headerAt].map(c => safe(c).trim());
  const iCn = colOf(header, ["计算机名"]);
  const iDev = colOf(header, ["设备名称"]);
  const iStatus = colOf(header, ["状态"]);
  const iGroup = colOf(header, ["分组"]);
  const iOs = colOf(header, ["系统版本"]);
  const iLast = colOf(header, ["最后在线时间"]);
  /* 新版向日葵导出自带「自动化脚本已配置」列 —— 这是权威判定源，优先用它 */
  const iAuto = colOf(header, ["自动化脚本已配置", "自动化脚本版本", "脚本版本"]);
  const out = [];
  for (let i = headerAt + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => !safe(c).trim())) continue;
    const cn = cell(r, iCn);
    if (!cn || cn === "-") continue;
    const autoCfg = iAuto >= 0 ? cell(r, iAuto) : "";
    out.push({
      cn, dev: cell(r, iDev), status: cell(r, iStatus), group: cell(r, iGroup),
      os: cell(r, iOs), last: cell(r, iLast),
      /* #N/A / 空 视为「未配置」 */
      autoCfg: (autoCfg && autoCfg.toUpperCase() !== "#N/A") ? autoCfg : ""
    });
  }
  return { rows: out, hasAutoCol: iAuto >= 0, autoColName: iAuto >= 0 ? header[iAuto] : "" };
}

function parseAc(rows, headerAt) {
  const header = rows[headerAt].map(c => safe(c).trim());
  const iCn = colOf(header, ["ComputerName"]);
  const iSv = colOf(header, ["ScriptVersion"]);
  const iOs = colOf(header, ["OSName"]);
  const iRt = colOf(header, ["ReportTime"]);
  const out = [];
  for (let i = headerAt + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => !safe(c).trim())) continue;
    const cn = cell(r, iCn);
    if (!cn) continue;
    out.push({ cn, script: cell(r, iSv), os: cell(r, iOs), report: cell(r, iRt) });
  }
  return out;
}

/* ---------- 提示 / 标签 ---------- */
function showMsg(text, type) {
  const box = $("msgBox"), el = $("msgText");
  if (!box || !el) return;
  el.className = "alert-box " + (type || "info");
  el.innerHTML = text;
  box.hidden = false;
}
function hideMsg() { const b = $("msgBox"); if (b) b.hidden = true; }

function setSlot(slot, name, tagText, warn) {
  const nameEl = $("name" + (slot === "std" ? "Std" : "Ac"));
  const tagEl = $("tag" + (slot === "std" ? "Std" : "Ac"));
  const dzEl = $("dz" + (slot === "std" ? "Std" : "Ac"));
  if (nameEl) nameEl.textContent = name || "";
  if (tagEl) { tagEl.textContent = tagText || ""; tagEl.hidden = !tagText; tagEl.className = "dz-tag" + (warn ? " warn" : ""); }
  if (dzEl) { dzEl.classList.toggle("filled", !!name); dzEl.classList.toggle("err", !!warn); }
}

/* 让文件名匹配上能显示「解析到 N 行」反馈，避免「上传完没动静」的疑惑 */
function setSlotCount(slot, n) {
  const el = $("cnt" + (slot === "std" ? "Std" : "Ac"));
  if (!el) return;
  el.textContent = n > 0 ? ` · 解析 ${n} 行` : "";
  el.hidden = n <= 0;
}

/* 暴露一个全局钩子，方便排查：把内部状态写到 window.stateDebug 上 */
function dumpDebug(reason) {
  if (typeof window === "undefined") return;
  window.stateDebug = { reason, loaded: state.loaded, stdRows: state.stdRows.length, acRows: state.acRows.length, results: state.results.length };
}

/* ---------- 载入并自动归位 ---------- */
async function handleFile(file, slot) {
  if (!file) return;
  let rows;
  try {
    rows = parseCsv(await readFileText(file));
  } catch (e) {
    showMsg("读取失败：" + escapeHtml(safe(e && e.message)) , "err");
    return;
  }
  const det = detectKind(rows);
  if (!det) {
    setSlot(slot, file.name, "无法识别表头", true);
    showMsg(`<b>${escapeHtml(file.name)}</b> 没找到可识别的表头：标准表需要「计算机名」列，资产表需要 <code>ComputerName</code> / <code>ScriptVersion</code> 列。请确认文件内容。`, "err");
    state.loaded[slot] = null;
    return;
  }
  state.loaded[slot] = { name: file.name, rows, kind: det.kind };
  setSlot(slot, file.name, det.kind === "std" ? "标准设备表" : "资产上报导出", false);
  tryFinalize();
}

function tryFinalize() {
  /* 按识别结果取，不按槽位 —— 放反了也能跑 */
  const files = [state.loaded.std, state.loaded.ac].filter(Boolean);
  if (!files.length) { dumpDebug("no file"); return; }

  const stdSrc = files.find(f => f.kind === "std");
  const acSrc = files.find(f => f.kind === "ac");

  if (!stdSrc) {
    if (files.length === 2) {
      showMsg("两份文件都识别为「资产上报导出」，缺少<b>标准设备表</b>（向日葵导出）。", "err");
      dumpDebug("no std");
    }
    return;
  }

  try {
    /* 归位显示（只在真的放反时提示） */
    const stdSlotHoldsStd = state.loaded.std && state.loaded.std.kind === "std";
    if (!stdSlotHoldsStd) {
      setSlot("std", stdSrc.name, "标准设备表（已自动归位）", false);
      if (acSrc) setSlot("ac", acSrc.name, "资产上报导出（已自动归位）", false);
    }

    const stdParsed = parseStd(stdSrc.rows, detectKind(stdSrc.rows).headerAt);
    state.stdRows = stdParsed.rows;
    state.stdHasAutoCol = stdParsed.hasAutoCol;
    state.stdAutoColName = stdParsed.autoColName;
    setSlotCount("std", state.stdRows.length);

    if (!state.stdRows.length) {
      showMsg("标准表解析到的有效行为 0，请确认文件含「计算机名」列且内容完整。", "err");
      dumpDebug("std empty"); return;
    }

    /* 标准表自带「自动化脚本已配置」列时，它是权威源，不强制要资产表；
       老版本导出没有这列，才需要用资产上报 CSV 比对。 */
    if (!state.stdHasAutoCol && !acSrc) {
      showMsg("这份标准表<b>没有</b>「自动化脚本已配置」列，请在右侧再上传一份资产上报导出 CSV 用于比对。", "info");
      dumpDebug("need ac"); return;
    }

    if (acSrc) {
      state.acRows = parseAc(acSrc.rows, detectKind(acSrc.rows).headerAt);
      setSlotCount("ac", state.acRows.length);
      if (!state.acRows.length) {
        showMsg("资产表解析到的有效行为 0，请确认文件含 ComputerName / ScriptVersion 列且内容完整。", "err");
        dumpDebug("ac empty"); return;
      }
    } else {
      state.acRows = [];
      setSlotCount("ac", 0);
    }

    hideMsg();
    compare();
    $("guideBox").hidden = true;
    $("statGrid").hidden = false;
    $("resultPanel").hidden = false;
    render();
    dumpDebug("ok");
  } catch (e) {
    console.error(e);
    showMsg("对比过程出错：" + escapeHtml(safe(e && e.message || String(e))) + "。请打开浏览器控制台（F12）截图反馈。", "err");
    dumpDebug("threw: " + (e && e.message));
  }
}

/* 完全清空：回到「刚打开」状态 */
function resetAll(){
  state.loaded = { std: null, ac: null };
  state.stdRows = []; state.acRows = []; state.results = []; state.extra = 0;
  state.tab = "fail"; state.q = ""; state.sortKey = "cn"; state.sortAsc = true;
  ["std","ac"].forEach(slot => {
    setSlot(slot, "", "", false);
    setSlotCount(slot, 0);
    const input = $("file" + (slot === "std" ? "Std" : "Ac"));
    if (input) input.value = "";
  });
  $("guideBox").hidden = false;
  $("statGrid").hidden = true;
  $("resultPanel").hidden = true;
  hideMsg();
  dumpDebug("reset");
}

/* ---------- 比对 ---------- */
function compare() {
  /* 资产表按计算机名建索引（不区分大小写）。
     同一计算机名可能有多条记录 —— 实测存在「两台不同序列号机器用了同一个计算机名」的情况，
     此时按**最近一次上报**取，不能按文件先后顺序取（那纯属偶然）。 */
  const map = new Map();
  const all = new Map();          /* 同名记录的全部脚本版本，用于提示重名 */
  state.acRows.forEach(d => {
    const k = d.cn.toUpperCase();
    if (!all.has(k)) all.set(k, []);
    all.get(k).push(d.script || "—");
    const prev = map.get(k);
    if (!prev) { map.set(k, d); return; }
    const t = parseDate(d.report), pt = parseDate(prev.report);
    if ((t ? t.getTime() : -Infinity) > (pt ? pt.getTime() : -Infinity)) map.set(k, d);
  });

  /* 判定源：标准表自带「自动化脚本已配置」列时以它为准（向日葵是权威源），
     否则退回用资产上报的 ScriptVersion 匹配。 */
  const useStdCol = state.stdHasAutoCol;
  state.source = useStdCol
    ? `向日葵导出「${state.stdAutoColName}」列`
    : "资产上报 ScriptVersion（按计算机名匹配）";

  let disagree = 0, crossChecked = 0;
  state.results = state.stdRows.map(s => {
    const k = s.cn.toUpperCase();
    const hit = map.get(k);
    const versions = all.get(k) || [];
    const uniqueV = Array.from(new Set(versions));
    const dup = versions.length > 1;

    let verdict, script;
    if (useStdCol) {
      script = s.autoCfg || "";
      verdict = isAutoReport(script) ? "ok" : "nonauto";
      /* 资产表也有这台机时顺带交叉核对，不一致计数（仍以向日葵为准） */
      if (hit) {
        crossChecked++;
        const acVerdict = isAutoReport(hit.script) ? "ok" : "nonauto";
        if (acVerdict !== verdict) disagree++;
      }
    } else if (hit) {
      script = hit.script;
      verdict = isAutoReport(script) ? "ok" : "nonauto";
    } else {
      script = "";
      verdict = "missing";
    }

    /* 在线状态来自向日葵；离线设备现在推不了，要等上线 */
    const online = /在线/.test(safe(s.status)) && !/离线/.test(safe(s.status));
    const suggestion = verdict === "ok" ? "ok"
      : (online ? "now" : "later");
    return Object.assign({}, s, {
      script, verdict, dup, versions: uniqueV, online, suggestion
    });
  });

  state.disagree = disagree;
  state.crossChecked = crossChecked;

  /* 只在资产表出现、标准表没有的设备 —— 不纳入比对，仅提示 */
  const stdKeys = new Set(state.stdRows.map(s => s.cn.toUpperCase()));
  state.extra = state.acRows.filter(d => !stdKeys.has(d.cn.toUpperCase())).length;
}

/* ---------- 渲染 ---------- */
function counts() {
  const c = { all: state.results.length, ok: 0, missing: 0, nonauto: 0, fail: 0, now: 0, later: 0 };
  state.results.forEach(r => {
    c[r.verdict]++;
    if (r.suggestion === "now") c.now++;
    if (r.suggestion === "later") c.later++;
  });
  c.fail = c.missing + c.nonauto;
  return c;
}

function pct(n, total) { return total ? (n / total * 100).toFixed(1) + "%" : "—"; }

function renderStats() {
  const c = counts();
  $("stTotal").textContent = c.all;
  $("stOk").textContent = c.ok;
  $("stOkNote").textContent = "占比 " + pct(c.ok, c.all);
  $("stFail").textContent = c.fail;
  $("stFailNote").textContent = "占比 " + pct(c.fail, c.all) + " · 需要推送";
  $("stNow").textContent = c.now;
  $("stNowNote").textContent = "在线，现在就能推";
  $("stLater").textContent = c.later;
  $("stLaterNote").textContent = "离线，等上线再推";
  $("nFail").textContent = c.fail;
  $("nNow").textContent = c.now;
  $("nLater").textContent = c.later;
  $("nOk").textContent = c.ok;
  $("nAll").textContent = c.all;
}

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  let rows = state.results.filter(r => {
    switch (state.tab) {
      case "all":    return true;
      case "fail":   return r.verdict !== "ok";
      case "now":    return r.suggestion === "now";
      case "later":  return r.suggestion === "later";
      case "ok":     return r.verdict === "ok";
      case "missing": return r.verdict === "missing";
      case "nonauto": return r.verdict === "nonauto";
      default: return true;
    }
  });
  if (q) {
    rows = rows.filter(r =>
      [r.cn, r.dev, r.group, r.status, r.os, r.script].some(v => safe(v).toLowerCase().includes(q)));
  }
  rows.sort((a, b) => {
    let av, bv;
    if (state.sortKey === "verdict") { av = VERDICT_RANK[a.verdict]; bv = VERDICT_RANK[b.verdict]; }
    else if (state.sortKey === "suggestion") { av = SUGGEST_RANK[a.suggestion]; bv = SUGGEST_RANK[b.suggestion]; }
    else if (state.sortKey === "online") { av = a.online ? 0 : 1; bv = b.online ? 0 : 1; }
    else { av = safe(a[state.sortKey]).toLowerCase(); bv = safe(b[state.sortKey]).toLowerCase(); }
    if (av < bv) return state.sortAsc ? -1 : 1;
    if (av > bv) return state.sortAsc ? 1 : -1;
    return 0;
  });
  return rows;
}

function renderTable() {
  const rows = visibleRows(), body = $("resultBody");
  $("resultCount").textContent = rows.length === 0 ? "0 台设备"
    : (rows.length === state.results.length ? `共 ${rows.length} 台设备`
      : `共 ${rows.length} 台设备（总 ${state.results.length}）`);

  /* 底部说明：判定依据 + 交叉核对结果 + 资产表多出来的设备 */
  const notes = [`判定依据：${escapeHtml(state.source)}`];
  if (state.disagree > 0) {
    notes.push(`向日葵与资产表判定不一致 ${state.disagree} 台（共交叉核对 ${state.crossChecked} 台），已以向日葵为准`);
  }
  if (state.extra) notes.push(`另有 ${state.extra} 台只在资产表中、不在标准表内，未纳入比对`);
  $("extraNote").innerHTML = notes.join(" · ");

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="9" class="empty-state">没有匹配的设备</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => {
    const v = VERDICT[r.verdict];
    const sg = SUGGEST[r.suggestion];
    const scriptCls = !r.script ? "none" : (r.verdict === "nonauto" ? "bad" : "");
    const scriptText = r.script ? escapeHtml(r.script) : "未配置";
    /* 在线/离线：离线设备现在推不了，是「待上线推送」的关键依据 */
    const stCls = r.online ? "online" : "offline";
    /* 同名多台机器：把其它版本放到 title 里，并在版本号旁挂个角标 */
    const dupFlag = r.dup
      ? ` <span class="dup-flag" title="该计算机名在资产表里有 ${r.versions.length} 个不同脚本版本（${escapeHtml(r.versions.join(" / "))}），已按最近一次上报取值">重名${r.versions.length}</span>`
      : "";
    return `<tr>
      <td class="mono"><strong>${escapeHtml(r.cn)}</strong>${dupFlag}</td>
      <td>${escapeHtml(r.dev || "—")}</td>
      <td><span class="status-pill ${stCls}">${escapeHtml(r.status || "—")}</span></td>
      <td>${escapeHtml(r.group || "—")}</td>
      <td>${escapeHtml(r.os || "—")}</td>
      <td>${escapeHtml(r.last || "—")}</td>
      <td class="script-cell ${scriptCls}">${scriptText}</td>
      <td><span class="verdict ${v.cls}">${v.text}</span></td>
      <td><span class="suggest ${sg.cls}">${sg.text}</span></td>
    </tr>`;
  }).join("");
}

function render() {
  renderStats();
  renderTable();
  document.querySelectorAll("#tabs .tab").forEach(t =>
    t.classList.toggle("active", t.dataset.tab === state.tab));
  document.querySelectorAll("#compareTable th[data-key]").forEach(th =>
    th.classList.toggle("sorted", th.dataset.key === state.sortKey));
}

/* ---------- 导出 / 复制 ---------- */
function exportCsv() {
  const rows = visibleRows();
  const head = ["计算机名", "设备名称", "状态", "分组", "系统版本", "最后在线时间", "脚本版本", "判定"];
  const esc = v => `"${safe(v).replaceAll('"', '""')}"`;
  const csv = [head.map(esc).join(",")]
    .concat(rows.map(r => [r.cn, r.dev, r.status, r.group, r.os, r.last, r.script, VERDICT[r.verdict].text].map(esc).join(",")))
    .join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url;
  a.download = `未装auto脚本-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

async function copyNames() {
  const rows = visibleRows().filter(r => r.verdict !== "ok");
  const names = rows.map(r => r.cn);
  const btn = $("copyBtn");
  const label = btn ? btn.textContent : "";
  const done = (ok, n) => {
    if (!btn) return;
    btn.textContent = ok ? `✓ 已复制 ${n} 个` : "复制失败";
    setTimeout(() => { btn.textContent = label; }, 1800);
  };
  if (!names.length) { done(false, 0); return; }
  try {
    await navigator.clipboard.writeText(names.join("\n"));
    done(true, names.length);
  } catch (e) {
    done(false, 0);
  }
}

/* ---------- 事件绑定 ---------- */
document.addEventListener("DOMContentLoaded", () => {
  initTheme();

  ["std", "ac"].forEach(slot => {
    const input = $("file" + (slot === "std" ? "Std" : "Ac"));
    const dz = $("dz" + (slot === "std" ? "Std" : "Ac"));
    if (input) input.addEventListener("change", () => handleFile(input.files[0], slot));
    if (!dz) return;
    ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => {
      e.preventDefault(); dz.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => {
      e.preventDefault(); dz.classList.remove("dragging");
    }));
    dz.addEventListener("drop", e => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f, slot);
    });
  });

  $("searchInput").addEventListener("input", e => { state.q = e.target.value; renderTable(); });
  document.querySelectorAll("#tabs .tab").forEach(t => t.addEventListener("click", () => {
    state.tab = t.dataset.tab; render();
  }));
  document.querySelectorAll("#compareTable th[data-key]").forEach(th => th.addEventListener("click", () => {
    const k = th.dataset.key;
    if (state.sortKey === k) state.sortAsc = !state.sortAsc;
    else { state.sortKey = k; state.sortAsc = true; }
    render();
  }));
  $("exportBtn").addEventListener("click", exportCsv);
  $("copyBtn").addEventListener("click", copyNames);
  const resetBtn = $("resetBtn");
  if (resetBtn) resetBtn.addEventListener("click", resetAll);
});