/**
 * ai-console.js
 * Version: 1.0.0
 * SilverDash PWA — WebLLM Interactive AI Console + PDF Export
 *
 * Uses WebLLM (https://webllm.mlc.ai) to run a real LLM entirely in the browser.
 * No server, no API key. Model downloads once (~1.5GB) and caches locally.
 * Uses jsPDF for professional PDF report generation.
 *
 * Works in: Chrome 113+, Safari 18+ (iOS 18+), Edge 113+
 * Requires: WebGPU support in browser
 */

'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const WEBLLM_VERSION = '0.2.79';
const WEBLLM_CDN     = `https://esm.run/@mlc-ai/web-llm@${WEBLLM_VERSION}`;
const JSPDF_CDN      = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const AUTOTABLE_CDN  = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';

// Best model for quality + iPhone compatibility (SmolLM2 360M, ~1.5GB)
const AI_MODEL = 'SmolLM2-360M-Instruct-q4f16_1-MLC'; // 360M model — 376MB VRAM, leaves room for inference (1B crashed during summary generation)

// System prompt — locks AI to silver market analysis context
const SYSTEM_PROMPT = `You are SilverDash AI, an expert COMEX silver futures market analyst built into a live trading dashboard. You have access to real-time data including: COMEX registered inventory, open interest, CFTC Commitment of Traders data, LBMA fix prices, delivery notices, the Gold/Silver Ratio, and COMEX vs LBMA spread.

When answering questions:
- Be precise and professional — your analysis is shared with traders
- Always reference the actual numbers from the dashboard data provided
- Flag any significant stress signals (high paper-to-physical leverage, unusual spreads, crowded positioning)
- Keep answers focused and actionable
- For the Gold/Silver Ratio, note that the user's strategy targets ~50:1 for silver-to-gold conversion
- Use plain paragraphs, not bullet points, unless listing specific data points

You are running entirely in the user's browser with no server connection. All responses are private.`;

// ── State ──────────────────────────────────────────────────────────────────
let mlcEngine    = null;   // WebLLM engine instance
let engineReady  = false;  // true once model is loaded
let isGenerating = false;  // prevents concurrent requests
let stopRequested = false; // set true by Stop button to abort streaming
const chatHistory = [];    // full conversation history for context

// ── DOM helpers ────────────────────────────────────────────────────────────
const $c = id => document.getElementById(id);

// ── Gather live dashboard snapshot ────────────────────────────────────────
function getDashboardContext() {
  const g = id => {
    const el = document.getElementById(id);
    return el ? (el.textContent || '').trim() : '—';
  };
  return `
LIVE DASHBOARD DATA (${g('lastUpdated')}):

COMEX PRICE (SIH26 March):
  Last: ${g('bcPrice')} | Change: ${g('bcChange')} | High/Low: ${g('bcHighLow')}
  Prev Close: ${g('bcPrevClose')} | Volume: ${g('bcVolume')} | Date: ${g('bcTradeDate')}

OPEN INTEREST:
  March OI: ${g('bcOI')} contracts | Total All Months: ${g('bcOITotal')}
  Day Delta: ${g('bcOIDelta')}
  Physical Equiv: ${g('oiCalcOz')} troy oz (${g('oiCalcMoz')})
  Notional: ${g('oiCalcUSD')} | vs Registered: ${g('oiCalcVsReg')}

COMEX INVENTORY:
  Registered: ${g('kpiRegistered')} oz (Δ ${g('kpiRegisteredDelta')})
  Eligible: ${g('kpiEligibleVal')} oz
  First Notice Day: ${g('kpiCountdownTarget')} (${g('kpiCountdown')} away)

MTD DELIVERIES: ${g('mtdContracts')} contracts | ${g('mtdOunces')} oz | Δ ${g('mtdDelta')}

CFTC COT (${g('cotDate')}):
  Total OI: ${g('cotOI')} (Δ week: ${g('cotOIDelta')})
  Spec Long: ${g('cotNCLong')} (${g('cotPctNCLong')}) | Short: ${g('cotNCShortVal')} (${g('cotPctNCShort')})
  Net Spec: ${g('cotNetSpec')} | Comm Short: ${g('cotCommShortVal')}

LBMA FIX (${g('lbmaDate')}):
  USD: ${g('lbmaUSD')} | GBP: ${g('lbmaGBP')} | EUR: ${g('lbmaEUR')}
  7-Day Change: ${g('lbmaWeekChange')} (${g('lbmaWeekPct')})
  52-Wk High: ${g('lbma52wkHigh')} | Low: ${g('lbma52wkLow')}
  Gold/Silver Ratio: ${g('lbmaGSR')}

COMEX vs LBMA SPREAD: ${g('spreadUSD')} (${g('spreadPct')})
`;
}

