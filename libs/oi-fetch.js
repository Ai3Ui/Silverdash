// SilverDash — oi-fetch.js  v3.0.0
// FINAL: CME does not expose per-contract OI via any public API endpoint.
// All endpoints confirmed exhausted by diagnostic logging 2026-02-18.
//
// This version uses LatestTotals (all-months total) displayed honestly,
// plus a manually-updatable seed value for the most recent known March OI.
// The seed is updated each session when today's value is known.

(function(global) {
  'use strict';

  var PRODUCT_ID  = 458;
  var LEDGER_KEY  = 'silverdash_march_oi_history';

  // Last confirmed March 2026 (SIH6) OI from CME website — update manually as needed
  // Source: CME website silver.volume.html, confirmed 2026-02-13 = 58,770 contracts
  var LAST_KNOWN_MARCH_OI   = 58058;
  var LAST_KNOWN_MARCH_DATE = '20260218';

  var CME_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.cmegroup.com/markets/metals/precious/silver.html',
  };

  function logInfo(msg)  { var L = global.LOG; if (L) L.info(msg);  else console.info(msg); }
  function logWarn(msg)  { var L = global.LOG; if (L) L.warn(msg);  else console.warn(msg); }

  function parseNum(v) {
    if (typeof v === 'number') return isNaN(v) ? null : v;
    if (typeof v === 'string') { var n = parseInt(v.replace(/,/g,''),10); return isNaN(n)?null:n; }
    return null;
  }

  function fmtInt(n) {
    if (n == null || isNaN(n)) return '\u2014';
    return n.toLocaleString();
  }

  function $(id) { return document.getElementById(id); }

  function storeMarchOI(oi, tradeDate) {
    if (!oi) return;
    try {
      var store = JSON.parse(localStorage.getItem(LEDGER_KEY) || '{}');
      store[tradeDate] = oi;
      var entries = Object.entries(store).sort(function(a,b){return a[0].localeCompare(b[0]);});
      var trimmed = {};
      entries.slice(-60).forEach(function(e){ trimmed[e[0]]=e[1]; });
      localStorage.setItem(LEDGER_KEY, JSON.stringify(trimmed));
    } catch(e) {}
  }

  function setDOM(oi, totalOI, date, marchSource) {
    if ($('bcOI'))        $('bcOI').textContent        = fmtInt(oi);
    if ($('bcOITotal'))   $('bcOITotal').textContent   = fmtInt(totalOI);
    if ($('bcTradeDate')) $('bcTradeDate').textContent  = date;
    if ($('oiMar'))       $('oiMar').textContent        = fmtInt(oi);
    if ($('bcNote'))      $('bcNote').textContent       = marchSource;
    var cn = $('oiCalcNote');
    if (cn && oi) cn.textContent =
      'March 2026 (SIH6): ' + fmtInt(oi) + ' contracts \xd7 5,000 oz = ' +
      fmtInt(oi * 5000) + ' troy oz. ' + marchSource;
  }

  async function loadMarchOI() {
    logInfo('[OI] loadMarchOI v3.0 — using LatestTotals + last-known March seed');

    var totalOI = null, totalDate = '—';

    // Fetch all-months total OI (this always works)
    try {
      var res = await fetch(
        'https://www.cmegroup.com/CmeWS/mvc/Volume/LatestTotals?products=' + PRODUCT_ID + '&days=10',
        { headers: CME_HEADERS, cache: 'no-store' }
      );
      if (res.ok) {
        var rows = JSON.parse(await res.text());
        if (Array.isArray(rows)) {
          var latest = rows.slice().reverse().find(function(r){
            return parseNum(r.futureOpenInterest) > 0;
          });
          if (latest) {
            totalOI   = parseNum(latest.futureOpenInterest);
            totalDate = String(latest.tradeDate || '');
            logInfo('[OI] LatestTotals: total=' + totalOI + ' date=' + totalDate);
          }
        }
      }
    } catch(e) { logWarn('[OI] LatestTotals failed: ' + e.message); }

    // Use last-known March OI from seed (most recent confirmed value from CME website)
    var marchOI   = LAST_KNOWN_MARCH_OI;
    var marchDate = LAST_KNOWN_MARCH_DATE;

    // Check if localStorage has something more recent
    try {
      var store = JSON.parse(localStorage.getItem(LEDGER_KEY) || '{}');
      var keys  = Object.keys(store).filter(function(k){ return /^\d{8}$/.test(k); }).sort();
      if (keys.length > 0) {
        var latestKey = keys[keys.length - 1];
        var latestVal = parseNum(store[latestKey]);
        // Only use stored value if it looks like a per-contract OI (< 200,000)
        // not a LatestTotals all-months value we accidentally stored before
        if (latestVal && latestVal < 200000 && latestVal > 10000 &&
            latestKey >= LAST_KNOWN_MARCH_DATE) {
          marchOI   = latestVal;
          marchDate = latestKey;
          logInfo('[OI] Using stored March OI: ' + marchDate + '=' + marchOI);
        }
      }
    } catch(e) {}

    var marchSource = 'SIH6 (last confirmed): ' + fmtInt(marchOI) +
      ' contracts | Date: ' + marchDate +
      ' | Total all-months OI: ' + fmtInt(totalOI) + ' (' + totalDate + ')' +
      ' | \u26a0 CME API does not expose per-contract OI publicly';

    setDOM(marchOI, totalOI, totalDate, marchSource);
    storeMarchOI(marchOI, marchDate);

    logInfo('[OI] Done: marchOI=' + marchOI + ' totalOI=' + totalOI);
    return { marchOI: marchOI, totalOI: totalOI, date: totalDate };
  }

  function getMarchOIHistory() {
    try {
      var store = JSON.parse(localStorage.getItem(LEDGER_KEY)||'{}');
      var entries = Object.entries(store)
        .filter(function(e){ return parseNum(e[1]) < 200000; }) // exclude all-months totals
        .sort(function(a,b){return a[0].localeCompare(b[0]);});
      return entries.map(function(e,i,arr){
        return { date:e[0], oi:e[1], delta:i>0?e[1]-arr[i-1][1]:0 };
      });
    } catch(e) { return []; }
  }

  global.OIFetch = { loadMarchOI:loadMarchOI, getMarchOIHistory:getMarchOIHistory };

})(window);