// SilverDash v4 - modularized app bootstrap (v38 overhaul)
'use strict';

// Detect lightweight test harness page
const IS_TEST_PAGE = (typeof location !== 'undefined') && /\/tests\.html(?:\?|#|$)/i.test(location.pathname + location.search + location.hash);


/** ===========================
 *  LOGGING (client-side)
 *  =========================== */
const LOG = (() => {
  // Ring buffer logging: keeps ONLY a bounded number of lines, optimized for iOS Safari.
  const KEY = "silverdash_log_lines_v2";
  const MAX_LINES = 350;     // cap memory and render cost
  const MAX_LINE_CHARS = 500;

  let lines = [];

  const box = () => document.getElementById("logBox");
  const netStateEl = () => document.getElementById("netState");
  const timerStateEl = () => document.getElementById("timerState");

  function ts(){
    return new Date().toISOString().replace("T"," ").slice(0,19) + "Z";
  }

  function load(){
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) lines = arr.filter(x => typeof x === "string");
    } catch(_){}
  }

  function persist(){
    try { localStorage.setItem(KEY, JSON.stringify(lines.slice(-MAX_LINES))); } catch(_){}
  }

  function trimLine(s){
    const v = String(s);
    return v.length > MAX_LINE_CHARS ? (v.slice(0, MAX_LINE_CHARS) + "…") : v;
  }

  function render(){
    const b = box();
    if (!b) return;
    b.textContent = lines.join("\n");
    b.scrollTop = b.scrollHeight;
  }

  function append(line){
    lines.push(trimLine(line));
    if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
    persist();
    render();
  }

  function info(msg){ append(`[${ts()}] INFO  ${msg}`); }
  function warn(msg){ append(`[${ts()}] WARN  ${msg}`); }
  function error(msg){ append(`[${ts()}] ERROR ${msg}`); }

  function clear(){
    lines = [];
    try { localStorage.removeItem(KEY); } catch(_){}
    render();
  }

  // Clears only the visual/history for a new refresh cycle (your request: keep last update only).
  function clearForNewCycle(){
    clear();
    info("Refresh cycle START");
  }

  function setNetState(online){
    const el = netStateEl();
    if (el) el.textContent = online ? "Network: online" : "Network: offline";
  }

  function setTimerState(s){
    const el = timerStateEl();
    if (el) el.textContent = s || "";
  }

  function tail(n=60){
    return lines.slice(-Math.max(1, n));
  }

  function exportDownload(){
    // Always generate a downloadable .txt file. No clipboard.
    const content = lines.join("\n") + "\n";
    const dataUrl = "data:text/plain;charset=utf-8," + encodeURIComponent(content);
    const blob = new Blob([content], {type: "text/plain;charset=utf-8"});
    const url = (content.length < 500000) ? dataUrl : URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:]/g,"-").replace(/\.\d+Z$/,"Z");
    const filename = `SilverDash_logs_${stamp}.txt`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();

    // If iOS blocks download, opening the blob URL still lets you Share/Save in Safari/Textastic.
    setTimeout(() => {
      try { window.open(url, "_blank", "noopener"); } catch(_){}
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch(_){} }, 8000);
    }, 250);
  }

  // init
  load();
  // don't render until DOM exists; caller will invoke render once ready
  return { info, warn, error, clear, clearForNewCycle, setNetState, setTimerState, tail, exportDownload, render };
})();


/** ===========================
 *  TTL CACHE (localStorage)
 *  =========================== */
const CACHE = (() => {
  const PREFIX = "sd_cache_v1:";
  const MAX_BYTES = 2_500_000; // guardrail; localStorage quotas vary
  const NOW = () => Date.now();

  function keyFor(url){ return PREFIX + url; }

  function safeJsonParse(s){
    try { return JSON.parse(s); } catch { return null; }
  }

  function get(url){
    try{
      const raw = localStorage.getItem(keyFor(url));
      if (!raw) return null;
      const obj = safeJsonParse(raw);
      if (!obj || typeof obj !== "object") return null;
      return obj;
    }catch(_e){
      return null;
    }
  }

  function set(url, payload){
    try{
      const raw = JSON.stringify(payload);
      if (raw.length > MAX_BYTES) return false;
      localStorage.setItem(keyFor(url), raw);
      return true;
    }catch(_e){
      return false;
    }
  }

  function del(url){
    try { localStorage.removeItem(keyFor(url)); } catch {}
  }

  // Default TTL policy per endpoint family (ms)
  function ttlForUrl(url){
    const u = String(url || "");
    if (u.includes("/CmeWS/mvc/quotes/v2/458")) return 10_000;
    if (u.includes("/CmeWS/mvc/Volume/LatestTotals")) return 30_000;
    if (u.includes("prices.lbma.org.uk/json/")) return 60_000;
    if (u.includes("en.sge.com.cn")) return 60_000;
    if (u.includes("netdania")) return 15_000;
    return 0; // no cache by default
  }

  function isFresh(entry, ttlMs){
    if (!entry || !Number.isFinite(entry.t)) return false;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false;
    return (NOW() - entry.t) <= ttlMs;
  }

  return { get, set, del, ttlForUrl, isFresh };
})();

/** ===========================
 *  MODE (Live / Report / Offline)
 *  =========================== */

// Accessibility: font sizing presets (normal/large/xl)
const A11Y = (() => {
  const KEY = 'sd_font_preset';
  const ORDER = ['normal','large','xl'];
  const get = () => {
    try{ const v = localStorage.getItem(KEY); return ORDER.includes(v) ? v : 'large'; }catch(_e){ return 'large'; }
  };
  const set = (v) => {
    try{ localStorage.setItem(KEY, v); }catch(_e){}
    try{ document.documentElement.setAttribute('data-font', v); }catch(_e){}
    const b = document.getElementById('btnA11y');
    if (b){
      b.textContent = (v==='normal') ? 'Text: Normal' : (v==='xl') ? 'Text: XL' : 'Text: Large';
      b.classList.toggle('pressed', v!=='normal');
    }
  };
  const cycle = () => {
    const cur = get();
    const idx = ORDER.indexOf(cur);
    const nxt = ORDER[(idx+1) % ORDER.length];
    set(nxt);
    try{ LOG.info(`A11y font preset: ${nxt}`); }catch(_e){}
    try{ showToast(`Text size: ${nxt.toUpperCase()}`); }catch(_e){}
  };
  return {get,set,cycle};
})();

const MODE = (() => {
  const KEY = "sd_mode_v1";
  const allowed = new Set(["live","report","offline"]);
  function get(){
    try{
      const v = (localStorage.getItem(KEY) || "report").toLowerCase();
      return allowed.has(v) ? v : "report";
    }catch{ return "report"; }
  }
  function set(v){
    const vv = String(v||"").toLowerCase();
    const val = allowed.has(vv) ? vv : "report";
    try{ localStorage.setItem(KEY, val); }catch{}
    return val;
  }
  return { get, set };
})();

/** ===========================
 *  METRIC TAGS (LIVE/OFFICIAL/PROXY/FALLBACK/MISSING)
 *  =========================== */
function setTag(tagId, kind, title){
  const el = document.getElementById(tagId);
  if (!el) return;
  const k = String(kind||"").toLowerCase();
  el.classList.remove("live","official","proxy","fallback","missing");
  if (k) el.classList.add(k);
  el.textContent = k ? k.toUpperCase() : "NOT RUN";
  if (title) el.title = title;
}

function setValueOrMissing(id, value, missingLabel="DATA MISSING"){
  const el = document.getElementById(id);
  if (!el) return;
  if (value === null || value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value))){
    el.textContent = missingLabel;
    el.dataset.missing = "1";
  } else {
    el.textContent = String(value);
    el.dataset.missing = "0";
  }
}

/** ===========================
 *  SNAPSHOT (Offline mode)
 *  =========================== */
const SNAPSHOT = (() => {
  const KEY = "sd_snapshot_v1";
  function save(obj){
    try{ localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), obj })); }catch{}
  }
  function load(){
    try{
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      return p && p.obj ? p : null;
    }catch{ return null; }
  }
  return { save, load };
})();


// Global error hooks (so you always see something even if a library fails to load)
window.addEventListener("error", (e) => {
  try {
    LOG.error(`window.onerror :: ${e.message || e.type} @ ${e.filename || "?"}:${e.lineno || "?"}:${e.colno || "?"}`);
  } catch {}
});
window.addEventListener("unhandledrejection", (e) => {
  try { LOG.error(`unhandledrejection :: ${String(e.reason)}`); } catch {}
});


document.addEventListener("DOMContentLoaded", () => {

// If running the test harness, don't boot the full dashboard UI.
  if (IS_TEST_PAGE) {
    try { runSilverDashTests(); } catch(e){ try{ console.error(e); }catch(_){ } }
    return;
  }


// Set up PDF worker early (prevents iOS "fake worker" failures).
setupPdfWorkerBlob();

// Mode buttons
  const applyModeUI = () => {
    const m = MODE.get();
    const setPressed = (id, on) => { const b=document.getElementById(id); if(b) b.classList.toggle('pressed', !!on); };
    setPressed('btnModeLive', m==='live');
    setPressed('btnModeReport', m==='report');
    setPressed('btnModeOffline', m==='offline');
    const pill = document.getElementById('autoPill');
    if (pill){
      pill.classList.remove('ok','warn','bad');
      if (m==='offline') pill.classList.add('warn');
      if (m==='live') pill.classList.add('ok');
    }
  };

  const bindMode = (id, mode) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.addEventListener('click', () => {
      MODE.set(mode);
      applyModeUI();

      // Do not bind A11y toggle inside each mode click; this causes duplicate event listeners.
      // The A11y toggle is bound once at DOMContentLoaded below.

      LOG.info(`Mode set: ${mode}`);
      // In offline mode, render snapshot immediately
      if (mode === 'offline'){
        try { renderSnapshotIfPresent(); } catch(_e){}
      } else {
        // Trigger a refresh immediately when leaving offline.
        try { refreshAll(); } catch(_e){}
      }
    });
  };

  bindMode('btnModeLive','live');
  bindMode('btnModeReport','report');
  bindMode('btnModeOffline','offline');

  // Bind A11y toggle once (cycle through font presets).
  try {
    const bA11y = document.getElementById('btnA11y');
    if (bA11y) {
      bA11y.addEventListener('click', () => {
        try { A11Y.cycle(); } catch(_e) {}
      });
      // Set the current preset on load
      A11Y.set(A11Y.get());
    }
  } catch(_e){}

  const btnCopy = document.getElementById('btnCopyDiag');
  if (btnCopy){
    btnCopy.addEventListener('click', async () => {
      try{
        const diag = buildDiagnostics();
        const txt = JSON.stringify(diag, null, 2);
        await navigator.clipboard.writeText(txt);
        showToast('Diagnostics copied');
      }catch(e){
        LOG.warn('Copy diagnostics failed: ' + (e?.message||String(e)));
        try{
          // Fallback: download as file
          const diag = buildDiagnostics();
          const blob = new Blob([JSON.stringify(diag,null,2)], {type:'application/json'});
          const a = document.createElement('a');
          a.href = (text.length < 500000) ? dataUrl : URL.createObjectURL(blob);
          a.download = 'SilverDash_diagnostics.json';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
          showToast('Diagnostics downloaded');
        }catch(_e){}
      }
    });
  }

  applyModeUI();


// Data Health UI
const healthMap = {
  CME_QUOTES:   {id:"health_cme_quotes", label:"CME Quotes"},
  CME_TOTALS:   {id:"health_cme_totals", label:"CME Totals"},
  LBMA_SILVER:  {id:"health_lbma_silver", label:"LBMA Silver"},
  LBMA_GOLD:    {id:"health_lbma_gold", label:"LBMA Gold"},
  PDF_MARGIN:   {id:"health_pdf_margin", label:"Margin PDF"},
  PDF_DELIVERY: {id:"health_pdf_delivery", label:"Delivery PDF"},
  PDF_WORKER:   {id:"health_pdf_worker", label:"PDF Worker"},
  SGE:          {id:"health_sge", label:"SGE"},
  NETDANIA:     {id:"health_netdania", label:"NetDania"},

  SHFE:         {id:"health_shfe", label:"SHFE"},
  FETCH:        {id:"health_fetch", label:"Other fetch"},
};

function fmtAge(ts){
  if (!ts) return "—";
  const s = Math.max(0, Math.round((Date.now()-ts)/1000));
  if (s < 60) return s + "s ago";
  const m = Math.round(s/60);
  return m + "m ago";
}

function paintHealth(st){
  for (const k of Object.keys(healthMap)){
    const el = document.getElementById(healthMap[k].id);
    if (!el) continue;
    const v = st[k];
    const ok = v && v.ok === true;
    const bad = v && v.ok === false;
    el.textContent = ok ? ("OK • " + fmtAge(v.at)) : bad ? ("FAIL • " + fmtAge(v.at)) : "NOT RUN";
    el.classList.remove("ok","bad","warn");
    if (ok) el.classList.add("ok"); else if (bad) el.classList.add("bad"); else el.classList.add("warn");
    el.classList.toggle("ok", ok);
    el.classList.toggle("bad", bad);
  }
}

HEALTH.onChange(paintHealth);
paintHealth(HEALTH.getAll());

  try {
    // Dependency status
    const xlsxOk = (typeof XLSX !== "undefined");
    const pdfOk = (typeof pdfjsLib !== "undefined");
    const chartOk = (typeof Chart !== "undefined");
    
    LOG.info(`Library detection: XLSX=${xlsxOk}, PDF=${pdfOk}, Chart=${chartOk}`);
    
    // Library status pills may be removed from the UI. Never assume the DOM nodes exist.
    const set = (id, val) => { const el=document.getElementById(id); if (el) el.textContent = val; };
    set("depXlsxVal", xlsxOk ? "OK" : "MISSING");
    set("depPdfVal", pdfOk ? "OK" : "MISSING");
    set("depChartVal", chartOk ? "OK" : "MISSING");
    // Additional modules
    const oiOk = (STATE && (STATE.oiMar !== undefined)) || !!localStorage.getItem('march_oi_history_v1');
    const aiConsoleOk = typeof window.AIConsole !== "undefined" || !!document.querySelector('script[src*="ai-console"]');
    const aiSummaryOk = typeof window.AISummary !== "undefined" || !!document.querySelector('script[src*="ai-summary"]');
    const swOk = ("serviceWorker" in navigator);

    // (set already defined above)
    set("depOiVal", oiOk ? "OK" : "MISSING");
    set("depAiConsoleVal", aiConsoleOk ? "OK" : "MISSING");
    set("depAiSummaryVal", aiSummaryOk ? "OK" : "MISSING");
    set("depSwVal", swOk ? "SUPPORTED" : "NO");

// ChinaWest: keep 429 counter visible. Spread values are handled by updateArbUI().
try{ set("dbgCw429", String(CHINA_WEST?.rateLimited429 ?? 0)); }catch(_e){}


    // If any library is missing, show prominent warning
    if (!xlsxOk || !pdfOk || !chartOk) {
      const missing = [];
      if (!xlsxOk) missing.push('XLSX.js (inventory data)');
      if (!pdfOk) missing.push('PDF.js (delivery notices)');
      if (!chartOk) missing.push('Chart.js (roll chart)');
      
      const msg = `⚠️ CRITICAL: Libraries blocked by network\n\nMissing: ${missing.join(', ')}\n\nThe dashboard cannot load data because your network is blocking cdn.jsdelivr.net.\n\nSolutions:\n1. Check if Content Blockers are enabled in Safari Settings\n2. Try a different network/WiFi\n3. Request a bundled version (no CDN required)`;
      
      LOG.error(msg);
      showError(msg);
    }

    // Make pills readable immediately
    const online = (typeof navigator !== "undefined") ? navigator.onLine : null;
    document.getElementById("netState").textContent = (online === true) ? "online" : (online === false) ? "offline" : "unknown";
    document.getElementById("timerState").textContent = "starting";

    // Show any stored logs immediately
    LOG.render();
    LOG.info("DOM ready");
  } catch (e) {
    try { LOG.error("DOMContentLoaded handler failed :: " + String(e)); } catch {}
  }
});


/** ===========================
 *  CONFIG
 *  =========================== */
const CFG = {
  refreshSeconds: 120,
  contractSizeOz: 5000,
  // CME sources
  urlStocksXls: "https://www.cmegroup.com/delivery_reports/Silver_stocks.xls",
  urlDlvDailyPdf: "https://www.cmegroup.com/delivery_reports/MetalsIssuesAndStopsReport.pdf",
  urlDlvMtdPdf: "https://www.cmegroup.com/delivery_reports/MetalsIssuesAndStopsMTDReport.pdf",
  urlDlvYtdPdf: "https://www.cmegroup.com/delivery_reports/MetalsIssuesAndStopsYTDReport.pdf",
  urlQuotesJson: "https://www.cmegroup.com/CmeWS/mvc/quotes/v2/458",
  urlQuotesJsonFallback: "https://www.cmegroup.com/CmeWS/mvc/Quotes/Future/458/G",
  urlProductCalendarXls: "https://www.cmegroup.com/CmeWS/mvc/ProductCalendar/Download.xls?productId=458",
  urlSilverCalendarPage: "https://www.cmegroup.com/markets/metals/precious/silver.calendar.html",
  urlMarginsPage: "https://www.cmegroup.com/markets/metals/precious/silver.margins.html",

  // CME Clearing advisory PDF (used to extract the current margin % when the margins page is JS-rendered)
  // Example: Feb 6, 2026 advisory raising SI/SIT outright rates to 18% for Non-HRP.
  // If CME publishes a newer advisory later, update this URL (or we can make this auto-discoverable).
  urlMarginAdvisoryPdf: "https://www.cmegroup.com/content/dam/cmegroup/notices/clearing/2026/02/chadv26-057.pdf",

  // CME endpoints — all have CORS (access-control-allow-origin mirrors origin), confirmed via header inspection
  // Correct URL formats reverse-engineered from CME's own JS bundles (product-volume.js, common.js)
  urlCmeQuotesV2:   "https://www.cmegroup.com/CmeWS/mvc/quotes/v2/458",
  // LatestTotals: returns array of {formattedDate, futureVolume, futureOi} per trading day
  // This is what CME's own volume/OI chart uses — confirmed from product-volume.js source
  // CORS: access-control-allow-origin: * (confirmed 403→200 from Gary's browser)
  urlCmeLatestTotals: "https://www.cmegroup.com/CmeWS/mvc/Volume/LatestTotals?products=458&days=10",
  // Settlements: /{productId}/FUT?strategy=DEFAULT&tradeDate={YYYYMMDD}&pageSize=500
  urlCmeSettleBase: "https://www.cmegroup.com/CmeWS/mvc/Settlements/Futures/Settlements/458/FUT",

  // LBMA Silver Price — full history back to 1968, access-control-allow-origin: *
  // v[0]=USD, v[1]=GBP, v[2]=EUR per troy oz · published each London business day
  urlLBMASilver:  "https://prices.lbma.org.uk/json/silver.json",
  urlLBMAGold:    "https://prices.lbma.org.uk/json/gold_am.json",  // for Gold/Silver Ratio
  // Live spot proxy (HTML scrape via mirror to avoid CORS)
  urlGoldCoUkSilverLive: "https://r.jina.ai/http://www.gold.co.uk/silver-price/live/ounces/USD/",

  // CFTC Commitment of Traders — public Socrata API, CORS: access-control-allow-origin: *
  // Published every Friday covering previous Tuesday's positions
  // Silver COMEX contract market code: 084691
  urlCFTCSilver:  "https://publicreporting.cftc.gov/resource/6dca-aqww.json?cftc_contract_market_code=084691&$limit=8&$order=report_date_as_yyyy_mm_dd+DESC",
  focusMonth: { year: 2026, monthIndex: 2 }, // March (0=Jan)
};

// Immediate library check (before DOMContentLoaded)
LOG.info(`IMMEDIATE Library check: XLSX=${typeof XLSX}, PDF=${typeof pdfjsLib}, Chart=${typeof Chart}`);

/** ===========================
 *  UTIL
 *  =========================== */
const $ = (id)=>document.getElementById(id);
function fmtInt(n){
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {maximumFractionDigits:0}).format(Math.round(n));
}
function fmtSigned(n){
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const s = Math.round(n);
  return (s>0?"+":"") + fmtInt(s);
}
function fmtMoney(n){
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:3}).format(n);
}
function setPill(pillEl, val, kind){
  pillEl.classList.remove("ok","warn","bad");
  if (kind) pillEl.classList.add(kind);
  pillEl.querySelector(".mono")?.remove?.();
}
function showError(msg){
  const el = $("errors");
  el.style.display = "block";
  el.textContent += (el.textContent ? "\n\n" : "") + msg;
}
function clearError(){
  const el = $("errors");
  el.style.display = "none";
  el.textContent = "";
}
const HEALTH = (() => {
  const state = {};
  const listeners = new Set();

  function guessKey(url){
  try {
    // url can be a string, URL, or Request-like object
    let u = "";
    if (typeof url === "string") u = url;
    else if (url && typeof url.url === "string") u = url.url;
    else u = String(url || "");
    const ul = u.toLowerCase();

    if (u.includes("/CmeWS/mvc/quotes/v2/458")) return "CME_QUOTES";
    if (u.includes("/CmeWS/mvc/Volume/LatestTotals")) return "CME_TOTALS";
    if (u.includes("/CmeWS/mvc/Volume/Details/")) return "CME_TOTALS";
    if (ul.includes("/delivery_reports/silver_stocks.xls")) return "CME_TOTALS";

    if (u.includes("prices.lbma.org.uk/json/silver.json")) return "LBMA_SILVER";
    if (u.includes("prices.lbma.org.uk/json/gold_am.json")) return "LBMA_GOLD";

    // Margin PDF advisory (CME clearing notices)
    if (ul.endsWith(".pdf") && (ul.includes("chadv") || ul.includes("adv") || ul.includes("marg"))) return "PDF_MARGIN";

    // Delivery notices PDFs (MTD/Daily/YTD issues & stops)
    if (ul.endsWith(".pdf") && (ul.includes("metalsissuesandstops") || ul.includes("delivery_reports") || ul.includes("issuesandstops"))) return "PDF_DELIVERY";

    if (ul.includes("en.sge.com.cn")) return "SGE";
    if (ul.includes("shfe.com.cn")) return "SHFE";
    if (ul.includes("gold.co.uk/silver-price/live")) return "NETDANIA"; // treated as live proxy endpoint
    if (ul.includes("netdania")) return "NETDANIA";
  } catch(_){}
  return "FETCH";
}

  function set(key, patch){
    const prev = state[key] || {};
    state[key] = Object.assign({}, prev, patch, {key});
    listeners.forEach(fn => { try { fn(state); } catch(_){} });
  }

  function getAll(){ return JSON.parse(JSON.stringify(state)); }

  function onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }

  return { set, getAll, onChange, guessKey };
})();

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000, retries = 1){
  const key = HEALTH.guessKey(url);
  const start = performance.now();

  for (let attempt = 0; attempt <= retries; attempt++){
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
      clearTimeout(id);

      const ms = Math.round(performance.now() - start);
      HEALTH.set(key, { ok: res.ok, status: res.status, ms, at: Date.now(), url });

      return res;
    } catch (err){
      clearTimeout(id);
      const ms = Math.round(performance.now() - start);
      HEALTH.set(key, { ok: false, status: 0, ms, at: Date.now(), url, error: (err && err.message) ? err.message : String(err) });

      if (attempt >= retries) throw err;
      // backoff: 250ms, 500ms...
      await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
    }
  }
}