// ── Load WebLLM dynamically as ES module ───────────────────────────────────
async function loadWebLLM() {
  if (window._webllm) return window._webllm;
  const mod = await import(WEBLLM_CDN);
  window._webllm = mod;
  return mod;
}

// ── Load jsPDF + AutoTable dynamically ────────────────────────────────────
function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = url;
    s.onload  = resolve;
    s.onerror = () => reject(new Error(`Failed to load: ${url}`));
    document.head.appendChild(s);
  });
}

// ── Initialise WebLLM engine ───────────────────────────────────────────────
async function initEngine() {
  const statusEl  = $c('aiConsoleStatus');
  const progressEl = $c('aiConsoleProgress');
  const barEl     = $c('aiConsoleBar');
  const btnLoad   = $c('btnLoadModel');

  btnLoad.disabled    = true;
  statusEl.textContent = '⬇️ Loading WebLLM library…';

  try {
    const webllm = await loadWebLLM();
    statusEl.textContent = `⬇️ Downloading model (${AI_MODEL})… First time only — caches locally after this.`;

    // ── Memory + crash monitoring ──────────────────────────────────────────
    // Log available memory before download starts
    if (performance?.memory) {
      const mem = performance.memory;
      LOG.info(`WebLLM pre-load memory: used=${(mem.usedJSHeapSize/1048576).toFixed(0)}MB, total=${(mem.totalJSHeapSize/1048576).toFixed(0)}MB, limit=${(mem.jsHeapSizeLimit/1048576).toFixed(0)}MB`);
    } else {
      LOG.info(`WebLLM: performance.memory not available on this browser (Safari expected)`);
    }

    // Save download checkpoint to sessionStorage so we can detect crash vs clean reload
    sessionStorage.setItem('webllm_download_started', Date.now().toString());
    sessionStorage.setItem('webllm_last_pct', '0');
    sessionStorage.removeItem('webllm_completed');

    // Page visibility change — detect when Safari backgrounds/kills the tab
    const visibilityHandler = () => {
      const pct = sessionStorage.getItem('webllm_last_pct') || '?';
      if (document.visibilityState === 'hidden') {
        LOG.info(`WebLLM: tab hidden at ${pct}% — Safari may kill this tab under memory pressure`);
        sessionStorage.setItem('webllm_hidden_at_pct', pct);
      } else {
        LOG.info(`WebLLM: tab visible again (was hidden at ${sessionStorage.getItem('webllm_hidden_at_pct') || '?'}%)`);
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);

    // pagehide fires just before Safari terminates the page
    const pagehideHandler = (e) => {
      const pct = sessionStorage.getItem('webllm_last_pct') || '?';
      LOG.info(`WebLLM: pagehide event fired at ${pct}% — persisted=${e.persisted} (false = page being killed)`);
    };
    window.addEventListener('pagehide', pagehideHandler);

    LOG.info(`WebLLM: starting CreateMLCEngine for ${AI_MODEL}`);

    mlcEngine = await webllm.CreateMLCEngine(AI_MODEL, {
      initProgressCallback: (p) => {
        const pct = Math.round((p.progress || 0) * 100);
        const text = p.text || '';
        statusEl.textContent = `⬇️ ${text || 'Loading model…'} (${pct}%)`;
        if (progressEl) progressEl.style.display = 'block';
        if (barEl) barEl.style.width = pct + '%';

        // Log every 10% milestone
        const prevPct = parseInt(sessionStorage.getItem('webllm_last_pct') || '0');
        if (pct >= prevPct + 10 || pct === 100) {
          sessionStorage.setItem('webllm_last_pct', pct.toString());
          if (performance?.memory) {
            const mem = performance.memory;
            LOG.info(`WebLLM progress ${pct}%: used=${(mem.usedJSHeapSize/1048576).toFixed(0)}MB / limit=${(mem.jsHeapSizeLimit/1048576).toFixed(0)}MB | text="${text.slice(0,80)}"`);
          } else {
            LOG.info(`WebLLM progress ${pct}%: "${text.slice(0,80)}"`);
          }
        }
      }
    });

    // Clean up event listeners
    document.removeEventListener('visibilitychange', visibilityHandler);
    window.removeEventListener('pagehide', pagehideHandler);
    sessionStorage.setItem('webllm_completed', 'true');
    sessionStorage.setItem('webllm_last_pct', '100');

    engineReady = true;
    if (progressEl) progressEl.style.display = 'none';
    statusEl.textContent = `✅ ${AI_MODEL} ready — ask anything about the silver market`;
    statusEl.style.color = '#50e090';
    btnLoad.textContent  = '✅ Model Loaded';
    btnLoad.disabled     = true;
    $c('aiConsoleInput').disabled  = false;
    $c('btnAskAI').disabled        = false;
    $c('btnGenerateReport').disabled = false;

    if (typeof LOG !== 'undefined') LOG.info(`WebLLM: ${AI_MODEL} loaded OK`);

    // Auto-generate initial summary
    await askAI('Please give me a full professional market summary based on the current dashboard data.', true);

  } catch(e) {
    statusEl.textContent = `⚠️ Model load failed: ${e.message}`;
    statusEl.style.color = '#e05060';
    btnLoad.disabled     = false;
    btnLoad.textContent  = '🔄 Retry';
    if (typeof LOG !== 'undefined') LOG.error('WebLLM init failed: ' + e.message);
  }
}

// ── Ask the AI a question ─────────────────────────────────────────────────
async function askAI(question, isAuto = false) {
  if (!engineReady || isGenerating) return;
  if (!question || !question.trim()) return;

  isGenerating = true;
  stopRequested = false;
  const input  = $c('aiConsoleInput');
  const send   = $c('btnAskAI');
  const log    = $c('aiConsoleChatLog');
  const stopBtn = $c('btnStopAI');
  if (stopBtn) stopBtn.style.display = 'inline-flex';

  if (!isAuto) {
    input.disabled = true;
    send.disabled  = true;
  }

  // Add user message to chat log
  if (!isAuto) {
    appendMessage('user', question);
    input.value = '';
  }

  // Append live data context to system
  const contextualSystem = SYSTEM_PROMPT + '\n\n' + getDashboardContext();

  // Build messages array
  const messages = [
    { role: 'system', content: contextualSystem },
    ...chatHistory,
    { role: 'user',   content: question }
  ];

  // Add AI response placeholder
  const aiMsgEl = appendMessage('assistant', '', true);

  try {
    let fullReply = '';
    // max_tokens kept low to prevent GPU memory spike crashing Safari on iPhone
    const maxTok = isAuto ? 250 : 400;
    const stream = await mlcEngine.chat.completions.create({
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: maxTok
    });

    for await (const chunk of stream) {
      if (stopRequested) {
        // User pressed Stop — abort cleanly
        fullReply += ' [stopped]';
        aiMsgEl.textContent = fullReply;
        aiMsgEl.style.color = '#a0b0c0';
        break;
      }
      const delta = chunk.choices[0]?.delta?.content || '';
      fullReply += delta;
      aiMsgEl.textContent = fullReply;
      // Auto-scroll
      log.scrollTop = log.scrollHeight;
    }

    // Save to history (keep last 6 turns to manage context)
    chatHistory.push({ role: 'user',      content: question   });
    chatHistory.push({ role: 'assistant', content: fullReply  });
    if (chatHistory.length > 12) chatHistory.splice(0, 2);

    // Store last summary for PDF
    window._lastAISummary = fullReply;

    if (typeof LOG !== 'undefined') LOG.info(`WebLLM: response ${fullReply.length} chars`);

  } catch(e) {
    aiMsgEl.textContent = `⚠️ Error: ${e.message}`;
    aiMsgEl.style.color = '#e05060';
    if (typeof LOG !== 'undefined') LOG.error('WebLLM ask failed: ' + e.message);
  } finally {
    isGenerating     = false;
    stopRequested    = false;
    if ($c('btnStopAI')) $c('btnStopAI').style.display = 'none';
    input.disabled   = false;
    send.disabled    = false;
    input.focus();
  }
}

// ── Append message to chat log ─────────────────────────────────────────────
function appendMessage(role, text, streaming = false) {
  const log  = $c('aiConsoleChatLog');
  const wrap = document.createElement('div');
  wrap.style.cssText = `
    margin: 8px 0;
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 13px;
    line-height: 1.65;
    max-width: 92%;
    ${role === 'user'
      ? 'background:rgba(122,162,255,.15); border:1px solid rgba(122,162,255,.3); margin-left:auto; color:#c8d8ff;'
      : 'background:rgba(100,220,140,.08); border:1px solid rgba(100,220,140,.2); margin-right:auto; color:#cce8d4;'}
  `;

  const label = document.createElement('div');
  label.style.cssText = 'font-size:10px; font-weight:700; margin-bottom:4px; opacity:0.7; letter-spacing:0.5px;';
  label.textContent   = role === 'user' ? '👤 YOU' : '🤖 SILVERDASH AI';
  wrap.appendChild(label);

  const content = document.createElement('div');
  content.style.whiteSpace = 'pre-wrap';
  content.textContent      = text;
  wrap.appendChild(content);

  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
  return content; // return content div so streaming can update it
}

// ── Handle send button / enter key ────────────────────────────────────────
function handleSend() {
  const q = ($c('aiConsoleInput')?.value || '').trim();
  if (q) askAI(q);
}

// ── Generate PDF Report ────────────────────────────────────────────────────
async function generatePDFReport() {
  const btn = $c('btnGenerateReport');
  btn.disabled    = true;
  btn.textContent = '⏳ Building PDF…';

  try {
    // Load jsPDF + AutoTable
    await loadScript(JSPDF_CDN);
    await loadScript(AUTOTABLE_CDN);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210; // A4 width mm
    const M = 18;  // margin
    let y   = 0;   // current y position

    // ── Colour palette ──
    const C = {
      navy:    [11, 18, 32],
      blue:    [30, 58, 95],
      accent:  [122, 162, 255],
      gold:    [240, 208, 96],
      green:   [80, 224, 144],
      red:     [224, 80, 96],
      white:   [233, 238, 251],
      muted:   [167, 179, 214],
      silver:  [192, 200, 220],
    };

    // ── Helper: hex fill ──
    const fill = (r,g,b) => doc.setFillColor(r,g,b);
    const text = (r,g,b) => doc.setTextColor(r,g,b);
    const line = (r,g,b) => doc.setDrawColor(r,g,b);

    // ════════════════════════════════════════════
    // PAGE 1 — COVER
    // ════════════════════════════════════════════
    fill(...C.navy); doc.rect(0, 0, W, 297, 'F');

    // Top accent bar
    fill(...C.accent); doc.rect(0, 0, W, 3, 'F');
    fill(...C.gold);   doc.rect(0, 3, W, 1.5, 'F');

    // Logo / title area
    y = 55;
    fill(...C.blue); doc.roundedRect(M, y, W - M*2, 75, 4, 4, 'F');
    line(...C.accent); doc.setLineWidth(0.5);
    doc.roundedRect(M, y, W - M*2, 75, 4, 4, 'S');

    // Ag symbol
    y += 14;
    text(...C.accent); doc.setFont('helvetica', 'bold'); doc.setFontSize(42);
    doc.text('Ag', W/2, y, { align: 'center' });

    y += 12;
    text(...C.gold); doc.setFontSize(22); doc.setFont('helvetica', 'bold');
    doc.text('COMEX Silver Market Report', W/2, y, { align: 'center' });

    y += 9;
    text(...C.silver); doc.setFontSize(12); doc.setFont('helvetica', 'normal');
    doc.text('SIH26 — March 2026 Futures Analysis', W/2, y, { align: 'center' });

    y += 9;
    const now = new Date().toUTCString().replace('GMT', 'UTC');
    text(...C.muted); doc.setFontSize(10);
    doc.text(`Generated: ${now}`, W/2, y, { align: 'center' });

    // Data snapshot row
    y += 16;
    fill(...C.navy); doc.rect(M, y, W-M*2, 8, 'F');
    const snapLine = [
      `Last: ${_pdf('bcPrice')}`,
      `Registered: ${_pdf('kpiRegistered')} oz`,
      `OI: ${_pdf('bcOI')} contracts`,
      `GSR: ${_pdf('lbmaGSR')}`,
    ].join('    •    ');
    text(...C.gold); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    doc.text(snapLine, W/2, y + 5.2, { align: 'center' });

    // Bottom byline
    y = 255;
    text(...C.muted); doc.setFontSize(9); doc.setFont('helvetica', 'italic');
    doc.text('Prepared by SilverDash PWA  •  Data: CME Group / LBMA / CFTC  •  Not financial advice', W/2, y, { align: 'center' });

    // Bottom accent bar
    fill(...C.gold); doc.rect(0, 293, W, 1.5, 'F');
    fill(...C.accent); doc.rect(0, 294.5, W, 2.5, 'F');

    // ════════════════════════════════════════════
    // PAGE 2 — MARKET DATA TABLES
    // ════════════════════════════════════════════
    doc.addPage();
    fill(...C.navy); doc.rect(0, 0, W, 297, 'F');
    fill(...C.accent); doc.rect(0, 0, W, 3, 'F');

    y = 16;
    _pageHeader(doc, 'Market Data Snapshot', C, W, M);
    y = 30;

    // Price & OI table
    _sectionTitle(doc, '📊 COMEX Futures — SIH26 March 2026', y, M, C);
    y += 8;
    doc.autoTable({
      startY: y,
      head: [['Metric', 'Value', 'Notes']],
      body: [
        ['Last Price',          _pdf('bcPrice'),        'CME delayed ~10 min'],
        ['Day Change',          _pdf('bcChange'),        ''],
        ['Day High / Low',      _pdf('bcHighLow'),       ''],
        ['Previous Close',      _pdf('bcPrevClose'),     ''],
        ['Volume Today',        _pdf('bcVolume'),        'Futures only'],
        ['Open Interest (Mar)', _pdf('bcOI'),            'SIH26 March contract'],
        ['Total OI All Months', _pdf('bcOITotal'),       'All silver futures'],
        ['OI Day Delta',        _pdf('bcOIDelta'),       '+ve = new money entering'],
        ['Trade Date',          _pdf('bcTradeDate'),     ''],
      ],
      ..._tableStyle(C),
      margin: { left: M, right: M },
    });
    y = doc.lastAutoTable.finalY + 10;

    // OI Physical Equivalent
    _sectionTitle(doc, '📐 March OI — Physical Silver Equivalent (5,000 oz/contract)', y, M, C);
    y += 8;
    doc.autoTable({
      startY: y,
      head: [['Metric', 'Value']],
      body: [
        ['Contracts',          _pdf('oiCalcContracts')],
        ['Troy Ounces (×5,000)', _pdf('oiCalcOz')],
        ['Million Ounces',     _pdf('oiCalcMoz')],
        ['Notional USD Value', _pdf('oiCalcUSD')],
        ['vs Registered Stock', _pdf('oiCalcVsReg')],
      ],
      ..._tableStyle(C),
      margin: { left: M, right: M },
    });
    y = doc.lastAutoTable.finalY + 10;

    // Inventory
    _sectionTitle(doc, '📦 COMEX Registered Inventory', y, M, C);
    y += 8;
    doc.autoTable({
      startY: y,
      head: [['Metric', 'Value', 'Notes']],
      body: [
        ['Registered',       _pdf('kpiRegistered'),    'Warranted, deliverable'],
        ['Day Delta',        _pdf('kpiRegisteredDelta'), 'vs prior day'],
        ['Eligible',         _pdf('kpiEligibleVal'),    'Vault-held, not warranted'],
        ['First Notice Day', _pdf('kpiCountdownTarget'), 'CME Calendar'],
        ['Countdown',        _pdf('kpiCountdown'),       'T-minus'],
        ['MTD Deliveries',   _pdf('mtdContracts') + ' contracts', _pdf('mtdOunces') + ' oz'],
      ],
      ..._tableStyle(C),
      margin: { left: M, right: M },
    });

    // ════════════════════════════════════════════
    // PAGE 3 — COT + LBMA TABLES
    // ════════════════════════════════════════════
    doc.addPage();
    fill(...C.navy); doc.rect(0, 0, W, 297, 'F');
    fill(...C.accent); doc.rect(0, 0, W, 3, 'F');

    _pageHeader(doc, 'COT Positioning & LBMA Prices', C, W, M);
    y = 30;

    // COT
    _sectionTitle(doc, `📋 CFTC Commitment of Traders — Report Date: ${_pdf('cotDate')}`, y, M, C);
    y += 8;
    doc.autoTable({
      startY: y,
      head: [['Category', 'Long', 'Short', 'Net / Notes']],
      body: [
        ['Total Open Interest', _pdf('cotOI'), '',           `Δ week: ${_pdf('cotOIDelta')}`],
        ['Non-Commercial (Spec)', _pdf('cotNCLong'), _pdf('cotNCShortVal'), `Net: ${_pdf('cotNetSpec')}`],
        ['% of OI',            _pdf('cotPctNCLong'), _pdf('cotPctNCShort'), 'Spec %'],
        ['Commercial (Hedge)', _pdf('cotCommLong'), _pdf('cotCommShortVal'), ''],
        ['Total Traders',      _pdf('cotTradersVal'), '', ''],
      ],
      ..._tableStyle(C),
      margin: { left: M, right: M },
    });
    y = doc.lastAutoTable.finalY + 10;

    // LBMA
    _sectionTitle(doc, `💰 LBMA Silver Fix — ${_pdf('lbmaDate')}`, y, M, C);
    y += 8;
    doc.autoTable({
      startY: y,
      head: [['Metric', 'Value', 'Notes']],
      body: [
        ['USD Fix',            _pdf('lbmaUSD'),         'London daily benchmark'],
        ['GBP Fix',            _pdf('lbmaGBP'),         ''],
        ['EUR Fix',            _pdf('lbmaEUR'),         ''],
        ['Previous Fix (USD)', _pdf('lbmaPrevUSD'),     ''],
        ['7-Day Change',       _pdf('lbmaWeekChange'),  _pdf('lbmaWeekPct')],
        ['52-Week High',       _pdf('lbma52wkHigh'),    _pdf('lbma52wkHighDate')],
        ['52-Week Low',        _pdf('lbma52wkLow'),     _pdf('lbma52wkLowDate')],
        ['Gold/Silver Ratio',  _pdf('lbmaGSR'),         'Target: ~50:1'],
      ],
      ..._tableStyle(C),
      margin: { left: M, right: M },
    });
    y = doc.lastAutoTable.finalY + 10;

    // Spread
    _sectionTitle(doc, '⚖️ COMEX vs LBMA Spread', y, M, C);
    y += 8;
    doc.autoTable({
      startY: y,
      head: [['Metric', 'Value']],
      body: [
        ['Spread (COMEX − LBMA)', _pdf('spreadUSD')],
        ['Spread %',              _pdf('spreadPct')],
        ['COMEX Last (SIH26)',    _pdf('comexLastForSpread')],
        ['LBMA Fix',              _pdf('lbmaUSD')],
      ],
      ..._tableStyle(C),
      margin: { left: M, right: M },
    });

    // ════════════════════════════════════════════
    // PAGE 4 — LBMA CHART
    // ════════════════════════════════════════════
    const lbmaCanvas = document.getElementById('lbmaChart');
    if (lbmaCanvas) {
      doc.addPage();
      fill(...C.navy); doc.rect(0, 0, W, 297, 'F');
      fill(...C.accent); doc.rect(0, 0, W, 3, 'F');
      _pageHeader(doc, 'LBMA Silver Fix — 90-Day Price Chart', C, W, M);

      try {
        const chartImg = lbmaCanvas.toDataURL('image/png');
        doc.addImage(chartImg, 'PNG', M, 30, W - M*2, 80);
        y = 118;
        text(...C.muted); doc.setFontSize(8);
        doc.text('LBMA Silver Fix USD — last 90 trading days  •  Source: prices.lbma.org.uk', M, y);
      } catch(e) {
        y = 40;
        text(...C.muted); doc.setFontSize(10);
        doc.text('Chart not available — canvas export failed', M, y);
      }
    }

    // ════════════════════════════════════════════
    // PAGE 5 — AI ANALYSIS
    // ════════════════════════════════════════════
    doc.addPage();
    fill(...C.navy); doc.rect(0, 0, W, 297, 'F');
    fill(...C.accent); doc.rect(0, 0, W, 3, 'F');
    _pageHeader(doc, 'AI Market Analysis', C, W, M);

    y = 30;
    _sectionTitle(doc, '🤖 SilverDash AI — Market Summary', y, M, C);
    y += 10;

    // Use AI summary if available, else run the local rule engine as fallback
    let aiText = window._lastAISummary;
    if (!aiText) {
      try {
        // Generate a local rule-based summary as fallback
        const lines = [];
        const g = id => { const el = document.getElementById(id); return el ? (el.textContent||'').trim() : '—'; };
        lines.push(`COMEX Silver Market Snapshot — ${new Date().toUTCString()}`);
        lines.push('');
        lines.push(`Price: ${g('bcPrice')}/oz  |  Change: ${g('bcChange')}  |  Range: ${g('bcHighLow')}`);
        lines.push(`March OI: ${g('bcOI')} contracts  |  Total all months: ${g('bcOITotal')}`);
        lines.push(`Physical equiv: ${g('oiCalcOz')} oz  |  Notional: ${g('oiCalcUSD')}`);
        lines.push(`OI vs Registered: ${g('oiCalcVsReg')}  (Registered: ${g('kpiRegistered')} oz)`);
        lines.push(`LBMA Fix: ${g('lbmaUSD')} (${g('lbmaDate')})  |  COMEX-LBMA Spread: ${g('spreadUSD')}`);
        lines.push(`Gold/Silver Ratio: ${g('lbmaGSR')}  |  Target: ~50:1`);
        lines.push(`First Notice Day: ${g('kpiCountdownTarget')}  (${g('kpiCountdown')} remaining)`);
        lines.push(`MTD Deliveries: ${g('mtdContracts')} contracts / ${g('mtdOunces')} oz`);
        lines.push('');
        lines.push('COT POSITIONING (CFTC):');
        lines.push(`Report date: ${g('cotDate')}  |  Total OI: ${g('cotOI')}  |  Week delta: ${g('cotOIDelta')}`);
        lines.push(`Spec long: ${g('cotNCLong')} (${g('cotPctNCLong')})  |  Spec short: ${g('cotNCShortVal')} (${g('cotPctNCShort')})`);
        lines.push(`Net speculative position: ${g('cotNetSpec')}`);
        lines.push('');
        lines.push('Note: Load the AI Model for a full AI-generated analysis and Q&A capability.');
        aiText = lines.join('\n');
      } catch(e) {
        aiText = 'Snapshot data not yet available. Please refresh the dashboard and try again.';
      }
    }

    // Word-wrap and print AI text
    text(...C.white); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    const lines = doc.splitTextToSize(aiText, W - M*2);
    let pageLines = 0;
    for (const ln of lines) {
      if (y > 278) {
        doc.addPage();
        fill(...C.navy); doc.rect(0, 0, W, 297, 'F');
        fill(...C.accent); doc.rect(0, 0, W, 3, 'F');
        _pageHeader(doc, 'AI Market Analysis (continued)', C, W, M);
        y = 30; pageLines = 0;
      }
      doc.text(ln, M, y);
      y += 5.5;
      pageLines++;
    }

    // ════════════════════════════════════════════
    // PAGE — Q&A (if any chat history)
    // ════════════════════════════════════════════
    const qaHistory = chatHistory.filter(m => m.role !== 'system');
    if (qaHistory.length > 2) { // more than just the auto summary
      doc.addPage();
      fill(...C.navy); doc.rect(0, 0, W, 297, 'F');
      fill(...C.accent); doc.rect(0, 0, W, 3, 'F');
      _pageHeader(doc, 'Q&A Session', C, W, M);
      y = 30;

      // Skip first 2 (auto summary)
      const qaOnly = qaHistory.slice(2);
      for (let i = 0; i < qaOnly.length; i += 2) {
        const q = qaOnly[i];
        const a = qaOnly[i+1];
        if (!q) continue;

        if (y > 260) {
          doc.addPage();
          fill(...C.navy); doc.rect(0, 0, W, 297, 'F');
          fill(...C.accent); doc.rect(0, 0, W, 3, 'F');
          _pageHeader(doc, 'Q&A Session (continued)', C, W, M);
          y = 30;
        }

        // Question box
        fill(...[20, 40, 80]); doc.roundedRect(M, y, W-M*2, 8, 2, 2, 'F');
        text(...C.gold); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
        const qLines = doc.splitTextToSize('Q: ' + q.content, W - M*2 - 4);
        doc.text(qLines[0], M+3, y+5.5);
        y += 11;

        if (a) {
          text(...C.white); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
          const aLines = doc.splitTextToSize(a.content, W - M*2);
          for (const ln of aLines) {
            if (y > 278) {
              doc.addPage();
              fill(...C.navy); doc.rect(0, 0, W, 297, 'F');
              fill(...C.accent); doc.rect(0, 0, W, 3, 'F');
              _pageHeader(doc, 'Q&A Session (continued)', C, W, M);
              y = 30;
            }
            doc.text(ln, M, y);
            y += 5;
          }
        }
        y += 8;
      }
    }

    // ── Footer on all pages ──
    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      fill(...C.navy); doc.rect(0, 287, W, 10, 'F');
      fill(...C.gold); doc.rect(0, 287, W, 0.5, 'F');
      text(...C.muted); doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
      doc.text('SilverDash PWA  •  Data: CME Group / LBMA / CFTC  •  Not financial advice  •  Private & confidential', M, 293);
      doc.text(`Page ${p} of ${pageCount}`, W - M, 293, { align: 'right' });
    }

    // ── Save ──
    const dateStr = new Date().toISOString().slice(0,10);
    doc.save(`SilverDash_Report_${dateStr}.pdf`);

    btn.textContent = '✅ PDF Downloaded';
    if (typeof LOG !== 'undefined') LOG.info(`PDF report generated: ${pageCount} pages`);
    setTimeout(() => { btn.textContent = '📄 Export PDF Report'; btn.disabled = false; }, 3000);

  } catch(e) {
    btn.textContent = '⚠️ PDF Failed — Retry';
    btn.disabled    = false;
    if (typeof LOG !== 'undefined') LOG.error('PDF generation failed: ' + e.message);
    console.error('PDF error:', e);
  }
}

