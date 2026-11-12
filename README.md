[README.txt](https://github.com/user-attachments/files/34721757/README.txt)
2B1C FFL - v1.6.14 - Pay tab tap-to-pay + dues tracking

FILES IN THIS PACKAGE (frontend-only, replace in GitHub repo root):
- index.html
- app.js
- styles.css

WHAT CHANGED:
- Pay tab: real Venmo/Cash App tap-to-pay buttons (brand-color badges), no QR
- New "Who's Paid" list on Pay tab - public, unpaid managers shown first
- Commish Tools > Manager Info: Paid toggle per manager, saves instantly
- Fixed: addManagerPublic_ (backend) was writing new managers into the wrong
  sheet columns - see Code.gs delivered separately, paste into Apps Script
  editor (not part of this zip - Code.gs lives in Apps Script, not the repo)

INSTALL:
1. Upload/replace these 3 files at the root of the wrsorensen/2b1c_ffl repo,
   main branch.
2. Commit.
3. Confirm GitHub Pages rebuilds and the live footer shows v1.6.14.

BACKEND (separate, not in this zip):
- Code.gs full file was sent separately - paste into the Apps Script editor,
  then Deploy > Manage deployments > pencil icon > New version > Deploy.
- Managers sheet already has its new "Paid" column added (done directly,
  defaulted to FALSE for all current managers).

TEST CHECKLIST:
- Pay tab buttons open Venmo/Cash App correctly on your phone
- Who's Paid list shows all managers, unpaid sorted first
- Toggle a manager's Paid status in Commish Tools, confirm it flips on the
  public list
- Add a new test manager, confirm PIN/Phone/Team land in the right columns
- Existing stuff (login, standings, Oracle, Shit Show) still works