function selectFrontMonthQuote(quotes){
  try {
    const arr = Array.isArray(quotes) ? quotes : [];
    if (!arr.length) return null;

    const withVol = arr
      .map(q => {
        const v = (q && q.volume != null) ? parseFloat(String(q.volume).replace(/,/g,'')) : NaN;
        return { q, v: Number.isFinite(v) ? v : -1 };
      })
      .sort((a,b) => b.v - a.v);

    const best = withVol[0] && withVol[0].q ? withVol[0].q : arr[0];

    // Validation: ensure it has a usable last price; otherwise fall back to first with last
    const hasLast = best && Number.isFinite(parseFloat(String(best.last).replace(/,/g,'')));
    if (hasLast) return best;

    const alt = arr.find(q => Number.isFinite(parseFloat(String(q && q.last).replace(/,/g,''))));
    return alt || best;
  } catch(_) {
    return (Array.isArray(quotes) && quotes[0]) ? quotes[0] : null;
  }
}
async function setupPdfWorkerBlob(){
  try {
    if (typeof pdfjsLib === 'undefined') return false;

    const absWorker = new URL('libs/pdf.worker.min.js', document.baseURI).toString();

    // Build a Blob URL so iOS Safari loads the worker reliably even in preview/webview contexts.
    const r = await fetchWithTimeout(absWorker, { cache: 'no-store' }, 15000, 1);
    if (!r.ok) throw new Error('HTTP ' + r.status);

    const js = await r.text();
    const blob = new Blob([js], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);

    pdfjsLib.GlobalWorkerOptions.workerSrc = blobUrl;

    HEALTH.set("PDF_WORKER", { ok: true, status: 200, ms: 0, at: Date.now(), url: absWorker });
    return true;
  } catch (e){
    HEALTH.set("PDF_WORKER", { ok: false, status: 0, ms: 0, at: Date.now(), url: "", error: (e && e.message) ? e.message : String(e) });
    return false;
  }
}


async function fetchArrayBuffer(url){
  const res = await fetchWithTimeout(url, { cache: "no-store" }, 15000, 1);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.arrayBuffer();
}

async function fetchJson(url, opts = {}){
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 12000;
  const retries   = Number.isFinite(opts.retries) ? opts.retries : 1;
  const ttlMs     = Number.isFinite(opts.ttlMs) ? opts.ttlMs : CACHE.ttlForUrl(url);
  const force     = opts.force === true;
  const allowStaleIfOffline = (opts.allowStaleIfOffline !== false);

  try{
    if (!force && ttlMs > 0){
      const entry = CACHE.get(url);
      const offline = (typeof navigator !== "undefined") && (navigator.onLine === false);
      if (entry && entry.json !== undefined){
        if (CACHE.isFresh(entry, ttlMs) || (offline && allowStaleIfOffline)){
          return entry.json;
        }
      }
    }
  }catch(_e){}

  const res = await fetchWithTimeout(url, { cache: "no-store" }, timeoutMs, retries);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const data = await res.json();

  try{
    if (ttlMs > 0){
      CACHE.set(url, { t: Date.now(), json: data });
    }
  }catch(_e){}

  return data;
}
function sleep(ms){
  return new Promise(res=>setTimeout(res, ms));
}
function utcDateKey(d=new Date()){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const day = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

// Normalise common report date formats (e.g. "2/25/2026", "02/25/2026") to YYYY-MM-DD.
function normalizeDateKey(mdy){
  if (!mdy) return null;
  const s = String(mdy).trim();
  // MM/DD/YYYY
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1){
    const mm = String(Number(m1[1])).padStart(2,"0");
    const dd = String(Number(m1[2])).padStart(2,"0");
    const yy = m1[3];
    return `${yy}-${mm}-${dd}`;
  }
  // YYYY-MM-DD
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}
function parseNumberLoose(x){
  if (x === null || x === undefined) return NaN;
  if (typeof x === "number") return x;
  const s = String(x).replace(/,/g,"").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function safeGet(obj, keys){
  for (const k of keys){
    if (obj && Object.prototype.hasOwnProperty.call(obj,k)) return obj[k];
  }
  return undefined;
}

/** ===========================
 *  STATE + DERIVED METRICS (Combined Inventory/Countdown card)
 *  =========================== */
const STATE = {
  marginPct: 0.18,
  registered: null,
  prevRegistered: null,
  oiMar: null,
  prevOiMar: null,
  frontPriceUsd: null,
  priceUsd: null,
  comexLast: null,
  comexSih26Last: null,
  frontPriorSettleUsd: null,
  sih26PriorSettleUsd: null,
  oiTotal: null,
  registeredOz: null,
  eligibleOz: null,
  inventoryTs: null,
  inventoryAsOf: null,
  tradeDate: null,
  lbmaUsd: null,
  sgeUsd: null,
  shfeUsd: null,
  usdGbp: null,
};

function fmtPct(n){
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
function fmtUsd(n){
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
}
function fmtGbp(n){
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP",minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
}


function fmtMoneyUSD0(n){
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(n);
}
function fmtMoneyGBP0(n){
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP",maximumFractionDigits:0}).format(n);
}

async function ensureUsdGbpFx(){
  // Cache in localStorage for 30 minutes to avoid hammering.
  const KEY = "silverdash_fx_usdgbp_v1";
  try{
    const cached = JSON.parse(localStorage.getItem(KEY) || "null");
    if (cached && cached.rate && cached.ts && (Date.now() - cached.ts) < 30*60*1000){
      STATE.usdGbp = cached.rate;
      return cached.rate;
    }
  }catch{}

  // Primary: derive FX from LBMA Silver (USD and GBP are already in the app).
  // This avoids an extra FX dependency which iOS Safari sometimes blocks.
  try{
    const usd = parseNum((document.getElementById('lbmaUSD')||{}).textContent);
    const gbp = parseNum((document.getElementById('lbmaGBP')||{}).textContent);
    if (Number.isFinite(usd) && usd > 0 && Number.isFinite(gbp) && gbp > 0){
      const rate = gbp / usd; // USD -> GBP conversion factor
      STATE.usdGbp = rate;
      try{ localStorage.setItem(KEY, JSON.stringify({rate, ts: Date.now()})); }catch{}
      return rate;
    }
  }catch{}

  // Public FX endpoint (no key). If blocked by CORS/network, we just leave GBP unavailable.
  const url = "https://open.er-api.com/v6/latest/USD";
  try{
    const res = await fetch(url, {cache:"no-store"});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const rate = j?.rates?.GBP;
    if (!Number.isFinite(rate)) throw new Error("GBP rate missing");
    STATE.usdGbp = rate;
    try{ localStorage.setItem(KEY, JSON.stringify({rate, ts: Date.now()})); }catch{}
    return rate;
  }catch(e){
    LOG.warn(`FX USD→GBP unavailable: ${e.message}`);
    STATE.usdGbp = null;
    return null;
  }
}

/** ===========================
 *  ARBITRAGE STATE (China vs West)
 *  =========================== */
const ARB = {
  sgePhysicalUsdOz: null,  // China physical benchmark (SGE)
  shfePaperUsdOz: null,    // China paper (SHFE delayed)
  comexUsdOz: null,        // COMEX front contract (SIH26)
  lbmaUsdOz: null,         // LBMA Silver Price (latest fix)
  lbmaLiveUsdOz: null,     // Live spot proxy (gold.co.uk scrape)
  lbmaLiveUpdated: null,   // e.g. "13:28 23/02/26"

  usdPerCny: null,
};

function fmtSpread(base, other){
  if (!Number.isFinite(base) || !Number.isFinite(other)) return {usd: '—', pct: '—'};
  const d = base - other;
  const p = other !== 0 ? (d / other) * 100 : NaN;
  const usd = (d >= 0 ? '+' : '') + fmtUsd(d);
  const pct = Number.isFinite(p) ? ((p >= 0 ? '+' : '') + p.toFixed(2) + '%') : '—';
  return {usd, pct};
}

function updateArbUI(){
  // Summary prices
  const elFx = document.getElementById('chinaFx');
  if (elFx) elFx.textContent = Number.isFinite(ARB.usdPerCny) ? ARB.usdPerCny.toFixed(6) : '—';

  const elComex = document.getElementById('arbComex');
  if (elComex) elComex.textContent = Number.isFinite(ARB.comexUsdOz) ? fmtUsd(ARB.comexUsdOz) : '—';
  const elLbma = document.getElementById('arbLbma');
  if (elLbma) {
    const v = Number.isFinite(ARB.lbmaLiveUsdOz) ? ARB.lbmaLiveUsdOz : ARB.lbmaUsdOz;
    elLbma.textContent = Number.isFinite(v) ? fmtUsd(v) : '—';
    const elFix = $('arbLbmaFix');
    if (elFix) elFix.textContent = Number.isFinite(ARB.lbmaUsdOz) ? fmtUsd(ARB.lbmaUsdOz) : '—';
  }

  // Pair spreads
  const pairs = [
    ['arbSgeVsComexVal', ARB.sgePhysicalUsdOz, ARB.comexUsdOz],
    ['arbSgeVsLbmaVal', ARB.sgePhysicalUsdOz, (Number.isFinite(ARB.lbmaLiveUsdOz)?ARB.lbmaLiveUsdOz:ARB.lbmaUsdOz)],
    ['arbShfeVsComexVal', ARB.shfePaperUsdOz, ARB.comexUsdOz],
    ['arbShfeVsLbmaVal', ARB.shfePaperUsdOz, (Number.isFinite(ARB.lbmaLiveUsdOz)?ARB.lbmaLiveUsdOz:ARB.lbmaUsdOz)],
    ['arbComexVsLbmaVal', ARB.comexUsdOz, (Number.isFinite(ARB.lbmaLiveUsdOz)?ARB.lbmaLiveUsdOz:ARB.lbmaUsdOz)],
    ['arbSgeVsShfeVal', ARB.sgePhysicalUsdOz, ARB.shfePaperUsdOz],
  ];

  for (const [id, a, b] of pairs){
    const el = document.getElementById(id);
    if (!el) continue;

    const s = fmtSpread(a, b);
    el.textContent = `${s.usd} (${s.pct})`;

    // Color rule per your instruction:
    //   + spread (China > West) = RED
    //   - spread (China < West) = GREEN
    // Use existing pill classes: bad (red), ok (green).
    const pillId = id.replace(/Val$/, '');
    const pill = document.getElementById(pillId);
    if (pill){
      pill.classList.remove('ok','warn','bad');
      if (Number.isFinite(a) && Number.isFinite(b)){
        const d = a - b;
        if (d > 0) pill.classList.add('bad');
        else if (d < 0) pill.classList.add('ok');
        else pill.classList.add('warn');
      }else{
        pill.classList.add('warn');
      }
    }
  }

  // Debug panel "ChinaWest" quick pills (kept in-sync with the main arb spreads)
  const setDbg = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const vLbma = (Number.isFinite(ARB.lbmaLiveUsdOz) ? ARB.lbmaLiveUsdOz : ARB.lbmaUsdOz);
  setDbg('dbgCwComex', `${fmtSpread(ARB.sgePhysicalUsdOz, ARB.comexUsdOz).usd} (${fmtSpread(ARB.sgePhysicalUsdOz, ARB.comexUsdOz).pct})`);
  setDbg('dbgCwLbma', `${fmtSpread(ARB.sgePhysicalUsdOz, vLbma).usd} (${fmtSpread(ARB.sgePhysicalUsdOz, vLbma).pct})`);
  setDbg('dbgCwSge', `${fmtSpread(ARB.sgePhysicalUsdOz, ARB.shfePaperUsdOz).usd} (${fmtSpread(ARB.sgePhysicalUsdOz, ARB.shfePaperUsdOz).pct})`);
  setDbg('dbgCwShfe', `${fmtSpread(ARB.shfePaperUsdOz, ARB.comexUsdOz).usd} (${fmtSpread(ARB.shfePaperUsdOz, ARB.comexUsdOz).pct})`);
}

// COMEX vs LBMA spread card: prefer LBMA live proxy when available.
function updateComexLbmaSpread(){
  const comexText = $('bcPrice')?.textContent?.replace(/[^0-9.]/g, '') || '';
  const comexLast = parseFloat(comexText);

  const lbmaFix = ARB.lbmaUsdOz;
  const lbmaLive = ARB.lbmaLiveUsdOz;
  const lbmaRef = Number.isFinite(lbmaLive) ? lbmaLive : lbmaFix;
  const basis = Number.isFinite(lbmaLive) ? 'Live proxy' : 'Daily fix';

  const elBasis = $('spreadBasis');
  if (elBasis) elBasis.textContent = `Basis: ${basis}`;

  if (Number.isFinite(comexLast) && comexLast > 5 && Number.isFinite(lbmaRef) && lbmaRef > 5){
    const spread = comexLast - lbmaRef;
    const spreadPct = ((spread / lbmaRef) * 100).toFixed(2);
    $('spreadUSD').textContent = (spread >= 0 ? '+' : '') + spread.toFixed(3);
    $('spreadUSD').style.color = Math.abs(spread) > 3 ? '#f08060' : '#a7b3d6';
    $('spreadPct').textContent = `%: ${spread >= 0 ? '+' : ''}${spreadPct}%`;
    $('comexLastForSpread').textContent = comexLast.toFixed(3);
    // LBMA live spot proxy under COMEX Last
    // Canonical variable name in this dashboard is lbmaLiveUsdOz.
    const elProxy = $('lbmaLiveProxyUnderComex');
    if (elProxy) {
      const px = (Number.isFinite(ARB?.lbmaLiveUsdOz) ? ARB.lbmaLiveUsdOz : NaN);
      elProxy.textContent = Number.isFinite(px) ? ('$' + px.toFixed(3)) : '—';

      // Color rule: if LBMA > COMEX then green, else red.
      elProxy.classList.remove('ok','bad');
      if (Number.isFinite(px)) elProxy.classList.add(px > comexLast ? 'ok' : 'bad');
    }
    LOG.info(`Spread: COMEX SIH26=${comexLast.toFixed(3)} - LBMA ${basis}=${lbmaRef.toFixed(3)} = ${spread.toFixed(3)} (${spreadPct}%)`);
  } else {
    if ($('spreadUSD')) $('spreadUSD').textContent = 'awaiting COMEX/LBMA';
    LOG.warn(`Spread: not ready (COMEX="${comexText}", LBMA ref="${lbmaRef}")`);
  }
}

async function ensureUsdPerCny(){
  const KEY = 'silverdash_fx_usd_per_cny_v1';

  // Always prefer a recent cached value (and keep a stale value rather than nuking FX to null).
  try{
    const cached = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (cached && Number.isFinite(cached.rate)) {
      ARB.usdPerCny = cached.rate;
      // If it's fresh (<30m) return immediately
      if (cached.ts && (Date.now() - cached.ts) < 30*60*1000) return cached.rate;
    }
  }catch{}

  // Tiny fetch helper with timeout so iOS/Textastic doesn't hang for 60s on a blocked endpoint.
  async function fetchJsonTimeout(url, ms){
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), ms);
    try{
      const r = await fetch(url, {cache:'no-store', signal: ctrl.signal});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  // Try ER-API first (more reliable on iOS), then Frankfurter as fallback.
  const tries = [
    { url:'https://open.er-api.com/v6/latest/CNY', pick: j => j?.rates?.USD },
    { url:'https://api.frankfurter.app/latest?from=CNY&to=USD', pick: j => j?.rates?.USD },
  ];

  let lastErr = null;
  for (const t of tries){
    try{
      const j = await fetchJsonTimeout(t.url, 5000);
      const rate = t.pick(j);
      if (!Number.isFinite(rate)) throw new Error('USD rate missing');
      ARB.usdPerCny = rate;
      try{ localStorage.setItem(KEY, JSON.stringify({rate, ts: Date.now()})); }catch{}
      return rate;
    }catch(e){
      lastErr = e;
    }
  }

  // If both live sources fail, keep whatever we last had (cached/stale) instead of blanking China cards.
  if (Number.isFinite(ARB.usdPerCny)){
    LOG.warn(`FX CNY→USD live fetch failed; using cached rate ${ARB.usdPerCny.toFixed(6)}. Last error: ${lastErr?.message||'unknown'}`);
    return ARB.usdPerCny;
  }

  LOG.warn(`FX CNY→USD unavailable: ${lastErr?.message||'unknown'}`);
  return null;
}


function updateCombinedCardMetrics(){
  // Populate March OI mirror fields (from the working seed/ledger pipeline)
  // Keep March OI consistent across all cards that display it.
  if ($("bcOI")) $("bcOI").textContent = fmtInt(STATE.oiMar);
  if ($("oiMar")) $("oiMar").textContent = fmtInt(STATE.oiMar);
  if (Number.isFinite(STATE.oiMar)){
    if ($("cmMarchOI")) $("cmMarchOI").textContent = fmtInt(STATE.oiMar);
    // tag_cmMarchOI is derived from March OI provenance tag_bcOI
    const bcTag = document.getElementById("tag_bcOI");
    const bcKind = bcTag ? (bcTag.classList.contains("fallback") ? "fallback" : bcTag.classList.contains("live") ? "live" : "live") : "live";
    setTag("tag_cmMarchOI", bcKind, bcTag && bcTag.title ? bcTag.title : "March OI");
  } else {
    if ($("cmMarchOI")) $("cmMarchOI").textContent = "DATA MISSING";
    setTag("tag_cmMarchOI","missing","March OI unavailable");
  }

  // OI delta + pct
  const dMar = (Number.isFinite(STATE.prevOiMar) && Number.isFinite(STATE.oiMar)) ? (STATE.oiMar - STATE.prevOiMar) : null;
  if ($("cmMarchOIDelta")) $("cmMarchOIDelta").textContent = fmtSigned(dMar);

  const pctMar = (Number.isFinite(dMar) && Number.isFinite(STATE.prevOiMar) && STATE.prevOiMar !== 0)
    ? (dMar / STATE.prevOiMar) * 100
    : null;
  if ($("cmMarchOIPct")) $("cmMarchOIPct").textContent = fmtPct(pctMar);

  const pillDelta = $("cmMarchOIDeltaPill");
  if (pillDelta){
    pillDelta.classList.remove("ok","warn","bad");
    if (dMar === null) pillDelta.classList.add("warn");
    else if (dMar < 0) pillDelta.classList.add("ok");
    else if (dMar > 0) pillDelta.classList.add("warn");
    else pillDelta.classList.add("ok");
  }
  const pillPct = $("cmMarchOIPctPill");
  if (pillPct){
    pillPct.classList.remove("ok","warn","bad");
    if (pctMar === null) pillPct.classList.add("warn");
    else if (pctMar < 0) pillPct.classList.add("ok");
    else if (pctMar > 0) pillPct.classList.add("warn");
    else pillPct.classList.add("ok");
  }

  // Registered pct change
  const dReg = (Number.isFinite(STATE.prevRegistered) && Number.isFinite(STATE.registered)) ? (STATE.registered - STATE.prevRegistered) : null;
  const pctReg = (Number.isFinite(dReg) && Number.isFinite(STATE.prevRegistered) && STATE.prevRegistered !== 0)
    ? (dReg / STATE.prevRegistered) * 100
    : null;
  if ($("kpiRegisteredPct")) $("kpiRegisteredPct").textContent = fmtPct(pctReg);
  const regPctPill = $("kpiRegisteredPctPill");
  if (regPctPill){
    regPctPill.classList.remove("ok","warn","bad");
    if (pctReg === null) regPctPill.classList.add("warn");
    else if (pctReg < 0) regPctPill.classList.add("bad");
    else regPctPill.classList.add("ok");
  }

  // Notional calculations require March OI + price
  const price = Number.isFinite(STATE.priceUsd) ? STATE.priceUsd : null;
  const oi = Number.isFinite(STATE.oiMar) ? STATE.oiMar : null;
  const contractOz = 5000;
  const notionalUsd = (price !== null && oi !== null) ? (oi * contractOz * price) : null;

  if ($("cmMarchNotionalUsd")) $("cmMarchNotionalUsd").textContent = notionalUsd === null ? "—" : fmtMoneyUSD0(notionalUsd);

  const gbpRate = Number.isFinite(STATE.usdGbp) ? STATE.usdGbp : null;
  const notionalGbp = (notionalUsd !== null && gbpRate !== null) ? (notionalUsd * gbpRate) : null;
  if ($("cmMarchNotionalGbp")) $("cmMarchNotionalGbp").textContent = notionalGbp === null ? "FX unavailable" : fmtMoneyGBP0(notionalGbp);

  // Margin estimates (COMEX 5000 Silver Futures SI): CME moved to percentage-based margining.
  // Use Non-HRP outright rate of 18% (Initial and Maintenance) as per CME clearing advisory effective Feb 6, 2026.
  // NOTE: Brokers can require higher, and HRP accounts use higher percentages.
  const marginPct = (Number.isFinite(STATE.marginPct) ? STATE.marginPct : 0.18);
  const marginPerUsd = (price !== null) ? (contractOz * price * marginPct) : null;
  const marginTotalUsd = (marginPerUsd !== null && oi !== null) ? (marginPerUsd * oi) : null;

  if ($("cmMarchMarginPerUsd")) $("cmMarchMarginPerUsd").textContent = marginPerUsd === null ? "—" : fmtMoneyUSD0(marginPerUsd);
  const marginPerGbp = (marginPerUsd !== null && gbpRate !== null) ? (marginPerUsd * gbpRate) : null;
  if ($("cmMarchMarginPerGbp")) $("cmMarchMarginPerGbp").textContent = marginPerGbp === null ? "FX unavailable" : fmtMoneyGBP0(marginPerGbp);

  if ($("cmMarchMarginTotalUsd")) $("cmMarchMarginTotalUsd").textContent = marginTotalUsd === null ? "—" : fmtMoneyUSD0(marginTotalUsd);
  const marginTotalGbp = (marginTotalUsd !== null && gbpRate !== null) ? (marginTotalUsd * gbpRate) : null;
  if ($("cmMarchMarginTotalGbp")) $("cmMarchMarginTotalGbp").textContent = marginTotalGbp === null ? "FX unavailable" : fmtMoneyGBP0(marginTotalGbp);

  // vs Registered (OI oz equivalent / Registered)
  const reg = Number.isFinite(STATE.registered) ? STATE.registered : null;
  const oiOz = (oi !== null) ? (oi * contractOz) : null;
  const mult = (oiOz !== null && reg !== null && reg !== 0) ? (oiOz / reg) : null;

  // Display the raw ounces implied by March OI
  if ($("cmMarchOIOz")) $("cmMarchOIOz").textContent = (oiOz === null) ? "—" : `${fmtInt(oiOz)} oz`;

  if ($("cmMarchVsRegMult")) $("cmMarchVsRegMult").textContent = mult === null ? "—" : `${mult.toFixed(2)}×`;
  const overPct = (mult !== null) ? ((mult - 1) * 100) : null;
  if ($("cmMarchVsRegPct")) $("cmMarchVsRegPct").textContent = overPct === null ? "—" : fmtPct(overPct);

  const pctOfReg = (mult !== null) ? (mult * 100) : null;
  if ($("cmMarchVsRegPctOfReg")) $("cmMarchVsRegPctOfReg").textContent = pctOfReg === null ? "—" : `${pctOfReg.toFixed(1).replace(/\.0$/,'')}%`;

  const porPill = $("cmMarchVsRegPctOfRegPill");
  if (porPill){
    porPill.classList.remove("ok","warn","bad");
    if (pctOfReg === null) porPill.classList.add("warn");
    else if (pctOfReg >= 100) porPill.classList.add("bad");
    else porPill.classList.add("ok");
  }


  const vsPill = $("cmMarchVsRegPill");
  if (vsPill){
    vsPill.classList.remove("ok","warn","bad");
    if (mult === null) vsPill.classList.add("warn");
    else if (mult > 1) vsPill.classList.add("bad");
    else vsPill.classList.add("ok");
  }
}

/** ===========================
 *  INVENTORY (Silver_stocks.xls)
 *  =========================== */
async function loadInventory(){
  if (typeof XLSX === 'undefined') {
    throw new Error('XLSX library not loaded. Check network connection and CDN access.');
  }
  const ab = await fetchArrayBuffer(CFG.urlStocksXls);
  const wb = XLSX.read(ab, {type:"array"});
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true});

  // Find row that contains "TOTAL REGISTERED" and "TOTAL ELIGIBLE"
  let registered = null, eligible = null;
  let registeredDeltaXls = null; // attempt to derive prior-day delta from XLS layout
  let registeredOpenXls  = null; // attempt to derive prior-day level from XLS layout
  let reportDate = null;

  for (const r of rows){
    const joined = r.map(v=>String(v ?? "")).join(" ").toUpperCase();
    if (!reportDate && joined.includes("REPORT DATE:")){
      // Example cell: "Report Date: 2/13/2026"
      const m = joined.match(/REPORT DATE:\s*([0-9\/]+)/i);
      if (m) reportDate = m[1];
    }
    if (joined.includes("TOTAL REGISTERED")){
      // numeric value usually in last non-empty cell, but skip trailing zeros
      const nums = r.map(parseNumberLoose).filter(Number.isFinite);
      LOG.info(`TOTAL REGISTERED row: raw cells=[${r.slice(0,10).join(', ')}], parsed nums=[${nums.join(', ')}]`);
      
      // CME format: [label, blank, opening, change columns..., closing balance, blank]
      // We want the closing balance which is typically second-to-last before trailing zeros
      if (nums.length >= 1) {
        // Filter out trailing zeros and very small numbers (< 1000 oz)
        const validNums = nums.filter(n => Math.abs(n) >= 1000);
        if (validNums.length === 1) {
          registered = validNums[0];
        } else if (validNums.length >= 2) {
          // Heuristic:
          // - last valid number is usually the closing balance
          // - second-to-last might be either the opening balance or the net change
          const closing = validNums[validNums.length - 1];
          const penult  = validNums[validNums.length - 2];
          registered = closing;

          // If penult is much smaller than closing, it's likely a net change column.
          // Otherwise, assume it's the prior-day/opening balance.
          const looksLikeDelta = (Math.abs(penult) < Math.abs(closing) * 0.2);
          if (looksLikeDelta) {
            registeredDeltaXls = penult;
            registeredOpenXls  = closing - penult;
          } else {
            registeredOpenXls  = penult;
            registeredDeltaXls = closing - penult;
          }

          // Guard against nonsense (e.g., negative opening)
          if (!Number.isFinite(registeredOpenXls) || registeredOpenXls <= 0) {
            registeredOpenXls = null;
            registeredDeltaXls = null;
          }
        }
      }
    }
    if (joined.includes("TOTAL ELIGIBLE")){
      const nums = r.map(parseNumberLoose).filter(Number.isFinite);
      LOG.info(`TOTAL ELIGIBLE row: raw cells=[${r.slice(0,10).join(', ')}], parsed nums=[${nums.join(', ')}]`);
      
      // Same logic as registered - get last valid number >= 1000
      if (nums.length >= 2) {
        const validNums = nums.filter(n => Math.abs(n) >= 1000);
        if (validNums.length > 0) {
          eligible = validNums[validNums.length - 1];
        }
      } else if (nums.length === 1) {
        eligible = nums[0];
      }
    }
  }

  setValueOrMissing("kpiRegistered", Number.isFinite(registered) ? fmtInt(registered) : null);
  setValueOrMissing("kpiEligibleVal", Number.isFinite(eligible) ? fmtInt(eligible) : null);
  if (Number.isFinite(registered)) setTag("tag_kpiRegistered","official","CME Silver_stocks.xls (official daily report)");
  else setTag("tag_kpiRegistered","missing","Registered inventory not found in XLS");
  
  LOG.info(`Inventory loaded: Registered=${registered}, Eligible=${eligible}`);
  
  $("invNote").textContent = reportDate
    ? `Report Date (as printed in XLS): ${reportDate}`
    : `Report date not found in XLS (layout changed?).`;

  // Day-before comparison via localStorage ledger (fallback only).
  // Primary delta/pct should come from XLS if possible.
  const key = "comex_silver_inv_ledger_v1";
  const ledger = JSON.parse(localStorage.getItem(key) || "{}");
  const today = utcDateKey();
  const reportKey = normalizeDateKey(reportDate) || today;

  // Track distinct report dates so "previous" isn't overwritten by repeated refreshes.
  const dates = Array.isArray(ledger.dates) ? ledger.dates : [];
  if (!dates.includes(reportKey)) dates.push(reportKey);
  dates.sort();
  ledger.dates = dates;

  const prevKey = (dates.length >= 2) ? dates[dates.length - 2] : null;
  const prev = prevKey ? ledger[prevKey] : null;

  ledger[reportKey] = {registered, eligible, ts: Date.now()};
  ledger.latestReportDate = reportKey;
  localStorage.setItem(key, JSON.stringify(ledger));

  // Prefer XLS-derived delta; else use ledger; else null.
  const deltaLedger = prev && Number.isFinite(prev.registered) && Number.isFinite(registered)
    ? (registered - prev.registered)
    : null;
  const delta = Number.isFinite(registeredDeltaXls) ? registeredDeltaXls : deltaLedger;
  $("kpiRegisteredDelta").textContent = fmtSigned(delta);

  // Percent vs prior day
  const prior = Number.isFinite(registeredOpenXls) ? registeredOpenXls
    : (prev && Number.isFinite(prev.registered) ? prev.registered : null);
  const pct = (Number.isFinite(delta) && Number.isFinite(prior) && prior !== 0)
    ? (delta / prior) * 100
    : null;
  if ($("kpiRegisteredPct")) $("kpiRegisteredPct").textContent = fmtPct(pct);

  const pill = $("kpiRegisteredDeltaPill");
  pill.classList.remove("ok","warn","bad");
  if (delta === null) pill.classList.add("warn");
  else if (delta < 0) pill.classList.add("bad");
  else pill.classList.add("ok");


  // Update combined-card derived metrics
  STATE.registered = Number.isFinite(registered) ? registered : null; // legacy
  STATE.eligible = Number.isFinite(eligible) ? eligible : null;       // legacy
  STATE.registeredOz = Number.isFinite(registered) ? registered : null;
  STATE.eligibleOz = Number.isFinite(eligible) ? eligible : null;
  STATE.inventoryTs = Date.now();

  STATE.prevRegistered = Number.isFinite(prior) ? prior : ((prev && Number.isFinite(prev.registered)) ? prev.registered : null);
  updateCombinedCardMetrics();

  return {registered, eligible};
}

