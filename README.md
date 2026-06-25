# 2B1C FFL — GitHub Frontend v0.3.1

Purpose:
GitHub Pages mobile frontend connected to Google Apps Script backend API.

## Structure

- GitHub Pages = frontend/mobile app shell
- Apps Script = backend API
- Google Sheet = source of truth

## Current API method

v0.3.1 uses JSONP GET calls because normal browser fetch from GitHub Pages to Apps Script can run into CORS restrictions.

API actions:
- ping
- checkPassword
- getAppData
- verifyManagerPin
- submitTrashTalk

## Deploy order

1. Install `GAS/Code.gs.txt` into Apps Script.
2. Deploy Apps Script as a new version.
3. Confirm API ping works:
   `/exec?api=1&action=ping`
4. Upload the `GitHub/` files to the GitHub repo root.
5. Confirm GitHub Pages app loads and connects.

## If Apps Script URL changes

Edit `app.js`:

```js
const APPS_SCRIPT_API_URL = "YOUR_WEB_APP_EXEC_URL";
```
