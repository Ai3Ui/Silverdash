**NOTE (v38):** This file is legacy from earlier iterations. See README.md for the current state.

# SilverDash PWA v3 - BUNDLED (No CDN Required) 📦

## What's Different in This Version?

This is a **fully self-contained** version with all JavaScript libraries bundled locally. **No internet connection required** for the libraries to load!

### ✅ Includes Local Libraries
```
libs/
├── xlsx.full.min.js      (862 KB) - Excel file parsing
├── pdf.min.js            (299 KB) - PDF parsing  
├── pdf.worker.min.js     (1.0 MB) - PDF worker thread
└── chart.umd.min.js      (197 KB) - Chart rendering
```

**Total Size:** ~2.4 MB of bundled libraries

---

## Why You Need This Version

Your iPhone Safari is **blocking cdn.jsdelivr.net**, which means the regular version can't load:
- ❌ XLSX.js (for reading CME inventory Excel files)
- ❌ PDF.js (for parsing delivery notice PDFs)
- ✅ Chart.js (sometimes loads, sometimes doesn't)

This bundled version **works completely offline** (for the UI) and only needs network for live CME data.

---

## File Structure

```
SilverDash_PWA_v3_BUNDLED/
├── index.html              ← Main dashboard (uses LOCAL libs)
├── manifest.json           ← PWA manifest
├── sw.js                   ← Service worker
├── README.md               ← This file
├── INSTALL_GUIDE.md        ← Installation instructions
├── icons/
│   ├── icon-192.png       ← App icon (192x192)
│   └── icon-512.png       ← App icon (512x512)
└── libs/                   ← LOCAL LIBRARIES (NO CDN!)
    ├── xlsx.full.min.js
    ├── pdf.min.js
    ├── pdf.worker.min.js
    └── chart.umd.min.js
```

---

## Installation (iPhone with Textastic)

### Step 1: Upload ALL Files
1. Open **Textastic** app on iPhone
2. Create a new folder: `SilverDash`
3. Upload **ENTIRE** folder including:
   - ✅ index.html
   - ✅ manifest.json
   - ✅ sw.js
   - ✅ icons/ folder (with both PNG files)
   - ✅ **libs/ folder (with all 4 JS files)** ← CRITICAL!

**IMPORTANT:** The `libs/` folder MUST be uploaded. Without it, the app won't work.

### Step 2: Start Web Server
1. In Textastic, select the `SilverDash` folder
2. Tap the **≡** menu button
3. Select **"Start Web Server"**
4. Note the URL (e.g., `http://127.0.0.1:54487/`)

### Step 3: Open in Safari
1. Open **Safari** on your iPhone
2. Go to: `http://127.0.0.1:<PORT>/index.html`
   - Replace `<PORT>` with the number from step 2
3. You should see the dashboard loading

### Step 4: Verify Libraries Loaded
1. Scroll to **"Debug / Errors"** section
2. Check the status indicators:
   - ✅ **XLSX: OK** (not MISSING!)
   - ✅ **PDF.js: OK** (not MISSING!)
   - ✅ **Chart.js: OK**
3. Network should show **online**
4. Refresh loop should show a number (e.g., **120s**)

### Step 5: Wait for Data
1. After 5-10 seconds, data should populate:
   - COMEX Registered Inventory shows numbers
   - March Delivery Countdown shows timer
   - Open Interest sections show numbers
   - Daily Roll Chart renders

### Step 6: Add to Home Screen (Optional)
1. Tap Safari's **Share** button
2. Select **"Add to Home Screen"**
3. Name it "Silver Dashboard"
4. Tap **Add**
5. App will open in standalone mode (no Safari UI)

---

## What's Fixed in v3

### 1. ✅ PDFjsLib Error Fixed
- Libraries now load from local files
- No more "Can't find variable: pdfjsLib"

### 2. ✅ Calendar Hammering Fixed
- Countdown fetches calendar once, caches for 6 hours
- If error: waits 5 minutes before retry
- No more hitting CME endpoint every second

### 3. ✅ Better Error Messages
- Clear warnings when libraries fail
- Explains what's missing and why
- Provides actionable solutions

### 4. ✅ All Previous Fixes
- Comment syntax error fixed
- Proper initialization in window.onload
- Defensive checks for all libraries

---

## Troubleshooting

### "XLSX: MISSING" or "PDF.js: MISSING"

**Cause:** The `libs/` folder wasn't uploaded or is in wrong location.

**Fix:**
1. Check Textastic file browser
2. Verify `libs/` folder exists at same level as `index.html`
3. Verify all 4 .js files are inside `libs/`
4. If missing, upload the entire folder again

### "Network: offline"

**Cause:** iPhone is not connected to internet.

**Fix:**
1. Check WiFi/cellular connection
2. Try loading any website in Safari
3. Dashboard will show cached UI, but can't fetch CME data

### Data Not Loading

**Cause:** Various possibilities.

**Fix:**
1. Check Debug/Errors section for specific error messages
2. Verify all three libraries show "OK"
3. Check network shows "online"
4. Wait 10-15 seconds (CME endpoints can be slow)
5. Tap "Refresh now" button

### "Refresh loop: starting" Stuck

**Cause:** Libraries haven't finished loading.

**Fix:**
1. Wait 5-10 seconds
2. Hard refresh page (pull down in Safari)
3. Verify libs/ folder uploaded correctly

### Chart Not Showing

**Cause:** Chart.js library issue or no data yet.

**Fix:**
1. Verify "Chart.js: OK" in Debug section
2. Wait for data to load (chart needs historical data)
3. Check Historical Roll Ledger table has entries
4. Refresh page

---

## File Sizes

| File | Size | Purpose |
|------|------|---------|
| index.html | 41 KB | Main dashboard |
| libs/xlsx.full.min.js | 862 KB | Excel parsing |
| libs/pdf.min.js | 299 KB | PDF parsing |
| libs/pdf.worker.min.js | 1.0 MB | PDF worker |
| libs/chart.umd.min.js | 197 KB | Charts |
| icons/icon-512.png | 11 KB | App icon |
| icons/icon-192.png | 3.5 KB | App icon |

**Total:** ~2.4 MB

---

## Network Usage

### First Load (Without Service Worker Cache)
- HTML: 41 KB
- Libraries: 2.4 MB (from local files, no network)
- Icons: 14 KB
- **Total Initial:** ~2.5 MB

### Subsequent Loads (With Service Worker Cache)
- Everything cached locally
- **Only CME data fetched:**
  - Silver_stocks.xls: ~20 KB
  - Quotes JSON: ~5 KB
  - PDF reports: ~50 KB each
  - Calendar page: ~50 KB
- **Total per refresh:** ~125 KB

---

## What This Dashboard Shows

### 1. COMEX Registered Inventory
- Live data from `Silver_stocks.xls`
- Updates nightly (CME publishes after market close)
- Shows registered + eligible amounts
- Day-over-day change tracking

### 2. March Delivery Countdown (SIH26)
- Countdown to First Notice Day
- Fetched from CME Silver Futures calendar
- Cached for 6 hours
- Updates every second

### 3. Open Interest Tracking
- Feb (SIG26) - Near contract
- Mar (SIH26) - Focus contract
- Later months - Sum of all other contracts
- Shows daily roll activity

### 4. Delivery Notices
- Daily/MTD/YTD contract deliveries
- Parsed from CME PDF reports
- 5,000 oz per contract
- Day-over-day change tracking

### 5. Daily Roll Chart
- Visual chart of contract roll activity
- Shows delta changes per day
- Includes 7-day moving averages
- Historical ledger stored locally

---

## Data Refresh

### Automatic
- **Every 120 seconds** (2 minutes)
- Countdown updates every 1 second
- Auto-refresh can be changed in code (CFG.refreshSeconds)

### Manual
- Tap **"Refresh now"** button anytime
- Reloads all data immediately
- Check "Last updated" timestamp

---

## Browser Support

### ✅ Fully Supported
- **Safari on iOS 13.0+** ← Primary target
- Safari on macOS 11.0+
- Chrome on Android 5.0+

### ⚠️ Limited
- Firefox on iOS (no standalone PWA mode)
- Chrome on iOS (uses Safari engine)

### ❌ Not Supported
- Internet Explorer (any version)

---

## Privacy & Security

### Local Storage Only
- Roll ledger stored in browser localStorage
- Logs stored in localStorage (max 120 KB)
- No data sent to external servers
- No tracking or analytics

### Public Data Only
- All CME data is public information
- No authentication required
- No API keys needed
- Direct calls to CME endpoints

### HTTPS Recommended
- Service worker requires HTTPS (or localhost)
- For production deployment, use HTTPS
- Textastic localhost works fine for testing

---

## Comparison: CDN vs Bundled

| Feature | CDN Version | Bundled Version |
|---------|-------------|-----------------|
| File size | 41 KB HTML | 2.5 MB total |
| Load time | Fast (if CDN works) | Slower initial |
| CDN required | ✅ Yes | ❌ No |
| Works offline (UI) | ❌ No | ✅ Yes |
| iPhone compatible | ❌ Often blocked | ✅ Always works |
| Updates | Auto (from CDN) | Manual (replace files) |

---

## Advanced: Updating Libraries

If you need newer versions of libraries:

1. Download from CDN:
   - XLSX: https://cdnjs.cloudflare.com/ajax/libs/xlsx/
   - PDF.js: https://cdnjs.cloudflare.com/ajax/libs/pdf.js/
   - Chart.js: https://cdnjs.cloudflare.com/ajax/libs/Chart.js/

2. Replace files in `libs/` folder

3. Update paths in `index.html` if needed

4. Test thoroughly before deploying

---

## Support

### Check These First
1. Debug/Errors section in app
2. All libraries show "OK"
3. Network shows "online"
4. Browser console (Safari DevTools)

### Common Issues Resolved
- ✅ Libraries blocked by CDN
- ✅ PDFjsLib not found error
- ✅ Calendar endpoint hammering
- ✅ Refresh loop stuck at "starting"

---

## Version History

### v3 BUNDLED (Current)
- ✅ All libraries bundled locally
- ✅ Calendar fetch caching fixed
- ✅ Error backoff implemented
- ✅ Better error messages
- ✅ No CDN required

### v3 FINAL (Previous)
- Calendar hammering fixed
- Better library detection
- Still required CDN

### v2 (Logging)
- Added logging system
- Dependency status indicators
- Enhanced error capture

### v1 (Initial)
- Basic dashboard functionality
- March delivery focus
- Roll tracking

---

**Status:** ✅ Production Ready (No CDN Required)  
**Version:** v3 BUNDLED  
**Date:** 2026-02-16  
**File Count:** 10 files (4 in libs/)  
**Total Size:** ~2.5 MB

**This version will work on your iPhone even with content blockers enabled!**