// ── PDF helpers ────────────────────────────────────────────────────────────
function _pdf(id) {
  const el = document.getElementById(id);
  return el ? (el.textContent || '').trim() || '—' : '—';
}

function _pageHeader(doc, title, C, W, M) {
  doc.setTextColor(...C.accent);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(title, M, 22);
  doc.setDrawColor(...C.accent);
  doc.setLineWidth(0.4);
  doc.line(M, 25, W - M, 25);
}

function _sectionTitle(doc, title, y, M, C) {
  doc.setTextColor(...C.gold);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(title, M, y);
}

function _tableStyle(C) {
  return {
    styles: {
      fillColor:  C.navy,
      textColor:  C.white,
      fontSize:   9,
      cellPadding: 3,
    },
    headStyles: {
      fillColor:  C.blue,
      textColor:  C.gold,
      fontStyle:  'bold',
      fontSize:   9,
    },
    alternateRowStyles: {
      fillColor: [15, 27, 51],
    },
    tableLineColor: C.accent,
    tableLineWidth: 0.2,
  };
}

// ── Detect previous WebLLM download crash on startup ─────────────────────
function detectPreviousCrash() {
  try {
    const started   = sessionStorage.getItem('webllm_download_started');
    const lastPct   = sessionStorage.getItem('webllm_last_pct');
    const completed = sessionStorage.getItem('webllm_completed');
    const hiddenAt  = sessionStorage.getItem('webllm_hidden_at_pct');
    if (started && !completed) {
      const elapsed = Math.round((Date.now() - parseInt(started)) / 1000);
      LOG.warn(`WebLLM CRASH DETECTED: download was at ${lastPct}% when page reloaded (${elapsed}s after start). Hidden at: ${hiddenAt || 'n/a'}%. This is likely Safari memory pressure terminating the tab.`);
      const statusEl = document.getElementById('aiConsoleStatus');
      if (statusEl) {
        statusEl.textContent = `⚠️ Previous download crashed at ${lastPct}% — likely Safari ran out of memory. Tap Load AI Model to retry. Check logs for details.`;
        statusEl.style.color = '#e08060';
      }
      // Clear crash state
      sessionStorage.removeItem('webllm_download_started');
      sessionStorage.removeItem('webllm_last_pct');
      sessionStorage.removeItem('webllm_hidden_at_pct');
    }
  } catch(e) {}
}