/** ===========================
 *  CME QUOTES (Open Interest / Roll)
 *  =========================== */
function pickContractMonthFromQuote(q){
  // Try common fields used by CME JSON payloads
  const sym = safeGet(q, ["productCode","globexCode","symbol","code","instrumentName","contractName","name"]);
  const exp = safeGet(q, ["expirationDate","expDate","maturityDate"]);
  return {sym, exp};
}

function monthKeyFromExpiration(exp){
  if (!exp) return null;
  // exp might be "2026-03-27" or "03/27/2026" etc
  const s = String(exp).trim();
  let y,m;
  let m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1){ y = Number(m1[1]); m = Number(m1[2]); }
  else{
    let m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m2){ y = Number(m2[3]); m = Number(m2[1]); }
  }
  if (!y || !m) return null;
  return `${y}-${String(m).padStart(2,"0")}`;
}

function getOiField(q){
  // CME sometimes uses openInterest or oi
  const v = safeGet(q, ["openInterest","open_interest","oi","openInt"]);
  const n = parseNumberLoose(v);
  return Number.isFinite(n) ? n : null;
}


async function fetchMarchOIFromVolumePage() {
  // Scrape CME silver volume page via jina.ai mirror to avoid CORS.
  const url = "https://r.jina.ai/http://www.cmegroup.com/markets/metals/precious/silver.volume.html";
  const t0 = performance.now();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`CME volume page HTTP ${res.status}`);
  const html = await res.text();

  const patterns = [
    /SIH26[^\n\r]{0,400}?Open\s*Interest[^0-9]{0,80}([0-9]{1,3}(?:,[0-9]{3})*)/i,
    /SIH26[^\n\r]{0,500}?"openInterest"\s*[:=]\s*"?([0-9]{1,3}(?:,[0-9]{3})*)"?/i,
    /"SIH26"[^\n\r]{0,600}?"openInterest"\s*[:=]\s*"?([0-9]{1,3}(?:,[0-9]{3})*)"?/i
  ];
  let oi = null;
  for (const rx of patterns) {
    const m = html.match(rx);
    if (m && m[1]) { oi = parseInt(m[1].replace(/,/g,""),10); break; }
  }
  if (!Number.isFinite(oi) || oi <= 0) throw new Error("SIH26 OI not found (page format changed)");
  return { oi, ms: Math.round(performance.now()-t0), source: "cme_volume_page" };
}
async function loadBarchartData(){
  // Uses CME Group's own VOI (Volume & Open Interest) JSON APIs
  // These have CORS headers (access-control-allow-origin mirrors origin)
  // so they work from any browser origin. Confirmed via header inspection.

  // Helper: get last N trading days as YYYYMMDD strings (skip weekends)
  // Note: CME may be closed on US holidays (e.g. Presidents Day) — those will 404 gracefully
  function tradingDays(count = 4) {
    const days = [];
    const d = new Date();
    while (days.length < count) {
      const dow = d.getDay(); // 0=Sun, 6=Sat
      if (dow !== 0 && dow !== 6) {
        const y = d.getFullYear();
        const m = String(d.getMonth()+1).padStart(2,'0');
        const dd = String(d.getDate()).padStart(2,'0');
        days.push(`${y}${m}${dd}`);
      }
      d.setDate(d.getDate() - 1);
    }
    return days; // newest first: [today, yesterday, day-before, ...]
  }
  const recentDates = tradingDays(4);
  LOG.info(`CME VOI will try dates: ${recentDates.join(', ')}`);

  // CME request headers that work cross-origin
  const cmeHeaders = {
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.cmegroup.com/markets/metals/precious/silver.html',
  };

  let oiFeb = null, oiMar = null, oiLater = null, price = null, high = null, low = null, vol = null, change = null, tradeDate = null;
  let status = 200;

  // --- STEP 1: Load quotes/v2 for price + basic data ---
  try {
    const qRes = await fetch(CFG.urlCmeQuotesV2, { headers: cmeHeaders, cache: 'no-store' });
    status = qRes.status;

    if (qRes.ok) {
      const qData = await qRes.json();
      LOG.info(`CME quotes/v2: tradeDate=${qData.tradeDate}, quotes=${qData.quotes?.length}`);
      tradeDate = qData.tradeDate || '';

      const quotes = qData.quotes || [];
      // CME "Overview" page shows the *front-month* Globex code (often quotes[0]).
      // Our dashboard also needs the specific March 2026 contract (SIH26 / MAR26).
      const front = selectFrontMonthQuote(quotes);
      
      const sih26 = quotes.find(q => {
        const qc = (q && (q.globexCode || q.contractSymbol || q.symbol || q.globex || "")) + "";
        const qcs = qc.toUpperCase();
        if (qcs.includes("SIH26")) return true;
        if (qcs.includes("MAR26")) return true;
        // fallback: check description/name fields if present
        const desc = ((q && (q.description || q.contractName || q.productName || "")) + "").toUpperCase();
        return desc.includes("MAR") && desc.includes("26") && (desc.includes("SI") || desc.includes("SILVER"));
      }) || null;

      const parseNum = v => { if (typeof v === 'number') return v; const n = parseFloat((v||'').toString().replace(/,/g,'')); return isNaN(n) ? null : n; };

      // 1) Front-month display (matches CME page "Globex Code" box)
      if (front) {
        const frontPx  = parseNum(front.last);
        const frontChg = parseNum(front.change);
        const frontHi  = parseNum(front.high);
        const frontLo  = parseNum(front.low);
        const frontVol = parseNum(front.volume);
        const frontPrev= parseNum(front.priorSettle);
        if (Number.isFinite(frontPrev)) STATE.frontPriorSettleUsd = frontPrev;

        const gc = (front.globexCode || front.globex || front.symbol || front.contractSymbol || '').toString().trim();
        const lbl = gc ? `Last Price ($/oz) • Front: ${gc}` : 'Last Price ($/oz) • Front month';
        const elLbl = $('bcPriceLabel');
        if (elLbl) elLbl.textContent = lbl;

        if (Number.isFinite(frontPx)) {
          $('bcPrice').textContent = frontPx.toFixed(3);
          STATE.frontPriceUsd = frontPx;
          // Update the canonical COMEX last price (used in diagnostics/state)
          STATE.comexLast = frontPx;
          setTag('tag_bcPrice','live', `CME quotes/v2 front month (${gc||'front'})`);
        }

        if (Number.isFinite(frontChg)) {
          const chgText = `${frontChg >= 0 ? '+' : ''}${frontChg.toFixed(3)}`;
          $('bcChange').textContent = chgText;
          const pill = $('bcChangePill');
          pill.style.background = (frontChg ?? 0) >= 0 ? '#1a4a2e' : '#4a1a1e';
          $('bcChange').style.color = (frontChg ?? 0) >= 0 ? '#50e090' : '#e05060';
        }

        if (Number.isFinite(frontHi) && Number.isFinite(frontLo)) $('bcHighLow').textContent = `${frontHi.toFixed(3)} / ${frontLo.toFixed(3)}`;
        if (Number.isFinite(frontPrev)) $('bcPrevClose').textContent = frontPrev.toFixed(3);
        if (Number.isFinite(frontVol)) $('bcVolume').textContent = fmtInt(frontVol);
      }

      // 2) SIH26 (MAR26) price for spreads/notional calcs (and displayed as a pill)
      if (sih26) {
        const sihPx = parseNum(sih26.last);
        if (Number.isFinite(sihPx)) {
          $('bcPriceSIH26').textContent = sihPx.toFixed(3);
        STATE.comexSih26Last = sihPx;
          STATE.priceUsd = sihPx;
          ARB.comexUsdOz = sihPx;
          updateArbUI();
          updateCombinedCardMetrics();
        }
      }

      // Fallback: if SIH26/MAR26 quote is not present in the quotes payload (happens on iOS/Safari
      // when CME trims the quote list), use the front-month price for calculations so the dashboard
      // never shows blanks for notional/margin math.
      if (!Number.isFinite(STATE.priceUsd) && Number.isFinite(STATE.frontPriceUsd)) {
        STATE.priceUsd = STATE.frontPriceUsd;
        ARB.comexUsdOz = STATE.frontPriceUsd;
        // Use front-month as comexLast when SIH26 is missing
        STATE.comexLast = STATE.frontPriceUsd;
        const el = $('bcPriceSIH26');
        if (el && (el.textContent || '').trim() === '—') el.textContent = STATE.frontPriceUsd.toFixed(3);
        updateArbUI();
        updateCombinedCardMetrics();
      }

      // Back-compat: if we failed to find front-month, keep prior behaviour
      if (!front && sih26) {
        const px = parseNum(sih26.last);
        if (Number.isFinite(px)) $('bcPrice').textContent = px.toFixed(3);
      }

      if (front || sih26) {
        // keep locals for any downstream logic that referenced these names
        price = Number.isFinite(STATE.frontPriceUsd) ? STATE.frontPriceUsd : (Number.isFinite(STATE.priceUsd) ? STATE.priceUsd : null);
      }
      if (tradeDate) $('bcTradeDate').textContent = tradeDate;
    } else {
      LOG.error(`CME quotes/v2: HTTP ${qRes.status}`);
      setTag('tag_bcPrice','missing', `CME quotes/v2 HTTP ${qRes.status}`);
    }
  } catch(e) {
    LOG.error(`CME quotes/v2 failed: ${e.message}`);
    setTag('tag_bcPrice','missing', `CME quotes/v2 failed: ${e.message}`);
  }

  // --- STEP 2: Load Open Interest via LatestTotals endpoint ---
  // CME's own volume chart uses: /CmeWS/mvc/Volume/LatestTotals?products=458&days=10
  // Actual response fields (confirmed from live log):
  //   {productId, tradeDate, futureVolume, futureOpenInterest, optionVolume, optionOpenInterest, ...}
  // NOTE: This returns TOTAL OI across ALL contracts, NOT per-contract OI!
  // Per-contract OI is NOT available via any free CME API.
  // We use seed data / localStorage ledger for March-specific OI.
  
  let voiLoaded = false;
  let totalOIFromAPI = null;
  
  try {
    const totUrl = CFG.urlCmeLatestTotals;
    LOG.info(`CME LatestTotals FETCH: ${totUrl}`);
    const totRes = await fetch(totUrl, { headers: cmeHeaders, cache: 'no-store' });
    if (!totRes.ok) {
      LOG.warn(`CME LatestTotals: HTTP ${totRes.status}`);
    } else {
      const rawTot = await totRes.text();
      LOG.info(`CME LatestTotals: HTTP 200, length=${rawTot.length}, preview=${rawTot.slice(0,200)}`);
      const totData = JSON.parse(rawTot);

      const rows = Array.isArray(totData) ? totData
                 : (totData.data || totData.totals || totData.items || []);

      LOG.info(`CME LatestTotals: ${rows.length} rows, latest=${JSON.stringify(rows[rows.length-1] || {}).slice(0,200)}`);

      if (rows.length > 0) {
        const parseNum = s => parseInt((s||'0').toString().replace(/,/g,'')) || 0;
        const latestRow = [...rows].reverse().find(r => parseNum(r.futureOpenInterest) > 0);

        if (latestRow) {
          totalOIFromAPI = parseNum(latestRow.futureOpenInterest);
          const totalVol = parseNum(latestRow.futureVolume);
          const tDate = latestRow.tradeDate || '';
          LOG.info(`CME LatestTotals: total OI (all contracts) = ${totalOIFromAPI}, vol=${totalVol}`);
          
          // Display TOTAL OI (this is correct for total)
          $('bcOITotal').textContent = fmtInt(totalOIFromAPI);
          voiLoaded = true;
        }
      }
    }
  } catch(e) {
    LOG.error(`CME LatestTotals failed: ${e.message}`);
  }

  // --- STEP 3: Load March OI (SIH26) from CME silver volume page (scrape) ---
// We prefer a live scrape (via mirror to avoid CORS). If it fails, we DO NOT silently seed.
// If the scrape fails, March OI becomes N/A and the UI shows a clear warning.
const OI_HIST_KEY = 'march_oi_history_v1';
const oiHist = JSON.parse(localStorage.getItem(OI_HIST_KEY) || '{}');

// Try to use the CME quotes tradeDate as the storage key if available; else use today's UTC.
const tradeKey = (() => {
  try {
    const s = (tradeDate ? String(tradeDate) : '');
    const d = s ? new Date(s + ' UTC') : null;
    if (d && !isNaN(d.getTime())) return d.toISOString().slice(0,10);
  } catch(_e){}
  return utcDateKey();
})();

async function fetchMarchOiFromBarchart(){
  // Barchart displays per-contract Open Interest clearly and updates intraday.
  // We fetch via jina.ai mirror to avoid CORS restrictions.
  const SRC = 'https://r.jina.ai/http://www.barchart.com/futures/quotes/SIH26/overview';
  const t0 = (performance && performance.now) ? performance.now() : Date.now();
  const res = await fetch(SRC, { cache:'no-store' });
  const ms = Math.round(((performance && performance.now) ? performance.now() : Date.now()) - t0);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const txt = await res.text();

  // Common Barchart patterns:
  //  - "Open Interest" label followed by the numeric value
  // We keep it tolerant because jina.ai can reformat the HTML.
  let m = txt.match(/Open\s*Interest\s*\n?\s*([0-9]{1,3}(?:,[0-9]{3})+)/i);
  if (!m) m = txt.match(/Open\s*Interest[^0-9]{0,120}([0-9]{1,3}(?:,[0-9]{3})+)/i);
  if (m && m[1]) {
    const oi = parseInt(m[1].replace(/,/g,''),10);

    // Try to extract a "previous" OI from the page if present (some variants include it in embedded JSON).
    let prevOi = null;
    try{
      let pm = txt.match(/Previous\s*Open\s*Interest[^0-9]{0,120}([0-9]{1,3}(?:,[0-9]{3})+)/i);
      if (pm && pm[1]) prevOi = parseInt(pm[1].replace(/,/g,''),10);
      if (!Number.isFinite(prevOi)){
        // Look for embedded JSON-ish fields
        const jm = txt.match(/"(?:previousOpenInterest|openInterestPrevious|prevOpenInterest)"\s*:\s*"?([0-9]{1,3}(?:,[0-9]{3})+)"?/i);
        if (jm && jm[1]) prevOi = parseInt(jm[1].replace(/,/g,''),10);
      }
    }catch(_e){ prevOi = null; }

    return { oi, prevOi: Number.isFinite(prevOi) ? prevOi : null, ms, src:'Barchart SIH26 overview' };
  }
  throw new Error('Barchart OI parse failed');
}


function _stripJinaHeader(s){
  if (!s) return '';
  // r.jina.ai often prepends Title/URL Source lines; remove them.
  const lines = s.split('\n');
  let start = 0;
  for (let i=0;i<Math.min(lines.length,10);i++){
    const L = lines[i];
    if (/^URL Source:/i.test(L)) { start = i+1; break; }
  }
  return lines.slice(start).join('\n');
}

// Robust March OI extractor from CME silver.volume text.
// Strategy: find the MAR 2026 row (or March 2026), then pick the most plausible Open Interest number.
// Returns {oi, change} or null.
function _parseMarchOiFromCmeVolumeText(raw){
  const txt = _stripJinaHeader(String(raw||''));
  if (!txt) return null;

  // Find a region around "MAR 2026" (or "MARCH 2026").
  const mRow = txt.match(/(?:\bMAR(?:CH)?\b)\s*20?26[\s\S]{0,2000}/i);
  if (!mRow) return null;
  const region = mRow[0];

  // Extract signed and unsigned numeric tokens (commas allowed).
  const tokenRe = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g;
  const tokens = region.match(tokenRe) || [];
  const vals = tokens
    .map(t => ({ raw:t, val: parseFloat(t.replace(/,/g,'')) }))
    .filter(o => Number.isFinite(o.val));

  if (!vals.length) return null;

  // Helper: find the last number occurrence before a given index.
  function findPrevNumber(beforeIdx){
    const head = region.slice(0, Math.max(0, beforeIdx));
    const m = head.match(new RegExp(tokenRe.source + "(?![\\s\\S]*" + tokenRe.source + ")"));
    if (!m) return null;
    const v = parseFloat(m[0].replace(/,/g,''));
    return Number.isFinite(v) ? v : null;
  }

  // 1) Prefer explicit "Change" value (often the last column).
  let change = null;
  let changeIdx = -1;
  const chMatch = region.match(/\bChange\b[\s\S]{0,120}?(-?\d{1,3}(?:,\d{3})+|-?\d+(?:\.\d+)?)/i);
  if (chMatch && chMatch[1]){
    const cv = parseFloat(chMatch[1].replace(/,/g,''));
    if (Number.isFinite(cv) && Math.abs(cv) <= 500000){
      change = cv;
      changeIdx = region.toLowerCase().indexOf(chMatch[1].toLowerCase());
    }
  }

  // 2) Open Interest: if we have a Change number, take the numeric token immediately preceding it.
  let oi = null;
  if (changeIdx !== -1){
    const prev = findPrevNumber(changeIdx);
    if (Number.isFinite(prev) && prev >= 1000 && prev <= 500000) oi = prev;
  }

  // 3) If still not found, try to read the first number after "Open Interest" label (within a short window),
  // but prefer the LAST number in that window (tables often list multiple counts before the actual OI).
  if (oi == null){
    const oiIdx = region.search(/Open\s*Interest/i);
    if (oiIdx !== -1){
      const after = region.slice(oiIdx, oiIdx + 600);
      const nums = after.match(tokenRe) || [];
      if (nums.length){
        const v = parseFloat(nums[nums.length - 1].replace(/,/g,''));
        if (Number.isFinite(v) && v >= 1000 && v <= 500000) oi = v;
      }
    }
  }

  // 4) Final fallback: choose the value that looks like contract OI, preferring the LAST plausible number in the region.
  if (oi == null){
    const plausible = vals.map(o=>o.val).filter(v => v >= 1000 && v <= 500000);
    if (!plausible.length) return null;
    // last plausible in reading order
    oi = plausible[plausible.length - 1];
  }

  // Sanity: contract OI should not exceed total OI (all contracts) when available in memory.
  // (We cannot access total here reliably, so just clamp obviously-wrong picks.)
  if (!(Number.isFinite(oi) && oi >= 1000)) return null;

  return { oi: Math.round(oi), change: (change==null?null:Math.round(change)) };
}

async function fetchMarchOiFromCmeVolumePage(){
  // Secondary fallback (less reliable than Barchart for per-contract OI)
  const SRC = 'https://r.jina.ai/http://www.cmegroup.com/markets/metals/precious/silver.volume.html';
  const t0 = (performance && performance.now) ? performance.now() : Date.now();
  const res = await fetch(SRC, { cache:'no-store' });
  const ms = Math.round(((performance && performance.now) ? performance.now() : Date.now()) - t0);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const txt = await res.text();

  const parsed = _parseMarchOiFromCmeVolumeText(txt);
  if (parsed && parsed.oi){
    const out = { oi: parsed.oi, ms, src:'CME silver.volume (MAR 2026 row)', change: parsed.change };
    return out;
  }
  throw new Error('CME volume page OI parse failed');
}

// Primary: CME's own VOI Details endpoint (per-expiry table) then select MAR26.
// This avoids the "Globex Code" trap (SIH6 front-month) and pulls the actual March 2026 row.
async function fetchMarchOiFromCmeVolumeDetails(){
  const t0 = (performance && performance.now) ? performance.now() : Date.now();
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.cmegroup.com/markets/metals/precious/silver.volume.html',
  };

  // Reuse recentDates from loadBarchartData scope if present, else generate.
  const dates = (typeof recentDates !== 'undefined' && Array.isArray(recentDates) && recentDates.length)
    ? recentDates
    : (function tradingDays(count = 4){
        const out = [];
        const d = new Date();
        while (out.length < count){
          const dow = d.getDay();
          if (dow !== 0 && dow !== 6){
            const y = d.getFullYear();
            const m = String(d.getMonth()+1).padStart(2,'0');
            const dd = String(d.getDate()).padStart(2,'0');
            out.push(`${y}${m}${dd}`);
          }
          d.setDate(d.getDate()-1);
        }
        return out;
      })(6);

  let lastErr = null;
  for (const d of dates){
    const url = `https://www.cmegroup.com/CmeWS/mvc/Volume/Details/F/458/${d}/P`;
    try{
      const res = await fetch(url, { headers, cache:'no-store' });
      if (!res.ok){
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      const js = await res.json();
      const md = js && (js.monthData || js.data?.monthData || js.items || js.data || []);
      if (!Array.isArray(md) || !md.length){
        lastErr = new Error('No monthData');
        continue;
      }

      // Normalise possible field names.
      const norm = (x) => String(x || '').trim().toUpperCase().replace(/\s+/g,'');
      const isMar26 = (row) => {
        const m = norm(row.month || row.contractMonth || row.expirationMonth || row.label);
        return m === 'MAR26' || m === 'MARCH26' || m === 'MAR2026' || m === 'MAR-26';
      };

      const row = md.find(isMar26);
      if (!row){
        lastErr = new Error('MAR26 row not found');
        continue;
      }

      const oi = parseNumberLoose(row.atClose ?? row.openInterest ?? row.oi ?? row.openInt ?? row.interest);
      const ch = parseNumberLoose(row.change ?? row.netChange ?? row.delta ?? row.changeAtClose);
      if (!Number.isFinite(oi) || oi <= 0){
        lastErr = new Error('Invalid MAR26 OI');
        continue;
      }

      const ms = Math.round(((performance && performance.now) ? performance.now() : Date.now()) - t0);
      return { oi: Math.round(oi), change: Number.isFinite(ch) ? Math.round(ch) : null, ms, src: `CME Volume/Details (MAR26) ${d}` };
    }catch(e){
      lastErr = e;
    }
  }

  throw new Error(`CME Volume/Details failed: ${lastErr ? lastErr.message : 'unknown'}`);
}

let marchOiResult = null;
try{
  // Prefer Barchart per-contract OI first (matches what you see in the browser).
  // March OI retrieval:
// 1) CME Volume/Details per-expiry JSON (MAR26 row)
// 2) CME silver.volume page (MAR 2026 row) via mirror
// 3) If those fail, use last-known local seed (stored) to keep UI working (clearly labeled)
try{
    marchOiResult = await fetchMarchOiFromCmeVolumeDetails();
  }catch(e1){
    LOG.warn(`March OI (CME Volume/Details) failed: ${e1.message}. Trying CME volume page parse...`);
    try{
      marchOiResult = await fetchMarchOiFromCmeVolumePage();
    }catch(e2){
      LOG.warn(`March OI (CME volume page) failed: ${e2.message}. Using last-known seed fallback...`);
      const seedKey = 'silverdash_march_oi_last_good';
      const seedVal = parseInt(localStorage.getItem(seedKey)||'',10);
      if (Number.isFinite(seedVal) && seedVal>0){
        marchOiResult = { oi: seedVal, prevOi: null, ms: 0, src: 'Local seed (last-known) ⚠' };
      } else {
        // absolute last resort: keep blank but don't crash
        marchOiResult = { oi: null, prevOi: null, ms: 0, src: 'Unavailable' };
      }
    }
  }
  oiMar = marchOiResult.oi;

  // If CME Volume/Details provided a daily change for MAR26, we can derive the prior day's OI
  // even on the very first run (when our local history has no previous key yet).
  // This is the most direct interpretation of "Δ day" and "% vs prior day" on CME.
  const impliedPrevOiFromChange = (marchOiResult && Number.isFinite(marchOiResult.change) && Number.isFinite(oiMar))
    ? (oiMar - marchOiResult.change)
    : null;

  // Persist into history
  oiHist[tradeKey] = {
    oiMar,
    ts: Date.now(),
    src: marchOiResult.src,
    // Prefer an explicitly supplied previous OI if present, else derive it from CME's change when available.
    prevOiMar: (marchOiResult?.prevOi ?? impliedPrevOiFromChange ?? null)
  };
  localStorage.setItem(OI_HIST_KEY, JSON.stringify(oiHist));
  // Remember last-known March OI for fallback
  if (Number.isFinite(oiMar) && oiMar>0){ try{ localStorage.setItem('silverdash_march_oi_last_good', String(oiMar)); }catch(_e){} }


  LOG.info(`March OI scraped: ${oiMar} (SIH26) via ${marchOiResult.src} (${marchOiResult.ms}ms) key=${tradeKey}`);
}catch(e){
  oiMar = null;
  LOG.warn(`March OI scrape failed: ${e.message}`);
}

// Compute day-over-day delta using stored history (previous available day)
const histDates = Object.keys(oiHist).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
const prevKey = (() => {
  const i = histDates.indexOf(tradeKey);
  if (i > 0) return histDates[i-1];
  const last = histDates.length ? histDates[histDates.length-1] : null;
  return (last && last < tradeKey) ? last : null;
})();
// Determine prior OI:
// 1) Prefer our stored previous trading day (from history keys)
// 2) Else use the derived prior OI (from CME change) saved under this tradeKey
const prevOi = prevKey && oiHist[prevKey] && Number.isFinite(oiHist[prevKey].oiMar)
  ? oiHist[prevKey].oiMar
  : (oiHist[tradeKey] && Number.isFinite(oiHist[tradeKey].prevOiMar) ? oiHist[tradeKey].prevOiMar : null);

// Determine delta:
// Prefer CME's explicit change when available (authoritative for "Δ day"), else fall back to history diff.
const dMarFromHist = (marchOiResult && Number.isFinite(marchOiResult.change))
  ? marchOiResult.change
  : ((prevOi !== null && oiMar !== null) ? (oiMar - prevOi) : null);

// Update the Open Interest card + any other UI slots that display March OI
$('bcOI').textContent = (oiMar !== null) ? fmtInt(oiMar) : '—';
// Provenance tag
if (oiMar === null){
  setTag('tag_bcOI','missing','March OI unavailable');
} else {
  const src = (marchOiResult && marchOiResult.src) ? marchOiResult.src : '';
  const kind = src.includes('Local seed') ? 'fallback' : 'live';
  setTag('tag_bcOI', kind, `March OI source: ${src || 'CME'}`);
}

$('oiMar').textContent = (oiMar !== null) ? fmtInt(oiMar) : '—';
$('oiMarDelta').textContent = fmtSigned(dMarFromHist);
const marP = $('oiMarDeltaPill');
if (marP){
  marP.classList.remove('ok','warn','bad');
  if (dMarFromHist === null) marP.classList.add('warn');
  else marP.classList.add(dMarFromHist < 0 ? 'ok' : dMarFromHist > 0 ? 'warn' : 'ok');
}

// Also mirror into the combined-card OI slots if present
if ($('bcOIDelta')) $('bcOIDelta').textContent = fmtSigned(dMarFromHist);
if ($('bcOIDeltaPill')){
  const p = $('bcOIDeltaPill');
  p.classList.remove('ok','warn','bad');
  if (dMarFromHist === null) p.classList.add('warn');
  else p.classList.add(dMarFromHist < 0 ? 'ok' : dMarFromHist > 0 ? 'warn' : 'ok');
}

// Expose state for other cards (combined/comparisons)
STATE.oiMar = (oiMar !== null && Number.isFinite(oiMar)) ? oiMar : null;
STATE.prevOiMar = (prevOi !== null && Number.isFinite(prevOi)) ? prevOi : null;

// Human-readable note
if (oiMar === null){
  $('bcNote').textContent = `⚠️ March OI (SIH26) scrape failed. Total OI=${fmtInt(totalOIFromAPI)} from CME API (all contracts).`;
}else{
  const src = marchOiResult ? marchOiResult.src : (oiHist[tradeKey]?.src || 'CME volume page');
  $('bcNote').textContent = `March OI (SIH26) via ${src} (key ${tradeKey}). Δ vs prior: ${dMarFromHist===null?'—':fmtSigned(dMarFromHist)}. Total OI=${fmtInt(totalOIFromAPI)} (all contracts).`;
}

// --- STEP 4: OI display, delta pills, update ledger ---
  $('oiFeb').textContent   = fmtInt(oiFeb);
  $('oiMar').textContent   = fmtInt(oiMar);
  $('oiLater').textContent = fmtInt(oiLater);

  // --- STEP 4: OI display (non-March fields are optional) ---
// March OI is handled via scrape + history above. We do NOT overwrite it with any seed ledger here.
$('oiFeb').textContent   = fmtInt(oiFeb);
$('oiLater').textContent = fmtInt(oiLater);

const dFeb = null;
const dLater = null;

$('oiFebDelta').textContent   = fmtSigned(dFeb);
$('oiLaterDelta').textContent = fmtSigned(dLater);

for (const [pillId, delta] of [['oiFebDeltaPill',dFeb],['oiLaterDeltaPill',dLater]]) {
  const el = $(pillId); if (!el) continue;
  el.classList.remove('ok','warn','bad');
  if (delta === null) el.classList.add('warn');
  else el.classList.add(delta < 0 ? 'ok' : delta > 0 ? 'warn' : 'ok');
}

  LOG.info(`OI Display: Mar(SIH26)=${oiMar}, Feb=${oiFeb}, Later=${oiLater}, Total=${totalOIFromAPI}`);

  if (oiMar === null) {
    $('oiNote').textContent = '⚠️ March OI scrape failed (CME page format changed or unavailable)';
  LOG.warn('No March OI available (scrape failed)');
  } else {
    $('oiNote').textContent = '';
  }

  return { oiFeb, oiMar, oiLater, ledgerKey: tradeKey, status };
}

