/**
 * ai-summary.js
 * Version: 1.0.0
 * SilverDash PWA — Smart Rule-Based Market Summary Engine
 *
 * Reads live values from the dashboard DOM, applies threshold logic
 * and market analysis rules, and writes a formatted summary.
 * No API calls. No external dependencies. Works fully offline in Safari.
 *
 * Called by: index.html → generateAISummary()
 * Triggered by: "Generate Summary" button in the Live Quotes card
 */

'use strict';

/** ── Helpers ── */
function _get(id) {
  const el = document.getElementById(id);
  return el ? (el.textContent || '').trim() : '—';
}

function _num(str) {
  if (!str || str === '—') return null;
  const n = parseFloat(str.toString().replace(/[$,+×%]/g, '').trim());
  return isFinite(n) ? n : null;
}

function _fmt(n, dp = 0) {
  if (n === null || !isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function _fmtUSD(n, dp = 2) {
  if (n === null || !isFinite(n)) return '—';
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function _sign(n) {
  if (n === null) return '';
  return n >= 0 ? '+' : '';
}

/** ── Threshold definitions ── */
const THRESHOLDS = {
  // OI vs registered stock: how many paper oz for every physical oz
  oiVsReg: { low: 5, medium: 8, high: 12 },
  // COMEX vs LBMA spread ($): normal is ±$0.50, stress beyond ±$1.50
  spreadNormal:  0.50,
  spreadWarning: 1.50,
  spreadCrisis:  3.00,
  // Days to First Notice Day: urgent < 10
  fndUrgent: 10,
  fndWarning: 20,
  // Gold/Silver Ratio: Gary's strategy targets ~50:1
  gsrTarget:  50,
  gsrHigh:    80,
  gsrLow:     40,
  // Net speculative position: crowded long above 30,000, short squeeze risk below -5,000
  netSpecLong:  30000,
  netSpecShort: -5000,
  // % spec long of OI: elevated above 30%
  pctSpecLongHigh: 30,
  // MTD deliveries vs registered: stress if MTD oz > 20% of registered
  mtdVsRegStress: 0.20,
};

/** ── Main export ── */
function generateAISummary() {
  const btn      = document.getElementById('btnAISummary');
  const statusEl = document.getElementById('aiSummaryStatus');
  const textEl   = document.getElementById('aiSummaryText');
  const tsEl     = document.getElementById('aiSummaryTs');

  if (!btn || !statusEl || !textEl || !tsEl) {
    console.error('AI Summary: required DOM elements not found');
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ Analysing…';
  statusEl.textContent = 'Reading dashboard data…';
  textEl.style.display = 'none';
  tsEl.style.display   = 'none';

  try {
    /* ── 1. Harvest all live values from DOM ── */
    const d = {
      // Price
      price:          _num(_get('bcPrice')),
      priceChange:    _num(_get('bcChange')),
      highStr:        _get('bcHighLow').split('/')[0]?.trim() || '—',
      lowStr:         _get('bcHighLow').split('/')[1]?.trim() || '—',
      prevClose:      _num(_get('bcPrevClose')),
      volume:         _num(_get('bcVolume').replace(/,/g,'')),
      tradeDate:      _get('bcTradeDate'),

      // OI
      oiContracts:    _num(_get('oiCalcContracts').replace(/,/g,'')),
      oiTroyOz:       _num(_get('oiCalcOz').replace(/,/g,'')),
      oiMoz:          _num(_get('oiCalcMoz')),
      oiNotional:     _num(_get('oiCalcUSD').replace(/[$,]/g,'')),
      oiVsReg:        _num(_get('oiCalcVsReg')),
      oiDelta:        _num(_get('bcOIDelta')),

      // Inventory
      registered:     _num(_get('kpiRegistered').replace(/,/g,'')),
      regDelta:       _num(_get('kpiRegisteredDelta').replace(/,/g,'')),
      eligible:       _num(_get('kpiEligibleVal').replace(/,/g,'')),

      // COT
      cotOI:          _num(_get('cotOI').replace(/,/g,'')),
      cotDate:        _get('cotDate'),
      cotNCLong:      _num(_get('cotNCLong').replace(/,/g,'')),
      cotNCShort:     _num(_get('cotNCShortVal').replace(/,/g,'')),
      cotNetSpec:     _num(_get('cotNetSpec').replace(/,/g,'')),
      cotCommShort:   _num(_get('cotCommShortVal').replace(/,/g,'')),
      cotTraders:     _num(_get('cotTradersVal').replace(/,/g,'')),
      cotPctNCLong:   _num(_get('cotPctNCLong')),
      cotOIDelta:     _num(_get('cotOIDelta').replace(/,/g,'')),

      // Deliveries
      mtdContracts:   _num(_get('mtdContracts').replace(/,/g,'')),
      mtdOz:          _num(_get('mtdOunces').replace(/,/g,'')),
      mtdDelta:       _num(_get('mtdDelta').replace(/,/g,'')),

      // LBMA
      lbmaFix:        _num(_get('lbmaUSD')),
      lbmaDate:       _get('lbmaDate'),
      lbmaWeekChg:    _num(_get('lbmaWeekChange')),
      lbmaWeekPct:    _num(_get('lbmaWeekPct')),
      lbma52Hi:       _num(_get('lbma52wkHigh')),
      lbma52Lo:       _num(_get('lbma52wkLow')),
      gsr:            _num(_get('lbmaGSR')),

      // Spread
      spreadUSD:      _num(_get('spreadUSD')),

      // Countdown
      countdownStr:   _get('kpiCountdown'),
      fndDate:        _get('kpiCountdownTarget'),

      // Meta
      lastUpdated:    _get('lastUpdated'),
    };

    // Parse days-to-FND from countdown string (e.g. "9d 04:12:33")
    const fndMatch = d.countdownStr.match(/(\d+)d/);
    d.daysToFND = fndMatch ? parseInt(fndMatch[1]) : null;

    // Calculated
    d.mtdVsReg = (d.mtdOz && d.registered) ? d.mtdOz / d.registered : null;
    d.pctOf52Range = (d.lbmaFix && d.lbma52Hi && d.lbma52Lo && d.lbma52Hi !== d.lbma52Lo)
      ? ((d.lbmaFix - d.lbma52Lo) / (d.lbma52Hi - d.lbma52Lo)) * 100
      : null;

    statusEl.textContent = 'Running analysis…';

    /* ── 2. Build summary paragraphs ── */
    const lines = [];
    const now   = new Date().toISOString().slice(0, 19) + ' UTC';

    // ── Header ──
    lines.push(`📊 COMEX Silver Market Summary — Generated ${now}`);
    lines.push(`Data snapshot: ${d.lastUpdated || now}`);
    lines.push('');

    // ── Section 1: Price Action ──
    lines.push('── PRICE ACTION ──');
    if (d.price !== null) {
      const chgStr   = d.priceChange !== null ? ` (${_sign(d.priceChange)}${_fmtUSD(d.priceChange)} on the day)` : '';
      const prevStr  = d.prevClose   !== null ? ` versus a previous close of ${_fmtUSD(d.prevClose)}` : '';
      lines.push(
        `COMEX March silver (SIH26) last traded at ${_fmtUSD(d.price)}/oz${chgStr}${prevStr}. ` +
        (d.highStr !== '—' && d.lowStr !== '—'
          ? `The intraday range was ${d.highStr} – ${d.lowStr}, ` +
            `a spread of ${d.highStr !== '—' && d.lowStr !== '—'
              ? _fmtUSD((_num(d.highStr) || 0) - (_num(d.lowStr) || 0), 2)
              : '—'}/oz.`
          : '')
      );

      // Price vs LBMA
      if (d.lbmaFix !== null && d.spreadUSD !== null) {
        const absSpread = Math.abs(d.spreadUSD);
        const direction = d.spreadUSD < 0 ? 'below' : 'above';
        let spreadComment = '';
        if (absSpread >= THRESHOLDS.spreadCrisis) {
          spreadComment = `This is a significant dislocation and warrants close attention — large negative spreads have historically preceded delivery squeeze conditions.`;
        } else if (absSpread >= THRESHOLDS.spreadWarning) {
          spreadComment = `This is an elevated spread and suggests some dislocation between the futures and physical market.`;
        } else {
          spreadComment = `This is within a normal range.`;
        }
        lines.push(
          `The COMEX futures price is trading ${_fmtUSD(absSpread, 3)} ${direction} the most recent LBMA fix of ${_fmtUSD(d.lbmaFix)} (${d.lbmaDate}). ${spreadComment}`
        );
      }

      // LBMA weekly trend
      if (d.lbmaWeekChg !== null && d.lbmaWeekPct !== null) {
        const dir = d.lbmaWeekChg >= 0 ? 'gained' : 'lost';
        lines.push(
          `On the LBMA fix, silver has ${dir} ${_fmtUSD(Math.abs(d.lbmaWeekChg), 3)} (${Math.abs(d.lbmaWeekPct).toFixed(2)}%) over the past seven trading days.`
        );
      }

      // 52-week position
      if (d.pctOf52Range !== null) {
        let posComment = '';
        if (d.pctOf52Range >= 90)       posComment = 'near the top of its 52-week range — a potential resistance zone.';
        else if (d.pctOf52Range >= 70)  posComment = 'in the upper portion of its 52-week range.';
        else if (d.pctOf52Range >= 30)  posComment = 'in the middle of its 52-week range.';
        else if (d.pctOf52Range >= 10)  posComment = 'in the lower portion of its 52-week range.';
        else                            posComment = 'near the bottom of its 52-week range — potential support zone.';
        lines.push(
          `The current LBMA price of ${_fmtUSD(d.lbmaFix)} sits at ${d.pctOf52Range.toFixed(1)}% of the 52-week range ` +
          `(low: ${_fmtUSD(d.lbma52Lo)} / high: ${_fmtUSD(d.lbma52Hi)}), placing it ${posComment}`
        );
      }
    } else {
      lines.push('Price data is not yet available — please wait for the next refresh cycle.');
    }
    lines.push('');

    // ── Section 2: Open Interest & Physical Equivalent ──
    lines.push('── OPEN INTEREST & PHYSICAL EQUIVALENT ──');
    if (d.oiContracts !== null) {
      lines.push(
        `Total open interest stands at ${_fmt(d.oiContracts)} contracts. ` +
        `At 5,000 troy oz per contract, this represents ${_fmt(d.oiTroyOz)} troy oz ` +
        `(${d.oiMoz !== null ? d.oiMoz.toFixed(2) + 'M oz' : '—'}) of notional silver exposure` +
        (d.oiNotional !== null ? `, with a notional market value of approximately ${_fmtUSD(d.oiNotional, 0)}.` : '.')
      );

      if (d.oiDelta !== null) {
        const dir = d.oiDelta < 0 ? 'fell' : 'rose';
        lines.push(
          `Open interest ${dir} by ${_fmt(Math.abs(d.oiDelta))} contracts on the day, ` +
          `which ${d.oiDelta < 0 ? 'indicates position liquidation or roll activity.' : 'indicates new money entering the market.'}`
        );
      }

      if (d.oiVsReg !== null) {
        let stressLevel = '';
        let stressComment = '';
        if (d.oiVsReg >= THRESHOLDS.oiVsReg.high) {
          stressLevel = '🔴 HIGH STRESS';
          stressComment = `At ${d.oiVsReg.toFixed(2)}× registered stock, paper obligations are extremely elevated relative to available physical metal. This level of leverage has historically been associated with elevated squeeze risk.`;
        } else if (d.oiVsReg >= THRESHOLDS.oiVsReg.medium) {
          stressLevel = '🟠 ELEVATED';
          stressComment = `At ${d.oiVsReg.toFixed(2)}× registered stock, paper-to-physical leverage is elevated. This warrants monitoring, particularly as First Notice Day approaches.`;
        } else if (d.oiVsReg >= THRESHOLDS.oiVsReg.low) {
          stressLevel = '🟡 MODERATE';
          stressComment = `At ${d.oiVsReg.toFixed(2)}× registered stock, paper-to-physical leverage is moderate.`;
        } else {
          stressLevel = '🟢 NORMAL';
          stressComment = `At ${d.oiVsReg.toFixed(2)}× registered stock, paper-to-physical leverage is within a historically normal range.`;
        }
        lines.push(
          `Paper-to-physical leverage: ${stressLevel}. ${stressComment} ` +
          `COMEX registered inventory is ${_fmt(d.registered)} troy oz.`
        );
      }
    } else {
      lines.push('Open interest data is not yet available.');
    }
    lines.push('');

    // ── Section 3: Inventory ──
    lines.push('── COMEX INVENTORY ──');
    if (d.registered !== null) {
      const regDeltaStr = d.regDelta !== null
        ? ` (${_sign(d.regDelta)}${_fmt(d.regDelta)} oz day-on-day${d.regDelta < 0 ? ' — metal leaving warehouses' : ' — metal arriving in warehouses'})`
        : '';
      const eligStr = d.eligible !== null
        ? ` Eligible silver (held in COMEX-approved vaults but not yet warranted for delivery) stands at ${_fmt(d.eligible)} troy oz.`
        : '';
      lines.push(
        `Registered COMEX silver — the metal actually warranted and available for delivery — is ${_fmt(d.registered)} troy oz${regDeltaStr}.${eligStr}`
      );

      // MTD deliveries vs registered
      if (d.mtdContracts !== null && d.mtdOz !== null) {
        const mtdVsRegPct = d.mtdVsReg !== null ? (d.mtdVsReg * 100).toFixed(1) : null;
        let mtdComment = '';
        if (d.mtdVsReg !== null && d.mtdVsReg >= THRESHOLDS.mtdVsRegStress) {
          mtdComment = ` This represents ${mtdVsRegPct}% of registered stock — a meaningful drawdown that adds to delivery pressure.`;
        } else if (d.mtdVsReg !== null) {
          mtdComment = ` This represents ${mtdVsRegPct}% of registered stock — within a manageable range for this stage of the delivery cycle.`;
        }
        lines.push(
          `Month-to-date delivery notices: ${_fmt(d.mtdContracts)} contracts (${_fmt(d.mtdOz)} troy oz).${mtdComment}`
        );
      }

      // FND countdown
      if (d.daysToFND !== null) {
        let fndComment = '';
        if (d.daysToFND <= THRESHOLDS.fndUrgent) {
          fndComment = `⚠️ First Notice Day is ${d.daysToFND} day${d.daysToFND === 1 ? '' : 's'} away (${d.fndDate}). Non-commercial longs must roll or take delivery very soon. Watch for accelerated roll activity and OI decline.`;
        } else if (d.daysToFND <= THRESHOLDS.fndWarning) {
          fndComment = `First Notice Day is ${d.daysToFND} days away (${d.fndDate}). Roll activity is likely to increase over the coming days as non-commercial longs position out of March.`;
        } else {
          fndComment = `First Notice Day is ${d.daysToFND} days away (${d.fndDate}).`;
        }
        lines.push(fndComment);
      }
    } else {
      lines.push('Inventory data is not yet available.');
    }
    lines.push('');

    // ── Section 4: COT Positioning ──
    lines.push('── CFTC COMMITMENT OF TRADERS ──');
    if (d.cotOI !== null) {
      lines.push(
        `The most recent CFTC Commitment of Traders report (${d.cotDate}) shows total open interest of ${_fmt(d.cotOI)} contracts` +
        (d.cotOIDelta !== null ? `, a change of ${_sign(d.cotOIDelta)}${_fmt(d.cotOIDelta)} on the week.` : '.')
      );

      if (d.cotNCLong !== null && d.cotNCShort !== null && d.cotNetSpec !== null) {
        const specDir = d.cotNetSpec > 0 ? 'net long' : 'net short';
        let crowdedComment = '';
        if (d.cotNetSpec >= THRESHOLDS.netSpecLong) {
          crowdedComment = ` This is a crowded long position. Crowded longs increase the risk of sharp sell-offs if momentum turns.`;
        } else if (d.cotNetSpec <= THRESHOLDS.netSpecShort) {
          crowdedComment = ` This is a significant net short position among speculators — an environment that can produce sharp short-covering rallies.`;
        } else {
          crowdedComment = ` Positioning is relatively balanced.`;
        }
        lines.push(
          `Non-commercial (speculative) traders are ${specDir} by ${_fmt(Math.abs(d.cotNetSpec))} contracts ` +
          `(long ${_fmt(d.cotNCLong)} / short ${_fmt(d.cotNCShort)}).${crowdedComment}`
        );
      }

      if (d.cotPctNCLong !== null) {
        let pctComment = d.cotPctNCLong >= THRESHOLDS.pctSpecLongHigh
          ? `At ${d.cotPctNCLong.toFixed(1)}% of total OI, speculative longs are an elevated proportion — a signal to watch for potential unwinding.`
          : `Speculative longs represent ${d.cotPctNCLong.toFixed(1)}% of total OI, which is within a normal range.`;
        lines.push(pctComment);
      }

      if (d.cotCommShort !== null) {
        lines.push(
          `Commercial hedgers (producers and dealers) hold ${_fmt(d.cotCommShort)} short contracts, ` +
          `reflecting the typical hedging posture of the physical silver industry.`
        );
      }
    } else {
      lines.push('CFTC COT data is not yet available.');
    }
    lines.push('');

    // ── Section 5: Gold/Silver Ratio ──
    lines.push('── GOLD / SILVER RATIO ──');
    if (d.gsr !== null) {
      let gsrComment = '';
      let gsrStrategy = '';
      if (d.gsr >= THRESHOLDS.gsrHigh) {
        gsrComment = `At ${d.gsr.toFixed(1)}, the ratio is historically very high, indicating silver is cheap relative to gold on a historical basis.`;
        gsrStrategy = `For holders of silver with a gold-conversion strategy, this ratio remains well above the target of 50:1, suggesting it is not yet time to convert.`;
      } else if (d.gsr >= THRESHOLDS.gsrTarget) {
        gsrComment = `At ${d.gsr.toFixed(1)}, the ratio is above the long-term average, indicating silver remains undervalued relative to gold.`;
        gsrStrategy = `The ratio is above the 50:1 target threshold. A continued move toward 50:1 would represent a significant gain for silver holders relative to gold.`;
      } else if (d.gsr >= THRESHOLDS.gsrLow) {
        gsrComment = `At ${d.gsr.toFixed(1)}, the ratio is in the range where a silver-to-gold conversion may be worth considering.`;
        gsrStrategy = `The ratio is approaching the 50:1 target. Holders of a gold-conversion strategy should be monitoring this closely.`;
      } else {
        gsrComment = `At ${d.gsr.toFixed(1)}, the ratio is below 40 — historically a signal that silver has meaningfully outperformed gold. This may be an opportune time to consider converting silver to gold.`;
        gsrStrategy = `The 50:1 target has been significantly exceeded. A gold-conversion strategy would be strongly in play at this ratio.`;
      }
      lines.push(`Gold/Silver Ratio (LBMA): ${d.gsr.toFixed(1)}. ${gsrComment} ${gsrStrategy}`);
    } else {
      lines.push('Gold/Silver Ratio data is not yet available.');
    }
    lines.push('');

    // ── Section 6: Key Watch Points ──
    lines.push('── KEY WATCH POINTS ──');
    const watches = [];

    // FND urgency
    if (d.daysToFND !== null && d.daysToFND <= THRESHOLDS.fndUrgent) {
      watches.push(
        `⚡ First Notice Day in ${d.daysToFND} day${d.daysToFND === 1 ? '' : 's'}: ` +
        `Watch for rapid OI decline as non-commercial longs roll positions. ` +
        `Failure to roll = physical delivery obligation.`
      );
    }

    // OI vs registered stress
    if (d.oiVsReg !== null && d.oiVsReg >= THRESHOLDS.oiVsReg.medium) {
      watches.push(
        `📦 Paper-to-physical leverage at ${d.oiVsReg.toFixed(2)}×: ` +
        `Monitor registered inventory for further drawdowns. ` +
        `A sharp drop below 80M oz registered could accelerate squeeze risk.`
      );
    }

    // Spread alert
    if (d.spreadUSD !== null && Math.abs(d.spreadUSD) >= THRESHOLDS.spreadWarning) {
      const dir = d.spreadUSD < 0 ? 'below' : 'above';
      watches.push(
        `⚖️ COMEX trading ${_fmtUSD(Math.abs(d.spreadUSD), 2)} ${dir} LBMA spot: ` +
        `An elevated spread can signal physical demand stress. ` +
        `Watch for this to narrow or widen over coming sessions.`
      );
    }

    // GSR near target
    if (d.gsr !== null && d.gsr < 55 && d.gsr > 45) {
      watches.push(
        `🥇 Gold/Silver Ratio at ${d.gsr.toFixed(1)} — approaching the 50:1 strategy target. ` +
        `Begin monitoring conversion timing if ratio drops toward 50.`
      );
    }

    // COT crowded long
    if (d.cotNetSpec !== null && d.cotNetSpec >= THRESHOLDS.netSpecLong) {
      watches.push(
        `📉 Crowded speculative long: ${_fmt(d.cotNetSpec)} net contracts. ` +
        `Any negative catalyst could trigger rapid unwinding. ` +
        `Watch for momentum shifts or macro risk-off events.`
      );
    }

    // Always have at least 2 watch points
    if (watches.length === 0) {
      watches.push(
        `📊 No immediate stress signals detected. Continue monitoring OI trend, ` +
        `registered inventory levels, and the COMEX/LBMA spread for early warning signs.`
      );
    }
    if (watches.length < 2) {
      watches.push(
        `📅 Track daily delivery notices as First Notice Day (${d.fndDate}) approaches — ` +
        `acceleration in MTD contracts signals genuine physical demand.`
      );
    }

    watches.forEach((w, i) => lines.push(`${i + 1}. ${w}`));
    lines.push('');

    // ── Footer ──
    lines.push(
      `─────────────────────────────────────────────\n` +
      `Sources: CME Group (quotes, OI, inventory), CFTC COT (${d.cotDate}), LBMA (${d.lbmaDate}).\n` +
      `Analysis generated locally by SilverDash rule engine v1.0.0.\n` +
      `Not financial advice. Always verify against primary sources.`
    );

    /* ── 3. Write to DOM ── */
    const fullText = lines.join('\n');
    textEl.textContent   = fullText;
    textEl.style.display = 'block';
    tsEl.textContent     = `Generated: ${now} · SilverDash rule engine v1.0.0 · Fully offline, no API used`;
    tsEl.style.display   = 'block';
    statusEl.textContent = '✅ Summary generated';
    btn.textContent      = '🔄 Regenerate';

    if (typeof LOG !== 'undefined') {
      LOG.info(`AI Summary (local): generated OK, ${fullText.length} chars`);
    }

  } catch (e) {
    statusEl.textContent = `⚠️ Summary failed: ${e.message}`;
    btn.textContent      = '✨ Generate Summary';
    if (typeof LOG !== 'undefined') LOG.error('AI Summary (local) failed: ' + e.message);
    console.error('generateAISummary error:', e);
  } finally {
    btn.disabled = false;
  }
}
