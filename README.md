[README.txt](https://github.com/user-attachments/files/34722109/README.txt)
2B1C FFL - v1.6.15 - Who's Paid grouped by team

FILES IN THIS PACKAGE (frontend-only, replace in GitHub repo root):
- index.html
- app.js
(styles.css unchanged this release - don't need to replace it)

WHAT CHANGED:
- Who's Paid list on the Pay tab now shows ONE line per TEAM, not per
  manager. A co-managed team (two manager rows sharing the same TeamName)
  only owes one $100 buy-in - it's grouped as "Team Name / Manager &
  Co-Manager" with a single Paid/Unpaid badge. Paid shows true if EITHER
  manager's row is marked paid in Commish Tools - doesn't matter which one
  gets toggled.
- No backend/Sheet change - the Commish Tools > Manager Info toggle is
  unchanged, still one row per manager. This is a display-only grouping.

INSTALL:
1. Replace index.html and app.js at the root of the wrsorensen/2b1c_ffl
   repo, main branch. Leave styles.css as-is.
2. Commit.
3. Confirm GitHub Pages rebuilds and the live footer shows v1.6.15.

TEST CHECKLIST:
- Pay tab: co-managed teams (if any) show as one line, not two
- Toggling either manager's Paid checkbox in Commish Tools flips that
  team's line on the public list
- Solo-manager teams still show correctly (team name + manager name)