// Lightweight COMEX refresh for the China vs West card.
// Avoids the heavy VOI/OI logic and prevents noisy logs every few seconds.
async function loadComexLastOnly(returnStatus=false){
  let _status = 200;
  const cmeHeaders = {
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.cmegroup.com/markets/metals/precious/silver.html',
  };
  try{
    const qRes = await fetch(CFG.urlCmeQuotesV2, { headers: cmeHeaders, cache: 'no-store' });
    if (!qRes.ok){
      LOG.warn(`CME quotes/v2 (fast): HTTP ${qRes.status}`);
      return;
    }
    const qData = await qRes.json();
    const quotes = qData.quotes || [];
    // Prefer SIH26 by looking for March (H) or explicit 'MAR'.
    const mar = quotes.find(q => ((q.expirationMonth || q.month || '').toUpperCase().includes('MAR')) || (String(q.code||'').toUpperCase() === 'H')) || quotes[0];
    if (!mar) return;
    const parseNum = v => { if (typeof v === 'number') return v; const n = parseFloat((v||'').toString().replace(/,/g,'')); return isNaN(n) ? null : n; };
    const price = parseNum(mar.last);
    if (!Number.isFinite(price)) return;

    // Update only the arb display (do not touch the broader dashboard KPIs).
    ARB.comexUsdOz = price;
    updateArbUI();
  }catch(e){
    LOG.warn(`CME quotes/v2 (fast) failed: ${String(e?.message || e)}`);
  }
  if (returnStatus) return (typeof _status !== 'undefined' ? _status : 200);
  return null;
}
/** ===========================
 *  CFTC COMMITMENT OF TRADERS (COT)
 *  Open Interest + Positioning for COMEX Silver (084691)
 *  CFTC Socrata API: access-control-allow-origin: * (confirmed)
 *  Published every Friday covering previous Tuesday positions
 *  =========================== */
async function loadCOT(){
  try {
    const res = await fetch(CFG.urlCFTCSilver, { cache: 'no-store' });
    if (!res.ok) { LOG.error(`CFTC COT: HTTP ${res.status}`); return; }
    const rows = await res.json();
    if (!rows || rows.length === 0) { LOG.error('CFTC COT: empty response'); return; }

    const r = rows[0]; // most recent report
    const prev = rows[1];

    const oi     = parseInt(r.open_interest_all);
    const prevOI = prev ? parseInt(prev.open_interest_all) : null;
    const chg    = parseInt(r.change_in_open_interest_all);
    const ncLong = parseInt(r.noncomm_positions_long_all);
    const ncShort= parseInt(r.noncomm_positions_short_all);
    const cLong  = parseInt(r.comm_positions_long_all);
    const cShort = parseInt(r.comm_positions_short_all);
    const traders= parseInt(r.traders_tot_all);
    const netSpec= ncLong - ncShort;
    const date   = (r.report_date_as_yyyy_mm_dd || '').slice(0,10);
    const pctNCL = parseFloat(r.pct_of_oi_noncomm_long_all);
    const pctNCS = parseFloat(r.pct_of_oi_noncomm_short_all);

    LOG.info(`CFTC COT: date=${date}, OI=${oi}, chg=${chg}, NC_long=${ncLong}, NC_short=${ncShort}, Comm_short=${cShort}, traders=${traders}`);

    const fmtK = n => Number.isFinite(n) ? n.toLocaleString() : '—';
    const fmtSgn = n => Number.isFinite(n) ? (n >= 0 ? '+' : '') + n.toLocaleString() : '—';

    $('cotOI').textContent      = fmtK(oi);
    $('cotDate').textContent    = date;
    $('cotNCLong').textContent  = fmtK(ncLong);
    $('cotNCShortVal').textContent = fmtK(ncShort);
    $('cotCommLong').textContent= fmtK(cLong);
    $('cotCommShortVal').textContent = fmtK(cShort);
    $('cotNetSpec').textContent = fmtSgn(netSpec);
    $('cotTradersVal').textContent = fmtK(traders);
    $('cotPctNCLong').textContent  = pctNCL.toFixed(1) + '%';
    $('cotPctNCShort').textContent = pctNCS.toFixed(1) + '%';

    // Weekly OI change colouring
    const cotOIDeltaEl = $('cotOIDelta');
    cotOIDeltaEl.textContent = fmtSgn(chg);
    $('cotOIDeltaPill').style.background = chg < 0 ? '#1a4a2e' : chg > 0 ? '#4a2a1a' : '#1a2a3a';
    cotOIDeltaEl.style.color = chg < 0 ? '#50e090' : chg > 0 ? '#f08060' : '#a7b3d6';

    // Net spec colour
    $('cotNetSpec').style.color = netSpec > 0 ? '#50e090' : '#e05060';

    $('oiNote').textContent = `✅ CFTC COT ${date}: Total OI ${fmtK(oi)} contracts (${fmtSgn(chg)} vs prev week). ${rows.length} weeks loaded.`;

    // Also expose total OI to ledger for roll chart (use cotOI as proxy for total OI)
    // The roll chart expects oiFeb/oiMar/oiLater — fill with COT total as best available
    if ($('oiFeb'))  $('oiFeb').textContent  = fmtK(oi);
    if ($('oiMar'))  $('oiMar').textContent  = '(see COT)';

  } catch(e) {
    LOG.error(`loadCOT failed: ${e.message}`);
    $('oiNote').textContent = `⚠️ CFTC COT load failed: ${e.message}`;
  }
}

// Alias kept for backward compat (roll chart calls this)
async function loadOpenInterestAndRoll(){
  return loadCOT();
}

/** ===========================
 *  DELIVERY NOTICES (PDF parsing via pdf.js)
 *  =========================== */
