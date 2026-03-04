# Debugging Guide — SilverDash v4 v38

## Fast triage checklist
1. **🩺 Data Health**: which source is failing?
2. **Logs**: do you see HTTP status codes (403/404/5xx) or timeouts?
3. **Contract selection**: confirm the displayed Globex code for front month is what you expect.
4. **PDF worker**: if PDF Worker shows FAIL, margin/notices parsing may degrade.

## Common failure modes
### PDF worker / iOS preview
If PDF Worker is FAIL:
- iOS preview environments may block classic workers.
- v38 uses a Blob worker setup which usually fixes this.

### Margin % fallback
If the margin PDF changes formatting:
- Parser is tolerant to `NON - HRP` but tables can still shift.
- Logs will say what token window was detected.

### CME quote mismatch
If CME page differs from the dashboard:
- v38 selects the contract by **highest volume** in the quotes feed.
- If CME changes “most active” logic, update `selectFrontMonthQuote()` in `src/app.js`.
