[README.md](https://github.com/user-attachments/files/29360677/README.md)
# 2B1C FFL — GitHub Frontend v0.3.2a

Purpose:
GitHub Pages mobile frontend connected to Google Apps Script backend API.

## Structure

- GitHub Pages = frontend/mobile app shell
- Apps Script = backend API
- Google Sheet = source of truth

## Current API method

v0.3.2a uses JSONP GET calls because normal browser fetch from GitHub Pages to Apps Script can run into CORS restrictions.

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


## v0.3.2a

- Auto-loads the home screen when a saved valid league password exists.
- Keeps manager/PIN remembered after verification.
- Frontend-only GitHub update. No Apps Script or Sheet change required.


## v0.3.2a

- Hides the login controls while saved login is auto-loading.
- Changes topbar wording from "Posting as..." to "Manager: ..." until team names are added to the Sheet/app data.
- Renames "Clear Saved Password" to "Reset Saved Login".