async function pdfToText(url){
  // Check if PDF.js is available
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('PDF.js library not loaded. Check network connection and CDN access.');
  }
  const ab = await fetchArrayBuffer(url);
  // iOS Safari (and some iOS file-preview servers like Textastic) can fail WebWorker fetches.
  // We attempt normal worker mode first; on failure we fall back to main-thread parsing.
  let doc;
  try {
    doc = await pdfjsLib.getDocument({data:ab}).promise;
  } catch (err1) {
    LOG.warn(`PDF: Worker mode failed, retrying with disableWorker=true :: ${String(err1?.message || err1)}`);
    try {
      // IMPORTANT: pass disableWorker to getDocument; setting pdfjsLib.disableWorker
      // is not sufficient in some builds and still tries to load the worker.
      doc = await pdfjsLib.getDocument({data:ab, disableWorker:true}).promise;
    } catch (err2) {
      // Re-throw the original error context plus retry context
      throw new Error(`PDF parse failed (worker + fallback). workerErr=${String(err1?.message||err1)}; fallbackErr=${String(err2?.message||err2)}`);
    }
  }
  let text = "";
  for (let p=1; p<=doc.numPages; p++){
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map(it=>it.str);
    text += "\n" + strings.join(" ");
  }
  return text;
}

// Extract MTD delivery notices for COMEX 5000 Silver Futures.
//
// PDF structure (all whitespace collapsed by PDF.js):
//   CONTRACT: FEBRUARY 2026 COMEX 5000 SILVER FUTURES INTENT DATE DAILY TOTAL CUMULATIVE _____
//   01/29/2026 1,881 1,881  01/30/2026 633 2,514  ...  02/11/2026 3 4,595
//
// IMPORTANT: The section header includes the CONTRACT MONTH (e.g. "FEBRUARY 2026").
// The same product section may appear TWICE due to page-break header repetition.
// We search for the focus month first (MARCH 2026), then fall back to current month.
// Among duplicate sections for the same month, pick the one with the MOST date rows.
//
function parseMtdSilver(text){
  const t = text.replace(/\s+/g," ").toUpperCase();

  // Build month names to search in priority order:
  // 1. Focus month (MARCH 2026)
  // 2. Current delivery month (FEBRUARY 2026 - the active contract right now)
  const monthNames = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE",
                      "JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
  const focusMonthName = monthNames[CFG.focusMonth.monthIndex]; // "MARCH"
  const focusYear = CFG.focusMonth.year;                         // 2026

  // The month BEFORE the focus month = current delivery month
  const prevMonthIndex = CFG.focusMonth.monthIndex === 0 ? 11 : CFG.focusMonth.monthIndex - 1;
  const prevYear = CFG.focusMonth.monthIndex === 0 ? focusYear - 1 : focusYear;
  const prevMonthName = monthNames[prevMonthIndex]; // "FEBRUARY"

  // Search patterns in priority order
  const searchPatterns = [
    { label: `${focusMonthName} ${focusYear}`, term: `CONTRACT: ${focusMonthName} ${focusYear} COMEX 5000 SILVER` },
    { label: `${prevMonthName} ${prevYear}`,   term: `CONTRACT: ${prevMonthName} ${prevYear} COMEX 5000 SILVER` },
    { label: "any COMEX 5000 SILVER",           term: `COMEX 5000 SILVER FUTURES` },
  ];

  for (const {label, term} of searchPatterns) {
    // Find ALL occurrences (may repeat due to page breaks)
    const positions = [];
    let pos = 0;
    while (true) {
      const idx = t.indexOf(term, pos);
      if (idx === -1) break;
      positions.push(idx);
      pos = idx + 1;
    }
    if (positions.length === 0) continue;

    LOG.info(`PDF: Found ${positions.length} "${label}" section(s) at positions: ${positions.join(', ')}`);

    // Parse each section. The PDF often repeats the same section due to page breaks.
    // We must pick the *most recent* section (latest last date), not necessarily the
    // one with the most rows. (Example: one section can end at 02/09 while a later
    // repeat ends at 02/23 with fewer rows.)
    let best = null;
    for (const idx of positions) {
      // Window: from section start to next CONTRACT: or N chars, whichever comes first.
      // Keep this reasonably large to capture late-month lines that may appear on later pages.
      const nextContract = t.indexOf("CONTRACT:", idx + 50);
      const WIN_CHARS = 12000;
      const winEnd = nextContract > idx ? Math.min(nextContract, idx + WIN_CHARS) : idx + WIN_CHARS;
      const win = t.slice(idx, Math.min(t.length, winEnd));

      const dateRows = [...win.matchAll(/(\d{2}\/\d{2}\/\d{4})\s+([\d,]+)\s+([\d,]+)/g)];
      if (dateRows.length === 0) {
        LOG.info(`PDF: Section at ${idx}: no date rows found`);
        continue;
      }

      const lastRow = dateRows[dateRows.length - 1];
      const daily = parseNumberLoose(lastRow[2]);
      const cumulative = parseNumberLoose(lastRow[3]);
      const lastDateStr = lastRow[1];
      const lastDate = (() => {
        // MM/DD/YYYY
        const m = lastDateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!m) return null;
        const mm = parseInt(m[1], 10);
        const dd = parseInt(m[2], 10);
        const yy = parseInt(m[3], 10);
        if (!mm || !dd || !yy) return null;
        return new Date(Date.UTC(yy, mm - 1, dd));
      })();
      LOG.info(`PDF: Section at ${idx} (${label}): ${dateRows.length} rows, last=${lastRow[1]}, daily=${daily}, cumul=${cumulative}`);

      if (Number.isFinite(cumulative)) {
        if (!best) {
          best = {daily, cumulative, rows: dateRows.length, idx, label, lastDate, lastDateStr};
        } else {
          const a = best.lastDate instanceof Date ? best.lastDate.getTime() : -Infinity;
          const b = lastDate instanceof Date ? lastDate.getTime() : -Infinity;
          // Prefer the latest lastDate; tie-break by higher cumulative then more rows.
          if (b > a || (b === a && cumulative > best.cumulative) || (b === a && cumulative === best.cumulative && dateRows.length > best.rows)) {
            best = {daily, cumulative, rows: dateRows.length, idx, label, lastDate, lastDateStr};
          }
        }
      }
    }

    if (best) {
      LOG.info(`PDF: Using best section at ${best.idx}: label="${best.label}", rows=${best.rows}, cumulative=${best.cumulative}`);
      return {daily: best.daily, cumulative: best.cumulative, contractLabel: best.label};
    }
  }

  LOG.error("PDF: Could not extract silver delivery data from any section");
  return null;
}


async function fetchCmeSilverMarginPct(){
  // CME's margins page is JS-rendered (often empty in raw HTML). Reliable option: parse the latest CME Clearing advisory PDF.
  // If parsing fails for any reason, fall back to 18% and clearly log the reason.
  try{
    if (typeof pdfjsLib !== 'undefined' && CFG.urlMarginAdvisoryPdf) {
      const txt = await pdfToText(CFG.urlMarginAdvisoryPdf);
      const t = txt.replace(/\s+/g, " ").toUpperCase();

      // Prefer SI (COMEX 5000 Silver) then SIT (Trade-at-Settle), Non-HRP, Month1.
      // Advisory table columns include multiple % values; the last % on the line is typically "New Initial".
      const candidates = [
        /\bSI\b\s+NON\s*-\s*HRP\s+MNTH1\s+\w+\s+USD\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/,
        /\bSIT\b\s+NON\s*-\s*HRP\s+MNTH1\s+\w+\s+USD\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/,
      ];

      for (const re of candidates) {
        const m = t.match(re);
        if (m) {
          // m[4] = last % on the line (New Initial)
          const v = parseFloat(m[4]);
          if (Number.isFinite(v) && v > 1 && v < 50) {
            LOG.info(`Margin % parsed from advisory PDF: ${v}% (source=${CFG.urlMarginAdvisoryPdf})`);
            return v / 100;
          }
        }
      }

      // If the exact line format changes, do a more permissive search around "COMEX 5000" and "SILVER".
      // Strategy: find a short window containing SI/SIT + NON-HRP + MNTH1, then take the last % token in that window.
      const idx = t.indexOf("COMEX 5000");
      if (idx >= 0) {
        const win = t.slice(idx, idx + 30000);

        const scanOne = (anchor) => {
          const ai = win.indexOf(anchor);
          if (ai < 0) return null;
          const seg = win.slice(ai, ai + 1200);
          if (!(seg.includes("NON-HRP") || seg.includes("NON - HRP")) || !seg.includes("MNTH1")) return null;
          const perc = [...seg.matchAll(/(\d+(?:\.\d+)?)%/g)].map(m => parseFloat(m[1])).filter(v => Number.isFinite(v));
          if (!perc.length) return null;
          // Heuristic: "New Initial" is usually the last % on the row.
          const v = perc[perc.length - 1];
          if (Number.isFinite(v) && v > 1 && v < 50) return v;
          return null;
        };

        // Try SI and SIT in order.
        let v = scanOne(" SI ");
        if (!Number.isFinite(v)) v = scanOne(" SIT ");
        if (Number.isFinite(v)) {
          LOG.info(`Margin % parsed (fallback scan) from advisory PDF: ${v}% (source=${CFG.urlMarginAdvisoryPdf})`);
          return v / 100;
        }

        // Extra fallback: search any segment that contains BOTH tokens, then pull last %.
        let tokenIdx = win.indexOf("NON-HRP");
        if (tokenIdx < 0) tokenIdx = win.indexOf("NON - HRP");
        if (tokenIdx >= 0) {
          const seg = win.slice(Math.max(0, tokenIdx - 600), tokenIdx + 1800);
          if (seg.includes("MNTH1")) {
            const perc = [...seg.matchAll(/(\d+(?:\.\d+)?)%/g)].map(m => parseFloat(m[1])).filter(v => Number.isFinite(v));
            if (perc.length) {
              const vv = perc[perc.length - 1];
              if (Number.isFinite(vv) && vv > 1 && vv < 50) {
                LOG.info(`Margin % parsed (token window) from advisory PDF: ${vv}% (source=${CFG.urlMarginAdvisoryPdf})`);
                return vv / 100;
              }
            }
          }
        }

        // Debug hint (small) so logs can show what we were scanning.
        LOG.warn(`Margin % advisory scan failed. Window preview="${win.slice(0, 220).replace(/\s+/g,' ').trim()}..."`);
      }
      throw new Error("Advisory PDF loaded but could not locate a Non-HRP Mnth1 % row for SI/SIT");
    }

    // Last resort: try the margins page HTML (usually empty without JS), then fall back.
    const resp = await fetchLogged(CFG.urlMarginsPage, {cache:"no-store"});
    if(!resp.ok) throw new Error("HTTP "+resp.status);
    const html = (await resp.text()) || "";
    const upper = html.toUpperCase();
    const m = upper.match(/(\d{1,2}(?:\.\d{1,2})?)\s*%/);
    if (m) {
      const v = parseFloat(m[1]);
      if (Number.isFinite(v) && v > 1 && v < 50) {
        LOG.info(`Margin % parsed from margins page HTML: ${v}%`);
        return v/100;
      }
    }
    throw new Error("Margins page HTML had no usable % (likely JS-rendered)");
  }catch(e){
    try { LOG.warn("Margin % fetch/parse failed; fallback 18%. Reason: " + (e && e.message ? e.message : e)); } catch {}
    return 0.18;
  }
}

function parseDailyIssuesStopsForFocusMonth(text){
  const t = text.replace(/\s+/g," ").toUpperCase();

  const monthNames = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
  const focusMonthName = monthNames[CFG.focusMonth.monthIndex];
  const focusYear = CFG.focusMonth.year;

  let bizDate = null;
  const bizM = t.match(/BUSINESS\s+DATE:\s*(\d{2}\/\d{2}\/\d{4})/);
  if(bizM) bizDate = bizM[1];

  // CME PDFs are not fully stable. Try a few ways to anchor the focus-month section.
  const secRes = [
    new RegExp(`CONTRACT:\\s*${focusMonthName}\\s+${focusYear}\\s+COMEX\\s+5000\\s+SILVER\\s+FUTURES`),
    new RegExp(`${focusMonthName}\\s+${focusYear}[^A-Z0-9]{0,20}COMEX[^A-Z0-9]{0,20}5000[^A-Z0-9]{0,20}SILVER[^A-Z0-9]{0,20}FUTURES`),
    new RegExp(`${focusMonthName}\\s+${focusYear}[\\s\\S]{0,80}5000[\\s\\S]{0,80}SILVER[\\s\\S]{0,80}FUTURES`),
  ];
  let secIdx = -1;
  for (const re of secRes){
    secIdx = t.search(re);
    if (secIdx >= 0) break;
  }
  if(secIdx < 0) return null;

  const slice = t.slice(secIdx, secIdx + 15000);

  let issued=null, stopped=null;

  // Pattern A: "TOTAL <issued> <stopped>"
  const totalM = slice.match(/\bTOTAL\b\s+(\d{1,7})\s+(\d{1,7})\b/);
  if(totalM){
    issued = parseInt(totalM[1],10);
    stopped = parseInt(totalM[2],10);
  }

  // Pattern B: explicit labels
  if(!Number.isFinite(issued) || !Number.isFinite(stopped)){
    const alt = slice.match(/\bISSUED\b\s+(\d{1,7})[\s\S]{0,40}?\bSTOPPED\b\s+(\d{1,7})/);
    if(alt){
      issued = parseInt(alt[1],10);
      stopped = parseInt(alt[2],10);
    }
  }

  // Pattern C: look for a SILVER line with two adjacent integers
  if(!Number.isFinite(issued) || !Number.isFinite(stopped)){
    const row = slice.match(/\bSILVER\b[\s\S]{0,220}?(\d{1,7})\s+(\d{1,7})\b/);
    if(row){
      issued = parseInt(row[1],10);
      stopped = parseInt(row[2],10);
    }
  }

  // Pattern D: as a last resort, take the first two integers in the section.
  if(!Number.isFinite(issued) || !Number.isFinite(stopped)){
    const nums = slice.match(/\b\d{1,7}\b/g) || [];
    if(nums.length >= 2){
      issued = parseInt(nums[0],10);
      stopped = parseInt(nums[1],10);
    }
  }

  return { bizDate, issued: Number.isFinite(issued)?issued:null, stopped: Number.isFinite(stopped)?stopped:null };
}


// Throttled wrapper for iOS: avoid heavy PDF work too frequently in Live mode
const _DLV_LITE = { lastOk: 0, minMs: 30*60*1000 };
async function fetchDailyIssuesStopsAndUpdateThrottled(force=false){
  const now = Date.now();
  if(!force && (now - _DLV_LITE.lastOk) < _DLV_LITE.minMs){
    return; // throttle
  }
  await fetchDailyIssuesStopsAndUpdate();
  _DLV_LITE.lastOk = Date.now();
}
async function fetchDailyIssuesStopsAndUpdate(){
  try{
    const text = await pdfToText(CFG.urlDlvDailyPdf);
    const parsed = parseDailyIssuesStopsForFocusMonth(text);
    if(!parsed){
      $("cmDlvBizDate").textContent = "—";
      $("cmDlvIssued").textContent = "—";
      $("cmDlvStopped").textContent = "—";
      return;
    }
    $("cmDlvBizDate").textContent = parsed.bizDate || "—";
    $("cmDlvIssued").textContent = Number.isFinite(parsed.issued) ? fmtInt(parsed.issued) : "NOT RUN";
    $("cmDlvStopped").textContent = Number.isFinite(parsed.stopped) ? fmtInt(parsed.stopped) : "NOT RUN";
  }catch(e){
    try { LOG.warn("Daily Issues/Stops fetch/parse failed: " + (e && e.message ? e.message : e)); } catch {}
    $("cmDlvBizDate").textContent = "—";
    $("cmDlvIssued").textContent = "—";
    $("cmDlvStopped").textContent = "—";
  }
}

const _DLV_MTD = { lastOk: 0, minMs: 2*60*1000 }; // 2 min // 30 min
async function loadDeliveriesThrottled(force=false){
  const now = Date.now();
  if(!force && (now - _DLV_MTD.lastOk) < _DLV_MTD.minMs) return;
  await loadDeliveries();
  _DLV_MTD.lastOk = Date.now();
}

async function loadDeliveries(){
  LOG.info('Deliveries step START');
  const text = await pdfToText(CFG.urlDlvMtdPdf);
  const parsed = parseMtdSilver(text);

  if (!parsed || !Number.isFinite(parsed.cumulative)){
    $("mtdContracts").textContent = "—";
    $("mtdOunces").textContent = "—";
    $("dlvNote").textContent =
      "Could not locate COMEX 5000 Silver Futures row in the MTD PDF. PDF layout may have changed — tweak parseMtdSilver().";
    return {mtdContracts:null};
  }

  const mtd = parsed.cumulative;
  $("mtdContracts").textContent = fmtInt(mtd);
  $("cmDlvMtdContracts").textContent = fmtInt(mtd);
  try{
    const key = 'mtd_contracts_history_v1';
    const hist = JSON.parse(localStorage.getItem(key) || '{}');
    const dKey = utcDateKey();
    hist[dKey] = { mtdContracts: mtd, ts: Date.now() };
    localStorage.setItem(key, JSON.stringify(hist));
  }catch(_e){}

  $("mtdOunces").textContent = fmtInt(mtd * CFG.contractSizeOz);

  // Ledger patch + day-before delta
  const key = "comex_silver_roll_ledger_v1";
  const ledger = JSON.parse(localStorage.getItem(key) || "{}");
  const today = utcDateKey();
  const dates = Object.keys(ledger).filter(k=>/^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  // Previous date must be strictly before today (otherwise delta is always null).
  const prevDate = (() => {
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i] < today) return dates[i];
    }
    return null;
  })();
  const prev = prevDate ? ledger[prevDate] : null;

  if (!ledger[today]) ledger[today] = {ts:Date.now()};
  ledger[today].mtdContracts = mtd;
  localStorage.setItem(key, JSON.stringify(ledger));

  const d = (prev && Number.isFinite(prev.mtdContracts) && Number.isFinite(mtd)) ? (mtd - prev.mtdContracts) : null;
  $("mtdDelta").textContent = fmtSigned(d);

  const pill = $("mtdDeltaPill");
  pill.classList.remove("ok","warn","bad");
  if (d === null) pill.classList.add("warn");
  else if (d > 0) pill.classList.add("ok");
  else pill.classList.add("warn");

  $("dlvNote").textContent = (() => {
    const lbl = (parsed.contractLabel || "unknown contract").toUpperCase();
    return lbl.includes("MARCH 2026")
      ? "Showing MARCH 2026 delivery notices (MTD from CME PDF)"
      : `Showing ${parsed.contractLabel || "current month"} delivery notices — March 2026 deliveries begin First Notice Day (Feb 27). Will switch to March automatically.`;
  })()

  return {mtdContracts:mtd};
}

/** ===========================
 *  COUNTDOWN (rule-based FND approximation)
 *  =========================== */
function isWeekend(d){ const day=d.getUTCDay(); return day===0||day===6; }
function lastBusinessDayOfMonthUTC(year, monthIndex){
  // monthIndex: 0-11
  const d = new Date(Date.UTC(year, monthIndex+1, 0, 0, 0, 0)); // last day of month
  while (isWeekend(d)) d.setUTCDate(d.getUTCDate()-1);
  return d;
}
function monthNameToIndex(name){
  const m = name.toLowerCase().slice(0,3);
  const map = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  return map[m];
}

