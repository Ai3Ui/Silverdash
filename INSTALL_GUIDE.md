# Install Guide — SilverDash v4 v38

## 1) Important: do not open as file://
If you tap `index.html` directly as a file, Safari will often block fetch requests.
Use a local server (Textastic preview server counts).

## 2) Textastic (iPhone)
1. Unzip the project.
2. Upload the entire folder **SilverDash v4** to Textastic.
3. Open `index.html` in Textastic preview.
4. In Safari: Share → **Add to Home Screen** (installs the PWA).

## 3) Desktop quick run
From inside the **SilverDash v4** folder:
```bash
python -m http.server 8000
```
Open:
`http://localhost:8000/`

## 4) If data looks wrong
- Check the **🩺 Data Health** card.
- Use **Jump to Logs**.
- Look for FAIL markers and HTTP status codes.
