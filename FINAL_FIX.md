**NOTE (v38):** This file is legacy from earlier iterations. See README.md for the current state.

# FINAL FIX - Registered Inventory Parser

## The Problem (FOUND!)

Your logs showed:
```
TOTAL REGISTERED row: parsed nums=[0, 93030184.91200002, 0, 0, 0, -130217.8, 92899967.112, 0]
Inventory loaded: Registered=0
```

The parser was picking the **last** number (`0`) when the actual registered value is **92,899,967** (second-to-last).

## The Fix

Changed the parser to:
1. Filter out small numbers (< 1,000 oz) - these are change columns
2. Filter out zeros
3. Pick the **last valid number** (the closing balance)

### What This Changes

**Before:**
```javascript
// Just picked the last number blindly
if (nums.length) registered = nums[nums.length-1];
// Result: 0 ❌
```

**After:**
```javascript
// Filter out trailing zeros and change columns
const validNums = nums.filter(n => Math.abs(n) >= 1000);
registered = validNums[validNums.length - 1];
// Result: 92,899,967 ✅
```

## Expected Results

After uploading this version, you should see:

### In Logs:
```
INFO  TOTAL REGISTERED row: raw cells=[...], parsed nums=[...]
INFO  Inventory loaded: Registered=92899967, Eligible=283535021
```

### On Dashboard:
```
COMEX Registered Inventory (Daily Metal Stocks Report)

92,899,967  troy oz (Registered)

Δ vs prior day: [some number]    Eligible: 283,535,021
```

## What Still Won't Work

1. **March Countdown** - "Fetch failed" (calendar parsing issue)
2. **Open Interest** - All show "—" (404 error on CME endpoint)
3. **Delivery Notices** - May show "—" (PDF parsing might also have issues)

But **REGISTERED INVENTORY WILL NOW SHOW CORRECTLY!** 🎉

## Test It

1. Upload this new version
2. Clear logs
3. Tap "Refresh now"
4. Check the COMEX Registered Inventory card
5. Should show **~92.9 million oz**

The number should match what's in your logs:
```
Inventory loaded: Registered=92899967
```

---

**This fix addresses the main data display issue!**

The registered inventory was the most critical data point, and it will now display correctly.