async function getOfficialFirstNoticeUTC(){
  // STRATEGY 1: Try the CME ProductCalendar XLS download (same XLSX library we already use)
  // This is a machine-readable spreadsheet that doesn't require JS rendering
  try {
    if (typeof XLSX !== 'undefined') {
      const ab = await fetchArrayBuffer(CFG.urlProductCalendarXls);
      const wb = XLSX.read(ab, {type:"array"});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:false});

      const focusMonthStr = `${CFG.focusMonth.year}-${String(CFG.focusMonth.monthIndex+1).padStart(2,"0")}`;
      // Row format: Contract Month | First Notice | Last Notice | First Delivery | Last Delivery | Last Trade
      // Dates may be in various formats - scan all rows
      for (const r of rows) {
        const joined = r.map(v => String(v ?? "")).join("|").toUpperCase();
        // Look for March 2026 in various formats: "MAR 2026", "MARCH 2026", "2026-03", "SIH26"
        const isMarch2026 = joined.includes("MAR") && joined.includes("2026") ||
                            joined.includes("SIH26") ||
                            joined.includes("SIH 26") ||
                            joined.includes("2026-03");
        if (!isMarch2026) continue;

        LOG.info(`Calendar XLS: Found March 2026 row: ${joined.slice(0,200)}`);

        // Collect all February 2026 dates present in the March 2026 row.
// The calendar XLS row contains multiple February dates (e.g. First Position Day and First Notice Day).
// We want First Notice Day, which is typically the *latest* February 2026 date in that row.
        const feb2026 = [];
        for (let ci = 0; ci < r.length; ci++) {
          const cell = String(r[ci] ?? "").trim();
          // Try MM/DD/YYYY format
          let m = cell.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (m) {
            const mo = Number(m[1]) - 1, dy = Number(m[2]), yr = Number(m[3]);
            if (yr === 2026 && mo === 1) { // February 2026
              feb2026.push(new Date(Date.UTC(yr, mo, dy, 0, 0, 0)));
            }
            continue;
          }
          // Try YYYY-MM-DD format
          m = cell.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (m) {
            const yr = Number(m[1]), mo = Number(m[2]) - 1, dy = Number(m[3]);
            if (yr === 2026 && mo === 1) {
              feb2026.push(new Date(Date.UTC(yr, mo, dy, 0, 0, 0)));
            }
          }
        }

        if (feb2026.length) {
          // Pick the latest date in Feb 2026 present in the row (this matches First Notice Day for SIH26 in practice).
          let best = feb2026[0];
          for (const d of feb2026) if (d.getTime() > best.getTime()) best = d;
          const iso = best.toISOString().slice(0,10);
          LOG.info(`Calendar XLS: February 2026 dates found in row: ${feb2026.map(d => d.toISOString().slice(0,10)).join(", ")} (picked ${iso} as First Notice Day)`);
          return best;
        }
      } // end: for (const r of rows)

      LOG.info("Calendar XLS: March 2026 row not found or date not parseable in XLS");
    } // end: if (typeof XLSX !== 'undefined')
  } catch(e) {
    LOG.error(`Calendar XLS strategy failed: ${e.message}`);
  }

  // STRATEGY 2: Try the HTML calendar page (JS-rendered, may not work server-side but works in browser)
  try {
    const res = await fetch(CFG.urlSilverCalendarPage, {cache:"no-store"});
    if (res.ok) {
      const htmlText = await res.text();
      const upper = htmlText.toUpperCase();
      // CME embeds calendar data as JSON in a script tag - search for firstNotice date
      // Pattern: "firstNotice":"2026-02-27" or similar
      const jsonDateMatch = upper.match(/FIRSTNOTICE[\":\s]+(\d{4}-\d{2}-\d{2})/);
      if (jsonDateMatch) {
        const [yr, mo, dy] = jsonDateMatch[1].split("-").map(Number);
        LOG.info(`Calendar HTML: Found firstNotice in JSON: ${jsonDateMatch[1]}`);
        return new Date(Date.UTC(yr, mo-1, dy, 0, 0, 0));
      }
      // Try "27 FEB 2026" style date near "FIRST NOTICE"
      const win = upper.slice(0, upper.length);
      const m1 = win.match(/FIRST\s*NOTICE[\":\s,\]}{]+(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})/);
      if (m1) {
        const dy = Number(m1[1]), mo = monthNameToIndex(m1[2]), yr = Number(m1[3]);
        LOG.info(`Calendar HTML: Found First Notice date: ${m1[1]} ${m1[2]} ${m1[3]}`);
        return new Date(Date.UTC(yr, mo, dy, 0, 0, 0));
      }
      LOG.info("Calendar HTML: No First Notice date found in page");
    }
  } catch(e) {
    LOG.error(`Calendar HTML strategy failed: ${e.message}`);
  }

  // STRATEGY 3: Hardcoded known dates for active contracts
  // March 2026 (SIH26) First Notice Day = February 27, 2026 (published by CME)
  const knownDates = {
    "2026-03": new Date(Date.UTC(2026, 1, 27, 0, 0, 0)), // Feb 27 2026
    "2026-05": new Date(Date.UTC(2026, 4, 29, 0, 0, 0)), // May 29 2026 (approx)
    "2026-07": new Date(Date.UTC(2026, 6, 30, 0, 0, 0)), // Jul 30 2026 (approx)
  };
  const focusKey = `${CFG.focusMonth.year}-${String(CFG.focusMonth.monthIndex+1).padStart(2,"0")}`;
  if (knownDates[focusKey]) {
    LOG.info(`Calendar: Using hardcoded First Notice date for ${focusKey}: ${knownDates[focusKey].toISOString()}`);
    return knownDates[focusKey];
  }

  // STRATEGY 4: Calculate estimated date (last business day of month before delivery month)
  const estimatedFnd = lastBusinessDayOfMonthUTC(CFG.focusMonth.year, CFG.focusMonth.monthIndex - 1);
  LOG.info(`Calendar: Using estimated First Notice date (last biz day of prior month): ${estimatedFnd.toISOString()}`);
  return estimatedFnd;
}

let _officialFndCache = null;
let _officialFndCacheTs = 0;
let _fndFetchFailed = false; // Track if last fetch failed to avoid hammering

// Settlement snapshot price cache (per tradeDate YYYYMMDD)
const _settlePxCache = new Map();

function _yyyymmddFromISODate(isoDate){
  // isoDate: "YYYY-MM-DD"
  return String(isoDate||'').replace(/-/g,'');
}

function _parseFloatLoose(v){
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/,/g,'').trim());
  return Number.isFinite(n) ? n : null;
}

async function getCmeSettlementPriceUsdOzForSIH26(tradeDateYYYYMMDD){
  // Fetch CME official settlements for the given trade date.
  // Endpoint format: .../Settlements/458/FUT?strategy=DEFAULT&tradeDate=YYYYMMDD&pageSize=500
  // We then locate the SIH26 / MAR26 row and read settlement price.
  if (!/^[0-9]{8}$/.test(tradeDateYYYYMMDD||'')) return null;
  if (_settlePxCache.has(tradeDateYYYYMMDD)) return _settlePxCache.get(tradeDateYYYYMMDD);

  const url = `${CFG.urlCmeSettleBase}?strategy=DEFAULT&tradeDate=${tradeDateYYYYMMDD}&pageSize=500`;
  try{
    LOG.info(`CME Settlements FETCH: ${url}`);
    const res = await fetch(url, { cache:'no-store', headers: { 'Accept':'application/json, text/plain, */*', 'Referer':'https://www.cmegroup.com/markets/metals/precious/silver.html' } });
    if (!res.ok){
      LOG.warn(`CME Settlements: HTTP ${res.status}`);
      _settlePxCache.set(tradeDateYYYYMMDD, null);
      return null;
    }
    const raw = await res.text();
    LOG.info(`CME Settlements: length=${raw.length}, preview=${raw.slice(0,160)}`);
    const data = JSON.parse(raw);
    const rows = Array.isArray(data) ? data
      : (data.settlements || data.data || data.items || data.results || []);

    // Find the March 2026 (SIH26 / MAR26) row
    const pick = (rows||[]).find(r => {
      const s = (r.symbol || r.globexCode || r.contract || r.contractMonth || r.month || r.expiration || r.maturity || r.instrumentName || '').toString().toUpperCase();
      return s.includes('SIH26') || s.includes('MAR26') || (s.includes('MAR') && s.includes('26'));
    }) || null;

    if (!pick){
      LOG.warn('CME Settlements: SIH26/MAR26 row not found');
      _settlePxCache.set(tradeDateYYYYMMDD, null);
      return null;
    }

    const px = _parseFloatLoose(
      pick.settlementPrice ?? pick.settle ?? pick.settlement ?? pick.final ?? pick.price ?? pick.settlePrice ?? pick.settlement_price
    );

    if (!Number.isFinite(px)){
      LOG.warn('CME Settlements: settlement price field missing/unparseable for SIH26/MAR26');
      _settlePxCache.set(tradeDateYYYYMMDD, null);
      return null;
    }
    _settlePxCache.set(tradeDateYYYYMMDD, px);
    LOG.info(`CME Settlements: SIH26 settlement=${px}`);
    return px;
  }catch(e){
    LOG.error(`CME Settlements failed: ${e.message}`);
    _settlePxCache.set(tradeDateYYYYMMDD, null);
    return null;
  }
}

async function renderSettlementSnapshotPrice(targetUTC){
  // targetUTC is a Date anchored to 18:25 UTC (12:25 CT) on the target day.
  try{
    const elUsd = $('kpiSettlementSnapUSD');
    const elGbp = $('kpiSettlementSnapGBP');

    // If the target settlement moment is in the future, CME will not have an official
    // settlement price published yet. In that case, show "pending" and (optionally)
    // a live proxy using the current SIH26 last price.
    const now = Date.now();
    if (targetUTC && targetUTC.getTime() > (now + 60*1000)){
      const live = Number.isFinite(STATE.comexSih26Last) ? STATE.comexSih26Last : null;
      if (elUsd) elUsd.textContent = Number.isFinite(live) ? ('$' + live.toFixed(3) + ' (pending)') : 'pending';
      const gbpRate = Number.isFinite(STATE.usdGbp) ? STATE.usdGbp : null;
      const liveGbp = (Number.isFinite(live) && Number.isFinite(gbpRate)) ? (live * gbpRate) : null;
      if (elGbp) elGbp.textContent = Number.isFinite(liveGbp) ? ('£' + liveGbp.toFixed(3) + ' (pending)') : 'pending';
      return;
    }

    const isoDay = targetUTC.toISOString().slice(0,10);
    const tradeDate = _yyyymmddFromISODate(isoDay);
    let pxUsd = await getCmeSettlementPriceUsdOzForSIH26(tradeDate);
    // Fallback: CME settlements endpoint often returns empty; use prior settle from quotes when available.
    if (!Number.isFinite(pxUsd)) {
      pxUsd = Number.isFinite(STATE.sih26PriorSettleUsd) ? STATE.sih26PriorSettleUsd : (Number.isFinite(STATE.frontPriorSettleUsd) ? STATE.frontPriorSettleUsd : null);
    }
    if (elUsd) elUsd.textContent = Number.isFinite(pxUsd) ? ('$' + pxUsd.toFixed(3) + ' (prior settle)') : '—';

    const gbpRate = Number.isFinite(STATE.usdGbp) ? STATE.usdGbp : null;
    const pxGbp = (Number.isFinite(pxUsd) && Number.isFinite(gbpRate)) ? (pxUsd * gbpRate) : null;
    if (elGbp) elGbp.textContent = Number.isFinite(pxGbp) ? ('£' + pxGbp.toFixed(3)) : '—';
  }catch(e){
    LOG.error('Settlement snapshot price render failed: ' + e.message);
  }
}

async function renderCountdown(){
  // Cache the calendar fetch for 6 hours to avoid hammering CME
  const now = Date.now();
  
  // If cache exists and is still valid (< 6 hours old), use it
  // Countdown target: CME daily settlement moment for SIH26 on the LAST DAY BEFORE FIRST NOTICE DAY.
  // CME publishes the First Notice Day date (FND). We anchor the countdown to the prior day
  // at the SI daily settlement minute. For Silver (SI), the active-month settlement period is
  // 12:24:00–12:25:00 CT; we use 12:25:00 CT as the timestamp.
  // In February, Chicago is CST (UTC-6), so 12:25 CT = 18:25 UTC.
  function _settlementTargetFromFndUTC(fndUTC00){
    const priorDay = new Date(fndUTC00.getTime() - 24*3600*1000);
    return new Date(Date.UTC(priorDay.getUTCFullYear(), priorDay.getUTCMonth(), priorDay.getUTCDate(), 18, 25, 0));
  }

  if (_officialFndCache && (now - _officialFndCacheTs) < 6*3600*1000){
    const fnd = _officialFndCache;
    const target = _settlementTargetFromFndUTC(fnd);
    if ($("kpiFndDate")) $("kpiFndDate").textContent = fnd.toISOString().slice(0,10);
    $("kpiCountdownTarget").textContent = `${target.toISOString().slice(0,10)} 12:25 CT (18:25 UK)`;
    // Render settlement snapshot price for that target trade date (official settle when available)
    await renderSettlementSnapshotPrice(target);
    
    const nowDt = new Date();
    const ms = target.getTime() - nowDt.getTime();
    if (ms <= 0){
      $("kpiCountdown").textContent = "0d 00:00:00";
      return;
    }
    const sec = Math.floor(ms/1000);
    const d = Math.floor(sec/86400);
    const h = Math.floor((sec%86400)/3600);
    const mi = Math.floor((sec%3600)/60);
    const s = sec%60;
    $("kpiCountdown").textContent = `${d}d ${String(h).padStart(2,"0")}:${String(mi).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    setTag("tag_kpiCountdown","proxy","Countdown computed from cached CME First Notice Day date");
    return;
  }
  
  // If last fetch failed recently, wait 5 minutes before retrying
  if (_fndFetchFailed && (now - _officialFndCacheTs) < 5*60*1000){
    $("kpiCountdown").textContent = "Fetch failed";
    $("kpiCountdownTarget").textContent = "retrying soon...";
    return;
  }
  
  // Try to fetch new data
  try {
    _officialFndCache = await getOfficialFirstNoticeUTC();
    _officialFndCacheTs = now;
    _fndFetchFailed = false; // Success, clear error flag
    
    const fnd = _officialFndCache;
    const target = _settlementTargetFromFndUTC(fnd);
    if ($("kpiFndDate")) $("kpiFndDate").textContent = fnd.toISOString().slice(0,10);
    $("kpiCountdownTarget").textContent = `${target.toISOString().slice(0,10)} 12:25 CT (18:25 UK)`;
    // Render settlement snapshot price for that target trade date (official settle when available)
    await renderSettlementSnapshotPrice(target);
    
    const nowDt = new Date();
    const ms = target.getTime() - nowDt.getTime();
    if (ms <= 0){
      $("kpiCountdown").textContent = "0d 00:00:00";
      return;
    }
    const sec = Math.floor(ms/1000);
    const d = Math.floor(sec/86400);
    const h = Math.floor((sec%86400)/3600);
    const mi = Math.floor((sec%3600)/60);
    const s = sec%60;
    $("kpiCountdown").textContent = `${d}d ${String(h).padStart(2,"0")}:${String(mi).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    setTag("tag_kpiCountdown","proxy","Countdown computed from CME product calendar (FND)");
  } catch (e) {
    // Fetch failed, mark timestamp and set error flag
    _officialFndCacheTs = now;
    _fndFetchFailed = true;
    LOG.error('Failed to fetch First Notice date: ' + String(e));
    $("kpiCountdown").textContent = "—";
    $("kpiCountdownTarget").textContent = "fetch failed";
    if ($("kpiFndDate")) $("kpiFndDate").textContent = "—";
    setTag("tag_kpiCountdown","missing","Countdown unavailable (failed to fetch FND)");
  }
}

/** ===========================
 *  ROLL CHART + TABLE
 *  =========================== */
let rollChart = null;
let lbmaChart = null;

function rollingAvg(arr, window=7){
  const out = [];
  for (let i=0;i<arr.length;i++){
    let start = Math.max(0, i-window+1);
    let slice = arr.slice(start, i+1).filter(v => Number.isFinite(v));
if (!slice.length) out.push(null);
    else out.push(slice.reduce((a,b)=>a+b,0)/slice.length);
  }
  return out;
}

async function buildRollUI(){
  try{
    const tbody = document.querySelector('#rollTbl tbody');
    const meta = $('rollMeta');
    if (!tbody) return;

    const OI_HIST_KEY = 'march_oi_history_v1';
    const MTD_HIST_KEY = 'mtd_contracts_history_v1';

    const oiHist = JSON.parse(localStorage.getItem(OI_HIST_KEY) || '{}');
    const mtdHist = JSON.parse(localStorage.getItem(MTD_HIST_KEY) || '{}');

    const dates = Array.from(new Set([
      ...Object.keys(oiHist),
      ...Object.keys(mtdHist),
    ].filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)))).sort().reverse();

    // Fallback: if history is thin (e.g., fresh install), derive the last 10 days from the main ledger.
    // This prevents the Roll card showing only 1 day.
    if (dates.length < 2){
      try{
        const ledger = JSON.parse(localStorage.getItem('comex_silver_roll_ledger_v1') || '{}');
        for (const d of Object.keys(ledger)){
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
          const row = ledger[d] || {};
          if (oiHist[d] == null && Number.isFinite(row.oiMar)) oiHist[d] = { oiMar: row.oiMar, ts: row.ts || Date.now(), src: row.oiSrc || 'ledger' };
          if (mtdHist[d] == null && Number.isFinite(row.mtdContracts)) mtdHist[d] = { mtdContracts: row.mtdContracts, ts: row.ts || Date.now(), src: 'ledger' };
        }
      }catch(_e){}
    }

    const dates2 = Array.from(new Set([
      ...Object.keys(oiHist),
      ...Object.keys(mtdHist),
    ].filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)))).sort().reverse();


    const rows = dates2.slice(0,10).map((d, i) => {
      const oi = Number.isFinite(oiHist[d]?.oiMar) ? oiHist[d].oiMar : null;
      const prevDate = dates2[i+1];
      const prevOi = prevDate && Number.isFinite(oiHist[prevDate]?.oiMar) ? oiHist[prevDate].oiMar : null;
      const dOi = (oi!==null && prevOi!==null) ? (oi - prevOi) : null;

      const mtd = Number.isFinite(mtdHist[d]?.mtdContracts) ? mtdHist[d].mtdContracts : null;
      const prevMtd = prevDate && Number.isFinite(mtdHist[prevDate]?.mtdContracts) ? mtdHist[prevDate].mtdContracts : null;
      const dMtd = (mtd!==null && prevMtd!==null) ? (mtd - prevMtd) : null;

      const col = (x)=> x===null ? '—' : fmtInt(x);
      const colS = (x)=> x===null ? '—' : fmtSigned(x);

      return `<tr>
        <td>${d}</td>
        <td class="num">${col(oi)}</td>
        <td class="num">${colS(dOi)}</td>
        <td class="num">${col(mtd)}</td>
        <td class="num">${colS(dMtd)}</td>
      </tr>`;
    });

    tbody.innerHTML = rows.join('');

    if (meta){
      meta.textContent = `Source: Barchart (Mar OI) + CME delivery PDFs (MTD) · Updated: ${new Date().toLocaleTimeString()} · Showing: ${Math.min(10, dates2.length)} days`;
    }
  }catch(e){
    LOG.error('buildRollUI failed: ' + (e?.message || e));
  }
}


/** ===========================
 *  LBMA SILVER DATA
 *  v[0]=USD, v[1]=GBP, v[2]=EUR per troy oz
 *  Published each London business day
 *  CORS: access-control-allow-origin: * (confirmed)
 *  =========================== */