// ── Restore last session on page load ─────────────────────────────────────
function restoreSession() {
  try {
    const saved = sessionStorage.getItem('silverdash_ai_chat');
    const savedSummary = sessionStorage.getItem('silverdash_ai_summary');
    if (saved) {
      const log = document.getElementById('aiConsoleChatLog');
      if (log) {
        log.innerHTML = saved;
        log.scrollTop = log.scrollHeight;
        const status = document.getElementById('aiConsoleStatus');
        if (status) status.textContent = '⚠️ Page reloaded — AI model needs reloading (click Load AI Model). Previous responses restored below.';
      }
    }
    if (savedSummary) {
      window._lastAISummary = savedSummary;
    }
  } catch(e) {
    // sessionStorage unavailable — silent fail
  }
}

// ── Save chat log to sessionStorage after each message ────────────────────
function persistSession() {
  try {
    const log = document.getElementById('aiConsoleChatLog');
    if (log) sessionStorage.setItem('silverdash_ai_chat', log.innerHTML);
    if (window._lastAISummary) sessionStorage.setItem('silverdash_ai_summary', window._lastAISummary);
  } catch(e) {}
}

// ── Hook persistSession into askAI completion ──────────────────────────────
const _origAskAI = askAI;
async function askAIWithPersist(question, isAuto = false) {
  await _origAskAI(question, isAuto);
  persistSession();
}

// Run restore on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { detectPreviousCrash(); restoreSession(); });
} else {
  detectPreviousCrash();
  restoreSession();
}

// ── Stop generation ────────────────────────────────────────────────────────
function stopAI() {
  if (isGenerating) {
    stopRequested = true;
    if (typeof LOG !== 'undefined') LOG.info('WebLLM: stop requested by user');
  }
}

// ── Expose public functions ────────────────────────────────────────────────
window.SilverDashAI = {
  init:          initEngine,
  ask:           handleSend,
  stop:          stopAI,
  generatePDF:   generatePDFReport,
  persist:       persistSession,
};
