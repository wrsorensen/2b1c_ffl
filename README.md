[README_v1.6.28.txt](https://github.com/user-attachments/files/35006323/README_v1.6.28.txt)
v1.6.28 — Hot Sheet shows team owners

FILES CHANGED
- app.js
- index.html
- styles.css

WHAT CHANGED
- app.js: every Hot Sheet dig now tags the manager, not just the joke
  team name. New hlTeamWithOwner_() renders "TeamName (Manager)" and
  replaces the plain hlTeam_() call inside all 8 HOT_SHEET_TEMPLATES
  categories (High Roller, Seriously WTF, Mercy Killing, Nail-Biter,
  Wasted Talent, Manager Malfunction, Waiver Win, Upset of the Week).
  Owner lookup (managerNameForTeam_()) matches against
  state.appData.teamsDivisions, which is already live-corrected for
  in-season ESPN renames - same source the Teams/Standings pages use,
  so this can't drift out of sync the way matching against the
  Managers sheet's own TeamName column would.
- index.html: version strings bumped to v1.6.28 (loginStatus line +
  home-version badge).
- styles.css: new .hot-sheet-owner class - manager name renders
  lighter weight than the bold team name, just a clarifier.

NOT TOUCHED
- Everything else in Hot Sheet (which categories fire, when, margins/
  thresholds) - purely a text/display change on top of the existing logic.
- Code.gs / ESPN.gs (backend) - the ESPN.gs v1.6.9.23 roster-points fix
  is a separate delivery; still required for Wasted Talent / Manager
  Malfunction / Waiver Win to actually populate.

INSTALL
Replace index.html, app.js, and styles.css in the repo root. Rebuild/
deploy GitHub Pages as usual.

TEST CHECKLIST
- App loads, version shows v1.6.28 (login line + Home badge)
- Open Hot Sheet for a week with real data - every dig shows
  "TeamName (Manager)" instead of just the team name
- Spot-check 2-3 managers you know are currently right in ESPN
  (especially anyone who renamed their team this season) - confirm
  the manager name shown is correct, not stale
- Co-managed team shows both names ("Manager & CoManager")
- If a team has no TeamsDivisions/ESPNTeamId mapping, it just shows
  the team name with no "(...)" - doesn't break or show "undefined"
- Everything else on Hot Sheet (categories firing, blowout/nail-biter
  thresholds, week navigation) unchanged