// Live spot proxy (USD/oz) via gold.co.uk page scrape (through r.jina.ai mirror)
async function loadLBMALiveSpot(){
  try{
    const t0 = performance.now();
    const res = await fetch(CFG.urlGoldCoUkSilverLive, { cache: 'no-store' });
    if (!res.ok) { LOG.warn(`LBMA live proxy: HTTP ${res.status}`); return null; }
    const txt = await res.text();

    // Parse "$87.28" after "Current Price"
    const mPrice = txt.match(/Current\s+Price\s*\$\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (!mPrice) { LOG.warn('LBMA live proxy: price not found'); return null; }
    const usd = parseFloat(mPrice[1]);

    // Parse "Updated: 13:28 23/02/26"
    const mUpd = txt.match(/Updated:\s*([0-9:]{3,8}\s+[0-9]{2}\/[0-9]{2}\/[0-9]{2})/i);
    const updated = mUpd ? mUpd[1] : null;

    ARB.lbmaLiveUsdOz = Number.isFinite(usd) ? usd : null;
    ARB.lbmaLiveUpdated = updated;

    // UI (LBMA card)
    if ($('lbmaLiveUSD')) $('lbmaLiveUSD').textContent = fmtUsd(usd);
    // Spread card: show the live proxy as a KPI-sized pill (color applied in updateComexLbmaSpread).
    if ($('lbmaLiveProxyUnderComex')) $('lbmaLiveProxyUnderComex').textContent = (Number.isFinite(usd) ? ('$' + usd.toFixed(3)) : '—');
    if ($('lbmaLiveUpdated')) $('lbmaLiveUpdated').textContent = updated || '—';

    // Recompute dependent UI that prefers the live proxy.
    updateArbUI();
    updateComexLbmaSpread();

    const ms = Math.round(performance.now() - t0);
    LOG.info(`LBMA live proxy: USD/oz=${usd.toFixed(2)} updated=${updated || 'n/a'} (${ms}ms)`);
    return { usd, updated };
  }catch(e){
    LOG.warn(`LBMA live proxy: ${e?.message || e}`);
    return null;
  }
}async function loadLbmaLiveProxyOnly(returnStatus=false){
  // Updates ARB.lbmaLiveUsdOz + LBMA Live card fields. Returns HTTP status if requested.
  // Preferred source: NetDania XAGUSD (mobile quote page). Fallback: gold.co.uk page.
  let _status = 200;

  async function tryNetDania(){
    const t0 = performance.now();
    const res = await fetch(CFG.urlNetDaniaXAGUSD, { cache:'no-store' });
    _status = res.status;
    if (!res.ok) throw new Error(`NetDania HTTP ${res.status}`);
    const txt = await res.text();

    // NetDania mobile page renders the quote as plain text blocks:
    // "# Silver, spot" then price on next block, then timestamp like "24-February-26 10:02:05"
    const m = txt.match(/#\s*Silver,\s*spot[\s\S]*?\n([0-9]+(?:\.[0-9]+)?)\s*\n[\s\S]*?\n([0-9]{1,2}-[A-Za-z]+-\d{2}\s+[0-9]{2}:[0-9]{2}:[0-9]{2})/);
    if (!m) throw new Error('NetDania parse: price/time not found');
    const usd = parseFloat(m[1]);
    if (!Number.isFinite(usd) || usd <= 0) throw new Error('NetDania parse: invalid price');

    const updated = m[2];

    ARB.lbmaLiveUsdOz = usd;
    const elLive = document.getElementById('lbmaLiveUsd'); if (elLive) elLive.textContent = usd.toFixed(2);
    const elUpd = document.getElementById('lbmaLiveUpdated'); if (elUpd) elUpd.textContent = updated;
    const elSrc = document.getElementById('lbmaLiveSrcPill'); if (elSrc) elSrc.textContent = 'Source: NetDania XAGUSD (realtime)';

    updateComexLbmaSpread();
    updateArbUI();

    const ms = Math.round(performance.now() - t0);
    LOG.info(`LBMA live proxy: USD/oz=${usd.toFixed(2)} updated=${updated} (NetDania, ${ms}ms)`);
    return { usd, updated, source:'netdania' };
  }

  async function tryGoldCo(){
    const t0 = performance.now();
    const res = await fetch(CFG.urlGoldCoUkSilverLive, { cache:'no-store' });
    _status = res.status;
    if (!res.ok) throw new Error(`gold.co.uk HTTP ${res.status}`);
    const txt = await res.text();

    const mPrice = txt.match(/Current\s+Price\s*\$\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (!mPrice) throw new Error('gold.co.uk parse: price not found');
    const usd = parseFloat(mPrice[1]);
    const mUpd = txt.match(/Updated\s*:\s*([0-9]{1,2}:[0-9]{2}\s+[0-9]{2}\/[0-9]{2}\/[0-9]{2})/i);
    const updated = mUpd ? mUpd[1] : new Date().toLocaleString();

    ARB.lbmaLiveUsdOz = usd;
    const elLive = document.getElementById('lbmaLiveUsd'); if (elLive) elLive.textContent = usd.toFixed(2);
    const elUpd = document.getElementById('lbmaLiveUpdated'); if (elUpd) elUpd.textContent = updated;
    const elSrc = document.getElementById('lbmaLiveSrcPill'); if (elSrc) elSrc.textContent = 'Source: gold.co.uk (scrape)';

    updateComexLbmaSpread();
    updateArbUI();

    const ms = Math.round(performance.now() - t0);
    LOG.info(`LBMA live proxy: USD/oz=${usd.toFixed(2)} updated=${updated} (gold.co.uk, ${ms}ms)`);
    return { usd, updated, source:'goldco' };
  }

  try{
    // Prefer NetDania first
    const out = await tryNetDania();
    if (returnStatus) return _status;
    return out;
  }catch(e1){
    LOG.warn(`LBMA live proxy: ${e1?.message || e1} (NetDania failed, trying fallback)`);
    try{
      const out2 = await tryGoldCo();
      if (returnStatus) return _status;
      return out2;
    }catch(e2){
      LOG.warn(`LBMA live proxy: ${e2?.message || e2}`);
      if (returnStatus) return _status;
      return null;
    }
  }
}

async function loadLBMAData(){
  try {
    // Add random param to bust cache (same pattern LBMA's own app uses)
    const r = Math.round(1e9 * Math.random());
    const [silRes, goldRes] = await Promise.all([
      fetch(`${CFG.urlLBMASilver}?r=${r}`, { cache: 'no-store' }),
      fetch(`${CFG.urlLBMAGold}?r=${r}`,   { cache: 'no-store' }),
    ]);

    if (!silRes.ok) { LOG.error(`LBMA silver: HTTP ${silRes.status}`); return; }
    const silData  = await silRes.json();
    const goldData = goldRes.ok ? await goldRes.json() : [];

    LOG.info(`LBMA silver: ${silData.length} entries, latest=${silData[silData.length-1]?.d}`);

    // Filter to valid entries (v[0] must be a number > 0)
    const valid = silData.filter(e => typeof e.v?.[0] === 'number' && e.v[0] > 0);
    if (valid.length === 0) { LOG.error('LBMA silver: no valid entries'); return; }

    const latest  = valid[valid.length - 1];
    const prev    = valid[valid.length - 2];
    const wkAgo   = valid[valid.length - 6] || valid[0]; // ~7 calendar days = ~5 trading days
    const last90  = valid.slice(-10);

    const [usd, gbp, eur] = latest.v;
    const [pusd, pgbp, peur] = prev?.v || [null, null, null];

    // Update USD fix
    $('lbmaUSD').textContent = usd.toFixed(3);
    setTag('tag_lbmaUSD','official',`LBMA silver fix JSON (${latest.d})`);
    $('lbmaDate').textContent = latest.d;
    ARB.lbmaUsdOz = Number.isFinite(usd) ? usd : null;

    // Fire-and-forget live proxy scrape (does not block the fix load)
    loadLBMALiveSpot();
    updateArbUI();
    if (pusd) {
      $('lbmaPrevUSD').textContent = pusd.toFixed(3);
      $('lbmaPrevDate').textContent = `prev: ${prev.d}`;
      const dUSD = usd - pusd;
      $('lbmaUSDDelta').textContent = (dUSD >= 0 ? '+' : '') + dUSD.toFixed(3);
      const pil = $('lbmaUSDDeltaPill');
      pil.style.background = dUSD >= 0 ? '#1a4a2e' : '#4a1a1e';
      $('lbmaUSDDelta').style.color = dUSD >= 0 ? '#50e090' : '#e05060';
    }

    // GBP
    if (gbp) {
      $('lbmaGBP').textContent = gbp.toFixed(3);
      if (pgbp) {
        const dGBP = gbp - pgbp;
        $('lbmaGBPDelta').textContent = (dGBP >= 0 ? '+' : '') + dGBP.toFixed(3);
        $('lbmaGBPDeltaPill').style.background = dGBP >= 0 ? '#1a4a2e' : '#4a1a1e';
        $('lbmaGBPDelta').style.color = dGBP >= 0 ? '#50e090' : '#e05060';
      }
    }

    // EUR
    if (eur) {
      $('lbmaEUR').textContent = eur.toFixed(3);
      if (peur) {
        const dEUR = eur - peur;
        $('lbmaEURDelta').textContent = (dEUR >= 0 ? '+' : '') + dEUR.toFixed(3);
        $('lbmaEURDeltaPill').style.background = dEUR >= 0 ? '#1a4a2e' : '#4a1a1e';
        $('lbmaEURDelta').style.color = dEUR >= 0 ? '#50e090' : '#e05060';
      }
    }

    // 7-day change
    if (wkAgo) {
      const wkChg = usd - wkAgo.v[0];
      const wkPct = ((wkChg / wkAgo.v[0]) * 100).toFixed(2);
      $('lbmaWeekChange').textContent = (wkChg >= 0 ? '+' : '') + wkChg.toFixed(3);
      $('lbmaWeekChange').style.color = wkChg >= 0 ? '#50e090' : '#e05060';
      $('lbmaWeekPct').textContent = `%: ${wkChg >= 0 ? '+' : ''}${wkPct}%`;
    }

    // 52-week high/low
    const yr = valid.slice(-260); // ~52 weeks of trading days
    let hi52 = { v: [0] }, lo52 = { v: [Infinity] };
    for (const e of yr) {
      if (e.v[0] > hi52.v[0]) hi52 = e;
      if (e.v[0] < lo52.v[0]) lo52 = e;
    }
    $('lbma52wkHigh').textContent = hi52.v[0].toFixed(3);
    $('lbma52wkHighDate').textContent = `date: ${hi52.d}`;
    $('lbma52wkLow').textContent = lo52.v[0].toFixed(3);
    $('lbma52wkLowDate').textContent = `date: ${lo52.d}`;

    // Gold/Silver Ratio (using LBMA gold AM fix if available)
    const validGold = goldData.filter(e => typeof e.v?.[0] === 'number' && e.v[0] > 0);
    if (validGold.length > 0) {
      const latestGold = validGold[validGold.length - 1];
      const gsr = latestGold.v[0] / usd;
      $('lbmaGSR').textContent = gsr.toFixed(1);
      $('lbmaGSR').style.color = gsr > 80 ? '#50e090' : gsr < 60 ? '#e05060' : '#f0d060';
      LOG.info(`LBMA GSR: Gold=${latestGold.v[0]}, Silver=${usd}, GSR=${gsr.toFixed(1)}`);
    }

    // COMEX vs LBMA spread card (prefers live proxy when available)
    updateComexLbmaSpread();

    $('lbmaNote').textContent = `✅ LBMA data loaded: ${valid.length} days of history (${valid[0]?.d} → ${latest.d})`;

    // Build LBMA 90-day chart
    await buildLBMAChart(last90);
    buildLBMATable(last90.slice().reverse()); // newest first in table

  } catch(e) {
    LOG.error(`loadLBMAData failed: ${e.message}`);
    $('lbmaNote').textContent = `⚠️ LBMA load failed: ${e.message}`;
    setTag('tag_lbmaUSD','missing',`LBMA load failed: ${e.message}`);
  }
}

// Shanghai (SGE) — Physical vs Western Paper (iOS/Textastic-friendly)
//
// FIX: goldsilver.ai page could not be parsed via r.jina.ai because the key KPI numbers are not present in the mirrored text.
// Instead, use the official Shanghai Gold Exchange (SGE) silver benchmark page which contains explicit table values.
//
// Source (official SGE page):
//   https://en.sge.com.cn/h5_data_SilverBenchmarkPrice
//
// We parse the latest Benchmark Price (prefer PM, fallback AM), which is quoted in RMB/kg,
// then convert to USD/oz using a client-side FX source (Frankfurter; fallback open.er-api.com).
//
// Display:
//   - Shanghai Physical (USD/oz)   [derived from SGE RMB/kg]
//   - Paper (COMEX SIH26 $/oz)     [already on dashboard]
//   - Premium (Shanghai - Paper)  [$ and %]
async function loadShanghaiSGE(returnStatus=false){
  let _status = 200;
  const outShanghai = document.getElementById('sgeShanghaiSpot');
  const outAsOf     = document.getElementById('sgeAsOf');
  const outRmbKg    = document.getElementById('sgeRmbKg');
  const outFx       = document.getElementById('chinaFx');

  if (!outShanghai) return;

  // Cache guard: SGE is slow-changing and can trigger mirror rate-limits.
  // If we fetched within the last 5 minutes, reuse the current UI value.
  if (!returnStatus && ARB.__sgeLastFetch && (Date.now() - ARB.__sgeLastFetch) < 300000) {
    return null;
  }

  const SRC_DIRECT = 'https://en.sge.com.cn/h5_data_SilverBenchmarkPrice';
  const SRC_MIRROR = 'https://r.jina.ai/http://en.sge.com.cn/h5_data_SilverBenchmarkPrice';

  function setDash(){
    outShanghai.textContent = '—';
    setTag('tag_sgeShanghaiSpot','missing','SGE benchmark unavailable');
    if (outAsOf) outAsOf.textContent = '—';
    if (outRmbKg) outRmbKg.textContent = '—';
    if (outFx) outFx.textContent = Number.isFinite(ARB.usdPerCny) ? ARB.usdPerCny.toFixed(6) : '—';
  }

  async function fetchTextWithMirror(){
    const inRestrictedEnv = isIOSLike() || (location && location.protocol === 'file:');
    if (inRestrictedEnv){
      // Direct fetch commonly fails due to CORS/blocked fetch in iOS preview/webview contexts.
      LOG.info('FETCH GET ' + SRC_MIRROR);
      const r = await fetch(SRC_MIRROR, {cache:'no-store'});
      _status = r.status;
      _status = r.status;
      if (!r.ok) throw new Error('HTTP '+r.status);
      return {used:'mirror', txt: await r.text()};
    }

    LOG.info('FETCH GET ' + SRC_DIRECT);
    try{
      const r = await fetch(SRC_DIRECT, {cache:'no-store'});
      _status = r.status;
      if (!r.ok) throw new Error('HTTP '+r.status);
      return {used:'direct', txt: await r.text()};
    }catch(e){
      LOG.warn(`FETCH_FAIL (direct; falling back to mirror) ${SRC_DIRECT} :: ${e?.message||e}`);
      LOG.info('FETCH GET ' + SRC_MIRROR);
      const r = await fetch(SRC_MIRROR, {cache:'no-store'});
      _status = r.status;
      if (!r.ok) throw new Error('HTTP '+r.status);
      return {used:'mirror', txt: await r.text()};
    }
  }

  function num(x){
    const n = parseFloat(String(x).replace(/,/g,''));
    return Number.isFinite(n) ? n : null;
  }

  try{
    const fx = await ensureUsdPerCny();
    if (!Number.isFinite(fx)){
      LOG.warn('CNY→USD FX unavailable; Shanghai will show —');
      setDash();
      return;
    }

    const {used, txt} = await fetchTextWithMirror();
    const plain = String(txt).replace(/\r/g,'').trim();

    // Mirror returns a markdown-like table. Parse rows: | YYYYMMDD | SHAG | AM | PM |
    const re = /\|\s*(\d{8})\s*\|\s*([A-Z]+)\s*\|\s*([0-9,]+(?:\.[0-9]+)?)\s*\|\s*([0-9,]+(?:\.[0-9]+)?)\s*\|/g;
    const rows = [];
    let m;
    while((m = re.exec(plain))){
      rows.push({date:m[1], code:m[2], am:num(m[3]), pm:num(m[4])});
    }
    rows.sort((a,b)=> String(b.date).localeCompare(String(a.date)));
    const latest = rows[0];

    if (!latest || (!Number.isFinite(latest.pm) && !Number.isFinite(latest.am))){
      LOG.warn(`SGE parse failed via ${used}: no usable rows found`);
      setDash();
      return;
    }

    const rmbKg = Number.isFinite(latest.pm) ? latest.pm : latest.am;
    const usdOz = (rmbKg * fx) / 32.1507466;

    outShanghai.textContent = fmtUsd(usdOz);
    setTag('tag_sgeShanghaiSpot','official',`SGE benchmark (RMB/kg→USD/oz) ${latest.date} via ${used}`);
    if (outAsOf) outAsOf.textContent = `${latest.date} (${used})`;
    if (outRmbKg) outRmbKg.textContent = `¥${rmbKg.toLocaleString('en-US')} /kg`;
    if (outFx) outFx.textContent = fx.toFixed(6);

    ARB.sgePhysicalUsdOz = usdOz;
    ARB.__sgeLastFetch = Date.now();
    updateArbUI();

    // Update health state for SGE on success
    try{
      HEALTH.set('SGE', { ok: true, status: _status || 200, ms: 0, at: Date.now(), url: used === 'direct' ? SRC_DIRECT : SRC_MIRROR });
    }catch(_){/* no-op */}

    LOG.info(`SGE/Shanghai loaded via ${used}: date=${latest.date}, RMB/kg=${rmbKg}, USD/oz=${usdOz.toFixed(2)}, FX=${Number.isFinite(fx)?fx.toFixed(6):'—'}`);
  }catch(e){
    LOG.warn('SGE/Shanghai load failed (non-fatal): '+String(e?.message||e));
    try{ HEALTH.set('SGE',{ok:false,status:0,ms:0,at:Date.now(),url:SRC_DIRECT,error:String(e?.message||e),key:'SGE'}); }catch(_e){}
    setDash();

    // Update health state for SGE on failure
    try{
      HEALTH.set('SGE', { ok: false, status: _status || 0, ms: 0, at: Date.now(), url: SRC_DIRECT, error: String(e?.message||e) });
    }catch(_){/* no-op */}
  }

  if (returnStatus) return _status;
  return null;
}

async function loadShanghaiSHFE(returnStatus=false){
  let _status = 200;
  const outUsdOz   = document.getElementById('chinaPaperSpot');
  const outAsOf    = document.getElementById('chinaPaperAsOf');
  const outCnyKg   = document.getElementById('chinaPaperCnyKg');
  const outContract= document.getElementById('chinaPaperContract');

  if (!outUsdOz) return;

  if (!returnStatus && ARB.__shfeLastFetch && (Date.now() - ARB.__shfeLastFetch) < 300000) {
    return null;
  }

  // SHFE delayed quotes are published as an HTML report on the SHFE English site.
  // The previous JSON endpoint attempt returned 404 (see your logs). fileciteturn6file0
  // We therefore scrape the official delayed quote report page and parse the first contract line.
  // Source page (HTML):
  //   https://www.shfe.com.cn/eng/reports/delayedMarketData/DelayedQuotes/?query_options=1&query_params=delaymarket_f&query_product_code=ag_f
  // We fetch via r.jina.ai mirror to avoid CORS restrictions in iOS/Textastic preview.
  // SHFE page frequently requires a query_date=YYYYMMDD to return the actual contract lines
  // in the mirrored text output.
  function ymd(d){
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${yyyy}${mm}${dd}`;
  }
  const baseDates = [];
  for (let i=0;i<4;i++){
    const d = new Date();
    d.setDate(d.getDate() - i);
    baseDates.push(ymd(d));
  }

  const MIRRORS = baseDates.flatMap(dt => ([
    `https://r.jina.ai/https://www.shfe.com.cn/eng/reports/delayedMarketData/DelayedQuotes/?query_date=${dt}&query_options=1&query_params=delaymarket_f&query_product_code=ag_f`,
    `https://r.jina.ai/http://www.shfe.com.cn/eng/reports/delayedMarketData/DelayedQuotes/?query_date=${dt}&query_options=1&query_params=delaymarket_f&query_product_code=ag_f`,
    `https://r.jina.ai/https://www.shfe.com.cn/eng/reports/delayedMarketData/DelayedQuotes?query_date=${dt}&query_options=1&query_params=delaymarket_f&query_product_code=ag_f`,
    `https://r.jina.ai/http://www.shfe.com.cn/eng/reports/delayedMarketData/DelayedQuotes?query_date=${dt}&query_options=1&query_params=delaymarket_f&query_product_code=ag_f`
  ]));

  function setDash(){
    outUsdOz.textContent = '—';
    setTag('tag_chinaPaperSpot','missing','China paper (SHFE) unavailable');
    if (outAsOf) outAsOf.textContent = '—';
    if (outCnyKg) outCnyKg.textContent = '—';
    if (outContract) outContract.textContent = '—';
  }

  function parseDelayedQuotes(raw){
    // r.jina.ai wraps pages with a short header like:
    //   Title: ...
    //   URL Source: ...
    // Then the actual HTML/text follows. Strip the header and try both
    // text-regex parsing and HTML table parsing for robustness.
    let t = String(raw || '').replace(/\r/g,'');
    const urlSrcIdx = t.indexOf('URL Source:');
    if (urlSrcIdx !== -1){
      const afterLine = t.indexOf('\n', urlSrcIdx);
      if (afterLine !== -1) t = t.slice(afterLine + 1);
    }

    function parseFromText(txt){
      // r.jina.ai may give either plain text or text rebuilt from HTML tables.
      // We scan ALL candidate AG contracts and pick a non-zero CNY/kg.
      const reAll = /\b(ag\d{4})\b[^\n0-9]{0,40}([0-9]{1,6}(?:,[0-9]{3})*(?:\.[0-9]+)?)/ig;
      let best = null;
      let match;
      while ((match = reAll.exec(txt)) !== null){
        const contract = String(match[1]).toUpperCase();
        const cnyKg = parseNumberLoose(match[2]);
        if (!Number.isFinite(cnyKg) || cnyKg <= 0) continue;
        if (cnyKg < 1000) continue;

        // Prefer nearer contracts (AG26xx/AG27xx) but accept any non-zero if that's all we have.
        const pref = (/^AG2[67]\d{2}$/.test(contract) ? 2 : 1);
        const score = pref * 1e9 + cnyKg;

        if (!best || score > best.score){
          best = {
            score,
            contract,
            cnyKg,
            asOf: (txt.match(/\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/)||[])[1] || 'delayed'
          };
        }
      }
      if (!best) return null;
      return { contract: best.contract, cnyKg: best.cnyKg, asOf: best.asOf };
    }


    // First try: plain text match
    let parsed = parseFromText(t);
    if (parsed && Number.isFinite(parsed.cnyKg)) return parsed;

    // Second try: if HTML is present, parse tables and rebuild text content
    if (t.includes('<') && typeof DOMParser !== 'undefined'){
      try{
        const firstLt = t.indexOf('<');
        const html = firstLt !== -1 ? t.slice(firstLt) : t;
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const lines = [];
        doc.querySelectorAll('tr').forEach(tr=>{
          const cells = Array.from(tr.querySelectorAll('th,td'))
            .map(td=>td.textContent.trim())
            .filter(Boolean);
          if (cells.length) lines.push(cells.join(' '));
        });
        const rebuilt = lines.join('\n');

        parsed = parseFromText(rebuilt);
        if (parsed && Number.isFinite(parsed.cnyKg)) return parsed;

        parsed = parseFromText(doc.body ? doc.body.textContent : rebuilt);
        if (parsed && Number.isFinite(parsed.cnyKg)) return parsed;
      }catch(_e){
        // fall through
      }
    }

    return null;
  }

  try{
    const fx = await ensureUsdPerCny();
    // If FX is temporarily unavailable, still parse and show CNY/kg + contract.

    // Retry across mirror variants and across dates. SHFE often returns "No data available"
    // for the current day until the delayed report is published, so we keep trying earlier
    // dates until parsing succeeds.
    let lastErr = null;
    let text = null;
    let parsed = null;
    for (const url of MIRRORS){
      for (let i=0;i<2;i++){
        try{
          LOG.info('FETCH GET ' + url);
          const r = await fetch(url, {cache:'no-store'});
          _status = r.status;
          if (!r.ok) throw new Error('HTTP '+r.status);
          text = await r.text();
          if (text && text.length > 50){
            parsed = parseDelayedQuotes(text);
            if (parsed && Number.isFinite(parsed.cnyKg)) break; // success
          }
        }catch(e){
          lastErr = e;
          await sleep(250 * (i+1));
        }
      }
      if (parsed && Number.isFinite(parsed.cnyKg)) break;
    }
    if (!text) throw lastErr || new Error('No SHFE response');

    if (!parsed || !Number.isFinite(parsed.cnyKg)) {
      LOG.warn('SHFE parse failed. Preview=' + String(text).slice(0,160).replace(/\s+/g,' '));
      throw new Error('SHFE parse failed');
    }

    const cnyKg = parsed.cnyKg;
    const contract = parsed.contract;
    const time = parsed.asOf;

    const usdOz = (Number.isFinite(fx) ? (cnyKg * fx) / 32.1507466 : null);

    outUsdOz.textContent = Number.isFinite(usdOz) ? fmtUsd(usdOz) : '—';
    setTag('tag_chinaPaperSpot', Number.isFinite(usdOz) ? 'live' : 'missing', `SHFE delayed quotes (${contract}) ${time||''}`);
    if (outAsOf) outAsOf.textContent = time || 'delayed';
    if (outCnyKg) outCnyKg.textContent = `¥${Number(cnyKg).toLocaleString('en-US')} /kg`;
    if (outContract) outContract.textContent = contract;

    ARB.shfePaperUsdOz = Number.isFinite(usdOz) ? usdOz : null;
    ARB.__shfeLastFetch = Date.now();
    updateArbUI();

    // Update health state for SHFE on success
    try{
      HEALTH.set('SHFE', { ok: true, status: _status || 200, ms: 0, at: Date.now(), url: url ?? MIRRORS[0] });
    }catch(_){/* no-op */}

    LOG.info(`SHFE loaded (HTML scrape): contract=${contract} CNY/kg=${cnyKg} USD/oz=${usdOz.toFixed(2)} FX=${Number.isFinite(fx)?fx.toFixed(6):'—'}`);
  }catch(e){
    LOG.warn('SHFE load failed (non-fatal): '+String(e?.message||e));
    setDash();

    // Update health state for SHFE on failure
    try{
      HEALTH.set('SHFE', { ok: false, status: _status || 0, ms: 0, at: Date.now(), url: MIRRORS && MIRRORS[0], error: String(e?.message||e) });
    }catch(_){/* no-op */}
  }

  if (returnStatus) return _status;
  return null;
}



async function buildLBMAChart(rows){
  try{
    if (typeof Chart !== 'function') { LOG.warn('LBMA chart: Chart.js not available'); return; }
    const canvas = $('lbmaChart');
    if (!canvas) { return; }

    const labels = rows.map(e => e.d);
    const usd = rows.map(e => (typeof e.v?.[0] === 'number' ? e.v[0] : null));
    const gbp = rows.map(e => (typeof e.v?.[1] === 'number' ? e.v[1] : null));
    const eur = rows.map(e => (typeof e.v?.[2] === 'number' ? e.v[2] : null));

    // Destroy existing instance
    if (lbmaChart && typeof lbmaChart.destroy === 'function') {
      lbmaChart.destroy();
      lbmaChart = null;
    }

    const ctx = canvas.getContext('2d');
    lbmaChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'LBMA Silver USD', data: usd, borderWidth: 2, tension: 0.25, pointRadius: 0 },
          { label: 'LBMA Silver GBP', data: gbp, borderWidth: 1, tension: 0.25, pointRadius: 0, hidden: true },
          { label: 'LBMA Silver EUR', data: eur, borderWidth: 1, tension: 0.25, pointRadius: 0, hidden: true },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true },
          tooltip: { enabled: true }
        },
        scales: {
          x: { ticks: { maxTicksLimit: 6 } },
          y: { beginAtZero: false }
        },
      },
    });
  } catch(e){
    LOG.error(`LBMA chart build failed: ${e.message}`);
  }
}

