[README.txt](https://github.com/user-attachments/files/34722844/README.txt)
2B1C FFL — v1.6.16
===================

Files in this package (replace these 3 on GitHub):
- index.html
- app.js
- styles.css

What changed:
Removed the separate Commish Tools > Release Notes admin screen (was an
extra click). The commissioner now sees show/hide toggles for each version
note right inside the same Version History drawer (Settings) everyone
already uses. Regular managers still see the plain list, no toggles.

Backend: no Code.gs changes needed for this — it reuses the existing
getReleaseNotesAdmin / setReleaseNoteVisible actions, just called from a
different spot in the UI.

Also fixed in passing: the small home-screen version badge was stuck on
v1.6.12 (several releases stale) — synced to v1.6.16.

Not touched: Pay tab, dues tracking, Commish Tools (other cards), ESPN
integration, login/auth.

Install:
1. Replace index.html, app.js, styles.css in the repo with these 3 files.
2. Commit + push to main, rebuild GitHub Pages if it doesn't auto-build.
3. No Apps Script / Code.gs changes required for this release.

Test checklist:
- Settings > Version History opens for a regular manager: plain list,
  newest-first, no toggles.
- Settings > Version History opens for Will (commissioner): same list,
  each entry now has a toggle switch; flipping one hides/shows it from
  everyone else's list (refresh to confirm on a non-commish login).
- Commish Tools menu: "Release Notes" row is gone; Manager Info, Send
  Announcement, Manager Poll, Dashboard Spotlight, Commissioner Desk,
  Draft Central all still work as before.
- Home screen version badge reads v1.6.16.
