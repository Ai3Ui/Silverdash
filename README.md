# SilverDash v4 (PWA) — v40 Hardened

**Build:** 2026-02-26T20:20:40Z

This is a bundled, offline-friendly PWA dashboard for:
- COMEX silver inventory + delivery notices
- Front-month quotes + specific March contract (SIH26) stats
- LBMA fix/spot proxies and supporting ratios
- Shanghai/Asia comparisons where available

## What changed in v38 (brutal fixes + hardening)
- **PWA casing bug fixed:** `Index.html` renamed to `index.html` so `manifest.json` + `sw.js` match.
- **Duplicate libraries removed:** only `/libs/` is canonical (no root duplicates).
- **PDF worker reliability fixed (iOS/Textastic):** worker is now configured after `pdf.min.js` loads.
- **Margin PDF parsing hardened:** accepts `NON - HRP` spacing variations.
- **Front-month selection hardened:** no longer assumes `quotes[0]` is front month; prefers **highest volume** with a valid last price.
- **Data Health card:** quick visibility into which upstream sources are OK/FAIL and how recently they last succeeded.
- **Network hardening:** adds fetch timeouts + limited retries via a single wrapper.

## Folder structure
```
SilverDash v4/
  index.html
  manifest.json
  sw.js
  icons/
  libs/           # canonical libraries (no CDN)
  src/
    app.js        # main application logic (moved out of HTML)
  *.md            # docs
```

## Run locally (recommended for desktop browsers)
Most browsers block fetch from `file://`. Use a small local web server:

### Python
```bash
cd "SilverDash v4"
python -m http.server 8000
```
Open: `http://localhost:8000/`

### Node (optional)
```bash
npx serve .
```

## Install on iPhone (Textastic)
1. Unzip the project.
2. Upload the entire **SilverDash v4** folder to Textastic.
3. Open `index.html` via Textastic’s local server/preview.
4. Use Safari Share → **Add to Home Screen**.

## Notes
- “OFFICIAL” style data (daily inventory, notices) can be delayed vs live quotes.
- If an upstream endpoint fails, check **🩺 Data Health** first, then open Logs.


## Modes
- **Live mode**: fast refresh, skips heavy PDFs/XLS.
- **Report mode**: full refresh including inventory XLS + delivery PDFs.
- **Offline mode**: no network calls, loads last saved snapshot.

## Test harness
Open `tests.html` in the same server root to run the built-in sanity checks.


## ChinaWest pills (what they mean)
These are **diagnostic status pills** for the fast-refresh "China vs West" loop.
- **ChinaWest COMEX/LBMA/SGE/SHFE:** last HTTP status seen for each endpoint (e.g., 200, 404, 429). `—` means not yet attempted.
- **429 count:** number of HTTP 429 (rate limited) responses since last page load or since you press "China vs West refresh".

They are not intended to be trading signals. They exist so you can immediately see which upstream source is failing.