function buildLBMATable(rows) {
  const tbody = $('lbmaTblBody');
  if (!tbody) return;
    try { const m = $("lbmaHistMeta"); if (m && rows && rows.length) m.textContent = `Source: LBMA fix JSON · Updated: ${new Date().toLocaleTimeString()} · Latest: ${rows[0].d}`; } catch(e){}
tbody.innerHTML = rows.slice(0, 10).map((e, i) => {
    const [usd, gbp, eur] = e.v;
    const prevRow = rows[i + 1];
    const dUSD = prevRow ? (usd - prevRow.v[0]) : null;
    const dStr = dUSD !== null ? `<span style="color:${dUSD >= 0 ? '#50e090' : '#e05060'}">${dUSD >= 0 ? '+' : ''}${dUSD.toFixed(3)}</span>` : '—';
    return `<tr>
      <td>${e.d}</td>
      <td class="num">$${usd.toFixed(3)}</td>
      <td class="num">${dStr}</td>
      <td class="num">£${(gbp||0).toFixed(3)}</td>
      <td class="num">€${(eur||0).toFixed(3)}</td>
      <td class="num">—</td>
    </tr>`;
  }).join('');
}

/** ===========================
 *  MAIN REFRESH LOOP
 *  =========================== */

function isIOSLike(){
  try{
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }catch(_e){
    return false;
  }
}

async function refreshAll(){
  const mode = MODE.get();
  if (mode === 'offline'){
    LOG.info('Refresh requested in OFFLINE mode; rendering last-known snapshot');
    renderSnapshotIfPresent();
    const lu = document.getElementById('lastUpdated');
    if (lu) lu.textContent = 'offline · ' + new Date().toISOString().replace('T',' ').slice(0,19) + ' UTC';
    return;
  }

  if (mode === 'report'){
    STATE.marginPct = await fetchCmeSilverMarginPct();
  } else {
    // live mode: keep last known marginPct (avoid heavy PDF)
    STATE.marginPct = (STATE && typeof STATE.marginPct === 'number') ? STATE.marginPct : null;
  }
  $("cmMarginPct").textContent = (STATE.marginPct*100).toFixed(1).replace(/\.0$/,'') + "%";
  ;['cmMarginPctInline','cmMarginPctInline2','cmMarginPctInline3','cmMarginPctInline4'].forEach(id=>{ const el=$(id); if(el) el.textContent = (typeof STATE.marginPct === 'number') ? ((STATE.marginPct*100).toFixed(1).replace(/\.0$/,'') + '%') : '—'; });

  LOG.clearForNewCycle();
  window.__SD_REFRESH_ALL_RUNNING__ = true;
  clearError();
  const _rb = $("btnRefresh");
  if (_rb){ _rb.disabled = true; _rb.dataset._oldText = _rb.textContent; _rb.textContent = "Refreshing…"; }
  try{
    // Countdown is light: run in all online modes (uses cache + graceful fallback)
    await renderCountdown();

    // Inventory is heavier (XLS). In live mode, only fetch if missing or stale.
    if (mode === 'report'){
      await loadInventory();
    } else {
      const staleMs = 6 * 60 * 60 * 1000; // 6h
      const invOk = Number.isFinite(STATE.registeredOz) && Number.isFinite(STATE.eligibleOz);
      const invFresh = invOk && Number.isFinite(STATE.inventoryTs) && (Date.now() - STATE.inventoryTs) < staleMs;
      if (!invFresh){
        LOG.info('Live mode: inventory missing/stale -> loading XLS once');
        await loadInventory();
      } else {
        setTag('tag_kpiRegistered','official','Inventory uses cached last-known values in live mode');
      }
    }


    await loadBarchartData();   // loads COMEX price into bcPrice
    // FX for GBP notional (non-fatal if blocked)
    ensureUsdGbpFx().then(()=>updateCombinedCardMetrics()).catch(()=>{});
    // (Removed card) CFTC COT fetch disabled
    // Delivery PDF parsing is NON-FATAL. On iOS-like environments, we force PDF.js to run without a worker if needed.
    try {
      if (typeof pdfjsLib !== 'undefined' && isIOSLike()) {
        // Prefer main-thread parsing if worker loading is restricted (file previews, some iOS webviews).
        pdfjsLib.disableWorker = true;
      }
      if (mode === 'report'){
        await loadDeliveries();
        await fetchDailyIssuesStopsAndUpdateThrottled(true);
      } else {
        // Live mode: run daily + MTD throttled so the card is complete.
        await fetchDailyIssuesStopsAndUpdateThrottled(false);
        await loadDeliveriesThrottled(false);
      }
    } catch (e) {
      LOG.error('Deliveries step failed (continuing) :: ' + String(e?.message || e));
      $("mtdContracts").textContent = "—";
      $("mtdOunces").textContent = "—";
      $("dlvNote").textContent = "Delivery PDF parsing failed in this browser environment. Inventory/OI continue to update.";
    }
    // Roll UI is local-only (history in storage). Always rebuild so the table shows up-to-date 10-day view.
    await buildRollUI();
    await loadLBMAData();       // uses bcPrice for spread calc (must run after loadBarchartData)
    await loadShanghaiSGE();    // China physical (SGE) (non-fatal)
    await loadShanghaiSHFE();   // China paper (SHFE) (non-fatal)

    $("lastUpdated").textContent = new Date().toISOString().replace("T"," ").slice(0,19) + " UTC";
    try{ SNAPSHOT.save(captureSnapshot()); }catch(_e){}
    LOG.info('Refresh cycle OK');
  }catch(e){
    LOG.error('Refresh cycle FAIL :: ' + String(e?.stack || e));
    showError(String(e?.stack || e));
  }finally{
    LOG.info('Refresh cycle END');
    window.__SD_REFRESH_ALL_RUNNING__ = false;
    const _rb2 = $("btnRefresh");
    if (_rb2){ _rb2.disabled = false; _rb2.textContent = _rb2.dataset._oldText || "Refresh now"; }
  }
}

/** ===========================
 *  FAST CARD REFRESH (China vs West)
 *  ===========================
 *  Goal: keep COMEX last + SGE/SHFE conversions fresh without hammering the whole dashboard.
 *  Safety: lock to prevent overlap, auto-backoff when endpoints throttle or mirrors lag.
 */
const CHINA_WEST = {
  // Tick rate for the fast loop (COMEX quotes). Other endpoints are throttled inside the loop.
  tickMs: 30000,

  lock: false,
  timer: null,

  // Endpoint schedules (ms)
  schedules: {
    comex: 30000,
    lbmaLive: 60000,
    sge: 60000,
    shfe: 60000,
  },

  // Endpoint state
  ep: {
    comex:   { lastOk: 0, lastTry: 0, lastStatus: null, fail: 0, nextAllowed: 0 },
    lbmaLive:{ lastOk: 0, lastTry: 0, lastStatus: null, fail: 0, nextAllowed: 0 },
    sge:     { lastOk: 0, lastTry: 0, lastStatus: null, fail: 0, nextAllowed: 0 },
    shfe:    { lastOk: 0, lastTry: 0, lastStatus: null, fail: 0, nextAllowed: 0 },
  },

  // Simple rate-limit counters
  rateLimited429: 0,

  // Perf
  lastMs: null,
  avgMs: null,
};

function setChinaWestStatus(msg){
  const el = document.getElementById('chinaWestStatus');
  if (el) el.textContent = msg;
}

function resetChinaWestTimer(){
  if (CHINA_WEST.timer) clearInterval(CHINA_WEST.timer);
  CHINA_WEST.timer = setInterval(refreshChinaWestSafe, CHINA_WEST.tickMs);
  setChinaWestStatus(`COMEX every ${Math.round(CHINA_WEST.tickMs/1000)}s · SGE ${Math.round(CHINA_WEST.schedules.sge/1000)}s · SHFE ${Math.round(CHINA_WEST.schedules.shfe/1000)}s · LBMA ${Math.round(CHINA_WEST.schedules.lbmaLive/1000)}s`);
}


function forceChinaWestRefresh(){
  // Allow immediate refresh regardless of schedule/backoff.
  try{
    for (const k of Object.keys(CHINA_WEST.ep)){
      CHINA_WEST.ep[k].lastOk = 0;
      CHINA_WEST.ep[k].lastTry = 0;
      CHINA_WEST.ep[k].lastStatus = null;
      CHINA_WEST.ep[k].fail = 0;
      CHINA_WEST.ep[k].nextAllowed = 0;
    }
    CHINA_WEST.rateLimited429 = 0;
  }catch(_e){}
  refreshChinaWestSafe();
}

function nowMs(){
  return (performance && performance.now) ? performance.now() : Date.now();
}

function shouldRunEndpoint(name){
  const now = Date.now();
  const ep = CHINA_WEST.ep[name];
  const every = CHINA_WEST.schedules[name] || CHINA_WEST.tickMs;
  if (now < (ep.nextAllowed || 0)) return false;
  if (!ep.lastOk) return true;
  return (now - ep.lastOk) >= every;
}

function markEndpointResult(name, status){
  const ep = CHINA_WEST.ep[name];
  ep.lastStatus = status;
  if (status === 200){
    ep.fail = 0;
    ep.lastOk = Date.now();
    ep.nextAllowed = 0;
  } else {
    ep.fail = (ep.fail || 0) + 1;
    // Backoff, especially for 429
    if (status === 429){
      CHINA_WEST.rateLimited429++;
      const back = Math.min((CHINA_WEST.schedules[name] || 10000) * (2 ** Math.min(ep.fail, 4)), 5 * 60 * 1000);
      ep.nextAllowed = Date.now() + back;
    } else {
      const back = Math.min((CHINA_WEST.schedules[name] || 10000) * (1.5 ** Math.min(ep.fail, 4)), 2 * 60 * 1000);
      ep.nextAllowed = Date.now() + back;
    }
  }
}

async function refreshChinaWestSafe(){
  // Skip if full refresh is running (avoid endpoint collisions & UI churn)
  if (window.__SD_REFRESH_ALL_RUNNING__) return;
  if (CHINA_WEST.lock) return;
  CHINA_WEST.lock = true;

  const t0 = nowMs();
  try{
    // COMEX last price (every tick)
    if (shouldRunEndpoint('comex')){
      try{
        CHINA_WEST.ep.comex.lastTry = Date.now();
        const st = await loadComexLastOnly(true); // true => return status
        markEndpointResult('comex', st || 200);
      }catch(e){
        LOG.warn('ChinaWest COMEX tick failed: ' + e.message);
        markEndpointResult('comex', 0);
      }
    }

    // LBMA live proxy (throttled)
    if (shouldRunEndpoint('lbmaLive')){
      try{
        CHINA_WEST.ep.lbmaLive.lastTry = Date.now();
        const st = await loadLbmaLiveProxyOnly(true);
        markEndpointResult('lbmaLive', st || 200);
      }catch(e){
        LOG.warn('ChinaWest LBMA live tick failed: ' + e.message);
        markEndpointResult('lbmaLive', 0);
      }
    }

    // SGE physical (throttled, mirror-only)
    if (shouldRunEndpoint('sge')){
      try{
        CHINA_WEST.ep.sge.lastTry = Date.now();
        const st = await loadShanghaiSGE(true);
        markEndpointResult('sge', st || 200);
      }catch(e){
        LOG.warn('ChinaWest SGE tick failed: ' + e.message);
        markEndpointResult('sge', 0);
      }
    }

    // SHFE paper (throttled)
    if (shouldRunEndpoint('shfe')){
      try{
        CHINA_WEST.ep.shfe.lastTry = Date.now();
        const st = await loadShanghaiSHFE(true);
        markEndpointResult('shfe', st || 200);
      }catch(e){
        LOG.warn('ChinaWest SHFE tick failed: ' + e.message);
        markEndpointResult('shfe', 0);
      }
    }

    const ms = Math.round(nowMs() - t0);
    CHINA_WEST.lastMs = ms;
    CHINA_WEST.avgMs = CHINA_WEST.avgMs ? Math.round((CHINA_WEST.avgMs * 0.8) + (ms * 0.2)) : ms;

    const statusBits = [
      `COMEX:${CHINA_WEST.ep.comex.lastStatus ?? '—'}`,
      `LBMA:${CHINA_WEST.ep.lbmaLive.lastStatus ?? '—'}`,
      `SGE:${CHINA_WEST.ep.sge.lastStatus ?? '—'}`,
      `SHFE:${CHINA_WEST.ep.shfe.lastStatus ?? '—'}`,
      CHINA_WEST.rateLimited429 ? `429:${CHINA_WEST.rateLimited429}` : null
    ].filter(Boolean).join(' · ');

    setChinaWestStatus(`ok • ${new Date().toLocaleTimeString()} • ${ms}ms (avg ${CHINA_WEST.avgMs}ms) • ${statusBits}`);
    try{ paintHealth(STATE.health); }catch(_e){}

  } finally {
    CHINA_WEST.lock = false;
  }
}




/** ===========================
 *  DIAGNOSTICS + SNAPSHOT HELPERS
 *  =========================== */
function captureSnapshot(){
  const ids = [
    'kpiRegistered','kpiRegisteredDelta','kpiRegisteredPct','kpiEligibleVal',
    'kpiCountdown','kpiCountdownTarget',
    'cmMarchOI','cmMarchOIOz','cmMarchOIDelta','cmMarchOIPct',
    'bcPrice','bcChange','bcPriceSIH26','bcHighLow','bcPrevClose','bcVolume','bcOI','bcOIDelta','bcOITotal','bcOIMay','bcTradeDate',
    'lbmaUSD','lbmaGBP','lbmaEUR',
    'sgeShanghaiSpot','sgeAsOf','chinaPaperSpot','chinaPaperAsOf',
    'arbComex','arbLbma','arbSgeVsComexVal','arbSgeVsLbmaVal','arbShfeVsComexVal','arbShfeVsLbmaVal','arbComexVsLbmaVal','arbSgeVsShfeVal'
  ];
  const tagIds = [
    'tag_kpiRegistered','tag_kpiCountdown','tag_cmMarchOI','tag_bcPrice','tag_bcOI','tag_lbmaUSD','tag_sgeShanghaiSpot','tag_chinaPaperSpot'
  ];
  const out = { ids:{}, tags:{} };
  for (const id of ids){
    const el = document.getElementById(id);
    if (el) out.ids[id] = el.textContent;
  }
  for (const id of tagIds){
    const el = document.getElementById(id);
    if (el) out.tags[id] = { text: el.textContent, cls: Array.from(el.classList) };
  }
  out.mode = MODE.get();
  out.health = HEALTH.getAll();
  out.ua = (typeof navigator !== 'undefined') ? (navigator.userAgent || '') : '';
  return out;
}

function renderSnapshotIfPresent(){
  const snap = SNAPSHOT.load();
  if (!snap || !snap.obj){
    showToast('No snapshot saved yet');
    return false;
  }
  const obj = snap.obj;
  if (obj.ids){
    for (const [id, txt] of Object.entries(obj.ids)){
      const el = document.getElementById(id);
      if (el && typeof txt === 'string') el.textContent = txt;
    }
  }
  if (obj.tags){
    for (const [id, t] of Object.entries(obj.tags)){
      const el = document.getElementById(id);
      if (!el) continue;
      el.textContent = t && t.text ? t.text : el.textContent;
      if (t && Array.isArray(t.cls)){
        // keep base class 'tag', then apply known kinds
        const keep = new Set(['tag']);
        el.className = 'tag';
        for (const c of t.cls){
          if (c && c !== 'tag') el.classList.add(c);
        }
      }
    }
  }
  showToast(`Offline snapshot loaded (${new Date(snap.t).toLocaleString()})`);
  return true;
}

function buildDiagnostics(){
  const logs = (() => {
    try{
      const raw = localStorage.getItem('silverdash_logs_v1') || '';
      const lines = raw.split(/\r?\n/).filter(Boolean);
      return lines.slice(-80);
    }catch{ return []; }
  })();

  return {
    app: {
      name: 'SilverDash v4',
      mode: MODE.get(),
      when: new Date().toISOString(),
      location: (typeof location !== 'undefined') ? location.href : '',
    },
    device: {
      userAgent: (typeof navigator !== 'undefined') ? (navigator.userAgent || '') : '',
      online: (typeof navigator !== 'undefined') ? navigator.onLine : null,
    },
    health: HEALTH.getAll(),
    snapshot: SNAPSHOT.load(),
    state: {
      // small, safe subset
      comexLast: STATE && STATE.comexLast != null ? STATE.comexLast : null,
      oiMar: STATE && STATE.oiMar != null ? STATE.oiMar : null,
      marginPct: STATE && STATE.marginPct != null ? STATE.marginPct : null,
    },
    logsTail: logs
  };
}


function showToast(message, ms=1400){
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = String(message || '');
  el.classList.add('show');
  // clear any previous timer
  if (el.__t) clearTimeout(el.__t);
  el.__t = setTimeout(()=>{ el.classList.remove('show'); }, ms);
}

function pressButton(btn){
  try{
    if(!btn) return;
    btn.classList.add('pressed');
    setTimeout(()=>btn.classList.remove('pressed'), 130);
  }catch{}
}

$("btnRefresh").addEventListener("click", (e)=>{ pressButton(e.currentTarget); showToast("Refreshing…"); refreshAll(); });
// Top-bar log + tools controls
document.getElementById("btnClearLogsTop")?.addEventListener("click", (e)=>{ pressButton(e.currentTarget); LOG.clear(); showToast("Logs cleared"); });
document.getElementById("btnJumpLogsTop")?.addEventListener("click", (e)=>{ pressButton(e.currentTarget); document.getElementById("logsCard")?.scrollIntoView({behavior:"smooth", block:"start"}); });
document.getElementById("btnExportLogs")?.addEventListener("click", (e)=>{ pressButton(e.currentTarget); try{ LOG.exportDownload(); showToast("Log download triggered"); } catch(err){ LOG.error("Export failed :: " + String(err)); showToast("Export failed"); } });
document.getElementById("btnChinaWestRefresh")?.addEventListener("click", (e)=>{ pressButton(e.currentTarget); forceChinaWestRefresh(); showToast("China vs West refreshed"); });
LOG.render();

// Wait for all external scripts to load before starting
window.addEventListener('load', () => {
  // Set PDF.js worker if library loaded
  if (typeof pdfjsLib !== 'undefined') {
    try {
      // IMPORTANT: do NOT overwrite the Blob workerSrc set earlier. Overwriting forces PDF.js to
      // load libs/pdf.worker.min.js directly, which can fail under Textastic/iOS.
      const cur = String(pdfjsLib?.GlobalWorkerOptions?.workerSrc || '');
      if (!cur.startsWith('blob:')) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('libs/pdf.worker.min.js', document.baseURI).toString();
      }
    } catch (_) {
      try {
        const cur2 = String(pdfjsLib?.GlobalWorkerOptions?.workerSrc || '');
        if (!cur2.startsWith('blob:')) pdfjsLib.GlobalWorkerOptions.workerSrc = "libs/pdf.worker.min.js";
      } catch(_e) {}
    }
  }
  
  // Start countdown timer
  setInterval(()=>{ renderCountdown().catch(()=>{}); }, 1000);
  
  // Start auto-refresh
  setInterval(refreshAll, CFG.refreshSeconds * 1000);

  // Start fast refresh for China vs West card (default 5s, with auto-backoff)
  try{
    refreshChinaWestSafe();
    resetChinaWestTimer();
  }catch(_e){}
  
  $("autoEvery").textContent = `${CFG.refreshSeconds}s`;
  
    // March OI (SIH26): no hardcoded seed. We rely on the live CME volume page scrape + local history.


  // First load
  LOG.info('UserAgent: ' + navigator.userAgent);
  LOG.info('StartURL: ' + location.href);
  refreshAll();
});

window.addEventListener('scroll',()=>{
    document.getElementById('scrollTop').classList.toggle('vis', window.scrollY > 300);
  });

// PWA: register service worker for offline caching of the UI shell.
  // Live CME data still requires network access.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(()=>{ /* ignore */ });
    });
  }


/** ===========================
 *  TEST HARNESS (tests.html)
 *  =========================== */
function runSilverDashTests(){
  const results = [];
  const ok = (name) => results.push({name, ok:true});
  const fail = (name, err) => results.push({name, ok:false, err: String(err||'')});

  function assert(cond, name){
    if (!cond) throw new Error(name);
  }

  try{
    // 1) Margin regex accepts NON - HRP
    const txt = "NON - HRP  MNTH1  18% 18%";
    assert(/NON\s*-\s*HRP/i.test(txt), "Margin regex should match NON - HRP");
    ok("Margin regex: NON - HRP");
  }catch(e){ fail("Margin regex: NON - HRP", e); }

  try{
    // 2) Front month selection prefers highest volume
    const quotes = [{last:"1",volume:"100",globexCode:"SIA1"},{last:"2",volume:"500",globexCode:"SIB1"}];
    const q = selectFrontMonthQuote(quotes);
    assert(q && q.globexCode === "SIB1", "Front month should be highest volume");
    ok("Front month selection");
  }catch(e){ fail("Front month selection", e); }

  try{
    // 3) Cache freshness logic
    const url = "https://example.com/test";
    CACHE.set(url, {t: Date.now(), json: {a:1}});
    const entry = CACHE.get(url);
    assert(entry && entry.json && entry.json.a === 1, "Cache get/set");
    assert(CACHE.isFresh(entry, 1000), "Cache should be fresh");
    ok("TTL cache get/set/fresh");
  }catch(e){ fail("TTL cache get/set/fresh", e); }

  // Render results
  try{
    document.body.style.background = "#0b1220";
    document.body.style.color = "#e9eefb";
    document.body.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace";
    const h = document.createElement("h2");
    h.textContent = "SilverDash Tests";
    const pre = document.createElement("pre");
    pre.id = "testOut";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.padding = "12px";
    pre.style.border = "1px solid rgba(255,255,255,.12)";
    pre.style.borderRadius = "12px";
    pre.style.background = "rgba(255,255,255,.03)";

    const lines = [];
    const pass = results.filter(r=>r.ok).length;
    const total = results.length;
    lines.push(`PASS ${pass}/${total}`);
    for (const r of results){
      lines.push(`${r.ok ? "✅" : "❌"} ${r.name}${r.ok ? "" : " :: " + r.err}`);
    }
    pre.textContent = lines.join("\n");
    document.body.innerHTML = "";
    document.body.appendChild(h);
    document.body.appendChild(pre);
  }catch(e){
    console.error(e);
  }
}
